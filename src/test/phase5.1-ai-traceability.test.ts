// ============================================
// PHASE 5.1 TESTS — AI Traceability
// 7 required tests + additional coverage
// ============================================

import { describe, it, expect } from 'vitest';
import {
  AI_PROVIDER,
  AI_MODEL_DEFAULT,
  AI_PROMPT_VERSION,
  AI_TEMPERATURE,
  computeHash,
  computeSystemPromptHash,
  computeUserPromptHash,
  computePromptHash,
  computeAIInputHash,
  computeAIResponseHash,
  buildAIInputAuditTable,
  buildAIInputsFromMatch,
  classifyAIProvenance,
  testAILeakage,
  computePredictionTimeline,
  createAITraceRecord,
  type AIInputs,
  type AIInputField,
  type AITraceRecord,
  type PredictionTimeline,
} from '../../src/lib/ai-traceability';
import { getConfig } from '../../src/lib/prediction-config';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

const PAST_TS = new Date(Date.now() - 86400000).toISOString(); // 24h ago
const NOW_TS = new Date().toISOString();
const FUTURE_TS = new Date(Date.now() + 86400000).toISOString(); // 24h future

const SYSTEM_PROMPT_V7 = 'Tu es ANALYSTE FOOTBALL VIRTUEL v7.0';

function makeSampleInputs(oddsTs: string | null = PAST_TS): AIInputs {
  return {
    odds: {
      home: { name: 'odds_home', value: 1.85, source: 'bookmaker', source_timestamp: oddsTs, version: '1.0.0', provenance: 'RECORDED' },
      draw: { name: 'odds_draw', value: 3.40, source: 'bookmaker', source_timestamp: oddsTs, version: '1.0.0', provenance: 'RECORDED' },
      away: { name: 'odds_away', value: 4.20, source: 'bookmaker', source_timestamp: oddsTs, version: '1.0.0', provenance: 'RECORDED' },
      implied_home: { name: 'odds_implied_home', value: 0.54, source: 'calculated', source_timestamp: oddsTs, version: '1.0.0', provenance: 'RECONSTRUCTED' },
      implied_draw: { name: 'odds_implied_draw', value: 0.29, source: 'calculated', source_timestamp: oddsTs, version: '1.0.0', provenance: 'RECONSTRUCTED' },
      implied_away: { name: 'odds_implied_away', value: 0.24, source: 'calculated', source_timestamp: oddsTs, version: '1.0.0', provenance: 'RECONSTRUCTED' },
    },
    standings_home: { name: 'standings_home', value: '#3 15j 9V3N3D 24-12 30p', source: 'ranking', source_timestamp: PAST_TS, version: '1.0.0', provenance: 'RECORDED' },
    standings_away: { name: 'standings_away', value: '#12 15j 3V3N9D 12-24 12p', source: 'ranking', source_timestamp: PAST_TS, version: '1.0.0', provenance: 'RECORDED' },
    form_home: { name: 'form_home', value: 'V1-0 N1-1 V2-0 D0-1 V1-0', source: 'matches', source_timestamp: PAST_TS, version: '1.0.0', provenance: 'RECORDED' },
    form_away: { name: 'form_away', value: 'D0-1 D1-2 N0-0 D0-1 V1-0', source: 'matches', source_timestamp: PAST_TS, version: '1.0.0', provenance: 'RECORDED' },
    h2h: { name: 'h2h', value: '3V1N1D avg:2.0bm', source: 'matches', source_timestamp: PAST_TS, version: '1.0.0', provenance: 'RECORDED' },
    other: [],
  };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1: Same inputs -> same hash
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1 Test 1: Same inputs -> same hash', () => {
  it('should produce same AI_INPUT_HASH for identical inputs', () => {
    const inputs1 = makeSampleInputs();
    const inputs2 = makeSampleInputs();
    const hash1 = computeAIInputHash(inputs1);
    const hash2 = computeAIInputHash(inputs2);
    expect(hash1).toBe(hash2);
  });

  it('should produce same system prompt hash for identical prompts', () => {
    const hash1 = computeSystemPromptHash(SYSTEM_PROMPT_V7);
    const hash2 = computeSystemPromptHash(SYSTEM_PROMPT_V7);
    expect(hash1).toBe(hash2);
  });

  it('should produce same user prompt hash for identical prompts', () => {
    const prompt = 'M1: TeamA vs TeamB | 1.85/3.40/4.20';
    const hash1 = computeUserPromptHash(prompt);
    const hash2 = computeUserPromptHash(prompt);
    expect(hash1).toBe(hash2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2: Input modified -> hash different
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1 Test 2: Input modified -> hash different', () => {
  it('should produce different hash when odds change', () => {
    const inputs1 = makeSampleInputs();
    const inputs2 = makeSampleInputs();
    inputs2.odds.home = { ...inputs2.odds.home, value: 2.10 };
    const hash1 = computeAIInputHash(inputs1);
    const hash2 = computeAIInputHash(inputs2);
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash when form changes', () => {
    const inputs1 = makeSampleInputs();
    const inputs2 = makeSampleInputs();
    inputs2.form_home = { ...inputs2.form_home!, value: 'D0-1 D0-2 D0-1 D0-1 D0-0' };
    const hash1 = computeAIInputHash(inputs1);
    const hash2 = computeAIInputHash(inputs2);
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash when standings change', () => {
    const inputs1 = makeSampleInputs();
    const inputs2 = makeSampleInputs();
    inputs2.standings_home = { ...inputs2.standings_home!, value: '#1 15j 12V2N1D 36-8 38p' };
    const hash1 = computeAIInputHash(inputs1);
    const hash2 = computeAIInputHash(inputs2);
    expect(hash1).not.toBe(hash2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 3: Prompt modified -> prompt hash different
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1 Test 3: Prompt modified -> prompt hash different', () => {
  it('should produce different hash for different system prompts', () => {
    const hash1 = computeSystemPromptHash('v7.0 prompt');
    const hash2 = computeSystemPromptHash('v8.0 prompt');
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash for different user prompts', () => {
    const hash1 = computeUserPromptHash('M1: TeamA vs TeamB');
    const hash2 = computeUserPromptHash('M1: TeamC vs TeamD');
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different combined prompt hash for different prompts', () => {
    const hash1 = computePromptHash('sys1', 'user1');
    const hash2 = computePromptHash('sys2', 'user1');
    const hash3 = computePromptHash('sys1', 'user2');
    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 4: Future data -> leakage detected
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1 Test 4: Future data -> leakage detected', () => {
  it('should detect leakage when future data changes AI input hash', () => {
    const originalInputs = makeSampleInputs(PAST_TS);
    // Modify inputs by adding future data (changing form to include future results)
    const modifiedInputs = makeSampleInputs(PAST_TS);
    modifiedInputs.form_home = {
      ...modifiedInputs.form_home!,
      value: 'V5-0 V4-0 V3-0 V2-0 V1-0', // Suspiciously good form (future data?)
      source_timestamp: FUTURE_TS, // Future timestamp!
    };

    const result = testAILeakage(originalInputs, modifiedInputs, 'Future form data');
    expect(result.hash_changed).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('should NOT flag leakage when only adding future data that is excluded', () => {
    // If we don't include the future data in the inputs at all,
    // the hash stays the same
    const originalInputs = makeSampleInputs(PAST_TS);
    const sameInputs = makeSampleInputs(PAST_TS);
    const result = testAILeakage(originalInputs, sameInputs, 'No future data');
    expect(result.passed).toBe(true);
    expect(result.hash_changed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 5: Snapshot AI modified -> DB blocks (code-level check)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1 Test 5: Snapshot AI modified -> immutability enforced', () => {
  it('should verify migration 007 exists with immutability trigger', () => {
    // This test verifies at code level that the trigger exists.
    // At DB level, the trigger prevents modification.
    // We verify the trigger SQL is in the migration file.
    const fs = require('fs');
    const path = require('path');
    const migrationPath = path.resolve(__dirname, '../../api/_migrations/007_snapshot_immutability.sql');
    const migration = fs.readFileSync(migrationPath, 'utf-8');

    expect(migration).toContain('enforce_snapshot_immutability');
    expect(migration).toContain('feature_snapshot IS DISTINCT FROM OLD.feature_snapshot');
    expect(migration).toContain('feature_snapshot_hash IS DISTINCT FROM OLD.feature_snapshot_hash');
  });

  it('should verify AI trace record hash is deterministic', () => {
    const inputs = makeSampleInputs();
    const trace1 = createAITraceRecord({
      systemPrompt: SYSTEM_PROMPT_V7,
      userPrompt: 'M1: TeamA vs TeamB',
      inputs,
      model: AI_MODEL_DEFAULT,
      requestTimestamp: NOW_TS,
      responseTimestamp: NOW_TS,
      responseContent: '{"predictions":[]}',
      predictionUsed: { score_home: 1, score_away: 0, confidence: 0.72 },
      predictionTimestamp: NOW_TS,
    });

    const trace2 = createAITraceRecord({
      systemPrompt: SYSTEM_PROMPT_V7,
      userPrompt: 'M1: TeamA vs TeamB',
      inputs,
      model: AI_MODEL_DEFAULT,
      requestTimestamp: NOW_TS,
      responseTimestamp: NOW_TS,
      responseContent: '{"predictions":[]}',
      predictionUsed: { score_home: 1, score_away: 0, confidence: 0.72 },
      predictionTimestamp: NOW_TS,
    });

    // Same inputs -> same hashes
    expect(trace1.ai_input_hash).toBe(trace2.ai_input_hash);
    expect(trace1.ai_prompt_hash).toBe(trace2.ai_prompt_hash);
    expect(trace1.ai_system_prompt_hash).toBe(trace2.ai_system_prompt_hash);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 6: Timestamp future -> classification UNSAFE
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1 Test 6: Timestamp future -> classification UNSAFE', () => {
  it('should classify as UNSAFE when input has future timestamp', () => {
    const inputs = makeSampleInputs(FUTURE_TS); // Odds from future
    const result = classifyAIProvenance(inputs, NOW_TS);
    expect(result.provenance).toBe('UNSAFE');
    expect(result.risk_flags.some(f => f.includes('UNSAFE'))).toBe(true);
  });

  it('should classify as RECORDED when all inputs are before prediction', () => {
    const inputs = makeSampleInputs(PAST_TS);
    const result = classifyAIProvenance(inputs, NOW_TS);
    expect(result.provenance).toBe('RECORDED');
  });

  it('should flag double counting risk for all classifications', () => {
    const inputs = makeSampleInputs(PAST_TS);
    const result = classifyAIProvenance(inputs, NOW_TS);
    expect(result.risk_flags.some(f => f.includes('double counting'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 7: Input without timestamp -> UNKNOWN
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1 Test 7: Input without timestamp -> UNKNOWN', () => {
  it('should classify as UNKNOWN when input lacks source_timestamp', () => {
    const inputs = makeSampleInputs(null); // No odds timestamp
    const result = classifyAIProvenance(inputs, NOW_TS);
    expect(result.provenance).toBe('UNKNOWN');
    expect(result.risk_flags.some(f => f.includes('UNKNOWN'))).toBe(true);
  });

  it('should classify as UNKNOWN when some inputs lack timestamps', () => {
    const inputs = makeSampleInputs(PAST_TS);
    // Remove standings timestamp
    inputs.standings_home = { ...inputs.standings_home!, source_timestamp: null };
    const result = classifyAIProvenance(inputs, NOW_TS);
    expect(result.provenance).toBe('UNKNOWN');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADDITIONAL: AI Provider Configuration
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1: AI Provider Configuration', () => {
  it('should have correct AI provider settings', () => {
    expect(AI_PROVIDER).toBe('groq');
    expect(AI_MODEL_DEFAULT).toBe('llama-3.3-70b-versatile');
    expect(AI_PROMPT_VERSION).toBe('7.0');
    expect(AI_TEMPERATURE).toBe(0.3);
  });

  it('should verify AI_WEIGHT has not been modified', () => {
    const config = getConfig();
    expect(config.AI_WEIGHT).toBe(0.35);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADDITIONAL: Prediction Timeline
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1: Prediction Timeline (Section 7-8)', () => {
  it('should compute valid timeline with AI', () => {
    const timeline = computePredictionTimeline({
      t_start: new Date(Date.now() - 5000).toISOString(),
      t_features: new Date(Date.now() - 4000).toISOString(),
      t_ai_request: new Date(Date.now() - 3000).toISOString(),
      t_ai_response: new Date(Date.now() - 1000).toISOString(),
      t_prediction_final: new Date(Date.now() - 500).toISOString(),
      t_snapshot: new Date().toISOString(),
    });

    expect(timeline.invariants.t_start_leq_t_features).toBe(true);
    expect(timeline.invariants.t_features_leq_t_ai_request).toBe(true);
    expect(timeline.invariants.t_ai_request_leq_t_ai_response).toBe(true);
    expect(timeline.invariants.t_ai_response_leq_t_prediction_final).toBe(true);
    expect(timeline.invariants.t_prediction_final_leq_t_snapshot).toBe(true);
    expect(timeline.invariants.all_inputs_before_t_prediction).toBe(true);
  });

  it('should compute valid timeline without AI', () => {
    const timeline = computePredictionTimeline({
      t_start: new Date(Date.now() - 2000).toISOString(),
      t_features: new Date(Date.now() - 1000).toISOString(),
      t_prediction_final: new Date(Date.now() - 500).toISOString(),
    });

    expect(timeline.t_ai_request).toBeNull();
    expect(timeline.t_ai_response).toBeNull();
    expect(timeline.invariants.t_start_leq_t_features).toBe(true);
    expect(timeline.invariants.t_features_leq_t_ai_request).toBeNull();
  });

  it('should detect invariant violation when features come after AI request', () => {
    const timeline = computePredictionTimeline({
      t_start: new Date(Date.now() - 5000).toISOString(),
      t_features: new Date(Date.now() - 2000).toISOString(),
      t_ai_request: new Date(Date.now() - 3000).toISOString(), // Before features!
    });

    expect(timeline.invariants.t_features_leq_t_ai_request).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADDITIONAL: AI Input Audit Table (Section 1)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1: AI Input Audit Table', () => {
  it('should build complete audit table', () => {
    const inputs = makeSampleInputs();
    const table = buildAIInputAuditTable(inputs, NOW_TS);
    expect(table.length).toBeGreaterThanOrEqual(6); // At least odds
  });

  it('should identify all inputs available before prediction', () => {
    const inputs = makeSampleInputs(PAST_TS);
    const table = buildAIInputAuditTable(inputs, NOW_TS);
    const allAvailable = table.every(row => row.available_before_prediction === true);
    expect(allAvailable).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADDITIONAL: AI Trace Record Creation
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1: AI Trace Record', () => {
  it('should create complete trace record', () => {
    const inputs = makeSampleInputs();
    const trace = createAITraceRecord({
      systemPrompt: SYSTEM_PROMPT_V7,
      userPrompt: 'M1: TeamA vs TeamB | 1.85/3.40/4.20',
      inputs,
      model: AI_MODEL_DEFAULT,
      requestTimestamp: NOW_TS,
      responseTimestamp: NOW_TS,
      responseContent: '{"predictions":[{"scoreHome":1,"scoreAway":0}]}',
      predictionUsed: { score_home: 1, score_away: 0, confidence: 0.72 },
      predictionTimestamp: NOW_TS,
    });

    expect(trace.ai_provider).toBe('groq');
    expect(trace.ai_model).toBe('llama-3.3-70b-versatile');
    expect(trace.ai_prompt_version).toBe('7.0');
    expect(trace.ai_system_prompt_hash).toBeTruthy();
    expect(trace.ai_user_prompt_hash).toBeTruthy();
    expect(trace.ai_prompt_hash).toBeTruthy();
    expect(trace.ai_input_hash).toBeTruthy();
    expect(trace.ai_response_hash).toBeTruthy();
    expect(trace.ai_response_stored).toBe(false); // Full response NOT stored
    expect(trace.ai_prediction_used.score_home).toBe(1);
    expect(trace.ai_provenance_risk_flags.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADDITIONAL: buildAIInputsFromMatch
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.1: buildAIInputsFromMatch', () => {
  it('should build AI inputs from match data', () => {
    const inputs = buildAIInputsFromMatch({
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
      ],
      recentAway: [
        { result: 'D', scoreHome: 0, scoreAway: 1 },
      ],
      headToHead: [
        { scoreHome: 2, scoreAway: 1 },
        { scoreHome: 1, scoreAway: 1 },
      ],
      oddsTimestamp: PAST_TS,
      rankingTimestamp: PAST_TS,
      formTimestamp: PAST_TS,
      h2hTimestamp: PAST_TS,
    });

    expect(inputs.odds.home.value).toBe(1.85);
    expect(inputs.standings_home).not.toBeNull();
    expect(inputs.standings_away).not.toBeNull();
    expect(inputs.form_home).not.toBeNull();
    expect(inputs.form_away).not.toBeNull();
    expect(inputs.h2h).not.toBeNull();
  });
});
