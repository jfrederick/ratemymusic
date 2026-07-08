import type { DatabaseType } from "../db.js";
import { canonicalRymUrl } from "../rym/urls.js";

export type QueueKind =
  | "collection"
  | "album"
  | "list"
  | "twin-collection"
  | "genre-page"
  | "new-music";

/** Base priority per scrape-queue kind; higher runs first. */
export const PRIORITY: Record<QueueKind, number> = {
  collection: 100,
  album: 80,
  list: 60,
  "twin-collection": 40,
  "genre-page": 30,
  "new-music": 20,
};

const MAX_ATTEMPTS = 3;

/** Enqueues a canonical url for scraping. Dedupes by url, keeping the existing row (and its status) untouched. */
export function enqueue(db: DatabaseType, url: string, kind: QueueKind, priorityBoost = 0): void {
  const canonical = canonicalRymUrl(url);
  const priority = PRIORITY[kind] + priorityBoost;
  db.prepare(
    "INSERT INTO scrape_queue (url, kind, priority) VALUES (?, ?, ?) ON CONFLICT(url) DO NOTHING",
  ).run(canonical, kind, priority);
}

/** Returns the highest-priority pending item (ties broken by lowest id), or null if the queue is drained. */
export function nextPending(db: DatabaseType): { id: number; url: string; kind: QueueKind } | null {
  const row = db
    .prepare(
      "SELECT id, url, kind FROM scrape_queue WHERE status = 'pending' ORDER BY priority DESC, id ASC LIMIT 1",
    )
    .get() as { id: number; url: string; kind: QueueKind } | undefined;
  return row ?? null;
}

export function markDone(db: DatabaseType, id: number): void {
  db.prepare("UPDATE scrape_queue SET status = 'done' WHERE id = ?").run(id);
}

/** Increments attempts; flips to 'failed' once attempts reaches MAX_ATTEMPTS, otherwise stays 'pending' for retry. */
export function markFailed(db: DatabaseType, id: number): void {
  const row = db.prepare("SELECT attempts FROM scrape_queue WHERE id = ?").get(id) as
    | { attempts: number }
    | undefined;
  if (!row) return;
  const attempts = row.attempts + 1;
  const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
  db.prepare("UPDATE scrape_queue SET attempts = ?, status = ? WHERE id = ?").run(
    attempts,
    status,
    id,
  );
}
