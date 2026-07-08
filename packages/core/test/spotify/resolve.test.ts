import { describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/db.js";
import type { DatabaseType } from "../../src/db.js";
import { getSetting } from "../../src/settings.js";
import { resolveAlbum } from "../../src/spotify/resolve.js";

function insertAlbum(
  db: DatabaseType,
  o: { rymUrl: string; artist: string; title: string; spotifyAlbumId?: string | null },
): number {
  const result = db
    .prepare(
      "INSERT INTO albums (rym_url, artist, title, genres, descriptors, spotify_album_id) VALUES (?, ?, ?, '[]', '[]', ?)",
    )
    .run(o.rymUrl, o.artist, o.title, o.spotifyAlbumId ?? null);
  return result.lastInsertRowid as number;
}

function fakeSpotifyClient(
  searchAlbum: (q: { artist: string; title: string }) => Promise<unknown>,
) {
  return { searchAlbum } as unknown as import("../../src/spotify/client.js").SpotifyClient;
}

describe("resolveAlbum", () => {
  it("returns the existing spotify_album_id without calling search", async () => {
    const db = openDb(":memory:");
    const albumId = insertAlbum(db, {
      rymUrl: "release/album/a/b/",
      artist: "Artist",
      title: "Title",
      spotifyAlbumId: "already-resolved",
    });
    const searchAlbum = vi.fn();
    const sp = fakeSpotifyClient(searchAlbum);
    const result = await resolveAlbum(db, sp, albumId);
    expect(result).toBe("already-resolved");
    expect(searchAlbum).not.toHaveBeenCalled();
  });

  it("searches and persists the result on success", async () => {
    const db = openDb(":memory:");
    const albumId = insertAlbum(db, {
      rymUrl: "release/album/a/c/",
      artist: "Artist",
      title: "Title",
    });
    const searchAlbum = vi.fn(async () => ({
      id: "spotify-abc",
      name: "Title",
      artistIds: ["a1"],
    }));
    const sp = fakeSpotifyClient(searchAlbum);
    const result = await resolveAlbum(db, sp, albumId);
    expect(result).toBe("spotify-abc");
    const row = db.prepare("SELECT spotify_album_id FROM albums WHERE id = ?").get(albumId) as {
      spotify_album_id: string | null;
    };
    expect(row.spotify_album_id).toBe("spotify-abc");
  });

  it("records the unresolved album in settings when search finds nothing", async () => {
    const db = openDb(":memory:");
    const albumId = insertAlbum(db, {
      rymUrl: "release/album/a/d/",
      artist: "Artist",
      title: "Title",
    });
    const searchAlbum = vi.fn(async () => null);
    const sp = fakeSpotifyClient(searchAlbum);
    const result = await resolveAlbum(db, sp, albumId);
    expect(result).toBeNull();
    const unresolved = getSetting<{ albumId: number; at: string }[]>(db, "spotify_unresolved");
    expect(unresolved).toHaveLength(1);
    expect(unresolved?.[0]?.albumId).toBe(albumId);
    expect(unresolved?.[0]?.at).toBeTruthy();

    const row = db.prepare("SELECT spotify_album_id FROM albums WHERE id = ?").get(albumId) as {
      spotify_album_id: string | null;
    };
    expect(row.spotify_album_id).toBeNull();
  });
});
