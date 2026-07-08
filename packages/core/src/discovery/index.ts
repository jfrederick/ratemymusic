import type { DatabaseType } from "../db.js";
import { type BlendWeights, blendCandidates } from "./blend.js";

/** Mirrors config.ts's DEFAULT_BLEND_WEIGHTS -- discovery reads no env, so this is a plain literal. */
export const DEFAULT_BLEND_WEIGHTS: BlendWeights = {
  list: 0.3,
  twin: 0.25,
  genre: 0.2,
  descriptor: 0.15,
  new: 0.1,
};

/**
 * Runs the full discovery pipeline: recomputes + saves the taste profile, recomputes list
 * (and, via the twin method, twin) affinities, runs all 5 scoring methods, blends them into
 * `candidates`, and returns the current count of status='new' candidates.
 */
export async function runDiscovery(
  db: DatabaseType,
  opts?: { weights?: BlendWeights },
): Promise<{ candidates: number }> {
  const weights = opts?.weights ?? DEFAULT_BLEND_WEIGHTS;
  blendCandidates(db, weights);
  const row = db.prepare("SELECT COUNT(*) AS c FROM candidates WHERE status = 'new'").get() as {
    c: number;
  };
  return { candidates: row.c };
}

export * from "./weights.js";
export * from "./profile.js";
export * from "./listAffinity.js";
export * from "./methods.js";
export { blendCandidates, qualityPrior } from "./blend.js";
export type { BlendWeights } from "./blend.js";
