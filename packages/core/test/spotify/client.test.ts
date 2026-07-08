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
  it("keeps retrying 429s (up to 5) honoring Retry-After", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ id: "me-id", display_name: "Me" }));
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    const me = await sp.me();
    expect(me.id).toBe("me-id");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

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

  it("fetches tracksDetails per-id (batch /tracks?ids= was removed Feb 2026) and preserves input order", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `id${i}`);
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      expect(u.pathname).toMatch(/^\/v1\/tracks\/id\d+$/);
      const id = u.pathname.split("/").pop() as string;
      return jsonResponse({ id, name: `name-${id}`, popularity: Number(id.replace("id", "")) });
    });
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const details = await sp.tracksDetails(ids);
    expect(fetchImpl).toHaveBeenCalledTimes(9);
    expect(details.map((d) => d.id)).toEqual(ids);
    expect(details).toEqual(
      ids.map((id) => ({ id, name: `name-${id}`, popularity: Number(id.replace("id", "")) })),
    );
  });

  it("caps tracksDetails concurrency at 2 in-flight requests", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ids = Array.from({ length: 10 }, (_, i) => `id${i}`);
    const fetchImpl = vi.fn(async (url: string | URL) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      const id = String(url).split("/").pop() as string;
      return jsonResponse({ id, name: id, popularity: 0 });
    });
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await sp.tracksDetails(ids);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("retries a single track fetch on 429 via the existing backoff", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ id: "id0", name: "Track", popularity: 42 }));
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    const details = await sp.tracksDetails(["id0"]);
    expect(details).toEqual([{ id: "id0", name: "Track", popularity: 42 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(0);
  });
});

describe("SpotifyClient playlist writes", () => {
  it("createPlaylist posts to /me/playlists (legacy /users/{id} form 403s on newer apps)", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      jsonResponse({ id: "playlist-1" }),
    );
    const sp = new SpotifyClient({
      auth: fakeAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await sp.createPlaylist({ name: "My Playlist" });
    expect(result).toEqual({ id: "playlist-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/me/playlists");
    expect(init?.method).toBe("POST");
  });

  it("replacePlaylistItems PUTs the first 100 then POSTs the remainder to /playlists/{id}/items", async () => {
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
    const [firstUrl, firstInit] = fetchImpl.mock.calls[0];
    const [secondUrl, secondInit] = fetchImpl.mock.calls[1];
    expect(String(firstUrl)).toContain("/playlists/playlist-1/items");
    expect(String(firstUrl)).not.toContain("/playlists/playlist-1/tracks");
    expect(String(secondUrl)).toContain("/playlists/playlist-1/items");
    expect(firstInit?.method).toBe("PUT");
    expect(secondInit?.method).toBe("POST");
    expect(JSON.parse(String(firstInit?.body)).uris).toHaveLength(100);
    expect(JSON.parse(String(secondInit?.body)).uris).toHaveLength(50);
  });

  it("addPlaylistItems chunks by 100 using POST to /playlists/{id}/items", async () => {
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
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(init?.method).toBe("POST");
      expect(String(url)).toContain("/playlists/playlist-1/items");
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

// SpotifyClient.artistTopTracks was removed: GET /artists/{id}/top-tracks returns a bare 403
// under Spotify's Feb 2026 Web API migration, with no replacement endpoint offered.
