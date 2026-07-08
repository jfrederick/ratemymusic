import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { absoluteRymUrl, canonicalRymUrl } from "../rym/urls.js";
import type { ScrapeResult, Scraper } from "../types.js";

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const DEFAULT_WAIT_FOR_MS = 4000;
const DEFAULT_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 100;

/** Structural budget interface `FirecrawlScraper` needs -- `BudgetLedger` satisfies it. */
export interface ScrapeBudget {
  canSpend(n?: number): boolean;
  spend(n?: number): void;
}

export class ScrapeBudgetError extends Error {}

export class ScrapeFailedError extends Error {
  public readonly url: string;
  public readonly status?: number;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = "ScrapeFailedError";
    this.url = url;
    this.status = status;
  }
}

type CacheMeta = { url: string; fetchedAt: string };

export type FirecrawlScraperOptions = {
  apiKey: string;
  cacheDir: string;
  budget: ScrapeBudget;
  fetchImpl?: typeof fetch;
  waitForMs?: number;
  maxRetries?: number;
  /** Injectable for tests, to avoid real delays during retry backoff. */
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class FirecrawlScraper implements Scraper {
  private readonly apiKey: string;
  private readonly cacheDir: string;
  private readonly budget: ScrapeBudget;
  private readonly fetchImpl: typeof fetch;
  private readonly waitForMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: FirecrawlScraperOptions) {
    this.apiKey = opts.apiKey;
    this.cacheDir = opts.cacheDir;
    this.budget = opts.budget;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.waitForMs = opts.waitForMs ?? DEFAULT_WAIT_FOR_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private cachePaths(canonicalUrl: string): { mdPath: string; metaPath: string } {
    const hash = createHash("sha1").update(canonicalUrl).digest("hex");
    return {
      mdPath: join(this.cacheDir, `${hash}.md`),
      metaPath: join(this.cacheDir, `${hash}.meta.json`),
    };
  }

  private readCache(
    canonicalUrl: string,
    maxAgeDays: number,
  ): { markdown: string; cachePath: string } | null {
    const { mdPath, metaPath } = this.cachePaths(canonicalUrl);
    if (!existsSync(mdPath) || !existsSync(metaPath)) return null;

    let meta: CacheMeta;
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    } catch {
      return null;
    }

    const ageMs = Date.now() - new Date(meta.fetchedAt).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (ageDays > maxAgeDays) return null;

    return { markdown: readFileSync(mdPath, "utf-8"), cachePath: mdPath };
  }

  private writeCache(canonicalUrl: string, markdown: string): string {
    mkdirSync(this.cacheDir, { recursive: true });
    const { mdPath, metaPath } = this.cachePaths(canonicalUrl);
    writeFileSync(mdPath, markdown, "utf-8");
    const meta: CacheMeta = { url: canonicalUrl, fetchedAt: new Date().toISOString() };
    writeFileSync(metaPath, JSON.stringify(meta), "utf-8");
    return mdPath;
  }

  async scrape(url: string, opts?: { maxAgeDays?: number }): Promise<ScrapeResult> {
    const canonicalUrl = canonicalRymUrl(url);
    const maxAgeDays = opts?.maxAgeDays ?? Number.POSITIVE_INFINITY;

    const cached = this.readCache(canonicalUrl, maxAgeDays);
    if (cached) {
      return {
        url: canonicalUrl,
        markdown: cached.markdown,
        links: [],
        cachePath: cached.cachePath,
        fromCache: true,
      };
    }

    if (!this.budget.canSpend(1)) {
      throw new ScrapeBudgetError(`Scrape budget exhausted for ${canonicalUrl}`);
    }

    const body = JSON.stringify({
      url: absoluteRymUrl(canonicalUrl),
      formats: ["markdown", "links"],
      waitFor: this.waitForMs,
    });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(FIRECRAWL_SCRAPE_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body,
        });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await this.sleep(BACKOFF_BASE_MS * 2 ** attempt);
          continue;
        }
        const reason = err instanceof Error ? err.message : String(err);
        throw new ScrapeFailedError(
          `Firecrawl scrape network error for ${canonicalUrl}: ${reason}`,
          canonicalUrl,
        );
      }

      if (res.ok) {
        const json = (await res.json()) as {
          success?: boolean;
          data?: { markdown?: string; links?: string[] };
        };
        const markdown = json.data?.markdown ?? "";
        const links = json.data?.links ?? [];
        this.budget.spend(1);
        const cachePath = this.writeCache(canonicalUrl, markdown);
        return { url: canonicalUrl, markdown, links, cachePath, fromCache: false };
      }

      if (isRetryableStatus(res.status) && attempt < this.maxRetries) {
        await this.sleep(BACKOFF_BASE_MS * 2 ** attempt);
        continue;
      }

      throw new ScrapeFailedError(
        `Firecrawl scrape failed for ${canonicalUrl} with status ${res.status}`,
        canonicalUrl,
        res.status,
      );
    }

    // Unreachable: the loop above always returns or throws.
    throw new ScrapeFailedError(`Firecrawl scrape failed for ${canonicalUrl}`, canonicalUrl);
  }
}

const CLI_KEY_FIELDS = ["apiKey", "api_key", "key"];

/** Best-effort read of the firecrawl-cli's saved API key from its config directory. */
export function firecrawlApiKeyFromCli(baseDir?: string): string | null {
  try {
    const dir = baseDir ?? join(homedir(), "Library", "Application Support", "firecrawl-cli");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const parsed = JSON.parse(readFileSync(join(dir, file), "utf-8"));
        for (const field of CLI_KEY_FIELDS) {
          const value = parsed?.[field];
          if (typeof value === "string" && value.length > 0) return value;
        }
      } catch {
        // Skip unreadable/invalid config files.
      }
    }
    return null;
  } catch {
    return null;
  }
}
