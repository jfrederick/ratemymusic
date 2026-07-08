import { openDb } from "@rmm/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { buildTestDeps, fakeSpotifyAuth } from "./helpers.js";

describe("GET /auth/spotify", () => {
  it("redirects to the fake auth url", async () => {
    const db = openDb(":memory:");
    const app = createApp(buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(false) }));
    const res = await app.request("/auth/spotify", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://accounts.spotify.com/authorize?fake=1");
  });
});

describe("GET /callback", () => {
  it("redirects on success", async () => {
    const db = openDb(":memory:");
    const app = createApp(buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(false) }));
    const res = await app.request("/callback?code=abc&state=fake-state", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/#/settings?spotify=connected");
  });

  it("400s on mismatched state", async () => {
    const db = openDb(":memory:");
    const app = createApp(buildTestDeps({ db, spotifyAuth: fakeSpotifyAuth(false) }));
    const res = await app.request("/callback?code=abc&state=wrong-state", { redirect: "manual" });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("OAuth state mismatch");
  });
});
