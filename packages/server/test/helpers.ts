import {
  BudgetLedger,
  type Config,
  type DatabaseType,
  type Scraper,
  loadConfig,
  openDb,
} from "@rmm/core";
import type { AppDeps } from "../src/deps.js";

/** Scraper fake for tests that never expect a real scrape to happen. */
export class FakeScraper implements Scraper {
  async scrape(): Promise<never> {
    throw new Error("FakeScraper: scrape() should not be called in this test");
  }
}

/** Fake Spotify OAuth wiring: `state` must be "fake-state" for handleCallback to succeed. */
export function fakeSpotifyAuth(connected = false): AppDeps["spotifyAuth"] {
  let isConn = connected;
  return {
    startAuth: () => ({
      url: "https://accounts.spotify.com/authorize?fake=1",
      state: "fake-state",
    }),
    handleCallback: async (params: { code: string; state: string }) => {
      if (params.state !== "fake-state") {
        throw new Error("OAuth state mismatch");
      }
      isConn = true;
    },
    isConnected: () => isConn,
  };
}

/** Builds a fully-faked AppDeps for route tests. Pass `db` to seed data before wiring it in. */
export function buildTestDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const db: DatabaseType = overrides.db ?? openDb(":memory:");
  const config: Config = overrides.config ?? loadConfig({} as NodeJS.ProcessEnv);
  const budget =
    overrides.budget ??
    new BudgetLedger(db, { daily: config.budgetDaily, initial: config.budgetInitial });

  return {
    db,
    config,
    scraper: overrides.scraper ?? new FakeScraper(),
    spotifyAuth: overrides.spotifyAuth ?? fakeSpotifyAuth(false),
    spotify: overrides.spotify ?? null,
    budget,
    webDistDir: overrides.webDistDir,
    runSyncFn: overrides.runSyncFn,
    runDiscoveryFn: overrides.runDiscoveryFn,
    pushDailyFn: overrides.pushDailyFn,
    buildAndPushPlaylistFn: overrides.buildAndPushPlaylistFn,
  };
}

export type SeedAlbumInput = {
  rymUrl: string;
  artist: string;
  title: string;
  year?: number | null;
  genres?: string[];
  descriptors?: string[];
  rymAvgRating?: number | null;
  rymNumRatings?: number | null;
  spotifyAlbumId?: string | null;
};

/** Inserts an album row directly via SQL and returns its id. */
export function seedAlbum(db: DatabaseType, o: SeedAlbumInput): number {
  const info = db
    .prepare(
      `INSERT INTO albums
        (rym_url, artist, title, year, genres, descriptors, rym_avg_rating, rym_num_ratings, spotify_album_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      o.rymUrl,
      o.artist,
      o.title,
      o.year ?? null,
      JSON.stringify(o.genres ?? []),
      JSON.stringify(o.descriptors ?? []),
      o.rymAvgRating ?? null,
      o.rymNumRatings ?? null,
      o.spotifyAlbumId ?? null,
    );
  return info.lastInsertRowid as number;
}

export type SeedCandidateInput = {
  albumId: number;
  score: number;
  status?: "new" | "playlisted" | "dismissed" | "known";
  components?: Record<string, unknown>;
  firstSeen?: string;
  updatedAt?: string;
};

/** Inserts a candidates row directly via SQL. */
export function seedCandidate(db: DatabaseType, o: SeedCandidateInput): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO candidates (album_id, score, components, status, first_seen, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    o.albumId,
    o.score,
    JSON.stringify(o.components ?? {}),
    o.status ?? "new",
    o.firstSeen ?? now,
    o.updatedAt ?? now,
  );
}
