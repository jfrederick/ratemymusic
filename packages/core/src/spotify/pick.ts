import type { PickedTrack, TrackPickMode } from "../types.js";
import type { SpotifyClient } from "./client.js";

type PickOptions = {
  spotifyAlbumId: string;
  mode: TrackPickMode;
  count?: number;
  albumDbId: number;
};

type RankedTrack = { id: string; name: string; popularity: number };

async function popularityRanked(sp: SpotifyClient, spotifyAlbumId: string): Promise<RankedTrack[]> {
  const tracks = await sp.albumTracks(spotifyAlbumId);
  const details = await sp.tracksDetails(tracks.map((t) => t.id));
  const detailsById = new Map(details.map((d) => [d.id, d]));
  const merged = tracks.map((t) => {
    const detail = detailsById.get(t.id);
    return { id: t.id, name: detail?.name ?? t.name, popularity: detail?.popularity ?? 0 };
  });
  return merged.sort((a, b) => b.popularity - a.popularity);
}

function toPicked(items: RankedTrack[], albumDbId: number): PickedTrack[] {
  return items.map((item) => ({
    spotifyTrackId: item.id,
    name: item.name,
    albumId: albumDbId,
    popularity: item.popularity,
  }));
}

async function pickSampler(sp: SpotifyClient, o: PickOptions): Promise<PickedTrack[]> {
  const count = o.count ?? 1;
  const ranked = await popularityRanked(sp, o.spotifyAlbumId);
  return toPicked(ranked.slice(0, count), o.albumDbId);
}

// Spotify removed GET /artists/{id}/top-tracks (bare 403) in the Feb 2026 Web API migration,
// with no replacement endpoint. 'top' mode therefore degrades to the same popularity-ranked
// album-track picking as 'sampler', just defaulting to 2 tracks instead of 1. The mode is kept
// distinct (rather than folded into 'sampler') because TrackPickMode is a locked type with a
// matching db CHECK constraint, and the API/UI must keep accepting 'top' as a selectable value.
async function pickTop(sp: SpotifyClient, o: PickOptions): Promise<PickedTrack[]> {
  const count = o.count ?? 2;
  const ranked = await popularityRanked(sp, o.spotifyAlbumId);
  return toPicked(ranked.slice(0, count), o.albumDbId);
}

async function pickDeep(sp: SpotifyClient, o: PickOptions): Promise<PickedTrack[]> {
  const count = o.count ?? 1;
  const ranked = await popularityRanked(sp, o.spotifyAlbumId);
  if (ranked.length <= 2) {
    return toPicked(ranked.slice(0, 1), o.albumDbId);
  }
  const deepCuts = ranked.slice(1, 4);
  return toPicked(deepCuts.slice(0, count), o.albumDbId);
}

export async function pickTracks(sp: SpotifyClient, o: PickOptions): Promise<PickedTrack[]> {
  switch (o.mode) {
    case "sampler":
      return pickSampler(sp, o);
    case "top":
      return pickTop(sp, o);
    case "deep":
      return pickDeep(sp, o);
    default: {
      const exhaustive: never = o.mode;
      throw new Error(`Unknown track pick mode: ${String(exhaustive)}`);
    }
  }
}
