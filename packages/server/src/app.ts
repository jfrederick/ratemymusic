import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  BudgetExceededError,
  type Candidate,
  type DatabaseType,
  ScrapeBudgetError,
  type TrackPickMode,
  buildAndPushPlaylist,
  getSetting,
  loadTasteProfile,
  pushDaily,
  runDiscovery,
  runSync,
  setSetting,
} from "@rmm/core";
import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { type ChatMessage, runChat } from "./chat/service.js";
import type { AppDeps } from "./deps.js";

const MAX_CHAT_MESSAGES = 40;
const MAX_CHAT_MESSAGE_CHARS = 4000;

type CandidateRow = {
  albumId: number;
  score: number;
  status: Candidate["status"];
  firstSeen: string;
  updatedAt: string;
  components: string;
  artist: string;
  title: string;
  year: number | null;
  rymUrl: string;
  genres: string;
  descriptors: string;
  rymAvgRating: number | null;
  rymNumRatings: number | null;
  spotifyAlbumId: string | null;
};

export type CandidateView = Omit<CandidateRow, "components" | "genres" | "descriptors"> & {
  components: Candidate["components"];
  genres: string[];
  descriptors: string[];
};

function countRows(db: DatabaseType, table: string, where?: string): number {
  const sql = where
    ? `SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`
    : `SELECT COUNT(*) AS c FROM ${table}`;
  return (db.prepare(sql).get() as { c: number }).c;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

function loadQueue(db: DatabaseType): number[] {
  return getSetting<number[]>(db, "playlist_queue") ?? [];
}

function saveQueue(db: DatabaseType, queue: number[]): void {
  setSetting(db, "playlist_queue", queue);
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  let syncInFlight = false;

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/status", (c) => {
    const profile = loadTasteProfile(deps.db);
    return c.json({
      spotifyConnected: deps.spotifyAuth.isConnected(),
      budget: {
        spentToday: deps.budget.spentToday(),
        spentTotal: deps.budget.spentTotal(),
        daily: deps.config.budgetDaily,
        initial: deps.config.budgetInitial,
      },
      counts: {
        albums: countRows(deps.db, "albums"),
        myRatings: countRows(deps.db, "my_ratings"),
        lists: countRows(deps.db, "lists"),
        twins: countRows(deps.db, "twins"),
        candidatesNew: countRows(deps.db, "candidates", "status = 'new'"),
      },
      lastSync: getSetting(deps.db, "last_sync_report"),
      tasteProfileComputedAt: profile?.computedAt ?? null,
    });
  });

  app.get("/api/profile", (c) => {
    const profile = loadTasteProfile(deps.db);
    if (!profile) return c.json({ error: "not computed yet" }, 404);
    return c.json(profile);
  });

  app.get("/api/candidates", (c) => {
    const status = c.req.query("status") ?? "new";
    const method = c.req.query("method");
    const genre = c.req.query("genre");
    const minScoreParam = c.req.query("minScore");
    const minScore = minScoreParam !== undefined ? Number(minScoreParam) : undefined;
    const limitParam = c.req.query("limit");
    const offsetParam = c.req.query("offset");
    const limit = limitParam !== undefined ? Number(limitParam) : 50;
    const offset = offsetParam !== undefined ? Number(offsetParam) : 0;

    const rows = deps.db
      .prepare(
        `SELECT
           c.album_id AS albumId, c.score AS score, c.status AS status,
           c.first_seen AS firstSeen, c.updated_at AS updatedAt, c.components AS components,
           a.artist AS artist, a.title AS title, a.year AS year, a.rym_url AS rymUrl,
           a.genres AS genres, a.descriptors AS descriptors,
           a.rym_avg_rating AS rymAvgRating, a.rym_num_ratings AS rymNumRatings,
           a.spotify_album_id AS spotifyAlbumId
         FROM candidates c
         JOIN albums a ON a.id = c.album_id
         WHERE c.status = ?
         ORDER BY c.score DESC`,
      )
      .all(status) as CandidateRow[];

    let items: CandidateView[] = rows.map((row) => ({
      ...row,
      genres: JSON.parse(row.genres) as string[],
      descriptors: JSON.parse(row.descriptors) as string[],
      components: JSON.parse(row.components) as Candidate["components"],
    }));

    if (minScore !== undefined) {
      items = items.filter((item) => item.score >= minScore);
    }
    if (method) {
      items = items.filter((item) => method in item.components);
    }
    if (genre) {
      const needle = genre.toLowerCase();
      items = items.filter((item) => item.genres.some((g) => g.toLowerCase() === needle));
    }

    const total = items.length;
    const page = items.slice(offset, offset + limit);
    return c.json({ items: page, total });
  });

  app.post("/api/candidates/:albumId/dismiss", (c) => {
    const albumId = Number(c.req.param("albumId"));
    const result = deps.db
      .prepare("UPDATE candidates SET status = 'dismissed', updated_at = ? WHERE album_id = ?")
      .run(nowIso(), albumId);
    if (result.changes === 0) return c.json({ error: "candidate not found" }, 404);
    return c.json({ albumId, status: "dismissed" });
  });

  app.post("/api/candidates/:albumId/known", (c) => {
    const albumId = Number(c.req.param("albumId"));
    const result = deps.db
      .prepare("UPDATE candidates SET status = 'known', updated_at = ? WHERE album_id = ?")
      .run(nowIso(), albumId);
    if (result.changes === 0) return c.json({ error: "candidate not found" }, 404);
    deps.db
      .prepare("INSERT OR REPLACE INTO feedback (album_id, verdict, at) VALUES (?, 'known', ?)")
      .run(albumId, nowIso());
    return c.json({ albumId, status: "known" });
  });

  app.post("/api/candidates/:albumId/restore", (c) => {
    const albumId = Number(c.req.param("albumId"));
    const result = deps.db
      .prepare("UPDATE candidates SET status = 'new', updated_at = ? WHERE album_id = ?")
      .run(nowIso(), albumId);
    if (result.changes === 0) return c.json({ error: "candidate not found" }, 404);
    return c.json({ albumId, status: "new" });
  });

  app.get("/api/queue", (c) => c.json(loadQueue(deps.db)));

  app.post("/api/queue/:albumId", (c) => {
    const albumId = Number(c.req.param("albumId"));
    const queue = loadQueue(deps.db);
    if (!queue.includes(albumId)) queue.push(albumId);
    saveQueue(deps.db, queue);
    return c.json(queue);
  });

  app.delete("/api/queue/:albumId", (c) => {
    const albumId = Number(c.req.param("albumId"));
    const queue = loadQueue(deps.db).filter((id) => id !== albumId);
    saveQueue(deps.db, queue);
    return c.json(queue);
  });

  app.post("/api/playlists", async (c) => {
    if (!deps.spotifyAuth.isConnected() || !deps.spotify) {
      return c.json({ error: "spotify not connected" }, 409);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      mode?: TrackPickMode;
      albumIds?: number[];
    };
    const usingQueue = body.albumIds === undefined;
    const albumIds = body.albumIds ?? loadQueue(deps.db);
    if (albumIds.length === 0) {
      return c.json({ error: "no albums to build a playlist from" }, 400);
    }
    const name = body.name ?? `RYM Discoveries — ${todayDate()}`;
    const mode = body.mode ?? "sampler";
    const fn = deps.buildAndPushPlaylistFn ?? buildAndPushPlaylist;
    const result = await fn(deps.db, deps.spotify, { name, albumIds, mode });
    if (usingQueue) saveQueue(deps.db, []);
    return c.json(result);
  });

  app.get("/api/playlists", (c) => {
    const rows = deps.db
      .prepare(
        `SELECT p.id AS id, p.spotify_id AS spotifyId, p.name AS name, p.mode AS mode,
                p.created_at AS createdAt, COUNT(pt.spotify_track_id) AS trackCount
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         GROUP BY p.id
         ORDER BY p.created_at DESC, p.id DESC`,
      )
      .all();
    return c.json(rows);
  });

  app.post("/api/playlists/daily", async (c) => {
    const fn = deps.pushDailyFn ?? pushDaily;
    try {
      if (!deps.spotify) throw new Error("Spotify is not connected");
      const result = await fn(deps.db, deps.spotify, {
        isConnected: () => deps.spotifyAuth.isConnected(),
      });
      return c.json(result);
    } catch (err) {
      if (!deps.spotifyAuth.isConnected()) {
        return c.json({ error: "spotify not connected" }, 409);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  app.post("/api/sync", async (c) => {
    if (syncInFlight) return c.json({ error: "sync already in progress" }, 409);
    syncInFlight = true;
    try {
      const body = (await c.req.json().catch(() => ({}))) as { maxPages?: number };
      const fn = deps.runSyncFn ?? runSync;
      const report = await fn(deps.db, deps.scraper, {
        maxPages: body.maxPages,
        rymUsername: deps.config.rymUsername,
      });
      setSetting(deps.db, "last_sync_report", report);
      return c.json(report);
    } finally {
      syncInFlight = false;
    }
  });

  app.post("/api/discover", async (c) => {
    const fn = deps.runDiscoveryFn ?? runDiscovery;
    const result = await fn(deps.db, { weights: deps.config.blendWeights });
    return c.json(result);
  });

  app.post("/api/chat", async (c) => {
    if (!deps.anthropicClient) {
      return c.json({ error: "chat unavailable — set ANTHROPIC_API_KEY" }, 503);
    }

    const body = (await c.req.json().catch(() => ({}))) as { messages?: unknown };
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    if (rawMessages.length === 0 || rawMessages.length > MAX_CHAT_MESSAGES) {
      return c.json(
        { error: `messages must contain between 1 and ${MAX_CHAT_MESSAGES} items` },
        400,
      );
    }

    const messages: ChatMessage[] = [];
    for (const raw of rawMessages) {
      const m = raw as { role?: unknown; content?: unknown };
      if (
        (m.role !== "user" && m.role !== "assistant") ||
        typeof m.content !== "string" ||
        m.content.length > MAX_CHAT_MESSAGE_CHARS
      ) {
        return c.json(
          {
            error: `each message must have role 'user'|'assistant' and content of at most ${MAX_CHAT_MESSAGE_CHARS} characters`,
          },
          400,
        );
      }
      messages.push({ role: m.role, content: m.content });
    }

    return streamSSE(c, async (stream) => {
      // Serializes writes triggered from runChat's synchronous callbacks (onDelta/onToolEvent),
      // which may otherwise race each other across microtask boundaries.
      let queue: Promise<void> = Promise.resolve();
      const enqueue = (write: () => Promise<void>) => {
        queue = queue.then(write);
      };

      try {
        const result = await runChat(
          deps,
          messages,
          (text) =>
            enqueue(() => stream.writeSSE({ event: "delta", data: JSON.stringify({ text }) })),
          (name) =>
            enqueue(() => stream.writeSSE({ event: "tool", data: JSON.stringify({ name }) })),
        );
        await queue;
        await stream.writeSSE({ event: "done", data: JSON.stringify(result) });
      } catch (err) {
        await queue.catch(() => {});
        const message = err instanceof Error ? err.message : String(err);
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message }) });
      }
    });
  });

  app.get("/auth/spotify", (c) => {
    const { url } = deps.spotifyAuth.startAuth();
    return c.redirect(url, 302);
  });

  app.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return c.text("Missing code or state", 400);
    try {
      await deps.spotifyAuth.handleCallback({ code, state });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.text(message, 400);
    }
    return c.redirect("/#/settings?spotify=connected", 302);
  });

  // Guard the SPA static fallback below: /api and /auth requests that didn't match any route
  // above (and any method on /callback other than the GET handled earlier) must return a JSON
  // 404, never the SPA's index.html. Registered after all real routes, so real routes still win.
  const notFoundJson = (c: Context) => c.json({ error: "not found" }, 404);
  app.all("/api/*", notFoundJson);
  app.all("/auth/*", notFoundJson);
  app.all("/callback", notFoundJson);

  const webDistAbs =
    deps.webDistDir ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(webDistAbs)) {
    // Absolute paths work fine here even though @hono/node-server's types describe `root` as
    // CWD-relative -- serveStatic just does node:path.join(root, filename), which is cwd-agnostic
    // for an absolute root. Using an absolute path keeps this correct regardless of the process's
    // working directory (e.g. `npm run start -w @rmm/server` vs. running main.ts directly).
    app.use("*", serveStatic({ root: webDistAbs }));
    app.get("*", serveStatic({ path: resolve(webDistAbs, "index.html") }));
  }

  app.onError((err, c) => {
    if (err instanceof ScrapeBudgetError || err instanceof BudgetExceededError) {
      return c.json({ error: err.message }, 429);
    }
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  });

  return app;
}
