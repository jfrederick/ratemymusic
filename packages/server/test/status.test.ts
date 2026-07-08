import { openDb } from "@rmm/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { buildTestDeps, fakeSpotifyAuth, seedAlbum, seedCandidate } from "./helpers.js";

describe("GET /api/status", () => {
  it("reflects seeded counts and budget numbers, spotify disconnected", async () => {
    const db = openDb(":memory:");
    const a1 = seedAlbum(db, { rymUrl: "/release/a1/", artist: "A", title: "One" });
    seedAlbum(db, { rymUrl: "/release/a2/", artist: "B", title: "Two" });
    seedCandidate(db, { albumId: a1, score: 0.5, status: "new" });
    db.prepare("INSERT INTO my_ratings (album_id, rating, rated_at) VALUES (?, ?, ?)").run(
      a1,
      4.5,
      null,
    );
    db.prepare("INSERT INTO lists (rym_url, title) VALUES ('/list/x/', 'X')").run();
    db.prepare("INSERT INTO twins (username) VALUES ('twin1')").run();

    const deps = buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(false) });
    const app = createApp(deps);
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.spotifyConnected).toBe(false);
    expect(body.budget).toEqual({
      spentToday: 0,
      spentTotal: 0,
      daily: deps.config.budgetDaily,
      initial: deps.config.budgetInitial,
    });
    expect(body.counts).toEqual({
      albums: 2,
      myRatings: 1,
      lists: 1,
      twins: 1,
      candidatesNew: 1,
    });
    expect(body.lastSync).toBeNull();
    expect(body.tasteProfileComputedAt).toBeNull();
  });

  it("reflects spotify connected true and budget spend", async () => {
    const db = openDb(":memory:");
    const deps = buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(true) });
    deps.budget.spend(3);
    const app = createApp(deps);
    const res = await app.request("/api/status");
    const body = await res.json();
    expect(body.spotifyConnected).toBe(true);
    expect(body.budget.spentToday).toBe(3);
    expect(body.budget.spentTotal).toBe(3);
  });
});
