import { createHash, randomBytes } from "node:crypto";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateVerifier(bytes = 64): string {
  return base64url(randomBytes(bytes));
}

export function challengeFromVerifier(v: string): string {
  const hash = createHash("sha256").update(v).digest();
  return base64url(hash);
}

export function buildAuthorizeUrl(o: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: o.clientId,
    response_type: "code",
    redirect_uri: o.redirectUri,
    code_challenge_method: "S256",
    code_challenge: o.codeChallenge,
    state: o.state,
    scope: o.scopes.join(" "),
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}
