import type { DatabaseType } from "../db.js";
import { getSetting, setSetting } from "../settings.js";
import type { TasteProfile } from "../types.js";
import { ratingWeight } from "./weights.js";

const TASTE_PROFILE_SETTING_KEY = "taste_profile";

function decadeOf(year: number): string {
  return `${Math.floor(year / 10) * 10}s`;
}

/** Normalizes a plain accumulation map so its max value is 1 (empty map is left as-is). */
function normalizeMap(map: Record<string, number>): Record<string, number> {
  let max = 0;
  for (const value of Object.values(map)) {
    if (value > max) max = value;
  }
  if (max === 0) return map;
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(map)) {
    result[key] = value / max;
  }
  return result;
}

function addWeighted(map: Record<string, number>, key: string, weight: number): void {
  map[key] = (map[key] ?? 0) + weight;
}

type RatedRow = {
  rating: number;
  year: number | null;
  genres: string;
  descriptors: string;
};

/**
 * Builds the caller's taste profile from every `my_ratings` row: weighted (by `ratingWeight`)
 * counts over genres, descriptors, and decade-buckets, each normalized so the max value is 1.
 */
export function computeTasteProfile(db: DatabaseType): TasteProfile {
  const rows = db
    .prepare(
      `SELECT mr.rating AS rating, a.year AS year, a.genres AS genres, a.descriptors AS descriptors
       FROM my_ratings mr
       JOIN albums a ON a.id = mr.album_id`,
    )
    .all() as RatedRow[];

  const genres: Record<string, number> = {};
  const descriptors: Record<string, number> = {};
  const eras: Record<string, number> = {};

  for (const row of rows) {
    const weight = ratingWeight(row.rating);
    for (const genre of JSON.parse(row.genres) as string[]) {
      addWeighted(genres, genre, weight);
    }
    for (const descriptor of JSON.parse(row.descriptors) as string[]) {
      addWeighted(descriptors, descriptor, weight);
    }
    if (row.year !== null) {
      addWeighted(eras, decadeOf(row.year), weight);
    }
  }

  return {
    genres: normalizeMap(genres),
    descriptors: normalizeMap(descriptors),
    eras: normalizeMap(eras),
    computedAt: new Date().toISOString(),
  };
}

export function saveTasteProfile(db: DatabaseType, profile: TasteProfile): void {
  setSetting(db, TASTE_PROFILE_SETTING_KEY, profile);
}

export function loadTasteProfile(db: DatabaseType): TasteProfile | null {
  return getSetting<TasteProfile>(db, TASTE_PROFILE_SETTING_KEY);
}
