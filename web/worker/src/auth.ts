/**
 * Bungie OAuth helpers — PKCE flow (Public client type).
 *
 * Bungie's PKCE flow:
 *   1. Generate a random code_verifier (43-128 chars URL-safe)
 *   2. SHA-256 → base64url-strip → code_challenge
 *   3. Redirect user to /OAuth/Authorize?client_id=...&code_challenge=...
 *   4. On callback, POST to /OAuth/Token/ with code + code_verifier
 *   5. Receive access_token (1h) + refresh_token (90d)
 *
 * If BUNGIE_CLIENT_SECRET is configured, the worker uses Confidential client
 * mode instead (client_secret in Authorization header). PKCE is preferred
 * for shipped clients; we keep both paths for flexibility.
 */

import type { Env } from "./index";

export interface StoredUser {
  bungie_id: string;
  membership_type: number;
  membership_id: string;
  display_name: string;
  refresh_token: string;
  access_token: string;
  access_expires_at: number; // unix seconds
  refresh_expires_at: number; // unix seconds
  created_at: number;
  item_tags: Record<string, string>;
  build_focus?: {
    archetype: string;
    goals: string[];
    target_stats: string[];
  };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;        // seconds — typically 3600
  refresh_expires_in: number; // seconds — typically 7776000 (90d)
  membership_id: string;
  token_type: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(input: string): Promise<Uint8Array> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(digest);
}

export async function buildAuthRedirect(env: Env): Promise<{
  url: string;
  state: string;
  codeVerifier: string;
}> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const codeVerifier = base64UrlEncode(verifierBytes);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  const params = new URLSearchParams({
    client_id: env.BUNGIE_CLIENT_ID,
    response_type: "code",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  const url = `${env.BUNGIE_OAUTH_AUTHORIZE_URL}?${params}`;
  return { url, state, codeVerifier };
}

export async function exchangeCode(
  env: Env,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    client_id: env.BUNGIE_CLIENT_ID,
    redirect_uri: `${env.PUBLIC_BASE_URL}${env.OAUTH_REDIRECT_PATH}`,
    code_verifier: codeVerifier,
  };
  // Bungie Confidential clients: client_secret goes in the BODY.
  // (Basic Auth header form is documented but inconsistently accepted.)
  if (env.BUNGIE_CLIENT_SECRET) {
    params.client_secret = env.BUNGIE_CLIENT_SECRET;
  }
  const r = await fetch(env.BUNGIE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = await r.json<any>();
  if (!r.ok || !json.access_token) {
    throw new Error(
      `OAuth token exchange ${r.status}: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json as TokenResponse;
}

export async function refreshAccessToken(
  env: Env,
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.BUNGIE_CLIENT_ID,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (env.BUNGIE_CLIENT_SECRET) {
    const basic = btoa(`${env.BUNGIE_CLIENT_ID}:${env.BUNGIE_CLIENT_SECRET}`);
    headers["Authorization"] = `Basic ${basic}`;
  }
  const r = await fetch(env.BUNGIE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers,
    body,
  });
  const json = await r.json<any>();
  if (!r.ok || !json.access_token) {
    throw new Error(`OAuth refresh ${r.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json as TokenResponse;
}
