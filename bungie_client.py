"""
bungie_client.py
================
Thin wrapper around Bungie's Destiny 2 API. Handles:
  - X-API-Key header on every call
  - Bearer token from auth.py for privileged calls
  - Membership lookup (which platform you play on)
  - Profile/inventory fetching with components
  - Saved in-game loadouts fetching

Bungie API docs: https://bungie-net.github.io/multi/

Component constants (subset we use):
  100  Profiles
  102  ProfileInventory                (vault contents)
  103  ProfileCurrencies               (glimmer, materials)
  200  Characters
  201  CharacterInventories            (per-character inventory)
  202  CharacterProgressions
  205  CharacterEquipment              (currently equipped)
  300  ItemInstances                   (instance-specific data: power, primary stat)
  302  ItemPerks                       (the perks rolled on each item)
  304  ItemStats                       (stat values)
  305  ItemSockets                     (mods + plug data)
  308  ItemCommonData
  309  ItemPlugObjectives
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://www.bungie.net/Platform"
USER_AGENT = "destiny-voyager/0.2"

# Membership type → readable name
PLATFORM_NAMES = {
    1: "Xbox",
    2: "PlayStation",
    3: "Steam",
    4: "Blizzard",
    5: "Stadia",
    6: "Epic",
    254: "Bungie.net",
}


def _load_config():
    cfg_path = Path("user_config.json")
    if not cfg_path.exists():
        sys.exit("ERROR: user_config.json not found. Run setup.py first.")
    return json.loads(cfg_path.read_text())


class BungieClient:
    def __init__(self, api_key=None, access_token=None):
        cfg = _load_config()
        self.api_key = api_key or cfg["api_key"]
        self.access_token = access_token

    def _headers(self, authed=False):
        h = {
            "X-API-Key": self.api_key,
            "User-Agent": USER_AGENT,
        }
        if authed:
            if not self.access_token:
                # Lazy import to avoid circular dependency in --help paths
                from auth import get_valid_token
                self.access_token = get_valid_token()
                if not self.access_token:
                    sys.exit("ERROR: not signed in. Run `python3 auth.py`.")
            h["Authorization"] = f"Bearer {self.access_token}"
        return h

    def get(self, path, authed=False, **params):
        """GET {BASE}{path}?{params}. Returns the 'Response' field of the result."""
        url = f"{BASE}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers=self._headers(authed=authed))
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode() if e.fp else ""
            raise RuntimeError(f"Bungie API {e.code} on {path}: {body[:300]}")
        if data.get("ErrorCode", 1) != 1:
            raise RuntimeError(f"Bungie API error on {path}: "
                               f"{data.get('ErrorStatus')} — {data.get('Message')}")
        return data["Response"]

    # ---------- High-level helpers ----------

    def get_bungie_user(self):
        """Current Bungie.net user (after sign-in)."""
        return self.get("/User/GetCurrentBungieNetUser/", authed=True)

    def get_memberships(self):
        """
        Destiny memberships for the signed-in user across platforms.
        Returns a list of dicts with membershipType + membershipId + displayName.
        """
        data = self.get("/User/GetMembershipsForCurrentUser/", authed=True)
        return data["destinyMemberships"]

    def get_primary_membership(self):
        """Pick the primary cross-save profile (or first if no primary)."""
        memberships = self.get_memberships()
        if not memberships:
            sys.exit("ERROR: no Destiny memberships on this Bungie account.")
        # Bungie marks the cross-save primary one
        for m in memberships:
            if m.get("crossSaveOverride") == m["membershipType"]:
                return m
        return memberships[0]

    def get_profile(self, membership_type, membership_id, components):
        """
        Get a Destiny 2 profile with the requested components.
        components: list of component IDs (e.g. [100, 102, 200, 205, 300, 305])
        """
        comp_str = ",".join(str(c) for c in components)
        return self.get(
            f"/Destiny2/{membership_type}/Profile/{membership_id}/",
            authed=True,
            components=comp_str,
        )

    def get_inventory_snapshot(self):
        """
        Full snapshot — profile + vault + characters + per-character inventory
        + equipped + item instance data + sockets.
        """
        m = self.get_primary_membership()
        components = [100, 102, 200, 201, 205, 300, 302, 304, 305]
        prof = self.get_profile(m["membershipType"], m["membershipId"], components)
        return {
            "membership": m,
            "profile": prof,
            "fetched_at": int(time.time()),
        }

    def get_in_game_loadouts(self):
        """
        Saved in-game loadouts (Lightfall+ feature). One set per character.
        """
        m = self.get_primary_membership()
        # Component 206 = CharacterLoadouts
        prof = self.get_profile(m["membershipType"], m["membershipId"], [200, 206])
        chars = prof.get("characters", {}).get("data", {})
        loadouts = prof.get("characterLoadouts", {}).get("data", {})
        return {"membership": m, "characters": chars, "loadouts": loadouts}


def main():
    """CLI sanity check — print signed-in user + memberships."""
    client = BungieClient()
    try:
        user = client.get_bungie_user()
        print(f"Signed in as: {user.get('uniqueName') or user.get('displayName')}")
    except Exception as e:
        print(f"User fetch failed: {e}")
        return
    memberships = client.get_memberships()
    print(f"\nDestiny memberships ({len(memberships)}):")
    for m in memberships:
        plat = PLATFORM_NAMES.get(m["membershipType"], f"Type {m['membershipType']}")
        primary = " (primary)" if m.get("crossSaveOverride") == m["membershipType"] else ""
        print(f"  {plat:12} {m['displayName']}  id={m['membershipId']}{primary}")


if __name__ == "__main__":
    main()
