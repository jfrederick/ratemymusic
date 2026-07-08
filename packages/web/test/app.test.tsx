import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("renders the sidebar brand and the Dashboard as the default route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/status")) {
          return jsonResponse({
            spotifyConnected: false,
            budget: { spentToday: 0, spentTotal: 0, daily: 100, initial: 1000 },
            counts: { albums: 0, myRatings: 0, lists: 0, twins: 0, candidatesNew: 0 },
            lastSync: null,
            tasteProfileComputedAt: null,
          });
        }
        return Promise.resolve(
          new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
        );
      }),
    );

    render(<App />);

    expect(screen.getByText("ratemymusic")).not.toBeNull();

    const heading = await waitFor(() =>
      screen.getByRole("heading", { level: 1, name: "Dashboard" }),
    );
    expect(heading.textContent).toBe("Dashboard");
  });
});
