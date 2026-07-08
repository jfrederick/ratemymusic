import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CandidateView } from "../src/api";
import { Discover } from "../src/pages/Discover";
import { ToastProvider } from "../src/toast";

function candidate(overrides: Partial<CandidateView> = {}): CandidateView {
  return {
    albumId: 101,
    score: 0.91,
    status: "new",
    components: {
      list: {
        score: 0.5,
        evidence: {
          method: "list",
          lists: [{ rymUrl: "/list/a/", title: "Dark Winter", affinity: 0.9 }],
        },
      },
      twin: {
        score: 0.4,
        evidence: {
          method: "twin",
          twins: [{ username: "ghost_note", affinity: 0.8, rating: 5.0 }],
        },
      },
      genre: {
        score: 0.3,
        evidence: { method: "genre", charts: [{ rymUrl: "/y/", genre: "Slowcore", position: 4 }] },
      },
    },
    artist: "Have a Nice Life",
    title: "Deathconsciousness",
    year: 2008,
    rymUrl: "/release/album/have-a-nice-life/deathconsciousness/",
    genres: ["Slowcore", "Drone"],
    descriptors: ["melancholic"],
    rymAvgRating: 3.82,
    rymNumRatings: 27931,
    spotifyAlbumId: "abc123",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function renderDiscover() {
  return render(
    <ToastProvider>
      <Discover />
    </ToastProvider>,
  );
}

describe("Discover", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the human evidence line built from the candidate's method components", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/candidates"))
          return jsonResponse({ items: [candidate()], total: 1 });
        if (url.startsWith("/api/queue")) return jsonResponse([]);
        return jsonResponse({});
      }),
    );

    renderDiscover();

    await waitFor(() => screen.getByText(/Have a Nice Life/));
    expect(
      screen.getByText(
        "On 1 list you love: Dark Winter · taste-twin ghost_note rated it 5.0 · #4 in Slowcore",
      ),
    ).not.toBeNull();
    expect(screen.getByText("3.82 · 27,931 ratings")).not.toBeNull();
  });

  it("optimistically removes a card when Dismiss is clicked", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/dismiss") && init?.method === "POST") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.startsWith("/api/candidates"))
        return jsonResponse({ items: [candidate()], total: 1 });
      if (url.startsWith("/api/queue")) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDiscover();

    await waitFor(() => screen.getByTestId("candidate-101"));

    const dismissButton = screen.getByRole("button", { name: /dismiss deathconsciousness/i });
    fireEvent.click(dismissButton);

    // Optimistic: the card disappears immediately, before the request resolves.
    expect(screen.queryByTestId("candidate-101")).toBeNull();

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => String(u).includes("/dismiss") && (i as RequestInit)?.method === "POST",
        ),
      ).toBe(true);
    });
  });

  it("decrements the load-more total when a card is dismissed, and restores it on failure", async () => {
    const items = [
      candidate({ albumId: 101 }),
      candidate({ albumId: 102, title: "Voids", artist: "Other Artist" }),
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/dismiss") && init?.method === "POST") {
        return jsonResponse({ error: "server exploded" }, 500);
      }
      if (url.startsWith("/api/candidates")) return jsonResponse({ items, total: 6 });
      if (url.startsWith("/api/queue")) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDiscover();
    await waitFor(() => screen.getByTestId("candidate-101"));

    expect(screen.getByRole("button", { name: /load more \(2 of 6\)/i })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /dismiss deathconsciousness/i }));

    // Optimistic: the card disappears and the load-more count decrements immediately.
    expect(screen.queryByTestId("candidate-101")).toBeNull();
    expect(screen.getByRole("button", { name: /load more \(1 of 5\)/i })).not.toBeNull();

    // The dismiss call fails, so both the card and the total are restored.
    await waitFor(() => screen.getByTestId("candidate-101"));
    expect(screen.getByRole("button", { name: /load more \(2 of 6\)/i })).not.toBeNull();
  });

  it("restores the card if the dismiss request fails", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/dismiss") && init?.method === "POST") {
        return jsonResponse({ error: "server exploded" }, 500);
      }
      if (url.startsWith("/api/candidates"))
        return jsonResponse({ items: [candidate()], total: 1 });
      if (url.startsWith("/api/queue")) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDiscover();
    await waitFor(() => screen.getByTestId("candidate-101"));

    fireEvent.click(screen.getByRole("button", { name: /dismiss deathconsciousness/i }));
    expect(screen.queryByTestId("candidate-101")).toBeNull();

    await waitFor(() => screen.getByTestId("candidate-101"));
    expect(screen.getByText("server exploded")).not.toBeNull();
  });

  it("toggles queue state optimistically and calls the correct endpoint", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/candidates"))
        return jsonResponse({ items: [candidate()], total: 1 });
      if (url.startsWith("/api/queue/101") && init?.method === "POST") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.startsWith("/api/queue")) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDiscover();
    await waitFor(() => screen.getByTestId("candidate-101"));

    const card = screen.getByTestId("candidate-101");
    const queueButton = within(card).getByRole("button", { name: /^queue deathconsciousness$/i });
    fireEvent.click(queueButton);

    await waitFor(() => {
      const pressed = within(card).getByRole("button", {
        name: /remove deathconsciousness from queue/i,
      });
      expect(pressed.getAttribute("aria-pressed")).toBe("true");
    });

    expect(
      fetchMock.mock.calls.some(
        ([u, i]) => String(u) === "/api/queue/101" && (i as RequestInit)?.method === "POST",
      ),
    ).toBe(true);
  });
});
