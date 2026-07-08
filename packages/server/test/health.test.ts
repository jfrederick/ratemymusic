import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { buildTestDeps } from "./helpers.js";

describe("GET /api/health", () => {
  it("returns 200 and ok: true", async () => {
    const app = createApp(buildTestDeps());
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});
