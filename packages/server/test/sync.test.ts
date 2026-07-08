import { ScrapeBudgetError, getSetting, openDb } from "@rmm/core";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { buildTestDeps } from "./helpers.js";

const FAKE_REPORT = {
  pagesScraped: 2,
  fromCache: 1,
  parseFailures: [],
  budgetExhausted: false,
  counts: { albums: 1, myRatings: 1, lists: 0, twins: 0, twinRatings: 0, charts: 0 },
};

describe("POST /api/sync", () => {
  it("runs runSyncFn, persists last_sync_report, and returns the report", async () => {
    const db = openDb(":memory:");
    const runSyncFn = vi.fn().mockResolvedValue(FAKE_REPORT);
    const app = createApp(buildTestDeps({ db, runSyncFn }));

    const res = await app.request("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxPages: 5 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FAKE_REPORT);
    expect(runSyncFn).toHaveBeenCalledTimes(1);
    const [, , opts] = runSyncFn.mock.calls[0];
    expect(opts.maxPages).toBe(5);

    expect(getSetting(db, "last_sync_report")).toEqual(FAKE_REPORT);
  });

  it("returns 409 when a sync is already in flight", async () => {
    const db = openDb(":memory:");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runSyncFn = vi.fn().mockImplementation(async () => {
      await gate;
      return FAKE_REPORT;
    });
    const app = createApp(buildTestDeps({ db, runSyncFn }));

    const first = app.request("/api/sync", { method: "POST" });
    // Give the first request's handler a real event-loop tick to run past its
    // synchronous in-flight flag set and start awaiting the gated runSyncFn call.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = await app.request("/api/sync", { method: "POST" });
    expect(second.status).toBe(409);

    release();
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
  });

  it("maps ScrapeBudgetError from runSyncFn to 429", async () => {
    const db = openDb(":memory:");
    const runSyncFn = vi.fn().mockRejectedValue(new ScrapeBudgetError("budget exhausted"));
    const app = createApp(buildTestDeps({ db, runSyncFn }));
    const res = await app.request("/api/sync", { method: "POST" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "budget exhausted" });
  });
});
