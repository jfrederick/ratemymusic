import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalRymUrl } from "../../src/rym/urls.js";
import { ScrapeBudgetError, ScrapeFailedError } from "../../src/scrape/firecrawl.js";
import type { ScrapeResult, Scraper } from "../../src/types.js";

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf-8");
}

export type FakeScraperBudget = { canSpend(n?: number): boolean; spend(n?: number): void };

export type FakeScraperOptions = {
  /** Exact canonical-url -> markdown map (highest precedence). */
  urls?: Record<string, string>;
  /** Checked (in order) when there's no exact match; first predicate to match wins. */
  fallbacks?: { test: (url: string) => boolean; markdown: string }[];
  /** Canonical urls that should report `fromCache: true` instead of being freshly "fetched". */
  cachedUrls?: Set<string>;
  /** Optional shared budget; scrape() consults it (like FirecrawlScraper does) before serving fresh content. */
  budget?: FakeScraperBudget;
};

/** A Scraper test double serving fixture/inline markdown by canonical url; unknown urls throw ScrapeFailedError. */
export class FakeScraper implements Scraper {
  public readonly requested: string[] = [];
  private readonly urls: Map<string, string>;
  private readonly fallbacks: { test: (url: string) => boolean; markdown: string }[];
  private readonly cachedUrls: Set<string>;
  private readonly budget?: FakeScraperBudget;

  constructor(opts: FakeScraperOptions = {}) {
    this.urls = new Map(
      Object.entries(opts.urls ?? {}).map(([url, markdown]) => [canonicalRymUrl(url), markdown]),
    );
    this.fallbacks = opts.fallbacks ?? [];
    this.cachedUrls = new Set([...(opts.cachedUrls ?? [])].map((url) => canonicalRymUrl(url)));
    this.budget = opts.budget;
  }

  async scrape(url: string, _opts?: { maxAgeDays?: number }): Promise<ScrapeResult> {
    const canonical = canonicalRymUrl(url);
    this.requested.push(canonical);

    const fromCache = this.cachedUrls.has(canonical);
    if (!fromCache && this.budget && !this.budget.canSpend(1)) {
      throw new ScrapeBudgetError(`fake budget exhausted for ${canonical}`);
    }

    const markdown =
      this.urls.get(canonical) ?? this.fallbacks.find((f) => f.test(canonical))?.markdown;
    if (markdown === undefined) {
      throw new ScrapeFailedError(`FakeScraper: no fixture mapped for ${canonical}`, canonical);
    }

    if (!fromCache && this.budget) {
      this.budget.spend(1);
    }

    return { url: canonical, markdown, links: [], cachePath: canonical, fromCache };
  }
}
