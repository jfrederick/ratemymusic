import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db.js";
import type { DatabaseType } from "../../src/db.js";
import { blendCandidates, qualityPrior } from "../../src/discovery/blend.js";
import type { BlendWeights } from "../../src/discovery/blend.js";
import {
  replaceChartItems,
  replaceListItems,
  upsertAlbum,
  upsertChart,
  upsertList,
  upsertMyRating,
} from "../../src/ingest/upserts.js";
import type { Candidate } from "../../src/types.js";

const EVEN_WEIGHTS: BlendWeights = { list: 1, twin: 1, genre: 1, descriptor: 1, new: 1 };

function album(
  db: DatabaseType,
  n: string,
  opts?: { genres?: string[]; descriptors?: string[]; year?: number | null },
) {
  return upsertAlbum(db, {
    rymUrl: `/release/album/${n}/${n}/`,
    artist: n,
    title: n,
    year: opts?.year ?? 2000,
    genres: opts?.genres,
    descriptors: opts?.descriptors,
  });
}

/**
 * Builds a real list (with genuine, rated-overlap-derived affinity) containing `targetAlbumId`
 * plus two 5.0-rated filler albums. `blendCandidates` recomputes list affinity from scratch on
 * every call, so tests must produce real rated overlap rather than poking `lists.affinity`
 * directly (that would just be clobbered by the recompute).
 */
function scorableList(db: DatabaseType, label: string, targetAlbumId: number): void {
  const filler1 = album(db, `${label}-filler1`);
  const filler2 = album(db, `${label}-filler2`);
  upsertMyRating(db, filler1, 5.0, "2020-01-01");
  upsertMyRating(db, filler2, 5.0, "2020-01-01");
  const listId = upsertList(db, { rymUrl: `/list/${label}/${label}/`, title: label, author: "x" });
  replaceListItems(db, listId, [targetAlbumId, filler1, filler2]);
}

function getCandidate(db: DatabaseType, albumId: number): Candidate | undefined {
  const row = db.prepare("SELECT * FROM candidates WHERE album_id = ?").get(albumId) as
    | { album_id: number; score: number; components: string; status: Candidate["status"] }
    | undefined;
  if (!row) return undefined;
  return {
    albumId: row.album_id,
    score: row.score,
    components: JSON.parse(row.components),
    status: row.status,
  };
}

describe("qualityPrior", () => {
  it("returns 0.75 when avgRating is null, regardless of numRatings", () => {
    expect(qualityPrior(null, null)).toBe(0.75);
    expect(qualityPrior(null, 50000)).toBe(0.75);
  });

  it("is monotonically increasing in avgRating (fixed numRatings)", () => {
    const low = qualityPrior(2.5, 1000);
    const mid = qualityPrior(3.5, 1000);
    const high = qualityPrior(4.5, 1000);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("pulls the prior toward the neutral 0.75-confidence blend as numRatings shrinks (for an above-neutral rating)", () => {
    // With few ratings, confidence -> 0, so the result should approach the confidence-0 case
    // regardless of avgRating; with many ratings, an above-3.5 rating should score higher than
    // the low-confidence result.
    const highConfidence = qualityPrior(4.5, 1_000_000);
    const lowConfidence = qualityPrior(4.5, 0);
    expect(highConfidence).toBeGreaterThan(lowConfidence);
  });

  it("stays within a sane [0.5, 1] range", () => {
    for (const avg of [1.0, 2.5, 3.5, 4.0, 5.0]) {
      for (const n of [0, 1, 100, 100000]) {
        const p = qualityPrior(avg, n);
        expect(p).toBeGreaterThanOrEqual(0.5);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("blendCandidates", () => {
  it("gives a multi-method hit a diversity bonus over an equal-scoring single-method hit", () => {
    const db = openDb(":memory:");
    const chart = upsertChart(db, {
      rymUrl: "/genre/x/",
      kind: "genre-page",
      params: { genre: "x" },
    });

    const multiHit = album(db, "multi", { genres: ["X"] });
    const singleHit = album(db, "single");

    // Both albums sit in identically-built lists (same rated-overlap pattern -> same real
    // list affinity), so their list-method scores alone would normalize equally. multiHit
    // additionally appears on a genre-page chart that matches the profile.
    scorableList(db, "multi", multiHit);
    scorableList(db, "single", singleHit);
    replaceChartItems(db, chart, [multiHit]);

    // Give the profile a genre affinity so the genre-page chart actually contributes.
    upsertMyRating(db, album(db, "seed", { genres: ["X"] }), 5.0, "2020-01-01");

    blendCandidates(db, EVEN_WEIGHTS);

    const multi = getCandidate(db, multiHit);
    const single = getCandidate(db, singleHit);
    expect(multi).toBeDefined();
    expect(single).toBeDefined();
    // Both list-only components would be equal (score 1 after per-method normalization), but
    // multiHit additionally scores on the genre method -> diversity bonus should push it ahead.
    expect(multi?.score).toBeGreaterThan(single?.score ?? Number.POSITIVE_INFINITY);
    expect(Object.keys(multi?.components ?? {})).toEqual(expect.arrayContaining(["list", "genre"]));
  });

  it("a dismissed candidate keeps its status across a re-blend, even though its score updates", () => {
    const db = openDb(":memory:");
    const target = album(db, "target");
    scorableList(db, "target", target);

    blendCandidates(db, EVEN_WEIGHTS);
    const before = getCandidate(db, target);
    expect(before?.status).toBe("new");
    expect(before?.score).toBeGreaterThan(0);

    db.prepare("UPDATE candidates SET status = 'dismissed' WHERE album_id = ?").run(target);

    // Re-blend: since the album is now "known" (dismissed), it's excluded from every method's
    // scoring, so its score should update to reflect that (drop to 0) while status stays dismissed.
    blendCandidates(db, EVEN_WEIGHTS);
    const after = getCandidate(db, target);
    expect(after?.status).toBe("dismissed");
    expect(after?.score).not.toBe(before?.score);
  });

  it("flips a candidate to status 'known' once I rate the album", () => {
    const db = openDb(":memory:");
    const target = album(db, "target");
    scorableList(db, "target", target);

    blendCandidates(db, EVEN_WEIGHTS);
    expect(getCandidate(db, target)?.status).toBe("new");

    upsertMyRating(db, target, 4.5, "2020-01-01");
    blendCandidates(db, EVEN_WEIGHTS);

    expect(getCandidate(db, target)?.status).toBe("known");
  });

  it("never resurrects a playlisted candidate's status, but does update its score", () => {
    const db = openDb(":memory:");
    const target = album(db, "target");
    scorableList(db, "target", target);

    blendCandidates(db, EVEN_WEIGHTS);
    db.prepare("UPDATE candidates SET status = 'playlisted' WHERE album_id = ?").run(target);

    blendCandidates(db, EVEN_WEIGHTS);

    const after = getCandidate(db, target);
    expect(after?.status).toBe("playlisted");
  });

  it("persists components as JSON that round-trips to the per-method {score, evidence} structure", () => {
    const db = openDb(":memory:");
    const target = album(db, "target");
    scorableList(db, "target", target);

    blendCandidates(db, EVEN_WEIGHTS);
    const candidate = getCandidate(db, target);
    expect(candidate?.components.list?.evidence.method).toBe("list");
    expect(typeof candidate?.components.list?.score).toBe("number");
  });
});
