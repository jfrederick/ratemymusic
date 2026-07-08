import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FirecrawlScraper,
  ScrapeBudgetError,
  ScrapeFailedError,
  firecrawlApiKeyFromCli,
} from "../../src/scrape/firecrawl.js";

function fakeBudget(canSpend = true) {
  return {
    canSpend: vi.fn(() => canSpend),
    spend: vi.fn(),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("FirecrawlScraper", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "rmm-firecrawl-"));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("scrapes, spends budget, and writes the cache on success", async () => {
    const budget = fakeBudget(true);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { markdown: "# hi", links: ["https://a"] } }),
    );
    const scraper = new FirecrawlScraper({
      apiKey: "key",
      cacheDir,
      budget,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await scraper.scrape("https://rateyourmusic.com/genre/slowcore/");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.spend).toHaveBeenCalledWith(1);
    expect(result.fromCache).toBe(false);
    expect(result.markdown).toBe("# hi");
    expect(result.links).toEqual(["https://a"]);
    expect(result.url).toBe("/genre/slowcore/");
    expect(existsSync(result.cachePath)).toBe(true);

    const metaPath = result.cachePath.replace(/\.md$/, ".meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.url).toBe("/genre/slowcore/");
    expect(typeof meta.fetchedAt).toBe("string");
  });

  it("returns a cache hit without calling fetch or spending budget", async () => {
    const budget = fakeBudget(true);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { markdown: "# cached", links: [] } }),
    );
    const scraper = new FirecrawlScraper({
      apiKey: "key",
      cacheDir,
      budget,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await scraper.scrape("https://rateyourmusic.com/genre/slowcore/");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const result = await scraper.scrape("https://rateyourmusic.com/genre/slowcore/");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // still 1 -- no second call
    expect(budget.spend).toHaveBeenCalledTimes(1); // still 1 -- no second spend
    expect(result.fromCache).toBe(true);
    expect(result.markdown).toBe("# cached");
  });

  it("re-scrapes when the cache is older than maxAgeDays", async () => {
    const budget = fakeBudget(true);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { markdown: "# fresh", links: [] } }),
    );
    const scraper = new FirecrawlScraper({
      apiKey: "key",
      cacheDir,
      budget,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await scraper.scrape("https://rateyourmusic.com/genre/slowcore/");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const metaPath = join(
      cacheDir,
      `${createHash("sha1").update("/genre/slowcore/").digest("hex")}.meta.json`,
    );
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    meta.fetchedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(metaPath, JSON.stringify(meta));

    const result = await scraper.scrape("https://rateyourmusic.com/genre/slowcore/", {
      maxAgeDays: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.fromCache).toBe(false);
    expect(result.markdown).toBe("# fresh");
  });

  it("throws ScrapeBudgetError before fetching when the budget is exhausted", async () => {
    const budget = fakeBudget(false);
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: { markdown: "x" } }));
    const scraper = new FirecrawlScraper({
      apiKey: "key",
      cacheDir,
      budget,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(scraper.scrape("https://rateyourmusic.com/genre/slowcore/")).rejects.toThrow(
      ScrapeBudgetError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries on 429 and succeeds", async () => {
    const budget = fakeBudget(true);
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse({ error: "rate limited" }, 429);
      return jsonResponse({ success: true, data: { markdown: "# ok", links: [] } });
    });
    const scraper = new FirecrawlScraper({
      apiKey: "key",
      cacheDir,
      budget,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: vi.fn(async () => {}),
    });

    const result = await scraper.scrape("https://rateyourmusic.com/genre/slowcore/");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.markdown).toBe("# ok");
    expect(budget.spend).toHaveBeenCalledTimes(1);
  });

  it("fails immediately on a 404 without retrying", async () => {
    const budget = fakeBudget(true);
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "not found" }, 404));
    const scraper = new FirecrawlScraper({
      apiKey: "key",
      cacheDir,
      budget,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: vi.fn(async () => {}),
    });

    await expect(scraper.scrape("https://rateyourmusic.com/genre/slowcore/")).rejects.toThrow(
      ScrapeFailedError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.spend).not.toHaveBeenCalled();
  });

  it("tolerates a response missing the links array", async () => {
    const budget = fakeBudget(true);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { markdown: "# no links" } }),
    );
    const scraper = new FirecrawlScraper({
      apiKey: "key",
      cacheDir,
      budget,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await scraper.scrape("https://rateyourmusic.com/genre/slowcore/");
    expect(result.links).toEqual([]);
  });
});

describe("firecrawlApiKeyFromCli", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "rmm-firecrawl-cli-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("reads an apiKey field from a json config file", () => {
    writeFileSync(join(baseDir, "config.json"), JSON.stringify({ apiKey: "fc-123" }));
    expect(firecrawlApiKeyFromCli(baseDir)).toBe("fc-123");
  });

  it("tries common alternate field names", () => {
    writeFileSync(join(baseDir, "config.json"), JSON.stringify({ api_key: "fc-456" }));
    expect(firecrawlApiKeyFromCli(baseDir)).toBe("fc-456");
  });

  it("returns null when the directory doesn't exist", () => {
    expect(firecrawlApiKeyFromCli(join(baseDir, "does-not-exist"))).toBeNull();
  });

  it("returns null when no config file has a key-like field", () => {
    writeFileSync(join(baseDir, "config.json"), JSON.stringify({ other: "value" }));
    expect(firecrawlApiKeyFromCli(baseDir)).toBeNull();
  });
});
