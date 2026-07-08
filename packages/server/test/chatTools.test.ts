import { ScrapeBudgetError, type Scraper, openDb } from "@rmm/core";
import { describe, expect, it, vi } from "vitest";
import { TOOL_EXECUTORS, slugifyGenre, type summarizeTasteProfile } from "../src/chat/tools.js";
import { buildTestDeps, seedAlbum, seedCandidate } from "./helpers.js";

describe("get_taste_profile", () => {
  it("returns an empty summary when no taste profile has been computed", async () => {
    const deps = buildTestDeps();
    const result = await TOOL_EXECUTORS.get_taste_profile(deps, {});
    expect(result).toEqual({
      ok: true,
      data: { genres: [], descriptors: [], eras: [], computedAt: null },
    });
  });

  it("returns the top-15 weighted genres/descriptors/eras from the persisted profile", async () => {
    const db = openDb(":memory:");
    const genres: Record<string, number> = {};
    for (let i = 0; i < 20; i++) genres[`genre-${i}`] = i / 20;
    const { setSetting } = await import("@rmm/core");
    setSetting(db, "taste_profile", {
      genres,
      descriptors: { melancholic: 0.9, warm: 0.4 },
      eras: { "1990s": 1, "2000s": 0.5 },
      computedAt: "2026-01-01T00:00:00.000Z",
    });

    const deps = buildTestDeps({ db });
    const result = await TOOL_EXECUTORS.get_taste_profile(deps, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const data = result.data as ReturnType<typeof summarizeTasteProfile>;
    expect(data.genres).toHaveLength(15);
    expect(data.genres[0]).toEqual({ name: "genre-19", weight: 19 / 20 });
    expect(data.descriptors).toEqual([
      { name: "melancholic", weight: 0.9 },
      { name: "warm", weight: 0.4 },
    ]);
    expect(data.computedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("search_candidates", () => {
  function seed(db: ReturnType<typeof openDb>) {
    const a = seedAlbum(db, {
      rymUrl: "/release/a/",
      artist: "Have a Nice Life",
      title: "Deathconsciousness",
      year: 2008,
      genres: ["Slowcore", "Drone"],
      descriptors: ["melancholic", "bleak"],
      rymAvgRating: 3.8,
    });
    seedCandidate(db, { albumId: a, score: 0.9 });

    const b = seedAlbum(db, {
      rymUrl: "/release/b/",
      artist: "Duster",
      title: "Stratosphere",
      year: 1998,
      genres: ["Slowcore"],
      descriptors: ["hazy"],
      rymAvgRating: 3.9,
    });
    seedCandidate(db, { albumId: b, score: 0.7 });

    const c = seedAlbum(db, {
      rymUrl: "/release/c/",
      artist: "Boards of Canada",
      title: "Music Has the Right to Children",
      year: 1998,
      genres: ["IDM", "Ambient"],
      descriptors: ["nostalgic"],
      rymAvgRating: 4.2,
    });
    seedCandidate(db, { albumId: c, score: 0.95 });

    // known status, should never be returned
    const d = seedAlbum(db, { rymUrl: "/release/d/", artist: "Known Artist", title: "X" });
    seedCandidate(db, { albumId: d, score: 0.99, status: "known" });

    return { a, b, c, d };
  }

  it("filters status='new' only, and applies OR within genres / AND across genres+descriptors", async () => {
    const db = openDb(":memory:");
    seed(db);
    const deps = buildTestDeps({ db });

    const result = await TOOL_EXECUTORS.search_candidates(deps, { genres: ["slowcore"] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const artists = (result.data as { artist: string }[]).map((r) => r.artist);
    expect(artists.sort()).toEqual(["Duster", "Have a Nice Life"]);

    const combined = await TOOL_EXECUTORS.search_candidates(deps, {
      genres: ["slowcore"],
      descriptors: ["bleak"],
    });
    if (!combined.ok) throw new Error("unreachable");
    expect((combined.data as { artist: string }[]).map((r) => r.artist)).toEqual([
      "Have a Nice Life",
    ]);
  });

  it("matches via genre-method evidence when album.genres is empty (C1)", async () => {
    const db = openDb(":memory:");
    const evidenceOnly = seedAlbum(db, {
      rymUrl: "/release/evidence-only/",
      artist: "Chart Only Artist",
      title: "Chart Only Album",
      genres: [],
    });
    seedCandidate(db, {
      albumId: evidenceOnly,
      score: 0.6,
      components: {
        genre: {
          score: 0.6,
          evidence: {
            method: "genre",
            charts: [{ rymUrl: "/genre/slowcore/", genre: "Slowcore", position: 2 }],
          },
        },
      },
    });
    const deps = buildTestDeps({ db });

    const result = await TOOL_EXECUTORS.search_candidates(deps, { genres: ["slowcore"] });
    if (!result.ok) throw new Error("unreachable");
    const artists = (result.data as { artist: string }[]).map((r) => r.artist);
    expect(artists).toEqual(["Chart Only Artist"]);
  });

  it("is case-insensitive substring matching", async () => {
    const db = openDb(":memory:");
    seed(db);
    const deps = buildTestDeps({ db });
    const result = await TOOL_EXECUTORS.search_candidates(deps, { genres: ["SLOW"] });
    if (!result.ok) throw new Error("unreachable");
    expect((result.data as { artist: string }[]).length).toBe(2);
  });

  it("applies minScore", async () => {
    const db = openDb(":memory:");
    seed(db);
    const deps = buildTestDeps({ db });
    const result = await TOOL_EXECUTORS.search_candidates(deps, { minScore: 0.9 });
    if (!result.ok) throw new Error("unreachable");
    const artists = (result.data as { artist: string }[]).map((r) => r.artist).sort();
    expect(artists).toEqual(["Boards of Canada", "Have a Nice Life"]);
  });

  it("caps limit at 40 and defaults to 20", async () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 50; i++) {
      const id = seedAlbum(db, { rymUrl: `/release/${i}/`, artist: `A${i}`, title: `T${i}` });
      seedCandidate(db, { albumId: id, score: 1 - i / 1000 });
    }
    const deps = buildTestDeps({ db });

    const defaultResult = await TOOL_EXECUTORS.search_candidates(deps, {});
    if (!defaultResult.ok) throw new Error("unreachable");
    expect((defaultResult.data as unknown[]).length).toBe(20);

    const cappedResult = await TOOL_EXECUTORS.search_candidates(deps, { limit: 999 });
    if (!cappedResult.ok) throw new Error("unreachable");
    expect((cappedResult.data as unknown[]).length).toBe(40);
  });

  it("excludes candidates by artists Jim has already rated when excludeKnownArtists is set", async () => {
    const db = openDb(":memory:");
    const { a } = seed(db);
    db.prepare(
      "INSERT INTO my_ratings (album_id, rating, rated_at) VALUES (?, 5, '2026-01-01T00:00:00.000Z')",
    ).run(a);
    const deps = buildTestDeps({ db });

    const result = await TOOL_EXECUTORS.search_candidates(deps, { excludeKnownArtists: true });
    if (!result.ok) throw new Error("unreachable");
    const artists = (result.data as { artist: string }[]).map((r) => r.artist);
    expect(artists).not.toContain("Have a Nice Life");
  });

  it("includes a compact 'why' evidence line built from components", async () => {
    const db = openDb(":memory:");
    const id = seedAlbum(db, { rymUrl: "/release/x/", artist: "A", title: "T", year: 2000 });
    seedCandidate(db, {
      albumId: id,
      score: 0.5,
      components: {
        genre: {
          score: 0.5,
          evidence: {
            method: "genre",
            charts: [{ rymUrl: "/g/", genre: "Slowcore", position: 3 }],
          },
        },
      },
    });
    const deps = buildTestDeps({ db });
    const result = await TOOL_EXECUTORS.search_candidates(deps, {});
    if (!result.ok) throw new Error("unreachable");
    const data = result.data as { why: string }[];
    expect(data[0].why).toBe("#3 in Slowcore");
  });

  it("omits the position when descriptor evidence's position is 0 (M3)", async () => {
    const db = openDb(":memory:");
    const id = seedAlbum(db, { rymUrl: "/release/y/", artist: "B", title: "U", year: 2001 });
    seedCandidate(db, {
      albumId: id,
      score: 0.5,
      components: {
        descriptor: {
          score: 0.5,
          evidence: {
            method: "descriptor",
            charts: [{ rymUrl: "", descriptor: "melancholic", position: 0 }],
          },
        },
      },
    });
    const deps = buildTestDeps({ db });
    const result = await TOOL_EXECUTORS.search_candidates(deps, {});
    if (!result.ok) throw new Error("unreachable");
    const data = result.data as { why: string }[];
    expect(data[0].why).toBe('among "melancholic" picks');
  });
});

describe("scrape_genre_page", () => {
  it("slugifies the genre name", () => {
    expect(slugifyGenre("Post-Punk Revival!")).toBe("post-punk-revival");
    expect(slugifyGenre("  Slowcore  ")).toBe("slowcore");
  });

  it("scrapes, upserts, re-runs discovery, and returns the new candidate count", async () => {
    const markdown = `# Slowcore

[Some Album](https://rateyourmusic.com/release/album/some-artist/some-album/)

[Some Artist](https://rateyourmusic.com/artist/some-artist)`;
    const scraper: Scraper = {
      scrape: vi.fn().mockResolvedValue({
        url: "https://rateyourmusic.com/genre/slowcore/",
        markdown,
        links: [],
        cachePath: "/tmp/x",
        fromCache: false,
      }),
    };
    const runDiscoveryFn = vi.fn().mockResolvedValue({ candidates: 42 });
    const deps = buildTestDeps({ scraper, runDiscoveryFn });

    const result = await TOOL_EXECUTORS.scrape_genre_page(deps, { genre: "Slowcore" });
    expect(result).toEqual({ ok: true, data: { newCandidates: 42 } });
    expect(scraper.scrape).toHaveBeenCalledWith("/genre/slowcore/");
    expect(runDiscoveryFn).toHaveBeenCalledTimes(1);

    const albums = deps.db.prepare("SELECT COUNT(*) AS c FROM albums").get() as { c: number };
    expect(albums.c).toBe(1);
    const charts = deps.db.prepare("SELECT COUNT(*) AS c FROM charts").get() as { c: number };
    expect(charts.c).toBe(1);
  });

  it("returns a friendly error when the crawl budget is exhausted", async () => {
    const scraper: Scraper = {
      scrape: vi.fn().mockRejectedValue(new ScrapeBudgetError("budget exhausted")),
    };
    const deps = buildTestDeps({ scraper });
    const result = await TOOL_EXECUTORS.scrape_genre_page(deps, { genre: "slowcore" });
    expect(result).toEqual({ ok: false, error: "crawl budget exhausted today" });
  });

  it("errors when genre is missing", async () => {
    const deps = buildTestDeps();
    const result = await TOOL_EXECUTORS.scrape_genre_page(deps, {});
    expect(result).toEqual({ ok: false, error: "genre is required" });
  });
});

describe("create_playlist", () => {
  it("returns an error when spotify is not connected", async () => {
    const deps = buildTestDeps();
    const result = await TOOL_EXECUTORS.create_playlist(deps, {
      name: "Test",
      albumIds: [1, 2],
    });
    expect(result).toEqual({ ok: false, error: "spotify not connected" });
  });
});
