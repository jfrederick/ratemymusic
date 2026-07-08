import type { DatabaseType } from "../db.js";
import { getSetting, setSetting } from "../settings.js";
import type { PickedTrack, TrackPickMode } from "../types.js";
import type { SpotifyClient } from "./client.js";
import { pickTracks } from "./pick.js";
import { resolveAlbum } from "./resolve.js";

export type BuildAndPushPlaylistOptions = {
  name: string;
  albumIds: number[];
  mode: TrackPickMode;
  tracksPerAlbum?: number;
  replacePlaylistId?: string;
  description?: string;
};

export type BuildAndPushPlaylistResult = {
  spotifyPlaylistId: string;
  trackCount: number;
  unresolved: number[];
};

export async function buildAndPushPlaylist(
  db: DatabaseType,
  sp: SpotifyClient,
  o: BuildAndPushPlaylistOptions,
): Promise<BuildAndPushPlaylistResult> {
  const unresolved: number[] = [];
  const picked: PickedTrack[] = [];

  for (const albumId of o.albumIds) {
    const spotifyAlbumId = await resolveAlbum(db, sp, albumId);
    if (!spotifyAlbumId) {
      unresolved.push(albumId);
      continue;
    }

    let artistId: string | undefined;
    if (o.mode === "top") {
      const albumRow = db
        .prepare("SELECT spotify_artist_id FROM albums WHERE id = ?")
        .get(albumId) as { spotify_artist_id: string | null } | undefined;
      artistId = albumRow?.spotify_artist_id ?? undefined;
    }

    const tracks = await pickTracks(sp, {
      spotifyAlbumId,
      mode: o.mode,
      count: o.tracksPerAlbum,
      albumDbId: albumId,
      artistId,
    });
    picked.push(...tracks);
  }

  const seen = new Set<string>();
  const uniqueTracks: PickedTrack[] = [];
  for (const track of picked) {
    if (!seen.has(track.spotifyTrackId)) {
      seen.add(track.spotifyTrackId);
      uniqueTracks.push(track);
    }
  }
  const uris = uniqueTracks.map((t) => `spotify:track:${t.spotifyTrackId}`);

  let spotifyPlaylistId: string;
  if (o.replacePlaylistId) {
    spotifyPlaylistId = o.replacePlaylistId;
    await sp.replacePlaylistItems(spotifyPlaylistId, uris);
  } else {
    const created = await sp.createPlaylist({
      name: o.name,
      description: o.description,
      public: false,
    });
    spotifyPlaylistId = created.id;
    await sp.replacePlaylistItems(spotifyPlaylistId, uris);
  }

  const createdAt = new Date().toISOString();
  const playlistResult = db
    .prepare("INSERT INTO playlists (spotify_id, name, mode, created_at) VALUES (?, ?, ?, ?)")
    .run(spotifyPlaylistId, o.name, o.mode, createdAt);
  const playlistDbId = playlistResult.lastInsertRowid as number;

  const insertTrack = db.prepare(
    "INSERT INTO playlist_tracks (playlist_id, position, spotify_track_id, album_id, kept) VALUES (?, ?, ?, ?, 0)",
  );
  uniqueTracks.forEach((track, position) => {
    insertTrack.run(playlistDbId, position, track.spotifyTrackId, track.albumId);
  });

  const includedAlbumIds = new Set(picked.map((t) => t.albumId));
  const updatedAt = new Date().toISOString();
  const markPlaylisted = db.prepare(
    "UPDATE candidates SET status = 'playlisted', updated_at = ? WHERE album_id = ? AND status != 'playlisted'",
  );
  for (const albumId of includedAlbumIds) {
    markPlaylisted.run(updatedAt, albumId);
  }

  return { spotifyPlaylistId, trackCount: uniqueTracks.length, unresolved };
}

export type RollingPlaylistKey = "daily" | "keepers";

export function rollingPlaylistId(db: DatabaseType, key: RollingPlaylistKey): string | null {
  return getSetting<string>(db, `rolling_playlist_${key}`);
}

export function setRollingPlaylistId(db: DatabaseType, key: RollingPlaylistKey, id: string): void {
  setSetting(db, `rolling_playlist_${key}`, id);
}
