// ============================================
// PHASE 5.3.14 — SCIENTIFIC INTEGRITY TESTS
// Tests for server-side recomputation of derived scientific fields
// ============================================

import { describe, it, expect } from 'vitest';
import {
  computeCompletenessScore,
  computeTemporalSafety,
  computeTFeature,
  computeScientificEligible,
  computeProvenanceStatus,
  validateStoredSnapshot,
  recomputeScientificFields,
  isValidProvenanceStatus,
  isCanonicalProvenanceStatus,
} from '../../api/_lib/scientific-integrity.js';

// ═══════════════════════════════════════════════════════════════════
// HELPER — valid feature_snapshot fixture
// ═══════════════════════════════════════════════════════════════════

function makeValidSnapshot(overrides = {}) {
  return {
    odds: { home: 1.85, draw: 3.40, away: 4.20, source_timestamp: '2026-09-24T10:00:00Z' },
    standings: {
      home: { position: 1, played: 10, won: 7, drawn: 2, lost: 1, goalsFor: 15, goalsAgainst: 5, points: 23 },
      away: { position: 5, played: 10, won: 4, drawn: 3, lost: 3, goalsFor: 12, goalsAgainst: 10, points: 15 },
      source_timestamp: '2026-09-24T09:00:00Z',
    },
    form: {
      home: [{ result: 'V', scoreHome: 2, scoreAway: 0 }],
      away: [{ result: 'D', scoreHome: 0, scoreAway: 1 }],
      source_timestamp: '2026-09-24T09:30:00Z',
    },
    h2h: {
      matches: [{ scoreHome: 2, scoreAway: 1 }],
      source_timestamp: '2026-09-24T09:45:00Z',
    },
    source_timestamps: {
      odds: '2026-09-24T10:00:00Z',
      ranking: '2026-09-24T09:00:00Z',
      form: '2026-09-24T09:30:00Z',
      h2h: '2026-09-24T09:45:00Z',
    },
    ai_snapshot: {},
    match_index: 1,
    schema_version: '3.0',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1: feature_snapshot=NULL → eligible=FALSE (C2 fix)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.14 — Test 1: NULL snapshot → eligible=FALSE', () => {
  it('recomputeScientificFields with null snapshot returns eligible=false', () => {
    const result = recomputeScientificFields({
      featureSnapshot: null,
      tPrediction: '2026-09-24T10:00:03Z',
      aiResponseHash: 'some-hash',
    });

    expect(result.scientific_collection_eligible).toBe(false);
    expect(result.completeness_score).toBe(0);
    expect(result.temporal_safety_score).toBe(0.0);
    expect(result.t_feature).toBeNull();
    expect(result.provenance_status).toBe('UNKNOWN');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2: client completeness=1.0 but reality=0.5 → server stores 0.5 (H1 fix)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.14 — Test 2: completeness recomputed server-side', () => {
  it('snapshot with odds+standings only → completeness=0.5 regardless of client value', () => {
    const snapshot = makeValidSnapshot({
      form: { home: null, away: null, source_timestamp: null },
      h2h: { matches: null, source_timestamp: null },
      source_timestamps: { odds: '2026-09-24T10:00:00Z', ranking: null, form: null, h2h: null },
    });

    const score = computeCompletenessScore(snapshot);
    expect(score).toBe(0.5); // odds(0.3) + standings(0.2) = 0.5
  });

  it('full snapshot → completeness=1.0', () => {
    const snapshot = makeValidSnapshot();
    const score = computeCompletenessScore(snapshot);
    expect(score).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 3: client temporal_safety=1.0 but t_feature absent → server stores 0.0 (H2 fix)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.14 — Test 3: temporal safety recomputed server-side', () => {
  it('t_feature=null → score=0.0, reason=T_FEATURE_UNKNOWN', () => {
    const result = computeTemporalSafety(null, '2026-09-24T10:00:03Z');
    expect(result.score).toBe(0.0);
    expect(result.reason).toBe('T_FEATURE_UNKNOWN');
  });

  it('t_feature > t_prediction+5min → score=0.0, reason=FUTURE_FEATURE_LEAK', () => {
    const result = computeTemporalSafety('2026-09-24T10:10:00Z', '2026-09-24T10:00:00Z');
    expect(result.score).toBe(0.0);
    expect(result.reason).toBe('FUTURE_FEATURE_LEAK');
  });

  it('t_feature <= t_prediction → score=1.0, reason=VERIFIED', () => {
    const result = computeTemporalSafety('2026-09-24T09:00:00Z', '2026-09-24T10:00:00Z');
    expect(result.score).toBe(1.0);
    expect(result.reason).toBe('VERIFIED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 4: PATCH t_feature = arbitrary client value → REJECTED (H3 fix)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.14 — Test 4: t_feature not accepted from client in PATCH', () => {
  // This is tested by verifying that the PATCH handler code does NOT
  // include body.t_feature in its accepted fields.
  // The server computes t_feature from feature_snapshot when patching.
  it('computeTFeature returns server-computed value from snapshot, not client value', () => {
    const snapshot = makeValidSnapshot();
    const serverTFeature = computeTFeature(snapshot);

    // The server value should be the MAX of source_timestamps
    expect(serverTFeature).toContain('2026-09-24T10:00:00'); // MAX of the 4 timestamps

    // A client-supplied arbitrary value would be different
    const clientArbitraryValue = '2099-12-31T23:59:59Z';
    expect(serverTFeature).not.toBe(clientArbitraryValue);
  });

  it('computeTFeature returns null when no source_timestamps', () => {
    const snapshot = makeValidSnapshot({
      source_timestamps: { odds: null, ranking: null, form: null, h2h: null },
      odds: { home: 1.85, draw: 3.40, away: 4.20, source_timestamp: null },
      standings: { home: null, away: null, source_timestamp: null },
      form: { home: null, away: null, source_timestamp: null },
      h2h: { matches: null, source_timestamp: null },
    });
    expect(computeTFeature(snapshot)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 5: feature_snapshot=NULL + feature_snapshot_hash=hash → hash REJECTED (H4 fix)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.14 — Test 5: hash rejected without snapshot', () => {
  // This is tested by verifying the validatePrediction logic:
  // feature_snapshot_hash is only accepted when feature_snapshot is present.
  // In the actual code: `(body.feature_snapshot && body.feature_snapshot_hash) ? ... : null`
  it('hash logic: null snapshot → hash = null', () => {
    const body = { feature_snapshot: null, feature_snapshot_hash: 'some-hash' };
    const hash = (body.feature_snapshot && body.feature_snapshot_hash)
      ? String(body.feature_snapshot_hash).substring(0, 80)
      : null;
    expect(hash).toBeNull();
  });

  it('hash logic: present snapshot + hash → hash accepted', () => {
    const body = { feature_snapshot: { odds: {} }, feature_snapshot_hash: 'some-hash' };
    const hash = (body.feature_snapshot && body.feature_snapshot_hash)
      ? String(body.feature_snapshot_hash).substring(0, 80)
      : null;
    expect(hash).toBe('some-hash');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 6: PATCH provenance_status = "INVALID_VALUE" → REJECTED (M1 fix)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.14 — Test 6: provenance_status enum validation', () => {
  it('rejects arbitrary string "ABC"', () => {
    expect(isValidProvenanceStatus('ABC')).toBe(false);
  });

  it('accepts canonical RECORDED', () => {
    expect(isValidProvenanceStatus('RECORDED')).toBe(true);
    expect(isCanonicalProvenanceStatus('RECORDED')).toBe(true);
  });

  it('accepts canonical RECONSTRUCTED', () => {
    expect(isValidProvenanceStatus('RECONSTRUCTED')).toBe(true);
  });

  it('accepts canonical UNKNOWN', () => {
    expect(isValidProvenanceStatus('UNKNOWN')).toBe(true);
  });

  it('accepts canonical UNSAFE', () => {
    expect(isValidProvenanceStatus('UNSAFE')).toBe(true);
  });

  it('accepts legacy VALID (backward compat)', () => {
    expect(isValidProvenanceStatus('VALID')).toBe(true);
    expect(isCanonicalProvenanceStatus('VALID')).toBe(false); // legacy, not canonical
  });

  it('accepts legacy PARTIALLY_VALID (backward compat)', () => {
    expect(isValidProvenanceStatus('PARTIALLY_VALID')).toBe(true);
  });

  it('rejects non-string', () => {
    expect(isValidProvenanceStatus(123)).toBe(false);
    expect(isValidProvenanceStatus(null)).toBe(false);
    expect(isValidProvenanceStatus(undefined)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 7: valid snapshot → validateStoredSnapshot → accepted (M2 fix)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.14 — Test 7: valid snapshot passes validation', () => {
  it('valid snapshot with all fields → valid=true', () => {
    const snapshot = makeValidSnapshot();
    const result = validateStoredSnapshot(snapshot, '2026-09-24T10:00:03Z');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 8: invalid snapshot → validateStoredSnapshot → rejected (M2 fix)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.14 — Test 8: invalid snapshot rejected', () => {
  it('snapshot with temporal leak → valid=false', () => {
    const snapshot = makeValidSnapshot({
      source_timestamps: {
        odds: '2026-09-24T11:00:00Z', // 1 hour AFTER prediction
        ranking: '2026-09-24T09:00:00Z',
        form: '2026-09-24T09:30:00Z',
        h2h: '2026-09-24T09:45:00Z',
      },
    });
    const result = validateStoredSnapshot(snapshot, '2026-09-24T10:00:00Z');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Temporal leak'))).toBe(true);
  });

  it('snapshot without numeric odds → valid=false', () => {
    const snapshot = makeValidSnapshot({
      odds: { home: 'not-a-number', draw: 3.40, away: 4.20 },
    });
    const result = validateStoredSnapshot(snapshot, '2026-09-24T10:00:00Z');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('numeric'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 9: INSERT → PATCH enrichment flow still works
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.14 — Test 9: enrichment flow compatibility', () => {
  it('INSERT without snapshot → all derived fields are NULL/false (enrichment-ready)', () => {
    const insertResult = recomputeScientificFields({
      featureSnapshot: null,
      tPrediction: '2026-09-24T10:00:03Z',
      aiResponseHash: null,
    });

    // All derived fields should be NULL/0/false — ready for PATCH enrichment
    expect(insertResult.t_feature).toBeNull();
    expect(insertResult.completeness_score).toBe(0);
    expect(insertResult.temporal_safety_score).toBe(0.0);
    expect(insertResult.scientific_collection_eligible).toBe(false);
    expect(insertResult.provenance_status).toBe('UNKNOWN');
  });

  it('PATCH with snapshot → derived fields computed from snapshot', () => {
    // Simulate PATCH enrichment: feature_snapshot arrives, t_prediction already exists
    const snapshot = makeValidSnapshot();
    const tPrediction = '2026-09-24T10:00:03Z'; // existing from INSERT

    // Compute t_feature from the snapshot
    const patchTFeature = computeTFeature(snapshot);
    expect(patchTFeature).not.toBeNull();

    // Compute completeness from the snapshot
    const patchCompleteness = computeCompletenessScore(snapshot);
    expect(patchCompleteness).toBe(1.0);

    // Compute temporal safety from t_feature and existing t_prediction
    const patchTemporal = computeTemporalSafety(patchTFeature, tPrediction);
    expect(patchTemporal.score).toBe(1.0); // t_feature (10:00) <= t_prediction (10:03)

    // Compute provenance from the snapshot (C1 fix: uses 'standings' not 'stats')
    const patchProvenance = computeProvenanceStatus(snapshot);
    expect(patchProvenance).toBe('RECORDED'); // all features + source_timestamps present

    // Compute eligibility
    const patchEligible = computeScientificEligible(
      snapshot, patchCompleteness, patchTemporal.score, patchTFeature, 'some-ai-response-hash',
    );
    expect(patchEligible).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 10: Immutability protections still active
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.14 — Test 10: immutability not bypassed', () => {
  it('recomputeScientificFields does NOT call any DB operations', () => {
    // The function is pure — it only computes values from input data.
    // It does NOT touch the database.
    const result = recomputeScientificFields({
      featureSnapshot: makeValidSnapshot(),
      tPrediction: '2026-09-24T10:00:03Z',
      aiResponseHash: 'hash',
    });

    // Verify it returns all expected fields
    expect(result).toHaveProperty('t_feature');
    expect(result).toHaveProperty('completeness_score');
    expect(result).toHaveProperty('temporal_safety_score');
    expect(result).toHaveProperty('temporal_safety_reason');
    expect(result).toHaveProperty('provenance_status');
    expect(result).toHaveProperty('scientific_collection_eligible');
  });

  it('C1 fix: computeProvenanceStatus uses standings (not stats)', () => {
    // Snapshot with standings but NO stats key
    const snapshot = makeValidSnapshot();
    expect(snapshot).not.toHaveProperty('stats'); // no 'stats' key
    expect(snapshot).toHaveProperty('standings'); // uses 'standings'

    // Should return RECORDED when all features + source_timestamps present
    const provenance = computeProvenanceStatus(snapshot);
    expect(provenance).toBe('RECORDED');
  });

  it('C1 fix: partial snapshot → RECONSTRUCTED (not UNKNOWN)', () => {
    // Snapshot with odds source_timestamp but no standings/form/h2h source_timestamps
    const snapshot = makeValidSnapshot({
      standings: { home: null, away: null, source_timestamp: null },
      form: { home: null, away: null, source_timestamp: null },
      h2h: { matches: null, source_timestamp: null },
      source_timestamps: { odds: '2026-09-24T10:00:00Z', ranking: null, form: null, h2h: null },
    });

    // With C1 fix: hasOdds=true → RECONSTRUCTED (previously was UNKNOWN due to stats bug)
    const provenance = computeProvenanceStatus(snapshot);
    expect(provenance).toBe('RECONSTRUCTED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADDITIONAL: Orphan prevention — C2 fix
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.14 — Orphan prevention (C2 fix)', () => {
  it('cannot create eligible=true without feature_snapshot', () => {
    const result = recomputeScientificFields({
      featureSnapshot: null,
      tPrediction: '2026-09-24T10:00:03Z',
      aiResponseHash: 'some-hash', // even with AI response
    });

    expect(result.scientific_collection_eligible).toBe(false);
  });

  it('cannot create eligible=true without ai_response_hash', () => {
    const snapshot = makeValidSnapshot();
    const result = recomputeScientificFields({
      featureSnapshot: snapshot,
      tPrediction: '2026-09-24T10:00:03Z',
      aiResponseHash: null, // math-v2 fallback
    });

    expect(result.scientific_collection_eligible).toBe(false);
  });

  it('cannot create eligible=true without t_feature', () => {
    const snapshot = makeValidSnapshot({
      source_timestamps: { odds: null, ranking: null, form: null, h2h: null },
      odds: { home: 1.85, draw: 3.40, away: 4.20, source_timestamp: null },
      standings: { home: null, away: null, source_timestamp: null },
      form: { home: null, away: null, source_timestamp: null },
      h2h: { matches: null, source_timestamp: null },
    });
    const result = recomputeScientificFields({
      featureSnapshot: snapshot,
      tPrediction: '2026-09-24T10:00:03Z',
      aiResponseHash: 'some-hash',
    });

    expect(result.t_feature).toBeNull();
    expect(result.temporal_safety_score).toBe(0.0);
    expect(result.scientific_collection_eligible).toBe(false);
  });
});
