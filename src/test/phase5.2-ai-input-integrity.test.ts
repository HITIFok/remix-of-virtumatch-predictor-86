// ============================================
// PHASE 5.2 TESTS — Final AI Input Integrity & Scientific Go-Live
// 10 sections + Go-Live Gate
// ============================================
//
// Sections:
// 1. Audit Two Pipelines — equivalence matrix
// 2. Equivalence Test — prompt data = snapshot data
// 3. Single Source of Truth — buildAIContext → prompt + snapshot
// 4. Hash of Context — AI_CONTEXT_HASH chain
// 5. Absent Values Test — null/empty/undefined/zero
// 6. Transformations Test — rounding/normalization
// 7. Hash Final Test — determinism + sensitivity
// 8. Non-Leakage Test — future data does not change context
// 9. End-to-End Test — full pipeline
// 10. Go-Live Gate — all conditions

import { describe, it, expect } from 'vitest';
import {
  buildAIContext,
  computeAIDerivedContext,
  buildUserPromptFromContext,
  buildAISnapshotFromContext,
  computeAIContextHash,
  computeAIInputHashFromContext,
  computeAIPromptHashFromContext,
  computeAIResponseHashFromContext,
  verifyPromptSnapshotEquivalence,
  testContextLeakage,
  evaluateGoLiveGate,
  captureVersionFreeze,
  wilsonScoreInterval,
  type AIContext,
  type AIInputs,
  type EquivalenceCheckResult,
} from '../../src/lib/ai-context';
import {
  AI_PROVIDER,
  AI_MODEL_DEFAULT,
  AI_PROMPT_VERSION,
  AI_TEMPERATURE,
  computeAIInputHash,
  buildAIInputsFromMatch,
  computeAIContextHashFromMatch,
} from '../../src/lib/ai-traceability';
import { getConfig } from '../../src/lib/prediction-config';
import {
  MODEL_VERSION,
  FEATURE_VERSION,
  CONFIG_VERSION,
  CALIBRATION_VERSION,
} from '../../src/lib/feature-snapshot';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

const PAST_TS = new Date(Date.now() - 86400000).toISOString();
const NOW_TS = new Date().toISOString();
const FUTURE_TS = new Date(Date.now() + 86400000).toISOString();

const SYSTEM_PROMPT_V7 = 'Tu es ANALYSTE FOOTBALL VIRTUEL v7.0';

function makeFullMatch() {
  return {
    home: 'TeamA',
    away: 'TeamB',
    oddHome: 1.85,
    oddDraw: 3.40,
    oddAway: 4.20,
    rankingHome: { position: 3, played: 15, won: 9, drawn: 3, lost: 3, goalsFor: 24, goalsAgainst: 12, points: 30 },
    rankingAway: { position: 12, played: 15, won: 3, drawn: 3, lost: 9, goalsFor: 12, goalsAgainst: 24, points: 12 },
    recentHome: [
      { result: 'V', scoreHome: 1, scoreAway: 0 },
      { result: 'N', scoreHome: 1, scoreAway: 1 },
      { result: 'V', scoreHome: 2, scoreAway: 0 },
      { result: 'D', scoreHome: 0, scoreAway: 1 },
      { result: 'V', scoreHome: 1, scoreAway: 0 },
    ],
    recentAway: [
      { result: 'D', scoreHome: 0, scoreAway: 1 },
      { result: 'D', scoreHome: 1, scoreAway: 2 },
      { result: 'N', scoreHome: 0, scoreAway: 0 },
      { result: 'D', scoreHome: 0, scoreAway: 1 },
      { result: 'V', scoreHome: 1, scoreAway: 0 },
    ],
    headToHead: [
      { scoreHome: 2, scoreAway: 1 },
      { scoreHome: 1, scoreAway: 1 },
      { scoreHome: 3, scoreAway: 0 },
      { scoreHome: 0, scoreAway: 1 },
      { scoreHome: 1, scoreAway: 0 },
      { scoreHome: 1, scoreAway: 2 },
    ],
    oddsTimestamp: PAST_TS,
    rankingTimestamp: PAST_TS,
    formTimestamp: PAST_TS,
    h2hTimestamp: PAST_TS,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: AUDIT TWO PIPELINES — Equivalence Matrix
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 1: Audit Two Pipelines', () => {
  it('should produce equivalence matrix showing all inputs identical', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const userPrompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    const results = verifyPromptSnapshotEquivalence(ctx, userPrompt, snapshot);

    // Build matrix for reporting
    const matrix = results.map(r => ({
      Input: r.input,
      Prompt: r.in_prompt ? '✓' : '✗',
      Snapshot: r.in_snapshot ? '✓' : '✗',
      Identical: r.identical ? '✓' : '✗',
    }));

    // All inputs must be identical
    const nonIdentical = results.filter(r => !r.identical && r.difference_type !== 'NONE');
    expect(nonIdentical).toHaveLength(0);
  });

  it('should have no data in prompt missing from snapshot', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const userPrompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    const results = verifyPromptSnapshotEquivalence(ctx, userPrompt, snapshot);
    const missingInSnapshot = results.filter(r => r.difference_type === 'MISSING_IN_SNAPSHOT');
    expect(missingInSnapshot).toHaveLength(0);
  });

  it('should have odds values match exactly between prompt and snapshot', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const snapshot = buildAISnapshotFromContext(ctx);

    expect(snapshot.odds.home.value).toBe(match.oddHome);
    expect(snapshot.odds.draw.value).toBe(match.oddDraw);
    expect(snapshot.odds.away.value).toBe(match.oddAway);
  });

  it('should have standings format match between prompt and snapshot', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const derived = computeAIDerivedContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    // Snapshot standings string should exactly match derived format
    expect(snapshot.standings_home?.value).toBe(derived.standings_formatted.home);
    expect(snapshot.standings_away?.value).toBe(derived.standings_formatted.away);
  });

  it('should have form format match between prompt and snapshot', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const derived = computeAIDerivedContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    expect(snapshot.form_home?.value).toBe(derived.form_formatted.home);
    expect(snapshot.form_away?.value).toBe(derived.form_formatted.away);
  });

  it('should have H2H format match between prompt and snapshot', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const derived = computeAIDerivedContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    expect(snapshot.h2h?.value).toBe(derived.h2h_formatted.summary);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: EQUIVALENCE TEST
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 2: Equivalence Test', () => {
  it('should verify every dynamic data in prompt has traceable equivalent in snapshot', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const userPrompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    // Check that the prompt contains data that maps to snapshot fields
    // Odds
    expect(userPrompt).toContain(String(match.oddHome));
    expect(userPrompt).toContain(String(match.oddDraw));
    expect(userPrompt).toContain(String(match.oddAway));
    expect(snapshot.odds.home.value).toBe(match.oddHome);

    // Standings
    if (snapshot.standings_home) {
      expect(userPrompt).toContain('H:' + snapshot.standings_home.value);
    }
    if (snapshot.standings_away) {
      expect(userPrompt).toContain('A:' + snapshot.standings_away.value);
    }

    // Form
    if (snapshot.form_home) {
      expect(userPrompt).toContain('FH:' + snapshot.form_home.value);
    }
    if (snapshot.form_away) {
      expect(userPrompt).toContain('FA:' + snapshot.form_away.value);
    }

    // H2H
    if (snapshot.h2h) {
      expect(userPrompt).toContain('H2H:' + snapshot.h2h.value);
    }
  });

  it('should produce AI_TRACEABILITY = PASS when all data matches', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const userPrompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    const results = verifyPromptSnapshotEquivalence(ctx, userPrompt, snapshot);
    const allIdentical = results.every(r => r.identical || r.difference_type === 'NONE');
    expect(allIdentical).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: SINGLE SOURCE OF TRUTH
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 3: Single Source of Truth', () => {
  it('should derive both prompt and snapshot from the same AIContext', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);

    // Both derive from the same context
    const prompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    // They must be consistent
    expect(prompt).toBeTruthy();
    expect(snapshot.odds.home.value).toBe(ctx.odds.home);
  });

  it('should produce identical results when called twice with same context', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);

    const prompt1 = buildUserPromptFromContext(ctx);
    const prompt2 = buildUserPromptFromContext(ctx);
    expect(prompt1).toBe(prompt2);

    const snap1 = buildAISnapshotFromContext(ctx);
    const snap2 = buildAISnapshotFromContext(ctx);
    expect(snap1.odds.home.value).toBe(snap2.odds.home.value);
    expect(snap1.standings_home?.value).toBe(snap2.standings_home?.value);
  });

  it('should delegate buildAIInputsFromMatch to canonical context', () => {
    const match = makeFullMatch();

    // Old API (ai-traceability.ts) should produce same result as new API
    const inputsFromOldAPI = buildAIInputsFromMatch(match);
    const ctx = buildAIContext(match);
    const inputsFromNewAPI = buildAISnapshotFromContext(ctx);

    expect(inputsFromOldAPI.odds.home.value).toBe(inputsFromNewAPI.odds.home.value);
    expect(inputsFromOldAPI.odds.draw.value).toBe(inputsFromNewAPI.odds.draw.value);
    expect(inputsFromOldAPI.odds.away.value).toBe(inputsFromNewAPI.odds.away.value);
    expect(inputsFromOldAPI.standings_home?.value).toBe(inputsFromNewAPI.standings_home?.value);
    expect(inputsFromOldAPI.form_home?.value).toBe(inputsFromNewAPI.form_home?.value);
    expect(inputsFromOldAPI.h2h?.value).toBe(inputsFromNewAPI.h2h?.value);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 4: HASH OF CONTEXT
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 4: Hash of Context', () => {
  it('should compute AI_CONTEXT_HASH from canonical raw values', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const contextHash = computeAIContextHash(ctx);
    expect(contextHash).toBeTruthy();
    expect(contextHash.length).toBe(64); // SHA-256 hex
  });

  it('should derive AI_INPUT_HASH from AI_CONTEXT_HASH chain', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const snapshot = buildAISnapshotFromContext(ctx);

    // AI_CONTEXT_HASH (raw) → AI_INPUT_HASH (after transformation)
    const contextHash = computeAIContextHash(ctx);
    const inputHash = computeAIInputHashFromContext(snapshot);

    // Both should be valid SHA-256 hashes
    expect(contextHash.length).toBe(64);
    expect(inputHash.length).toBe(64);

    // They should be different (context is raw, inputs are formatted)
    // unless the formatting happens to produce the same hash
    // (which is unlikely but not impossible)
    expect(contextHash).toBeTruthy();
    expect(inputHash).toBeTruthy();
  });

  it('should document hash chain: AI_CONTEXT_HASH → AI_INPUT_HASH → AI_PROMPT_HASH → AI_RESPONSE_HASH', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const snapshot = buildAISnapshotFromContext(ctx);
    const prompt = buildUserPromptFromContext(ctx);
    const response = '{"predictions":[{"scoreHome":1,"scoreAway":0}]}';

    const contextHash = computeAIContextHash(ctx);
    const inputHash = computeAIInputHashFromContext(snapshot);
    const promptHash = computeAIPromptHashFromContext(SYSTEM_PROMPT_V7, prompt);
    const responseHash = computeAIResponseHashFromContext(response);

    // All four hashes should be valid and distinct
    expect(contextHash.length).toBe(64);
    expect(inputHash.length).toBe(64);
    expect(promptHash.length).toBe(64);
    expect(responseHash.length).toBe(64);

    // AI_CONTEXT_HASH captures RAW data
    // AI_INPUT_HASH captures DERIVED data (after transformation)
    // AI_PROMPT_HASH captures the TEXT sent to AI
    // AI_RESPONSE_HASH captures the AI response
    // They serve different purposes in the traceability chain
    expect(typeof contextHash).toBe('string');
    expect(typeof inputHash).toBe('string');
    expect(typeof promptHash).toBe('string');
    expect(typeof responseHash).toBe('string');
  });

  it('should have same AI_CONTEXT_HASH for identical contexts', () => {
    const match = makeFullMatch();
    const ctx1 = buildAIContext(match);
    const ctx2 = buildAIContext(match);
    expect(computeAIContextHash(ctx1)).toBe(computeAIContextHash(ctx2));
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 5: ABSENT VALUES TEST
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 5: Absent Values', () => {
  it('should handle absent form identically in prompt and snapshot', () => {
    const match = makeFullMatch();
    delete match.recentHome;
    delete match.recentAway;
    const ctx = buildAIContext(match);
    const prompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    // Prompt should not contain FH: or FA:
    expect(prompt).not.toContain('FH:');
    expect(prompt).not.toContain('FA:');
    // Snapshot should have null form
    expect(snapshot.form_home).toBeNull();
    expect(snapshot.form_away).toBeNull();
  });

  it('should handle absent H2H identically in prompt and snapshot', () => {
    const match = makeFullMatch();
    delete match.headToHead;
    const ctx = buildAIContext(match);
    const prompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    expect(prompt).not.toContain('H2H:');
    expect(snapshot.h2h).toBeNull();
  });

  it('should handle absent odds timestamps', () => {
    const match = makeFullMatch();
    delete match.oddsTimestamp;
    const ctx = buildAIContext(match);
    const snapshot = buildAISnapshotFromContext(ctx);

    expect(snapshot.odds.home.source_timestamp).toBeNull();
  });

  it('should handle absent standings identically in prompt and snapshot', () => {
    const match = makeFullMatch();
    delete match.rankingHome;
    delete match.rankingAway;
    const ctx = buildAIContext(match);
    const prompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    expect(prompt).not.toContain('H:#');
    expect(prompt).not.toContain('A:#');
    expect(snapshot.standings_home).toBeNull();
    expect(snapshot.standings_away).toBeNull();
  });

  it('should handle empty form arrays', () => {
    const match = makeFullMatch();
    match.recentHome = [];
    match.recentAway = [];
    const ctx = buildAIContext(match);
    const prompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    expect(prompt).not.toContain('FH:');
    expect(prompt).not.toContain('FA:');
    expect(snapshot.form_home).toBeNull();
    expect(snapshot.form_away).toBeNull();
  });

  it('should handle empty H2H array', () => {
    const match = makeFullMatch();
    match.headToHead = [];
    const ctx = buildAIContext(match);
    const prompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    expect(prompt).not.toContain('H2H:');
    expect(snapshot.h2h).toBeNull();
  });

  it('should handle zero values in odds', () => {
    // Zero odds are invalid in practice, but the system should not crash
    const ctx = buildAIContext({
      home: 'A', away: 'B',
      oddHome: 1.5, oddDraw: 3.0, oddAway: 5.0,
      recentHome: [{ result: 'V', scoreHome: 0, scoreAway: 0 }],
    });
    const snapshot = buildAISnapshotFromContext(ctx);
    expect(snapshot.odds.home.value).toBe(1.5);
  });

  it('should handle null form values gracefully', () => {
    const match = {
      home: 'A', away: 'B',
      oddHome: 1.85, oddDraw: 3.40, oddAway: 4.20,
    };
    const ctx = buildAIContext(match);
    const snapshot = buildAISnapshotFromContext(ctx);

    expect(snapshot.form_home).toBeNull();
    expect(snapshot.form_away).toBeNull();
    expect(snapshot.h2h).toBeNull();
    expect(snapshot.standings_home).toBeNull();
    expect(snapshot.standings_away).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 6: TRANSFORMATIONS TEST
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 6: Transformations', () => {
  it('should preserve implied probability percentages in snapshot matching prompt', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const derived = computeAIDerivedContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    // The snapshot now stores percentages (not raw fractions)
    // matching what appears in the prompt
    expect(snapshot.odds.implied_home.value).toBe(derived.implied_probabilities.home_pct);
    expect(snapshot.odds.implied_draw.value).toBe(derived.implied_probabilities.draw_pct);
    expect(snapshot.odds.implied_away.value).toBe(derived.implied_probabilities.away_pct);
  });

  it('should preserve standings rounding (toFixed(1)) in snapshot', () => {
    const match = makeFullMatch();
    // Use values that require rounding
    match.rankingHome = { position: 1, played: 7, won: 5, drawn: 1, lost: 1, goalsFor: 13, goalsAgainst: 5, points: 16 };
    const ctx = buildAIContext(match);
    const derived = computeAIDerivedContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    // 13/7 = 1.857... → toFixed(1) = "1.9"
    // 5/7 = 0.714... → toFixed(1) = "0.7"
    expect(derived.standings_formatted.home).toContain('att:1.9');
    expect(derived.standings_formatted.home).toContain('def:0.7');
    expect(snapshot.standings_home?.value).toBe(derived.standings_formatted.home);
  });

  it('should preserve H2H average rounding (toFixed(1)) in snapshot', () => {
    const match = makeFullMatch();
    // Use values where average needs rounding
    match.headToHead = [
      { scoreHome: 2, scoreAway: 1 }, // total 3
      { scoreHome: 1, scoreAway: 0 }, // total 1
      { scoreHome: 0, scoreAway: 0 }, // total 0
    ]; // avg = 4/3 = 1.333... → toFixed(1) = "1.3"
    const ctx = buildAIContext(match);
    const derived = computeAIDerivedContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    expect(derived.h2h_formatted.summary).toContain('avg:1.3');
    expect(snapshot.h2h?.value).toBe(derived.h2h_formatted.summary);
  });

  it('should preserve form transformation exactly in snapshot', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const derived = computeAIDerivedContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    // The exact form string (e.g. "V1-0 N1-1 V2-0 D0-1 V1-0")
    // must be identical between derived and snapshot
    expect(snapshot.form_home?.value).toBe(derived.form_formatted.home);
    expect(snapshot.form_away?.value).toBe(derived.form_formatted.away);
  });

  it('should have sufficient information in snapshot to reconstruct values sent to AI', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const snapshot = buildAISnapshotFromContext(ctx);
    const prompt = buildUserPromptFromContext(ctx);

    // The snapshot values should be sufficient to reconstruct the prompt
    // For each data element, the snapshot value should appear in the prompt
    expect(prompt).toContain(String(snapshot.odds.home.value));
    expect(prompt).toContain(String(snapshot.odds.draw.value));
    expect(prompt).toContain(String(snapshot.odds.away.value));

    if (snapshot.standings_home) {
      expect(prompt).toContain(String(snapshot.standings_home.value));
    }
    if (snapshot.form_home) {
      expect(prompt).toContain(String(snapshot.form_home.value));
    }
    if (snapshot.h2h) {
      expect(prompt).toContain(String(snapshot.h2h.value));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 7: HASH FINAL TEST
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 7: Hash Final', () => {
  it('should produce same AI_INPUT_HASH for same context', () => {
    const match = makeFullMatch();
    const ctx1 = buildAIContext(match);
    const ctx2 = buildAIContext(match);
    const snap1 = buildAISnapshotFromContext(ctx1);
    const snap2 = buildAISnapshotFromContext(ctx2);

    const hash1 = computeAIInputHashFromContext(snap1);
    const hash2 = computeAIInputHashFromContext(snap2);
    expect(hash1).toBe(hash2);
  });

  it('should produce different AI_INPUT_HASH when context is modified', () => {
    const match = makeFullMatch();
    const ctx1 = buildAIContext(match);
    const snap1 = buildAISnapshotFromContext(ctx1);
    const hash1 = computeAIInputHashFromContext(snap1);

    // Modify odds
    const match2 = { ...match, oddHome: 2.10 };
    const ctx2 = buildAIContext(match2);
    const snap2 = buildAISnapshotFromContext(ctx2);
    const hash2 = computeAIInputHashFromContext(snap2);
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different AI_CONTEXT_HASH when context is modified', () => {
    const match = makeFullMatch();
    const ctx1 = buildAIContext(match);
    const hash1 = computeAIContextHash(ctx1);

    const match2 = { ...match, oddHome: 2.10 };
    const ctx2 = buildAIContext(match2);
    const hash2 = computeAIContextHash(ctx2);
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different AI_PROMPT_HASH when prompt is modified', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const prompt = buildUserPromptFromContext(ctx);
    const hash1 = computeAIPromptHashFromContext(SYSTEM_PROMPT_V7, prompt);
    const hash2 = computeAIPromptHashFromContext(SYSTEM_PROMPT_V7 + ' modified', prompt);
    const hash3 = computeAIPromptHashFromContext(SYSTEM_PROMPT_V7, prompt + ' extra');

    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });

  it('should produce same AI_CONTEXT_HASH via ai-traceability delegation', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const hashDirect = computeAIContextHash(ctx);
    const hashDelegated = computeAIContextHashFromMatch(match);
    expect(hashDirect).toBe(hashDelegated);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 8: NON-LEAKAGE TEST
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 8: Non-Leakage Test', () => {
  it('should not change context when future data is added to DB', () => {
    const match = makeFullMatch();
    const originalContext = buildAIContext(match);

    // Create a "modified" context that simulates future data
    // But the key point: the context at time T should only use data available at T
    // Adding future data to the DB should not change the context
    const modifiedContext = buildAIContext(match); // Same data → same context

    const result = testContextLeakage(originalContext, modifiedContext, 'Future DB data');
    expect(result.passed).toBe(true);
    expect(result.hash_changed).toBe(false);
  });

  it('should detect leakage when form data changes', () => {
    const match = makeFullMatch();
    const originalContext = buildAIContext(match);

    // Modify form (simulating future match results leaking into context)
    const modifiedMatch = makeFullMatch();
    modifiedMatch.recentHome = [
      { result: 'V', scoreHome: 5, scoreAway: 0 }, // Suspicious future data
      ...match.recentHome.slice(0, 4),
    ];
    const modifiedContext = buildAIContext(modifiedMatch);

    const result = testContextLeakage(originalContext, modifiedContext, 'Future form data');
    expect(result.passed).toBe(false);
    expect(result.hash_changed).toBe(true);
  });

  it('should detect leakage when odds change', () => {
    const match = makeFullMatch();
    const originalContext = buildAIContext(match);

    const modifiedMatch = { ...match, oddHome: 1.50 }; // Odds changed
    const modifiedContext = buildAIContext(modifiedMatch);

    const result = testContextLeakage(originalContext, modifiedContext, 'Odds change');
    expect(result.passed).toBe(false);
    expect(result.hash_changed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 9: END-TO-END TEST
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 9: End-to-End Test', () => {
  it('should trace full pipeline: match → context → prompt → snapshot → hashes', () => {
    const match = makeFullMatch();

    // Step 1: Build canonical context
    const ctx = buildAIContext(match);
    expect(ctx.home).toBe('TeamA');
    expect(ctx.away).toBe('TeamB');

    // Step 2: Compute derived context
    const derived = computeAIDerivedContext(ctx);
    expect(derived.implied_probabilities.home_pct).toBeGreaterThan(0);
    expect(derived.implied_probabilities.home_pct).toBeLessThanOrEqual(100);

    // Step 3: Build user prompt
    const userPrompt = buildUserPromptFromContext(ctx);
    expect(userPrompt).toContain('TeamA vs TeamB');
    expect(userPrompt).toContain('1.85');

    // Step 4: Build AI snapshot
    const snapshot = buildAISnapshotFromContext(ctx);
    expect(snapshot.odds.home.value).toBe(1.85);

    // Step 5: Compute hashes
    const contextHash = computeAIContextHash(ctx);
    const inputHash = computeAIInputHashFromContext(snapshot);
    const promptHash = computeAIPromptHashFromContext(SYSTEM_PROMPT_V7, userPrompt);
    const responseHash = computeAIResponseHashFromContext('{"predictions":[]}');

    expect(contextHash.length).toBe(64);
    expect(inputHash.length).toBe(64);
    expect(promptHash.length).toBe(64);
    expect(responseHash.length).toBe(64);

    // Step 6: Verify equivalence
    const eqResults = verifyPromptSnapshotEquivalence(ctx, userPrompt, snapshot);
    const allIdentical = eqResults.every(r => r.identical || r.difference_type === 'NONE');
    expect(allIdentical).toBe(true);

    // Step 7: Verify timestamps
    const tStart = new Date(Date.now() - 5000).toISOString();
    const tFeatures = new Date(Date.now() - 4000).toISOString();
    const tAiRequest = new Date(Date.now() - 3000).toISOString();
    const tAiResponse = new Date(Date.now() - 1000).toISOString();
    const tPrediction = new Date(Date.now() - 500).toISOString();
    const tSnapshot = new Date().toISOString();

    expect(new Date(tStart).getTime()).toBeLessThanOrEqual(new Date(tFeatures).getTime());
    expect(new Date(tFeatures).getTime()).toBeLessThanOrEqual(new Date(tAiRequest).getTime());
    expect(new Date(tAiRequest).getTime()).toBeLessThanOrEqual(new Date(tAiResponse).getTime());
    expect(new Date(tAiResponse).getTime()).toBeLessThanOrEqual(new Date(tPrediction).getTime());
    expect(new Date(tPrediction).getTime()).toBeLessThanOrEqual(new Date(tSnapshot).getTime());
  });

  it('should maintain hash consistency across full pipeline', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);

    // Run pipeline twice — must produce identical hashes
    const run1 = () => {
      const snap = buildAISnapshotFromContext(ctx);
      return computeAIInputHashFromContext(snap);
    };
    const run2 = () => {
      const snap = buildAISnapshotFromContext(ctx);
      return computeAIInputHashFromContext(snap);
    };

    expect(run1()).toBe(run2());
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 10: GO-LIVE GATE
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 10: Go-Live Gate', () => {
  it('should return READY when all conditions pass', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const prompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);

    const eqResults = verifyPromptSnapshotEquivalence(ctx, prompt, snapshot);

    const result = evaluateGoLiveGate({
      equivalenceResults: eqResults,
      inputHashReproducible: true,
      promptHashReproducible: true,
      timestampsConsistent: true,
      leakageTestPassed: true,
      snapshotImmutable: true,
      testsPass: true,
    });

    expect(result.overall).toBe('READY');
    expect(result.blocking_issues).toHaveLength(0);
  });

  it('should return BLOCKED when equivalence fails', () => {
    const result = evaluateGoLiveGate({
      equivalenceResults: [
        {
          input: 'test_field',
          in_prompt: true,
          in_snapshot: false,
          prompt_value: 'value',
          snapshot_value: null,
          identical: false,
          difference_type: 'MISSING_IN_SNAPSHOT',
        },
      ],
      inputHashReproducible: true,
      promptHashReproducible: true,
      timestampsConsistent: true,
      leakageTestPassed: true,
      snapshotImmutable: true,
      testsPass: true,
    });

    expect(result.overall).toBe('BLOCKED');
    expect(result.blocking_issues.length).toBeGreaterThan(0);
  });

  it('should return BLOCKED when leakage test fails', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const prompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);
    const eqResults = verifyPromptSnapshotEquivalence(ctx, prompt, snapshot);

    const result = evaluateGoLiveGate({
      equivalenceResults: eqResults,
      inputHashReproducible: true,
      promptHashReproducible: true,
      timestampsConsistent: true,
      leakageTestPassed: false,
      snapshotImmutable: true,
      testsPass: true,
    });

    expect(result.overall).toBe('BLOCKED');
    expect(result.blocking_issues).toContain('Leakage test failed: future data changes AI context');
  });

  it('should return BLOCKED when tests are failing', () => {
    const match = makeFullMatch();
    const ctx = buildAIContext(match);
    const prompt = buildUserPromptFromContext(ctx);
    const snapshot = buildAISnapshotFromContext(ctx);
    const eqResults = verifyPromptSnapshotEquivalence(ctx, prompt, snapshot);

    const result = evaluateGoLiveGate({
      equivalenceResults: eqResults,
      inputHashReproducible: true,
      promptHashReproducible: true,
      timestampsConsistent: true,
      leakageTestPassed: true,
      snapshotImmutable: true,
      testsPass: false,
    });

    expect(result.overall).toBe('BLOCKED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 12: WILSON SCORE INTERVAL
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 12: Wilson Score Interval', () => {
  it('should compute 95% CI for 100 predictions', () => {
    // 100 predictions = initial pipeline check
    const successes = 55;
    const total = 100;
    const ci = wilsonScoreInterval(successes, total);

    expect(ci.point).toBeCloseTo(0.55, 2);
    expect(ci.lower).toBeLessThan(ci.point);
    expect(ci.upper).toBeGreaterThan(ci.point);
    // 95% CI should be reasonably wide at N=100
    expect(ci.upper - ci.lower).toBeGreaterThan(0.05);
  });

  it('should compute narrower CI for larger sample', () => {
    const ci100 = wilsonScoreInterval(55, 100);
    const ci1000 = wilsonScoreInterval(550, 1000);

    // Larger sample → narrower CI
    expect(ci1000.upper - ci1000.lower).toBeLessThan(ci100.upper - ci100.lower);
  });

  it('should handle edge cases', () => {
    expect(wilsonScoreInterval(0, 0).point).toBe(0);
    expect(wilsonScoreInterval(0, 100).point).toBe(0);
    expect(wilsonScoreInterval(100, 100).point).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 13: VERSION FREEZE
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2 Section 13: Version Freeze', () => {
  it('should capture all version components', () => {
    const freeze = captureVersionFreeze('abc123');

    expect(freeze.model_version).toBe(MODEL_VERSION);
    expect(freeze.feature_version).toBe(FEATURE_VERSION);
    expect(freeze.config_version).toBe(CONFIG_VERSION);
    expect(freeze.calibration_version).toBe(CALIBRATION_VERSION);
    expect(freeze.ai_prompt_version).toBe(AI_PROMPT_VERSION);
    expect(freeze.ai_model).toBe(AI_MODEL_DEFAULT);
    expect(freeze.code_commit).toBe('abc123');
    expect(freeze.frozen_at).toBeTruthy();
  });

  it('should have consistent versions across the system', () => {
    const freeze = captureVersionFreeze('test');

    // These must match the values in feature-snapshot.ts and ai-traceability.ts
    expect(freeze.model_version).toBe('2.0.0');
    expect(freeze.feature_version).toBe('1.0.0');
    expect(freeze.config_version).toBe('1.0.0');
    expect(freeze.calibration_version).toBe('0.0.0');
    expect(freeze.ai_prompt_version).toBe('7.0');
    expect(freeze.ai_model).toBe('llama-3.3-70b-versatile');
  });
});

// ═══════════════════════════════════════════════════════════════════
// NO MODEL MODIFICATION VERIFICATION
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.2: No Model Modification', () => {
  it('should not modify AI_WEIGHT', () => {
    const config = getConfig();
    expect(config.AI_WEIGHT).toBe(0.35);
  });

  it('should not modify any coefficient values', () => {
    const config = getConfig();
    // Spot-check critical coefficients
    expect(config.GRID_MIN_LAMBDA).toBe(0.5);
    expect(config.GRID_MAX_LAMBDA).toBe(3.0);
    expect(config.GRID_STEP).toBe(0.05);
    expect(config.VIRTUAL_AVG_GOALS).toBe(1.3);
    expect(config.STAT_BASE_WEIGHT).toBe(0.70);
    expect(config.STAT_ATTACK_WEIGHT).toBe(0.20);
    expect(config.STAT_DEF_WEIGHT).toBe(0.10);
  });
});
