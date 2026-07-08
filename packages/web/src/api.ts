// Typed API client for the @rmm/server contract. Single fetch wrapper, single error
// normalization path. No `any` in exported signatures.

export type MethodKey = "list" | "twin" | "genre" | "descriptor" | "new";

export type Evidence =
  | { method: "list"; lists: { rymUrl: string; title: string; affinity: number }[] }
  | { method: "twin"; twins: { username: string; affinity: number; rating: number }[] }
  | { method: "genre"; charts: { rymUrl: string; genre: string; position: number }[] }
  | { method: "descriptor"; charts: { rymUrl: string; descriptor: string; position: number }[] }
  | { method: "new"; charts: { rymUrl: string; position: number }[] };

export type CandidateStatus = "new" | "playlisted" | "dismissed" | "known";

export type CandidateView = {
  albumId: number;
  score: number;
  status: CandidateStatus;
  components: Partial<Record<MethodKey, { score: number; evidence: Evidence }>>;
  artist: string;
  title: string;
  year: number | null;
  rymUrl: string;
  genres: string[];
  descriptors: string[];
  rymAvgRating: number | null;
  rymNumRatings: number | null;
  spotifyAlbumId: string | null;
};

export type TasteProfile = {
  genres: Record<string, number>;
  descriptors: Record<string, number>;
  eras: Record<string, number>;
  computedAt: string;
};

export type SyncReport = {
  pagesScraped: number;
  fromCache: number;
  parseFailures: { url: string; error: string }[];
  budgetExhausted: boolean;
  counts: {
    albums: number;
    myRatings: number;
    lists: number;
    twins: number;
    twinRatings: number;
    charts: number;
  };
};

export type StatusResponse = {
  spotifyConnected: boolean;
  budget: { spentToday: number; spentTotal: number; daily: number; initial: number };
  counts: {
    albums: number;
    myRatings: number;
    lists: number;
    twins: number;
    candidatesNew: number;
  };
  lastSync: SyncReport | null;
  tasteProfileComputedAt: string | null;
};

export type PlaylistMode = "sampler" | "top" | "deep";

export type PlaylistSummary = {
  id: number;
  spotifyId: string;
  name: string;
  mode: PlaylistMode;
  createdAt: string;
  trackCount: number;
};

export type CreatePlaylistBody = {
  name?: string;
  mode?: PlaylistMode;
  albumIds?: number[];
};

/** Result of POST /api/playlists (buildAndPushPlaylist). */
export type CreatePlaylistResult = {
  spotifyPlaylistId: string;
  trackCount: number;
  unresolved: number[];
};

/** Result of POST /api/playlists/daily (pushDaily) — no `unresolved` field. */
export type PushDailyResult = {
  spotifyPlaylistId: string;
  trackCount: number;
  albums: number[];
};

export type CandidateQuery = {
  status?: CandidateStatus;
  method?: MethodKey;
  genre?: string;
  minScore?: number;
  limit?: number;
  offset?: number;
};

export type CandidatesPage = {
  items: CandidateView[];
  total: number;
};

/** Normalized API error. `status` is 0 for network-level failures (no HTTP response). */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** True when the error represents "Spotify is not connected" (playlist create 409). */
export function isDisconnectedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

/** Renders any thrown value as a short, human-readable message for toasts/inline errors. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return "Could not reach the server. Check your connection.";
    if (err.status === 429) return "Crawl budget exhausted for today.";
    if (err.status === 409) return "Spotify isn't connected yet.";
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

type Json = Record<string, unknown>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection.", 0);
  }

  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.clone().json()) as Json;
      if (body && typeof body.error === "string") message = body.error;
      if (body && typeof body.code === "string") code = body.code;
    } catch {
      // Non-JSON or empty error body; fall back to statusText.
    }
    throw new ApiError(message, res.status, code);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function toQueryString(query: CandidateQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.method) params.set("method", query.method);
  if (query.genre) params.set("genre", query.genre);
  if (query.minScore !== undefined) params.set("minScore", String(query.minScore));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const api = {
  getStatus: (): Promise<StatusResponse> => request("/api/status"),

  getProfile: (): Promise<TasteProfile> => request("/api/profile"),

  getCandidates: (query: CandidateQuery = {}): Promise<CandidatesPage> =>
    request(`/api/candidates${toQueryString(query)}`),

  dismissCandidate: (albumId: number): Promise<void> =>
    request(`/api/candidates/${albumId}/dismiss`, { method: "POST" }),

  markCandidateKnown: (albumId: number): Promise<void> =>
    request(`/api/candidates/${albumId}/known`, { method: "POST" }),

  restoreCandidate: (albumId: number): Promise<void> =>
    request(`/api/candidates/${albumId}/restore`, { method: "POST" }),

  getQueue: (): Promise<number[]> => request("/api/queue"),

  addToQueue: (albumId: number): Promise<void> =>
    request(`/api/queue/${albumId}`, { method: "POST" }),

  removeFromQueue: (albumId: number): Promise<void> =>
    request(`/api/queue/${albumId}`, { method: "DELETE" }),

  createPlaylist: (body: CreatePlaylistBody): Promise<CreatePlaylistResult> =>
    request("/api/playlists", { method: "POST", body: JSON.stringify(body) }),

  getPlaylists: (): Promise<PlaylistSummary[]> => request("/api/playlists"),

  createDailyPlaylist: (): Promise<PushDailyResult> =>
    request("/api/playlists/daily", { method: "POST" }),

  sync: (maxPages?: number): Promise<SyncReport> =>
    request("/api/sync", { method: "POST", body: JSON.stringify({ maxPages }) }),

  discover: (): Promise<{ candidates: number }> => request("/api/discover", { method: "POST" }),
};
