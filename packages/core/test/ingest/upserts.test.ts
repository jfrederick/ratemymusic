import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db.js";
import {
  replaceChartItems,
  replaceListItems,
  stampAlbumGenreIfEmpty,
  upsertAlbum,
  upsertChart,
  upsertList,
  upsertMyRating,
  upsertTwin,
  upsertTwinRating,
} from "../../src/ingest/upserts.js";

const FOR_EMMA = {
  rymUrl: "/release/album/bon-iver/for-emma-forever-ago/",
  artist: "Bon Iver",
  title: "For Emma, Forever Ago",
  year: 2007,
};

describe("upserts: albums", () => {
  it("inserts a new album and returns its id", () => {
    const db = openDb(":memory:");
    const id = upsertAlbum(db, FOR_EMMA);
    expect(typeof id).toBe("number");

    const row = db.prepare("SELECT * FROM albums WHERE id = ?").get(id) as Record<string, unknown>;
    expect(row).toMatchObject({
      rym_url: FOR_EMMA.rymUrl,
      artist: "Bon Iver",
      title: "For Emma, Forever Ago",
      year: 2007,
      genres: "[]",
      descriptors: "[]",
    });
  });

  it("insert-then-enrich: a second call adding genres doesn't null the artist, and returns the same id", () => {
    const db = openDb(":memory:");
    const id1 = upsertAlbum(db, FOR_EMMA);
    const id2 = upsertAlbum(db, {
      ...FOR_EMMA,
      genres: ["Indie Folk", "Singer-Songwriter"],
      rymAvgRating: 3.82,
      rymNumRatings: 27931,
      scrapedAt: "2026-07-08T00:00:00.000Z",
    });

    expect(id2).toBe(id1);

    const row = db.prepare("SELECT * FROM albums WHERE id = ?").get(id1) as Record<string, unknown>;
    expect(row.artist).toBe("Bon Iver");
    expect(row.title).toBe("For Emma, Forever Ago");
    expect(JSON.parse(row.genres as string)).toEqual(["Indie Folk", "Singer-Songwriter"]);
    expect(row.rym_avg_rating).toBe(3.82);
    expect(row.rym_num_ratings).toBe(27931);
    expect(row.scraped_at).toBe("2026-07-08T00:00:00.000Z");
  });

  it("never nulls existing enrichment data when a later call omits it", () => {
    const db = openDb(":memory:");
    const id = upsertAlbum(db, { ...FOR_EMMA, genres: ["Indie Folk"], rymAvgRating: 3.82 });
    // Re-upsert from a bare collection-page sighting (no enrichment fields).
    upsertAlbum(db, FOR_EMMA);

    const row = db.prepare("SELECT * FROM albums WHERE id = ?").get(id) as Record<string, unknown>;
    expect(JSON.parse(row.genres as string)).toEqual(["Indie Folk"]);
    expect(row.rym_avg_rating).toBe(3.82);
  });

  it("does not overwrite year with null on re-upsert", () => {
    const db = openDb(":memory:");
    const id = upsertAlbum(db, FOR_EMMA);
    upsertAlbum(db, { ...FOR_EMMA, year: null });
    const row = db.prepare("SELECT year FROM albums WHERE id = ?").get(id) as { year: number };
    expect(row.year).toBe(2007);
  });

  it("does not overwrite non-empty genres/descriptors with an empty array on re-upsert", () => {
    const db = openDb(":memory:");
    const id = upsertAlbum(db, { ...FOR_EMMA, genres: ["A"] });
    upsertAlbum(db, { ...FOR_EMMA, genres: [] });

    const row = db.prepare("SELECT genres FROM albums WHERE id = ?").get(id) as {
      genres: string;
    };
    expect(JSON.parse(row.genres)).toEqual(["A"]);

    upsertAlbum(db, { ...FOR_EMMA, genres: ["B"] });
    const row2 = db.prepare("SELECT genres FROM albums WHERE id = ?").get(id) as {
      genres: string;
    };
    expect(JSON.parse(row2.genres)).toEqual(["B"]);
  });
});

describe("stampAlbumGenreIfEmpty", () => {
  it("stamps a single-element genres array when the album currently has none", () => {
    const db = openDb(":memory:");
    const id = upsertAlbum(db, FOR_EMMA);
    stampAlbumGenreIfEmpty(db, id, "Slowcore");
    const row = db.prepare("SELECT genres FROM albums WHERE id = ?").get(id) as {
      genres: string;
    };
    expect(JSON.parse(row.genres)).toEqual(["Slowcore"]);
  });

  it("does not overwrite an album that already has genres", () => {
    const db = openDb(":memory:");
    const id = upsertAlbum(db, { ...FOR_EMMA, genres: ["Indie Folk", "Singer-Songwriter"] });
    stampAlbumGenreIfEmpty(db, id, "Slowcore");
    const row = db.prepare("SELECT genres FROM albums WHERE id = ?").get(id) as {
      genres: string;
    };
    expect(JSON.parse(row.genres)).toEqual(["Indie Folk", "Singer-Songwriter"]);
  });

  it("a later, richer upsertAlbum call still overwrites the stamp", () => {
    const db = openDb(":memory:");
    const id = upsertAlbum(db, FOR_EMMA);
    stampAlbumGenreIfEmpty(db, id, "Slowcore");
    upsertAlbum(db, { ...FOR_EMMA, genres: ["Indie Folk", "Singer-Songwriter"] });
    const row = db.prepare("SELECT genres FROM albums WHERE id = ?").get(id) as {
      genres: string;
    };
    expect(JSON.parse(row.genres)).toEqual(["Indie Folk", "Singer-Songwriter"]);
  });

  it("is a no-op for an unknown album id", () => {
    const db = openDb(":memory:");
    expect(() => stampAlbumGenreIfEmpty(db, 999999, "Slowcore")).not.toThrow();
  });
});

describe("upserts: my_ratings", () => {
  it("upserts a rating for an album, updating rating/ratedAt on conflict", () => {
    const db = openDb(":memory:");
    const albumId = upsertAlbum(db, FOR_EMMA);
    upsertMyRating(db, albumId, 4.5, "2020-01-01");
    upsertMyRating(db, albumId, 5.0, "2021-02-02");

    const row = db.prepare("SELECT * FROM my_ratings WHERE album_id = ?").get(albumId) as Record<
      string,
      unknown
    >;
    expect(row.rating).toBe(5.0);
    expect(row.rated_at).toBe("2021-02-02");
  });
});

describe("upserts: lists", () => {
  it("inserts a list and returns its id, updating title/author on conflict", () => {
    const db = openDb(":memory:");
    const id1 = upsertList(db, {
      rymUrl: "/list/gentlemancritic/dark-winter/",
      title: "Dark Winter",
      author: "GentlemanCritic",
      numItems: 45,
    });
    const id2 = upsertList(db, {
      rymUrl: "/list/gentlemancritic/dark-winter/",
      title: "Dark Winter (updated)",
      author: "GentlemanCritic",
      scrapedAt: "2026-07-08",
    });
    expect(id2).toBe(id1);

    const row = db.prepare("SELECT * FROM lists WHERE id = ?").get(id1) as Record<string, unknown>;
    expect(row.title).toBe("Dark Winter (updated)");
    expect(row.scraped_at).toBe("2026-07-08");
    // numItems from the first call isn't nulled by the second call omitting it.
    expect(row.num_items).toBe(45);
  });

  it("replaceListItems sets positions by array index and is idempotent", () => {
    const db = openDb(":memory:");
    const listId = upsertList(db, {
      rymUrl: "/list/x/y/",
      title: "X",
      author: "x",
    });
    const a1 = upsertAlbum(db, FOR_EMMA);
    const a2 = upsertAlbum(db, {
      rymUrl: "/release/album/slowdive/souvlaki/",
      artist: "Slowdive",
      title: "Souvlaki",
      year: 1993,
    });

    replaceListItems(db, listId, [a1, a2]);
    replaceListItems(db, listId, [a1, a2]);

    const rows = db
      .prepare("SELECT album_id, position FROM list_items WHERE list_id = ? ORDER BY position")
      .all(listId) as { album_id: number; position: number }[];
    expect(rows).toEqual([
      { album_id: a1, position: 0 },
      { album_id: a2, position: 1 },
    ]);
  });

  it("replaceListItems replaces (not appends) on a later call with a different set", () => {
    const db = openDb(":memory:");
    const listId = upsertList(db, { rymUrl: "/list/x/y/", title: "X", author: "x" });
    const a1 = upsertAlbum(db, FOR_EMMA);
    const a2 = upsertAlbum(db, {
      rymUrl: "/release/album/slowdive/souvlaki/",
      artist: "Slowdive",
      title: "Souvlaki",
      year: 1993,
    });

    replaceListItems(db, listId, [a1]);
    replaceListItems(db, listId, [a1, a2]);

    const rows = db.prepare("SELECT album_id FROM list_items WHERE list_id = ?").all(listId) as {
      album_id: number;
    }[];
    expect(rows).toHaveLength(2);
  });
});

describe("upserts: twins", () => {
  it("upsertTwin is idempotent", () => {
    const db = openDb(":memory:");
    upsertTwin(db, "JesseAaron");
    upsertTwin(db, "JesseAaron");
    const rows = db.prepare("SELECT username FROM twins").all();
    expect(rows).toEqual([{ username: "JesseAaron" }]);
  });

  it("upsertTwinRating upserts rating on conflict", () => {
    const db = openDb(":memory:");
    upsertTwin(db, "JesseAaron");
    const albumId = upsertAlbum(db, FOR_EMMA);
    upsertTwinRating(db, "JesseAaron", albumId, 4.0);
    upsertTwinRating(db, "JesseAaron", albumId, 5.0);

    const row = db
      .prepare("SELECT rating FROM twin_ratings WHERE username = ? AND album_id = ?")
      .get("JesseAaron", albumId) as { rating: number };
    expect(row.rating).toBe(5.0);
  });
});

describe("upserts: charts", () => {
  it("upserts a chart and returns its id", () => {
    const db = openDb(":memory:");
    const id1 = upsertChart(db, {
      rymUrl: "/genre/slowcore/",
      kind: "genre-page",
      params: { genre: "slowcore" },
    });
    const id2 = upsertChart(db, {
      rymUrl: "/genre/slowcore/",
      kind: "genre-page",
      params: { genre: "slowcore" },
      scrapedAt: "2026-07-08",
    });
    expect(id2).toBe(id1);

    const row = db.prepare("SELECT * FROM charts WHERE id = ?").get(id1) as Record<string, unknown>;
    expect(row.kind).toBe("genre-page");
    expect(JSON.parse(row.params as string)).toEqual({ genre: "slowcore" });
    expect(row.scraped_at).toBe("2026-07-08");
  });

  it("replaceChartItems sets positions by array index and is idempotent", () => {
    const db = openDb(":memory:");
    const chartId = upsertChart(db, { rymUrl: "/genre/slowcore/", kind: "genre-page" });
    const a1 = upsertAlbum(db, FOR_EMMA);
    replaceChartItems(db, chartId, [a1]);
    replaceChartItems(db, chartId, [a1]);

    const rows = db
      .prepare("SELECT album_id, position FROM chart_items WHERE chart_id = ?")
      .all(chartId);
    expect(rows).toEqual([{ album_id: a1, position: 0 }]);
  });
});
