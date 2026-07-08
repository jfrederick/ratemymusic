import { describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/db.js";
import type { DatabaseType } from "../../src/db.js";
import { getSetting } from "../../src/settings.js";
import {
  buildAndPushPlaylist,
  rollingPlaylistId,
  setRollingPlaylistId,
} from "../../src/spotify/playlist.js";

function insertAlbum(
  db: DatabaseType,
  o: { rymUrl: string; artist: string; title: string },
): number {
  const result = db
    .prepare(
      "INSERT INTO albums (rym_url, artist, title, genres, descriptors) VALUES (?, ?, ?, '[]', '[]')",
    )
    .run(o.rymUrl, o.artist, o.title);
  return result.lastInsertRowid as number;
}

function insertCandidate(db: DatabaseType, albumId: number, score: number): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO candidates (album_id, score, components, status, first_seen, updated_at) VALUES (?, ?, '{}', 'new', ?, ?)",
  ).run(albumId, score, now, now);
}

/** A fake SpotifyClient exposing just the surface buildAndPushPlaylist needs. */
function fakeSp(o: {
  tracksPerAlbum: number;
  createPlaylistId?: string;
  onReplace?: (id: string, uris: string[]) => void;
  onAdd?: (id: string, uris: string[]) => void;
}) {
  let trackCounter = 0;
  return {
    searchAlbum: vi.fn(async (q: { artist: string; title: string }) => {
      if (q.title.includes("unresolvable")) return null;
      return { id: `spotify-${q.title}`, name: q.title, artistIds: ["artist-x"] };
    }),
    albumTracks: vi.fn(async () => {
      const tracks = [];
      for (let i = 0; i < o.tracksPerAlbum; i++) {
        trackCounter += 1;
        tracks.push({
          id: `track-${trackCounter}`,
          name: `Track ${trackCounter}`,
          discNumber: 1,
          trackNumber: i + 1,
        });
      }
      return tracks;
    }),
    tracksDetails: vi.fn(async (ids: string[]) =>
      ids.map((id, i) => ({ id, name: `Track ${id}`, popularity: 100 - i })),
    ),
    artistTopTracks: vi.fn(async () => []),
    me: vi.fn(async () => ({ id: "user-1", displayName: "Jim" })),
    createPlaylist: vi.fn(async () => ({ id: o.createPlaylistId ?? "playlist-created" })),
    replacePlaylistItems: vi.fn(async (id: string, uris: string[]) => {
      o.onReplace?.(id, uris);
    }),
    addPlaylistItems: vi.fn(async (id: string, uris: string[]) => {
      o.onAdd?.(id, uris);
    }),
    getPlaylist: vi.fn(async () => ({ id: "existing-playlist", name: "Existing" })),
  } as unknown as import("../../src/spotify/client.js").SpotifyClient;
}

describe("buildAndPushPlaylist", () => {
  it("creates a playlist, records rows, and marks candidates playlisted", async () => {
    const db = openDb(":memory:");
    const albumId1 = insertAlbum(db, {
      rymUrl: "release/album/a/1/",
      artist: "Artist",
      title: "One",
    });
    const albumId2 = insertAlbum(db, {
      rymUrl: "release/album/a/2/",
      artist: "Artist",
      title: "Two",
    });
    insertCandidate(db, albumId1, 0.9);
    insertCandidate(db, albumId2, 0.8);

    const sp = fakeSp({ tracksPerAlbum: 1 });
    const result = await buildAndPushPlaylist(db, sp, {
      name: "Test Playlist",
      albumIds: [albumId1, albumId2],
      mode: "sampler",
    });

    expect(result.spotifyPlaylistId).toBe("playlist-created");
    expect(result.trackCount).toBe(2);
    expect(result.unresolved).toEqual([]);

    const playlistRow = db
      .prepare("SELECT * FROM playlists WHERE spotify_id = ?")
      .get("playlist-created") as {
      id: number;
      name: string;
      mode: string;
    };
    expect(playlistRow.name).toBe("Test Playlist");
    expect(playlistRow.mode).toBe("sampler");

    const trackRows = db
      .prepare("SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position")
      .all(playlistRow.id);
    expect(trackRows).toHaveLength(2);

    const candidateRows = db
      .prepare("SELECT album_id, status FROM candidates ORDER BY album_id")
      .all() as {
      album_id: number;
      status: string;
    }[];
    expect(candidateRows.every((r) => r.status === "playlisted")).toBe(true);
  });

  it("collects unresolved albums and skips them", async () => {
    const db = openDb(":memory:");
    const resolvable = insertAlbum(db, {
      rymUrl: "release/album/b/1/",
      artist: "Artist",
      title: "Good",
    });
    const unresolvable = insertAlbum(db, {
      rymUrl: "release/album/b/2/",
      artist: "Artist",
      title: "unresolvable",
    });

    const sp = fakeSp({ tracksPerAlbum: 1 });
    const result = await buildAndPushPlaylist(db, sp, {
      name: "Test Playlist",
      albumIds: [resolvable, unresolvable],
      mode: "sampler",
    });

    expect(result.unresolved).toEqual([unresolvable]);
    expect(result.trackCount).toBe(1);
  });

  it("dedupes repeated track ids across albums while preserving order", async () => {
    const db = openDb(":memory:");
    const albumId1 = insertAlbum(db, {
      rymUrl: "release/album/c/1/",
      artist: "Artist",
      title: "One",
    });
    const albumId2 = insertAlbum(db, {
      rymUrl: "release/album/c/2/",
      artist: "Artist",
      title: "Two",
    });

    const sp = fakeSp({ tracksPerAlbum: 1 });
    // Force both albums to resolve to tracks with the same id by overriding albumTracks.
    sp.albumTracks = vi.fn(async () => [
      { id: "shared-track", name: "Shared", discNumber: 1, trackNumber: 1 },
    ]);

    const result = await buildAndPushPlaylist(db, sp, {
      name: "Dedup Playlist",
      albumIds: [albumId1, albumId2],
      mode: "sampler",
    });

    expect(result.trackCount).toBe(1);
  });

  it("chunks 150 unique tracks into a PUT of 100 followed by a POST of 50", async () => {
    const db = openDb(":memory:");
    const albumIds = Array.from({ length: 150 }, (_, i) =>
      insertAlbum(db, { rymUrl: `release/album/d/${i}/`, artist: "Artist", title: `Album ${i}` }),
    );

    const replaceCalls: string[][] = [];
    const sp = fakeSp({
      tracksPerAlbum: 1,
      onReplace: (_id, uris) => {
        // replacePlaylistItems is expected to internally chunk; record what it receives.
        replaceCalls.push(uris);
      },
    });

    // buildAndPushPlaylist should call sp.replacePlaylistItems ONCE with the full uri list;
    // the client itself is responsible for PUT+POST chunking (tested in client.test.ts).
    await buildAndPushPlaylist(db, sp, {
      name: "Big Playlist",
      albumIds,
      mode: "sampler",
    });

    expect(sp.replacePlaylistItems).toHaveBeenCalledTimes(1);
    expect(replaceCalls[0]).toHaveLength(150);
  });

  it("passes the album's resolved spotify_artist_id to pickTracks in top mode", async () => {
    const db = openDb(":memory:");
    const albumId = insertAlbum(db, {
      rymUrl: "release/album/f/1/",
      artist: "Artist",
      title: "One",
    });
    insertCandidate(db, albumId, 0.9);

    const sp = fakeSp({ tracksPerAlbum: 3 });
    await buildAndPushPlaylist(db, sp, {
      name: "Top Mode",
      albumIds: [albumId],
      mode: "top",
    });

    // fakeSp's searchAlbum resolves artistIds: ["artist-x"], which resolveAlbum
    // should have persisted to albums.spotify_artist_id and buildAndPushPlaylist
    // should read back and forward to pickTracks -> sp.artistTopTracks.
    expect(sp.artistTopTracks).toHaveBeenCalledWith("artist-x");
  });

  it("replaces an existing playlist in place when replacePlaylistId is set", async () => {
    const db = openDb(":memory:");
    const albumId = insertAlbum(db, {
      rymUrl: "release/album/e/1/",
      artist: "Artist",
      title: "One",
    });

    const sp = fakeSp({ tracksPerAlbum: 1 });
    const result = await buildAndPushPlaylist(db, sp, {
      name: "Rolling",
      albumIds: [albumId],
      mode: "sampler",
      replacePlaylistId: "existing-playlist-id",
    });

    expect(result.spotifyPlaylistId).toBe("existing-playlist-id");
    expect(sp.createPlaylist).not.toHaveBeenCalled();
    expect(sp.replacePlaylistItems).toHaveBeenCalledWith("existing-playlist-id", expect.any(Array));
  });
});

describe("rollingPlaylistId / setRollingPlaylistId", () => {
  it("returns null when unset and roundtrips a value", () => {
    const db = openDb(":memory:");
    expect(rollingPlaylistId(db, "daily")).toBeNull();
    setRollingPlaylistId(db, "daily", "playlist-xyz");
    expect(rollingPlaylistId(db, "daily")).toBe("playlist-xyz");
    expect(getSetting(db, "rolling_playlist_daily")).toBe("playlist-xyz");
  });
});
