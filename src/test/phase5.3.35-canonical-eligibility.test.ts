// ============================================
// PHASE 5.3.35 — CANONICAL ELIGIBILITY LIMIT CASES
// Pure-function tests for computeScientificEligible() — covers Cases A–I
// from Phase 5.3.35 §8 spec.
//
// AUTHENTICITY NOTE (per Phase 5.3.35 §8):
// These tests import the REAL production function `computeScientificEligible`
// from `api/_lib/scientific-integrity.js` — they exercise the actual
// canonical function, not a reproduction. Any change to the canonical
// predicate will fail these tests.
//
// Cases covered:
//   A — All gates pass         → eligible=true
//   B — ai_response_hash NULL  → eligible=false (FAIL_AI_HASH)
//   C — ai_call_status=HTTP_ERROR → eligible=false (FAIL_AI_CALL_STATUS)
//   D — ai_call_status=NULL (legacy) → eligible=true (backward-compat)
//   E — ai_model='math-v2'     → eligible=false (FAIL_MATH_V2)
//   F — completeness=0.49      → eligible=false (FAIL_COMPLETENESS)
//   G — temporal_safety=0      → eligible=false (FAIL_TEMPORAL)
//   H — t_feature=NULL         → eligible=false (FAIL_T_FEATURE)
//   I — actual_outcome=NULL    → NOT TESTED HERE — actual_outcome is NOT a
//       parameter of computeScientificEligible (it's a separate ground-truth
//       gate applied AFTER scientific eligibility). Documented in Test I.
// ============================================

import { describe, it, expect } from 'vitest';
import { computeScientificEligible } from '../../api/_lib/scientific-integrity.js';

// ═══════════════════════════════════════════════════════════════════
// Canonical gate definition (per computeScientificEligible L197-260):
//
//   SCIENTIFIC_ELIGIBLE =
//     (ai_model != 'math-v2')
//     AND (ai_call_status IS NULL OR ai_call_status = 'PARSE_OK')
//     AND feature_snapshot IS NOT NULL
//     AND completeness_score >= 0.5
//     AND temporal_safety_score >= 1.0
//     AND t_feature IS NOT NULL
//     AND ai_response_hash IS NOT NULL
//
// NULL semantics:
//   ai_call_status IS NULL  → legacy_unknown → treated as PARSE_OK (backward-compat)
//   ai_model IS NULL        → not 'math-v2' → passes
//   completeness_score IS NULL → fails (COALESCE behavior)
//   temporal_safety_score IS NULL → fails (COALESCE behavior)
//   t_feature IS NULL       → fails
//   ai_response_hash IS NULL → fails
//   feature_snapshot IS NULL → fails
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.35 — Canonical Eligibility: computeScientificEligible limit cases', () => {
  // Nominal "all-pass" inputs (Case A)
  const snapshot = { odds: { home: 1.85, draw: 3.40, away: 4.20 } }; // any non-null object
  const completenessPass = 1.0;
  const temporalSafetyPass = 1.0;
  const tFeatureValid = '2026-09-24T09:00:00Z';
  const aiResponseHashValid = 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd';
  const aiModelValid = 'qwen/qwen3.8-27b';
  const aiCallStatusParseOk = 'PARSE_OK';

  // ═══ CASE A — all gates pass → eligible ═══
  it('A: snapshot + completeness=1 + temporal=1 + t_feature + ai_hash + ai_model=qwen + ai_status=PARSE_OK → eligible', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      aiCallStatusParseOk,
    );
    expect(result).toBe(true);
  });

  // ═══ CASE B — ai_response_hash NULL → eligible=false (FAIL_AI_HASH) ═══
  it('B: ai_response_hash=NULL → eligible=false', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      null, // ai_response_hash NULL
      aiModelValid,
      aiCallStatusParseOk,
    );
    expect(result).toBe(false);
  });

  // ═══ CASE C — ai_call_status=HTTP_ERROR → eligible=false ═══
  it('C: ai_call_status=HTTP_ERROR → eligible=false (gate fails)', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      'HTTP_ERROR', // non-PARSE_OK status
    );
    expect(result).toBe(false);
  });

  // ═══ CASE D — ai_call_status=NULL (legacy) → eligible=true (backward-compat) ═══
  it('D: ai_call_status=NULL (legacy row) → eligible=true (backward-compat, gate skipped)', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      null, // legacy NULL — backward-compat
    );
    expect(result).toBe(true);
  });

  // ═══ CASE E — ai_model='math-v2' → eligible=false ═══
  it('E: ai_model=math-v2 (with valid hash) → eligible=false (F-MED-1 fabrication block)', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      'math-v2', // fabrication attempt
      aiCallStatusParseOk,
    );
    expect(result).toBe(false);
  });

  // ═══ CASE F — completeness=0.49 → eligible=false ═══
  it('F: completeness_score=0.49 (below 0.5 threshold) → eligible=false', () => {
    const result = computeScientificEligible(
      snapshot,
      0.49, // below threshold
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      aiCallStatusParseOk,
    );
    expect(result).toBe(false);
  });

  // ═══ CASE G — temporal_safety=0 → eligible=false ═══
  it('G: temporal_safety_score=0 (T_FEATURE_UNKNOWN or FUTURE_FEATURE_LEAK) → eligible=false', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      0.0, // temporal unsafe
      tFeatureValid, // (irrelevant — temporal_safety_score already evaluated as 0)
      aiResponseHashValid,
      aiModelValid,
      aiCallStatusParseOk,
    );
    expect(result).toBe(false);
  });

  // ═══ CASE H — t_feature=NULL → eligible=false ═══
  it('H: t_feature=NULL → eligible=false (FAIL_T_FEATURE)', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass, // (caller would compute temporal from NULL t_feature → 0, but we test canonical)
      null, // t_feature NULL
      aiResponseHashValid,
      aiModelValid,
      aiCallStatusParseOk,
    );
    expect(result).toBe(false);
  });

  // ═══ CASE I — actual_outcome NOT a parameter of computeScientificEligible ═══
  // computeScientificEligible is about AI traceability + snapshot completeness
  // + temporal safety. Ground truth (actual_outcome) is a SEPARATE gate applied
  // at backtest time, NOT at INSERT time. The canonical function does NOT take
  // an actual_outcome parameter — it has 7 parameters only:
  //   (featureSnapshot, completenessScore, temporalSafetyScore, tFeature,
  //    aiResponseHash, aiModel, aiCallStatus)
  it('I (documentation): computeScientificEligible takes 7 parameters — actual_outcome is NOT one of them', () => {
    // Calling with 7 args leaves the function undefined for actual_outcome.
    // This proves ground truth is a SEPARATE gate (applied at backtest time).
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      aiCallStatusParseOk,
    );
    expect(result).toBe(true);
    // The function CANNOT take actual_outcome — it's not its concern.
    // This is why "scientific_collection_eligible = TRUE" (7 conditions)
    // does NOT imply "final_backtest_eligible = TRUE" (which adds ground truth).
    // The 7→5 gap is the 2 rows that pass scientific gates but lack ground truth.
  });

  // ═══ EDGE — additional ai_call_status values ═══
  it('EDGE: ai_call_status=TIMEOUT → eligible=false', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      'TIMEOUT',
    );
    expect(result).toBe(false);
  });

  it('EDGE: ai_call_status=PARSE_FAILED (with valid hash) → eligible=false (CRITICAL — hash NON-NULL but exploitable=false)', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid, // hash IS non-null...
      aiModelValid,
      'PARSE_FAILED', // ...but parsing failed → not exploitable
    );
    expect(result).toBe(false);
    // This is the KEY Phase 5.3.17.5 hardening — hash non-null alone is
    // NOT sufficient. PARSE_FAILED forces eligible=false.
  });

  it('EDGE: ai_call_status=NOT_CALLED → eligible=false', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      'NOT_CALLED',
    );
    expect(result).toBe(false);
  });

  it('EDGE: ai_call_status=EMPTY_RESPONSE → eligible=false', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      'EMPTY_RESPONSE',
    );
    expect(result).toBe(false);
  });

  it('EDGE: ai_call_status=undefined (not passed) → treated as legacy NULL → eligible=true (backward-compat)', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      undefined, // not passed at all — backward-compat
    );
    expect(result).toBe(true);
  });

  // ═══ EDGE — feature_snapshot NULL/invalid ═══
  it('EDGE: feature_snapshot=NULL → eligible=false', () => {
    const result = computeScientificEligible(
      null,
      completenessPass,
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      aiCallStatusParseOk,
    );
    expect(result).toBe(false);
  });

  // ═══ EDGE — completeness NULL ═══
  it('EDGE: completeness_score=NULL → eligible=false (in canonical function, NULL is treated as failing the >= 0.5 check)', () => {
    // Note: the canonical function does NOT COALESCE — it directly compares.
    // NULL >= 0.5 evaluates to NULL in JS (falsy), so eligible=false.
    const result = computeScientificEligible(
      snapshot,
      null, // NULL completeness — would happen if feature_snapshot is NULL on INSERT (F-CRIT-1)
      temporalSafetyPass,
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      aiCallStatusParseOk,
    );
    expect(result).toBe(false);
  });

  // ═══ EDGE — temporal_safety NULL ═══
  it('EDGE: temporal_safety_score=NULL → eligible=false (NULL fails >= 1.0 check)', () => {
    const result = computeScientificEligible(
      snapshot,
      completenessPass,
      null, // NULL temporal_safety
      tFeatureValid,
      aiResponseHashValid,
      aiModelValid,
      aiCallStatusParseOk,
    );
    expect(result).toBe(false);
  });
});
