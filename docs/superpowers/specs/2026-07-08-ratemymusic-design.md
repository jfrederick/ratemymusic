# ratemymusic — RYM-Powered Music Discovery — Design

**Date:** 2026-07-08
**Status:** Approved (user delegated full autonomy after Q&A)
**Owner:** jim (RYM: [~jimbof36](https://rateyourmusic.com/~jimbof36), Spotify + Anthropic + Firecrawl accounts)

## 1. Purpose

Find new music Jim will love by mining his RateYourMusic ratings and the
site's social graph (lists, list authors, charts, descriptors), then deliver
the results as Spotify playlists. Three surfaces on one engine:

- **A — Web app** (primary): browse scored recommendations with "why"
  context, Spotify embeds, playlist building, feedback actions.
- **B — Scheduled push**: a daily ~10-track playlist refreshed in Jim's
  Spotify account.
- **C — Conversational**: in-app chat backed by the Claude API
  ("warm slowcore for a rainy Sunday" → playlist), grounded in the local
  RYM graph.

## 2. Decisions locked in Q&A

| Decision | Choice |
| --- | --- |
| Data strategy | Ingest-first: local SQLite music graph; scoring runs on local queries; on-demand gap-filling scrapes for chat mode |
| RYM access | Firecrawl (validated 2026-07-07: collection pages scrape cleanly through Cloudflare). **Read-only, no RYM login** — zero account risk |
| Playlist unit | **Mode A default**: album sampler — 1–2 most-popular tracks per recommended album. Toggles: **B** artist top tracks, **C** deep cuts (popularity rank 2–4 within album) |
| Discovery methods | All five: list-mining, taste-twin mining, genre-chart mining, descriptor matching, new-release radar |
| Runtime | Local Mac now, 12-factor so hosting later is trivial (env config, SQLite file, no OS-specific assumptions outside `ops/`) |
| Conversational AI | Anthropic API in-app (`ANTHROPIC_API_KEY` in `.env`; feature degrades gracefully when absent) |
| Stack | TypeScript end-to-end: Node 20+, Hono server, React + Vite web, SQLite (better-sqlite3), Vitest, Biome |
| Firecrawl budget | **Frugal**: ~400-page initial ingest cap, small daily trickle, strict budget ledger; caps are env-tunable |
| Auto-playlist cadence | Daily (~10 tracks), rolling playlist replaced in place; "keep" action rescues tracks to a persistent playlist |
| Spotify app | Client ID `40f98cc66e5b40e6a925dfa00e5bdbb1`, PKCE (no secret), redirect `http://127.0.0.1:8787/callback` |

## 3. Architecture

npm-workspaces monorepo:

```
packages/
  core/     # domain: db schema+migrations, firecrawl client, rym parsers,
            # ingest pipeline + budget, discovery engine, spotify client,
            # playlist builder, taste profile. No HTTP server, no React.
  server/   # Hono API + PKCE OAuth callback + node-cron scheduler + serves web build
  web/      # Vite + React UI
ops/        # launchd plist, runbooks
docs/       # specs, plans
```

`core` is the engine; `server` and `web` are thin. Everything in `core` is
unit-testable without network (Firecrawl/Spotify clients injected, fixtures
for parsers).

### 3.1 Data model (SQLite)

```
albums        id, rym_url UNIQUE, artist, artist_rym_url, title, year,
              rym_avg_rating, rym_num_ratings, genres JSON, descriptors JSON,
              spotify_album_id, scraped_at (NULL until album page scraped)
my_ratings    album_id, rating REAL (3.0–5.0), rated_at
lists         id, rym_url UNIQUE, title, author_username, num_items,
              affinity REAL, scraped_at
list_items    list_id, album_id, position
twins         username PK, affinity REAL, scraped_at
twin_ratings  username, album_id, rating
charts        id, rym_url UNIQUE, kind (genre|descriptor|new), params JSON, scraped_at
chart_items   chart_id, album_id, position
candidates    album_id PK, score REAL, components JSON (per-method evidence),
              status (new|playlisted|dismissed|known), first_seen, updated_at
playlists     id, spotify_id, name, mode (sampler|top|deep), created_at
playlist_tracks playlist_id, position, spotify_track_id, album_id, kept INT
feedback      album_id, verdict (liked|disliked|known), at
scrape_queue  id, url UNIQUE, kind, priority, status (pending|done|failed), attempts
budget_ledger day TEXT PK, credits_spent INT
oauth_tokens  provider PK, access_token, refresh_token, expires_at
settings      key PK, value JSON
```

Raw scrape markdown is cached to disk (`data/cache/<sha1>.md`) so parsers can
be re-run without re-spending credits.

### 3.2 Ingest pipeline

`FirecrawlClient` wraps the Firecrawl v2 REST API. Key resolution order:
`FIRECRAWL_API_KEY` env → firecrawl-cli's local config file (already
authenticated on this machine). Concurrency 2, retry w/ backoff, every scrape
debits `budget_ledger` and refuses when the daily (`BUDGET_DAILY`, default 50)
or initial-ingest (`BUDGET_INITIAL`, default 400) cap is hit.

Page parsers (one module per page type, fixture-tested against real scrapes):

- `collection` — rating rows: album URL, artist, title, year, rating, date
- `album` — genres, descriptors, avg rating, num ratings, lists appearing on
- `list` — items + author + pagination
- `chart` — ranked albums (genre/descriptor/new-release chart URLs)
- `userCollection` — a twin's r5.0/r4.5 pages (same shape as collection)

The **crawl frontier** (`scrape_queue`) is priority-ordered so frugal budgets
spend on the highest-signal pages first:

1. Jim's 5 collection pages (+ pagination) — the seed
2. Album pages for his seeds, highest rating first (genres/descriptors/lists)
3. List pages, best expected affinity first; cap ~40 lists initially
4. Top ~10 list-authors' r5.0/r4.5 collection pages (twins)
5. Genre charts for his top genres (~15 chart pages)
6. New-release chart pages (~3, refreshed daily by the trickle budget)

TTLs: collections 7d, albums 90d, lists 30d, charts 7d, new-release 1d.
`sync` CLI command runs the frontier until budget/frontier exhaustion.

### 3.3 Taste profile

Computed from `my_ratings` × album metadata, weight = (rating − 2.5)²
(a 5.0 counts ~6× a 3.5):

- **Genre profile**: weighted genre counts, normalized
- **Descriptor profile**: same over descriptors
- **Era profile**: weighted decade histogram

Stored in `settings`, recomputed after each sync; displayed on the dashboard
and used by methods 3–5 and chat mode.

### 3.4 Discovery methods & scoring

Each method emits `(album, method, evidence, method_score ∈ [0,1])`:

1. **list-mining** (Jim's method, automated). For each seed album the lists
   it appears on are scored:
   `affinity = Σ_rated-items weight(my_rating) / sqrt(list_size)` — overlap
   with things Jim rated, normalized so 1000-item canon lists don't dominate.
   Unrated items on high-affinity lists become candidates;
   `method_score = norm(Σ affinities of lists containing it)`.
2. **taste-twin**. Twin affinity = mean of Jim's weights over co-occurring
   albums in the twin's high-rated collection (∝ how much of their 5.0 shelf
   Jim also loves). Candidates = twin's high-rated unknowns, weighted by twin
   affinity and their rating.
3. **genre-chart**. Candidates from top charts of Jim's top genres;
   `method_score = genre_affinity × chart_position_decay × rym_rating_prior`.
4. **descriptor**. Same over descriptor-filtered charts; primarily powers
   mood/genre queries in chat, but also contributes a blended signal.
5. **new-release radar**. New-music charts filtered by genre/descriptor
   profile; small recency bonus so dailies aren't all back-catalog.

**Blending**: `score = Σ_methods w_m × method_score`, default weights
(list .30, twin .25, genre .20, descriptor .15, new .10, env-tunable), plus a
diversity bonus when ≥2 independent methods agree, times an RYM quality prior
`sigmoid(rym_avg_rating, num_ratings)`. Exclusions: everything rated, marked
`known`/`dismissed`, or already playlisted recently. Same-artist-as-a-seed is
allowed but flagged ("known artist") in evidence.

Evidence is preserved verbatim in `candidates.components` so the UI can say
*"On 3 lists you love (…), and taste-twin `xyz` rated it 5.0"*.

### 3.5 Spotify integration

- **Auth**: Authorization Code + PKCE, client ID only, scopes
  `playlist-modify-private playlist-read-private`. Server route starts the
  flow; callback at `http://127.0.0.1:8787/callback`; tokens persisted &
  auto-refreshed.
- **Resolution**: album search (`artist` + `title`, fuzzy-normalized), cache
  `spotify_album_id`; fetch album tracks then full track objects for
  popularity. Unresolvable albums are marked and surfaced in UI rather than
  silently dropped.
- **Track picking**: Mode A = top-1 popularity in album (top-2 for very high
  scores); Mode B = artist top-tracks endpoint; Mode C = popularity ranks 2–4.
- **Playlists**: rolling `RYM Discoveries — Daily` replaced in place each
  push; `RYM Keepers` receives tracks the user "keeps"; ad-hoc named
  playlists from the UI/chat. Note: Spotify's deprecated
  recommendations/audio-features endpoints are NOT used — only search,
  albums, tracks, artists' top-tracks, playlists (all available to new apps).

### 3.6 Scheduler (surface B)

`node-cron` inside the server (daily 07:00 local): trickle-sync new-release
charts → rescore → build 10-track daily playlist (mode A) from top unplayed
candidates → push to Spotify. Also exposed as `npm run push-daily` CLI +
`ops/launchd/com.jim.ratemymusic.plist` so it runs even if the server app
isn't open. Every push recorded in `playlists`; failures logged, visible on
the dashboard, and non-fatal.

### 3.7 Conversational mode (surface C)

Server `/api/chat` (streamed) → Anthropic Messages API (model env-tunable,
default Sonnet) with tools:

- `get_taste_profile()` — genre/descriptor/era profiles
- `search_candidates({genres?, descriptors?, era?, min_score?, limit})` — local graph query
- `scrape_chart({kind, genre?, descriptor?, decade?})` — budget-checked gap-fill scrape
- `build_playlist({name, album_ids, mode})` — resolve + create on Spotify

System prompt carries the taste profile summary. Chat degrades to a friendly
"add ANTHROPIC_API_KEY to enable" state when the key is absent.

### 3.8 Web UI (surface A)

React + Vite, styled per the installed taste-skill design skills
(`design-taste-frontend` / `high-end-visual-design` / `minimalist-ui`).
Views: **Dashboard** (taste profile, sync/budget status, last daily push),
**Discover** (ranked candidate feed: cover art, score, evidence chips,
Spotify iframe embed, actions add-to-queue / dismiss / already-know),
**Playlists** (queue → named playlist → push; history; keep-track action),
**Chat**, **Settings** (key status, caps, cadence, mode toggle A/B/C).
Spotify iframe embeds need no OAuth.

## 3.9 Amendments from Phase 0 fixture harvest (2026-07-08)

Validated against 12 real scrapes (fixtures in `packages/core/test/fixtures/`):

- **Filtered chart URLs are unusable**: `charts/top/album/all-time/g:slowcore/`
  renders the correct title but generic top-album items (client-side XHR
  content never materializes for scrapers, even at 10 s waits). **Genre
  mining therefore uses `/genre/<slug>/` pages**, which are server-rendered
  with the genre's top ~15 albums. No positions/ratings there — order is the
  signal.
- **Descriptor method scrapes nothing**: descriptors are harvested from album
  pages already in the graph; descriptor matching is a pure local query.
  Chat-mode gap-fill scrapes genre pages, not descriptor charts.
- **Pagination formats**: collections `/collection/<user>/r4.0/2`, lists
  `/list/<user>/<slug>/2/`. Collections ~25 rows/page.
- **Very long lists** (1000s of items) lazy-load and yield ~1 item per
  scrape; parsers must tolerate this. Low-signal anyway (affinity is
  normalized by list size).
- **Empty collections render an empty table** (e.g. a user with no 5.0s) —
  parsers return zero rows, not an error.
- **New-music page** is server-rendered and rich (~40 albums w/ artist links).
- Parser lineup is thus: `collection` (also used for twins), `album`, `list`,
  `genrePage`, `newMusic`.

## 4. Error handling

- **Scrape failures**: retry ×2 w/ backoff; park as `failed` after; never
  block other frontier items. Cloudflare block ⇒ actionable dashboard notice.
- **Parser drift** (RYM redesign): parsers throw `ParseError` with the cached
  markdown path; sync surfaces count of parse failures; fixtures make repair
  a test-first exercise.
- **Budget exhaustion**: hard stop with clear UI/CLI messaging; never
  silently degrade recommendation quality without saying why.
- **Spotify 401/429**: auto-refresh, honor Retry-After; unresolvable albums
  flagged, not dropped.
- **All secrets** only in `.env` (git-ignored); `.env.example` documents keys.

## 5. Testing strategy

- **Unit (Vitest)**: parsers against real-scrape fixtures under
  `packages/core/test/fixtures/`; scoring math with hand-computed cases;
  budget ledger; track-picker modes; PKCE helpers.
- **Integration**: ingest pipeline & discovery over an in-memory SQLite +
  stubbed FirecrawlClient; server routes via Hono's test client with mocked
  Spotify/Anthropic (msw/undici mock agent).
- **UI**: Vitest + Testing Library for key components; Playwright smoke flow
  (dashboard loads, discover feed renders, playlist queue works) against a
  seeded dev DB with mocked externals.
- **CI**: GitHub Actions — typecheck, Biome, all tests on every PR.
- **Manual verification env**: seeded dev database + `.env`-driven real-mode
  run; documented in `docs/runbook.md`.

## 6. Delivery plan (phased PRs)

1. Scaffold: workspaces, TS, Biome, Vitest, CI, `.env.example`
2. `core`: schema, migrations, settings, budget ledger
3. Firecrawl client + all 5 parsers + fixture harvest (~10 real scrapes → fixtures)
4. Ingest pipeline: frontier, TTLs, `sync` CLI
5. Discovery engine: taste profile, 5 methods, blending, `candidates`
6. Spotify: PKCE, resolution, track picking, playlist push, daily scheduler + launchd
7. Server API (all routes, mocked-external integration tests)
8. Web UI
9. Chat mode
10. Ops & polish: runbook, README, end-to-end manual verification

Parallelizable after (2): {3,4,5} vs {6} vs {8 scaffold}; worktrees + subagents
per track, adversarial review on every PR before merge (jfrederick GitHub
account for PR create/merge).

## 7. Out of scope (v1)

- RYM login / posting ratings or reviews (revisit later; seam = the app's
  feedback table already captures verdicts that *could* sync someday)
- Hosting (12-factor discipline keeps the door open)
- Multi-user support
- Song-level RYM data (doesn't exist publicly)
