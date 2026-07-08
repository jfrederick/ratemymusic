export * from "./types.js";
export { loadConfig } from "./config.js";
export type { Config } from "./config.js";
export { openDb } from "./db.js";
export type { DatabaseType } from "./db.js";
export { getSetting, setSetting } from "./settings.js";
export { BudgetLedger, BudgetExceededError } from "./budget.js";

// RYM url helpers
export {
  absoluteRymUrl,
  canonicalRymUrl,
  collectionUrl,
  genrePageUrl,
  genreSlugFromUrl,
  newMusicUrl,
} from "./rym/urls.js";
export type { CollectionTier } from "./rym/urls.js";

// RYM page parsers
export { ParseError } from "./rym/parse/errors.js";
export {
  extractLinks,
  extractNextPageUrl,
  extractReleaseItems,
  splitTableRow,
} from "./rym/parse/markdown.js";
export type { MdLink, ReleaseItem } from "./rym/parse/markdown.js";
export { parseCollectionPage } from "./rym/parse/collection.js";
export type { CollectionItem, CollectionPage } from "./rym/parse/collection.js";
export { parseAlbumPage } from "./rym/parse/album.js";
export type { AlbumPage } from "./rym/parse/album.js";
export { parseListPage } from "./rym/parse/list.js";
export type { ListPage } from "./rym/parse/list.js";
export { parseGenrePage } from "./rym/parse/genre.js";
export type { GenrePage } from "./rym/parse/genre.js";
export { parseNewMusicPage } from "./rym/parse/newMusic.js";
export type { NewMusicPage } from "./rym/parse/newMusic.js";

// Firecrawl scraper client
export {
  FirecrawlScraper,
  ScrapeBudgetError,
  ScrapeFailedError,
  firecrawlApiKeyFromCli,
} from "./scrape/firecrawl.js";
export type { FirecrawlScraperOptions, ScrapeBudget } from "./scrape/firecrawl.js";
