// ============================================
// PHASE 5.3.32 — Predict action guard (pure predicate)
// ============================================
//
// Race fixed by this helper:
//
//   remount / navigation
//       ↓
//   predictionIdMap = empty
//   dbPredictions   = []
//       ↓
//   loadPredictions() still in flight
//       ↓
//   user clicks Predict
//       ↓
//   savePredictionToDb()
//       ↓
//   POST /api/predictions   ← secondary INSERT (race)
//       ↓
//   enhanceWithAI() may PATCH the wrong UUID or trigger another INSERT
//
// Fix: while `predictionsLoading` is true, the Predict button is
// disabled AND `handlePredict()` early-returns. The same predicate
// is used for both gates so the UI guard and the handler guard
// cannot drift apart.
//
// IMPORTANT — finally semantics:
//   usePredictions().loadPredictions() terminates in a `finally`
//   block (`setLoading(false)`), so an HTTP 401 / 500 / network
//   error / JSON parse error / unexpected exception will STILL
//   flip loading back to false. There is no scenario where
//   loadPredictions() failure leaves Predict permanently disabled.
// ============================================

export interface PredictGuardInput {
  /** True when this specific match is already being predicted (re-entrancy guard). */
  predicting: boolean;
  /** True while the initial dbPredictions load (GET /api/predictions) is in flight. */
  predictionsLoading: boolean;
  /** Home odds — must be strictly positive for prediction to be valid. */
  oddHome: number;
  /**
   * Phase 5.3.43: True while a batch predict is running.
   * When true, individual Predict buttons are disabled to prevent
   * concurrent Groq calls that could trigger rate-limit (429).
   * This is a MUTUAL EXCLUSION guard — batch and individual cannot
   * run simultaneously.
   */
  batchPredicting?: boolean;
}

/**
 * Returns `true` when the Predict action MUST be blocked.
 *
 * Blocking conditions (OR semantics):
 *   1. `predictionsLoading === true`  — Phase 5.3.32 race fix
 *   2. `predicting === true`           — re-entrancy guard (existing)
 *   3. `oddHome <= 0`                  — invalid odds (existing)
 *   4. `batchPredicting === true`      — Phase 5.3.43 concurrency guard
 *
 * Non-blocking when:
 *   - All four flags are false → Predict may proceed.
 *   - `predictionsLoading` flipped to false after an HTTP error —
 *     Predict is re-enabled (no permanent lock).
 *   - `batchPredicting` is false (batch finished or not started) —
 *     individual Predict is re-enabled.
 *
 * Truthiness note: `oddHome` is checked with `<= 0`, so `0` is
 * treated as invalid (same as the existing UI guard at L329). This
 * does NOT affect `matchId` handling in enhanceWithAI (5.3.31.3),
 * where `t.match.id === 0` is still treated as a valid matchId via
 * `t.match.id != null`.
 */
export function shouldBlockPredict(input: PredictGuardInput): boolean {
  return (
    input.predictionsLoading ||
    input.predicting ||
    input.oddHome <= 0 ||
    input.batchPredicting === true
  );
}
