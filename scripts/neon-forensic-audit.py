#!/usr/bin/env python3
"""Neon MCP Forensic Audit — All 15 Scientific Predictions (READ ONLY)."""
import asyncio
import json
import sys

# We need a fresh OAuth token for this session
# The user should re-authorize if needed

NEON_MCP_URL = "https://mcp.neon.tech/mcp"
BRANCH_ID = "br-small-leaf-aze3fy5t"
DB_NAME = "neondb"
TOKEN_FILE = "/home/z/my-project/scripts/.neon-oauth-token.json"

def load_token():
    with open(TOKEN_FILE) as f:
        return json.load(f)["access_token"]

async def run_sql(client, sql):
    result = await client.call_tool("run_sql", {
        "branch_id": BRANCH_ID,
        "database_name": DB_NAME,
        "sql": sql,
    })
    texts = []
    for c in result.content:
        if hasattr(c, "text"):
            texts.append(c.text)
    return "\n".join(texts)

async def main():
    from fastmcp import Client
    from fastmcp.client.transports import StreamableHttpTransport

    access_token = load_token()
    transport = StreamableHttpTransport(
        url=NEON_MCP_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )

    async with Client(transport=transport) as client:
        # ═══ ÉTAPE 1: List all 15 scientific predictions ═══
        print("═" * 70)
        print("  ÉTAPE 1 — Les 15 prédictions scientifiques")
        print("═" * 70)

        r = await run_sql(client, """
            SELECT 
                id,
                home_team,
                away_team,
                created_at,
                t_prediction,
                snapshot_timestamp,
                ai_model,
                ai_prompt_version,
                scientific_collection_eligible,
                completeness_score,
                temporal_safety_score,
                feature_snapshot IS NOT NULL as has_snapshot,
                ai_trace IS NOT NULL as has_trace,
                ai_context_hash IS NOT NULL as has_ctx_hash,
                ai_input_hash IS NOT NULL as has_inp_hash,
                ai_prompt_hash IS NOT NULL as has_prm_hash,
                ai_response_hash IS NOT NULL as has_res_hash,
                LEFT(ai_context_hash, 12) as ctx_hash_prefix,
                LEFT(ai_input_hash, 12) as inp_hash_prefix,
                LEFT(ai_prompt_hash, 12) as prm_hash_prefix,
                LEFT(ai_response_hash, 12) as res_hash_prefix,
                t_feature
            FROM predictions
            WHERE feature_snapshot IS NOT NULL
            ORDER BY created_at ASC
        """)
        data = json.loads(r)
        print(f"\n{'#':>2} | {'Home':>15} vs {'Away':<15} | {'Model':>22} | Elig | Compl | Temp | Ctx | Inp | Prm | Res | Created")
        print("─" * 120)
        for i, p in enumerate(data, 1):
            elig = "✅" if p["scientific_collection_eligible"] else "❌"
            compl = f"{p['completeness_score']:.3f}" if p["completeness_score"] else "NULL"
            temp = f"{p['temporal_safety_score']:.1f}" if p["temporal_safety_score"] else "NULL"
            ctx = "✓" if p["has_ctx_hash"] else "✗"
            inp = "✓" if p["has_inp_hash"] else "✗"
            prm = "✓" if p["has_prm_hash"] else "✗"
            res = "✓" if p["has_res_hash"] else "✗"
            created = p["created_at"][:16] if p["created_at"] else "?"
            model = p["ai_model"] or "NULL"
            print(f"{i:>2} | {p['home_team']:>15} vs {p['away_team']:<15} | {model:>22} | {elig}  | {compl:>5} | {temp:>4} |  {ctx}  |  {inp}  |  {prm}  |  {res}  | {created}")

        # Hash prefixes
        print(f"\nHash prefixes (first 12 chars):")
        for i, p in enumerate(data, 1):
            ctx_h = p.get("ctx_hash_prefix") or "NULL"
            inp_h = p.get("inp_hash_prefix") or "NULL"
            prm_h = p.get("prm_hash_prefix") or "NULL"
            res_h = p.get("res_hash_prefix") or "NULL"
            print(f"  {i:>2}: ctx={ctx_h}  inp={inp_h}  prm={prm_h}  res={res_h}")

        # ═══ ÉTAPE 2: Inspect the 14 old ai_trace JSONB ═══
        print("\n" + "═" * 70)
        print("  ÉTAPE 2 — Inspection des 14 anciennes ai_trace (llama-3.3-70b-versatile)")
        print("═" * 70)

        r = await run_sql(client, """
            SELECT id, home_team, away_team, ai_trace
            FROM predictions
            WHERE feature_snapshot IS NOT NULL
              AND ai_model = 'llama-3.3-70b-versatile'
            ORDER BY created_at ASC
            LIMIT 3
        """)
        old_traces = json.loads(r)
        
        # Analyze structure of the first trace as representative
        if old_traces:
            t0 = old_traces[0]
            trace = t0["ai_trace"]
            print(f"\n  Representative trace: {t0['home_team']} vs {t0['away_team']}")
            print(f"  Top-level keys: {list(trace.keys())}")
            
            # Check for nested structures
            for key, val in trace.items():
                if isinstance(val, dict):
                    print(f"    {key}: dict with keys {list(val.keys())}")
                elif isinstance(val, list):
                    print(f"    {key}: list[{len(val)}]")
                else:
                    val_str = str(val)
                    if len(val_str) > 60:
                        val_str = val_str[:60] + "..."
                    print(f"    {key}: {val_str}")
            
            # Check specific fields of interest
            print(f"\n  Field presence across all 14 old traces:")
            fields_to_check = [
                "provider", "model", "prompt_version", "temperature",
                "system_prompt_hash", "user_prompt_hash",
                "ai_input_hash", "ai_prompt_hash", "ai_response_hash",
                "request_timestamp", "response_timestamp",
                "context", "snapshot", "hashes", "timestamp"
            ]
            
            # Get all 14 traces for field analysis
            r = await run_sql(client, """
                SELECT ai_trace
                FROM predictions
                WHERE feature_snapshot IS NOT NULL
                  AND ai_model = 'llama-3.3-70b-versatile'
                ORDER BY created_at ASC
            """)
            all_old_traces = json.loads(r)
            
            for field in fields_to_check:
                present = sum(1 for t in all_old_traces if field in (t["ai_trace"] or {}))
                print(f"    {field}: {present}/14")

        # ═══ ÉTAPE 3: Inspect the 1 qwen trace ═══
        print("\n" + "═" * 70)
        print("  ÉTAPE 3 — Trace qwen/qwen3.8-27b (comparison)")
        print("═" * 70)

        r = await run_sql(client, """
            SELECT id, home_team, away_team, ai_trace, ai_response_hash
            FROM predictions
            WHERE feature_snapshot IS NOT NULL
              AND ai_model = 'qwen/qwen3.8-27b'
            ORDER BY created_at ASC
        """)
        qwen_traces = json.loads(r)
        
        if qwen_traces:
            qt = qwen_traces[0]
            trace = qt["ai_trace"]
            print(f"\n  Qwen trace: {qt['home_team']} vs {qt['away_team']}")
            print(f"  Top-level keys: {list(trace.keys())}")
            
            for key, val in trace.items():
                if isinstance(val, dict):
                    print(f"    {key}: dict with keys {list(val.keys())}")
                elif isinstance(val, list):
                    print(f"    {key}: list[{len(val)}]")
                else:
                    val_str = str(val)
                    if len(val_str) > 60:
                        val_str = val_str[:60] + "..."
                    print(f"    {key}: {val_str}")
            
            # Compare old vs qwen keys
            if old_traces:
                old_keys = set((old_traces[0]["ai_trace"] or {}).keys())
                qwen_keys = set((trace or {}).keys())
                
                only_in_qwen = qwen_keys - old_keys
                only_in_old = old_keys - qwen_keys
                shared = old_keys & qwen_keys
                
                print(f"\n  Key comparison:")
                print(f"    Shared keys ({len(shared)}): {sorted(shared)}")
                print(f"    Only in Qwen ({len(only_in_qwen)}): {sorted(only_in_qwen)}")
                print(f"    Only in Old ({len(only_in_old)}): {sorted(only_in_old)}")
                
                # Check nested 'hashes' dict differences
                old_hashes = (old_traces[0]["ai_trace"] or {}).get("hashes", {})
                qwen_hashes = (trace or {}).get("hashes", {})
                if old_hashes or qwen_hashes:
                    print(f"\n  Nested 'hashes' comparison:")
                    old_h_keys = set(old_hashes.keys())
                    qwen_h_keys = set(qwen_hashes.keys())
                    print(f"    Old hashes keys: {sorted(old_h_keys)}")
                    print(f"    Qwen hashes keys: {sorted(qwen_h_keys)}")
                    print(f"    Only in Qwen hashes: {sorted(qwen_h_keys - old_h_keys)}")
                    print(f"    Only in Old hashes: {sorted(old_h_keys - qwen_h_keys)}")

        # ═══ ÉTAPE 4: Hash chain analysis ═══
        print("\n" + "═" * 70)
        print("  ÉTAPE 4 — Hash Chain Analysis")
        print("═" * 70)

        r = await run_sql(client, """
            SELECT 
                id,
                home_team || ' vs ' || away_team as match_name,
                ai_model,
                ai_context_hash IS NOT NULL as has_ctx,
                ai_input_hash IS NOT NULL as has_inp,
                ai_prompt_hash IS NOT NULL as has_prm,
                ai_response_hash IS NOT NULL as has_res,
                CASE 
                    WHEN ai_context_hash IS NOT NULL AND ai_input_hash IS NOT NULL 
                         AND ai_prompt_hash IS NOT NULL AND ai_response_hash IS NOT NULL 
                    THEN 'COMPLETE'
                    WHEN ai_context_hash IS NOT NULL AND ai_input_hash IS NOT NULL 
                         AND ai_prompt_hash IS NOT NULL AND ai_response_hash IS NULL
                    THEN 'STOPS_AT_RESPONSE'
                    WHEN ai_context_hash IS NOT NULL AND ai_input_hash IS NOT NULL 
                         AND ai_prompt_hash IS NULL
                    THEN 'STOPS_AT_PROMPT'
                    WHEN ai_context_hash IS NOT NULL AND ai_input_hash IS NULL
                    THEN 'STOPS_AT_INPUT'
                    WHEN ai_context_hash IS NULL
                    THEN 'STOPS_AT_CONTEXT'
                    ELSE 'EMPTY'
                END as chain_status
            FROM predictions
            WHERE feature_snapshot IS NOT NULL
            ORDER BY created_at ASC
        """)
        chains = json.loads(r)
        
        for c in chains:
            print(f"  {c['match_name']:>35} | {c['ai_model']:>22} | chain: {c['chain_status']}")
        
        # Summary
        statuses = {}
        for c in chains:
            s = c["chain_status"]
            statuses[s] = statuses.get(s, 0) + 1
        print(f"\n  Chain status summary:")
        for s, cnt in sorted(statuses.items()):
            print(f"    {s}: {cnt}")

        # ═══ ÉTAPE 5: Timeline analysis ═══
        print("\n" + "═" * 70)
        print("  ÉTAPE 5 — Timeline Analysis")
        print("═" * 70)

        r = await run_sql(client, """
            SELECT 
                home_team || ' vs ' || away_team as match_name,
                ai_model,
                t_feature,
                t_prediction,
                created_at,
                snapshot_timestamp,
                ai_trace->'timestamp' as trace_timestamp,
                CASE 
                    WHEN t_feature IS NOT NULL AND t_prediction IS NOT NULL 
                         AND t_feature > t_prediction 
                    THEN 'VIOLATION: t_feature > t_prediction'
                    WHEN t_feature IS NOT NULL AND t_prediction IS NOT NULL
                    THEN 'OK'
                    ELSE 'INSUFFICIENT_DATA'
                END as temporal_check
            FROM predictions
            WHERE feature_snapshot IS NOT NULL
            ORDER BY created_at ASC
        """)
        timelines = json.loads(r)
        
        violations = 0
        for t in timelines:
            t_feat = t["t_feature"]
            t_pred = t["t_prediction"]
            check = t["temporal_check"]
            flag = " ⚠️" if "VIOLATION" in check else ""
            if "VIOLATION" in check:
                violations += 1
            t_feat_str = str(t_feat)[:19] if t_feat else "NULL"
            t_pred_str = str(t_pred)[:19] if t_pred else "NULL"
            print(f"  {t['match_name']:>35} | t_feat={t_feat_str} | t_pred={t_pred_str} | {check}{flag}")
        
        print(f"\n  Temporal violations: {violations}/15")

        # ═══ ÉTAPE 6: Root cause analysis ═══
        print("\n" + "═" * 70)
        print("  ÉTAPE 6 — Root Cause: why ai_response_hash is NULL in 14 rows")
        print("═" * 70)

        # Check if the ai_trace contains ai_response_hash in the nested hashes dict
        r = await run_sql(client, """
            SELECT 
                count(*)::int as total,
                count(*) FILTER (WHERE ai_trace->'hashes'->'ai_response_hash' IS NOT NULL 
                    AND ai_trace->'hashes'->>'ai_response_hash' != 'null')::int as trace_has_res_hash,
                count(*) FILTER (WHERE ai_trace->>'model' IS NOT NULL)::int as trace_has_model,
                count(*) FILTER (WHERE ai_trace->'hashes'->>'ai_response_hash' = 'null')::int as trace_res_hash_is_null_string,
                count(*) FILTER (WHERE ai_trace->'hashes'->'ai_response_hash' IS NULL)::int as trace_res_hash_key_missing
            FROM predictions
            WHERE feature_snapshot IS NOT NULL
              AND ai_model = 'llama-3.3-70b-versatile'
        """)
        cause_data = json.loads(r)[0]
        print(f"\n  Analysis of ai_trace JSONB in 14 old predictions:")
        print(f"    trace->hashes->ai_response_hash IS NOT NULL (non-null value): {cause_data['trace_has_res_hash']}/14")
        print(f"    trace->hashes->ai_response_hash = 'null' (JSON null string): {cause_data['trace_res_hash_is_null_string']}/14")
        print(f"    trace->hashes->ai_response_hash key missing entirely: {cause_data['trace_res_hash_key_missing']}/14")

        # Check if provider field exists in old traces
        r = await run_sql(client, """
            SELECT 
                ai_trace->>'model' as trace_model,
                ai_trace->>'provider' as trace_provider,
                LEFT(ai_trace->'hashes'->>'ai_response_hash', 20) as trace_res_hash_val
            FROM predictions
            WHERE feature_snapshot IS NOT NULL
              AND ai_model = 'llama-3.3-70b-versatile'
            ORDER BY created_at ASC
            LIMIT 3
        """)
        trace_details = json.loads(r)
        print(f"\n  Sample trace details (first 3 old predictions):")
        for td in trace_details:
            print(f"    model={td.get('trace_model')} | provider={td.get('trace_provider')} | res_hash={td.get('trace_res_hash_val')}")

        # ═══ ÉTAPE 7: Eligibility analysis ═══
        print("\n" + "═" * 70)
        print("  ÉTAPE 7 — Eligibility Analysis")
        print("═" * 70)

        r = await run_sql(client, """
            SELECT 
                home_team || ' vs ' || away_team as match_name,
                scientific_collection_eligible,
                completeness_score,
                temporal_safety_score,
                ai_provenance_risk,
                feature_snapshot IS NOT NULL as has_snapshot,
                ai_response_hash IS NOT NULL as has_res_hash,
                CASE 
                    WHEN completeness_score IS NULL THEN 'FAIL: completeness is NULL'
                    WHEN completeness_score < 0.5 THEN 'FAIL: completeness < 0.5'
                    WHEN temporal_safety_score IS NULL THEN 'FAIL: temporal_safety is NULL'
                    WHEN temporal_safety_score < 1.0 THEN 'FAIL: temporal_safety < 1.0'
                    ELSE 'PASS: all criteria met'
                END as eligibility_reason
            FROM predictions
            WHERE feature_snapshot IS NOT NULL
            ORDER BY created_at ASC
        """)
        elig_data = json.loads(r)
        
        for e in elig_data:
            elig_str = "✅" if e["scientific_collection_eligible"] else "❌"
            prov = e.get("ai_provenance_risk") or "NULL"
            print(f"  {elig_str} {e['match_name']:>35} | compl={e['completeness_score']} | temp={e['temporal_safety_score']} | prov={prov} | {e['eligibility_reason']}")

        # ═══ ÉTAPE 8: Backfill legitimacy ═══
        print("\n" + "═" * 70)
        print("  ÉTAPE 8 — Backfill Legitimacy Analysis")
        print("═" * 70)

        # Check if any AI response text is preserved anywhere in the trace
        r = await run_sql(client, """
            SELECT 
                count(*)::int as total,
                count(*) FILTER (WHERE ai_trace->>'response' IS NOT NULL)::int as has_response_text,
                count(*) FILTER (WHERE ai_trace->>'raw_response' IS NOT NULL)::int as has_raw_response,
                count(*) FILTER (WHERE ai_trace->>'content' IS NOT NULL)::int as has_content,
                count(*) FILTER (WHERE ai_trace->>'ai_response' IS NOT NULL)::int as has_ai_response_field
            FROM predictions
            WHERE feature_snapshot IS NOT NULL
              AND ai_model = 'llama-3.3-70b-versatile'
        """)
        backfill_data = json.loads(r)[0]
        print(f"\n  AI response preservation check in ai_trace JSONB:")
        print(f"    Has 'response' key:       {backfill_data['has_response_text']}/14")
        print(f"    Has 'raw_response' key:   {backfill_data['has_raw_response']}/14")
        print(f"    Has 'content' key:        {backfill_data['has_content']}/14")
        print(f"    Has 'ai_response' key:    {backfill_data['has_ai_response_field']}/14")
        
        any_preserved = max(
            backfill_data['has_response_text'],
            backfill_data['has_raw_response'],
            backfill_data['has_content'],
            backfill_data['has_ai_response_field']
        )
        
        if any_preserved > 0:
            print(f"\n  ⚠️  AI response text IS partially preserved in {any_preserved} traces!")
            print(f"  Backfill of ai_response_hash COULD be legitimate for those rows.")
        else:
            print(f"\n  ❌ AI response text is NOT preserved in any trace.")
            print(f"  Backfill of ai_response_hash is NOT scientifically valid.")
            print(f"  The original AI responses were never stored — only their absence was recorded.")

asyncio.run(main())
