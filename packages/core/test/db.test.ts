import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { MIGRATIONS } from "../src/migrations.js";

describe("openDb", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("applies all migrations against an in-memory database", () => {
    const db = openDb(":memory:");
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(MIGRATIONS.length);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "albums",
        "my_ratings",
        "lists",
        "list_items",
        "twins",
        "twin_ratings",
        "charts",
        "chart_items",
        "candidates",
        "playlists",
        "playlist_tracks",
        "feedback",
        "scrape_queue",
        "budget_ledger",
        "oauth_tokens",
        "settings",
      ]),
    );
    db.close();
  });

  it("defaults to :memory: when no path is given", () => {
    const db = openDb();
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(MIGRATIONS.length);
    db.close();
  });

  it("creates the parent directory for a file path and re-opening is idempotent", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rmm-core-db-test-"));
    const dbPath = join(tmpDir, "nested", "rmm.sqlite");

    const db1 = openDb(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    const version1 = db1.pragma("user_version", { simple: true });
    expect(version1).toBe(MIGRATIONS.length);
    db1.close();

    const db2 = openDb(dbPath);
    const version2 = db2.pragma("user_version", { simple: true });
    expect(version2).toBe(MIGRATIONS.length);
    db2.close();
  });

  it("enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() => {
      db.prepare("INSERT INTO list_items (list_id, album_id, position) VALUES (?, ?, ?)").run(
        999,
        999,
        1,
      );
    }).toThrow();
    db.close();
  });

  it("adds albums.spotify_artist_id via migration and reports the full user_version", () => {
    const db = openDb(":memory:");
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(MIGRATIONS.length);

    const columns = db
      .prepare("PRAGMA table_info(albums)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toContain("spotify_artist_id");
    db.close();
  });

  it("enforces UNIQUE on albums.rym_url", () => {
    const db = openDb(":memory:");
    const insert = db.prepare(
      "INSERT INTO albums (rym_url, artist, title, genres, descriptors) VALUES (?, ?, ?, '[]', '[]')",
    );
    insert.run("release/album/foo/bar/", "Foo", "Bar");
    expect(() => insert.run("release/album/foo/bar/", "Foo", "Bar")).toThrow();
    db.close();
  });
});
