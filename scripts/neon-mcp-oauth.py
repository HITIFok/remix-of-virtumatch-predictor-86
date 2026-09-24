#!/usr/bin/env python3
"""Neon MCP OAuth flow — full PKCE + authorization code exchange."""
import asyncio
import sys
import json
import secrets
import hashlib
import base64
import httpx
from urllib.parse import urlencode, urlparse, parse_qs

NEON_MCP_URL = "https://mcp.neon.tech/mcp"
OAUTH_BASE = "https://mcp.neon.tech"
CALLBACK_PORT = 19999  # Use a high port to avoid conflicts

async def register_client():
    """Step 1: Dynamic Client Registration (RFC 7591)."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{OAUTH_BASE}/api/register", json={
            "client_name": "virtumatch-scientific-audit-read",
            "redirect_uris": [f"http://localhost:{CALLBACK_PORT}/callback"],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": "read",  # READ ONLY
        })
        data = resp.json()
        if resp.status_code not in (200, 201) or "client_id" not in data:
            print(f"Registration failed: {resp.status_code} {resp.text}")
            return None
        print(f"✅ Client registered: client_id={data['client_id']}")
        return data

async def build_auth_url(client_info):
    """Step 2: Build authorization URL with PKCE."""
    code_verifier = secrets.token_urlsafe(32)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b'=').decode()
    state = secrets.token_urlsafe(16)
    
    params = {
        "client_id": client_info["client_id"],
        "redirect_uri": f"http://localhost:{CALLBACK_PORT}/callback",
        "response_type": "code",
        "scope": "read",  # READ ONLY
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{OAUTH_BASE}/api/authorize?{urlencode(params)}"
    return auth_url, state, code_verifier

async def exchange_code(client_info, code, code_verifier):
    """Step 3: Exchange authorization code for access token."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{OAUTH_BASE}/api/token", data={
            "grant_type": "authorization_code",
            "client_id": client_info["client_id"],
            "client_secret": client_info.get("client_secret", ""),
            "code": code,
            "redirect_uri": f"http://localhost:{CALLBACK_PORT}/callback",
            "code_verifier": code_verifier,
        })
        if resp.status_code != 200:
            print(f"Token exchange failed: {resp.status_code} {resp.text}")
            return None
        data = resp.json()
        print(f"✅ Access token obtained (scope: {data.get('scope', 'unknown')})")
        return data

async def main():
    print("═" * 60)
    print("  Neon MCP OAuth — READ-ONLY Access")
    print("═" * 60)
    
    # Step 1: Register
    client_info = await register_client()
    if not client_info:
        return 1
    
    # Step 2: Build auth URL
    auth_url, state, code_verifier = await build_auth_url(client_info)
    
    print(f"\n📋 Authorization URL:")
    print(f"   {auth_url}")
    print(f"\n   Scope: read (ONLY — no write access)")
    print(f"   State: {state}")
    print(f"   Callback: http://localhost:{CALLBACK_PORT}/callback")
    
    # Save state for the callback handler
    oauth_state = {
        "client_info": client_info,
        "state": state,
        "code_verifier": code_verifier,
        "auth_url": auth_url,
    }
    
    with open("/home/z/my-project/scripts/.neon-oauth-state.json", "w") as f:
        json.dump(oauth_state, f, indent=2)
    
    print(f"\n💾 OAuth state saved to scripts/.neon-oauth-state.json")
    print(f"\n🔄 NEXT STEPS:")
    print(f"   1. Open the authorization URL in a browser")
    print(f"   2. Log in to Neon and approve the request")
    print(f"   3. The browser will redirect to localhost:{CALLBACK_PORT}/callback?code=...")
    print(f"   4. Copy the 'code' parameter from the URL")
    print(f"   5. Run: python scripts/neon-mcp-oauth.py --exchange <code>")
    
    return 0

if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--exchange":
        # Exchange mode
        code = sys.argv[2]
        with open("/home/z/my-project/scripts/.neon-oauth-state.json") as f:
            state = json.load(f)
        
        async def do_exchange():
            token_data = await exchange_code(
                state["client_info"], code, state["code_verifier"]
            )
            if token_data:
                with open("/home/z/my-project/scripts/.neon-oauth-token.json", "w") as f:
                    json.dump(token_data, f, indent=2)
                print(f"💾 Token saved to scripts/.neon-oauth-token.json")
                print(f"   token_type: {token_data.get('token_type')}")
                print(f"   scope: {token_data.get('scope')}")
                print(f"   expires_in: {token_data.get('expires_in', 'N/A')}s")
        asyncio.run(do_exchange())
    else:
        sys.exit(asyncio.run(main()) or 0)
