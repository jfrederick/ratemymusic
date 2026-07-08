import { describe, expect, it, vi } from "vitest";
import { SpotifyApiError, SpotifyClient } from "../../src/spotify/client.js";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function fakeAuth(token = "test-token") {
  return { accessToken: vi.fn(async () => token) };
}

describe("SpotifyClient.searchAlbum", () => {
  it("matches after normalizing diacritics, brackets, and whitespace", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        albums: {
          items: [
            {
              id: "album-1",
              name: "Red House Painters (Rollercoaster)",
              artists: [{ id: "artist-1", name: "Red House Painters" }],
            },
          ],
        },
      }),
    );
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await sp.searchAlbum({
      artist: "Red House Painters",
      title: "Red House Painters [Rollercoaster]",
    });
    expect(result).toEqual({
      id: "album-1",
      name: "Red House Painters (Rollercoaster)",
      artistIds: ["artist-1"],
    });
  });

  it("retries unquoted when the quoted search has no items, and returns null on garbage results", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ albums: { items: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          albums: {
            items: [
              {
                id: "x",
                name: "Completely Unrelated Noise",
                artists: [{ id: "y", name: "Nobody" }],
              },
            ],
          },
        }),
      );
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await sp.searchAlbum({ artist: "Some Artist", title: "Some Title" });
    expect(result).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("SpotifyClient retry behavior", () => {
  it("honors Retry-After on 429 and succeeds after a single retry", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ id: "me-1", display_name: "Jim" }));
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    const me = await sp.me();
    expect(me).toEqual({ id: "me-1", displayName: "Jim" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(0);
  });

  it("retries once on a 5xx and succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ id: "me-1", display_name: null }));
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const me = await sp.me();
    expect(me).toEqual({ id: "me-1", displayName: null });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws SpotifyApiError immediately on a 400 with no retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(sp.me()).rejects.toThrow(SpotifyApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("SpotifyClient album/track reads", () => {
  it("paginates albumTracks beyond 50 items", async () => {
    const page1 = {
      items: Array.from({ length: 50 }, (_, i) => ({
        id: `t${i}`,
        name: `Track ${i}`,
        disc_number: 1,
        track_number: i + 1,
      })),
      next: "https://api.spotify.com/v1/albums/album-1/tracks?limit=50&offset=50",
    };
    const page2 = {
      items: [{ id: "t50", name: "Track 50", disc_number: 1, track_number: 51 }],
      next: null,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const tracks = await sp.albumTracks("album-1");
    expect(tracks).toHaveLength(51);
    expect(tracks[50]).toEqual({ id: "t50", name: "Track 50", discNumber: 1, trackNumber: 51 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("chunks tracksDetails requests by 50 ids", async () => {
    const ids = Array.from({ length: 75 }, (_, i) => `id${i}`);
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      const idsParam = u.searchParams.get("ids") ?? "";
      const requested = idsParam.split(",");
      return jsonResponse({
        tracks: requested.map((id) => ({ id, name: id, popularity: 10 })),
      });
    });
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const details = await sp.tracksDetails(ids);
    expect(details).toHaveLength(75);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("SpotifyClient playlist writes", () => {
  it("createPlaylist posts to /users/{id}/playlists", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      jsonResponse({ id: "playlist-1" }),
    );
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await sp.createPlaylist("user-1", { name: "My Playlist" });
    expect(result).toEqual({ id: "playlist-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/users/user-1/playlists");
    expect(init?.method).toBe("POST");
  });

  it("replacePlaylistItems PUTs the first 100 then POSTs the remainder in one more call", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      jsonResponse({ snapshot_id: "snap" }),
    );
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const uris = Array.from({ length: 150 }, (_, i) => `spotify:track:${i}`);
    await sp.replacePlaylistItems("playlist-1", uris);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchImpl.mock.calls[0];
    const [, secondInit] = fetchImpl.mock.calls[1];
    expect(firstInit?.method).toBe("PUT");
    expect(secondInit?.method).toBe("POST");
    expect(JSON.parse(String(firstInit?.body)).uris).toHaveLength(100);
    expect(JSON.parse(String(secondInit?.body)).uris).toHaveLength(50);
  });

  it("addPlaylistItems chunks by 100 using POST", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      jsonResponse({ snapshot_id: "snap" }),
    );
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const uris = Array.from({ length: 120 }, (_, i) => `spotify:track:${i}`);
    await sp.addPlaylistItems("playlist-1", uris);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.method).toBe("POST");
    }
  });

  it("getPlaylist returns null on 404", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }));
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(sp.getPlaylist("missing")).resolves.toBeNull();
  });

  it("getPlaylist returns id/name when found", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "playlist-1", name: "Daily" }));
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(sp.getPlaylist("playlist-1")).resolves.toEqual({
      id: "playlist-1",
      name: "Daily",
    });
  });
});

describe("SpotifyClient.artistTopTracks", () => {
  it("returns mapped top tracks", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        tracks: [
          { id: "t1", name: "Hit", popularity: 90 },
          { id: "t2", name: "B-side", popularity: 40 },
        ],
      }),
    );
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const tracks = await sp.artistTopTracks("artist-1");
    expect(tracks).toEqual([
      { id: "t1", name: "Hit", popularity: 90 },
      { id: "t2", name: "B-side", popularity: 40 },
    ]);
  });
});
