import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  challengeFromVerifier,
  generateVerifier,
} from "../../src/spotify/pkce.js";

describe("generateVerifier", () => {
  it("produces a base64url string with no padding", () => {
    const verifier = generateVerifier();
    expect(verifier).not.toMatch(/[+/=]/);
    expect(verifier.length).toBeGreaterThan(0);
  });

  it("produces different verifiers on each call", () => {
    expect(generateVerifier()).not.toBe(generateVerifier());
  });
});

describe("challengeFromVerifier", () => {
  it("matches the RFC 7636 Appendix B known test vector", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(challengeFromVerifier(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("buildAuthorizeUrl", () => {
  it("contains client_id, S256 method, and an encoded redirect_uri", () => {
    const url = buildAuthorizeUrl({
      clientId: "abc123",
      redirectUri: "http://127.0.0.1:8787/callback",
      scopes: ["playlist-modify-private", "playlist-read-private"],
      state: "xyz-state",
      codeChallenge: "challenge-value",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("abc123");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(parsed.searchParams.get("state")).toBe("xyz-state");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8787/callback");
    expect(parsed.searchParams.get("scope")).toBe("playlist-modify-private playlist-read-private");
    expect(parsed.searchParams.get("response_type")).toBe("code");
  });
});
