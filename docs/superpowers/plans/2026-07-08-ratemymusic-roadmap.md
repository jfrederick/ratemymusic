# ratemymusic Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement phase-by-phase. Each phase gets a detailed just-in-time plan brief at dispatch; this document locks the cross-phase contracts those briefs must honor. Spec: `docs/superpowers/specs/2026-07-08-ratemymusic-design.md`.

**Goal:** RYM-mining music discovery engine with web UI, daily Spotify playlist push, and Claude-powered chat — local-first TypeScript monorepo.

**Architecture:** `packages/core` (SQLite graph + ingest + discovery + Spotify, no HTTP), `packages/server` (Hono API + scheduler), `packages/web` (React/Vite). Ingest-first: Firecrawl scrapes populate the graph; scoring runs locally.

**Tech Stack:** Node ≥20, TypeScript strict, npm workspaces, better-sqlite3, Hono, React 18 + Vite, Vitest, Biome, node-cron, @anthropic-ai/sdk.

## Global Constraints

- Node ≥ 20, ESM everywhere (`"type": "module"`)
- TypeScript `strict: true`; no `any` in exported signatures
- Package names: `@rmm/core`, `@rmm/server`, `@rmm/web`
- DB file: `data/rmm.sqlite` (env `RMM_DB_PATH` overrides; `:memory:` in tests)
- Scrape cache dir: `data/cache/` — raw markdown at `<sha1(url)>.md`
- Env (all read via `packages/core/src/config.ts` only): `SPOTIFY_CLIENT_ID` (default `40f98cc66e5b40e6a925dfa00e5bdbb1`), `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`, `BUDGET_DAILY` (50), `BUDGET_INITIAL` (400), `PORT` (8787), `RMM_DB_PATH`, `RYM_USERNAME` (`jimbof36`), `BLEND_WEIGHTS` (JSON, default `{"list":0.30,"twin":0.25,"genre":0.20,"descriptor":0.15,"new":0.10}`)
- RYM: read-only public pages only; never authenticate; Firecrawl concurrency ≤ 2
- Spotify: PKCE only (no client secret); never call deprecated endpoints (recommendations, audio-features, related-artists)
- Ratings scale stored as REAL 0.5–5.0; taste weight formula `(rating - 2.5)²` clamped ≥ 0
- All external HTTP behind injectable clients; tests never hit the network
- Commit style: conventional (`feat:`, `fix:`, `test:`, `chore:`); every PR green on CI before merge

## Locked cross-phase contracts (types live in `packages/core/src/types.ts`)

```ts
// Identity: albums keyed by canonical RYM release URL (path only, trailing slash, lowercase)
export type AlbumRef = { rymUrl: string; artist: string; title: string; year: number | null };
export type Album = AlbumRef & {
  id: number; artistRymUrl: string | null; rymAvgRating: number | null;
  rymNumRatings: number | null; genres: string[]; descriptors: string[];
  spotifyAlbumId: string | null; scrapedAt: string | null;
};
export type MyRating = { albumId: number; rating: number; ratedAt: string | null };
export type MethodKey = 'list' | 'twin' | 'genre' | 'descriptor' | 'new';
export type Evidence =
  | { method: 'list'; lists: { rymUrl: string; title: string; affinity: number }[] }
  | { method: 'twin'; twins: { username: string; affinity: number; rating: number }[] }
  | { method: 'genre'; charts: { rymUrl: string; genre: string; position: number }[] }
  | { method: 'descriptor'; charts: { rymUrl: string; descriptor: string; position: number }[] }
  | { method: 'new'; charts: { rymUrl: string; position: number }[] };
export type Candidate = {
  albumId: number; score: number; components: Partial<Record<MethodKey, { score: number; evidence: Evidence }>>;
  status: 'new' | 'playlisted' | 'dismissed' | 'known';
};
export type TasteProfile = {
  genres: Record<string, number>; descriptors: Record<string, number>;
  eras: Record<string, number>; computedAt: string;   // eras keyed '1960s'.. ; values normalized 0..1
};
export type ScrapeResult = { url: string; markdown: string; links: string[]; cachePath: string; fromCache: boolean };
export interface Scraper { scrape(url: string, opts?: { maxAgeDays?: number }): Promise<ScrapeResult>; }
export type TrackPickMode = 'sampler' | 'top' | 'deep';
export type PickedTrack = { spotifyTrackId: string; name: string; albumId: number; popularity: number };
```

Key module entry points (exact exported names later phases rely on):

- PR2 `@rmm/core`: `openDb(path?): Database` (runs migrations), `BudgetLedger` (`canSpend(n): boolean`, `spend(n, day?)`, `spentToday()`, `spentTotal()`), `getSetting/setSetting`
- PR3 `@rmm/core`: `FirecrawlScraper implements Scraper`; parsers `parseCollectionPage(md): { items: (AlbumRef & { rating: number; ratedAt: string | null })[]; nextPageUrl: string | null }`, `parseAlbumPage(md): { genres: string[]; descriptors: string[]; avgRating: number | null; numRatings: number | null; listAppearances: { rymUrl: string; title: string }[] }`, `parseListPage(md): { title: string; author: string; items: AlbumRef[]; nextPageUrl: string | null }`, `parseChartPage(md): { items: (AlbumRef & { position: number; avgRating: number | null; numRatings: number | null })[]; nextPageUrl: string | null }` (userCollection reuses parseCollectionPage)
- PR4 `@rmm/core`: `runSync(db, scraper, opts?: { maxPages?: number }): Promise<SyncReport>`
- PR5 `@rmm/core`: `computeTasteProfile(db): TasteProfile`, `runDiscovery(db): Promise<{ candidates: number }>` (upserts `candidates`)
- PR6 `@rmm/core`: `SpotifyClient` (injectable fetch), `resolveAlbum(db, sp, albumId): Promise<string | null>`, `pickTracks(sp, spotifyAlbumId, mode, artistId?): Promise<PickedTrack[]>`, `buildAndPushPlaylist(db, sp, opts: { name: string; albumIds: number[]; mode: TrackPickMode; replacePlaylistId?: string }): Promise<{ spotifyPlaylistId: string; trackCount: number }>`
- PR7 `@rmm/server`: `createApp(deps): Hono` — deps = `{ db, scraper, spotify, anthropic? }` all injectable

## Phases & parallelization

| Phase | Task # | Depends on | Track |
| --- | --- | --- | --- |
| 0 fixtures (inline, main) | 1 | — | main |
| PR1 scaffold | 2 | — | main |
| PR2 core schema | 3 | PR1 | main |
| PR3 firecrawl+parsers | 4 | P0, PR2 | **track-ingest** (worktree) |
| PR4 ingest pipeline | 5 | PR3 | track-ingest |
| PR5 discovery engine | 6 | PR4 | track-ingest |
| PR6 spotify | 7 | PR2 | **track-spotify** (worktree, parallel with PR3–5) |
| PR7 server API | 8 | PR5, PR6 | main |
| PR8 web UI | 9 | PR2 (API mocked; final wiring after PR7) | **track-web** (worktree, parallel) |
| PR9 chat | 10 | PR7 | main |
| PR10 ops+E2E | 11 | PR8, PR9 | main |

Process per phase: worktree branch → implementer subagent(s) with TDD brief → adversarial review (code-review skill + spec-compliance check) → fix → PR → merge (gh as `jfrederick`) → next.

## Verification gates

- Every PR: `npm run check` (biome + tsc) and `npm test` green in CI
- PR10 exit criteria: real ingest populated ≥ 200 albums; discovery produces ≥ 50 scored candidates with evidence; real Spotify playlist created with ≥ 8 tracks; web UI browsable at :8787; daily cron dry-run verified; runbook complete
