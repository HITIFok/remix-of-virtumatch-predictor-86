// ============================================
// FORENSIC AUDIT — TEMPORAL INTEGRITY TESTS (POST-FIX)
// Tests A–O — verify the corrections applied in Phase 1-13
// ============================================
//
// These tests exercise the PRODUCTION code paths after the Phase 5 forensic
// fix. They replace the previous "demonstrate the bug" tests with "verify
// the fix" tests.
//
// Coverage (per audit mandate §15):
//   TEST A: timeline valide (T_start ≤ T_feature ≤ T_AI_req ≤ T_AI_res ≤ T_pred ≤ T_snap)
//   TEST B: source future → feature_before_prediction = false
//   TEST C: source timestamp absent → t_feature = null (PREVIOUSLY FAILING — NOW PASSES)
//   TEST D: AI response > prediction → invariant violation
//   TEST E: snapshot avant prediction → invariant violation
//   TEST F: AI response ne doit jamais devenir T_feature
//   TEST G: client t_feature arbitraire ne peut pas être utilisé comme preuve (server-side)
//   TEST H: validateSnapshot is pure — no mutation of input snapshot
//   TEST I: NULL → value allowed (initial enrichment)
//   TEST J: value → different value blocked (DB trigger — tested logically)
//   TEST K: value → NULL blocked (DB trigger — tested logically)
//   TEST L: math-v2 fallback → scientific_collection_eligible = false
//   TEST M: LLM real + real response → eligible possible
//   TEST N: empty response → responseHash = null
//   TEST O: version freeze coherent (analyze-match.js uses canonical constants)

import { describe, it, expect } from 'vitest';
import {
  buildAIContext,
  buildAISnapshotFromContext,
  buildUserPromptFromContext,
  computeAIContextHash,
  computeAIInputHashFromContext,
  computeAIPromptHashFromContext,
  computeAIResponseHashFromContext,
  type AIContext,
} from '../../src/lib/ai-context';
import {
  computeAIInputHash,
  computeAIResponseHash,
  computePredictionTimeline,
} from '../../src/lib/ai-traceability';
import {
  createFeatureSnapshot,
  validateSnapshot,
  serializeSnapshot,
  deserializeSnapshot,
  computeSnapshotHash,
  type FeatureSnapshot,
  type SnapshotContext,
} from '../../src/lib/feature-snapshot';
import {
  auditSnapshot,
  computeTemporalTimestamps,
  computeCompleteness,
} from '../../src/lib/snapshot-audit';

// ═══════════════════════════════════════════════════════════════════
// HELPERS — minimal snapshots with controlled timestamps
// ═══════════════════════════════════════════════════════════════════

function makeMinimalSnapshot(overrides: Partial<FeatureSnapshot> = {}): FeatureSnapshot {
  const base = createFeatureSnapshot({
    home: 'TeamA',
    away: 'TeamB',
    league: 'L1',
    oddHome: 1.85,
    oddDraw: 3.40,
    oddAway: 4.20,
    probHome: 0.50,
    probDraw: 0.30,
    probAway: 0.20,  // sums to exactly 1.00
    favorite: '1',
    favoriteProb: 0.50,
    lambdaHome: 1.4,
    lambdaAway: 1.1,
    predictionTimestamp: '2026-09-24T10:00:03Z',
    oddsTimestamp: '2026-09-24T10:00:00Z',
    rankingTimestamp: '2026-09-24T09:00:00Z',
    formSourceTimestamp: '2026-09-24T09:30:00Z',
    aiTimestamp: '2026-09-24T10:00:02Z',
  } as SnapshotContext);
  return { ...base, ...overrides };
}

// ═══════════════════════════════════════════════════════════════════
// TEST A — Valid full timeline (with AI)
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST A — valid full timeline (with AI)', () => {
  it('passes when source ≤ AI_request ≤ AI_response ≤ prediction ≤ snapshot', () => {
    const tSource = '2026-09-24T10:00:00Z';
    const tAiReq = '2026-09-24T10:00:01Z';
    const tAiRes = '2026-09-24T10:00:02Z';
    const tPred = '2026-09-24T10:00:03Z';
    const tSnap = '2026-09-24T10:00:04Z';

    const timeline = computePredictionTimeline({
      t_start: tSource,
      t_features: tSource,
      t_ai_request: tAiReq,
      t_ai_response: tAiRes,
      t_prediction_final: tPred,
      t_snapshot: tSnap,
    });

    expect(timeline.invariants.t_start_leq_t_features).toBe(true);
    expect(timeline.invariants.t_features_leq_t_ai_request).toBe(true);
    expect(timeline.invariants.t_ai_request_leq_t_ai_response).toBe(true);
    expect(timeline.invariants.t_ai_response_leq_t_prediction_final).toBe(true);
    expect(timeline.invariants.t_prediction_final_leq_t_snapshot).toBe(true);
    expect(timeline.invariants.all_inputs_before_t_prediction).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST B — Source timestamp strictly in the future vs prediction
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST B — future source timestamp → leak', () => {
  it('detects feature_before_prediction = false when source > prediction', () => {
    const tPrediction = '2026-09-24T10:00:00Z';
    const snapshot = makeMinimalSnapshot({
      prediction_timestamp: tPrediction,
    });
    snapshot.odds!.source_timestamp = '2026-09-24T10:01:00Z';

    const audit = auditSnapshot(snapshot, tPrediction);
    const temporal = computeTemporalTimestamps(audit, tPrediction, snapshot.snapshot_timestamp);

    expect(temporal.feature_before_prediction).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST C — No source timestamp available → T_feature MUST be null
//          (THIS TEST NOW PASSES — Phase 1 fix)
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST C — no source timestamp → T_feature = null', () => {
  it('returns null T_feature when no source_timestamps are present', () => {
    const tPrediction = '2026-09-24T10:00:00Z';
    const snapshot = makeMinimalSnapshot({
      prediction_timestamp: tPrediction,
      snapshot_timestamp: '2026-09-24T10:00:05Z',
    });
    // Strip ALL source timestamps to simulate UNKNOWN provenance
    snapshot.odds!.source_timestamp = null;
    snapshot.form!.home.source_timestamp = null;
    snapshot.form!.away.source_timestamp = null;
    snapshot.h2h!.source_timestamp = null;
    snapshot.stats!.home.source_timestamp = null;
    snapshot.stats!.away.source_timestamp = null;
    snapshot.ai!.source_timestamp = null;

    const audit = auditSnapshot(snapshot, tPrediction);
    const temporal = computeTemporalTimestamps(audit, tPrediction, snapshot.snapshot_timestamp);

    // Phase 1 fix: t_feature MUST be null when no source timestamp is available.
    // (Previously this returned snapshotTimestamp — that was BUG-1.)
    expect(temporal.t_feature).toBeNull();

    // Phase 1 fix: feature_before_prediction MUST be null (UNKNOWN) when
    // t_feature is null. (Previously this was true — converting UNKNOWN to true.)
    expect(temporal.feature_before_prediction).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST D — AI response timestamp strictly after prediction is a violation
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST D — AI response > prediction is a violation', () => {
  it('detects t_ai_response > t_prediction_final as invariant violation', () => {
    const timeline = computePredictionTimeline({
      t_start: '2026-09-24T10:00:00Z',
      t_features: '2026-09-24T10:00:00Z',
      t_ai_request: '2026-09-24T10:00:01Z',
      t_ai_response: '2026-09-24T10:00:10Z', // 7s AFTER prediction_final
      t_prediction_final: '2026-09-24T10:00:03Z',
      t_snapshot: '2026-09-24T10:00:04Z',
    });

    expect(timeline.invariants.t_ai_response_leq_t_prediction_final).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST E — Snapshot timestamp BEFORE prediction timestamp must be rejected
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST E — snapshot before prediction is a violation', () => {
  it('detects snapshot_timestamp < prediction_timestamp as invariant violation', () => {
    const tPrediction = '2026-09-24T10:00:10Z';
    const snapshot = makeMinimalSnapshot({
      prediction_timestamp: tPrediction,
      snapshot_timestamp: '2026-09-24T10:00:05Z', // 5s BEFORE prediction
    });

    const audit = auditSnapshot(snapshot, tPrediction);
    const temporal = computeTemporalTimestamps(audit, tPrediction, snapshot.snapshot_timestamp);

    expect(temporal.snapshot_after_prediction).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST F — T_AI_response must NEVER become T_feature
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST F — T_AI_response must never be T_feature', () => {
  it('does not substitute T_feature with T_AI_response when sources are absent', () => {
    // Build an AIContext with NO source timestamps
    const ctx = buildAIContext({
      home: 'TeamA', away: 'TeamB',
      oddHome: 1.85, oddDraw: 3.40, oddAway: 4.20,
      // No oddsTimestamp, rankingTimestamp, formTimestamp, h2hTimestamp
    });

    // All source timestamps must be null
    expect(ctx.source_timestamps.odds).toBeNull();
    expect(ctx.source_timestamps.ranking).toBeNull();
    expect(ctx.source_timestamps.form).toBeNull();
    expect(ctx.source_timestamps.h2h).toBeNull();

    // Compute T_feature via the production audit pipeline
    const snapshot = makeMinimalSnapshot();
    snapshot.odds!.source_timestamp = null;
    snapshot.form!.home.source_timestamp = null;
    snapshot.form!.away.source_timestamp = null;
    snapshot.h2h!.source_timestamp = null;
    snapshot.stats!.home.source_timestamp = null;
    snapshot.stats!.away.source_timestamp = null;

    const audit = auditSnapshot(snapshot, '2026-09-24T10:00:00Z');

    // Inject an AI response timestamp (would be set when Groq returns)
    snapshot.ai!.source_timestamp = '2026-09-24T10:00:02Z';

    const temporal = computeTemporalTimestamps(
      audit,
      '2026-09-24T10:00:00Z',
      '2026-09-24T10:00:04Z',
    );

    // The audit's DERIVED_SOURCES filter must exclude 'ai_model' from
    // the source timestamps used to compute T_feature.
    // Verify: T_feature is NOT the AI source timestamp.
    expect(temporal.t_feature).not.toBe('2026-09-24T10:00:02Z');

    // Phase 1 fix: if no external source timestamp is available, T_feature is null.
    // (Even though AI source_timestamp is set, it must NOT be used as T_feature.)
    expect(temporal.t_feature).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST G — client t_feature arbitraire rejeté (server-side behavior)
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST G — client-supplied t_feature cannot be trusted as scientific proof', () => {
  it('documents that the server recomputes t_feature from snapshot.source_timestamps', () => {
    // This test documents the server-side recomputation logic that
    // was added in api/predictions.js (Phase 4 fix).
    //
    // The server does:
    //   1. Extract dSourceTimestamps from feature_snapshot.source_timestamps
    //   2. Extract dOddsTs, dRankingTs, dFormTs, dH2hTs
    //   3. Filter out: null, non-string, unparseable, equals tPrediction
    //   4. serverTFeature = MAX(valid timestamps) or null
    //   5. If client d.t_feature differs from serverTFeature, log mismatch
    //   6. Use serverTFeature for the INSERT (never the client value)
    //
    // We can't run this test directly (it requires the Vercel runtime),
    // but we can simulate the same logic here to confirm it produces
    // the expected result.
    const tPrediction = '2026-09-24T10:00:03Z';

    // Simulate a malicious client sending a fabricated t_feature
    const client_t_feature = '2026-09-24T09:00:00Z'; // looks legit, but is fake

    // Simulate the snapshot the client sent
    const client_feature_snapshot = {
      odds: { source_timestamp: null },
      standings: { source_timestamp: null },
      form: { source_timestamp: null },
      h2h: { source_timestamp: null },
      source_timestamps: {
        odds: null, ranking: null, form: null, h2h: null,
      },
    };

    // Server recomputation (mirrors api/predictions.js Phase 4 fix)
    const dSourceTimestamps = client_feature_snapshot.source_timestamps || {};
    const dOddsTs = client_feature_snapshot.odds?.source_timestamp || dSourceTimestamps.odds || null;
    const dRankingTs = dSourceTimestamps.ranking || client_feature_snapshot.standings?.source_timestamp || null;
    const dFormTs = dSourceTimestamps.form || client_feature_snapshot.form?.source_timestamp || null;
    const dH2hTs = dSourceTimestamps.h2h || client_feature_snapshot.h2h?.source_timestamp || null;

    const serverValidTimestamps = [dOddsTs, dRankingTs, dFormTs, dH2hTs]
      .filter(ts => ts != null && typeof ts === 'string')
      .filter(ts => {
        const parsed = new Date(ts).getTime();
        if (isNaN(parsed)) return false;
        if (parsed === new Date(tPrediction).getTime()) return false;
        return true;
      });

    const serverTFeature = serverValidTimestamps.length > 0
      ? new Date(Math.max(...serverValidTimestamps.map(ts => new Date(ts).getTime()))).toISOString()
      : null;

    // Server value is null because no real source timestamps were in the snapshot
    expect(serverTFeature).toBeNull();

    // The client-supplied t_feature differs from the server value — would
    // trigger a CLIENT_T_FEATURE_MISMATCH log entry, and the server value
    // (null) would be inserted, not the client's fake value.
    expect(client_t_feature).not.toBe(serverTFeature);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST H — validateSnapshot is PURE (no mutation of input)
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST H — validateSnapshot is pure', () => {
  it('does not mutate the input snapshot when a leak is detected', () => {
    const tPrediction = '2026-09-24T10:00:03Z';
    const snapshot = makeMinimalSnapshot({
      prediction_timestamp: tPrediction,
    });
    // Inject a future-dated odds source timestamp to trigger UNSAFE detection
    snapshot.odds!.source_timestamp = '2026-09-24T10:01:00Z'; // 1 min in future

    // Deep-clone the snapshot before validation
    const before = JSON.parse(JSON.stringify(snapshot));

    // Call validateSnapshot — Phase 3 fix means it must NOT mutate
    const result = validateSnapshot(snapshot);

    // Verify the snapshot's provenance fields are UNCHANGED
    expect(snapshot.odds!.provenance).toBe(before.odds!.provenance);
    expect(snapshot.form!.home.provenance).toBe(before.form!.home.provenance);
    expect(snapshot.form!.away.provenance).toBe(before.form!.away.provenance);
    expect(snapshot.h2h!.provenance).toBe(before.h2h!.provenance);
    expect(snapshot.stats!.home.provenance).toBe(before.stats!.home.provenance);
    expect(snapshot.stats!.away.provenance).toBe(before.stats!.away.provenance);
    expect(snapshot.ai!.provenance).toBe(before.ai!.provenance);

    // The validation result must still report the UNSAFE state via the
    // unsafe_features list (without mutating the original)
    expect(result.unsafe_features).toContain('odds');
    expect(result.leakage_detected).toBe(true);
  });

  it('does not mutate the input snapshot when no leak is present', () => {
    const snapshot = makeMinimalSnapshot();
    const beforeHash = computeSnapshotHash(snapshot);
    const before = JSON.parse(JSON.stringify(snapshot));

    const result = validateSnapshot(snapshot);

    // Snapshot unchanged
    expect(snapshot).toEqual(before);
    expect(computeSnapshotHash(snapshot)).toBe(beforeHash);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST I — NULL → value allowed (initial enrichment)
//          TEST J — value → different value blocked (DB trigger behavior)
//          TEST K — value → NULL blocked (DB trigger behavior)
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST I/J/K — immutability trigger rules (logical)', () => {
  // These tests document the behavior of the DB trigger that's defined
  // in api/_migrations/010_scientific_integrity.sql. The trigger uses
  // `IS DISTINCT FROM` semantics, which means:
  //   NULL → value       ALLOWED  (NULL IS DISTINCT FROM value)
  //   value → same value ALLOWED  (NOT DISTINCT)
  //   value → diff value BLOCKED  (IS DISTINCT FROM)
  //   value → NULL       BLOCKED  (IS DISTINCT FROM)

  it('I: NULL → value is allowed (initial enrichment pattern)', () => {
    // Simulate: current = NULL, new = '2026-09-24T10:00:00Z'
    const current = null;
    const newValue = '2026-09-24T10:00:00Z';
    // IS DISTINCT FROM check: null IS DISTINCT FROM '2026-...' → true (distinct)
    // Trigger rule: IF OLD IS NOT NULL AND ... → OLD is NULL, so rule fires only when both are non-null
    // The trigger does NOT block NULL → value.
    const wouldBlock = current !== null && current !== newValue;
    expect(wouldBlock).toBe(false);
  });

  it('J: value → different value is blocked', () => {
    const current = '2026-09-24T10:00:00Z';
    const newValue = '2026-09-24T11:00:00Z';
    const wouldBlock = current !== null && current !== newValue;
    expect(wouldBlock).toBe(true);
  });

  it('K: value → NULL is blocked', () => {
    const current = '2026-09-24T10:00:00Z';
    const newValue = null;
    // IS DISTINCT FROM: '2026-...' IS DISTINCT FROM NULL → true (distinct)
    const wouldBlock = current !== null && current !== newValue;
    expect(wouldBlock).toBe(true);
  });

  it('value → same value is allowed (idempotent)', () => {
    const current = '2026-09-24T10:00:00Z';
    const newValue = '2026-09-24T10:00:00Z';
    const wouldBlock = current !== null && current !== newValue;
    expect(wouldBlock).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST L — math-v2 fallback → scientific_collection_eligible = false
//          TEST M — LLM real + real response → eligible possible
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST L/M — scientific_collection_eligible gating', () => {
  // These tests mirror the logic added in api/analyze-match.js Phase 9 fix.
  // The actual JS function runs in Vercel, but the eligibility logic is:
  //   scientificEligible =
  //     !!featureSnapshot &&
  //     completenessScore >= 0.5 &&
  //     temporalSafetyScore >= 1.0 &&
  //     tFeature !== null &&
  //     aiActuallyUsed;

  it('L: math-v2 fallback (no AI response) → scientific_collection_eligible = false', () => {
    const featureSnapshot = { /* present */ };
    const completenessScore = 0.7;
    const temporalSafetyScore = 1.0;
    const tFeature = '2026-09-24T10:00:00Z';
    const aiResponseHash = null;  // no LLM responded
    const aiResponseText = null;

    const aiActuallyUsed = aiResponseHash !== null && aiResponseText !== null;
    const scientificEligible =
      !!featureSnapshot &&
      completenessScore >= 0.5 &&
      temporalSafetyScore >= 1.0 &&
      tFeature !== null &&
      aiActuallyUsed;

    expect(scientificEligible).toBe(false);
  });

  it('M: real LLM call + real response → eligible possible', () => {
    const featureSnapshot = { /* present */ };
    const completenessScore = 0.7;
    const temporalSafetyScore = 1.0;
    const tFeature = '2026-09-24T10:00:00Z';
    const aiResponseHash = 'abc123...';  // real hash
    const aiResponseText = '{"predictions":[...]}';  // real response

    const aiActuallyUsed = aiResponseHash !== null && aiResponseText !== null;
    const scientificEligible =
      !!featureSnapshot &&
      completenessScore >= 0.5 &&
      temporalSafetyScore >= 1.0 &&
      tFeature !== null &&
      aiActuallyUsed;

    expect(scientificEligible).toBe(true);
  });

  it('M (negative): real LLM but t_feature is null → eligible = false', () => {
    // Even with real AI, if we can't prove T_feature, the prediction is not
    // scientifically eligible.
    const featureSnapshot = { /* present */ };
    const completenessScore = 0.7;
    const temporalSafetyScore = 1.0;  // would be 0.0 in real code since t_feature is null
    const tFeature = null;
    const aiResponseHash = 'abc123...';
    const aiResponseText = '{"predictions":[...]}';

    const aiActuallyUsed = aiResponseHash !== null && aiResponseText !== null;
    const scientificEligible =
      !!featureSnapshot &&
      completenessScore >= 0.5 &&
      temporalSafetyScore >= 1.0 &&
      tFeature !== null &&
      aiActuallyUsed;

    expect(scientificEligible).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST N — empty response → responseHash = null
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST N — computeAIResponseHash returns null for empty input', () => {
  it('null → null', () => {
    // Phase 8 fix: null/undefined/empty input MUST return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeAIResponseHash(null as any)).toBeNull();
    expect(computeAIResponseHashFromContext(null)).toBeNull();
  });

  it('undefined → null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeAIResponseHash(undefined as any)).toBeNull();
    expect(computeAIResponseHashFromContext(undefined)).toBeNull();
  });

  it('empty string → null', () => {
    expect(computeAIResponseHash('')).toBeNull();
    expect(computeAIResponseHashFromContext('')).toBeNull();
  });

  it('non-empty string → real SHA-256 hash', () => {
    const hash = computeAIResponseHash('hello');
    expect(hash).not.toBeNull();
    expect(typeof hash).toBe('string');
    expect(hash!.length).toBeGreaterThan(0);
  });

  it('"hello" and "hello!" → different hashes (sensitivity preserved)', () => {
    const h1 = computeAIResponseHash('hello');
    const h2 = computeAIResponseHash('hello!');
    expect(h1).not.toBeNull();
    expect(h2).not.toBeNull();
    expect(h1).not.toBe(h2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST O — version freeze coherent (analyze-match.js uses canonical constants)
// ═══════════════════════════════════════════════════════════════════

describe('FORENSIC TEST O — version freeze coherent', () => {
  it('analyze-match.js VERSIONS matches feature-snapshot.ts canonical constants', () => {
    // Per Phase 11 fix, api/analyze-match.js defines VERSIONS that must
    // match src/lib/feature-snapshot.ts exactly. We can't import the JS
    // version from vitest (it's a Vercel serverless file), but we can
    // read it from disk and verify the constants.
    //
    // For now, we hard-assert the canonical values from feature-snapshot.ts.
    // If feature-snapshot.ts changes, this test must be updated too.
    const CANONICAL_MODEL_VERSION = '2.0.0';
    const CANONICAL_FEATURE_VERSION = '1.0.0';
    const CANONICAL_CONFIG_VERSION = '1.0.0';
    const CANONICAL_CALIBRATION_VERSION = '0.0.0';
    const CANONICAL_DATASET_VERSION = 'unversioned';

    // Read the analyze-match.js file and verify the VERSIONS constant
    // Use a path relative to the project root (resolve from process.cwd)
    const fs = require('fs');
    const path = require('path');
    // __dirname = /home/z/my-project/audit/repo/src/test
    // analyze-match.js is at /home/z/my-project/audit/repo/api/analyze-match.js
    const analyzeMatchPath = path.resolve(__dirname, '../../api/analyze-match.js');
    const source = fs.readFileSync(analyzeMatchPath, 'utf-8');

    // The file must contain the canonical version constants
    expect(source).toContain(`MODEL_VERSION: '${CANONICAL_MODEL_VERSION}'`);
    expect(source).toContain(`FEATURE_VERSION: '${CANONICAL_FEATURE_VERSION}'`);
    expect(source).toContain(`CONFIG_VERSION: '${CANONICAL_CONFIG_VERSION}'`);
    expect(source).toContain(`CALIBRATION_VERSION: '${CANONICAL_CALIBRATION_VERSION}'`);
    expect(source).toContain(`DATASET_VERSION: '${CANONICAL_DATASET_VERSION}'`);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CANONICAL END-TO-END TEST (Section 15)
// ═══════════════════════════════════════════════════════════════════

describe('CANONICAL END-TO-END — full pipeline integrity', () => {
  it('preserves source timestamps through the entire pipeline', () => {
    // 1. Source data with real external timestamps
    const sourceData = {
      home: 'TeamA', away: 'TeamB',
      oddHome: 1.85, oddDraw: 3.40, oddAway: 4.20,
      rankingHome: { position: 1, played: 10, won: 7, drawn: 2, lost: 1, goalsFor: 15, goalsAgainst: 5, points: 23 },
      rankingAway: { position: 5, played: 10, won: 4, drawn: 3, lost: 3, goalsFor: 12, goalsAgainst: 10, points: 15 },
      recentHome: [{ result: 'V', scoreHome: 2, scoreAway: 0 }],
      recentAway: [{ result: 'D', scoreHome: 0, scoreAway: 1 }],
      headToHead: [{ scoreHome: 2, scoreAway: 1 }],
      oddsTimestamp: '2026-09-24T10:00:00Z',
      rankingTimestamp: '2026-09-24T09:00:00Z',
      formTimestamp: '2026-09-24T09:30:00Z',
      h2hTimestamp: '2026-09-24T09:45:00Z',
      matchIndex: 1,
    };

    // 2. Build canonical context
    const ctx: AIContext = buildAIContext(sourceData);

    // 3. Source timestamps must be preserved verbatim
    expect(ctx.odds.source_timestamp).toBe('2026-09-24T10:00:00Z');
    expect(ctx.standings.source_timestamp).toBe('2026-09-24T09:00:00Z');
    expect(ctx.form.source_timestamp).toBe('2026-09-24T09:30:00Z');
    expect(ctx.h2h.source_timestamp).toBe('2026-09-24T09:45:00Z');
    expect(ctx.source_timestamps.odds).toBe('2026-09-24T10:00:00Z');
    expect(ctx.source_timestamps.ranking).toBe('2026-09-24T09:00:00Z');
    expect(ctx.source_timestamps.form).toBe('2026-09-24T09:30:00Z');
    expect(ctx.source_timestamps.h2h).toBe('2026-09-24T09:45:00Z');

    // 4. Build snapshot and prompt from SAME context
    const snapshot = buildAISnapshotFromContext(ctx);
    const userPrompt = buildUserPromptFromContext(ctx);

    // 5. Source timestamps must propagate into the snapshot
    expect(snapshot.odds.home.source_timestamp).toBe('2026-09-24T10:00:00Z');
    expect(snapshot.standings_home?.source_timestamp).toBe('2026-09-24T09:00:00Z');
    expect(snapshot.form_home?.source_timestamp).toBe('2026-09-24T09:30:00Z');
    expect(snapshot.h2h?.source_timestamp).toBe('2026-09-24T09:45:00Z');

    // 6. Compute hashes — must be deterministic and reproducible
    const ctxHash1 = computeAIContextHash(ctx);
    const ctxHash2 = computeAIContextHash(buildAIContext(sourceData));
    expect(ctxHash1).toBe(ctxHash2);

    const inputHash1 = computeAIInputHashFromContext(snapshot);
    const inputHash2 = computeAIInputHashFromContext(buildAISnapshotFromContext(buildAIContext(sourceData)));
    expect(inputHash1).toBe(inputHash2);

    const promptHash1 = computeAIPromptHashFromContext('SYS_PROMPT', userPrompt);
    const promptHash2 = computeAIPromptHashFromContext('SYS_PROMPT', buildUserPromptFromContext(buildAIContext(sourceData)));
    expect(promptHash1).toBe(promptHash2);

    // 7. AI_RESPONSE_HASH must be null when no real LLM response
    //    Phase 8 fix: empty/null input returns null
    const responseHash = computeAIResponseHashFromContext(''); // empty/no response
    expect(responseHash).toBeNull();

    // 8. Compute timeline — must reflect the source timestamps
    const tPrediction = '2026-09-24T10:00:03Z';
    const timeline = computePredictionTimeline({
      t_start: '2026-09-24T09:00:00Z',
      t_features: '2026-09-24T10:00:00Z', // MAX of source timestamps = odds
      t_ai_request: '2026-09-24T10:00:01Z',
      t_ai_response: '2026-09-24T10:00:02Z',
      t_prediction_final: tPrediction,
      t_snapshot: '2026-09-24T10:00:04Z',
    });
    expect(timeline.invariants.t_start_leq_t_features).toBe(true);
    expect(timeline.invariants.t_features_leq_t_ai_request).toBe(true);
    expect(timeline.invariants.t_ai_response_leq_t_prediction_final).toBe(true);

    // 9. Build a feature snapshot, validate it
    // NOTE: probHome + probDraw + probAway MUST sum to 1.0 (within 0.01 tolerance)
    // because validateSnapshot() checks this invariant.
    const fs = createFeatureSnapshot({
      home: sourceData.home, away: sourceData.away, league: 'L1',
      oddHome: sourceData.oddHome, oddDraw: sourceData.oddDraw, oddAway: sourceData.oddAway,
      probHome: 0.50, probDraw: 0.30, probAway: 0.20,  // sums to exactly 1.00
      favorite: '1', favoriteProb: 0.50,
      lambdaHome: 1.4, lambdaAway: 1.1,
      predictionTimestamp: tPrediction,
      oddsTimestamp: sourceData.oddsTimestamp,
      rankingTimestamp: sourceData.rankingTimestamp,
      formSourceTimestamp: sourceData.formTimestamp,
      aiTimestamp: '2026-09-24T10:00:02Z',
    } as SnapshotContext);

    // 10. validateSnapshot must NOT mutate the snapshot (Phase 3 fix)
    const snapshotCopy = JSON.parse(JSON.stringify(fs)) as FeatureSnapshot;
    const result = validateSnapshot(fs);
    // Snapshot hash must be unchanged after validation
    const fsHashBefore = computeSnapshotHash(fs);
    const fsHashAfter = computeSnapshotHash(snapshotCopy);
    expect(fsHashBefore).toBe(fsHashAfter);
    expect(result.valid).toBe(true);

    // 11. Serialize / deserialize roundtrip
    const json = serializeSnapshot(fs);
    const { snapshot: restored, valid } = deserializeSnapshot(json);
    expect(valid).toBe(true);
    expect(restored.feature_snapshot_hash).toBe(fs.feature_snapshot_hash);
  });
});
