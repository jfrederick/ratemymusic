import { describe, expect, it, vi } from "vitest";
import { pickTracks } from "../../src/spotify/pick.js";

function fakeClient(o: {
  albumTracks: { id: string; name: string; discNumber: number; trackNumber: number }[];
  popularities: Record<string, number>;
}) {
  return {
    albumTracks: vi.fn(async () => o.albumTracks),
    tracksDetails: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, name: `name-${id}`, popularity: o.popularities[id] ?? 0 })),
    ),
  } as unknown as import("../../src/spotify/client.js").SpotifyClient;
}

describe("pickTracks sampler mode", () => {
  it("picks the most popular track by default", async () => {
    const sp = fakeClient({
      albumTracks: [
        { id: "t1", name: "One", discNumber: 1, trackNumber: 1 },
        { id: "t2", name: "Two", discNumber: 1, trackNumber: 2 },
        { id: "t3", name: "Three", discNumber: 1, trackNumber: 3 },
      ],
      popularities: { t1: 40, t2: 90, t3: 60 },
    });
    const picks = await pickTracks(sp, {
      spotifyAlbumId: "album-1",
      mode: "sampler",
      albumDbId: 7,
    });
    expect(picks).toEqual([{ spotifyTrackId: "t2", name: "name-t2", albumId: 7, popularity: 90 }]);
  });

  it("respects a custom count", async () => {
    const sp = fakeClient({
      albumTracks: [
        { id: "t1", name: "One", discNumber: 1, trackNumber: 1 },
        { id: "t2", name: "Two", discNumber: 1, trackNumber: 2 },
        { id: "t3", name: "Three", discNumber: 1, trackNumber: 3 },
      ],
      popularities: { t1: 40, t2: 90, t3: 60 },
    });
    const picks = await pickTracks(sp, {
      spotifyAlbumId: "album-1",
      mode: "sampler",
      count: 2,
      albumDbId: 7,
    });
    expect(picks.map((p) => p.spotifyTrackId)).toEqual(["t2", "t3"]);
  });
});

describe("pickTracks deep mode", () => {
  it("skips the hit and picks ranks 2-4", async () => {
    const sp = fakeClient({
      albumTracks: [
        { id: "a", name: "A", discNumber: 1, trackNumber: 1 },
        { id: "b", name: "B", discNumber: 1, trackNumber: 2 },
        { id: "c", name: "C", discNumber: 1, trackNumber: 3 },
        { id: "d", name: "D", discNumber: 1, trackNumber: 4 },
      ],
      popularities: { a: 80, b: 60, c: 50, d: 40 },
    });
    const picks = await pickTracks(sp, { spotifyAlbumId: "album-1", mode: "deep", albumDbId: 7 });
    expect(picks).toEqual([{ spotifyTrackId: "b", name: "name-b", albumId: 7, popularity: 60 }]);
  });

  it("falls back to the top track when the album has 2 or fewer tracks", async () => {
    const sp = fakeClient({
      albumTracks: [
        { id: "a", name: "A", discNumber: 1, trackNumber: 1 },
        { id: "b", name: "B", discNumber: 1, trackNumber: 2 },
      ],
      popularities: { a: 80, b: 60 },
    });
    const picks = await pickTracks(sp, { spotifyAlbumId: "album-1", mode: "deep", albumDbId: 7 });
    expect(picks).toEqual([{ spotifyTrackId: "a", name: "name-a", albumId: 7, popularity: 80 }]);
  });
});

// Spotify removed GET /artists/{id}/top-tracks (Feb 2026 migration), so 'top' mode now behaves
// exactly like 'sampler' — popularity-ranked album tracks — just defaulting to 2 picks instead
// of 1.
describe("pickTracks top mode (degraded to sampler behavior post Feb 2026)", () => {
  it("picks the top 2 most popular album tracks by default", async () => {
    const sp = fakeClient({
      albumTracks: [
        { id: "t1", name: "One", discNumber: 1, trackNumber: 1 },
        { id: "t2", name: "Two", discNumber: 1, trackNumber: 2 },
        { id: "t3", name: "Three", discNumber: 1, trackNumber: 3 },
      ],
      popularities: { t1: 40, t2: 90, t3: 60 },
    });
    const picks = await pickTracks(sp, { spotifyAlbumId: "album-1", mode: "top", albumDbId: 9 });
    expect(picks).toEqual([
      { spotifyTrackId: "t2", name: "name-t2", albumId: 9, popularity: 90 },
      { spotifyTrackId: "t3", name: "name-t3", albumId: 9, popularity: 60 },
    ]);
  });

  it("respects a custom count, same as sampler", async () => {
    const sp = fakeClient({
      albumTracks: [
        { id: "t1", name: "One", discNumber: 1, trackNumber: 1 },
        { id: "t2", name: "Two", discNumber: 1, trackNumber: 2 },
      ],
      popularities: { t1: 30, t2: 70 },
    });
    const picks = await pickTracks(sp, {
      spotifyAlbumId: "album-1",
      mode: "top",
      count: 1,
      albumDbId: 3,
    });
    expect(picks).toEqual([{ spotifyTrackId: "t2", name: "name-t2", albumId: 3, popularity: 70 }]);
  });
});
