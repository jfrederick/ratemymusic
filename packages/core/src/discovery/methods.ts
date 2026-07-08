import type { DatabaseType } from "../db.js";
import type { Evidence, TasteProfile } from "../types.js";
import { knownAlbumIds, normalizeScores, positionDecay, ratingWeight } from "./weights.js";

type MethodResult = Map<number, { score: number; evidence: Evidence }>;

const TOP_N_EVIDENCE = 5;

/** For each candidate album, sums the affinity of every non-known-excluding list it appears on. */
export function listMethod(db: DatabaseType): MethodResult {
  const known = knownAlbumIds(db);
  const lists = db
    .prepare("SELECT id, rym_url, title, affinity FROM lists WHERE affinity > 0")
    .all() as {
    id: number;
    rym_url: string;
    title: string;
    affinity: number;
  }[];

  const raw = new Map<number, number>();
  const perAlbumLists = new Map<number, { rymUrl: string; title: string; affinity: number }[]>();

  if (lists.length > 0) {
    const listById = new Map(lists.map((l) => [l.id, l]));
    const placeholders = lists.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT album_id, list_id FROM list_items WHERE list_id IN (${placeholders})`)
      .all(...lists.map((l) => l.id)) as { album_id: number; list_id: number }[];

    for (const row of rows) {
      if (known.has(row.album_id)) continue;
      const list = listById.get(row.list_id);
      if (!list) continue;
      raw.set(row.album_id, (raw.get(row.album_id) ?? 0) + list.affinity);
      const arr = perAlbumLists.get(row.album_id) ?? [];
      arr.push({ rymUrl: list.rym_url, title: list.title, affinity: list.affinity });
      perAlbumLists.set(row.album_id, arr);
    }
  }

  const normalized = normalizeScores(raw);
  const result: MethodResult = new Map();
  for (const [albumId, score] of normalized) {
    const top = (perAlbumLists.get(albumId) ?? [])
      .sort((a, b) => b.affinity - a.affinity)
      .slice(0, TOP_N_EVIDENCE);
    result.set(albumId, { score, evidence: { method: "list", lists: top } });
  }
  return result;
}

/** Computes (and persists to `twins.affinity`) each twin's affinity, then scores candidates. */
export function twinMethod(db: DatabaseType): MethodResult {
  const known = knownAlbumIds(db);
  const twins = db.prepare("SELECT username FROM twins").all() as { username: string }[];

  const twinAffinity = new Map<string, number>();
  const coRatedStmt = db.prepare(
    `SELECT tr.rating AS their_rating, mr.rating AS my_rating
     FROM twin_ratings tr
     JOIN my_ratings mr ON mr.album_id = tr.album_id
     WHERE tr.username = ?`,
  );
  const countStmt = db.prepare("SELECT COUNT(*) AS c FROM twin_ratings WHERE username = ?");
  const updateAffinityStmt = db.prepare("UPDATE twins SET affinity = ? WHERE username = ?");

  for (const { username } of twins) {
    const coRated = coRatedStmt.all(username) as { their_rating: number; my_rating: number }[];
    const count = (countStmt.get(username) as { c: number }).c;
    const sum = coRated.reduce(
      (acc, row) => acc + Math.min(ratingWeight(row.my_rating), ratingWeight(row.their_rating)),
      0,
    );
    const affinity = sum / Math.sqrt(Math.max(count, 1));
    twinAffinity.set(username, affinity);
    updateAffinityStmt.run(affinity, username);
  }

  const raw = new Map<number, number>();
  const perAlbumTwins = new Map<number, { username: string; affinity: number; rating: number }[]>();
  const highRatings = db
    .prepare("SELECT username, album_id, rating FROM twin_ratings WHERE rating >= 4.0")
    .all() as { username: string; album_id: number; rating: number }[];

  for (const row of highRatings) {
    if (known.has(row.album_id)) continue;
    const affinity = twinAffinity.get(row.username) ?? 0;
    const contribution = affinity * ratingWeight(row.rating);
    raw.set(row.album_id, (raw.get(row.album_id) ?? 0) + contribution);
    const arr = perAlbumTwins.get(row.album_id) ?? [];
    arr.push({ username: row.username, affinity, rating: row.rating });
    perAlbumTwins.set(row.album_id, arr);
  }

  const normalized = normalizeScores(raw);
  const result: MethodResult = new Map();
  for (const [albumId, score] of normalized) {
    const top = (perAlbumTwins.get(albumId) ?? [])
      .sort((a, b) => b.affinity - a.affinity)
      .slice(0, TOP_N_EVIDENCE);
    result.set(albumId, { score, evidence: { method: "twin", twins: top } });
  }
  return result;
}

/** Fold case and treat spaces/hyphens/underscores alike so profile name 'Indie Folk' matches chart slug 'indie-folk'. */
function genreKey(g: string): string {
  return g.toLowerCase().replace(/[\s_-]+/g, "-");
}

/** Scores candidates from `genre-page` charts by genre affinity (slug/name-folded) x position decay. */
export function genreMethod(db: DatabaseType, profile: TasteProfile): MethodResult {
  const known = knownAlbumIds(db);
  const genreLookup = new Map<string, number>();
  for (const [genre, value] of Object.entries(profile.genres)) {
    genreLookup.set(genreKey(genre), value);
  }

  const charts = db
    .prepare("SELECT id, rym_url, params FROM charts WHERE kind = 'genre-page'")
    .all() as { id: number; rym_url: string; params: string }[];

  const raw = new Map<number, number>();
  const perAlbumCharts = new Map<number, { rymUrl: string; genre: string; position: number }[]>();

  for (const chart of charts) {
    const params = JSON.parse(chart.params) as { genre?: string };
    const genreName = params.genre ?? "";
    const genreAffinity = genreLookup.get(genreKey(genreName)) ?? 0;
    if (genreAffinity === 0) continue;

    const items = db
      .prepare("SELECT album_id, position FROM chart_items WHERE chart_id = ?")
      .all(chart.id) as { album_id: number; position: number | null }[];

    for (const item of items) {
      if (known.has(item.album_id)) continue;
      const position = item.position ?? 0;
      const contribution = genreAffinity * positionDecay(position);
      raw.set(item.album_id, (raw.get(item.album_id) ?? 0) + contribution);
      const arr = perAlbumCharts.get(item.album_id) ?? [];
      arr.push({ rymUrl: chart.rym_url, genre: genreName, position });
      perAlbumCharts.set(item.album_id, arr);
    }
  }

  const normalized = normalizeScores(raw);
  const result: MethodResult = new Map();
  for (const [albumId, score] of normalized) {
    const top = (perAlbumCharts.get(albumId) ?? [])
      .sort((a, b) => a.position - b.position)
      .slice(0, TOP_N_EVIDENCE);
    result.set(albumId, { score, evidence: { method: "genre", charts: top } });
  }
  return result;
}

/**
 * Pure local method: scores non-known albums that have descriptors by how well those
 * descriptors match the taste profile. Albums with no descriptors are never scored.
 *
 * Evidence type is locked to `{ charts: [...] }`; matched descriptors are packed into that
 * shape as `{ rymUrl: '', descriptor, position: 0 }` (UI renders chips from `.descriptor`).
 */
export function descriptorMethod(db: DatabaseType, profile: TasteProfile): MethodResult {
  const known = knownAlbumIds(db);
  const albums = db.prepare("SELECT id, descriptors FROM albums").all() as {
    id: number;
    descriptors: string;
  }[];

  const raw = new Map<number, number>();
  const perAlbumDescriptors = new Map<number, { descriptor: string; contribution: number }[]>();

  for (const album of albums) {
    if (known.has(album.id)) continue;
    const descriptors = JSON.parse(album.descriptors) as string[];
    if (descriptors.length === 0) continue;

    let sum = 0;
    const contributions: { descriptor: string; contribution: number }[] = [];
    for (const descriptor of descriptors) {
      const value = profile.descriptors[descriptor] ?? 0;
      sum += value;
      contributions.push({ descriptor, contribution: value });
    }
    const score = sum / Math.sqrt(Math.max(descriptors.length, 1));
    raw.set(album.id, score);
    perAlbumDescriptors.set(album.id, contributions);
  }

  const normalized = normalizeScores(raw);
  const result: MethodResult = new Map();
  for (const [albumId, score] of normalized) {
    const top = (perAlbumDescriptors.get(albumId) ?? [])
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, TOP_N_EVIDENCE)
      .map((c) => ({ rymUrl: "", descriptor: c.descriptor, position: 0 }));
    result.set(albumId, { score, evidence: { method: "descriptor", charts: top } });
  }
  return result;
}

/**
 * Scores candidates from `new` charts by position decay x genre overlap with the taste
 * profile, with a 0.15 floor so genre-unknown new releases still surface.
 */
export function newMethod(db: DatabaseType, profile: TasteProfile): MethodResult {
  const GENRE_UNKNOWN_FLOOR = 0.15;
  const known = knownAlbumIds(db);
  const charts = db.prepare("SELECT id, rym_url FROM charts WHERE kind = 'new'").all() as {
    id: number;
    rym_url: string;
  }[];

  const raw = new Map<number, number>();
  const perAlbumCharts = new Map<number, { rymUrl: string; position: number; score: number }[]>();

  for (const chart of charts) {
    const items = db
      .prepare(
        `SELECT ci.album_id AS album_id, ci.position AS position, a.genres AS genres
         FROM chart_items ci
         JOIN albums a ON a.id = ci.album_id
         WHERE ci.chart_id = ?`,
      )
      .all(chart.id) as { album_id: number; position: number | null; genres: string }[];

    for (const item of items) {
      if (known.has(item.album_id)) continue;
      const genres = JSON.parse(item.genres) as string[];
      const genreOverlap =
        genres.length > 0
          ? genres.reduce((acc, g) => acc + (profile.genres[g] ?? 0), 0) / genres.length
          : 0;
      const position = item.position ?? 0;
      const contribution = positionDecay(position) * Math.max(genreOverlap, GENRE_UNKNOWN_FLOOR);
      raw.set(item.album_id, (raw.get(item.album_id) ?? 0) + contribution);
      const arr = perAlbumCharts.get(item.album_id) ?? [];
      arr.push({ rymUrl: chart.rym_url, position, score: contribution });
      perAlbumCharts.set(item.album_id, arr);
    }
  }

  const normalized = normalizeScores(raw);
  const result: MethodResult = new Map();
  for (const [albumId, score] of normalized) {
    const top = (perAlbumCharts.get(albumId) ?? [])
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N_EVIDENCE)
      .map((c) => ({ rymUrl: c.rymUrl, position: c.position }));
    result.set(albumId, { score, evidence: { method: "new", charts: top } });
  }
  return result;
}
