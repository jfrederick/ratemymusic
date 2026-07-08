# RYM scrape fixtures

Harvested 2026-07-08 via Firecrawl (`--wait-for 3000-10000`). Raw markdown as
returned; parsers must handle these shapes verbatim. See spec §3.9 for
structural findings.

| File | Source URL | Notes |
| --- | --- | --- |
| collection-r5.0.md | /collection/jimbof36/r5.0 | 8 albums, single page |
| collection-r4.5.md | /collection/jimbof36/r4.5 | single page |
| collection-r4.0.md | /collection/jimbof36/r4.0 | paginated: `Page 1 [2](...r4.0/2) [3](...)` |
| album-for-emma.md | /release/album/bon-iver/for-emma-forever-ago/ | genres, 37 descriptors, RYM 3.82/27931, 16 list links |
| album-souvlaki.md | /release/album/slowdive/souvlaki/ | second album shape |
| list-dark-winter.md | /list/GentlemanCritic/dark-winter/ | 45 items/page, paginated `/2/` |
| list-top-releases.md | /list/JesseAaron/top-releases-of-all-time/ | DEGENERATE: long list lazy-loads, only 1 item rendered |
| user-collection-r5.md | /collection/GentlemanCritic/r5.0 | DEGENERATE: empty table (user has no 5.0s) |
| user-collection-jesseaaron-r5.md | /collection/JesseAaron/r5.0 | twin collection, ~11 albums |
| genre-slowcore.md | /genre/slowcore/ | server-rendered top ~16 slowcore albums |
| new-music.md | /new-music/ | ~40 new releases w/ artist links |
| chart-genre-slowcore.md | /charts/top/album/all-time/g:slowcore/ | DECOY: title says slowcore, items are generic top albums — kept as anti-fixture |
