import type { DatabaseType } from "../db.js";

/** `max(0, (rating - 2.5)^2)` -- the shared rating->weight curve used throughout discovery. */
export function ratingWeight(rating: number): number {
  return Math.max(0, (rating - 2.5) ** 2);
}

/**
 * Albums that must never be (re-)surfaced as candidates: already rated by me, marked
 * 'known'/'disliked' via feedback, or explicitly dismissed as a candidate.
 */
export function knownAlbumIds(db: DatabaseType): Set<number> {
  const ids = new Set<number>();

  for (const row of db.prepare("SELECT album_id FROM my_ratings").all() as {
    album_id: number;
  }[]) {
    ids.add(row.album_id);
  }

  for (const row of db
    .prepare("SELECT DISTINCT album_id FROM feedback WHERE verdict IN ('known', 'disliked')")
    .all() as { album_id: number }[]) {
    ids.add(row.album_id);
  }

  for (const row of db
    .prepare("SELECT album_id FROM candidates WHERE status = 'dismissed'")
    .all() as { album_id: number }[]) {
    ids.add(row.album_id);
  }

  return ids;
}

/**
 * Normalizes a map of raw scores to [0,1] by dividing by the max value in the run.
 * If every value is 0 (or the map is empty), all outputs are 0.
 */
export function normalizeScores(raw: Map<number, number>): Map<number, number> {
  let max = 0;
  for (const value of raw.values()) {
    if (value > max) max = value;
  }
  const result = new Map<number, number>();
  for (const [id, value] of raw) {
    result.set(id, max > 0 ? value / max : 0);
  }
  return result;
}

/** `1 / (1 + position/10)` -- rewards earlier chart positions, decaying smoothly. */
export function positionDecay(position: number): number {
  return 1 / (1 + position / 10);
}
