// ============================================
// PHASE 5.3.41 — BATCH PREDICT ORCHESTRATOR
// ============================================
//
// Pure helper that orchestrates sequential per-match AI calls for the
// "PRÉDIRE TOUS LES MATCHS (N)" button.
//
// Architecture:
//   AVANT (Phase 5.3.40 diagnostic):
//     enhanceWithAI([10 matches]) → 1 POST /api/analyze-match with body.matches=[10]
//     → server batch path (L939-980) → Promise.race(callGroqSingle, setTimeout(5000ms))
//     → if 10-match combined Groq response > 5s, TIMEOUT propagated to ALL 10 traces
//
//   APRÈS (Phase 5.3.41):
//     For each match: enhanceWithAI([match]) → 1 POST /api/analyze-match with body.matches=[1]
//     → server single-match path (L865) → await callGroqSingle() (NO Promise.race timeout)
//     → each match has its OWN ai_call_status / ai_response_hash / scientific_eligible
//     → a TIMEOUT on match N does NOT contaminate match N+1 or N-1
//
// This helper is extracted as a PURE function so it can be tested without
// mocking the entire React component tree. Tests inject a mock
// `enhanceSingle` function that simulates TIMEOUT/PARSE_OK/HTTP_ERROR/etc.
// ============================================

export interface BatchPredictProgress {
  current: number;
  total: number;
  currentMatchLabel: string;
}

export interface BatchPredictOutcome {
  /** Index in the input matches array (0-based). */
  index: number;
  /** Human-readable label for the match. */
  matchLabel: string;
  /** True if enhanceSingle resolved, false if it rejected. */
  success: boolean;
  /** Error message if rejected, else undefined. */
  errorMessage?: string;
}

export interface BatchPredictResult {
  successCount: number;
  errorCount: number;
  outcomes: BatchPredictOutcome[];
}

/**
 * Orchestrates sequential per-match AI calls with full isolation.
 *
 * INVARIANTS (proven by phase5.3.41-batch-isolation.test.ts):
 *   1. enhanceSingle is called ONCE per match (not batched)
 *   2. A rejection on match N does NOT stop the loop (next match still runs)
 *   3. progress callback fires for EACH match (current: 1, 2, ..., N)
 *   4. outcomes array length === matches.length
 *   5. Each outcome has its OWN success/errorMessage — no cross-contamination
 *
 * @param matches - Array of matches to process sequentially
 * @param enhanceSingle - Function that takes ONE match and returns a Promise
 *                         (resolves on success, rejects on failure/timeout)
 * @param onProgress - Optional callback fired before each match is processed
 * @returns { successCount, errorCount, outcomes[] } — per-match breakdown
 */
export async function orchestrateBatchPredict<TMatch>(
  matches: TMatch[],
  options: {
    enhanceSingle: (match: TMatch) => Promise<void>;
    onProgress?: (progress: BatchPredictProgress) => void;
    getMatchLabel?: (match: TMatch, index: number) => string;
  },
): Promise<BatchPredictResult> {
  if (matches.length === 0) {
    return { successCount: 0, errorCount: 0, outcomes: [] };
  }

  let successCount = 0;
  let errorCount = 0;
  const outcomes: BatchPredictOutcome[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const matchLabel = options.getMatchLabel
      ? options.getMatchLabel(match, i)
      : `Match ${i + 1}`;

    // Progress callback fires BEFORE the call — UI can show "Analyzing N/N..."
    options.onProgress?.({
      current: i + 1,
      total: matches.length,
      currentMatchLabel: matchLabel,
    });

    try {
      await options.enhanceSingle(match);
      successCount++;
      outcomes.push({ index: i, matchLabel, success: true });
    } catch (err) {
      errorCount++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      outcomes.push({ index: i, matchLabel, success: false, errorMessage });
      // CRITICAL: do NOT re-throw — continue to next match (isolation)
    }
  }

  return { successCount, errorCount, outcomes };
}
