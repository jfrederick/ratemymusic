import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, describeError, isDisconnectedError, streamChat } from "../src/api";

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api error normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws ApiError with status 0 when fetch itself rejects (network failure)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    await expect(api.getStatus()).rejects.toMatchObject({
      name: "ApiError",
      status: 0,
    });
  });

  it("surfaces a JSON error body message and status on non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ error: "album not found" }, { status: 404 }))),
    );

    await expect(api.getProfile()).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "album not found",
    });
  });

  it("falls back to statusText when the error body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("<html>gateway down</html>", { status: 502, statusText: "Bad Gateway" }),
        ),
      ),
    );

    await expect(api.getStatus()).rejects.toMatchObject({
      status: 502,
      message: "Bad Gateway",
    });
  });

  it("resolves with parsed JSON on success", async () => {
    const payload = {
      spotifyConnected: true,
      budget: { spentToday: 1, spentTotal: 2, daily: 10, initial: 100 },
      counts: { albums: 5, myRatings: 6, lists: 1, twins: 2, candidatesNew: 3 },
      lastSync: null,
      tasteProfileComputedAt: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(payload))),
    );

    await expect(api.getStatus()).resolves.toEqual(payload);
  });

  it("resolves with undefined for 204 No Content responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );

    await expect(api.dismissCandidate(1)).resolves.toBeUndefined();
  });

  it("isDisconnectedError is true only for ApiError with status 409", () => {
    expect(isDisconnectedError(new ApiError("nope", 409))).toBe(true);
    expect(isDisconnectedError(new ApiError("nope", 500))).toBe(false);
    expect(isDisconnectedError(new Error("nope"))).toBe(false);
  });

  it("describeError produces friendly copy for known status codes", () => {
    expect(describeError(new ApiError("x", 0))).toMatch(/reach the server/i);
    expect(describeError(new ApiError("x", 429))).toMatch(/crawl budget exhausted for today/i);
    expect(describeError(new ApiError("x", 409))).toMatch(/spotify isn't connected/i);
    expect(describeError(new ApiError("custom message", 500))).toBe("custom message");
    expect(describeError(new Error("plain"))).toBe("plain");
    expect(describeError("weird")).toBe("Something went wrong.");
  });
});

describe("api request construction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

  it("builds a query string for getCandidates from provided fields only", async () => {
    const fetchMock = vi.fn((..._args: FetchArgs) =>
      Promise.resolve(jsonResponse({ items: [], total: 0 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.getCandidates({
      status: "new",
      method: "list",
      minScore: 0.5,
      limit: 20,
      offset: 40,
    });

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "/api/candidates?status=new&method=list&minScore=0.5&limit=20&offset=40",
    );
  });

  it("omits absent query fields entirely", async () => {
    const fetchMock = vi.fn((..._args: FetchArgs) =>
      Promise.resolve(jsonResponse({ items: [], total: 0 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.getCandidates();

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("/api/candidates");
  });

  it("sends JSON body and POST method for mutations", async () => {
    const fetchMock = vi.fn((..._args: FetchArgs) =>
      Promise.resolve(jsonResponse({ spotifyPlaylistId: "abc", trackCount: 10, unresolved: 0 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.createPlaylist({ name: "Test", mode: "sampler" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/playlists");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ name: "Test", mode: "sampler" }));
  });

  it("uses DELETE method for removeFromQueue", async () => {
    const fetchMock = vi.fn((..._args: FetchArgs) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.removeFromQueue(42);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/queue/42");
    expect(init?.method).toBe("DELETE");
  });
});

describe("streamChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sseResponse(chunks: string[]): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  it("parses delta/tool/done SSE frames progressively as the stream arrives, even split mid-frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            'event: delta\ndata: {"text":"Hel',
            'lo"}\n\n',
            'event: tool\ndata: {"name":"search_candidates"}\n\n',
            'event: delta\ndata: {"text":" there"}\n\n',
            'event: done\ndata: {"text":"Hello there","toolEvents":[{"name":"search_candidates","ok":true}]}\n\n',
          ]),
        ),
      ),
    );

    const deltas: string[] = [];
    const tools: string[] = [];
    let done: unknown;
    await streamChat([{ role: "user", content: "hi" }], {
      onDelta: (t) => deltas.push(t),
      onTool: (n) => tools.push(n),
      onDone: (r) => {
        done = r;
      },
    });

    expect(deltas).toEqual(["Hello", " there"]);
    expect(tools).toEqual(["search_candidates"]);
    expect(done).toEqual({
      text: "Hello there",
      toolEvents: [{ name: "search_candidates", ok: true }],
    });
  });

  it("dispatches an error event via onError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(sseResponse(['event: error\ndata: {"message":"boom"}\n\n']))),
    );

    const errors: string[] = [];
    await streamChat([{ role: "user", content: "hi" }], { onError: (m) => errors.push(m) });
    expect(errors).toEqual(["boom"]);
  });

  it("throws ApiError with the server message on a 503 (chat unavailable), before any streaming", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "chat unavailable — set ANTHROPIC_API_KEY" }), {
            status: 503,
          }),
        ),
      ),
    );

    await expect(streamChat([{ role: "user", content: "hi" }], {})).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      message: "chat unavailable — set ANTHROPIC_API_KEY",
    });
  });

  it("POSTs the message history as JSON", async () => {
    const fetchMock = vi.fn((..._args: [input: RequestInfo | URL, init?: RequestInit]) =>
      Promise.resolve(sseResponse([])),
    );
    vi.stubGlobal("fetch", fetchMock);

    const messages = [{ role: "user" as const, content: "hi" }];
    await streamChat(messages, {});

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ messages }));
  });
});
