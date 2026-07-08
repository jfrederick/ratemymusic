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
});
