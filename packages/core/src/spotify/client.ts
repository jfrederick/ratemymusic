import type { DatabaseType } from "../db.js";
import { getSetting, setSetting } from "../settings.js";
import { buildAuthorizeUrl, challengeFromVerifier, generateVerifier } from "./pkce.js";

const AUTH_BASE = "https://accounts.spotify.com";
const API_BASE = "https://api.spotify.com/v1";
const SCOPES = ["playlist-modify-private", "playlist-read-private"];
const PENDING_AUTH_KEY = "spotify_pkce_pending";
const REFRESH_MARGIN_MS = 60_000;

type PendingAuth = { verifier: string; state: string };

type SpotifyTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

type OAuthTokenRow = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

export class SpotifyAuthError extends Error {}

export class SpotifyAuth {
  private readonly db: DatabaseType;
  private readonly clientId: string;
  private readonly redirectUri: string;
  private readonly fetchImpl: typeof fetch;

  constructor(o: {
    db: DatabaseType;
    clientId: string;
    redirectUri: string;
    fetchImpl?: typeof fetch;
  }) {
    this.db = o.db;
    this.clientId = o.clientId;
    this.redirectUri = o.redirectUri;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  startAuth(): { url: string; state: string } {
    const verifier = generateVerifier();
    const challenge = challengeFromVerifier(verifier);
    const state = generateVerifier(16);
    setSetting<PendingAuth>(this.db, PENDING_AUTH_KEY, { verifier, state });
    const url = buildAuthorizeUrl({
      clientId: this.clientId,
      redirectUri: this.redirectUri,
      scopes: SCOPES,
      state,
      codeChallenge: challenge,
    });
    return { url, state };
  }

  async handleCallback(params: { code: string; state: string }): Promise<void> {
    const pending = getSetting<PendingAuth>(this.db, PENDING_AUTH_KEY);
    if (!pending || pending.state !== params.state) {
      throw new SpotifyAuthError("OAuth state mismatch");
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: pending.verifier,
    });
    const res = await this.fetchImpl(`${AUTH_BASE}/api/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new SpotifyAuthError(`Spotify token exchange failed with status ${res.status}`);
    }
    const json = (await res.json()) as SpotifyTokenResponse;
    this.persistTokens(json, null);
    setSetting(this.db, PENDING_AUTH_KEY, null);
  }

  isConnected(): boolean {
    const row = this.db
      .prepare("SELECT provider FROM oauth_tokens WHERE provider = 'spotify'")
      .get();
    return row !== undefined;
  }

  async accessToken(): Promise<string> {
    const row = this.db
      .prepare(
        "SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE provider = 'spotify'",
      )
      .get() as OAuthTokenRow | undefined;
    if (!row) {
      throw new SpotifyAuthError("Spotify is not connected");
    }
    const expiresAtMs = row.expires_at ? Date.parse(row.expires_at) : null;
    const needsRefresh = expiresAtMs !== null && expiresAtMs - Date.now() <= REFRESH_MARGIN_MS;
    if (!needsRefresh || !row.refresh_token) {
      return row.access_token;
    }
    return this.refresh(row.refresh_token);
  }

  private async refresh(refreshToken: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
    });
    const res = await this.fetchImpl(`${AUTH_BASE}/api/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new SpotifyAuthError(`Spotify token refresh failed with status ${res.status}`);
    }
    const json = (await res.json()) as SpotifyTokenResponse;
    this.persistTokens(json, refreshToken);
    return json.access_token;
  }

  private persistTokens(json: SpotifyTokenResponse, fallbackRefreshToken: string | null): void {
    const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
    const refreshToken = json.refresh_token ?? fallbackRefreshToken;
    this.db
      .prepare(
        `INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at)
         VALUES ('spotify', ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at`,
      )
      .run(json.access_token, refreshToken, expiresAt);
  }
}

export class SpotifyApiError extends Error {
  status: number;

  constructor(msg: string, status: number) {
    super(msg);
    this.name = "SpotifyApiError";
    this.status = status;
  }
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeText(s: string): string {
  return stripDiacritics(s)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

function jaccard(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let intersection = 0;
  for (const token of sa) {
    if (sb.has(token)) intersection += 1;
  }
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : intersection / union;
}

type SpotifyAlbumSearchItem = {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
};

type SpotifyAlbumTrackItem = {
  id: string;
  name: string;
  disc_number: number;
  track_number: number;
};

type SpotifyPagingObject<T> = {
  items: T[];
  next: string | null;
};

type SpotifyTrackObject = {
  id: string;
  name: string;
  popularity: number;
};

export class SpotifyClient {
  private readonly auth: { accessToken(): Promise<string> };
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(o: {
    auth: { accessToken(): Promise<string> };
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.auth = o.auth;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.sleep = o.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async searchAlbum(q: {
    artist: string;
    title: string;
  }): Promise<{ id: string; name: string; artistIds: string[] } | null> {
    const title = normalizeText(q.title);
    const artist = normalizeText(q.artist);
    const quoted = `album:"${title}" artist:"${artist}"`;
    const quotedMatch = await this.searchAndMatch(quoted, title, artist);
    if (quotedMatch) return quotedMatch;
    const unquoted = `${title} ${artist}`;
    return this.searchAndMatch(unquoted, title, artist);
  }

  private async searchAndMatch(
    query: string,
    title: string,
    artist: string,
  ): Promise<{ id: string; name: string; artistIds: string[] } | null> {
    // Search `limit` max dropped to 10 (from 50) in Spotify's Feb 2026 Web API migration;
    // 10 is also the most candidates we need to scan for a match, so no clamping required.
    const qs = new URLSearchParams({ q: query, type: "album", limit: "10" }).toString();
    const body = await this.requestJson<{ albums?: { items: SpotifyAlbumSearchItem[] } }>(
      `/search?${qs}`,
    );
    const items = body.albums?.items ?? [];
    for (const item of items) {
      const albumName = normalizeText(item.name);
      const firstArtistName = item.artists[0] ? normalizeText(item.artists[0].name) : "";
      if (jaccard(albumName, title) >= 0.5 && jaccard(firstArtistName, artist) >= 0.5) {
        return { id: item.id, name: item.name, artistIds: item.artists.map((a) => a.id) };
      }
    }
    return null;
  }

  async albumTracks(
    albumId: string,
  ): Promise<{ id: string; name: string; discNumber: number; trackNumber: number }[]> {
    const results: { id: string; name: string; discNumber: number; trackNumber: number }[] = [];
    let next: string | null = `/albums/${albumId}/tracks?limit=50&offset=0`;
    while (next) {
      const body: SpotifyPagingObject<SpotifyAlbumTrackItem> = await this.requestJson(next);
      for (const item of body.items) {
        results.push({
          id: item.id,
          name: item.name,
          discNumber: item.disc_number,
          trackNumber: item.track_number,
        });
      }
      next = body.next;
    }
    return results;
  }

  // Spotify removed the batch GET /tracks?ids= endpoint (bare 403) in the Feb 2026 Web API
  // migration; there's no batch replacement, so we fan out per-id GET /tracks/{id} requests
  // through a small concurrency pool. Results preserve the input order.
  async tracksDetails(ids: string[]): Promise<{ id: string; name: string; popularity: number }[]> {
    const results: ({ id: string; name: string; popularity: number } | null)[] = new Array(
      ids.length,
    ).fill(null);
    const concurrency = 4;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < ids.length) {
        const i = cursor++;
        try {
          const track = await this.requestJson<SpotifyTrackObject>(`/tracks/${ids[i]}`);
          results[i] = { id: track.id, name: track.name, popularity: track.popularity };
        } catch (err) {
          if (err instanceof SpotifyApiError && err.status === 404) continue;
          throw err;
        }
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, ids.length) }, () => worker());
    await Promise.all(workers);
    return results.filter((r): r is { id: string; name: string; popularity: number } => r !== null);
  }

  async me(): Promise<{ id: string; displayName: string | null }> {
    const body = await this.requestJson<{ id: string; display_name: string | null }>("/me");
    return { id: body.id, displayName: body.display_name ?? null };
  }

  // Spotify returns a bare 403 Forbidden from the legacy /users/{id}/playlists form for
  // newer apps; /me/playlists is the working endpoint (verified live 2026-07-08).
  async createPlaylist(o: {
    name: string;
    description?: string;
    public?: boolean;
  }): Promise<{ id: string }> {
    const body = await this.requestJson<{ id: string }>("/me/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: o.name,
        description: o.description ?? "",
        public: o.public ?? false,
      }),
    });
    return { id: body.id };
  }

  // Playlist item management moved from /playlists/{id}/tracks to /playlists/{id}/items in
  // Spotify's Feb 2026 Web API migration (the old form returns a bare 403); request bodies
  // (uris arrays) and the PUT+POST chunking scheme are unchanged.
  async replacePlaylistItems(playlistId: string, trackUris: string[]): Promise<void> {
    const first = trackUris.slice(0, 100);
    await this.requestJson(`/playlists/${playlistId}/items`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: first }),
    });
    const rest = trackUris.slice(100);
    for (let i = 0; i < rest.length; i += 100) {
      const chunk = rest.slice(i, i + 100);
      await this.requestJson(`/playlists/${playlistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uris: chunk }),
      });
    }
  }

  async addPlaylistItems(playlistId: string, trackUris: string[]): Promise<void> {
    for (let i = 0; i < trackUris.length; i += 100) {
      const chunk = trackUris.slice(i, i + 100);
      await this.requestJson(`/playlists/${playlistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uris: chunk }),
      });
    }
  }

  async getPlaylist(playlistId: string): Promise<{ id: string; name: string } | null> {
    const url = `${API_BASE}/playlists/${playlistId}?fields=id,name`;
    const headers = await this.authHeaders();
    const res = await this.fetchWithRetry(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new SpotifyApiError(`Spotify API error ${res.status}: ${text}`, res.status);
    }
    const body = (await res.json()) as { id: string; name: string };
    return { id: body.id, name: body.name };
  }

  private async authHeaders(extra?: HeadersInit): Promise<HeadersInit> {
    const token = await this.auth.accessToken();
    return { Authorization: `Bearer ${token}`, ...extra };
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let res = await this.fetchImpl(url, init);
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      await this.sleep(retryAfter * 1000);
      res = await this.fetchImpl(url, init);
    } else if (res.status >= 500 && res.status < 600) {
      res = await this.fetchImpl(url, init);
    }
    return res;
  }

  private async requestJson<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
    const headers = await this.authHeaders(init.headers);
    const res = await this.fetchWithRetry(url, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new SpotifyApiError(`Spotify API error ${res.status}: ${text}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
