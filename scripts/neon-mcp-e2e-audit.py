#!/usr/bin/env python3
"""Neon MCP End-to-End Audit — Phase 5.3.3 Scientific Timeline.
READ ONLY. No INSERT, no UPDATE, no DELETE.

Usage:
  1. First run: python scripts/neon-mcp-oauth.py  (get auth URL)
  2. After OAuth: python scripts/neon-mcp-e2e-audit.py

Queries:
  - 15 scientific predictions: hashes, timestamps, model, scores, eligibility
  - feature_snapshot JSONB inspection: source_timestamps, ai_snapshot
  - t_feature vs t_prediction comparison
  - Hash chain verification
  - Scientific eligibility audit
"""
import asyncio
import json
import sys
import os

TOKEN_FILE = "/home/z/my-project/scripts/.neon-oauth-token.json"
NEON_MCP_URL = "https://mcp.neon.tech/mcp"

# Neon project details (from previous sessions)
PROJECT_ID = "young-sunset-23869032"
BRANCH_ID = "br-small-leaf-aze3fy5t"
DATABASE = "neondb"

try:
    with open(TOKEN_FILE) as f:
        token_data = json.load(f)
    ACCESS_TOKEN = token_data["access_token"]
except FileNotFoundError:
    print("❌ Token file not found. Run neon-mcp-oauth.py first.")
    sys.exit(1)

async def run_sql(sql: str):
    """Execute a READ ONLY SQL query via Neon MCP."""
    from fastmcp import Client
    from fastmcp.client.transports import StreamableHttpTransport

    transport = StreamableHttpTransport(
        url=NEON_MCP_URL,
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
    )

    async with Client(transport=transport) as client:
        result = await client.call_tool("run_sql", {
            "projectId": PROJECT_ID,
            "branchId": BRANCH_ID,
            "databaseName": DATABASE,
            "sql": sql,
        })
        texts = []
        for content in result.content:
            if hasattr(content, 'text'):
                texts.append(content.text)
            elif hasattr(content, 'data'):
                texts.append(str(content.data))
            else:
                texts.append(str(content))
        return "\n".join(texts)

async def main():
    print("═" * 70)
    print("  Phase 5.3.3 — End-to-End Scientific Timeline Audit (READ ONLY)")
    print("═" * 70)

    # ─── Query 1: Global stats ───────────────────────────────────
    print("\n📊 Query 1: Global Prediction Stats")
    print("─" * 50)
    q1 = """
    SELECT
      COUNT(*) as total_predictions,
      COUNT(feature_snapshot) as has_feature_snapshot,
      COUNT(ai_trace) as has_ai_trace,
      COUNT(ai_context_hash) as has_ai_context_hash,
      COUNT(ai_input_hash) as has_ai_input_hash,
      COUNT(ai_prompt_hash) as has_ai_prompt_hash,
      COUNT(ai_response_hash) as has_ai_response_hash,
      COUNT(scientific_collection_eligible) FILTER (WHERE scientific_collection_eligible = true) as eligible_count,
      COUNT(t_feature) as has_t_feature,
      COUNT(t_prediction) as has_t_prediction,
      COUNT(temporal_safety_score) as has_temporal_safety,
      COUNT(temporal_safety_reason) as has_temporal_safety_reason,
      COUNT(timestamp_provenance) as has_timestamp_provenance
    FROM predictions;
    """
    try:
        result = await run_sql(q1)
        print(result)
    except Exception as e:
        print(f"  ❌ Error: {e}")

    # ─── Query 2: 15 scientific predictions detail ────────────────
    print("\n📋 Query 2: 15 Scientific Predictions (with timestamps)")
    print("─" * 50)
    q2 = """
    SELECT
      id,
      home_team,
      away_team,
      league,
      ai_model,
      ai_response_hash IS NOT NULL as has_response_hash,
      t_feature,
      t_prediction,
      snapshot_timestamp,
      completeness_score,
      temporal_safety_score,
      temporal_safety_reason,
      scientific_collection_eligible,
      created_at
    FROM predictions
    WHERE feature_snapshot IS NOT NULL
    ORDER BY created_at DESC;
    """
    try:
        result = await run_sql(q2)
        print(result)
    except Exception as e:
        print(f"  ❌ Error: {e}")

    # ─── Query 3: source_timestamps from feature_snapshot ─────────
    print("\n🔍 Query 3: feature_snapshot.source_timestamps Inspection")
    print("─" * 50)
    q3 = """
    SELECT
      id,
      home_team || ' vs ' || away_team as match_name,
      feature_snapshot->'source_timestamps' as source_timestamps,
      feature_snapshot->'odds'->'source_timestamp' as odds_ts,
      feature_snapshot->'standings'->'source_timestamp' as standings_ts,
      feature_snapshot->'form'->'source_timestamp' as form_ts,
      feature_snapshot->'h2h'->'source_timestamp' as h2h_ts,
      t_feature
    FROM predictions
    WHERE feature_snapshot IS NOT NULL
    ORDER BY created_at DESC;
    """
    try:
        result = await run_sql(q3)
        print(result)
    except Exception as e:
        print(f"  ❌ Error: {e}")

    # ─── Query 4: Hash chain verification ─────────────────────────
    print("\n🔗 Query 4: Hash Chain Verification")
    print("─" * 50)
    q4 = """
    SELECT
      id,
      home_team || ' vs ' || away_team as match_name,
      ai_context_hash IS NOT NULL as has_context_hash,
      ai_input_hash IS NOT NULL as has_input_hash,
      ai_prompt_hash IS NOT NULL as has_prompt_hash,
      ai_response_hash IS NOT NULL as has_response_hash,
      ai_model,
      CASE
        WHEN ai_context_hash IS NOT NULL AND ai_input_hash IS NOT NULL AND ai_prompt_hash IS NOT NULL
          THEN 'CHAIN_OK'
        ELSE 'CHAIN_BROKEN'
      END as context_input_prompt_chain,
      CASE
        WHEN ai_response_hash IS NULL AND ai_model = 'llama-3.3-70b-versatile'
          THEN 'EXPECTED_NULL (old model failed)'
        WHEN ai_response_hash IS NOT NULL
          THEN 'HASH_PRESENT'
        ELSE 'MISSING (unexpected)'
      END as response_hash_status
    FROM predictions
    WHERE feature_snapshot IS NOT NULL
    ORDER BY created_at DESC;
    """
    try:
        result = await run_sql(q4)
        print(result)
    except Exception as e:
        print(f"  ❌ Error: {e}")

    # ─── Query 5: Temporal safety audit ───────────────────────────
    print("\n⏱️  Query 5: Temporal Safety Audit")
    print("─" * 50)
    q5 = """
    SELECT
      id,
      home_team || ' vs ' || away_team as match_name,
      t_feature,
      t_prediction,
      CASE
        WHEN t_feature IS NULL THEN 'T_FEATURE_NULL'
        WHEN t_feature > t_prediction THEN 'FUTURE_LEAK'
        ELSE 'OK'
      END as temporal_order,
      temporal_safety_score,
      temporal_safety_reason,
      scientific_collection_eligible
    FROM predictions
    WHERE feature_snapshot IS NOT NULL
    ORDER BY created_at DESC;
    """
    try:
        result = await run_sql(q5)
        print(result)
    except Exception as e:
        print(f"  ❌ Error: {e}")

    # ─── Query 6: ai_trace inspection (1 row sample) ─────────────
    print("\n🔬 Query 6: ai_trace Inspection (first scientific row)")
    print("─" * 50)
    q6 = """
    SELECT
      id,
      jsonb_pretty(ai_trace->'hashes') as hashes,
      ai_trace->>'model' as ai_model,
      ai_trace->>'prompt_version' as prompt_version,
      ai_trace->>'timestamp' as trace_timestamp
    FROM predictions
    WHERE feature_snapshot IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 1;
    """
    try:
        result = await run_sql(q6)
        print(result)
    except Exception as e:
        print(f"  ❌ Error: {e}")

    print("\n═" * 70)
    print("  Audit complete. All queries were READ ONLY.")
    print("═" * 70)

asyncio.run(main())
