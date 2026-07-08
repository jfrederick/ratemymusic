import { describe, expect, it } from "vitest";
import { BudgetLedger } from "../../src/budget.js";
import { openDb } from "../../src/db.js";
import { runSync } from "../../src/ingest/sync.js";
import { collectionUrl } from "../../src/rym/urls.js";
import { getSetting } from "../../src/settings.js";
import { FakeScraper, fixture } from "./fakeScraper.js";

const RYM_USERNAME = "jimbof36";

// A minimal, always-parseable "empty" page per kind -- used as a catch-all fallback so that
// urls this test doesn't care about (the long tail of list/collection links embedded in the
// real album fixtures) don't turn into ScrapeFailedError noise.
const EMPTY_COLLECTION_MD = "/collection/x/r5.0\n\n| Art | Date |\n";
const EMPTY_LIST_MD = "# Untitled List\n";

function happyPathUrls() {
  return {
    [collectionUrl(RYM_USERNAME, "5.0")]: fixture("collection-r5.0.md"),
    "/release/album/bon-iver/for-emma-forever-ago/": fixture("album-for-emma.md"),
    "/release/album/slowdive/souvlaki/": fixture("album-souvlaki.md"),
    "/list/GentlemanCritic/dark-winter/": fixture("list-dark-winter.md"),
    // A minimal, well-formed page 2: same heading (a real RYM page 2 would show the same
    // title), no further items/pagination -- ends the dark-winter pagination chain cleanly.
    "/list/GentlemanCritic/dark-winter/2/": "# Dark Winter\n",
    "/list/JesseAaron/top-releases-of-all-time/": fixture("list-top-releases.md"),
    "/collection/JesseAaron/r5.0": fixture("user-collection-jesseaaron-r5.md"),
    "/genre/slowcore/": fixture("genre-slowcore.md"),
    "/new-music/": fixture("new-music.md"),
  };
}

function happyPathFallbacks() {
  return [
    // Own-collection tiers we don't care about for this test: keep them empty so they
    // contribute no rows and no further pagination.
    {
      test: (u: string) => /^\/collection\/jimbof36\/r(4\.5|4\.0|3\.5|3\.0)\/$/.test(u),
      markdown: EMPTY_COLLECTION_MD,
    },
    // Any other twin/list collection page (e.g. GentlemanCritic's, or a further page of
    // JesseAaron's) resolves to an empty, non-paginated collection.
    { test: (u: string) => u.startsWith("/collection/"), markdown: EMPTY_COLLECTION_MD },
    // Any list link this test doesn't explicitly care about resolves to an empty list
    // (no items, no author, no next page) so it can't fan out further.
    { test: (u: string) => u.startsWith("/list/"), markdown: EMPTY_LIST_MD },
    // The other 7 (of 9) r5.0-rated albums: a minimal, genre-less, list-free album page.
    {
      test: (u: string) => u.startsWith("/release/"),
      markdown: "By [Someone](https://rateyourmusic.com/artist/someone)\n",
    },
    // Every genre page seeded from For Emma / Souvlaki's genres resolves to the same real
    // genre-chart fixture -- content mismatch (it's actually the slowcore chart) doesn't
    // matter for this test, which only asserts that a genre-page chart row gets created.
    { test: (u: string) => u.startsWith("/genre/"), markdown: fixture("genre-slowcore.md") },
  ];
}

describe("runSync: happy path", () => {
  it("walks jim's r5.0 collection out to albums, a list, a twin, a genre chart, and new-music", async () => {
    const db = openDb(":memory:");
    const scraper = new FakeScraper({ urls: happyPathUrls(), fallbacks: happyPathFallbacks() });

    const report = await runSync(db, scraper, { rymUsername: RYM_USERNAME });

    expect(report.parseFailures).toEqual([]);
    expect(report.budgetExhausted).toBe(false);

    const myRatings = db
      .prepare(
        "SELECT a.rym_url AS rymUrl, r.rating AS rating FROM my_ratings r JOIN albums a ON a.id = r.album_id",
      )
      .all() as { rymUrl: string; rating: number }[];
    expect(myRatings).toHaveLength(9);
    expect(myRatings.every((r) => r.rating === 5.0)).toBe(true);
    expect(report.counts.myRatings).toBe(9);

    const forEmma = db
      .prepare("SELECT genres, rym_avg_rating AS rymAvgRating FROM albums WHERE rym_url = ?")
      .get("/release/album/bon-iver/for-emma-forever-ago/") as {
      genres: string;
      rymAvgRating: number;
    };
    expect(JSON.parse(forEmma.genres)).toEqual(
      expect.arrayContaining(["Indie Folk", "Singer-Songwriter", "Psychedelic Folk"]),
    );
    expect(forEmma.rymAvgRating).toBeCloseTo(3.82);

    const darkWinterList = db
      .prepare("SELECT id, title, author_username AS author FROM lists WHERE rym_url = ?")
      .get("/list/GentlemanCritic/dark-winter/") as { id: number; title: string; author: string };
    expect(darkWinterList).toBeTruthy();
    expect(darkWinterList.title).toBe("Dark Winter");
    expect(darkWinterList.author).toBe("GentlemanCritic");

    const listItems = db
      .prepare("SELECT position FROM list_items WHERE list_id = ? ORDER BY position")
      .all(darkWinterList.id) as { position: number }[];
    expect(listItems.length).toBeGreaterThan(0);
    expect(listItems.map((r) => r.position)).toEqual(listItems.map((_, i) => i));

    const twinRatings = db
      .prepare("SELECT COUNT(*) AS c FROM twin_ratings WHERE username = 'JesseAaron'")
      .get() as { c: number };
    expect(twinRatings.c).toBeGreaterThan(0);
    expect(report.counts.twinRatings).toBeGreaterThan(0);

    const chartKinds = (db.prepare("SELECT kind FROM charts").all() as { kind: string }[]).map(
      (r) => r.kind,
    );
    expect(chartKinds).toContain("genre-page");
    expect(chartKinds).toContain("new");

    expect(report.counts.albums).toBeGreaterThan(0);
    expect(report.counts.lists).toBeGreaterThan(0);
    expect(report.counts.twins).toBeGreaterThan(0);
    expect(report.counts.charts).toBe(chartKinds.length);
  });

  it("does not enqueue album-page scrapes for 3.0-tier items (frugal budget)", async () => {
    const db = openDb(":memory:");
    // Synthesize a genuine r3.0-shaped page: same table shape as the r5.0 fixture, but with
    // every row's rating dropped to 3.00 stars (as a real r3.0 collection-tier page would
    // show only 3.0-rated items).
    const r30Markdown = fixture("collection-r5.0.md")
      .replace(/r5\.0/g, "r3.0")
      .replace(/5\.00 stars/g, "3.00 stars");

    const scraper = new FakeScraper({
      urls: {
        [collectionUrl(RYM_USERNAME, "3.0")]: r30Markdown,
        "/new-music/": fixture("new-music.md"),
      },
      fallbacks: [
        { test: (u: string) => u.startsWith("/collection/"), markdown: EMPTY_COLLECTION_MD },
        { test: (u: string) => u.startsWith("/list/"), markdown: EMPTY_LIST_MD },
        { test: (u: string) => u.startsWith("/release/"), markdown: "SHOULD NOT BE FETCHED" },
      ],
    });

    const report = await runSync(db, scraper, { rymUsername: RYM_USERNAME });

    expect(report.parseFailures).toEqual([]);
    const myRatings = db.prepare("SELECT rating FROM my_ratings").all() as { rating: number }[];
    expect(myRatings.length).toBeGreaterThan(0);
    expect(myRatings.every((r) => r.rating === 3.0)).toBe(true);

    const albumQueueItems = db
      .prepare("SELECT COUNT(*) AS c FROM scrape_queue WHERE kind = 'album'")
      .get() as { c: number };
    expect(albumQueueItems.c).toBe(0);
  });
});

describe("runSync: genre-page genre stamping (C1)", () => {
  it("stamps the chart's genre onto albums that only appear via the genre-page scrape", async () => {
    const db = openDb(":memory:");
    const scraper = new FakeScraper({
      // Souvlaki's real genres (Dream Pop/Shoegaze/Space Rock Revival) give seedGenresAndNewMusic
      // something to enqueue a genre page for -- every /genre/ url resolves to the same
      // genre-slowcore.md fixture regardless of which genre it's actually for (only the parsed
      // heading/url slug matters here, not which genre it nominally represents).
      urls: {
        [collectionUrl(RYM_USERNAME, "5.0")]: fixture("collection-r5.0.md"),
        "/release/album/slowdive/souvlaki/": fixture("album-souvlaki.md"),
        "/new-music/": fixture("new-music.md"),
      },
      fallbacks: [
        { test: (u: string) => u.startsWith("/collection/"), markdown: EMPTY_COLLECTION_MD },
        { test: (u: string) => u.startsWith("/list/"), markdown: EMPTY_LIST_MD },
        {
          test: (u: string) => u.startsWith("/release/"),
          markdown: "By [Someone](https://rateyourmusic.com/artist/someone)\n",
        },
        { test: (u: string) => u.startsWith("/genre/"), markdown: fixture("genre-slowcore.md") },
      ],
    });

    await runSync(db, scraper, { rymUsername: RYM_USERNAME });

    const charts = db.prepare("SELECT id, params FROM charts WHERE kind = 'genre-page'").all() as {
      id: number;
      params: string;
    }[];
    expect(charts.length).toBeGreaterThan(0);
    const chartGenreById = new Map(
      charts.map((c) => [c.id, (JSON.parse(c.params) as { genre: string }).genre]),
    );

    const placeholders = charts.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT ci.chart_id AS chartId, ci.album_id AS albumId, a.genres AS genres
         FROM chart_items ci
         JOIN albums a ON a.id = ci.album_id
         WHERE ci.chart_id IN (${placeholders})`,
      )
      .all(...charts.map((c) => c.id)) as { chartId: number; albumId: number; genres: string }[];
    expect(rows.length).toBeGreaterThan(0);

    const chartIdsByAlbum = new Map<number, number[]>();
    const genresByAlbum = new Map<number, string[]>();
    for (const row of rows) {
      genresByAlbum.set(row.albumId, JSON.parse(row.genres));
      const ids = chartIdsByAlbum.get(row.albumId) ?? [];
      ids.push(row.chartId);
      chartIdsByAlbum.set(row.albumId, ids);
    }

    // Every album sighted only via a genre chart (never its own album page, per the frugal
    // fallback above) picked up exactly one genre -- the name of one of the chart(s) it's
    // charted on -- instead of staying stuck at `genres: []`.
    for (const [albumId, genres] of genresByAlbum) {
      expect(genres).toHaveLength(1);
      const candidateGenres = (chartIdsByAlbum.get(albumId) ?? []).map((id) =>
        chartGenreById.get(id),
      );
      expect(candidateGenres).toContain(genres[0]);
    }
  });
});

describe("runSync: last_sync_report persistence (M2)", () => {
  it("persists the report to the last_sync_report setting so CLI-only callers (no HTTP route) still surface it", async () => {
    const db = openDb(":memory:");
    const scraper = new FakeScraper({
      urls: { [collectionUrl(RYM_USERNAME, "5.0")]: fixture("collection-r5.0.md") },
      fallbacks: [{ test: () => true, markdown: EMPTY_COLLECTION_MD }],
    });

    const report = await runSync(db, scraper, { rymUsername: RYM_USERNAME, maxPages: 1 });

    expect(getSetting(db, "last_sync_report")).toEqual(report);
  });
});

describe("runSync: budget exhaustion", () => {
  it("stops without throwing when the budget is exhausted, leaving the item pending", async () => {
    const db = openDb(":memory:");
    const budget = new BudgetLedger(db, { daily: 1, initial: 1 }, () => "2026-07-08");
    const scraper = new FakeScraper({
      urls: { [collectionUrl(RYM_USERNAME, "5.0")]: fixture("collection-r5.0.md") },
      budget,
    });

    const report = await runSync(db, scraper, { rymUsername: RYM_USERNAME });

    expect(report.budgetExhausted).toBe(true);
    expect(report.parseFailures).toEqual([]);
    expect(report.pagesScraped).toBe(1); // only the first (r5.0) tier fit in the budget

    const pending = db
      .prepare("SELECT COUNT(*) AS c FROM scrape_queue WHERE status = 'pending'")
      .get() as { c: number };
    expect(pending.c).toBeGreaterThan(0);
  });
});

describe("runSync: maxPages", () => {
  it("counts only non-cache scrapes against maxPages", async () => {
    const db = openDb(":memory:");
    const cachedUrl = collectionUrl(RYM_USERNAME, "5.0");
    const scraper = new FakeScraper({
      urls: {},
      fallbacks: [{ test: () => true, markdown: EMPTY_COLLECTION_MD }],
      cachedUrls: new Set([cachedUrl]),
    });

    const report = await runSync(db, scraper, { rymUsername: RYM_USERNAME, maxPages: 2 });

    expect(report.parseFailures).toEqual([]);
    expect(report.fromCache).toBe(1); // r5.0 was served from cache -- doesn't count
    expect(report.pagesScraped).toBe(2); // r4.5 and r4.0 (fresh) do count

    const pending = db
      .prepare("SELECT COUNT(*) AS c FROM scrape_queue WHERE status = 'pending'")
      .get() as { c: number };
    expect(pending.c).toBeGreaterThan(0); // r3.5/r3.0 never got a chance to run
  });
});

describe("runSync: parse failure path", () => {
  it("records a parse failure for one url and keeps syncing the rest", async () => {
    const db = openDb(":memory:");
    const brokenTierUrl = collectionUrl(RYM_USERNAME, "4.5");
    const scraper = new FakeScraper({
      urls: {
        [collectionUrl(RYM_USERNAME, "5.0")]: fixture("collection-r5.0.md"),
        [brokenTierUrl]: "This is not a RYM collection page at all.",
        "/new-music/": fixture("new-music.md"),
      },
      fallbacks: [
        { test: (u: string) => u.startsWith("/collection/"), markdown: EMPTY_COLLECTION_MD },
        {
          test: (u: string) => u.startsWith("/release/"),
          markdown: "By [Someone](https://rateyourmusic.com/artist/someone)\n",
        },
        { test: (u: string) => u.startsWith("/list/"), markdown: EMPTY_LIST_MD },
        { test: (u: string) => u.startsWith("/genre/"), markdown: fixture("genre-slowcore.md") },
      ],
    });

    const report = await runSync(db, scraper, { rymUsername: RYM_USERNAME });

    expect(report.parseFailures.length).toBeGreaterThan(0);
    expect(report.parseFailures.every((f) => f.url === "/collection/jimbof36/r4.5/")).toBe(true);

    // The r4.5 failure didn't stop the rest of the sync: r5.0's 9 ratings still landed.
    expect(report.counts.myRatings).toBe(9);

    const row = db
      .prepare("SELECT status, attempts FROM scrape_queue WHERE url = ?")
      .get("/collection/jimbof36/r4.5/") as { status: string; attempts: number };
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
  });
});
