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
