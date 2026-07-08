#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "../config.js";
import { openDb } from "../db.js";
import { runDiscovery } from "../discovery/index.js";
import { resolveRepoPath } from "../paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file lives at packages/core/{src,dist}/cli/discover.{ts,js}; walk up to the repo root.
const repoRoot = resolve(__dirname, "../../../../");
loadDotenv({ path: resolve(repoRoot, ".env"), quiet: true });

type TopCandidateRow = {
  score: number;
  components: string;
  artist: string;
  title: string;
};

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(resolveRepoPath(repoRoot, config.dbPath));

  const result = await runDiscovery(db, { weights: config.blendWeights });
  console.log(`[discover] ${result.candidates} candidate(s) with status='new'`);

  const rows = db
    .prepare(
      `SELECT c.score AS score, c.components AS components, a.artist AS artist, a.title AS title
       FROM candidates c
       JOIN albums a ON a.id = c.album_id
       WHERE c.status = 'new'
       ORDER BY c.score DESC
       LIMIT 20`,
    )
    .all() as TopCandidateRow[];

  for (const row of rows) {
    const methods = Object.keys(JSON.parse(row.components) as Record<string, unknown>).join(", ");
    console.log(`${row.score.toFixed(3)}  ${row.artist} — ${row.title}  [${methods}]`);
  }

  db.close();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});
