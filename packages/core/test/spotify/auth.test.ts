import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/db.js";
import type { DatabaseType } from "../../src/db.js";
import { SpotifyAuth, SpotifyAuthError } from "../../src/spotify/client.js";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SpotifyAuth", () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("startAuth persists verifier+state and returns an authorize url", () => {
    const auth = new SpotifyAuth({
      db,
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:8787/callback",
    });
    const { url, state } = auth.startAuth();
    expect(url).toContain("https://accounts.spotify.com/authorize");
    expect(url).toContain(`state=${state}`);
    expect(auth.isConnected()).toBe(false);
  });

  it("handleCallback exchanges the code with the code_verifier and persists tokens", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://accounts.spotify.com/api/token");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code-123");
      expect(body.get("code_verifier")).toBeTruthy();
      expect(body.get("client_id")).toBe("client-1");
      expect(body.get("redirect_uri")).toBe("http://127.0.0.1:8787/callback");
      return jsonResponse({
        access_token: "access-token-1",
        refresh_token: "refresh-token-1",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "playlist-modify-private playlist-read-private",
      });
    });

    const auth = new SpotifyAuth({
      db,
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:8787/callback",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const { state } = auth.startAuth();
    await auth.handleCallback({ code: "auth-code-123", state });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(auth.isConnected()).toBe(true);
    await expect(auth.accessToken()).resolves.toBe("access-token-1");

    const row = db.prepare("SELECT * FROM oauth_tokens WHERE provider = 'spotify'").get() as {
      access_token: string;
      refresh_token: string | null;
      expires_at: string | null;
    };
    expect(row.access_token).toBe("access-token-1");
    expect(row.refresh_token).toBe("refresh-token-1");
    expect(row.expires_at).toBeTruthy();
  });

  it("throws SpotifyAuthError on state mismatch", async () => {
    const auth = new SpotifyAuth({
      db,
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:8787/callback",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    auth.startAuth();
    await expect(auth.handleCallback({ code: "x", state: "wrong-state" })).rejects.toThrow(
      SpotifyAuthError,
    );
  });

  it("accessToken returns the stored token when it is still fresh", async () => {
    const fetchImpl = vi.fn();
    const auth = new SpotifyAuth({
      db,
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:8787/callback",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const farFuture = new Date(Date.now() + 3600_000).toISOString();
    db.prepare(
      "INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at) VALUES ('spotify', ?, ?, ?)",
    ).run("fresh-token", "refresh-token", farFuture);

    await expect(auth.accessToken()).resolves.toBe("fresh-token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes the token when expiring within 60s and persists refresh_token rotation", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("old-refresh-token");
      return jsonResponse({
        access_token: "new-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      });
    });
    const auth = new SpotifyAuth({
      db,
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:8787/callback",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const almostExpired = new Date(Date.now() + 30_000).toISOString();
    db.prepare(
      "INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at) VALUES ('spotify', ?, ?, ?)",
    ).run("old-access-token", "old-refresh-token", almostExpired);

    await expect(auth.accessToken()).resolves.toBe("new-access-token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const row = db.prepare("SELECT * FROM oauth_tokens WHERE provider = 'spotify'").get() as {
      access_token: string;
      refresh_token: string | null;
    };
    expect(row.access_token).toBe("new-access-token");
    expect(row.refresh_token).toBe("rotated-refresh-token");
  });

  it("accessToken throws SpotifyAuthError when not connected", async () => {
    const auth = new SpotifyAuth({
      db,
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:8787/callback",
    });
    await expect(auth.accessToken()).rejects.toThrow(SpotifyAuthError);
  });
});
