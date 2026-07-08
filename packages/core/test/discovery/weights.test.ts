import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db.js";
import { knownAlbumIds, ratingWeight } from "../../src/discovery/weights.js";
import { upsertAlbum, upsertMyRating } from "../../src/ingest/upserts.js";

describe("ratingWeight", () => {
  it("matches the hand-computed table", () => {
    expect(ratingWeight(5.0)).toBeCloseTo(6.25);
    expect(ratingWeight(4.0)).toBeCloseTo(2.25);
    expect(ratingWeight(3.0)).toBeCloseTo(0.25);
    expect(ratingWeight(2.5)).toBeCloseTo(0);
    // Below 2.5 isn't ingested in practice, but the formula is defined everywhere:
    // (2.0 - 2.5)^2 = 0.25, and max(0, 0.25) = 0.25 (never clamped to 0 by the floor).
    expect(ratingWeight(2.0)).toBeCloseTo(0.25);
  });
});

const ALBUM_A = {
  rymUrl: "/release/album/a/a/",
  artist: "A",
  title: "A",
  year: 2000,
};
const ALBUM_B = {
  rymUrl: "/release/album/b/b/",
  artist: "B",
  title: "B",
  year: 2001,
};
const ALBUM_C = {
  rymUrl: "/release/album/c/c/",
  artist: "C",
  title: "C",
  year: 2002,
};

describe("knownAlbumIds", () => {
  it("includes albums with a my_ratings row", () => {
    const db = openDb(":memory:");
    const a = upsertAlbum(db, ALBUM_A);
    const b = upsertAlbum(db, ALBUM_B);
    upsertMyRating(db, a, 4.5, "2024-01-01");
    const known = knownAlbumIds(db);
    expect(known.has(a)).toBe(true);
    expect(known.has(b)).toBe(false);
  });

  it("includes albums with a feedback verdict of known or disliked, but not liked", () => {
    const db = openDb(":memory:");
    const a = upsertAlbum(db, ALBUM_A);
    const b = upsertAlbum(db, ALBUM_B);
    const c = upsertAlbum(db, ALBUM_C);
    db.prepare("INSERT INTO feedback (album_id, verdict, at) VALUES (?, 'known', ?)").run(
      a,
      "2024-01-01",
    );
    db.prepare("INSERT INTO feedback (album_id, verdict, at) VALUES (?, 'disliked', ?)").run(
      b,
      "2024-01-01",
    );
    db.prepare("INSERT INTO feedback (album_id, verdict, at) VALUES (?, 'liked', ?)").run(
      c,
      "2024-01-01",
    );
    const known = knownAlbumIds(db);
    expect(known.has(a)).toBe(true);
    expect(known.has(b)).toBe(true);
    expect(known.has(c)).toBe(false);
  });

  it("includes albums with a dismissed candidates row, but not other statuses", () => {
    const db = openDb(":memory:");
    const a = upsertAlbum(db, ALBUM_A);
    const b = upsertAlbum(db, ALBUM_B);
    db.prepare(
      "INSERT INTO candidates (album_id, score, status, first_seen, updated_at) VALUES (?, 0.5, 'dismissed', '2024-01-01', '2024-01-01')",
    ).run(a);
    db.prepare(
      "INSERT INTO candidates (album_id, score, status, first_seen, updated_at) VALUES (?, 0.5, 'new', '2024-01-01', '2024-01-01')",
    ).run(b);
    const known = knownAlbumIds(db);
    expect(known.has(a)).toBe(true);
    expect(known.has(b)).toBe(false);
  });
});
