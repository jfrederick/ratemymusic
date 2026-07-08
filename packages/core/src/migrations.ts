import type Database from "better-sqlite3";

type DatabaseType = Database.Database;

const MIGRATION_1 = `
CREATE TABLE albums (
  id INTEGER PRIMARY KEY,
  rym_url TEXT NOT NULL UNIQUE,
  artist TEXT NOT NULL,
  artist_rym_url TEXT,
  title TEXT NOT NULL,
  year INTEGER,
  rym_avg_rating REAL,
  rym_num_ratings INTEGER,
  genres TEXT NOT NULL DEFAULT '[]',
  descriptors TEXT NOT NULL DEFAULT '[]',
  spotify_album_id TEXT,
  scraped_at TEXT
);

CREATE TABLE my_ratings (
  album_id INTEGER PRIMARY KEY REFERENCES albums(id),
  rating REAL NOT NULL,
  rated_at TEXT
);

CREATE TABLE lists (
  id INTEGER PRIMARY KEY,
  rym_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author_username TEXT,
  num_items INTEGER,
  affinity REAL,
  scraped_at TEXT
);

CREATE TABLE list_items (
  list_id INTEGER NOT NULL REFERENCES lists(id),
  album_id INTEGER NOT NULL REFERENCES albums(id),
  position INTEGER,
  PRIMARY KEY(list_id, album_id)
);

CREATE TABLE twins (
  username TEXT PRIMARY KEY,
  affinity REAL,
  scraped_at TEXT
);

CREATE TABLE twin_ratings (
  username TEXT NOT NULL REFERENCES twins(username),
  album_id INTEGER NOT NULL REFERENCES albums(id),
  rating REAL NOT NULL,
  PRIMARY KEY(username, album_id)
);

CREATE TABLE charts (
  id INTEGER PRIMARY KEY,
  rym_url TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('genre-page','new')),
  params TEXT NOT NULL DEFAULT '{}',
  scraped_at TEXT
);

CREATE TABLE chart_items (
  chart_id INTEGER NOT NULL REFERENCES charts(id),
  album_id INTEGER NOT NULL REFERENCES albums(id),
  position INTEGER,
  PRIMARY KEY(chart_id, album_id)
);

CREATE TABLE candidates (
  album_id INTEGER PRIMARY KEY REFERENCES albums(id),
  score REAL NOT NULL,
  components TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','playlisted','dismissed','known')),
  first_seen TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE playlists (
  id INTEGER PRIMARY KEY,
  spotify_id TEXT,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('sampler','top','deep')),
  created_at TEXT NOT NULL
);

CREATE TABLE playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id),
  position INTEGER NOT NULL,
  spotify_track_id TEXT NOT NULL,
  album_id INTEGER REFERENCES albums(id),
  kept INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(playlist_id, position)
);

CREATE TABLE feedback (
  album_id INTEGER NOT NULL REFERENCES albums(id),
  verdict TEXT NOT NULL CHECK(verdict IN ('liked','disliked','known')),
  at TEXT NOT NULL,
  PRIMARY KEY(album_id, verdict)
);

CREATE TABLE scrape_queue (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE budget_ledger (
  day TEXT PRIMARY KEY,
  credits_spent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE oauth_tokens (
  provider TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_albums_artist ON albums(artist);
CREATE INDEX idx_candidates_status_score ON candidates(status, score DESC);
CREATE INDEX idx_scrape_queue_status_priority ON scrape_queue(status, priority DESC);
CREATE INDEX idx_list_items_album_id ON list_items(album_id);
CREATE INDEX idx_twin_ratings_album_id ON twin_ratings(album_id);
CREATE INDEX idx_chart_items_album_id ON chart_items(album_id);
`;

const MIGRATION_2 = `
ALTER TABLE albums ADD COLUMN spotify_artist_id TEXT;
`;

export const MIGRATIONS: string[] = [MIGRATION_1, MIGRATION_2];

export function runMigrations(db: DatabaseType): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    const migration = MIGRATIONS[i];
    const nextVersion = i + 1;
    const applyMigration = db.transaction(() => {
      db.exec(migration);
      db.pragma(`user_version = ${nextVersion}`);
    });
    applyMigration();
  }
}
