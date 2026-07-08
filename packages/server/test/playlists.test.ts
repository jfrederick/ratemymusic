import { type SpotifyClient, openDb } from "@rmm/core";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { buildTestDeps, fakeSpotifyAuth, seedAlbum, seedCandidate } from "./helpers.js";

const FAKE_SPOTIFY = {} as unknown as SpotifyClient;

describe("POST /api/playlists", () => {
  it("uses the queue, calls buildAndPushPlaylistFn, and clears the queue", async () => {
    const db = openDb(":memory:");
    const buildAndPushPlaylistFn = vi.fn().mockResolvedValue({
      spotifyPlaylistId: "pl1",
      trackCount: 3,
      unresolved: [],
    });
    const app = createApp(
      buildTestDeps({
        db,
        spotifyAuth: fakeSpotifyAuth(true),
        spotify: FAKE_SPOTIFY,
        buildAndPushPlaylistFn,
      }),
    );

    await app.request("/api/queue/1", { method: "POST" });
    await app.request("/api/queue/2", { method: "POST" });

    const res = await app.request("/api/playlists", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ spotifyPlaylistId: "pl1", trackCount: 3, unresolved: [] });

    expect(buildAndPushPlaylistFn).toHaveBeenCalledTimes(1);
    const [, sp, opts] = buildAndPushPlaylistFn.mock.calls[0];
    expect(sp).toBe(FAKE_SPOTIFY);
    expect(opts.albumIds).toEqual([1, 2]);
    expect(opts.mode).toBe("sampler");
    expect(opts.name).toMatch(/^RYM Discoveries — \d{4}-\d{2}-\d{2}$/);

    const queueRes = await app.request("/api/queue");
    expect(await queueRes.json()).toEqual([]);
  });

  it("does not clear the queue when albumIds is passed explicitly", async () => {
    const db = openDb(":memory:");
    const buildAndPushPlaylistFn = vi.fn().mockResolvedValue({
      spotifyPlaylistId: "pl1",
      trackCount: 1,
      unresolved: [],
    });
    const app = createApp(
      buildTestDeps({
        db,
        spotifyAuth: fakeSpotifyAuth(true),
        spotify: FAKE_SPOTIFY,
        buildAndPushPlaylistFn,
      }),
    );
    await app.request("/api/queue/5", { method: "POST" });

    const res = await app.request("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ albumIds: [42] }),
    });
    expect(res.status).toBe(200);
    const [, , opts] = buildAndPushPlaylistFn.mock.calls[0];
    expect(opts.albumIds).toEqual([42]);

    const queueRes = await app.request("/api/queue");
    expect(await queueRes.json()).toEqual([5]);
  });

  it("400s when there is nothing to build a playlist from", async () => {
    const db = openDb(":memory:");
    const app = createApp(
      buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(true), spotify: FAKE_SPOTIFY }),
    );
    const res = await app.request("/api/playlists", { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("409s when spotify is not connected", async () => {
    const db = openDb(":memory:");
    const app = createApp(buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(false) }));
    const res = await app.request("/api/playlists", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "spotify not connected" });
  });
});

describe("GET /api/playlists", () => {
  it("returns playlists with track counts, newest first", async () => {
    const db = openDb(":memory:");
    db.prepare(
      "INSERT INTO playlists (id, spotify_id, name, mode, created_at) VALUES (1, 'sp1', 'First', 'sampler', '2026-01-01T00:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO playlists (id, spotify_id, name, mode, created_at) VALUES (2, 'sp2', 'Second', 'top', '2026-02-01T00:00:00.000Z')",
    ).run();
    const alb = seedAlbum(db, { rymUrl: "/release/x/", artist: "A", title: "T" });
    seedCandidate(db, { albumId: alb, score: 0.5 });
    db.prepare(
      "INSERT INTO playlist_tracks (playlist_id, position, spotify_track_id, album_id, kept) VALUES (2, 0, 'tr1', ?, 0)",
    ).run(alb);
    db.prepare(
      "INSERT INTO playlist_tracks (playlist_id, position, spotify_track_id, album_id, kept) VALUES (2, 1, 'tr2', ?, 0)",
    ).run(alb);

    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/playlists");
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: 2, name: "Second", trackCount: 2 });
    expect(body[1]).toMatchObject({ id: 1, name: "First", trackCount: 0 });
  });
});

describe("GET /api/playlists/:id/tracks", () => {
  it("returns the playlist's tracks in position order, joined with album artist/title", async () => {
    const db = openDb(":memory:");
    db.prepare(
      "INSERT INTO playlists (id, spotify_id, name, mode, created_at) VALUES (1, 'sp1', 'First', 'sampler', '2026-01-01T00:00:00.000Z')",
    ).run();
    const alb = seedAlbum(db, { rymUrl: "/release/x/", artist: "A", title: "T" });
    db.prepare(
      "INSERT INTO playlist_tracks (playlist_id, position, spotify_track_id, album_id, kept) VALUES (1, 0, 'tr1', ?, 0)",
    ).run(alb);
    db.prepare(
      "INSERT INTO playlist_tracks (playlist_id, position, spotify_track_id, album_id, kept) VALUES (1, 1, 'tr2', ?, 1)",
    ).run(alb);

    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/playlists/1/tracks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      { position: 0, spotifyTrackId: "tr1", albumId: alb, kept: false, artist: "A", title: "T" },
      { position: 1, spotifyTrackId: "tr2", albumId: alb, kept: true, artist: "A", title: "T" },
    ]);
  });

  it("404s for an unknown playlist id", async () => {
    const db = openDb(":memory:");
    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/playlists/999/tracks");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/playlists/tracks/keep", () => {
  function fakeKeepableSpotify(o: {
    existingPlaylistId?: string | null;
    getPlaylistFound?: boolean;
  }) {
    const getPlaylist = vi
      .fn()
      .mockResolvedValue(
        o.getPlaylistFound === false ? null : { id: "kept1", name: "RYM Keepers" },
      );
    const me = vi.fn().mockResolvedValue({ id: "user1" });
    const createPlaylist = vi.fn().mockResolvedValue({ id: "kept1" });
    const addPlaylistItems = vi.fn().mockResolvedValue(undefined);
    return {
      sp: { getPlaylist, me, createPlaylist, addPlaylistItems } as unknown as SpotifyClient,
      getPlaylist,
      me,
      createPlaylist,
      addPlaylistItems,
    };
  }

  it("creates the RYM Keepers playlist on first use, adds the track, and marks it kept", async () => {
    const db = openDb(":memory:");
    const alb = seedAlbum(db, { rymUrl: "/release/x/", artist: "A", title: "T" });
    db.prepare(
      "INSERT INTO playlists (id, spotify_id, name, mode, created_at) VALUES (1, 'sp1', 'First', 'sampler', '2026-01-01T00:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO playlist_tracks (playlist_id, position, spotify_track_id, album_id, kept) VALUES (1, 0, 'tr1', ?, 0)",
    ).run(alb);

    const { sp, me, createPlaylist, addPlaylistItems } = fakeKeepableSpotify({});
    const app = createApp(buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(true), spotify: sp }));

    const res = await app.request("/api/playlists/tracks/keep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spotifyTrackId: "tr1", albumId: alb }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, playlistId: "kept1" });

    expect(me).toHaveBeenCalledTimes(1);
    expect(createPlaylist).toHaveBeenCalledWith(
      "user1",
      expect.objectContaining({ name: "RYM Keepers" }),
    );
    expect(addPlaylistItems).toHaveBeenCalledWith("kept1", ["spotify:track:tr1"]);

    const row = db
      .prepare("SELECT kept FROM playlist_tracks WHERE spotify_track_id = 'tr1'")
      .get() as { kept: number };
    expect(row.kept).toBe(1);

    const { getSetting } = await import("@rmm/core");
    expect(getSetting(db, "rolling_playlist_keepers")).toBe("kept1");
  });

  it("reuses the existing Keepers playlist on subsequent calls", async () => {
    const db = openDb(":memory:");
    const { setSetting } = await import("@rmm/core");
    setSetting(db, "rolling_playlist_keepers", "existing-keepers");
    const { sp, createPlaylist, addPlaylistItems } = fakeKeepableSpotify({
      getPlaylistFound: true,
    });
    const app = createApp(buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(true), spotify: sp }));

    const res = await app.request("/api/playlists/tracks/keep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spotifyTrackId: "tr9" }),
    });
    expect(res.status).toBe(200);
    expect(createPlaylist).not.toHaveBeenCalled();
    expect(addPlaylistItems).toHaveBeenCalledWith("existing-keepers", ["spotify:track:tr9"]);
  });

  it("409s when spotify is not connected", async () => {
    const db = openDb(":memory:");
    const app = createApp(buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(false) }));
    const res = await app.request("/api/playlists/tracks/keep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spotifyTrackId: "tr1" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "spotify not connected" });
  });

  it("400s when spotifyTrackId is missing", async () => {
    const db = openDb(":memory:");
    const { sp } = fakeKeepableSpotify({});
    const app = createApp(buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(true), spotify: sp }));
    const res = await app.request("/api/playlists/tracks/keep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/playlists/daily", () => {
  it("calls pushDailyFn and returns its result", async () => {
    const db = openDb(":memory:");
    const pushDailyFn = vi.fn().mockResolvedValue({
      spotifyPlaylistId: "daily1",
      trackCount: 10,
      albums: [1, 2, 3],
    });
    const app = createApp(
      buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(true), spotify: FAKE_SPOTIFY, pushDailyFn }),
    );
    const res = await app.request("/api/playlists/daily", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      spotifyPlaylistId: "daily1",
      trackCount: 10,
      albums: [1, 2, 3],
    });
    expect(pushDailyFn).toHaveBeenCalledTimes(1);
  });

  it("409s when spotify is not connected", async () => {
    const db = openDb(":memory:");
    const pushDailyFn = vi.fn();
    const app = createApp(buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(false), pushDailyFn }));
    const res = await app.request("/api/playlists/daily", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "spotify not connected" });
  });

  it("400s with the failure message when there are no eligible candidates", async () => {
    const db = openDb(":memory:");
    const pushDailyFn = vi.fn().mockRejectedValue(new Error("No eligible candidates"));
    const app = createApp(
      buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(true), spotify: FAKE_SPOTIFY, pushDailyFn }),
    );
    const res = await app.request("/api/playlists/daily", { method: "POST" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No eligible candidates" });
  });
});
