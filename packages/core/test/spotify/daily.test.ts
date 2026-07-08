import { describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/db.js";
import type { DatabaseType } from "../../src/db.js";
import { pushDaily } from "../../src/spotify/daily.js";

function insertAlbum(db: DatabaseType, i: number): number {
  const result = db
    .prepare(
      "INSERT INTO albums (rym_url, artist, title, genres, descriptors) VALUES (?, ?, ?, '[]', '[]')",
    )
    .run(`release/album/x/${i}/`, `Artist ${i}`, `Album ${i}`);
  return result.lastInsertRowid as number;
}

function insertCandidate(db: DatabaseType, albumId: number, score: number, status = "new"): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO candidates (album_id, score, components, status, first_seen, updated_at) VALUES (?, ?, '{}', ?, ?, ?)",
  ).run(albumId, score, status, now, now);
}

function fakeSp(o: { getPlaylistResult?: { id: string; name: string } | null } = {}) {
  let playlistCounter = 0;
  const hasOverride = Object.hasOwn(o, "getPlaylistResult");
  return {
    searchAlbum: vi.fn(async (q: { artist: string; title: string }) => ({
      id: `spotify-${q.title}`,
      name: q.title,
      artistIds: ["artist-x"],
    })),
    albumTracks: vi.fn(async () => [
      { id: `track-${++playlistCounter}`, name: "Track", discNumber: 1, trackNumber: 1 },
    ]),
    tracksDetails: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, name: id, popularity: 50 })),
    ),
    me: vi.fn(async () => ({ id: "user-1", displayName: "Jim" })),
    createPlaylist: vi.fn(async () => ({ id: "created-playlist-1" })),
    replacePlaylistItems: vi.fn(async () => {}),
    addPlaylistItems: vi.fn(async () => {}),
    getPlaylist: vi.fn(async () =>
      hasOverride ? o.getPlaylistResult : { id: "created-playlist-1", name: "Daily" },
    ),
  } as unknown as import("../../src/spotify/client.js").SpotifyClient;
}

describe("pushDaily", () => {
  it("pushes the top `size` new candidates to the daily playlist", async () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 15; i++) {
      insertCandidate(db, insertAlbum(db, i), 1 - i * 0.01);
    }
    const sp = fakeSp();
    const result = await pushDaily(db, sp, { today: () => "2026-07-07" });
    expect(result.albums).toHaveLength(10);
    expect(result.trackCount).toBe(10);
    expect(sp.createPlaylist).toHaveBeenCalledTimes(1);
  });

  it("reuses the rolling playlist id on a second run (replace, not create)", async () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 10; i++) {
      insertCandidate(db, insertAlbum(db, i), 1 - i * 0.01);
    }
    const sp = fakeSp();
    const first = await pushDaily(db, sp, { today: () => "2026-07-07" });
    expect(sp.createPlaylist).toHaveBeenCalledTimes(1);

    // Mark the candidates back to 'new' so there's something to push a second time,
    // simulating a fresh day with new discoveries reusing the same rolling playlist.
    db.prepare("UPDATE candidates SET status = 'new'").run();
    const second = await pushDaily(db, sp, { today: () => "2026-07-08" });

    expect(second.spotifyPlaylistId).toBe(first.spotifyPlaylistId);
    expect(sp.createPlaylist).toHaveBeenCalledTimes(1);
    expect(sp.replacePlaylistItems).toHaveBeenCalledWith(
      first.spotifyPlaylistId,
      expect.any(Array),
    );
  });

  it("recreates the playlist if the rolling id no longer exists on Spotify", async () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 10; i++) {
      insertCandidate(db, insertAlbum(db, i), 1 - i * 0.01);
    }
    const sp = fakeSp({ getPlaylistResult: null });
    const first = await pushDaily(db, sp, { today: () => "2026-07-07" });
    expect(sp.createPlaylist).toHaveBeenCalledTimes(1);

    db.prepare("UPDATE candidates SET status = 'new'").run();
    const second = await pushDaily(db, sp, { today: () => "2026-07-08" });
    expect(sp.createPlaylist).toHaveBeenCalledTimes(2);
    expect(second.spotifyPlaylistId).toBe(first.spotifyPlaylistId);
  });

  it("throws a descriptive error when there are zero eligible candidates", async () => {
    const db = openDb(":memory:");
    const sp = fakeSp();
    await expect(pushDaily(db, sp)).rejects.toThrow(/no eligible candidates/i);
  });

  it("throws a descriptive error when isConnected() reports Spotify is not connected", async () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 3; i++) {
      insertCandidate(db, insertAlbum(db, i), 1 - i * 0.01);
    }
    const sp = fakeSp();
    await expect(pushDaily(db, sp, { isConnected: () => false })).rejects.toThrow(
      "Spotify is not connected — open the app and connect first.",
    );
    expect(sp.createPlaylist).not.toHaveBeenCalled();
  });
});
