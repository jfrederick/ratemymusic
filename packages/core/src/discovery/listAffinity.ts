import type { DatabaseType } from "../db.js";
import { ratingWeight } from "./weights.js";

const MIN_RATED_OVERLAP = 2;

/**
 * `affinity(list) = (sum of ratingWeight over items I've rated) / sqrt(max(list_size, 1))`,
 * but only when at least `MIN_RATED_OVERLAP` items overlap with my ratings -- a single
 * shared item is noise, not signal. Persists the result to `lists.affinity`.
 */
export function computeListAffinities(db: DatabaseType): Map<number, number> {
  const lists = db.prepare("SELECT id FROM lists").all() as { id: number }[];
  const result = new Map<number, number>();

  const itemsStmt = db.prepare(
    `SELECT mr.rating AS rating
     FROM list_items li
     JOIN my_ratings mr ON mr.album_id = li.album_id
     WHERE li.list_id = ?`,
  );
  const sizeStmt = db.prepare("SELECT COUNT(*) AS c FROM list_items WHERE list_id = ?");
  const updateStmt = db.prepare("UPDATE lists SET affinity = ? WHERE id = ?");

  for (const { id } of lists) {
    const ratedRows = itemsStmt.all(id) as { rating: number }[];
    const size = (sizeStmt.get(id) as { c: number }).c;

    let affinity = 0;
    if (ratedRows.length >= MIN_RATED_OVERLAP) {
      const sum = ratedRows.reduce((acc, row) => acc + ratingWeight(row.rating), 0);
      affinity = sum / Math.sqrt(Math.max(size, 1));
    }

    result.set(id, affinity);
    updateStmt.run(affinity, id);
  }

  return result;
}
