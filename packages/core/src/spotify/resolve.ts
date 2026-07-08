import type { DatabaseType } from "../db.js";
import { getSetting, setSetting } from "../settings.js";
import type { SpotifyClient } from "./client.js";

const UNRESOLVED_KEY = "spotify_unresolved";

type UnresolvedEntry = { albumId: number; at: string };

export async function resolveAlbum(
  db: DatabaseType,
  sp: SpotifyClient,
  albumId: number,
): Promise<string | null> {
  const row = db
    .prepare("SELECT spotify_album_id, artist, title FROM albums WHERE id = ?")
    .get(albumId) as { spotify_album_id: string | null; artist: string; title: string } | undefined;
  if (!row) return null;
  if (row.spotify_album_id) return row.spotify_album_id;

  const result = await sp.searchAlbum({ artist: row.artist, title: row.title });
  if (result) {
    db.prepare("UPDATE albums SET spotify_album_id = ?, spotify_artist_id = ? WHERE id = ?").run(
      result.id,
      result.artistIds[0] ?? null,
      albumId,
    );
    return result.id;
  }

  const existing = getSetting<UnresolvedEntry[]>(db, UNRESOLVED_KEY) ?? [];
  const entry: UnresolvedEntry = { albumId, at: new Date().toISOString() };
  setSetting(db, UNRESOLVED_KEY, [...existing, entry]);
  return null;
}
