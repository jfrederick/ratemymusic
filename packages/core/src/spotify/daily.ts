import type { DatabaseType } from "../db.js";
import type { TrackPickMode } from "../types.js";
import type { SpotifyClient } from "./client.js";
import { buildAndPushPlaylist, rollingPlaylistId, setRollingPlaylistId } from "./playlist.js";

const DAILY_PLAYLIST_NAME = "RYM Discoveries — Daily";

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function pushDaily(
  db: DatabaseType,
  sp: SpotifyClient,
  o: { size?: number; mode?: TrackPickMode; today?: () => string } = {},
): Promise<{ spotifyPlaylistId: string; trackCount: number; albums: number[] }> {
  const size = o.size ?? 10;
  const mode = o.mode ?? "sampler";
  const today = o.today ?? defaultToday;

  const rows = db
    .prepare("SELECT album_id FROM candidates WHERE status = 'new' ORDER BY score DESC LIMIT ?")
    .all(size) as { album_id: number }[];

  if (rows.length === 0) {
    throw new Error("No eligible candidates to push to the daily playlist");
  }

  const albumIds = rows.map((r) => r.album_id);

  let replacePlaylistId: string | undefined;
  const existingId = rollingPlaylistId(db, "daily");
  if (existingId) {
    const existing = await sp.getPlaylist(existingId);
    if (existing) {
      replacePlaylistId = existingId;
    }
  }

  const result = await buildAndPushPlaylist(db, sp, {
    name: DAILY_PLAYLIST_NAME,
    albumIds,
    mode,
    replacePlaylistId,
    description: `Auto-built ${today()} by ratemymusic from your RateYourMusic taste graph.`,
  });

  setRollingPlaylistId(db, "daily", result.spotifyPlaylistId);

  return {
    spotifyPlaylistId: result.spotifyPlaylistId,
    trackCount: result.trackCount,
    albums: albumIds,
  };
}
