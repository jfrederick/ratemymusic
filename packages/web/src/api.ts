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

export type CronError = { step: string; message: string; at: string };

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
  lastCronError: CronError | null;
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

export type PlaylistTrackView = {
  position: number;
  spotifyTrackId: string;
  albumId: number | null;
  kept: boolean;
  artist: string | null;
  title: string | null;
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

export type ChatRole = "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };
export type ChatToolEvent = { name: string; ok: boolean };
export type ChatDoneResult = { text: string; toolEvents: ChatToolEvent[] };

export type ChatStreamHandlers = {
  onDelta?: (text: string) => void;
  onTool?: (name: string) => void;
  onDone?: (result: ChatDoneResult) => void;
  onError?: (message: string) => void;
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

/** Parses one `event: X\ndata: Y\n\n` SSE frame and dispatches it to the matching handler. */
function dispatchSseFrame(frame: string, handlers: ChatStreamHandlers): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice("event: ".length);
    else if (line.startsWith("data: ")) dataLines.push(line.slice("data: ".length));
  }
  if (dataLines.length === 0) return;

  const parsed = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
  switch (event) {
    case "delta":
      if (typeof parsed.text === "string") handlers.onDelta?.(parsed.text);
      break;
    case "tool":
      if (typeof parsed.name === "string") handlers.onTool?.(parsed.name);
      break;
    case "done":
      handlers.onDone?.(parsed as unknown as ChatDoneResult);
      break;
    case "error":
      if (typeof parsed.message === "string") handlers.onError?.(parsed.message);
      break;
  }
}

/**
 * POSTs a chat turn to /api/chat and parses the SSE response body as it streams in (via
 * fetch + ReadableStream -- EventSource can't POST a body). Throws ApiError on a non-2xx
 * response (e.g. 503 when chat isn't configured) before any streaming begins.
 */
export async function streamChat(
  messages: ChatMessage[],
  handlers: ChatStreamHandlers,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection.", 0);
  }

  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as Json;
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      // Non-JSON or empty error body; fall back to statusText.
    }
    throw new ApiError(message, res.status);
  }

  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      dispatchSseFrame(buffer.slice(0, boundary), handlers);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) dispatchSseFrame(buffer, handlers);
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

  getPlaylistTracks: (id: number): Promise<PlaylistTrackView[]> =>
    request(`/api/playlists/${id}/tracks`),

  keepTrack: (body: { spotifyTrackId: string; albumId?: number }): Promise<{
    ok: true;
    playlistId: string;
  }> => request("/api/playlists/tracks/keep", { method: "POST", body: JSON.stringify(body) }),

  createDailyPlaylist: (): Promise<PushDailyResult> =>
    request("/api/playlists/daily", { method: "POST" }),

  sync: (maxPages?: number): Promise<SyncReport> =>
    request("/api/sync", { method: "POST", body: JSON.stringify({ maxPages }) }),

  discover: (): Promise<{ candidates: number }> => request("/api/discover", { method: "POST" }),
};
