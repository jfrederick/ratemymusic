#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BudgetLedger } from "../budget.js";
import { loadConfig } from "../config.js";
import { openDb } from "../db.js";
import { runSync } from "../ingest/sync.js";
import { FirecrawlScraper, firecrawlApiKeyFromCli } from "../scrape/firecrawl.js";

// packages/core/src/cli/sync.ts -> repo root is four directories up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Minimal `.env` loader: KEY=VALUE per line, '#' comments, blank lines ignored. Never overrides already-set env vars. */
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf-8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): { maxPages?: number } {
  const out: { maxPages?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max-pages") {
      const raw = argv[i + 1];
      const parsed = raw !== undefined ? Number(raw) : Number.NaN;
      if (!Number.isFinite(parsed)) {
        throw new Error(`--max-pages requires a numeric argument, got: ${raw}`);
      }
      out.maxPages = parsed;
      i++;
    }
  }
  return out;
}

function resolveFromRoot(path: string): string {
  return isAbsolute(path) ? path : join(REPO_ROOT, path);
}

async function main(): Promise<void> {
  loadDotEnv(join(REPO_ROOT, ".env"));

  const config = loadConfig(process.env);
  const { maxPages } = parseArgs(process.argv.slice(2));

  const apiKey = config.firecrawlApiKey ?? firecrawlApiKeyFromCli();
  if (!apiKey) {
    console.error(
      "No Firecrawl API key found. Set FIRECRAWL_API_KEY in the environment/.env, or sign in via the firecrawl-cli.",
    );
    process.exitCode = 1;
    return;
  }

  const db = openDb(resolveFromRoot(config.dbPath));
  const budget = new BudgetLedger(db, { daily: config.budgetDaily, initial: config.budgetInitial });
  const scraper = new FirecrawlScraper({
    apiKey,
    cacheDir: resolveFromRoot("data/cache"),
    budget,
  });

  const report = await runSync(db, scraper, {
    rymUsername: config.rymUsername,
    maxPages,
    log: (msg) => console.log(msg),
  });

  console.log(JSON.stringify(report, null, 2));
  console.log(
    `[sync] done: ${report.pagesScraped} scraped, ${report.fromCache} from cache, ` +
      `${report.parseFailures.length} parse failures, budgetExhausted=${report.budgetExhausted}. ` +
      `Counts: ${JSON.stringify(report.counts)}`,
  );

  db.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
