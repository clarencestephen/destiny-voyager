"""
auth.py
=======
Bungie OAuth (PKCE) for desktop apps. No client_secret needed.

Flow:
1. Generate code_verifier (random 64 chars) + code_challenge (sha256, base64url)
2. Open user's browser to https://www.bungie.net/en/OAuth/Authorize with code_challenge
3. Local HTTP listener on http://localhost:8123/callback catches the redirect
4. POST to https://www.bungie.net/Platform/App/OAuth/Token/ with code + code_verifier
5. Save access_token (1h TTL) + refresh_token (90d TTL) to user_config.json
6. On expiry, auto-refresh using the refresh_token

Usage:
    # Interactive sign-in (one-time):
    python3 auth.py

    # From other scripts:
    from auth import get_valid_token, ensure_signed_in
    ensure_signed_in()  # triggers sign-in flow if not authed
    token = get_valid_token()  # returns a usable access_token, refreshes if needed

The refresh_token is stored in user_config.json (gitignored, chmod 600).
"""

import base64
import hashlib
import http.server
import json
import os
import secrets
import socket
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

CONFIG_PATH = Path("user_config.json")

# Bungie OAuth endpoints
AUTHORIZE_URL = "https://www.bungie.net/en/OAuth/Authorize"
TOKEN_URL = "https://www.bungie.net/Platform/App/OAuth/Token/"

# Local callback config — must match what's registered in the Bungie app portal
CALLBACK_HOST = "127.0.0.1"
CALLBACK_PORT = 8123
CALLBACK_PATH = "/callback"
REDIRECT_URI = f"http://localhost:{CALLBACK_PORT}{CALLBACK_PATH}"


def _gen_verifier():
    """Generate a PKCE code_verifier (43-128 chars, URL-safe)."""
    return base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip("=")


def _challenge_for(verifier):
    """Generate the S256 code_challenge from a verifier."""
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def _load_config():
    if not CONFIG_PATH.exists():
        sys.exit(f"ERROR: {CONFIG_PATH} not found. Run `python3 setup.py` first.")
    return json.loads(CONFIG_PATH.read_text())


def _save_config(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n")
    try:
        CONFIG_PATH.chmod(0o600)
    except Exception:
        pass


def _exchange_code(code, verifier, client_id):
    """Exchange auth code for tokens using PKCE."""
    data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def _refresh_token(refresh_token, client_id):
    """Use a refresh_token to get a fresh access_token."""
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    """Single-shot HTTP handler that captures ?code=... from the redirect."""

    received = {}  # class-level so we can access from outside

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != CALLBACK_PATH:
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(parsed.query)
        _CallbackHandler.received.update({k: v[0] for k, v in params.items()})

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        if "code" in _CallbackHandler.received:
            body = (
                "<html><body style='font-family:sans-serif;text-align:center;"
                "padding:60px;color:#1F2937;'>"
                "<h1>✅ Signed in</h1>"
                "<p>You can close this tab and return to the Destiny Voyager installer.</p>"
                "</body></html>"
            )
        else:
            err = _CallbackHandler.received.get("error", "unknown")
            body = (
                f"<html><body style='font-family:sans-serif;text-align:center;"
                f"padding:60px;color:#B91C1C;'>"
                f"<h1>❌ Sign-in failed</h1>"
                f"<p>Error: {err}</p></body></html>"
            )
        self.wfile.write(body.encode())

    def log_message(self, *args):
        pass  # silence default logging


def _start_listener():
    """Bind a one-shot HTTP server on localhost:CALLBACK_PORT."""
    _CallbackHandler.received = {}
    try:
        srv = http.server.HTTPServer((CALLBACK_HOST, CALLBACK_PORT), _CallbackHandler)
    except socket.error as e:
        sys.exit(
            f"ERROR: can't bind {CALLBACK_HOST}:{CALLBACK_PORT} — {e}. "
            "Another app may be using this port. Close it and retry."
        )
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    return srv


def sign_in(client_id, scopes=None):
    """
    Run the full PKCE OAuth flow. Opens browser, waits for callback, exchanges
    code for tokens, saves tokens to user_config.json. Blocking.

    Args:
        client_id: Your Bungie app's client_id (e.g. "52250")
        scopes: Optional space-separated Bungie scope string. None = default scopes.

    Returns:
        dict with access_token, refresh_token, etc.
    """
    print()
    print("  Bungie OAuth — Public client + PKCE")
    print(f"  Redirect URI:  {REDIRECT_URI}")
    print()

    verifier = _gen_verifier()
    challenge = _challenge_for(verifier)
    state = secrets.token_urlsafe(16)

    params = {
        "client_id": client_id,
        "response_type": "code",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"

    srv = _start_listener()
    print(f"  Opening browser → {auth_url[:80]}...")
    try:
        webbrowser.open(auth_url)
    except Exception:
        print(f"  Couldn't open browser. Visit this URL manually:\n    {auth_url}")
    print()
    print("  Waiting for callback... (sign in + authorize in your browser)")

    # Wait up to 5 minutes for the callback
    deadline = time.time() + 300
    while time.time() < deadline:
        if "code" in _CallbackHandler.received or "error" in _CallbackHandler.received:
            break
        time.sleep(0.3)
    srv.shutdown()

    if "error" in _CallbackHandler.received:
        sys.exit(f"  ERROR: {_CallbackHandler.received['error']}")
    if "code" not in _CallbackHandler.received:
        sys.exit("  ERROR: timed out waiting for callback (5 min).")
    if _CallbackHandler.received.get("state") != state:
        sys.exit("  ERROR: state mismatch (possible CSRF). Aborting.")

    code = _CallbackHandler.received["code"]
    print(f"  Got auth code. Exchanging for tokens...")
    tokens = _exchange_code(code, verifier, client_id)
    if "access_token" not in tokens:
        sys.exit(f"  ERROR: token exchange failed: {tokens}")

    # Persist tokens
    cfg = _load_config()
    cfg["oauth"] = {
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "expires_at": int(time.time()) + int(tokens.get("expires_in", 3600)) - 60,
        "membership_id": tokens.get("membership_id"),
        "token_type": tokens.get("token_type", "Bearer"),
    }
    _save_config(cfg)
    print(f"  ✓ Signed in. Membership ID: {tokens.get('membership_id')}")
    return tokens


def get_valid_token(client_id=None):
    """
    Return a non-expired access_token. Refreshes if needed using refresh_token.
    Returns None if not signed in (caller should prompt user).
    """
    cfg = _load_config()
    oauth = cfg.get("oauth")
    if not oauth or "access_token" not in oauth:
        return None

    if oauth.get("expires_at", 0) > int(time.time()):
        return oauth["access_token"]

    # Expired — refresh
    rt = oauth.get("refresh_token")
    if not rt:
        return None
    client_id = client_id or cfg.get("oauth_client_id") or "52250"
    print("  Access token expired — refreshing...")
    try:
        tokens = _refresh_token(rt, client_id)
    except Exception as e:
        print(f"  Refresh failed: {e}. Re-sign-in required.")
        return None
    if "access_token" not in tokens:
        return None
    oauth.update({
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token", rt),
        "expires_at": int(time.time()) + int(tokens.get("expires_in", 3600)) - 60,
    })
    cfg["oauth"] = oauth
    _save_config(cfg)
    return oauth["access_token"]


def ensure_signed_in(client_id=None):
    """If no valid token, run the sign-in flow. Otherwise no-op."""
    cfg = _load_config()
    client_id = client_id or cfg.get("oauth_client_id")
    if not client_id:
        sys.exit("ERROR: oauth_client_id not in user_config.json. "
                 "Add it (default: 52250) and re-run.")
    if get_valid_token(client_id):
        print(f"  Already signed in.")
        return
    sign_in(client_id)


def main():
    """CLI: trigger sign-in interactively."""
    cfg = _load_config()
    client_id = cfg.get("oauth_client_id", "52250")
    sign_in(client_id)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  Aborted.")
        sys.exit(130)
