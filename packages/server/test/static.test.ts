import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { buildTestDeps } from "./helpers.js";

describe("API/auth 404s never fall through to the SPA static fallback", () => {
  it("GET /api/does-not-exist returns 404 JSON", async () => {
    const app = createApp(buildTestDeps());
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("GET /auth/bogus returns 404 JSON", async () => {
    const app = createApp(buildTestDeps());
    const res = await app.request("/auth/bogus");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("POST /callback (unhandled method/shape) returns 404 JSON, not the SPA shell", async () => {
    const app = createApp(buildTestDeps());
    const res = await app.request("/callback", { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("serves the SPA index.html for non-api routes when webDistDir is configured, while /api and /auth stay JSON 404", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rmm-web-dist-"));
    writeFileSync(join(dir, "index.html"), "<html><body>hello spa</body></html>");
    const app = createApp(buildTestDeps({ webDistDir: dir }));

    const page = await app.request("/some/page");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("hello spa");

    const api = await app.request("/api/nope");
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: "not found" });

    const auth = await app.request("/auth/nope");
    expect(auth.status).toBe(404);
    expect(await auth.json()).toEqual({ error: "not found" });
  });
});
