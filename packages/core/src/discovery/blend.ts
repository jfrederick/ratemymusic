import type { DatabaseType } from "../db.js";
import type { Evidence, MethodKey } from "../types.js";
import { computeListAffinities } from "./listAffinity.js";
import { descriptorMethod, genreMethod, listMethod, newMethod, twinMethod } from "./methods.js";
import { computeTasteProfile, saveTasteProfile } from "./profile.js";

export type BlendWeights = Record<MethodKey, number>;

const METHOD_KEYS: MethodKey[] = ["list", "twin", "genre", "descriptor", "new"];
const DIVERSITY_BONUS_PER_EXTRA_METHOD = 0.15;

/**
 * A sigmoid-ish prior blending average rating (centered at 3.5) with a confidence term derived
 * from the number of ratings (log-scaled, capped at 1 by ~10,000 ratings). An unknown average
 * rating (album not yet scraped/rated on RYM) returns a neutral-ish 0.75 rather than killing the
 * candidate. Monotonic in both avgRating and numRatings (for avgRating > 3.5); does not encode
 * specific target values.
 */
export function qualityPrior(avgRating: number | null, numRatings: number | null): number {
  if (avgRating === null) return 0.75;
  const base = 1 / (1 + Math.exp(-(avgRating - 3.5) * 2));
  const confidence = Math.min(1, Math.log10(1 + (numRatings ?? 0)) / 4);
  return 0.5 + 0.5 * (base * confidence + 0.75 * (1 - confidence));
}

type MethodResult = Map<number, { score: number; evidence: Evidence }>;

/**
 * Recomputes the taste profile + list affinities, runs all 5 scoring methods (which
 * internally recompute + persist twin affinities), blends the per-method scores into a single
 * candidate score, and upserts `candidates` -- inserting new rows (status 'new') or updating
 * score/components for existing rows without ever changing the status of a non-'new' row.
 * Candidates whose album has since been rated (or fed back as known/disliked) flip to status
 * 'known', preserving history instead of deleting the row.
 */
export function blendCandidates(db: DatabaseType, weights: BlendWeights): { written: number } {
  const profile = computeTasteProfile(db);
  saveTasteProfile(db, profile);
  computeListAffinities(db);

  const methodResults: Record<MethodKey, MethodResult> = {
    list: listMethod(db),
    twin: twinMethod(db),
    genre: genreMethod(db, profile),
    descriptor: descriptorMethod(db, profile),
    new: newMethod(db, profile),
  };

  const existing = new Map<number, { status: string }>();
  for (const row of db.prepare("SELECT album_id, status FROM candidates").all() as {
    album_id: number;
    status: string;
  }[]) {
    existing.set(row.album_id, { status: row.status });
  }

  const universe = new Set<number>(existing.keys());
  for (const m of Object.values(methodResults)) {
    for (const albumId of m.keys()) universe.add(albumId);
  }

  const albumInfoStmt = db.prepare(
    "SELECT rym_avg_rating, rym_num_ratings FROM albums WHERE id = ?",
  );
  const insertStmt = db.prepare(
    `INSERT INTO candidates (album_id, score, components, status, first_seen, updated_at)
     VALUES (?, ?, ?, 'new', ?, ?)`,
  );
  const updateStmt = db.prepare(
    "UPDATE candidates SET score = ?, components = ?, updated_at = ? WHERE album_id = ?",
  );

  const now = new Date().toISOString();
  let written = 0;

  const tx = db.transaction(() => {
    for (const albumId of universe) {
      const components: Partial<Record<MethodKey, { score: number; evidence: Evidence }>> = {};
      let raw = 0;
      let distinctMethods = 0;
      for (const key of METHOD_KEYS) {
        const m = methodResults[key].get(albumId);
        if (m && m.score > 0) {
          components[key] = m;
          raw += weights[key] * m.score;
          distinctMethods++;
        }
      }

      const hasExisting = existing.has(albumId);
      if (distinctMethods === 0 && !hasExisting) continue; // never create an empty candidate

      let score = 0;
      if (distinctMethods > 0) {
        raw *= 1 + DIVERSITY_BONUS_PER_EXTRA_METHOD * (distinctMethods - 1);
        const albumInfo = albumInfoStmt.get(albumId) as
          | { rym_avg_rating: number | null; rym_num_ratings: number | null }
          | undefined;
        score =
          raw * qualityPrior(albumInfo?.rym_avg_rating ?? null, albumInfo?.rym_num_ratings ?? null);
      }

      const componentsJson = JSON.stringify(components);
      if (!hasExisting) {
        insertStmt.run(albumId, score, componentsJson, now, now);
      } else {
        updateStmt.run(score, componentsJson, now, albumId);
      }
      written++;
    }

    // Albums I've since rated, or fed back as known/disliked, flip any existing (non-'known')
    // candidate row to status 'known' -- preserving history instead of deleting it. Dismissed
    // candidates are excluded from scoring above (via knownAlbumIds) but keep their own status.
    const newlyKnown = db
      .prepare(
        `SELECT DISTINCT album_id FROM (
           SELECT album_id FROM my_ratings
           UNION
           SELECT album_id FROM feedback WHERE verdict IN ('known', 'disliked')
         )`,
      )
      .all() as { album_id: number }[];
    const markKnownStmt = db.prepare(
      "UPDATE candidates SET status = 'known', updated_at = ? WHERE album_id = ? AND status != 'known'",
    );
    for (const { album_id: albumId } of newlyKnown) {
      markKnownStmt.run(now, albumId);
    }
  });
  tx();

  return { written };
}
