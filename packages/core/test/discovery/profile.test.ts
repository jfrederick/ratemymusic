import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db.js";
import {
  computeTasteProfile,
  loadTasteProfile,
  saveTasteProfile,
} from "../../src/discovery/profile.js";
import { upsertAlbum, upsertMyRating } from "../../src/ingest/upserts.js";

describe("computeTasteProfile", () => {
  it("hand-computed: two rated albums produce weighted, normalized genre/era maps", () => {
    const db = openDb(":memory:");
    const a = upsertAlbum(db, {
      rymUrl: "/release/album/a/a/",
      artist: "A",
      title: "A",
      year: 1993,
      genres: ["A", "B"],
    });
    const b = upsertAlbum(db, {
      rymUrl: "/release/album/b/b/",
      artist: "B",
      title: "B",
      year: 2007,
      genres: ["B"],
    });
    upsertMyRating(db, a, 5.0, "2020-01-01");
    upsertMyRating(db, b, 3.0, "2020-01-02");

    const profile = computeTasteProfile(db);

    // raw: A=6.25, B=6.25+0.25=6.5 -> normalized by max (6.5)
    expect(profile.genres.A).toBeCloseTo(6.25 / 6.5);
    expect(profile.genres.B).toBeCloseTo(1);

    // raw: 1990s=6.25, 2000s=0.25 -> normalized by max (6.25)
    expect(profile.eras["1990s"]).toBeCloseTo(1);
    expect(profile.eras["2000s"]).toBeCloseTo(0.25 / 6.25);

    expect(typeof profile.computedAt).toBe("string");
    expect(new Date(profile.computedAt).toString()).not.toBe("Invalid Date");
  });

  it("returns empty maps when there are no ratings", () => {
    const db = openDb(":memory:");
    const profile = computeTasteProfile(db);
    expect(profile.genres).toEqual({});
    expect(profile.descriptors).toEqual({});
    expect(profile.eras).toEqual({});
  });

  it("skips albums with a null year for era bucketing but still counts genres/descriptors", () => {
    const db = openDb(":memory:");
    const a = upsertAlbum(db, {
      rymUrl: "/release/album/a/a/",
      artist: "A",
      title: "A",
      year: null,
      genres: ["A"],
      descriptors: ["moody"],
    });
    upsertMyRating(db, a, 4.0, "2020-01-01");

    const profile = computeTasteProfile(db);
    expect(profile.eras).toEqual({});
    expect(profile.genres.A).toBeCloseTo(1);
    expect(profile.descriptors.moody).toBeCloseTo(1);
  });
});

describe("saveTasteProfile / loadTasteProfile", () => {
  it("round-trips through settings", () => {
    const db = openDb(":memory:");
    expect(loadTasteProfile(db)).toBeNull();

    const profile = computeTasteProfile(db);
    saveTasteProfile(db, profile);

    const loaded = loadTasteProfile(db);
    expect(loaded).toEqual(profile);
  });
});
