# ratemymusic

Mines your [RateYourMusic](https://rateyourmusic.com) rating history, lists, and taste
neighborhood to discover albums you're likely to love, then builds Spotify playlists from the
results.

## Monorepo layout

- `packages/core` (`@rmm/core`) — domain types, database, scraping/parsing, discovery engine,
  Spotify integration. Framework-agnostic, importable by the server.
- `packages/server` (`@rmm/server`) — Hono API server exposing the ingest/discovery/playlist
  endpoints and serving the web UI.
- `packages/web` (`@rmm/web`) — Vite + React frontend for browsing candidates and building
  playlists.

## Getting started

```bash
npm install
cp .env.example .env   # fill in FIRECRAWL_API_KEY, ANTHROPIC_API_KEY, etc.
npm test
npm run check           # biome lint/format check + typecheck across workspaces
```

## Docs

- Design spec: [`docs/superpowers/specs/2026-07-08-ratemymusic-design.md`](docs/superpowers/specs/2026-07-08-ratemymusic-design.md)
- Roadmap: [`docs/superpowers/plans/2026-07-08-ratemymusic-roadmap.md`](docs/superpowers/plans/2026-07-08-ratemymusic-roadmap.md)
