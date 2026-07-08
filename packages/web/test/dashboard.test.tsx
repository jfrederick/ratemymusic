import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StatusResponse, TasteProfile } from "../src/api";
import { Dashboard } from "../src/pages/Dashboard";
import { ToastProvider } from "../src/toast";

const status: StatusResponse = {
  spotifyConnected: true,
  budget: { spentToday: 12, spentTotal: 340, daily: 100, initial: 5000 },
  counts: { albums: 812, myRatings: 2100, lists: 34, twins: 9, candidatesNew: 47 },
  lastSync: {
    pagesScraped: 12,
    fromCache: 3,
    parseFailures: [],
    budgetExhausted: false,
    counts: { albums: 812, myRatings: 2100, lists: 34, twins: 9, twinRatings: 88, charts: 20 },
  },
  lastCronError: null,
  tasteProfileComputedAt: "2026-07-01T00:00:00.000Z",
};

const profile: TasteProfile = {
  genres: { Slowcore: 0.9, Shoegaze: 0.7, Doom: 0.4 },
  descriptors: { melancholic: 0.8, atmospheric: 0.6 },
  eras: { "1990s": 0.3, "2000s": 0.5, "2010s": 0.2 },
  computedAt: "2026-07-01T00:00:00.000Z",
};

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function renderDashboard() {
  return render(
    <ToastProvider>
      <Dashboard />
    </ToastProvider>,
  );
}

describe("Dashboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders taste profile bars from the fetched profile fixture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/status")) return jsonResponse(status);
        if (url.includes("/api/profile")) return jsonResponse(profile);
        return jsonResponse({});
      }),
    );

    renderDashboard();

    await waitFor(() => screen.getByText("Slowcore"));
    expect(screen.getByText("Shoegaze")).not.toBeNull();
    expect(screen.getByText("Doom")).not.toBeNull();
    expect(screen.getByText("melancholic")).not.toBeNull();
    expect(screen.getByText("atmospheric")).not.toBeNull();
    expect(screen.getByText("1990s")).not.toBeNull();
    expect(screen.getByText("0.90")).not.toBeNull();
  });

  it("shows a connect CTA when Spotify is disconnected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/status")) {
          return jsonResponse({ ...status, spotifyConnected: false });
        }
        if (url.includes("/api/profile")) return jsonResponse(profile);
        return jsonResponse({});
      }),
    );

    renderDashboard();

    const link = await waitFor(() => screen.getByRole("link", { name: /connect spotify/i }));
    expect(link.getAttribute("href")).toBe("/auth/spotify");
  });

  it("shows a friendly message when the taste profile hasn't been computed yet (404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/status")) return jsonResponse(status);
        if (url.includes("/api/profile")) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "no profile" }), { status: 404 }),
          );
        }
        return jsonResponse({});
      }),
    );

    renderDashboard();

    await waitFor(() => screen.getByText(/hasn't been computed yet/i));
  });

  it("shows an honest 'N candidates ready' toast after Discover now, not a 'found new' claim (M9)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/discover") && init?.method === "POST") {
          return jsonResponse({ candidates: 12 });
        }
        if (url.includes("/api/status")) return jsonResponse(status);
        if (url.includes("/api/profile")) return jsonResponse(profile);
        return jsonResponse({});
      }),
    );

    renderDashboard();
    await waitFor(() => screen.getByText("Slowcore"));

    fireEvent.click(screen.getByRole("button", { name: /discover now/i }));

    await waitFor(() => screen.getByText("12 candidates ready."));
  });

  it("shows a notice when last_cron_error is present (M2)", async () => {
    const withCronError: StatusResponse = {
      ...status,
      lastCronError: { step: "sync", message: "budget exhausted", at: "2026-07-08T07:00:00.000Z" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/status")) return jsonResponse(withCronError);
        if (url.includes("/api/profile")) return jsonResponse(profile);
        return jsonResponse({});
      }),
    );

    renderDashboard();

    await waitFor(() => screen.getByText(/Last automated run failed at step "sync"/));
    expect(screen.getByText(/budget exhausted/)).not.toBeNull();
  });
});
