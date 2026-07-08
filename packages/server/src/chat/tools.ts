import type Anthropic from "@anthropic-ai/sdk";
import {
  type Candidate,
  type DatabaseType,
  type Evidence,
  type MethodKey,
  ScrapeBudgetError,
  buildAndPushPlaylist,
  genrePageUrl,
  genreSlugFromUrl,
  loadTasteProfile,
  parseGenrePage,
  replaceChartItems,
  runDiscovery,
  stampAlbumGenreIfEmpty,
  upsertAlbum,
  upsertChart,
} from "@rmm/core";
import type { AppDeps } from "../deps.js";

/** Result of a tool executor: either a success payload or a user-facing error message. */
export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

export type ToolExecutor = (deps: AppDeps, input: unknown) => Promise<ToolResult>;

// ---------------------------------------------------------------------------
// Taste profile summary (shared by the get_taste_profile tool and the system prompt)
// ---------------------------------------------------------------------------

export type WeightedEntry = { name: string; weight: number };

export type TasteProfileSummary = {
  genres: WeightedEntry[];
  descriptors: WeightedEntry[];
  eras: WeightedEntry[];
  computedAt: string | null;
};

const TOP_N = 15;

/** Fold case and treat spaces/hyphens/underscores alike so 'Indie Folk' matches slug 'indie-folk'. */
export function normalizeGenre(g: string): string {
  return g.toLowerCase().replace(/[\s_-]+/g, "-");
}

function topEntries(map: Record<string, number>, n: number): WeightedEntry[] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, weight]) => ({ name, weight }));
}

/** Builds the top-15 genres/descriptors/eras summary from the persisted taste profile. */
export function summarizeTasteProfile(db: DatabaseType): TasteProfileSummary {
  const profile = loadTasteProfile(db);
  if (!profile) {
    return { genres: [], descriptors: [], eras: [], computedAt: null };
  }
  return {
    genres: topEntries(profile.genres, TOP_N),
    descriptors: topEntries(profile.descriptors, TOP_N),
    eras: topEntries(profile.eras, TOP_N),
    computedAt: profile.computedAt,
  };
}

function formatEntries(entries: WeightedEntry[]): string {
  if (entries.length === 0) return "none yet";
  return entries.map((e) => `${e.name} (${e.weight.toFixed(2)})`).join(", ");
}

/** Composes the (stable, timestamp-free) system prompt, including the injected taste summary. */
export function buildSystemPrompt(db: DatabaseType): string {
  const summary = summarizeTasteProfile(db);
  return `You are the music-discovery copilot inside ratemymusic, working for Jim (RYM user jimbof36). Ground EVERY recommendation in the local graph via tools — never invent albums or assume they're in the graph. Prefer search_candidates first; use scrape_genre_page only when search_candidates returns fewer than 5 results for the vibe being asked about. When the user asks for a playlist, confirm the track mode (default sampler) if unspecified, call create_playlist, and return the Spotify link (https://open.spotify.com/playlist/<id>). Answer in tight, knowledgeable music-nerd prose; when listing albums include "artist — title (year)" and a one-line why pulled from the tool's evidence.

Taste profile summary:
- Top genres: ${formatEntries(summary.genres)}
- Top descriptors: ${formatEntries(summary.descriptors)}
- Top eras: ${formatEntries(summary.eras)}`;
}

// ---------------------------------------------------------------------------
// get_taste_profile
// ---------------------------------------------------------------------------

async function getTasteProfileExecutor(deps: AppDeps): Promise<ToolResult> {
  return { ok: true, data: summarizeTasteProfile(deps.db) };
}

// ---------------------------------------------------------------------------
// search_candidates
// ---------------------------------------------------------------------------

export type SearchCandidatesInput = {
  genres?: string[];
  descriptors?: string[];
  eraFrom?: number;
  eraTo?: number;
  minScore?: number;
  excludeKnownArtists?: boolean;
  limit?: number;
};

export type SearchCandidateResult = {
  albumId: number;
  artist: string;
  title: string;
  year: number | null;
  score: number;
  genres: string[];
  descriptors: string[];
  rymAvgRating: number | null;
  why: string;
};

type CandidateRow = {
  albumId: number;
  score: number;
  components: string;
  artist: string;
  title: string;
  year: number | null;
  genres: string;
  descriptors: string;
  rymAvgRating: number | null;
};

const METHOD_ORDER: MethodKey[] = ["list", "twin", "genre", "descriptor", "new"];
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 40;

function describeEvidence(evidence: Evidence): string {
  switch (evidence.method) {
    case "list": {
      if (evidence.lists.length === 0) return "";
      const noun = evidence.lists.length === 1 ? "list" : "lists";
      return `on ${evidence.lists.length} ${noun} you love (${evidence.lists[0].title})`;
    }
    case "twin": {
      if (evidence.twins.length === 0) return "";
      const top = [...evidence.twins].sort((a, b) => b.rating - a.rating)[0];
      return `taste-twin ${top.username} rated it ${top.rating.toFixed(1)}`;
    }
    case "genre": {
      if (evidence.charts.length === 0) return "";
      const top = [...evidence.charts].sort((a, b) => a.position - b.position)[0];
      return `#${top.position} in ${top.genre}`;
    }
    case "descriptor": {
      if (evidence.charts.length === 0) return "";
      const top = [...evidence.charts].sort((a, b) => a.position - b.position)[0];
      // Descriptor evidence has no real chart rank (position is always the literal placeholder
      // 0 -- see discovery/methods.ts's descriptorMethod), so showing "#0" would be misleading.
      return top.position === 0
        ? `among "${top.descriptor}" picks`
        : `#${top.position} among "${top.descriptor}" picks`;
    }
    case "new": {
      if (evidence.charts.length === 0) return "";
      const top = [...evidence.charts].sort((a, b) => a.position - b.position)[0];
      return `#${top.position} on the new-music chart`;
    }
  }
}

function buildWhy(components: Candidate["components"]): string {
  const parts: string[] = [];
  for (const key of METHOD_ORDER) {
    const component = components[key];
    if (!component) continue;
    const part = describeEvidence(component.evidence);
    if (part) parts.push(part);
  }
  return parts.length > 0 ? parts.join(" · ") : "surfaced by your taste profile";
}

async function searchCandidatesExecutor(deps: AppDeps, rawInput: unknown): Promise<ToolResult> {
  const input = (rawInput ?? {}) as SearchCandidatesInput;
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT));

  const rows = deps.db
    .prepare(
      `SELECT
         c.album_id AS albumId, c.score AS score, c.components AS components,
         a.artist AS artist, a.title AS title, a.year AS year,
         a.genres AS genres, a.descriptors AS descriptors, a.rym_avg_rating AS rymAvgRating
       FROM candidates c
       JOIN albums a ON a.id = c.album_id
       WHERE c.status = 'new'
       ORDER BY c.score DESC`,
    )
    .all() as CandidateRow[];

  let knownArtists: Set<string> | null = null;
  if (input.excludeKnownArtists) {
    const artistRows = deps.db
      .prepare(
        "SELECT DISTINCT a.artist AS artist FROM my_ratings mr JOIN albums a ON a.id = mr.album_id",
      )
      .all() as { artist: string }[];
    knownArtists = new Set(artistRows.map((r) => r.artist.toLowerCase()));
  }

  const genreNeedles = (input.genres ?? []).map((g) => normalizeGenre(g));
  const descriptorNeedles = (input.descriptors ?? []).map((d) => d.toLowerCase());

  const results: SearchCandidateResult[] = [];
  for (const row of rows) {
    if (input.minScore !== undefined && row.score < input.minScore) continue;

    if (input.eraFrom !== undefined && (row.year === null || row.year < input.eraFrom)) continue;
    if (input.eraTo !== undefined && (row.year === null || row.year > input.eraTo)) continue;

    const genres = JSON.parse(row.genres) as string[];
    const descriptors = JSON.parse(row.descriptors) as string[];
    const components = JSON.parse(row.components) as Candidate["components"];

    if (genreNeedles.length > 0) {
      const albumGenreMatch = genres.some((g) =>
        genreNeedles.some((n) => normalizeGenre(g).includes(n)),
      );
      // Most genre-chart candidates never get their own album-page scrape and so never carry
      // album-level genres at all (C1) -- fall back to the genre scoring component's chart
      // evidence, which is how they were actually surfaced.
      const genreComponent = components.genre;
      const evidenceGenreMatch =
        genreComponent?.evidence.method === "genre" &&
        genreComponent.evidence.charts.some((chart) =>
          genreNeedles.some((n) => normalizeGenre(chart.genre).includes(n)),
        );
      if (!albumGenreMatch && !evidenceGenreMatch) continue;
    }
    if (descriptorNeedles.length > 0) {
      const matches = descriptors.some((d) =>
        descriptorNeedles.some((n) => d.toLowerCase().includes(n)),
      );
      if (!matches) continue;
    }

    if (knownArtists?.has(row.artist.toLowerCase())) continue;

    results.push({
      albumId: row.albumId,
      artist: row.artist,
      title: row.title,
      year: row.year,
      score: row.score,
      genres,
      descriptors,
      rymAvgRating: row.rymAvgRating,
      why: buildWhy(components),
    });

    if (results.length >= limit) break;
  }

  return { ok: true, data: results };
}

// ---------------------------------------------------------------------------
// scrape_genre_page
// ---------------------------------------------------------------------------

export type ScrapeGenrePageInput = { genre: string };

/** Slugifies a free-text genre name into the RYM `/genre/<slug>/` path segment. */
export function slugifyGenre(genre: string): string {
  return genre
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function scrapeGenrePageExecutor(deps: AppDeps, rawInput: unknown): Promise<ToolResult> {
  const input = rawInput as Partial<ScrapeGenrePageInput> | undefined;
  const genre = input?.genre;
  if (!genre || genre.trim() === "") {
    return { ok: false, error: "genre is required" };
  }

  const slug = slugifyGenre(genre);
  const url = genrePageUrl(slug);

  let scraped: Awaited<ReturnType<AppDeps["scraper"]["scrape"]>>;
  try {
    scraped = await deps.scraper.scrape(url);
  } catch (err) {
    if (err instanceof ScrapeBudgetError) {
      return { ok: false, error: "crawl budget exhausted today" };
    }
    throw err;
  }

  const page = parseGenrePage(scraped.markdown, url);
  const scrapedAt = new Date().toISOString();
  const chartGenre = genreSlugFromUrl(url) ?? page.genre;
  const chartId = upsertChart(deps.db, {
    rymUrl: url,
    kind: "genre-page",
    params: { genre: chartGenre },
    scrapedAt,
  });
  const albumIds = page.items.map((item) => {
    const albumId = upsertAlbum(deps.db, item);
    stampAlbumGenreIfEmpty(deps.db, albumId, chartGenre);
    return albumId;
  });
  replaceChartItems(deps.db, chartId, albumIds);

  const runDiscoveryFn = deps.runDiscoveryFn ?? runDiscovery;
  const discovered = await runDiscoveryFn(deps.db, { weights: deps.config.blendWeights });

  return { ok: true, data: { newCandidates: discovered.candidates } };
}

// ---------------------------------------------------------------------------
// create_playlist
// ---------------------------------------------------------------------------

export type CreatePlaylistInput = {
  name: string;
  albumIds: number[];
  mode?: "sampler" | "top" | "deep";
};

async function createPlaylistExecutor(deps: AppDeps, rawInput: unknown): Promise<ToolResult> {
  if (!deps.spotifyAuth.isConnected() || !deps.spotify) {
    return { ok: false, error: "spotify not connected" };
  }

  const input = rawInput as Partial<CreatePlaylistInput> | undefined;
  if (!input?.name || !input.albumIds || input.albumIds.length === 0) {
    return { ok: false, error: "name and a non-empty albumIds array are required" };
  }

  const fn = deps.buildAndPushPlaylistFn ?? buildAndPushPlaylist;
  const result = await fn(deps.db, deps.spotify, {
    name: input.name,
    albumIds: input.albumIds,
    mode: input.mode ?? "sampler",
  });

  return { ok: true, data: result };
}

// ---------------------------------------------------------------------------
// Tool definitions + executor registry
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "get_taste_profile",
    description:
      "Returns a summary of Jim's taste profile: the top 15 weighted genres, descriptors, and eras derived from his RYM ratings. Call this when you need to ground a recommendation in his actual taste rather than assuming it.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_candidates",
    description:
      "Searches the local discovery graph for not-yet-known album candidates (status='new'). Matching is case-insensitive substring against each album's genre/descriptor arrays: OR within a field (any of the given genres matches), AND across fields (must match a genre AND a descriptor if both given). Always call this FIRST before scrape_genre_page — it's fast and grounded in the existing graph.",
    input_schema: {
      type: "object",
      properties: {
        genres: {
          type: "array",
          items: { type: "string" },
          description: "Genre substrings to match (OR'd together), e.g. ['slowcore', 'shoegaze'].",
        },
        descriptors: {
          type: "array",
          items: { type: "string" },
          description: "Descriptor substrings to match (OR'd together), e.g. ['melancholic'].",
        },
        eraFrom: { type: "integer", description: "Earliest release year (inclusive)." },
        eraTo: { type: "integer", description: "Latest release year (inclusive)." },
        minScore: { type: "number", description: "Minimum discovery score." },
        excludeKnownArtists: {
          type: "boolean",
          description: "Exclude candidates by artists Jim has already rated an album from.",
        },
        limit: {
          type: "integer",
          description: "Max results, default 20, capped at 40.",
        },
      },
    },
  },
  {
    name: "scrape_genre_page",
    description:
      "Gap-fill only: scrapes RYM's /genre/<slug>/ chart for a genre not well represented in the local graph, ingests any new albums, and re-runs discovery. Use this ONLY when search_candidates returns fewer than 5 results for the vibe the user asked about — it costs crawl budget.",
    input_schema: {
      type: "object",
      properties: {
        genre: { type: "string", description: "Free-text genre name, e.g. 'slowcore'." },
      },
      required: ["genre"],
    },
  },
  {
    name: "create_playlist",
    description:
      "Builds a Spotify playlist from a set of album IDs (as returned by search_candidates) and pushes it to Spotify. Confirm the track mode with the user first if they haven't specified one; default to 'sampler'.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Playlist name." },
        albumIds: {
          type: "array",
          items: { type: "integer" },
          description: "Album IDs to include.",
        },
        mode: {
          type: "string",
          enum: ["sampler", "top", "deep"],
          description: "Track-picking mode; defaults to 'sampler'.",
        },
      },
      required: ["name", "albumIds"],
    },
  },
];

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  get_taste_profile: getTasteProfileExecutor,
  search_candidates: searchCandidatesExecutor,
  scrape_genre_page: scrapeGenrePageExecutor,
  create_playlist: createPlaylistExecutor,
};
