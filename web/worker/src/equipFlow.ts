/**
 * worker/src/equipFlow.ts — shared transfer-then-equip pipeline for
 * /api/equip and /api/equip-with-mods.
 *
 * Bungie's EquipItems only works on items already sitting on the target
 * character, and TransferItem into a character bucket fails with
 * DestinyNoRoomInDestination once the bucket holds 9 unequipped items
 * (10 minus the equipped one). Real accounts run full buckets constantly,
 * so the naive vault→char→equip flow silently dies. This pipeline makes
 * equip work from ANY starting location:
 *
 *   vault                     → auto-vault the weakest unfavorited piece if
 *                               the target bucket is full, then transfer in
 *   another character         → transfer to vault, then as above
 *   EQUIPPED on another char  → equip a spare piece there first (frees it),
 *                               then as above
 *
 * Finally EquipItems runs non-exotics-first (an incoming exotic conflicts
 * with a different-slot exotic still equipped until its replacement lands)
 * with one retry pass for stragglers.
 */
import type { Env } from "./index";
import type { StoredUser } from "./auth";
import { bungieGet, bungiePost } from "./bungie";

/** Unequipped items a character bucket can hold (10 total incl. equipped). */
const BUCKET_CAP = 9;

export interface EquipOutcome {
  equipped_count: number;
  transferred_count: number;
  /** Pieces auto-moved to the vault to make room. */
  vaulted: Array<{ instance_id: string; hash: number }>;
  /** Pieces equipped on OTHER characters to free an incoming item. */
  swapped: Array<{ instance_id: string; hash: number; character_id: string }>;
  skipped: Array<{ instance_id: string; reason: string }>;
}

/** Static item-def facts needed here (intrinsic bucket + exotic-ness),
 *  fetched per hash from the manifest endpoint and KV-cached for 7 days. */
async function itemDefInfo(
  env: Env,
  hash: number,
): Promise<{ bucket: number; exotic: boolean }> {
  const key = `itemdef:${hash}`;
  const cached = await env.DV_KV.get(key);
  if (cached) return JSON.parse(cached);
  const def = await bungieGet(
    env,
    `/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`,
  );
  const info = {
    bucket: def?.inventory?.bucketTypeHash ?? 0,
    exotic: def?.inventory?.tierType === 6,   // TierType.Exotic
  };
  await env.DV_KV.put(key, JSON.stringify(info), { expirationTtl: 7 * 86400 });
  return info;
}

export async function transferAndEquip(
  env: Env,
  u: StoredUser,
  target: string,
  ids: string[],
): Promise<EquipOutcome> {
  // Fresh snapshot: 102 vault, 201 char inventories, 205 equipped,
  // 304 per-instance stats (picks the weakest piece to evict).
  const profile = await bungieGet(
    env,
    `/Destiny2/${u.membership_type}/Profile/${u.membership_id}/?components=102,201,205,304`,
    u.access_token,
  );
  const vaultItems = profile?.profileInventory?.data?.items ?? [];
  const charInv = profile?.characterInventories?.data ?? {};
  const equipped = profile?.characterEquipment?.data ?? {};
  const statsData = profile?.itemComponents?.stats?.data ?? {};

  const statTotal = (iid: string): number => {
    const st = statsData[iid]?.stats ?? {};
    let s = 0;
    for (const v of Object.values(st) as any[]) s += v?.value ?? 0;
    return s;
  };

  // instance_id → { hash, loc, bucket? }. Vault items sit in the shared vault
  // bucket, so their INTRINSIC bucket comes from the item def instead.
  const where: Record<string, { hash: number; loc: string; bucket?: number }> = {};
  // charId → bucketHash → unequipped items there (live-updated as we move).
  const stock: Record<string, Record<number, Array<{ iid: string; hash: number }>>> = {};

  for (const it of vaultItems) {
    if (it.itemInstanceId) where[String(it.itemInstanceId)] = { hash: it.itemHash, loc: "vault" };
  }
  for (const [cid, inv] of Object.entries(charInv) as Array<[string, any]>) {
    for (const it of inv.items ?? []) {
      if (!it.itemInstanceId) continue;
      const iid = String(it.itemInstanceId);
      where[iid] = { hash: it.itemHash, loc: `char:${cid}`, bucket: it.bucketHash };
      (((stock[cid] ??= {})[it.bucketHash] ??= [])).push({ iid, hash: it.itemHash });
    }
  }
  for (const [cid, eq] of Object.entries(equipped) as Array<[string, any]>) {
    for (const it of eq.items ?? []) {
      if (!it.itemInstanceId) continue;
      where[String(it.itemInstanceId)] = { hash: it.itemHash, loc: `equipped:${cid}`, bucket: it.bucketHash };
    }
  }

  const incoming = new Set(ids);
  const tags = u.item_tags ?? {};
  const skipped: EquipOutcome["skipped"] = [];
  const vaulted: EquipOutcome["vaulted"] = [];
  const swapped: EquipOutcome["swapped"] = [];
  const readyToEquip: string[] = [];

  // Item-def facts for every incoming hash (bucket for vault items, exotic
  // flag for equip ordering). KV-cached, so steady-state adds no calls.
  const defs: Record<number, { bucket: number; exotic: boolean }> = {};
  for (const iid of ids) {
    const h = where[iid]?.hash;
    if (h && !defs[h]) {
      try { defs[h] = await itemDefInfo(env, h); } catch { /* ordering degrades gracefully */ }
    }
  }

  const transfer = (iid: string, hash: number, toVault: boolean, charId: string) =>
    bungiePost(env, "/Destiny2/Actions/Items/TransferItem/", u.access_token, {
      itemReferenceHash: hash,
      stackSize: 1,
      transferToVault: toVault,
      itemId: iid,
      characterId: charId,
      membershipType: u.membership_type,
    });

  for (const iid of ids) {
    const info = where[iid];
    if (!info) {
      skipped.push({ instance_id: iid, reason: "not found in inventory" });
      continue;
    }
    const bucket = info.bucket ?? defs[info.hash]?.bucket ?? 0;
    try {
      if (info.loc === `char:${target}` || info.loc === `equipped:${target}`) {
        readyToEquip.push(iid);
        continue;
      }

      // EQUIPPED on another character → equip a spare there to free it.
      if (info.loc.startsWith("equipped:")) {
        const src = info.loc.split(":")[1];
        const spares = stock[src]?.[bucket] ?? [];
        const spareIdx = spares.findIndex((x) => !incoming.has(x.iid));
        if (spareIdx < 0) {
          skipped.push({ instance_id: iid, reason: "equipped on another character with no spare piece to swap in" });
          continue;
        }
        const spare = spares[spareIdx];
        await bungiePost(env, "/Destiny2/Actions/Items/EquipItems/", u.access_token, {
          itemIds: [spare.iid], characterId: src, membershipType: u.membership_type,
        });
        // The spare left the unequipped stock; the freed item joined it.
        spares.splice(spareIdx, 1);
        spares.push({ iid, hash: info.hash });
        swapped.push({ instance_id: spare.iid, hash: spare.hash, character_id: src });
        info.loc = `char:${src}`;
      }

      // Unequipped on another character → stage through the vault.
      if (info.loc.startsWith("char:") && info.loc !== `char:${target}`) {
        const src = info.loc.split(":")[1];
        await transfer(iid, info.hash, true, src);
        const s = stock[src]?.[bucket];
        if (s) {
          const i = s.findIndex((x) => x.iid === iid);
          if (i >= 0) s.splice(i, 1);
        }
        info.loc = "vault";
      }

      // Vault → target character, evicting the weakest piece if the bucket
      // is at cap (favorited/keep-tagged and incoming pieces are never evicted).
      if (info.loc === "vault") {
        const bucketStock = ((stock[target] ??= {})[bucket] ??= []);
        if (bucket && bucketStock.length >= BUCKET_CAP) {
          const evictable = bucketStock
            .filter((x) => !incoming.has(x.iid) && tags[x.iid] !== "favorite" && tags[x.iid] !== "keep")
            .sort((a, b) => statTotal(a.iid) - statTotal(b.iid));
          const evict = evictable[0];
          if (!evict) {
            skipped.push({ instance_id: iid, reason: "bucket full and every piece there is favorited/incoming" });
            continue;
          }
          await transfer(evict.iid, evict.hash, true, target);
          bucketStock.splice(bucketStock.findIndex((x) => x.iid === evict.iid), 1);
          vaulted.push({ instance_id: evict.iid, hash: evict.hash });
        }
        await transfer(iid, info.hash, false, target);
        bucketStock.push({ iid, hash: info.hash });
        info.loc = `char:${target}`;
      }

      readyToEquip.push(iid);
    } catch (e: any) {
      skipped.push({ instance_id: iid, reason: `transfer failed: ${e.message ?? e}` });
    }
  }

  // Equip non-exotics first: an incoming exotic can't equip while a
  // DIFFERENT-slot exotic is still equipped — its legendary replacement in
  // this same batch must land first. One retry pass mops up any stragglers
  // (Bungie reports per-item equipStatus, PlatformErrorCodes; 1 = Success).
  readyToEquip.sort((a, b) =>
    Number(defs[where[a].hash]?.exotic ?? false) - Number(defs[where[b].hash]?.exotic ?? false),
  );

  let equippedCount = 0;
  if (readyToEquip.length) {
    let pending = readyToEquip;
    for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
      const resp = await bungiePost(env, "/Destiny2/Actions/Items/EquipItems/", u.access_token, {
        itemIds: pending, characterId: target, membershipType: u.membership_type,
      });
      const results = resp?.equipResults ?? [];
      if (!results.length) { equippedCount += pending.length; pending = []; break; }
      const failed: string[] = [];
      for (const r of results) {
        if (r.equipStatus === 1) equippedCount++;
        else failed.push(String(r.itemInstanceId));
      }
      if (attempt === 1) {
        for (const r of results) {
          if (r.equipStatus !== 1) {
            skipped.push({ instance_id: String(r.itemInstanceId), reason: `equip failed (Bungie status ${r.equipStatus})` });
          }
        }
      }
      pending = failed;
    }
  }

  return {
    equipped_count: equippedCount,
    transferred_count: readyToEquip.length,
    vaulted,
    swapped,
    skipped,
  };
}
