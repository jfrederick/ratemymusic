import { openDb, saveTasteProfile } from "@rmm/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { buildTestDeps } from "./helpers.js";

describe("GET /api/profile", () => {
  it("404s before a profile has been computed", async () => {
    const db = openDb(":memory:");
    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/profile");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not computed yet" });
  });

  it("200s with the saved profile once computed", async () => {
    const db = openDb(":memory:");
    const profile = {
      genres: { Slowcore: 1 },
      descriptors: { melancholic: 1 },
      eras: { "1990s": 1 },
      computedAt: "2026-01-01T00:00:00.000Z",
    };
    saveTasteProfile(db, profile);
    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/profile");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(profile);
  });
});
