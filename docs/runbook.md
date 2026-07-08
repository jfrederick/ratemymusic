# Operations runbook

Practical guide for running ratemymusic day to day. For the "why", see the
[design spec](superpowers/specs/2026-07-08-ratemymusic-design.md).

## Initial ingest

The first `npm run sync` walks the scrape frontier in priority order:

1. Your 5 collection pages (r5.0 down to r0.5, plus pagination) — the seed.
2. Album pages for your rated albums, highest-rated first (genres, descriptors, list links).
3. List pages, best expected affinity first, capped at ~40 lists.
4. Top ~10 list-authors' r5.0/r4.5 collection pages (taste-twins).
5. Genre charts for your top genres (~15 pages).
6. New-release chart pages (~3).

Expect roughly **150–350 Firecrawl credits** for a first full run, well under the
`BUDGET_INITIAL` default of 400 — the frontier stops itself once the budget or the
queue is exhausted, whichever comes first. If it stops on budget, just re-run
`npm run sync` on subsequent days; the frontier remembers pending/failed items and
picks up where it left off (subject to each item's TTL, below).

**Re-running is cheap.** Raw scrape markdown is cached to disk at
`data/cache/<sha1(url)>.md`. A page is only re-scraped (spending credits again) once
its TTL has elapsed:

| Page kind | TTL |
| --- | --- |
| collection | 7 days |
| album | 90 days |
| list | 30 days |
| twin-collection | 7 days |
| genre-page | 7 days |
| new-music | 1 day |

Run `npm run discover` after any `sync` to recompute the taste profile and re-score
candidates — it's pure local computation, no network, effectively free.

## Daily automation

Pick **one** of these — running both will push the daily playlist twice.

### Option A: launchd (recommended for a Mac that's usually on)

1. Edit `ops/launchd/com.jim.ratemymusic.daily.plist`: update the `npm` path
   (`which npm`) and `WorkingDirectory` if your checkout isn't at
   `/Users/jim/dev/jim/ratemymusic`.
2. Create the log directory it writes to: `mkdir -p data/logs`.
3. Install and load it:
   ```bash
   cp ops/launchd/com.jim.ratemymusic.daily.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.jim.ratemymusic.daily.plist
   ```
4. Verify: `launchctl list | grep ratemymusic`. It fires daily at 07:00 local,
   running `npm run daily` (`scripts/daily.mjs`), which chains sync (capped at
   30 pages) → discover → push-daily -- mirroring the in-process cron pipeline
   below. Each step runs even if an earlier one fails (e.g. sync hitting its
   crawl budget); the script exits non-zero if any step failed. Logs land in
   `data/logs/daily.{out,err}.log`.
5. To uninstall: `launchctl unload ~/Library/LaunchAgents/com.jim.ratemymusic.daily.plist && rm ~/Library/LaunchAgents/com.jim.ratemymusic.daily.plist`.

   > Before this was fixed, the plist ran only `npm run push-daily -w @rmm/core`
   > -- the graph never got synced or rescored automatically, so it kept
   > re-pushing the same stale top candidates. If you have an older plist
   > installed, re-copy the one in this repo and reload it.

### Option B: in-process cron (for a server that's always running)

Set `ENABLE_CRON=1` in `.env` and restart `npm run serve`. A `node-cron` job inside
`@rmm/server` fires daily at 07:00 local and runs sync → discover → push-daily
in-process. Failures are logged to `[cron] <step> failed: ...` on the server's
stdout and recorded in the `last_cron_error` setting (visible on the dashboard);
they're non-fatal — the next scheduled run tries again the next day.

## Budget exhaustion

**Symptoms:**

- `npm run sync` / `POST /api/sync` returns a `SyncReport` with fewer items processed
  than expected, or the CLI/API surfaces a `ScrapeBudgetError` / `BudgetExceededError`
  message ("Scrape budget exhausted for ...").
- The dashboard's budget panel shows `spentToday` at or near `daily`, or `spentTotal`
  at or near `initial`.
- `POST /api/sync` returns HTTP 429 with the budget error message (the server maps
  `ScrapeBudgetError`/`BudgetExceededError` to 429 in `app.onError`).

**Fixes:**

- Daily cap hit: wait until the next local calendar day (the ledger keys spend by
  `day` in `budget_ledger`, computed from the local clock), or raise `BUDGET_DAILY`
  in `.env` and restart.
- Lifetime cap hit: `BUDGET_INITIAL` is actually a cumulative lifetime cap
  (`spentTotal()` sums every day's spend, not just the first run) — once it's hit,
  no more scraping happens until you raise `BUDGET_INITIAL` in `.env` and restart.
  In practice the frontier already prioritized the highest-signal pages first, so
  raising it modestly (or accepting a partially-filled graph) is usually fine.
- Cheap gap-fills (e.g. chat's `scrape_chart` tool) still respect the same daily cap,
  so a busy chat session can itself trigger this — same fixes apply.

## Parser drift (RYM redesign)

RYM changes its markup occasionally; when a page's structure no longer matches what
a parser expects, parsers throw a `ParseError` rather than silently returning
garbage.

**Symptoms:**

- `SyncReport.parseFailures` is non-empty: each entry is `{ url, error }`.
- The dashboard surfaces the parse-failure count from the last sync
  (`last_sync_report` setting).
- Server logs show `ParseError` messages during `sync`.

**Repair workflow (test-first):**

1. Find the failing page's cached markdown: the cache path is
   `data/cache/<sha1(canonical url)>.md` (the `ParseError`/`ScrapeFailedError`
   generally logs enough context to identify the URL; you can also grep
   `data/cache/*.meta.json` for the URL).
2. Copy that markdown into `packages/core/test/fixtures/` (see the README table
   there for naming conventions) alongside a short note in the fixtures README
   about what changed.
3. Write/update a failing test in `packages/core/test/` against the new fixture —
   confirm it reproduces the parse failure.
4. Fix the relevant parser in `packages/core/src/rym/parse/` until the test passes.
5. Run `npm test` (and ideally `npm run sync` again) to confirm the fix holds
   against both the old and new page shapes.

Never patch a parser against a live scrape without a fixture — RYM shapes are
inconsistent enough (see spec §3.9) that today's fix can silently break on
tomorrow's edge case without a regression test pinning it down.

## Spotify token issues

Symptoms: `spotifyConnected: false` on `/api/status` when you expect a connection,
playlist-building endpoints returning `409 { error: "spotify not connected" }`, or
`SpotifyApiError` on a 401 that didn't auto-refresh (e.g. the refresh token itself
was revoked from Spotify's side).

Fix: reconnect via `GET /auth/spotify` (the Settings page's "Connect Spotify"
button hits this) — it starts a fresh PKCE authorization-code flow and the
callback at `/callback` persists new tokens to `oauth_tokens`, overwriting the
stale ones. No app restart needed.

## Resetting the database

To start over:

```bash
rm data/rmm.sqlite data/rmm.sqlite-wal data/rmm.sqlite-shm 2>/dev/null
```

The **scrape cache in `data/cache/` survives** a db reset — it's keyed by URL
hash, not by database rows. This means re-running `npm run sync` after a reset is
credit-cheap: any page still within its TTL is served from disk instead of
re-spending Firecrawl credits, and only the individual `INSERT`s are redone
against the fresh schema.

**Important nuance:** don't manually create `data/rmm.sqlite` or run migrations
yourself — `openDb()` (called by every entry point: CLI commands, the server, the
smoke test) recreates the full schema via `runMigrations` on first open of a
missing/empty file. Just delete the file(s) above and the next `sync`/`discover`/
`serve` invocation rebuilds the schema automatically.

**Path resolution:** a relative `RMM_DB_PATH` is always resolved against the repo
root (via `resolveRepoPath` in `@rmm/core`), never against `process.cwd()` — so
`npm run discover -w @rmm/core` (cwd `packages/core`) and `npm run start -w
@rmm/server` (cwd `packages/server`) both still read/write `<repo root>/data/rmm.sqlite`
for the default path above; the `rm` command in this section should always be run
from the repo root.

## Chat unavailable

Symptom: `POST /api/chat` returns `503 { error: "chat unavailable — set ANTHROPIC_API_KEY" }`,
or the Chat tab in the web UI shows a similar message instead of a conversation.

Fix: set `ANTHROPIC_API_KEY` in `.env` (get one at
[console.anthropic.com](https://console.anthropic.com/)) and restart `npm run serve`.
`ANTHROPIC_MODEL` (default `claude-opus-4-8`) is also env-tunable if you want to use
a different Claude model for the assistant.
