// ============================================
// RECOMPUTE AI HASHES — READ-ONLY AUDIT TOOL
// Phase 5.3.10 — Forensic Hash Chain Verification
// ============================================
//
// This script reads a prediction from Neon (SELECT only), rebuilds the
// canonical AIContext from the stored feature_snapshot + predictions row,
// recomputes the 4 AI hashes using the CANONICAL functions from
// src/lib/ai-context.ts, and compares them to the stored values.
//
// CAN RECOMPUTE:
//   AI_CONTEXT_HASH  — yes (needs home_team, away_team + feature_snapshot)
//   AI_INPUT_HASH    — yes (needs feature_snapshot.ai_snapshot)
//   AI_PROMPT_HASH   — yes (needs SYSTEM_PROMPT extracted from analyze-match.js)
//   AI_RESPONSE_HASH — NO (the raw LLM response text is NOT stored in DB)
//
// USAGE:
//   npx tsx scripts/recompute-ai-hashes.ts <prediction-uuid>
//
// REQUIRES:
//   - NEON_DATABASE_URL environment variable
//   - The prediction must have a feature_snapshot
//
// READ-ONLY:
//   This script executes ONLY SELECT statements.
//   It does NOT INSERT, UPDATE, DELETE, or modify any data.
//   It does NOT call any migration.
//   It does NOT modify the prediction or any other row.
//
// CRITICAL:
//   This script uses the CANONICAL hash functions from src/lib/ai-context.ts.
//   It does NOT reimplement the SHA-256 algorithm.
//   It does NOT create a second implementation.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import {
  buildUserPromptFromContext,
  computeAIContextHash,
  computeAIInputHashFromContext,
  computeAIPromptHashFromContext,
  type AIContext,
  type AIInputs,
} from '../src/lib/ai-context';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════
// HELPERS (exported for unit testing)
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract the SYSTEM_PROMPT string literal from api/analyze-match.js source.
 *
 * The SYSTEM_PROMPT is a backtick template literal starting at:
 *   const SYSTEM_PROMPT = `...`;
 *
 * We extract the content BETWEEN the backticks (excluding the backticks
 * themselves and the surrounding const declaration).
 *
 * Returns null if extraction fails (file not found, pattern not matched).
 */
export function extractSystemPrompt(analyzeMatchJsSource: string): string | null {
  // Match: const SYSTEM_PROMPT = `...`;
  // The content can contain any characters except a closing backtick.
  // We use a non-greedy match up to the first `; on its own line.
  const match = analyzeMatchJsSource.match(
    /const SYSTEM_PROMPT = `([\s\S]+?)`;\s*\n/
  );
  if (!match || match.length < 2) {
    return null;
  }
  return match[1];
}

/**
 * Read the SYSTEM_PROMPT from the api/analyze-match.js source file.
 * Returns null if the file cannot be read or the prompt cannot be extracted.
 */
export function readSystemPromptFromFile(): string | null {
  const analyzeMatchPath = path.resolve(__dirname, '..', 'api', 'analyze-match.js');
  try {
    const source = fs.readFileSync(analyzeMatchPath, 'utf-8');
    return extractSystemPrompt(source);
  } catch {
    return null;
  }
}

/**
 * Rebuild an AIContext from the stored feature_snapshot + predictions row data.
 *
 * The feature_snapshot stores: { odds, standings, form, h2h, source_timestamps,
 * ai_snapshot, match_index, schema_version }.
 *
 * The predictions row stores home_team, away_team (which are the AIContext.home/away).
 *
 * Returns the AIContext, or null if feature_snapshot is missing required fields.
 */
export function rebuildAIContext(featureSnapshot: any, homeTeam: string, awayTeam: string): AIContext | null {
  if (!featureSnapshot || typeof featureSnapshot !== 'object') {
    return null;
  }
  const odds = featureSnapshot.odds;
  const standings = featureSnapshot.standings;
  const form = featureSnapshot.form;
  const h2h = featureSnapshot.h2h;
  const sourceTimestamps = featureSnapshot.source_timestamps;
  const matchIndex = featureSnapshot.match_index;

  if (!odds || !standings || !form || !h2h || !sourceTimestamps) {
    return null;
  }

  return {
    home: homeTeam,
    away: awayTeam,
    odds: {
      home: odds.home,
      draw: odds.draw,
      away: odds.away,
      source_timestamp: odds.source_timestamp ?? null,
    },
    standings: {
      home: standings.home ?? null,
      away: standings.away ?? null,
      source_timestamp: standings.source_timestamp ?? null,
    },
    form: {
      home: form.home ?? null,
      away: form.away ?? null,
      source_timestamp: form.source_timestamp ?? null,
    },
    h2h: {
      matches: h2h.matches ?? null,
      source_timestamp: h2h.source_timestamp ?? null,
    },
    match_index: matchIndex ?? 1,
    source_timestamps: {
      odds: sourceTimestamps.odds ?? null,
      ranking: sourceTimestamps.ranking ?? null,
      form: sourceTimestamps.form ?? null,
      h2h: sourceTimestamps.h2h ?? null,
    },
  };
}

/**
 * Mirror of the production sanitize() function from api/predictions.js.
 *
 * Phase 5.3.11.2 — diagnostic-only: used to check if the difference between
 * predictions.home (unsanitized) and predictions.home_team (sanitized) can
 * explain an AI_CONTEXT_HASH MISMATCH.
 *
 * This function is NOT used in the canonical hash computation — it is purely
 * for diagnostic purposes. The production code uses its own sanitize() which
 * is NOT modified by this script.
 */
function sanitizeForDiagnostic(v: unknown, maxLen = 200): string {
  return String(v || '').replace(/<[^>]*>/g, '').substring(0, maxLen);
}

/**
 * Result of recomputing hashes for a single prediction.
 */
export interface HashRecomputeResult {
  prediction_id: string;
  home_team: string;
  away_team: string;
  has_feature_snapshot: boolean;
  has_ai_snapshot: boolean;
  has_ai_trace: boolean;
  ai_model: string | null;
  ai_prompt_version: string | null;
  stored: {
    ai_context_hash: string | null;
    ai_input_hash: string | null;
    ai_prompt_hash: string | null;
    ai_response_hash: string | null;
  };
  recomputed: {
    ai_context_hash: string | null;  // null = NOT RECOMPUTABLE
    ai_input_hash: string | null;
    ai_prompt_hash: string | null;   // null = NOT RECOMPUTABLE (e.g., SYSTEM_PROMPT extraction failed)
    ai_response_hash: null;         // ALWAYS NOT RECOMPUTABLE (response text not stored)
  };
  match: {
    ai_context_hash: 'MATCH' | 'MISMATCH' | 'NOT_RECOMPUTABLE' | 'NO_STORED_VALUE';
    ai_input_hash: 'MATCH' | 'MISMATCH' | 'NOT_RECOMPUTABLE' | 'NO_STORED_VALUE';
    ai_prompt_hash: 'MATCH' | 'MISMATCH' | 'NOT_RECOMPUTABLE' | 'NO_STORED_VALUE';
    ai_response_hash: 'NOT_RECOMPUTABLE' | 'NO_STORED_VALUE' | 'STORED_NULL_EXPECTED';
  };
  /** Phase 5.3.11.2 — diagnostic for AI_CONTEXT_HASH MISMATCH.
   * If the primary recompute (using home_team/away_team) MISMATCHES but an
   * alternate recompute (using home/away unsanitized columns) MATCHES, the
   * mismatch is explained by production sanitization (HTML strip + 200 char
   * truncation). This does NOT convert MISMATCH to MATCH — it qualifies the
   * likely cause.
   */
  diagnostic: {
    ai_context_hash: 'NONE' | 'MISMATCH_POSSIBLE_SANITIZATION' | 'MISMATCH_NO_SANITIZATION_EXPLANATION' | 'CANNOT_DIAGNOSE';
    details: string;
  };
  notes: string[];
}

/**
 * Compare a stored hash to a recomputed hash.
 */
function compareHash(stored: string | null, recomputed: string | null): 'MATCH' | 'MISMATCH' | 'NOT_RECOMPUTABLE' | 'NO_STORED_VALUE' {
  if (recomputed === null) {
    return 'NOT_RECOMPUTABLE';
  }
  if (stored === null || stored === undefined) {
    return 'NO_STORED_VALUE';
  }
  return stored === recomputed ? 'MATCH' : 'MISMATCH';
}

/**
 * Recompute the 4 AI hashes for a prediction, given the stored data.
 *
 * This function does NOT touch the database — it operates purely on the
 * data passed in. This makes it unit-testable without a Neon connection.
 */
export function recomputeHashesForPrediction(prediction: {
  id: string;
  home_team: string;
  away_team: string;
  /** Phase 5.3.11.2 — optional unsanitized home/away columns.
   * predictions.home stores String(body.home).substring(0, 100) (NOT HTML-stripped).
   * predictions.home_team stores sanitize(body.home_team, 200) (HTML-stripped, 200 chars).
   * If home/away are provided, the diagnostic can try recomputing with them. */
  home?: string | null;
  away?: string | null;
  feature_snapshot: any;
  ai_context_hash: string | null;
  ai_input_hash: string | null;
  ai_prompt_hash: string | null;
  ai_response_hash: string | null;
  ai_trace: any;
  ai_model: string | null;
  version_freeze: any;
}): HashRecomputeResult {
  const result: HashRecomputeResult = {
    prediction_id: prediction.id,
    home_team: prediction.home_team,
    away_team: prediction.away_team,
    has_feature_snapshot: !!prediction.feature_snapshot,
    has_ai_snapshot: !!(prediction.feature_snapshot?.ai_snapshot),
    has_ai_trace: !!prediction.ai_trace,
    ai_model: prediction.ai_model ?? null,
    ai_prompt_version: prediction.version_freeze?.ai_prompt_version ?? null,
    stored: {
      ai_context_hash: prediction.ai_context_hash ?? null,
      ai_input_hash: prediction.ai_input_hash ?? null,
      ai_prompt_hash: prediction.ai_prompt_hash ?? null,
      ai_response_hash: prediction.ai_response_hash ?? null,
    },
    recomputed: {
      ai_context_hash: null,
      ai_input_hash: null,
      ai_prompt_hash: null,
      ai_response_hash: null,
    },
    match: {
      ai_context_hash: 'NOT_RECOMPUTABLE',
      ai_input_hash: 'NOT_RECOMPUTABLE',
      ai_prompt_hash: 'NOT_RECOMPUTABLE',
      ai_response_hash: 'NOT_RECOMPUTABLE',
    },
    diagnostic: {
      ai_context_hash: 'NONE',
      details: '',
    },
    notes: [],
  };

  if (!prediction.feature_snapshot) {
    result.notes.push('No feature_snapshot stored — cannot recompute any hash.');
    // If there's no feature_snapshot, ai_response_hash should be null.
    // If it's not null, that's a data integrity issue worth flagging.
    result.match.ai_response_hash =
      prediction.ai_response_hash === null ? 'NO_STORED_VALUE' : 'NOT_RECOMPUTABLE';
    return result;
  }

  // ─── AI_CONTEXT_HASH ──────────────────────────────────────────────
  // Rebuild AIContext from feature_snapshot + home_team/away_team.
  const ctx = rebuildAIContext(prediction.feature_snapshot, prediction.home_team, prediction.away_team);
  if (ctx === null) {
    result.notes.push('Cannot rebuild AIContext from feature_snapshot — missing required fields.');
  } else {
    try {
      result.recomputed.ai_context_hash = computeAIContextHash(ctx);
    } catch (e) {
      result.notes.push(`Error computing AI_CONTEXT_HASH: ${(e as Error).message}`);
    }
  }
  result.match.ai_context_hash = compareHash(result.stored.ai_context_hash, result.recomputed.ai_context_hash);

  // ─── Phase 5.3.11.2 — AI_CONTEXT_HASH diagnostic ─────────────────
  // When AI_CONTEXT_HASH MISMATCHES, check if the mismatch can be explained
  // by production sanitization (HTML strip + 200 char truncation of home_team/away_team).
  //
  // Production flow:
  //   1. match.home (unsanitized) → buildAIContext(match) → ctx.home (unsanitized)
  //   2. computeAIContextHash(ctx) → stored_hash (hash with unsanitized name)
  //   3. POST /api/predictions → sanitize(body.home_team, 200) → predictions.home_team (sanitized)
  //   4. Also stores: body.home → String(body.home).substring(0, 100) → predictions.home (unsanitized, 100 chars)
  //
  // Rebuild flow:
  //   1. predictions.home_team (sanitized) → rebuildAIContext → ctx.home (sanitized)
  //   2. computeAIContextHash(ctx) → recomputed_hash (hash with sanitized name)
  //   3. If stored_hash != recomputed_hash → MISMATCH
  //
  // Diagnostic: try recomputing with predictions.home/away (unsanitized, 100 chars max).
  // If the alternate hash MATCHES → mismatch is explained by sanitization.
  // If it still MISMATCHES → real corruption or truncation >100 chars.
  if (result.match.ai_context_hash === 'MISMATCH' && ctx !== null) {
    const unsanitizedHome = prediction.home ?? null;
    const unsanitizedAway = prediction.away ?? null;

    if (unsanitizedHome === null && unsanitizedAway === null) {
      // Cannot diagnose — home/away columns not provided
      result.diagnostic.ai_context_hash = 'CANNOT_DIAGNOSE';
      result.diagnostic.details = 'predictions.home/away columns not provided — cannot check sanitization hypothesis.';
    } else {
      // Try recomputing with unsanitized home/away
      const altCtx = rebuildAIContext(
        prediction.feature_snapshot,
        unsanitizedHome ?? prediction.home_team,
        unsanitizedAway ?? prediction.away_team,
      );
      if (altCtx !== null) {
        try {
          const altHash = computeAIContextHash(altCtx);
          if (altHash === result.stored.ai_context_hash) {
            // The alternate hash MATCHES — mismatch is explained by sanitization
            result.diagnostic.ai_context_hash = 'MISMATCH_POSSIBLE_SANITIZATION';
            result.diagnostic.details =
              `Recomputing with predictions.home/away (unsanitized) produces the stored hash. ` +
              `The mismatch is explained by production sanitize() stripping HTML or truncating to 200 chars. ` +
              `home_team="${prediction.home_team}" vs home="${unsanitizedHome}", ` +
              `away_team="${prediction.away_team}" vs away="${unsanitizedAway}".`;
          } else {
            // Still MISMATCH — check if sanitization would have changed the values
            const homeSanitized = sanitizeForDiagnostic(unsanitizedHome, 200);
            const awaySanitized = sanitizeForDiagnostic(unsanitizedAway, 200);
            const sanitizationChangedHome = homeSanitized !== unsanitizedHome;
            const sanitizationChangedAway = awaySanitized !== unsanitizedAway;

            if (sanitizationChangedHome || sanitizationChangedAway) {
              // Sanitization DID change the value, but the alternate hash still doesn't match.
              // This could be because the original was >100 chars (predictions.home is truncated).
              result.diagnostic.ai_context_hash = 'MISMATCH_POSSIBLE_SANITIZATION';
              result.diagnostic.details =
                `Sanitization changed the team name(s) (home: "${unsanitizedHome}" → "${homeSanitized}", ` +
                `away: "${unsanitizedAway}" → "${awaySanitized}"), but the alternate hash (with unsanitized ` +
                `home/away truncated to 100 chars) still does not match. The original name may have been ` +
                `longer than 100 chars — full recovery is not possible from stored data.`;
            } else {
              // Sanitization did NOT change the value — this is a real mismatch
              result.diagnostic.ai_context_hash = 'MISMATCH_NO_SANITIZATION_EXPLANATION';
              result.diagnostic.details =
                `Sanitization did not change the team name(s). The mismatch is NOT explained by ` +
                `HTML stripping or truncation. This is likely a real data corruption — investigate.`;
            }
          }
        } catch (e) {
          result.diagnostic.ai_context_hash = 'CANNOT_DIAGNOSE';
          result.diagnostic.details = `Error during diagnostic recompute: ${(e as Error).message}`;
        }
      } else {
        result.diagnostic.ai_context_hash = 'CANNOT_DIAGNOSE';
        result.diagnostic.details = 'Cannot rebuild alternate AIContext for diagnostic.';
      }
    }
  }

  // ─── AI_INPUT_HASH ────────────────────────────────────────────────
  // The ai_snapshot is the AIInputs structure stored directly in feature_snapshot.
  const aiSnapshot: AIInputs | null = prediction.feature_snapshot.ai_snapshot ?? null;
  if (aiSnapshot === null) {
    result.notes.push('No ai_snapshot in feature_snapshot — cannot recompute AI_INPUT_HASH.');
  } else {
    try {
      result.recomputed.ai_input_hash = computeAIInputHashFromContext(aiSnapshot);
    } catch (e) {
      result.notes.push(`Error computing AI_INPUT_HASH: ${(e as Error).message}`);
    }
  }
  result.match.ai_input_hash = compareHash(result.stored.ai_input_hash, result.recomputed.ai_input_hash);

  // ─── AI_PROMPT_HASH ───────────────────────────────────────────────
  // Requires: SYSTEM_PROMPT (extracted from analyze-match.js source) + user prompt (rebuilt from AIContext).
  if (ctx === null) {
    result.notes.push('Cannot rebuild user prompt — AIContext is null.');
  } else {
    const systemPrompt = readSystemPromptFromFile();
    if (systemPrompt === null) {
      result.notes.push('Cannot extract SYSTEM_PROMPT from api/analyze-match.js — AI_PROMPT_HASH not recomputable.');
    } else {
      try {
        const userPrompt = buildUserPromptFromContext(ctx);
        result.recomputed.ai_prompt_hash = computeAIPromptHashFromContext(systemPrompt, userPrompt);
      } catch (e) {
        result.notes.push(`Error computing AI_PROMPT_HASH: ${(e as Error).message}`);
      }
    }
  }
  result.match.ai_prompt_hash = compareHash(result.stored.ai_prompt_hash, result.recomputed.ai_prompt_hash);

  // ─── AI_RESPONSE_HASH ─────────────────────────────────────────────
  // The raw LLM response text is NOT stored in the database.
  // Only the hash of the response is stored (in ai_response_hash column and in ai_trace.hashes.ai_response_hash).
  // Therefore, AI_RESPONSE_HASH CANNOT be recomputed from stored data.
  result.notes.push('AI_RESPONSE_HASH is NOT recomputable: the raw LLM response text is not stored in the database.');
  result.match.ai_response_hash =
    result.stored.ai_response_hash === null ? 'NO_STORED_VALUE' : 'NOT_RECOMPUTABLE';

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// CLI — reads a single prediction from Neon and recomputes its hashes
// ═══════════════════════════════════════════════════════════════════

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: npx tsx scripts/recompute-ai-hashes.ts <prediction-uuid>');
    console.error('');
    console.error('Reads a prediction from Neon (SELECT only) and recomputes its AI hashes.');
    console.error('Requires: NEON_DATABASE_URL environment variable.');
    return 1;
  }

  const predictionId = args[0];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(predictionId)) {
    console.error(`Invalid UUID: ${predictionId}`);
    return 1;
  }

  const neonUrl = process.env.NEON_DATABASE_URL;
  if (!neonUrl) {
    console.error('NEON_DATABASE_URL environment variable is not set.');
    console.error('This script is READ-ONLY and requires SELECT access to the predictions table.');
    return 1;
  }

  const sql = postgres(neonUrl, { max: 1 });

  try {
    // READ-ONLY SELECT — fetch the prediction and all scientific fields
    // Phase 5.3.11.2: also fetch home/away (unsanitized columns) for diagnostic
    const rows = await sql`
      SELECT
        id,
        home_team,
        away_team,
        home,
        away,
        feature_snapshot,
        ai_context_hash,
        ai_input_hash,
        ai_prompt_hash,
        ai_response_hash,
        ai_trace,
        ai_model,
        ai_prompt_version,
        version_freeze,
        scientific_collection_eligible,
        t_feature,
        t_prediction,
        created_at
      FROM predictions
      WHERE id = ${predictionId}::uuid
    `;

    if (rows.length === 0) {
      console.error(`Prediction ${predictionId} not found.`);
      return 1;
    }

    const row = rows[0];
    const result = recomputeHashesForPrediction({
      id: row.id,
      home_team: row.home_team,
      away_team: row.away_team,
      home: row.home,       // Phase 5.3.11.2: unsanitized column for diagnostic
      away: row.away,       // Phase 5.3.11.2: unsanitized column for diagnostic
      feature_snapshot: row.feature_snapshot,
      ai_context_hash: row.ai_context_hash,
      ai_input_hash: row.ai_input_hash,
      ai_prompt_hash: row.ai_prompt_hash,
      ai_response_hash: row.ai_response_hash,
      ai_trace: row.ai_trace,
      ai_model: row.ai_model,
      version_freeze: row.version_freeze,
    });

    // Print result
    console.log('═'.repeat(70));
    console.log(`  Hash Recomputation — Prediction ${result.prediction_id}`);
    console.log('═'.repeat(70));
    console.log(`  Match: ${result.home_team} vs ${result.away_team}`);
    console.log(`  AI model: ${result.ai_model ?? 'NULL'}`);
    console.log(`  AI prompt version: ${result.ai_prompt_version ?? 'NULL'}`);
    console.log(`  Has feature_snapshot: ${result.has_feature_snapshot ? 'YES' : 'NO'}`);
    console.log(`  Has ai_snapshot: ${result.has_ai_snapshot ? 'YES' : 'NO'}`);
    console.log(`  Has ai_trace: ${result.has_ai_trace ? 'YES' : 'NO'}`);
    console.log('');

    const printHashComparison = (name: string, stored: string | null, recomputed: string | null, match: string) => {
      console.log(`  ${name}`);
      console.log(`    stored:      ${stored ?? 'NULL'}`);
      console.log(`    recomputed:  ${recomputed ?? 'NULL'}`);
      console.log(`    MATCH:       ${match}`);
      console.log('');
    };

    printHashComparison('AI_CONTEXT_HASH', result.stored.ai_context_hash, result.recomputed.ai_context_hash, result.match.ai_context_hash);

    // Phase 5.3.11.2: print diagnostic for AI_CONTEXT_HASH if not NONE
    if (result.diagnostic.ai_context_hash !== 'NONE') {
      console.log(`    DIAGNOSTIC:  ${result.diagnostic.ai_context_hash}`);
      console.log(`    DETAILS:    ${result.diagnostic.details}`);
      console.log('');
    }

    printHashComparison('AI_INPUT_HASH', result.stored.ai_input_hash, result.recomputed.ai_input_hash, result.match.ai_input_hash);
    printHashComparison('AI_PROMPT_HASH', result.stored.ai_prompt_hash, result.recomputed.ai_prompt_hash, result.match.ai_prompt_hash);
    printHashComparison('AI_RESPONSE_HASH', result.stored.ai_response_hash, result.recomputed.ai_response_hash, result.match.ai_response_hash);

    if (result.notes.length > 0) {
      console.log('  Notes:');
      for (const note of result.notes) {
        console.log(`    - ${note}`);
      }
      console.log('');
    }

    // Overall verdict — Phase 5.3.11 improvement
    // The previous version produced "PASS" which could be misinterpreted as
    // "hash chain fully verified". This is misleading because:
    // 1. AI_RESPONSE_HASH is NEVER recomputable (raw LLM response not stored)
    // 2. AI_PROMPT_HASH may be NOT_RECOMPUTABLE if SYSTEM_PROMPT extraction fails
    // 3. NO_STORED_VALUE means we have nothing to compare against
    //
    // The new verdict uses explicit labels:
    //   RECOMPUTABLE_HASHES_MATCH  — all recomputable hashes that have stored values MATCH
    //   MISMATCH_DETECTED          — at least one recomputable hash MISMATCHES stored value
    //   NOT_RECOMPUTABLE           — at least one recomputable hash could not be recomputed (data missing)
    //   NO_STORED_VALUE            — at least one recomputable hash has no stored value to compare
    //
    // AI_RESPONSE_HASH is always reported separately as NOT RECOMPUTABLE and
    // does NOT participate in the PASS/FAIL verdict — it is a known limitation.

    const recomputableHashes = [
      { name: 'AI_CONTEXT_HASH', match: result.match.ai_context_hash },
      { name: 'AI_INPUT_HASH', match: result.match.ai_input_hash },
      { name: 'AI_PROMPT_HASH', match: result.match.ai_prompt_hash },
    ];

    const hasMismatch = recomputableHashes.some(h => h.match === 'MISMATCH');
    const hasNotRecomputable = recomputableHashes.some(h => h.match === 'NOT_RECOMPUTABLE');
    const hasNoStoredValue = recomputableHashes.some(h => h.match === 'NO_STORED_VALUE');
    const allMatch = recomputableHashes.every(h => h.match === 'MATCH');

    let verdictLabel: string;
    if (hasMismatch) {
      verdictLabel = 'MISMATCH_DETECTED';
    } else if (hasNotRecomputable) {
      verdictLabel = 'NOT_RECOMPUTABLE';
    } else if (hasNoStoredValue) {
      verdictLabel = 'NO_STORED_VALUE';
    } else if (allMatch) {
      verdictLabel = 'RECOMPUTABLE_HASHES_MATCH';
    } else {
      verdictLabel = 'INCONCLUSIVE';
    }

    console.log('═'.repeat(70));
    console.log(`  OVERALL: ${verdictLabel}`);
    console.log(`  AI_RESPONSE_HASH: NOT RECOMPUTABLE (raw LLM response text not stored in DB)`);
    console.log('');
    console.log('  ⚠️  IMPORTANT:');
    console.log('  RECOMPUTABLE_HASHES_MATCH means the 3 recomputable hashes (CONTEXT,');
    console.log('  INPUT, PROMPT) match their stored values. It does NOT prove:');
    console.log('    - that the source data was accurate');
    console.log('    - that the AIContext was complete');
    console.log('    - that timestamps were correct');
    console.log('    - that the data was not already contaminated');
    console.log('    - that the original LLM response is available for verification');
    console.log('  AI_RESPONSE_HASH cannot be verified — the raw response text is not stored.');
    console.log('═'.repeat(70));

    // Exit code: 0 = all recomputable hashes match, 2 = issues detected
    return allMatch ? 0 : 2;
  } catch (err) {
    console.error('Error:', (err as Error).message);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Run main only if invoked directly (not when imported for testing)
const isDirectInvocation = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectInvocation) {
  main().then((code) => process.exit(code));
}
