#!/usr/bin/env node
// Daily automation entry point (I1): chains sync (maxPages 30) -> discover -> push-daily, the
// same three steps runDailyPipeline() runs in-process in packages/server/src/main.ts's
// ENABLE_CRON path -- but as a CLI script, for launchd (see
// ops/launchd/com.jim.ratemymusic.daily.plist) or any other external scheduler, on a server that
// doesn't run `npm run serve` with ENABLE_CRON=1.
//
// Previously, the launchd plist ran ONLY `npm run push-daily`, so the graph never got synced or
// rescored automatically -- push-daily would just keep re-pushing the same stale top candidates
// forever. This script is the fix: run all three steps, in order, every time.
//
// Each step runs even if an earlier one failed (e.g. sync hitting its crawl budget) -- a failed
// sync shouldn't also skip discover/push-daily, which can still usefully run against whatever
// graph already exists. Exits non-zero if ANY step failed (so launchd/cron logs/exit-status
// reflect it), but always attempts every step regardless of earlier failures.
//
// Usage: npm run daily

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_DIR = join(REPO_ROOT, "packages/core");

/** Runs `fn`, logging start/success/failure; returns whether it succeeded (never throws). */
function runStep(name, fn) {
  console.log(`\n[daily] ${name} ...`);
  try {
    fn();
    console.log(`[daily] ${name}: OK`);
    return true;
  } catch (err) {
    console.error(`[daily] ${name}: FAILED -- ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

console.log("== ratemymusic daily automation ==");
console.log("\n[daily] building @rmm/core ...");
execFileSync("npm", ["run", "build", "-w", "@rmm/core"], { cwd: REPO_ROOT, stdio: "inherit" });

const steps = [
  [
    "sync (maxPages 30)",
    () =>
      execFileSync("node", ["dist/cli/sync.js", "--max-pages", "30"], {
        cwd: CORE_DIR,
        stdio: "inherit",
      }),
  ],
  [
    "discover",
    () => execFileSync("node", ["dist/cli/discover.js"], { cwd: CORE_DIR, stdio: "inherit" }),
  ],
  [
    "push-daily",
    () => execFileSync("node", ["dist/cli/push-daily.js"], { cwd: CORE_DIR, stdio: "inherit" }),
  ],
];

const results = steps.map(([name, fn]) => [name, runStep(name, fn)]);
const failed = results.filter(([, ok]) => !ok);

console.log(
  `\n== daily automation: ${results.length - failed.length}/${results.length} steps succeeded ==`,
);
if (failed.length > 0) {
  console.log(`FAILED: ${failed.map(([name]) => name).join(", ")}`);
  process.exit(1);
}
console.log("PASS");
