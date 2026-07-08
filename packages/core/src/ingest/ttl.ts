import type { QueueKind } from "./frontier.js";

/** Cache freshness window (in days) per scrape-queue kind, passed as `maxAgeDays` to the Scraper. */
export const TTL_DAYS: Record<QueueKind, number> = {
  collection: 7,
  album: 90,
  list: 30,
  "twin-collection": 7,
  "genre-page": 7,
  "new-music": 1,
};
