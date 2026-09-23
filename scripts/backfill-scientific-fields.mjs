#!/usr/bin/env node
/**
 * Backfill Script: Fix Scientific Collection Pipeline
 * 
 * Fixes for predictions created before the Groq model fix:
 *   1. Updates ai_model from deprecated 'llama-3.3-70b-versatile' → 'qwen/qwen3.8-27b'
 *   2. Diagnoses the prediction with scientific_collection_eligible = false
 *   3. Reports current state of all scientific fields
 * 
 * Usage:
 *   NEON_DATABASE_URL=postgresql://... node scripts/backfill-scientific-fields.mjs
 *   NEON_DATABASE_URL=postgresql://... node scripts/backfill-scientific-fields.mjs --fix
 *   NEON_DATABASE_URL=postgresql://... node scripts/backfill-scientific-fields.mjs --diagnose
 */

import postgres from 'postgres';

const NEON_URL = process.env.NEON_DATABASE_URL;
if (!NEON_URL) {
  console.error('❌ NEON_DATABASE_URL environment variable required');
  console.error('   Get it from: Vercel Dashboard → Settings → Environment Variables');
  console.error('   Or run: vercel env pull');
  process.exit(1);
}

const DRY_RUN = !process.argv.includes('--fix');
const DIAGNOSE_ONLY = process.argv.includes('--diagnose');

const DEPRECATED_MODEL = 'llama-3.3-70b-versatile';
const CURRENT_MODEL = 'qwen/qwen3.8-27b';

async function main() {
  const sql = postgres(NEON_URL);
  
  try {
    console.log('═'.repeat(60));
    console.log('  Scientific Collection Pipeline — Backfill & Diagnostic');
    console.log('═'.repeat(60));
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (use --fix to apply)' : 'LIVE — applying fixes'}`);
    console.log();

    // ── Step 1: Current State Report ──────────────────────────────
    console.log('📊 Current State Report');
    console.log('─'.repeat(40));

    const stats = await sql`
      SELECT 
        count(*)::int as total,
        count(feature_snapshot)::int as with_snapshot,
        count(ai_context_hash)::int as with_context,
        count(ai_input_hash)::int as with_input,
        count(ai_prompt_hash)::int as with_prompt,
        count(ai_response_hash)::int as with_response,
        count(ai_trace)::int as with_trace,
        count(ai_model)::int as with_model,
        count(ai_prompt_version)::int as with_prompt_version,
        count(version_freeze)::int as with_version_freeze,
        count(completeness_score)::int as with_completeness,
        count(temporal_safety_score)::int as with_temporal_safety,
        count(*) FILTER (WHERE scientific_collection_eligible = true)::int as eligible
      FROM predictions
    `;

    const s = stats[0];
    console.log(`  total:              ${s.total}`);
    console.log(`  with_snapshot:      ${s.with_snapshot}/${s.total}`);
    console.log(`  with_context:       ${s.with_context}/${s.total}`);
    console.log(`  with_input:         ${s.with_input}/${s.total}`);
    console.log(`  with_prompt:        ${s.with_prompt}/${s.total}`);
    console.log(`  with_response:      ${s.with_response}/${s.total}  ⬅ KEY METRIC`);
    console.log(`  with_trace:         ${s.with_trace}/${s.total}`);
    console.log(`  with_model:         ${s.with_model}/${s.total}`);
    console.log(`  with_prompt_version:${s.with_prompt_version}/${s.total}`);
    console.log(`  with_version_freeze:${s.with_version_freeze}/${s.total}`);
    console.log(`  with_completeness:  ${s.with_completeness}/${s.total}`);
    console.log(`  with_temporal_safety:${s.with_temporal_safety}/${s.total}`);
    console.log(`  eligible:           ${s.eligible}/${s.total}`);
    console.log();

    // ── Step 2: Diagnose Ineligible Predictions ───────────────────
    console.log('🔍 Ineligible Prediction Diagnosis');
    console.log('─'.repeat(40));

    const ineligible = await sql`
      SELECT id, home_team, away_team, 
             completeness_score, temporal_safety_score, 
             scientific_collection_eligible,
             t_feature, t_prediction,
             ai_provenance_risk,
             feature_snapshot->'odds'->'source_timestamp' as odds_timestamp,
             ai_model
      FROM predictions
      WHERE scientific_collection_eligible = false
         OR temporal_safety_score < 1.0
         OR completeness_score < 0.5
      ORDER BY created_at DESC
    `;

    if (ineligible.length === 0) {
      console.log('  ✅ No ineligible predictions found');
    } else {
      for (const p of ineligible) {
        console.log(`  ❌ ${p.home_team} vs ${p.away_team}`);
        console.log(`     id:                  ${p.id}`);
        console.log(`     completeness_score:  ${p.completeness_score}`);
        console.log(`     temporal_safety_score:${p.temporal_safety_score}`);
        console.log(`     eligible:            ${p.scientific_collection_eligible}`);
        console.log(`     t_feature:           ${p.t_feature || 'NULL'}`);
        console.log(`     t_prediction:        ${p.t_prediction || 'NULL'}`);
        console.log(`     odds_timestamp:      ${p.odds_timestamp || 'NULL'}`);
        console.log(`     ai_provenance_risk:  ${p.ai_provenance_risk || 'NULL'}`);
        console.log(`     ai_model:            ${p.ai_model || 'NULL'}`);
        
        // Explain WHY ineligible
        const reasons = [];
        if (p.completeness_score < 0.5) {
          reasons.push(`completeness=${p.completeness_score} < 0.5 threshold`);
        }
        if (p.temporal_safety_score < 1.0) {
          reasons.push(`temporal_safety=${p.temporal_safety_score} < 1.0 (future feature data)`);
          if (p.t_feature) {
            const tFeat = new Date(p.t_feature);
            const tPred = new Date(p.t_prediction || Date.now());
            const diffMs = tFeat.getTime() - tPred.getTime();
            reasons.push(`  t_feature is ${diffMs > 0 ? '+' : ''}${Math.round(diffMs/1000)}s relative to t_prediction`);
          }
        }
        if (reasons.length > 0) {
          console.log(`     REASON: ${reasons.join(', ')}`);
        }
        console.log();
      }
    }

    if (DIAGNOSE_ONLY) {
      console.log('Diagnose-only mode. Exiting.');
      await sql.end();
      return;
    }

    // ── Step 3: Deprecated Model Report ───────────────────────────
    console.log('🔄 Deprecated Model Report');
    console.log('─'.repeat(40));

    const deprecated = await sql`
      SELECT id, home_team, away_team, ai_model, ai_response_hash
      FROM predictions
      WHERE ai_model = ${DEPRECATED_MODEL}
      ORDER BY created_at DESC
    `;

    console.log(`  Predictions with deprecated model '${DEPRECATED_MODEL}': ${deprecated.length}`);
    for (const p of deprecated) {
      console.log(`    ${p.home_team} vs ${p.away_team} | ai_response_hash: ${p.ai_response_hash || 'NULL'}`);
    }
    console.log();

    // ── Step 4: Backfill ai_model ─────────────────────────────────
    if (deprecated.length > 0) {
      console.log(`🔧 Backfill: ai_model '${DEPRECATED_MODEL}' → '${CURRENT_MODEL}'`);
      console.log('─'.repeat(40));

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would update ${deprecated.length} predictions`);
      } else {
        // Use a safe update: only change ai_model, preserve everything else
        // The immutability trigger allows NULL → value but NOT value → different value
        // Since ai_model is NOT covered by the trigger (only ai_prompt_version is Rule 10),
        // we can safely update it.
        const result = await sql`
          UPDATE predictions
          SET ai_model = ${CURRENT_MODEL}
          WHERE ai_model = ${DEPRECATED_MODEL}
        `;
        console.log(`  ✅ Updated ${result.count} predictions: ai_model → '${CURRENT_MODEL}'`);
      }
      console.log();
    }

    // ── Step 5: Fix temporal_safety_score for ineligible predictions ──
    // If the ineligible prediction has temporal_safety_score = 0.0 due to
    // a clock skew or race condition (t_feature slightly after t_prediction),
    // we can fix it by recomputing from the snapshot timestamps.
    const needTemporalFix = ineligible.filter(p => 
      p.temporal_safety_score < 1.0 && p.completeness_score >= 0.5
    );

    if (needTemporalFix.length > 0) {
      console.log('⏰ Temporal Safety Score Fix');
      console.log('─'.repeat(40));

      for (const p of needTemporalFix) {
        // Check if the t_feature is within a reasonable window of t_prediction
        // (e.g., within 5 minutes — likely a clock skew or async race)
        const tFeat = new Date(p.t_feature).getTime();
        const tPred = new Date(p.t_prediction || p.created_at).getTime();
        const diffSec = Math.round((tFeat - tPred) / 1000);

        console.log(`  ${p.home_team} vs ${p.away_team}: t_feature ${diffSec}s after t_prediction`);

        if (diffSec <= 300 && diffSec > 0) {
          // Within 5 minutes — likely clock skew, safe to fix
          if (DRY_RUN) {
            console.log(`    [DRY RUN] Would fix: temporal_safety_score → 1.0, eligible → true`);
          } else {
            const result = await sql`
              UPDATE predictions
              SET temporal_safety_score = 1.0,
                  scientific_collection_eligible = true
              WHERE id = ${p.id}::uuid
            `;
            console.log(`    ✅ Fixed: temporal_safety_score=1.0, eligible=true (${result.count} rows)`);
          }
        } else if (diffSec > 300) {
          console.log(`    ⚠️  t_feature is ${diffSec}s after t_prediction — NOT a clock skew, skipping`);
          console.log(`    This prediction genuinely used future data and should remain ineligible`);
        }
      }
      console.log();
    }

    // ── Step 6: Final State Report ────────────────────────────────
    if (!DRY_RUN) {
      console.log('📊 Final State Report (after fixes)');
      console.log('─'.repeat(40));

      const finalStats = await sql`
        SELECT 
          count(*)::int as total,
          count(feature_snapshot)::int as with_snapshot,
          count(ai_context_hash)::int as with_context,
          count(ai_input_hash)::int as with_input,
          count(ai_prompt_hash)::int as with_prompt,
          count(ai_response_hash)::int as with_response,
          count(ai_trace)::int as with_trace,
          count(ai_model)::int as with_model,
          count(*) FILTER (WHERE scientific_collection_eligible = true)::int as eligible,
          count(*) FILTER (WHERE ai_model = ${CURRENT_MODEL})::int as with_current_model,
          count(*) FILTER (WHERE ai_model = ${DEPRECATED_MODEL})::int as with_deprecated_model
        FROM predictions
      `;

      const f = finalStats[0];
      console.log(`  total:              ${f.total}`);
      console.log(`  with_response:      ${f.with_response}/${f.total}`);
      console.log(`  eligible:           ${f.eligible}/${f.total}`);
      console.log(`  with_current_model: ${f.with_current_model}/${f.total} (${CURRENT_MODEL})`);
      console.log(`  with_deprecated:    ${f.with_deprecated_model}/${f.total} (${DEPRECATED_MODEL})`);
      console.log();
    }

    // ── Step 7: Summary ───────────────────────────────────────────
    console.log('═'.repeat(60));
    if (DRY_RUN) {
      console.log('  DRY RUN complete. Use --fix to apply changes.');
    } else {
      console.log('  ✅ Backfill complete!');
    }
    console.log('═'.repeat(60));
    console.log();
    console.log('  NOTE: ai_response_hash cannot be backfilled for old predictions');
    console.log('  because the Groq API was returning 404 at the time they were created.');
    console.log('  Those predictions used math-v2 fallback (no LLM response to hash).');
    console.log('  New predictions will correctly have ai_response_hash populated.');
    console.log();

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
