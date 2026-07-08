import { openDb } from "@rmm/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { buildTestDeps, seedAlbum, seedCandidate } from "./helpers.js";

function seedThree(db: ReturnType<typeof openDb>) {
  const a1 = seedAlbum(db, {
    rymUrl: "/release/high/",
    artist: "Artist High",
    title: "High Score",
    year: 1995,
    genres: ["Slowcore", "Dream Pop"],
    descriptors: ["melancholic"],
    rymAvgRating: 4.1,
    rymNumRatings: 500,
    spotifyAlbumId: "sp1",
  });
  const a2 = seedAlbum(db, {
    rymUrl: "/release/mid/",
    artist: "Artist Mid",
    title: "Mid Score",
    year: 2001,
    genres: ["Indie Rock"],
  });
  const a3 = seedAlbum(db, {
    rymUrl: "/release/low/",
    artist: "Artist Low",
    title: "Low Score (dismissed)",
    genres: ["Slowcore"],
  });
  seedCandidate(db, {
    albumId: a1,
    score: 0.9,
    status: "new",
    components: { list: { score: 0.9 } },
  });
  seedCandidate(db, {
    albumId: a2,
    score: 0.5,
    status: "new",
    components: { twin: { score: 0.5 } },
  });
  seedCandidate(db, { albumId: a3, score: 0.2, status: "dismissed" });
  return { a1, a2, a3 };
}

describe("GET /api/candidates", () => {
  it("defaults to status=new, sorted desc, with joined album fields", async () => {
    const db = openDb(":memory:");
    seedThree(db);
    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/candidates");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.items.map((i: { score: number }) => i.score)).toEqual([0.9, 0.5]);
    expect(body.items[0]).toMatchObject({
      artist: "Artist High",
      title: "High Score",
      year: 1995,
      rymUrl: "/release/high/",
      genres: ["Slowcore", "Dream Pop"],
      descriptors: ["melancholic"],
      rymAvgRating: 4.1,
      rymNumRatings: 500,
      spotifyAlbumId: "sp1",
      status: "new",
    });
    expect(body.items[0].components).toEqual({ list: { score: 0.9 } });
  });

  it("filters by status", async () => {
    const db = openDb(":memory:");
    seedThree(db);
    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/candidates?status=dismissed");
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].title).toBe("Low Score (dismissed)");
  });

  it("filters by genre, case-insensitive", async () => {
    const db = openDb(":memory:");
    seedThree(db);
    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/candidates?genre=slowcore");
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].artist).toBe("Artist High");
  });

  it("filters by genre via genre-method evidence when album.genres is empty (C1)", async () => {
    const db = openDb(":memory:");
    // A typical genre-chart-only candidate: never sighted on its own album page, so it carries
    // no album-level genres at all -- the only signal is the genre scoring component's evidence.
    const evidenceOnly = seedAlbum(db, {
      rymUrl: "/release/evidence-only/",
      artist: "Chart Only Artist",
      title: "Chart Only Album",
      genres: [],
    });
    seedCandidate(db, {
      albumId: evidenceOnly,
      score: 0.6,
      status: "new",
      components: {
        genre: {
          score: 0.6,
          evidence: {
            method: "genre",
            charts: [{ rymUrl: "/genre/slowcore/", genre: "Slowcore", position: 2 }],
          },
        },
      },
    });
    const app = createApp(buildTestDeps({ db }));

    const res = await app.request("/api/candidates?genre=slowcore");
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].artist).toBe("Chart Only Artist");
  });

  it("400s on a non-numeric limit/offset/minScore", async () => {
    const db = openDb(":memory:");
    seedThree(db);
    const app = createApp(buildTestDeps({ db }));

    const limitRes = await app.request("/api/candidates?limit=abc");
    expect(limitRes.status).toBe(400);
    expect(await limitRes.json()).toEqual({ error: "invalid query parameter" });

    const offsetRes = await app.request("/api/candidates?offset=xyz");
    expect(offsetRes.status).toBe(400);
    expect(await offsetRes.json()).toEqual({ error: "invalid query parameter" });

    const minScoreRes = await app.request("/api/candidates?minScore=notanumber");
    expect(minScoreRes.status).toBe(400);
    expect(await minScoreRes.json()).toEqual({ error: "invalid query parameter" });
  });

  it("filters by minScore", async () => {
    const db = openDb(":memory:");
    seedThree(db);
    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/candidates?minScore=0.6");
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].score).toBe(0.9);
  });

  it("filters by method (component key present)", async () => {
    const db = openDb(":memory:");
    seedThree(db);
    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/candidates?method=twin");
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].artist).toBe("Artist Mid");
  });

  it("paginates with limit/offset while total reflects the full filtered set", async () => {
    const db = openDb(":memory:");
    seedThree(db);
    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/candidates?limit=1&offset=1");
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].score).toBe(0.5);
  });
});

describe("candidate lifecycle", () => {
  it("dismiss: 200 then 404 for unknown album", async () => {
    const db = openDb(":memory:");
    const { a1 } = seedThree(db);
    const app = createApp(buildTestDeps({ db }));

    const res = await app.request(`/api/candidates/${a1}/dismiss`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ albumId: a1, status: "dismissed" });

    const status = (
      db.prepare("SELECT status FROM candidates WHERE album_id = ?").get(a1) as { status: string }
    ).status;
    expect(status).toBe("dismissed");

    const res404 = await app.request("/api/candidates/999999/dismiss", { method: "POST" });
    expect(res404.status).toBe(404);
  });

  it("known: 200, sets status and writes a feedback row; 404 for unknown album", async () => {
    const db = openDb(":memory:");
    const { a2 } = seedThree(db);
    const app = createApp(buildTestDeps({ db }));

    const res = await app.request(`/api/candidates/${a2}/known`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ albumId: a2, status: "known" });

    const row = db.prepare("SELECT status FROM candidates WHERE album_id = ?").get(a2) as {
      status: string;
    };
    expect(row.status).toBe("known");

    const feedback = db.prepare("SELECT verdict FROM feedback WHERE album_id = ?").get(a2) as
      | { verdict: string }
      | undefined;
    expect(feedback?.verdict).toBe("known");

    const res404 = await app.request("/api/candidates/999999/known", { method: "POST" });
    expect(res404.status).toBe(404);
  });

  it("restore: sets status back to new; 404 for unknown album", async () => {
    const db = openDb(":memory:");
    const { a3 } = seedThree(db);
    const app = createApp(buildTestDeps({ db }));

    const res = await app.request(`/api/candidates/${a3}/restore`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ albumId: a3, status: "new" });

    const res404 = await app.request("/api/candidates/999999/restore", { method: "POST" });
    expect(res404.status).toBe(404);
  });
});
