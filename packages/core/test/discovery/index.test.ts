import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db.js";
import { runDiscovery } from "../../src/discovery/index.js";
import {
  replaceListItems,
  upsertAlbum,
  upsertList,
  upsertMyRating,
} from "../../src/ingest/upserts.js";
import { getSetting } from "../../src/settings.js";
import type { TasteProfile } from "../../src/types.js";

describe("runDiscovery", () => {
  it("end-to-end: seeds a small graph, blends candidates, and persists the taste profile", async () => {
    const db = openDb(":memory:");

    const rated1 = upsertAlbum(db, {
      rymUrl: "/release/album/rated1/rated1/",
      artist: "Rated One",
      title: "Rated One",
      year: 1993,
      genres: ["Slowcore"],
    });
    const rated2 = upsertAlbum(db, {
      rymUrl: "/release/album/rated2/rated2/",
      artist: "Rated Two",
      title: "Rated Two",
      year: 1994,
      genres: ["Slowcore"],
    });
    upsertMyRating(db, rated1, 5.0, "2020-01-01");
    upsertMyRating(db, rated2, 4.5, "2020-01-02");

    const candidateAlbum = upsertAlbum(db, {
      rymUrl: "/release/album/candidate/candidate/",
      artist: "Candidate",
      title: "Candidate",
      year: 1995,
      genres: ["Slowcore"],
    });

    const listId = upsertList(db, {
      rymUrl: "/list/someone/favorites/",
      title: "Favorites",
      author: "someone",
    });
    replaceListItems(db, listId, [candidateAlbum, rated1, rated2]);

    const result = await runDiscovery(db);

    expect(result.candidates).toBeGreaterThan(0);

    const row = db
      .prepare("SELECT status FROM candidates WHERE album_id = ?")
      .get(candidateAlbum) as { status: string } | undefined;
    expect(row?.status).toBe("new");

    const profile = getSetting<TasteProfile>(db, "taste_profile");
    expect(profile).not.toBeNull();
    expect(profile?.genres.Slowcore).toBeCloseTo(1);
  });

  it("accepts custom blend weights", async () => {
    const db = openDb(":memory:");
    const result = await runDiscovery(db, {
      weights: { list: 1, twin: 0, genre: 0, descriptor: 0, new: 0 },
    });
    expect(result.candidates).toBe(0); // empty graph -> no candidates, but shouldn't throw
  });
});
