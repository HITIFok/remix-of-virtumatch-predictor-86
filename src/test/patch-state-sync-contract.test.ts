// ============================================
// PHASE 5.3.31.1 — PATCH STATE SYNC + predictionIdMap FALLBACK TESTS
// Validates the Phase 5.3.31 corrections:
//   A) updatePredictionScientificFields() syncs local state from PATCH response
//   B) predictionIdMap fallback uses dbPredictions when map is empty
// ============================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Prediction } from '../hooks/use-predictions';

// ═══════════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════════

vi.mock('@/lib/device', () => ({
  getDeviceId: vi.fn(() => 'dev-test1234567890abcdef'),
  getAuthHeaders: vi.fn(async () => ({ 'x-device-id': 'dev-test1234567890abcdef' })),
}));

vi.mock('@/config/env', () => ({
  config: {
    api: {
      predictions: 'http://localhost:3000/api/predictions',
      verifyPredictionsUrl: 'http://localhost:3000/api/verify-predictions',
    },
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function makePrediction(id: string, home: string, away: string): Prediction {
  return {
    id, matchId: 1, homeTeam: home, awayTeam: away, league: 'Test', leagueId: '1',
    oddHome: 2.0, oddDraw: 3.0, oddAway: 4.0,
    probHome: 0.5, probDraw: 0.25, probAway: 0.25,
    prediction: '1', confidence: 50,
    predictedHomeScore: 1, predictedAwayScore: 0, predictedScore: '1-0',
    winner1x2: '1 — Test', status: 'pending',
    home: home, away: away, scoreHome: 1, scoreAway: 0, exactScore: '1-0',
    createdAt: '2026-09-29T12:00:00.000Z', verifiedAt: null,
    actualOutcome: null, actualScore: null, actualHomeScore: null, actualAwayScore: null,
    featureSnapshot: null, modelVersion: null, featureVersion: null,
    configVersion: null, calibrationVersion: null, datasetVersion: null,
    featureSnapshotHash: null, predictionHash: null,
    snapshotTimestamp: null, provenanceStatus: null,
    aiContextHash: null, aiInputHash: null, aiPromptHash: null,
    aiResponseHash: null, aiPromptVersion: null, aiModel: null, aiTrace: null,
    aiCallStatus: null, aiResponseLength: null,
    completenessScore: null, temporalSafetyScore: null,
    temporalSafetyReason: null, timestampProvenance: null,
    aiProvenanceRisk: null, scientificCollectionEligible: null,
    versionFreeze: null, tFeature: null, tPrediction: null, datasetSplit: null,
    probGg: null, probGn: null, bttsProb: null, over25Prob: null,
    firstHalfGoalProb: null, expectedGoals: null,
    ggResult: null, totalGoals: null, parity: null,
    overUnder15: null, overUnder25: null, overUnder35: null,
    round: null,
  } as Prediction;
}

function makeUpdatedPrediction(original: Prediction): Prediction {
  return {
    ...original,
    aiCallStatus: 'PARSE_OK',
    aiResponseLength: 1622,
    aiResponseHash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
    aiContextHash: 'ctx123hash456ctx123hash456ctx123hash456ctx123hash456ctx123hash456ab',
    aiInputHash: 'inp123hash456inp123hash456inp123hash456inp123hash456inp123hash456ab',
    aiPromptHash: 'prm123hash456prm123hash456prm123hash456prm123hash456prm123hash456ab',
    aiTrace: { hashes: { ai_call_status: 'PARSE_OK' } },
    aiModel: 'qwen/qwen3.8-27b',
    scientificCollectionEligible: true,
    completenessScore: 0.8,
    temporalSafetyScore: 1.0,
    provenanceStatus: 'RECORDED',
    tFeature: '2026-09-29T12:00:00.000Z',
  } as Prediction;
}

function mockInitialLoad(predictions: Prediction[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true, status: 200,
    json: async () => ({ success: true, predictions }),
  } as any);
}

function mockPatchSuccess(updatedPrediction: Prediction) {
  mockFetch.mockResolvedValueOnce({
    ok: true, status: 200,
    json: async () => ({ success: true, prediction: updatedPrediction }),
  } as any);
}

function mockPatchFailure(status: number, error: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false, status,
    json: async () => ({ success: false, error }),
  } as any);
}

function mockPatchInvalidJson() {
  mockFetch.mockResolvedValueOnce({
    ok: true, status: 200,
    json: async () => { throw new Error('Unexpected token in JSON'); },
  } as any);
}

function mockPatchNoPrediction() {
  mockFetch.mockResolvedValueOnce({
    ok: true, status: 200,
    json: async () => ({ success: true }), // no `prediction` field
  } as any);
}

// Wait for mount effect (loadPredictions)
async function waitForMount() {
  await act(async () => { await new Promise(r => setTimeout(r, 100)); });
}

const { usePredictions } = await import('../hooks/use-predictions');

// ═══════════════════════════════════════════════════════════════════
// PATCH STATE SYNC TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.1 — PATCH state sync', () => {
  beforeEach(() => { mockFetch.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // ═══ TEST A — PATCH success → state updated ═══
  it('TEST A — PATCH success updates state with AI fields', async () => {
    const { result } = renderHook(() => usePredictions());
    const P1 = makePrediction('uuid-1', 'Home', 'Away');
    mockInitialLoad([P1]);
    await waitForMount();
    expect(result.current.predictions.length).toBe(1);
    expect(result.current.predictions[0].aiCallStatus).toBeNull();

    const updated = makeUpdatedPrediction(P1);
    mockPatchSuccess(updated);

    let patchResult: boolean = false;
    await act(async () => {
      patchResult = await result.current.updatePredictionScientificFields('uuid-1', {
        ai_call_status: 'PARSE_OK',
        ai_response_hash: 'abc123',
        ai_trace: { hashes: {} },
      });
    });

    expect(patchResult).toBe(true);
    // Verify state was updated with PATCH response data
    const p = result.current.predictions.find(p => p.id === 'uuid-1')!;
    expect(p.aiCallStatus).toBe('PARSE_OK');
    expect(p.aiResponseLength).toBe(1622);
    expect(p.aiResponseHash).toBe('abc123def456abc123def456abc123def456abc123def456abc123def456abcd');
    expect(p.aiTrace).toEqual({ hashes: { ai_call_status: 'PARSE_OK' } });
    expect(p.scientificCollectionEligible).toBe(true);
    expect(p.aiModel).toBe('qwen/qwen3.8-27b');
  });

  // ═══ TEST B — PATCH success → only targeted prediction updated ═══
  it('TEST B — PATCH only updates the targeted prediction, others unchanged', async () => {
    const { result } = renderHook(() => usePredictions());
    const P1 = makePrediction('uuid-1', 'HomeA', 'AwayA');
    const P2 = makePrediction('uuid-2', 'HomeB', 'AwayB');
    mockInitialLoad([P1, P2]);
    await waitForMount();
    expect(result.current.predictions.length).toBe(2);

    const updated = makeUpdatedPrediction(P1);
    mockPatchSuccess(updated);

    await act(async () => {
      await result.current.updatePredictionScientificFields('uuid-1', { ai_call_status: 'PARSE_OK' });
    });

    // P1 should be updated
    const p1 = result.current.predictions.find(p => p.id === 'uuid-1')!;
    expect(p1.aiCallStatus).toBe('PARSE_OK');

    // P2 should be unchanged
    const p2 = result.current.predictions.find(p => p.id === 'uuid-2')!;
    expect(p2.aiCallStatus).toBeNull();
    expect(p2.aiResponseHash).toBeNull();
    expect(p2.scientificCollectionEligible).toBeNull();

    // Length should not change
    expect(result.current.predictions.length).toBe(2);
  });

  // ═══ TEST C — PATCH failure → state preserved ═══
  it('TEST C — PATCH HTTP 500 preserves state unchanged', async () => {
    const { result } = renderHook(() => usePredictions());
    const P1 = makePrediction('uuid-1', 'Home', 'Away');
    mockInitialLoad([P1]);
    await waitForMount();

    const stateBefore = JSON.stringify(result.current.predictions);
    mockPatchFailure(500, 'Internal error');

    let patchResult = true;
    await act(async () => {
      patchResult = await result.current.updatePredictionScientificFields('uuid-1', { ai_call_status: 'PARSE_OK' });
    });

    expect(patchResult).toBe(false);
    // State must be identical — no partial mutation
    expect(JSON.stringify(result.current.predictions)).toBe(stateBefore);
    expect(result.current.predictions.length).toBe(1);
    expect(result.current.predictions[0].aiCallStatus).toBeNull();
  });

  it('TEST C2 — PATCH HTTP 401 preserves state unchanged', async () => {
    const { result } = renderHook(() => usePredictions());
    const P1 = makePrediction('uuid-1', 'Home', 'Away');
    mockInitialLoad([P1]);
    await waitForMount();

    const stateBefore = JSON.stringify(result.current.predictions);
    mockPatchFailure(401, 'Authentication required');

    let patchResult = true;
    await act(async () => {
      patchResult = await result.current.updatePredictionScientificFields('uuid-1', { ai_call_status: 'PARSE_OK' });
    });

    expect(patchResult).toBe(false);
    expect(JSON.stringify(result.current.predictions)).toBe(stateBefore);
  });

  // ═══ TEST D — PATCH invalid JSON → state preserved ═══
  it('TEST D — PATCH with invalid JSON response preserves state', async () => {
    const { result } = renderHook(() => usePredictions());
    const P1 = makePrediction('uuid-1', 'Home', 'Away');
    mockInitialLoad([P1]);
    await waitForMount();

    const stateBefore = JSON.stringify(result.current.predictions);
    mockPatchInvalidJson();

    let patchResult = false;
    await act(async () => {
      try {
        patchResult = await result.current.updatePredictionScientificFields('uuid-1', { ai_call_status: 'PARSE_OK' });
      } catch {
        // JSON parse error may throw — that's acceptable as long as state is preserved
      }
    });

    // State must be preserved regardless of the error
    expect(JSON.stringify(result.current.predictions)).toBe(stateBefore);
    expect(result.current.predictions[0].aiCallStatus).toBeNull();
  });

  // ═══ TEST D2 — PATCH response without prediction field ═══
  it('TEST D2 — PATCH 200 without prediction field does not corrupt state', async () => {
    const { result } = renderHook(() => usePredictions());
    const P1 = makePrediction('uuid-1', 'Home', 'Away');
    mockInitialLoad([P1]);
    await waitForMount();

    const stateBefore = JSON.stringify(result.current.predictions);
    mockPatchNoPrediction();

    let patchResult = false;
    await act(async () => {
      patchResult = await result.current.updatePredictionScientificFields('uuid-1', { ai_call_status: 'PARSE_OK' });
    });

    // PATCH succeeded (res.ok = true) → should return true
    expect(patchResult).toBe(true);
    // But state should be unchanged (no prediction in response to merge)
    expect(JSON.stringify(result.current.predictions)).toBe(stateBefore);
  });

  // ═══ TEST L — Full save → PATCH → state flow ═══
  it('TEST L — Full flow: POST save → PATCH AI → state reflects both', async () => {
    const { result } = renderHook(() => usePredictions());
    mockInitialLoad([]);
    await waitForMount();
    expect(result.current.predictions.length).toBe(0);

    // POST: save new prediction
    const saved = makePrediction('uuid-new', 'NewHome', 'NewAway');
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 201,
      json: async () => ({ success: true, prediction: saved }),
    } as any);

    await act(async () => {
      await result.current.savePrediction({
        home_team: 'NewHome', away_team: 'NewAway', league: 'Test',
        oddHome: 2, oddDraw: 3, oddAway: 4,
        probHome: 0.5, probDraw: 0.25, probAway: 0.25,
        prediction: '1', confidence: 50,
      });
    });

    // After POST: state has 1 prediction with NULL AI fields
    expect(result.current.predictions.length).toBe(1);
    expect(result.current.predictions[0].id).toBe('uuid-new');
    expect(result.current.predictions[0].aiCallStatus).toBeNull();

    // Preserve non-AI fields for later comparison
    const originalFields = {
      homeTeam: result.current.predictions[0].homeTeam,
      awayTeam: result.current.predictions[0].awayTeam,
      prediction: result.current.predictions[0].prediction,
      confidence: result.current.predictions[0].confidence,
      createdAt: result.current.predictions[0].createdAt,
    };

    // PATCH: AI enhancement
    const updated = makeUpdatedPrediction(saved);
    mockPatchSuccess(updated);

    await act(async () => {
      await result.current.updatePredictionScientificFields('uuid-new', {
        ai_call_status: 'PARSE_OK',
        ai_response_hash: 'abc123',
        ai_trace: { hashes: {} },
      });
    });

    // After PATCH: state has 1 prediction with AI fields populated
    expect(result.current.predictions.length).toBe(1);
    const final = result.current.predictions[0];
    expect(final.id).toBe('uuid-new');
    expect(final.aiCallStatus).toBe('PARSE_OK');
    expect(final.aiResponseHash).not.toBeNull();
    expect(final.scientificCollectionEligible).toBe(true);

    // Verify original fields preserved
    expect(final.homeTeam).toBe(originalFields.homeTeam);
    expect(final.awayTeam).toBe(originalFields.awayTeam);
    expect(final.prediction).toBe(originalFields.prediction);
    expect(final.confidence).toBe(originalFields.confidence);
  });
});

// ═══════════════════════════════════════════════════════════════════
// predictionIdMap FALLBACK LOGIC TESTS
// ═══════════════════════════════════════════════════════════════════

// Pure function replicating the fallback logic from LiveMatches.tsx L570-571:
//   const predId = predictionIdMap.current.get(matchKey)
//     || dbPredictions.find(p => `${p.homeTeam}-${p.awayTeam}` === matchKey)?.id;
function findPredictionId(
  matchKey: string,
  predictionIdMap: Map<string, string>,
  dbPredictions: Prediction[]
): string | undefined {
  return predictionIdMap.get(matchKey)
    || dbPredictions.find(p => `${p.homeTeam}-${p.awayTeam}` === matchKey)?.id;
}

describe('Phase 5.3.31.1 — predictionIdMap fallback logic', () => {

  // ═══ TEST E — predictionIdMap HIT ═══
  it('TEST E — predictionIdMap HIT returns map value (no dbPredictions search needed)', () => {
    const map = new Map([['Home-Away', 'uuid-from-map']]);
    const dbPreds: Prediction[] = [];
    const result = findPredictionId('Home-Away', map, dbPreds);
    expect(result).toBe('uuid-from-map');
  });

  // ═══ TEST F — predictionIdMap MISS + dbPredictions HIT ═══
  it('TEST F — predictionIdMap MISS falls back to dbPredictions and finds UUID', () => {
    const map = new Map<string, string>(); // empty (simulates remount)
    const dbPreds = [
      makePrediction('uuid-existing', 'Home', 'Away'),
      makePrediction('uuid-other', 'TeamX', 'TeamY'),
    ];
    const result = findPredictionId('Home-Away', map, dbPreds);
    expect(result).toBe('uuid-existing');
  });

  // ═══ TEST G — predictionIdMap MISS + dbPredictions MISS ═══
  it('TEST G — predictionIdMap MISS + dbPredictions MISS returns undefined (secondary INSERT path)', () => {
    const map = new Map<string, string>();
    const dbPreds: Prediction[] = [];
    const result = findPredictionId('Home-Away', map, dbPreds);
    expect(result).toBeUndefined();
    // When result is undefined, enhanceWithAI falls to secondary INSERT path
    // Classification: RESIDUAL_SECONDARY_INSERT_RISK (documented, not fixed)
  });

  // ═══ TEST H — dbPredictions not yet loaded (race condition) ═══
  it('TEST H — dbPredictions empty (loadPredictions not yet complete) → fallback returns undefined', () => {
    const map = new Map<string, string>(); // empty (remount)
    const dbPreds: Prediction[] = []; // empty (loadPredictions not yet completed)
    const result = findPredictionId('Home-Away', map, dbPreds);
    expect(result).toBeUndefined();
    // Classification: POSSIBLE_RACE — if user clicks Predict before loadPredictions completes,
    // both predictionIdMap AND dbPredictions are empty → secondary INSERT
  });

  // ═══ TEST I — remount scenario: predictionIdMap empty, dbPredictions loaded ═══
  it('TEST I — remount: predictionIdMap empty, dbPredictions has prior prediction → fallback finds UUID', () => {
    const map = new Map<string, string>(); // empty after remount
    const dbPreds = [
      makePrediction('uuid-prior-1', 'TeamA', 'TeamB'),
      makePrediction('uuid-prior-2', 'Home', 'Away'), // the one we're looking for
      makePrediction('uuid-prior-3', 'TeamC', 'TeamD'),
    ];
    const result = findPredictionId('Home-Away', map, dbPreds);
    expect(result).toBe('uuid-prior-2');
  });

  // ═══ TEST J — multiple matches: correct UUID per match ═══
  it('TEST J — multiple matches: each matchKey finds the correct UUID', () => {
    const map = new Map<string, string>();
    const dbPreds = [
      makePrediction('uuid-A', 'HomeA', 'AwayA'),
      makePrediction('uuid-B', 'HomeB', 'AwayB'),
      makePrediction('uuid-C', 'HomeC', 'AwayC'),
    ];

    expect(findPredictionId('HomeA-AwayA', map, dbPreds)).toBe('uuid-A');
    expect(findPredictionId('HomeB-AwayB', map, dbPreds)).toBe('uuid-B');
    expect(findPredictionId('HomeC-AwayC', map, dbPreds)).toBe('uuid-C');
    // Ensure no cross-contamination
    expect(findPredictionId('HomeA-AwayA', map, dbPreds)).not.toBe('uuid-B');
  });

  // ═══ TEST J2 — matchKey with same team names in different order ═══
  it('TEST J2 — Home-Away vs Away-Home are distinct keys (no false match)', () => {
    const map = new Map<string, string>();
    const dbPreds = [
      makePrediction('uuid-1', 'Home', 'Away'),
    ];
    // 'Home-Away' should match
    expect(findPredictionId('Home-Away', map, dbPreds)).toBe('uuid-1');
    // 'Away-Home' (reversed) should NOT match (different matchKey)
    expect(findPredictionId('Away-Home', map, dbPreds)).toBeUndefined();
  });

  // ═══ TEST K — predictionIdMap takes priority over dbPredictions ═══
  it('TEST K — predictionIdMap value takes priority over dbPredictions', () => {
    const map = new Map([['Home-Away', 'uuid-from-map']]);
    const dbPreds = [makePrediction('uuid-from-db', 'Home', 'Away')];
    const result = findPredictionId('Home-Away', map, dbPreds);
    expect(result).toBe('uuid-from-map'); // map wins, not db
  });
});
