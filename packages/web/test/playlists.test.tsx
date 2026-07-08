import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Playlists } from "../src/pages/Playlists";
import { ToastProvider } from "../src/toast";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function renderPlaylists() {
  return render(
    <ToastProvider>
      <Playlists />
    </ToastProvider>,
  );
}

describe("Playlists", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a connect-Spotify CTA when playlist creation 409s (disconnected)", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/queue")) return jsonResponse([101]);
      if (url.startsWith("/api/candidates")) return jsonResponse({ items: [], total: 0 });
      if (url.startsWith("/api/playlists") && init?.method === "POST") {
        return jsonResponse({ error: "Spotify not connected" }, 409);
      }
      if (url.startsWith("/api/playlists")) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPlaylists();

    await waitFor(() => screen.getByText("Queue (1)"));

    const createButton = screen.getByRole("button", { name: /create playlist/i });
    fireEvent.click(createButton);

    const link = await waitFor(() => screen.getByRole("link", { name: /connect spotify/i }));
    expect(link.getAttribute("href")).toBe("/auth/spotify");
  });

  it("renders a valid date and a working Open link from a populated camelCase history row", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/queue")) return jsonResponse([]);
      if (url.startsWith("/api/candidates")) return jsonResponse({ items: [], total: 0 });
      if (url.startsWith("/api/playlists")) {
        return jsonResponse([
          {
            id: 7,
            spotifyId: "3cEYpjA9oz9GiPac4AsH4n",
            name: "RYM Discoveries — 2026-07-01",
            mode: "sampler",
            createdAt: "2026-07-01T12:00:00.000Z",
            trackCount: 42,
          },
        ]);
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPlaylists();

    await waitFor(() => screen.getByText(/RYM Discoveries — 2026-07-01/));

    const meta = screen.getByText(/sampler.*42 tracks/);
    expect(meta.textContent).not.toMatch(/Invalid Date/);

    const openLink = screen.getByRole("link", { name: /open/i });
    expect(openLink.getAttribute("href")).toBe(
      "https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4AsH4n",
    );
  });

  it("shows the same connect CTA for a 409 on the daily push", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/queue")) return jsonResponse([]);
      if (url.startsWith("/api/candidates")) return jsonResponse({ items: [], total: 0 });
      if (url.startsWith("/api/playlists/daily") && init?.method === "POST") {
        return jsonResponse({ error: "Spotify not connected" }, 409);
      }
      if (url.startsWith("/api/playlists")) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPlaylists();

    await waitFor(() => screen.getByText("Queue (0)"));
    fireEvent.click(screen.getByRole("button", { name: /push daily playlist/i }));

    const link = await waitFor(() => screen.getByRole("link", { name: /connect spotify/i }));
    expect(link.getAttribute("href")).toBe("/auth/spotify");
  });

  it("renders the corrected mode descriptions (I4)", async () => {
    const fetchMock = vi.fn(() => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    renderPlaylists();

    await waitFor(() => screen.getByText("The most popular track from each recommended album"));
    expect(screen.getByText("Each artist's top tracks (regardless of album)")).not.toBeNull();
    expect(screen.getByText("A deeper cut from each album — skips the hit")).not.toBeNull();
  });

  it("omits albumIds when building from the queue, and refreshes the (now-cleared) queue after success (I3)", async () => {
    let createBody: unknown;
    let queueCallCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/queue")) {
        queueCallCount++;
        // First call (on mount) returns the queued albums; the second (after a successful
        // build) reflects the server having cleared it.
        return jsonResponse(queueCallCount === 1 ? [101, 102] : []);
      }
      if (url.startsWith("/api/candidates")) return jsonResponse({ items: [], total: 0 });
      if (url === "/api/playlists" && init?.method === "POST") {
        createBody = JSON.parse(init.body as string);
        return jsonResponse({ spotifyPlaylistId: "pl1", trackCount: 2, unresolved: [] });
      }
      if (url.startsWith("/api/playlists")) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPlaylists();

    await waitFor(() => screen.getByText("Queue (2)"));
    fireEvent.click(screen.getByRole("button", { name: /create playlist/i }));

    await waitFor(() => expect(createBody).toBeDefined());
    expect(createBody).not.toHaveProperty("albumIds");

    await waitFor(() => screen.getByText("Queue (0)"));
  });

  it("surfaces a toast when some albums had no Spotify match (M1)", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/queue")) return jsonResponse([101]);
      if (url.startsWith("/api/candidates")) return jsonResponse({ items: [], total: 0 });
      if (url === "/api/playlists" && init?.method === "POST") {
        return jsonResponse({ spotifyPlaylistId: "pl1", trackCount: 1, unresolved: [101] });
      }
      if (url.startsWith("/api/playlists")) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPlaylists();

    await waitFor(() => screen.getByText("Queue (1)"));
    fireEvent.click(screen.getByRole("button", { name: /create playlist/i }));

    await waitFor(() => screen.getByText(/1 album had no Spotify match\./));
  });

  it("lists tracks and lets you keep one when a history row is expanded (I5)", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/queue")) return jsonResponse([]);
      if (url.startsWith("/api/candidates")) return jsonResponse({ items: [], total: 0 });
      if (url === "/api/playlists/tracks/keep" && init?.method === "POST") {
        return jsonResponse({ ok: true, playlistId: "keepers1" });
      }
      if (url === "/api/playlists/7/tracks") {
        return jsonResponse([
          {
            position: 0,
            spotifyTrackId: "tr1",
            albumId: 5,
            kept: false,
            artist: "Have a Nice Life",
            title: "Deathconsciousness",
          },
        ]);
      }
      if (url.startsWith("/api/playlists")) {
        return jsonResponse([
          {
            id: 7,
            spotifyId: "sp7",
            name: "RYM Discoveries",
            mode: "sampler",
            createdAt: "2026-07-01T12:00:00.000Z",
            trackCount: 1,
          },
        ]);
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPlaylists();

    await waitFor(() => screen.getByText("RYM Discoveries"));
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => screen.getByText("Have a Nice Life — Deathconsciousness"));
    const keepButton = screen.getByRole("button", { name: /^keep$/i });
    fireEvent.click(keepButton);

    await waitFor(() => screen.getByRole("button", { name: /^kept$/i }));
  });
});
