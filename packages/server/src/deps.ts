import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BudgetLedger,
  type Config,
  type DatabaseType,
  FirecrawlScraper,
  type Scraper,
  SpotifyAuth,
  SpotifyClient,
  type SpotifyClient as SpotifyClientType,
  type buildAndPushPlaylist,
  firecrawlApiKeyFromCli,
  loadConfig,
  openDb,
  type pushDaily,
  type runDiscovery,
  type runSync,
} from "@rmm/core";
import { config as loadDotenv } from "dotenv";

export type AppDeps = {
  db: DatabaseType;
  config: Config;
  scraper: Scraper;
  spotifyAuth: {
    startAuth(): { url: string; state: string };
    handleCallback(p: { code: string; state: string }): Promise<void>;
    isConnected(): boolean;
  };
  spotify: SpotifyClientType | null;
  budget: BudgetLedger;
  runSyncFn?: typeof runSync;
  runDiscoveryFn?: typeof runDiscovery;
  pushDailyFn?: typeof pushDaily;
  buildAndPushPlaylistFn?: typeof buildAndPushPlaylist;
};

// This file lives at packages/server/src/deps.ts; walk up to the repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function resolveFromRoot(path: string): string {
  if (path === ":memory:") return path;
  return isAbsolute(path) ? path : join(REPO_ROOT, path);
}

/** Scraper stub used when no Firecrawl API key is configured -- the server still boots, but any sync attempt fails clearly. */
class MissingFirecrawlKeyScraper implements Scraper {
  async scrape(): Promise<never> {
    throw new Error(
      "FIRECRAWL_API_KEY missing: set it in the environment/.env, or sign in via the firecrawl-cli.",
    );
  }
}

/** Real production wiring for AppDeps: loads .env, opens the db, and constructs every collaborator. */
export function buildDeps(env: NodeJS.ProcessEnv = process.env): AppDeps {
  loadDotenv({ path: join(REPO_ROOT, ".env"), quiet: true });

  const config = loadConfig(env);
  const db = openDb(resolveFromRoot(config.dbPath));
  const budget = new BudgetLedger(db, { daily: config.budgetDaily, initial: config.budgetInitial });

  const apiKey = config.firecrawlApiKey ?? firecrawlApiKeyFromCli();
  const scraper: Scraper = apiKey
    ? new FirecrawlScraper({ apiKey, cacheDir: resolveFromRoot("data/cache"), budget })
    : new MissingFirecrawlKeyScraper();

  const spotifyAuth = new SpotifyAuth({
    db,
    clientId: config.spotifyClientId,
    redirectUri: `http://127.0.0.1:${config.port}/callback`,
  });
  // SpotifyClient only fails at call time (when a token can't be obtained), so it's safe to
  // always construct it -- no need to gate on isConnected() here.
  const spotify = new SpotifyClient({ auth: spotifyAuth });

  return { db, config, scraper, spotifyAuth, spotify, budget };
}
