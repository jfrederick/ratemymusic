import type { DatabaseType } from "../db.js";
import { parseAlbumPage } from "../rym/parse/album.js";
import { parseCollectionPage } from "../rym/parse/collection.js";
import { ParseError } from "../rym/parse/errors.js";
import { parseGenrePage } from "../rym/parse/genre.js";
import { parseListPage } from "../rym/parse/list.js";
import { parseNewMusicPage } from "../rym/parse/newMusic.js";
import {
  type CollectionTier,
  canonicalRymUrl,
  collectionUrl,
  genrePageUrl,
  genreSlugFromUrl,
  newMusicUrl,
} from "../rym/urls.js";
import { ScrapeBudgetError, ScrapeFailedError } from "../scrape/firecrawl.js";
import type { Scraper } from "../types.js";
import { type QueueKind, enqueue, markDone, markFailed, nextPending } from "./frontier.js";
import { TTL_DAYS } from "./ttl.js";
import {
  replaceChartItems,
  replaceListItems,
  upsertAlbum,
  upsertChart,
  upsertList,
  upsertMyRating,
  upsertTwin,
  upsertTwinRating,
} from "./upserts.js";

export type SyncReport = {
  pagesScraped: number;
  fromCache: number;
  parseFailures: { url: string; error: string }[];
  budgetExhausted: boolean;
  counts: {
    albums: number;
    myRatings: number;
    lists: number;
    twins: number;
    twinRatings: number;
    charts: number;
  };
};

export type SyncOptions = {
  maxPages?: number;
  rymUsername?: string;
  topGenres?: number;
  maxLists?: number;
  maxTwins?: number;
  log?: (msg: string) => void;
};

const DEFAULT_RYM_USERNAME = "jimbof36";
const DEFAULT_TOP_GENRES = 8;
const DEFAULT_MAX_LISTS = 40;
const DEFAULT_MAX_TWINS = 10;
const OWN_ALBUM_MIN_RATING = 4.0;
const MAX_LIST_PAGES_PER_LIST = 3;
const MAX_TWIN_PAGES_PER_TIER = 2;
const COLLECTION_TIERS: CollectionTier[] = ["5.0", "4.5", "4.0", "3.5", "3.0"];
const TWIN_TIERS: CollectionTier[] = ["5.0", "4.5"];

/** Strips a trailing `/<pageNumber>/` path segment, used to identify the base (page-1) identity of a paginated list or collection. */
function basePagedUrl(url: string): string {
  return canonicalRymUrl(url).replace(/\/\d+\/$/, "/");
}

function usernameFromCollectionUrl(url: string): string {
  const match = canonicalRymUrl(url).match(/^\/collection\/([^/]+)\//);
  return match ? match[1] : "";
}

/** lowercase, '&'->'and', whitespace->hyphens, strip remaining non [a-z0-9-] characters. */
function slugifyGenre(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function countRows(db: DatabaseType, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

function finalCounts(db: DatabaseType): SyncReport["counts"] {
  return {
    albums: countRows(db, "albums"),
    myRatings: countRows(db, "my_ratings"),
    lists: countRows(db, "lists"),
    twins: countRows(db, "twins"),
    twinRatings: countRows(db, "twin_ratings"),
    charts: countRows(db, "charts"),
  };
}

/** Computes the top-N genres by weighted my_ratings count ((rating-2.5)^2), then enqueues their genre pages and the new-music page. */
function seedGenresAndNewMusic(db: DatabaseType, topGenres: number): void {
  const rows = db
    .prepare(
      "SELECT a.genres AS genres, r.rating AS rating FROM my_ratings r JOIN albums a ON a.id = r.album_id",
    )
    .all() as { genres: string; rating: number }[];

  const weights = new Map<string, number>();
  for (const row of rows) {
    let genres: string[];
    try {
      genres = JSON.parse(row.genres);
    } catch {
      genres = [];
    }
    const weight = (row.rating - 2.5) ** 2;
    for (const genre of genres) {
      weights.set(genre, (weights.get(genre) ?? 0) + weight);
    }
  }

  const top = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topGenres)
    .map(([genre]) => genre);

  for (const genre of top) {
    enqueue(db, genrePageUrl(slugifyGenre(genre)), "genre-page");
  }
  enqueue(db, newMusicUrl(), "new-music");
}

type ProcessCtx = {
  maxLists: number;
  maxTwins: number;
  listPageCount: Map<string, number>;
  twinPageCount: Map<string, number>;
};

function processCollection(db: DatabaseType, markdown: string): void {
  const page = parseCollectionPage(markdown);
  for (const item of page.items) {
    const albumId = upsertAlbum(db, {
      rymUrl: item.rymUrl,
      artist: item.artist,
      title: item.title,
      year: item.year,
    });
    upsertMyRating(db, albumId, item.rating, item.ratedAt);
    if (item.rating >= OWN_ALBUM_MIN_RATING) {
      enqueue(db, item.rymUrl, "album");
    }
  }
  if (page.nextPageUrl) enqueue(db, page.nextPageUrl, "collection");
}

function processAlbum(db: DatabaseType, url: string, markdown: string, ctx: ProcessCtx): void {
  const page = parseAlbumPage(markdown);
  const scrapedAt = new Date().toISOString();

  const existing = db
    .prepare("SELECT rym_url, artist, title, year FROM albums WHERE rym_url = ?")
    .get(url) as
    | { rym_url: string; artist: string; title: string; year: number | null }
    | undefined;
  if (existing) {
    upsertAlbum(db, {
      rymUrl: existing.rym_url,
      artist: existing.artist,
      title: existing.title,
      year: existing.year,
      genres: page.genres,
      descriptors: page.descriptors,
      rymAvgRating: page.avgRating ?? undefined,
      rymNumRatings: page.numRatings ?? undefined,
      scrapedAt,
    });
  }

  let listCount = countRows(db, "lists");
  for (const la of page.listAppearances) {
    const rymUrl = canonicalRymUrl(la.rymUrl);
    const alreadyKnown =
      db.prepare("SELECT 1 FROM lists WHERE rym_url = ?").get(rymUrl) !== undefined;
    if (!alreadyKnown && listCount >= ctx.maxLists) continue;
    upsertList(db, { rymUrl, title: la.title, author: null });
    enqueue(db, rymUrl, "list");
    if (!alreadyKnown) listCount++;
  }
}

function processList(db: DatabaseType, url: string, markdown: string, ctx: ProcessCtx): void {
  const page = parseListPage(markdown);
  const scrapedAt = new Date().toISOString();
  const base = basePagedUrl(url);

  const listId = upsertList(db, {
    rymUrl: base,
    title: page.title,
    author: page.author || null,
    scrapedAt,
  });

  const newAlbumIds = page.items.map((item) => upsertAlbum(db, item));
  const existingAlbumIds = (
    db
      .prepare("SELECT album_id FROM list_items WHERE list_id = ? ORDER BY position")
      .all(listId) as { album_id: number }[]
  ).map((row) => row.album_id);
  replaceListItems(db, listId, [...existingAlbumIds, ...newAlbumIds]);

  const pageCount = (ctx.listPageCount.get(base) ?? 0) + 1;
  ctx.listPageCount.set(base, pageCount);
  if (page.nextPageUrl && pageCount < MAX_LIST_PAGES_PER_LIST) {
    enqueue(db, page.nextPageUrl, "list");
  }

  if (page.author) {
    const alreadyTwin =
      db.prepare("SELECT 1 FROM twins WHERE username = ?").get(page.author) !== undefined;
    const twinCount = countRows(db, "twins");
    if (alreadyTwin || twinCount < ctx.maxTwins) {
      upsertTwin(db, page.author);
      for (const tier of TWIN_TIERS) {
        enqueue(db, collectionUrl(page.author, tier), "twin-collection");
      }
    }
  }
}

function processTwinCollection(
  db: DatabaseType,
  url: string,
  markdown: string,
  ctx: ProcessCtx,
): void {
  const page = parseCollectionPage(markdown);
  const username = usernameFromCollectionUrl(url);
  for (const item of page.items) {
    const albumId = upsertAlbum(db, {
      rymUrl: item.rymUrl,
      artist: item.artist,
      title: item.title,
      year: item.year,
    });
    upsertTwinRating(db, username, albumId, item.rating);
  }

  const base = basePagedUrl(url);
  const pageCount = (ctx.twinPageCount.get(base) ?? 0) + 1;
  ctx.twinPageCount.set(base, pageCount);
  if (page.nextPageUrl && pageCount < MAX_TWIN_PAGES_PER_TIER) {
    enqueue(db, page.nextPageUrl, "twin-collection");
  }
}

function processGenrePage(db: DatabaseType, url: string, markdown: string): void {
  const page = parseGenrePage(markdown, url);
  const scrapedAt = new Date().toISOString();
  const genre = genreSlugFromUrl(url) ?? page.genre;
  const chartId = upsertChart(db, {
    rymUrl: url,
    kind: "genre-page",
    params: { genre },
    scrapedAt,
  });
  const albumIds = page.items.map((item) => upsertAlbum(db, item));
  replaceChartItems(db, chartId, albumIds);
}

function processNewMusic(db: DatabaseType, url: string, markdown: string): void {
  const page = parseNewMusicPage(markdown);
  const scrapedAt = new Date().toISOString();
  const chartId = upsertChart(db, { rymUrl: url, kind: "new", params: {}, scrapedAt });
  const albumIds = page.items.map((item) => upsertAlbum(db, item));
  replaceChartItems(db, chartId, albumIds);
}

function processPage(
  db: DatabaseType,
  kind: QueueKind,
  url: string,
  markdown: string,
  ctx: ProcessCtx,
): void {
  switch (kind) {
    case "collection":
      processCollection(db, markdown);
      return;
    case "album":
      processAlbum(db, url, markdown, ctx);
      return;
    case "list":
      processList(db, url, markdown, ctx);
      return;
    case "twin-collection":
      processTwinCollection(db, url, markdown, ctx);
      return;
    case "genre-page":
      processGenrePage(db, url, markdown);
      return;
    case "new-music":
      processNewMusic(db, url, markdown);
      return;
  }
}

/** Orchestrates a single ingest run: seeds the frontier from the caller's collection, drains it, persists as it goes. */
export async function runSync(
  db: DatabaseType,
  scraper: Scraper,
  opts: SyncOptions = {},
): Promise<SyncReport> {
  const rymUsername = opts.rymUsername ?? DEFAULT_RYM_USERNAME;
  const topGenres = opts.topGenres ?? DEFAULT_TOP_GENRES;
  const ctx: ProcessCtx = {
    maxLists: opts.maxLists ?? DEFAULT_MAX_LISTS,
    maxTwins: opts.maxTwins ?? DEFAULT_MAX_TWINS,
    listPageCount: new Map(),
    twinPageCount: new Map(),
  };
  const log = opts.log ?? (() => {});

  let pagesScraped = 0;
  let fromCache = 0;
  const parseFailures: { url: string; error: string }[] = [];
  let budgetExhausted = false;
  let genreSeeded = false;

  for (const tier of COLLECTION_TIERS) {
    enqueue(db, collectionUrl(rymUsername, tier), "collection");
  }

  for (;;) {
    const item = nextPending(db);

    if (!item) {
      if (genreSeeded) break;
      seedGenresAndNewMusic(db, topGenres);
      genreSeeded = true;
      continue;
    }

    if (!genreSeeded && item.kind !== "collection" && item.kind !== "album") {
      seedGenresAndNewMusic(db, topGenres);
      genreSeeded = true;
      continue;
    }

    if (opts.maxPages !== undefined && pagesScraped >= opts.maxPages) break;

    let result: Awaited<ReturnType<Scraper["scrape"]>>;
    try {
      result = await scraper.scrape(item.url, { maxAgeDays: TTL_DAYS[item.kind] });
    } catch (err) {
      if (err instanceof ScrapeBudgetError) {
        budgetExhausted = true;
        break;
      }
      if (err instanceof ScrapeFailedError) {
        parseFailures.push({ url: item.url, error: err.message });
        markFailed(db, item.id);
        continue;
      }
      throw err;
    }

    if (result.fromCache) {
      fromCache++;
    } else {
      pagesScraped++;
    }
    log(
      `[sync] scraped ${item.kind} ${item.url} (${pagesScraped}${
        opts.maxPages !== undefined ? `/${opts.maxPages}` : ""
      })`,
    );

    try {
      processPage(db, item.kind, item.url, result.markdown, ctx);
    } catch (err) {
      if (err instanceof ParseError) {
        parseFailures.push({ url: item.url, error: err.message });
        markFailed(db, item.id);
        continue;
      }
      throw err;
    }

    markDone(db, item.id);
  }

  return {
    pagesScraped,
    fromCache,
    parseFailures,
    budgetExhausted,
    counts: finalCounts(db),
  };
}
