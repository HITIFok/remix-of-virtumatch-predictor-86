#!/usr/bin/env python3
"""Neon MCP Client — Scientific Audit via Streamable HTTP + Bearer token."""
import asyncio
import json
import sys
import os

# Load the access token
TOKEN_FILE = "/home/z/my-project/scripts/.neon-oauth-token.json"
with open(TOKEN_FILE) as f:
    token_data = json.load(f)

ACCESS_TOKEN = token_data["access_token"]
NEON_MCP_URL = "https://mcp.neon.tech/mcp"

async def call_mcp_tool(tool_name: str, arguments: dict = None):
    """Call an MCP tool on the Neon MCP server via Streamable HTTP."""
    from fastmcp import Client
    from fastmcp.client.transports import StreamableHttpTransport
    
    transport = StreamableHttpTransport(
        url=NEON_MCP_URL,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
    )
    
    async with Client(transport=transport) as client:
        result = await client.call_tool(tool_name, arguments or {})
        # Extract text content from the result
        texts = []
        for content in result.content:
            if hasattr(content, 'text'):
                texts.append(content.text)
            elif hasattr(content, 'data'):
                texts.append(str(content.data))
            else:
                texts.append(str(content))
        return "\n".join(texts)

async def list_tools():
    """List all available tools on the Neon MCP server."""
    from fastmcp import Client
    from fastmcp.client.transports import StreamableHttpTransport
    
    transport = StreamableHttpTransport(
        url=NEON_MCP_URL,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
    )
    
    async with Client(transport=transport) as client:
        tools = await client.list_tools()
        return [(t.name, t.description[:100] if t.description else "") for t in tools]

async def main():
    print("═" * 60)
    print("  Neon MCP — Scientific Audit (READ ONLY)")
    print("═" * 60)
    
    # Step 1: List available tools
    print("\n📋 Available Neon MCP tools:")
    print("─" * 40)
    try:
        tools = await list_tools()
        for name, desc in sorted(tools):
            print(f"  {name}: {desc}")
        print(f"\n  Total: {len(tools)} tools")
    except Exception as e:
        print(f"  ❌ Error listing tools: {e}")
        return 1
    
    # Step 2: List projects
    print("\n📁 Neon Projects:")
    print("─" * 40)
    try:
        result = await call_mcp_tool("list_projects", {})
        print(result[:2000])
    except Exception as e:
        print(f"  ❌ Error: {e}")
    
    # Step 3: Find VirtuMatch project
    print("\n🔍 Identifying VirtuMatch project...")
    print("─" * 40)
    try:
        result = await call_mcp_tool("list_projects", {})
        projects = json.loads(result)
        if isinstance(projects, list):
            for p in projects:
                name = p.get("name", "")
                pid = p.get("id", "")
                print(f"  Project: {name} (id={pid})")
        else:
            print(result[:1000])
    except Exception as e:
        print(f"  Note: {e}")
        # Try alternative - the list_projects might return a different format
        try:
            result = await call_mcp_tool("list_projects", {})
            print(result[:2000])
        except Exception as e2:
            print(f"  ❌ {e2}")

asyncio.run(main())
