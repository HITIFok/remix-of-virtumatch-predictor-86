// ============================================
// SCIENTIFIC INTEGRITY — SERVER-SIDE RECOMPUTATION
// Phase 5.3.14 — Enforce server-side provenance and eligibility
// ============================================
//
// This module provides server-side recomputation functions for scientific
// fields that were previously trusted from the client.
//
// The logic MIRRORS computeAITraces() in api/analyze-match.js but is
// designed to be called from api/predictions.js POST/PATCH handlers.
//
// CRITICAL: This module does NOT modify the prediction model, coefficients,
// or any canonical hash function. It only recomputes derived scientific
// fields from the stored feature_snapshot.

// ═══════════════════════════════════════════════════════════════════
// CANONICAL ENUMS
// ═══════════════════════════════════════════════════════════════════

/**
 * Canonical provenance status values (for new writes).
 * Legacy values (VALID, PARTIALLY_VALID, INVALID) are kept for backward
 * compatibility but should NOT be produced by new code.
 */
const CANONICAL_PROVENANCE_VALUES = new Set([
  'RECORDED',
  'RECONSTRUCTED',
  'UNKNOWN',
  'UNSAFE',
]);

/**
 * All known provenance values (canonical + legacy).
 * Used for reading historical data.
 */
const ALL_KNOWN_PROVENANCE_VALUES = new Set([
  'RECORDED',
  'RECONSTRUCTED',
  'UNKNOWN',
  'UNSAFE',
  // Legacy values (from migrations 006/007):
  'VALID',
  'PARTIALLY_VALID',
  'INVALID',
]);

/**
 * Validate that a provenance_status value is in the canonical enum.
 * Returns true for canonical values, false for unknown/arbitrary values.
 * Legacy values (VALID, PARTIALLY_VALID, INVALID) are accepted but logged.
 */
function isValidProvenanceStatus(value) {
  if (typeof value !== 'string') return false;
  return ALL_KNOWN_PROVENANCE_VALUES.has(value);
}

function isCanonicalProvenanceStatus(value) {
  if (typeof value !== 'string') return false;
  return CANONICAL_PROVENANCE_VALUES.has(value);
}

// ═══════════════════════════════════════════════════════════════════
// COMPLETENESS SCORE — mirrors computeAITraces() lines 503-509
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute completeness score from a feature_snapshot.
 *
 * Weights (identical to computeAITraces in analyze-match.js):
 *   odds (home+draw+away)  = 0.30
 *   standings (home+away)  = 0.20
 *   form home              = 0.15
 *   form away              = 0.15
 *   h2h matches            = 0.20
 *   Maximum                = 1.00
 *
 * @param {object} featureSnapshot - The stored feature_snapshot JSONB
 * @returns {number} Completeness score (0.0 to 1.0), rounded to 3 decimals
 */
function computeCompletenessScore(featureSnapshot) {
  if (!featureSnapshot || typeof featureSnapshot !== 'object') return 0;

  const odds = featureSnapshot.odds;
  const standings = featureSnapshot.standings;
  const form = featureSnapshot.form;
  const h2h = featureSnapshot.h2h;

  let score = 0;
  if (odds && odds.home && odds.draw && odds.away) score += 0.3;
  if (standings && standings.home && standings.away) score += 0.2;
  if (form && form.home && Array.isArray(form.home) && form.home.length > 0) score += 0.15;
  if (form && form.away && Array.isArray(form.away) && form.away.length > 0) score += 0.15;
  if (h2h && h2h.matches && Array.isArray(h2h.matches) && h2h.matches.length > 0) score += 0.2;

  return Math.round(score * 1000) / 1000;
}

// ═══════════════════════════════════════════════════════════════════
// TEMPORAL SAFETY — mirrors computeAITraces() lines 564-588
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute temporal safety score and reason from t_feature and t_prediction.
 *
 * Logic (identical to computeAITraces in analyze-match.js):
 *   t_feature = NULL                    → score 0.0, T_FEATURE_UNKNOWN
 *   t_feature > t_prediction + 5min     → score 0.0, FUTURE_FEATURE_LEAK
 *   t_feature > t_prediction (≤5min)    → score 1.0, WITHIN_CLOCK_SKEW
 *   t_feature ≤ t_prediction            → score 1.0, VERIFIED
 *
 * @param {string|null} tFeature - ISO 8601 timestamp or null
 * @param {string} tPrediction - ISO 8601 timestamp
 * @returns {{score: number, reason: string}}
 */
function computeTemporalSafety(tFeature, tPrediction) {
  if (!tFeature) {
    return { score: 0.0, reason: 'T_FEATURE_UNKNOWN' };
  }

  const tFeatureMs = new Date(tFeature).getTime();
  const tPredictionMs = new Date(tPrediction).getTime();

  if (isNaN(tFeatureMs) || isNaN(tPredictionMs)) {
    return { score: 0.0, reason: 'T_FEATURE_UNKNOWN' };
  }

  const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

  if (tFeatureMs > tPredictionMs + CLOCK_SKEW_TOLERANCE_MS) {
    return { score: 0.0, reason: 'FUTURE_FEATURE_LEAK' };
  } else if (tFeatureMs > tPredictionMs) {
    return { score: 1.0, reason: 'WITHIN_CLOCK_SKEW' };
  } else {
    return { score: 1.0, reason: 'VERIFIED' };
  }
}

// ═══════════════════════════════════════════════════════════════════
// T_FEATURE — mirrors computeAITraces() lines 516-528 + Phase 4 fix
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute t_feature from feature_snapshot source_timestamps.
 *
 * t_feature = MAX of all available source timestamps (odds, ranking, form, h2h).
 * If no source timestamps are available, returns null (UNKNOWN).
 *
 * Phase 5.3.15.1 F-HIGH-1 fix: Restored the Phase 4 anti-fabrication check
 * that rejects source timestamps exactly equal to tPrediction.
 *
 * @param {object} featureSnapshot
 * @param {string} [tPrediction] - Server time (for anti-fabrication check)
 * @returns {string|null} ISO 8601 timestamp or null
 */
function computeTFeature(featureSnapshot, tPrediction) {
  if (!featureSnapshot || typeof featureSnapshot !== 'object') return null;

  const sourceTimestamps = featureSnapshot.source_timestamps || {};
  const tPredictionMs = tPrediction ? new Date(tPrediction).getTime() : null;

  const availableTimestamps = [
    sourceTimestamps.odds,
    sourceTimestamps.ranking,
    sourceTimestamps.form,
    sourceTimestamps.h2h,
    // Also check nested source_timestamp fields
    featureSnapshot.odds?.source_timestamp,
    featureSnapshot.standings?.source_timestamp,
    featureSnapshot.form?.source_timestamp,
    featureSnapshot.h2h?.source_timestamp,
  ].filter(ts => ts != null && typeof ts === 'string')
   .filter(ts => {
     const parsed = new Date(ts).getTime();
     // Reject unparseable timestamps
     if (isNaN(parsed)) return false;
     // F-HIGH-1 fix: Phase 4 anti-fabrication check
     // Reject timestamps exactly equal to tPrediction (clear fabrication)
     if (tPredictionMs !== null && !isNaN(tPredictionMs) && parsed === tPredictionMs) return false;
     return true;
   });

  if (availableTimestamps.length === 0) return null;

  const maxMs = Math.max(...availableTimestamps.map(ts => {
    const ms = new Date(ts).getTime();
    return isNaN(ms) ? 0 : ms;
  }));

  return maxMs > 0 ? new Date(maxMs).toISOString() : null;
}

// ═══════════════════════════════════════════════════════════════════
// SCIENTIFIC ELIGIBILITY — mirrors computeAITraces() lines 611-617
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute scientific_collection_eligible from server-side data.
 *
 * Conditions (identical to computeAITraces Phase 9 fix):
 *   1. feature_snapshot is present (non-null)
 *   2. completeness_score >= 0.5
 *   3. temporal_safety_score >= 1.0
 *   4. t_feature is non-null (real source timestamps exist)
 *   5. ai_response_hash is non-null (real LLM response was received)
 *
 * Phase 5.3.15.1 F-MED-1 fix: Added aiModel parameter.
 * When ai_model = 'math-v2', there is no real LLM response.
 * A client sending ai_response_hash with ai_model='math-v2' is a fabrication
 * attempt — the hash is ignored and eligibility is false.
 *
 * @param {object|null} featureSnapshot
 * @param {number} completenessScore
 * @param {number} temporalSafetyScore
 * @param {string|null} tFeature
 * @param {string|null} aiResponseHash
 * @param {string|null} [aiModel] - AI model name (for math-v2 check)
 * @returns {boolean}
 */
function computeScientificEligible(featureSnapshot, completenessScore, temporalSafetyScore, tFeature, aiResponseHash, aiModel) {
  // F-MED-1 fix: math-v2 fallback never has a real LLM response.
  // Even if the client sends a fake ai_response_hash with ai_model='math-v2',
  // eligibility must be false.
  if (aiModel === 'math-v2') return false;

  return !!featureSnapshot &&
    completenessScore >= 0.5 &&
    temporalSafetyScore >= 1.0 &&
    tFeature !== null &&
    aiResponseHash !== null;
}

// ═══════════════════════════════════════════════════════════════════
// PROVENANCE STATUS — C1 fix: use 'standings' not 'stats'
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute provenance_status from feature_snapshot.
 *
 * Phase 5.3.14 C1 fix: The previous code used snap.stats which doesn't
 * exist in the stored snapshot (it uses 'standings'). This caused
 * hasStats to always be false, making RECORDED unreachable.
 *
 * Fixed logic:
 *   All features + source_timestamps present → RECORDED
 *   Some features present (odds has source_timestamp) → RECONSTRUCTED
 *   No snapshot or no source_timestamps → UNKNOWN
 *
 * @param {object|null} featureSnapshot
 * @returns {string} One of RECORDED, RECONSTRUCTED, UNKNOWN
 */
function computeProvenanceStatus(featureSnapshot) {
  if (!featureSnapshot || typeof featureSnapshot !== 'object') {
    return 'UNKNOWN';
  }

  const snap = featureSnapshot;
  // C1 FIX: use 'standings' (the actual key in feature_snapshot), not 'stats'
  const hasOdds = snap.odds && snap.odds.source_timestamp;
  const hasForm = snap.form && snap.form.home && snap.form.away;
  const hasStandings = snap.standings && snap.standings.home && snap.standings.away; // FIXED: standings not stats
  const hasH2h = snap.h2h && snap.h2h.source_timestamp;

  if (hasOdds && hasForm && hasStandings && hasH2h) {
    return 'RECORDED';  // canonical: full snapshot with all source_timestamps
  } else if (hasOdds) {
    return 'RECONSTRUCTED';  // canonical: partial (odds has source_timestamp)
  } else {
    return 'UNKNOWN';  // no source_timestamps available
  }
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT VALIDATION — M2 fix: validate stored snapshot at INSERT time
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a stored feature_snapshot before INSERT.
 *
 * This is a SIMPLER validation than feature-snapshot.ts validateSnapshot()
 * because the stored snapshot has a different structure (it's the AIContext
 * serialization, not a FeatureSnapshot object).
 *
 * Checks:
 *   1. schema_version is present
 *   2. odds exists with numeric home, draw, away
 *   3. source_timestamps exists (even if all values are null)
 *   4. No temporal leakage: if source_timestamps are present and
 *      t_prediction is known, none should be > t_prediction
 *
 * @param {object} featureSnapshot
 * @param {string} tPrediction - ISO 8601 timestamp
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
function validateStoredSnapshot(featureSnapshot, tPrediction) {
  const errors = [];
  const warnings = [];

  if (!featureSnapshot || typeof featureSnapshot !== 'object') {
    return { valid: false, errors: ['feature_snapshot is not a valid object'], warnings };
  }

  // 1. schema_version
  if (!featureSnapshot.schema_version) {
    warnings.push('feature_snapshot has no schema_version');
  }

  // 2. odds
  const odds = featureSnapshot.odds;
  if (!odds || typeof odds.home !== 'number' || typeof odds.draw !== 'number' || typeof odds.away !== 'number') {
    errors.push('feature_snapshot.odds must have numeric home, draw, away');
  }

  // 3. source_timestamps
  const sourceTimestamps = featureSnapshot.source_timestamps;
  if (!sourceTimestamps || typeof sourceTimestamps !== 'object') {
    warnings.push('feature_snapshot has no source_timestamps object');
  }

  // 4. Temporal leakage check
  if (tPrediction && sourceTimestamps) {
    const predMs = new Date(tPrediction).getTime();
    if (!isNaN(predMs)) {
      const allTimestamps = [
        sourceTimestamps.odds,
        sourceTimestamps.ranking,
        sourceTimestamps.form,
        sourceTimestamps.h2h,
      ].filter(ts => ts != null);

      for (const ts of allTimestamps) {
        const tsMs = new Date(ts).getTime();
        if (!isNaN(tsMs) && tsMs > predMs) {
          errors.push(`Temporal leak: source_timestamp ${ts} > t_prediction ${tPrediction}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// FULL RECOMPUTATION — compute all derived scientific fields server-side
// ═══════════════════════════════════════════════════════════════════

/**
 * Recompute ALL derived scientific fields from the feature_snapshot and
 * other known data. This is the SINGLE source of truth for server-side
 * scientific field computation.
 *
 * Phase 5.3.15.1 F-CRIT-1 fix: When feature_snapshot is NULL, ALL derived
 * fields are returned as NULL (not defaults like 0/false/'T_FEATURE_UNKNOWN').
 * This preserves the NULL→value enrichment path for PATCH — tryUpdate()
 * allows NULL→value but blocks non-null→different-value.
 *
 * @param {object} params
 * @param {object|null} params.featureSnapshot - The stored snapshot
 * @param {string} params.tPrediction - ISO 8601 timestamp (server time)
 * @param {string|null} params.aiResponseHash - From client body (enrichment flow)
 * @param {string|null} [params.aiModel] - AI model name (for math-v2 check)
 * @returns {object} All recomputed scientific fields
 */
function recomputeScientificFields({ featureSnapshot, tPrediction, aiResponseHash, aiModel }) {
  // F-CRIT-1 fix: When feature_snapshot is NULL, return NULL for ALL derived fields.
  // This preserves the NULL→value enrichment path for PATCH.
  if (!featureSnapshot || typeof featureSnapshot !== 'object') {
    return {
      t_feature: null,
      completeness_score: null,      // was 0 — now null (F-CRIT-1)
      temporal_safety_score: null,  // was 0.0 — now null (F-CRIT-1)
      temporal_safety_reason: null, // was 'T_FEATURE_UNKNOWN' — now null (F-CRIT-1)
      provenance_status: null,      // was 'UNKNOWN' — now null (F-CRIT-1)
      scientific_collection_eligible: null, // was false — now null (F-CRIT-1)
    };
  }

  // When feature_snapshot is present, compute all derived fields
  const tFeature = computeTFeature(featureSnapshot, tPrediction);  // F-HIGH-1: pass tPrediction
  const completenessScore = computeCompletenessScore(featureSnapshot);
  const temporalSafety = computeTemporalSafety(tFeature, tPrediction);
  const provenanceStatus = computeProvenanceStatus(featureSnapshot);
  const scientificEligible = computeScientificEligible(
    featureSnapshot,
    completenessScore,
    temporalSafety.score,
    tFeature,
    aiResponseHash,
    aiModel,  // F-MED-1: pass aiModel for math-v2 check
  );

  return {
    t_feature: tFeature,
    completeness_score: completenessScore,
    temporal_safety_score: temporalSafety.score,
    temporal_safety_reason: temporalSafety.reason,
    provenance_status: provenanceStatus,
    scientific_collection_eligible: scientificEligible,
  };
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

export {
  CANONICAL_PROVENANCE_VALUES,
  ALL_KNOWN_PROVENANCE_VALUES,
  isValidProvenanceStatus,
  isCanonicalProvenanceStatus,
  computeCompletenessScore,
  computeTemporalSafety,
  computeTFeature,
  computeScientificEligible,
  computeProvenanceStatus,
  validateStoredSnapshot,
  recomputeScientificFields,
};
