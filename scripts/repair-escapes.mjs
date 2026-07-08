#!/usr/bin/env node
// One-off data repair for I2: backslash-escaped markdown characters that leaked into stored
// text before the parser fix in packages/core/src/rym/parse/markdown.ts (extractLinks) and
// list.ts (byline author). RYM's markdown escapes characters like `[`, `]`, `_`, and `-` inside
// link text/usernames so they don't get misparsed as markdown syntax -- e.g. a release titled
// "White Album" under a link literally named "The Beatles \[White Album\]", or a username
// rendered as "No\_Username". Before the parser fix, those literal backslashes were stored
// verbatim in `albums.artist`/`albums.title`, `twins.username`, and `lists.author_username`.
//
// This script repairs already-ingested rows in place via a plain SQL REPLACE chain (no need for
// a JS-side regex/unescape helper here -- the 4 escape sequences actually observed in production
// data are '\[' '\]' '\_' '\-', so a straight literal REPLACE per sequence is simplest and
// auditable). It is IDEMPOTENT: REPLACE(col, '\[', '[') only touches rows that still contain the
// literal two-character sequence "\[" -- once repaired, re-running it finds nothing left to
// replace and is a no-op. Each table's REPLACE chain is applied repeatedly to a fixed point
// (bounded by MAX_PASSES) rather than just once: SQLite's REPLACE does a single non-overlapping
// left-to-right scan per call, so a doubled escape like "\\_\\_" (observed in one production row)
// needs a second pass to fully resolve -- one pass turns it into "\_\_", which is why a lone
// single-pass run can leave a handful of rows still matching.
//
// Usage: node scripts/repair-escapes.mjs [path-to-db]
//   Defaults to RMM_DB_PATH (resolved against the repo root, same as every other entry point)
//   or data/rmm.sqlite if unset.
//
// IMPORTANT: back up the database before running this against real data:
//   cp data/rmm.sqlite data/rmm.sqlite.bak

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveDbPath() {
  const arg = process.argv[2];
  const raw = arg ?? process.env.RMM_DB_PATH ?? "data/rmm.sqlite";
  return resolve(REPO_ROOT, raw);
}

// The 4 escape sequences actually observed in production data (see the finding's own examples:
// "The Beatles \[White Album\]", twin "No\_Username"). Applied in this order to each column.
const ESCAPES = [
  ["\\[", "["],
  ["\\]", "]"],
  ["\\_", "_"],
  ["\\-", "-"],
];

/** Builds a nested REPLACE(...) SQL expression applying every escape-sequence fix to `column`. */
function replaceChain(column) {
  return ESCAPES.reduce((expr, [from, to]) => `REPLACE(${expr}, '${from}', '${to}')`, column);
}

function matchClause(columns) {
  return columns
    .map((col) => ESCAPES.map(([from]) => `INSTR(${col}, '${from}') > 0`).join(" OR "))
    .join(" OR ");
}

function countAffected(db, table, columns) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${matchClause(columns)}`).get().c;
}

const MAX_PASSES = 5;

function repairTable(db, table, columns) {
  const before = countAffected(db, table, columns);
  const sets = columns.map((col) => `${col} = ${replaceChain(col)}`).join(", ");
  const update = db.prepare(`UPDATE ${table} SET ${sets} WHERE ${matchClause(columns)}`);

  let passes = 0;
  for (; passes < MAX_PASSES; passes++) {
    const { changes } = update.run();
    if (changes === 0) break;
  }

  const after = countAffected(db, table, columns);
  return { table, columns, before, after, passes };
}

function main() {
  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`== repair-escapes: ${dbPath} ==`);
  console.log(
    `IMPORTANT: this UPDATEs the database in place. Back it up first if you haven't:\n  cp ${dbPath} ${dbPath}.bak\n`,
  );

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const targets = [
    { table: "albums", columns: ["artist", "title"] },
    { table: "twins", columns: ["username"] },
    { table: "lists", columns: ["author_username"] },
  ];

  const tx = db.transaction(() => targets.map((t) => repairTable(db, t.table, t.columns)));
  const results = tx();

  console.log("Before -> after (rows still containing an escape sequence):");
  let totalBefore = 0;
  let totalAfter = 0;
  for (const r of results) {
    console.log(`  ${r.table}.[${r.columns.join(", ")}]: ${r.before} -> ${r.after}`);
    totalBefore += r.before;
    totalAfter += r.after;
  }
  console.log(`\nTotal affected rows: ${totalBefore} -> ${totalAfter}`);

  db.close();

  if (totalAfter > 0) {
    console.error(
      "\nWARNING: some rows still contain an escape sequence after repair -- inspect manually " +
        "(may be an escape character not in the ESCAPES list above).",
    );
    process.exitCode = 1;
  } else {
    console.log("\nPASS: no remaining escape sequences in the repaired columns.");
  }
}

main();
