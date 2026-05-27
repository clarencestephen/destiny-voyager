/**
 * Bungie API thin client for the Worker.
 * All calls include X-API-Key and (when authed) Authorization: Bearer.
 */

import type { Env } from "./index";

export async function bungieGet(
  env: Env,
  path: string,
  accessToken?: string,
): Promise<any> {
  const headers: Record<string, string> = {
    "X-API-Key": env.BUNGIE_API_KEY,
    "User-Agent": "destiny-voyager/0.1 (+cf-worker)",
  };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const r = await fetch(`${env.BUNGIE_API_BASE}${path}`, { headers });
  const json = await r.json<any>();
  if (!r.ok || json.ErrorCode !== 1) {
    throw new Error(
      `Bungie ${r.status} on ${path}: ${json.ErrorStatus ?? "?"} — ${json.Message ?? ""}`,
    );
  }
  return json.Response;
}

/** POST helper for Bungie write actions (TransferItem, EquipItem, EquipItems). */
export async function bungiePost(
  env: Env,
  path: string,
  accessToken: string,
  body: any,
): Promise<any> {
  const r = await fetch(`${env.BUNGIE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "X-API-Key": env.BUNGIE_API_KEY,
      "User-Agent": "destiny-voyager/0.1 (+cf-worker)",
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await r.json<any>();
  if (!r.ok || (json.ErrorCode !== undefined && json.ErrorCode !== 1)) {
    throw new Error(
      `Bungie ${r.status} on ${path}: ${json.ErrorStatus ?? "?"} — ${json.Message ?? ""}`,
    );
  }
  return json.Response ?? json;
}

/** Convenience: full inventory snapshot with the components we care about. */
export async function fetchInventorySnapshot(
  env: Env,
  accessToken: string,
  membershipType: number,
  membershipId: string,
): Promise<any> {
  const components = [100, 102, 200, 201, 205, 206, 300, 302, 304, 305].join(",");
  return bungieGet(
    env,
    `/Destiny2/${membershipType}/Profile/${membershipId}/?components=${components}`,
    accessToken,
  );
}
