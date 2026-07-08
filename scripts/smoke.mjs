#!/usr/bin/env node
// End-to-end smoke test: seeds a throwaway SQLite db with @rmm/core, boots the real
// @rmm/server process against it, and exercises the core HTTP surface. No browser, no
// network beyond localhost, no API keys required (Firecrawl/Anthropic/Spotify all disabled).
//
// Usage: npm run smoke

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8799;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVER_TIMEOUT_MS = 30_000;

const results = [];
let tempDir;
let serverProcess;

function step(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      results.push({ name, ok: true });
      console.log(`  PASS  ${name}`);
    })
    .catch((err) => {
      results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err instanceof Error ? err.stack : err}`);
    });
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

async function waitForServer(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `server process exited before it started listening.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
      );
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet, keep polling
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `server did not become healthy within ${timeoutMs}ms.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
  );
}

async function main() {
  console.log("== ratemymusic smoke test ==");

  console.log("\n[1/4] building @rmm/core ...");
  execFileSync("npm", ["run", "build", "-w", "@rmm/core"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });

  tempDir = mkdtempSync(join(tmpdir(), "rmm-smoke-"));
  const dbPath = join(tempDir, "smoke.sqlite");

  console.log("\n[2/4] seeding temp database ...");
  const corePath = pathToFileURL(join(REPO_ROOT, "packages/core/dist/index.js")).href;
  const { openDb, upsertAlbum } = await import(corePath);

  let candidateAlbumIds;
  {
    const db = openDb(dbPath);
    try {
      const albumIds = [
        upsertAlbum(db, {
          rymUrl: "/release/album/smoke-artist-one/album-one/",
          artist: "Smoke Artist One",
          title: "Album One",
          year: 2001,
        }),
        upsertAlbum(db, {
          rymUrl: "/release/album/smoke-artist-two/album-two/",
          artist: "Smoke Artist Two",
          title: "Album Two",
          year: 2010,
        }),
        upsertAlbum(db, {
          rymUrl: "/release/album/smoke-artist-three/album-three/",
          artist: "Smoke Artist Three",
          title: "Album Three",
          year: 2020,
        }),
      ];
      assert(albumIds.length === 3, "seeded 3 albums");

      const now = new Date().toISOString();
      const insertCandidate = db.prepare(
        `INSERT INTO candidates (album_id, score, components, status, first_seen, updated_at)
         VALUES (?, ?, ?, 'new', ?, ?)`,
      );
      candidateAlbumIds = albumIds.slice(0, 2);
      for (const albumId of candidateAlbumIds) {
        insertCandidate.run(albumId, 0.75, "{}", now, now);
      }
    } finally {
      db.close();
    }
  }

  console.log("\n[3/4] starting @rmm/server ...");
  serverProcess = spawn("npm", ["run", "start", "-w", "@rmm/server"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      RMM_DB_PATH: dbPath,
      ANTHROPIC_API_KEY: "",
      FIRECRAWL_API_KEY: "",
      ENABLE_CRON: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForServer(serverProcess, SERVER_TIMEOUT_MS);
  console.log("server is up.");

  console.log("\n[4/4] running assertions ...");
  await step("GET /api/health -> 200 {ok:true}", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.ok === true, `expected ok:true, got ${JSON.stringify(body)}`);
  });

  await step("GET /api/status -> counts.albums === 3", async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await res.json();
    assert(
      body.counts?.albums === 3,
      `expected counts.albums === 3, got ${JSON.stringify(body.counts)}`,
    );
  });

  await step("GET /api/candidates -> 2 items", async () => {
    const res = await fetch(`${BASE_URL}/api/candidates`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await res.json();
    assert(
      Array.isArray(body.items) && body.items.length === 2,
      `expected 2 items, got ${JSON.stringify(body)}`,
    );
  });

  await step("POST dismiss then re-fetch -> 1 item", async () => {
    const [dismissAlbumId] = candidateAlbumIds;
    const dismissRes = await fetch(`${BASE_URL}/api/candidates/${dismissAlbumId}/dismiss`, {
      method: "POST",
    });
    assert(dismissRes.status === 200, `expected 200, got ${dismissRes.status}`);

    const res = await fetch(`${BASE_URL}/api/candidates`);
    const body = await res.json();
    assert(
      Array.isArray(body.items) && body.items.length === 1,
      `expected 1 item after dismiss, got ${JSON.stringify(body)}`,
    );
  });

  await step("GET /api/nonexistent -> 404 JSON", async () => {
    const res = await fetch(`${BASE_URL}/api/nonexistent`);
    assert(res.status === 404, `expected 404, got ${res.status}`);
    const body = await res.json();
    assert(typeof body.error === "string", `expected JSON error body, got ${JSON.stringify(body)}`);
  });
}

function cleanup() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (err) {
  console.error("\nsmoke test setup failed:", err instanceof Error ? err.stack : err);
  results.push({
    name: "setup",
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });
} finally {
  cleanup();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
if (failed.length > 0) {
  console.log("FAIL");
  for (const f of failed) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
} else {
  console.log("PASS");
  process.exit(0);
}
