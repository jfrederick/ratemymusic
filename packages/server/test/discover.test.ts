import { openDb } from "@rmm/core";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { buildTestDeps } from "./helpers.js";

describe("POST /api/discover", () => {
  it("runs runDiscoveryFn and returns the candidate count", async () => {
    const db = openDb(":memory:");
    const runDiscoveryFn = vi.fn().mockResolvedValue({ candidates: 7 });
    const app = createApp(buildTestDeps({ db, runDiscoveryFn }));
    const res = await app.request("/api/discover", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ candidates: 7 });
    expect(runDiscoveryFn).toHaveBeenCalledTimes(1);
  });
});
