# ratemymusic

Mines your [RateYourMusic](https://rateyourmusic.com) rating history and the site's social
graph (lists, list authors, genre/new-release charts) to find albums you're likely to love,
then turns the results into Spotify playlists. Read-only against RYM — no login, no posting
ratings, zero account risk.

One engine, three surfaces:

- **Web app** — browse scored recommendations with "why" evidence, Spotify embeds, and
  playlist building.
- **Daily push** — an automatically refreshed ~10-track Spotify playlist, run via `launchd`
  or an in-process scheduler.
- **Chat** — conversational discovery ("warm slowcore for a rainy Sunday" → playlist),
  backed by the Claude API and grounded in your local taste graph.

## Quickstart

```bash
npm install
cp .env.example .env
npm test
npm run check   # biome lint/format check + typecheck across workspaces
```

`.env` keys, in order of how soon you'll need them:

| Key | Required? | Notes |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | Pre-filled | Already set to the app's registered client ID. Only change this if you register your own Spotify app. |
| `FIRECRAWL_API_KEY` | Optional | Powers RYM scraping (`sync`). Leave blank if you're logged into [firecrawl-cli](https://github.com/firecrawl/firecrawl-cli) on this machine — the app falls back to its saved credentials. Otherwise get a key at [firecrawl.dev](https://www.firecrawl.dev/). |
| `ANTHROPIC_API_KEY` | Optional | Enables the in-app chat assistant. Without it, chat responds with a friendly "set this to enable" message; everything else works fine. Get a key at [console.anthropic.com](https://console.anthropic.com/). |
| `RYM_USERNAME` | Yes | The RateYourMusic username whose collection gets mined. |
| everything else | No | Sensible defaults — budget caps, port, blend weights, cron toggle. See `.env.example` for details. |

## First run

```bash
npm run sync       # ingest: scrape your RYM collection + social graph (spends Firecrawl credits)
npm run discover    # score candidates from the local graph
npm run serve       # boot the API + web UI
```

Then open `http://127.0.0.1:8787`, connect Spotify (Settings → Connect), browse the
**Discover** feed, queue a few albums, and build a playlist. Run `sync`/`discover` again
later to refresh the graph and candidate list — both are incremental and TTL-cached, so
re-runs are cheap.

## Commands

| Command | What it does |
| --- | --- |
| `npm run sync` | Ingest pipeline: works the scrape frontier (collections → albums → lists → twins → charts) against Firecrawl, respecting budget caps and TTLs. |
| `npm run discover` | Recomputes the taste profile and re-scores candidates from the current local graph. No network. |
| `npm run serve` | Starts the Hono API server (and serves the built web UI if present) on `PORT` (default 8787). |
| `npm run push-daily -w @rmm/core` | Builds and pushes the rolling daily playlist to Spotify from top unplayed candidates. |
| `npm run daily` | Full daily automation: sync (capped at 30 pages) → discover → push-daily, each step running even if an earlier one fails. This is what the `launchd` job in `ops/launchd/` runs. |
| `npm test` | Vitest unit + integration tests (parsers against real-scrape fixtures, scoring math, budget ledger, server routes with mocked externals). |
| `npm run check` | Biome lint/format check + TypeScript typecheck across all workspaces. |
| `npm run smoke` | No-browser end-to-end smoke test: seeds a throwaway DB, boots the real server, exercises the core HTTP surface. No API keys or network required. |

## Architecture

npm-workspaces monorepo:

```
packages/
  core/     # domain: SQLite schema+migrations, RYM scraping/parsing, ingest pipeline + budget,
            # discovery engine, Spotify client, playlist builder, taste profile.
            # No HTTP server, no React — fully unit-testable without network.
  server/   # Hono API + PKCE OAuth callback + optional node-cron scheduler + serves the web build
  web/      # Vite + React UI
ops/        # launchd plist for the daily push job
docs/       # design spec, roadmap, runbook
```

**Ingest-first, local graph.** Firecrawl scrapes populate a local SQLite database (collections,
albums, lists, taste-twins, charts); all scoring runs against that local graph, so discovery
and chat queries are instant and free once the graph is populated. `sync` grows the graph;
`discover` re-scores it.

**Five discovery methods**, blended into a single `candidates.score`:

1. **list-mining** — albums on lists you'd rate highly (by overlap with your existing ratings) that you haven't heard yet.
2. **taste-twin** — albums loved by RYM users whose taste overlaps yours.
3. **genre-chart** — top albums from your favorite genres' RYM charts.
4. **descriptor** — same idea, filtered by mood/style descriptors already on albums in your graph.
5. **new-release radar** — recent releases filtered by your genre/descriptor profile.

## Budget

Firecrawl scraping is metered by a budget ledger, tunable via two env vars:

- `BUDGET_INITIAL` (default 400 credits) — caps the one-time initial ingest (your collection,
  seed albums, lists, twins, genre charts).
- `BUDGET_DAILY` (default 50 credits) — caps ongoing daily spend (new-release trickle, gap-fill
  scrapes from chat).

Every scrape debits the ledger; hitting a cap stops the sync cleanly with a clear message
rather than silently degrading results. See `docs/runbook.md` for symptoms and fixes.

## Docs

- Design spec: [`docs/superpowers/specs/2026-07-08-ratemymusic-design.md`](docs/superpowers/specs/2026-07-08-ratemymusic-design.md)
- Roadmap: [`docs/superpowers/plans/2026-07-08-ratemymusic-roadmap.md`](docs/superpowers/plans/2026-07-08-ratemymusic-roadmap.md)
- Operations runbook: [`docs/runbook.md`](docs/runbook.md) — ingest details, daily automation setup, budget/parser-drift/token troubleshooting, db reset.
