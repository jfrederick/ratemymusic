export * from "./types.js";
export { loadConfig } from "./config.js";
export type { Config } from "./config.js";
export { openDb } from "./db.js";
export type { DatabaseType } from "./db.js";
export { resolveRepoPath } from "./paths.js";
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

// Ingest pipeline
export {
  replaceChartItems,
  replaceListItems,
  stampAlbumGenreIfEmpty,
  upsertAlbum,
  upsertChart,
  upsertList,
  upsertMyRating,
  upsertTwin,
  upsertTwinRating,
} from "./ingest/upserts.js";
export type { ChartUpsert, ListUpsert } from "./ingest/upserts.js";
export { PRIORITY, enqueue, markDone, markFailed, nextPending } from "./ingest/frontier.js";
export type { QueueKind } from "./ingest/frontier.js";
export { TTL_DAYS } from "./ingest/ttl.js";
export { runSync } from "./ingest/sync.js";
export type { SyncOptions, SyncReport } from "./ingest/sync.js";

// Spotify integration
export { generateVerifier, challengeFromVerifier, buildAuthorizeUrl } from "./spotify/pkce.js";
export { SpotifyAuth, SpotifyAuthError, SpotifyClient, SpotifyApiError } from "./spotify/client.js";
export { resolveAlbum } from "./spotify/resolve.js";
export { pickTracks } from "./spotify/pick.js";
export {
  buildAndPushPlaylist,
  rollingPlaylistId,
  setRollingPlaylistId,
} from "./spotify/playlist.js";
export type {
  BuildAndPushPlaylistOptions,
  BuildAndPushPlaylistResult,
  RollingPlaylistKey,
} from "./spotify/playlist.js";
export { pushDaily } from "./spotify/daily.js";

// Discovery engine
export {
  ratingWeight,
  knownAlbumIds,
  normalizeScores,
  positionDecay,
} from "./discovery/weights.js";
export {
  computeTasteProfile,
  saveTasteProfile,
  loadTasteProfile,
} from "./discovery/profile.js";
export { computeListAffinities } from "./discovery/listAffinity.js";
export {
  listMethod,
  twinMethod,
  genreMethod,
  descriptorMethod,
  newMethod,
} from "./discovery/methods.js";
export { blendCandidates, qualityPrior } from "./discovery/blend.js";
export type { BlendWeights } from "./discovery/blend.js";
export { runDiscovery, DEFAULT_BLEND_WEIGHTS } from "./discovery/index.js";
