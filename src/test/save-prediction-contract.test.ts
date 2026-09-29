// ============================================
// PHASE 5.3.28.1 — savePrediction() LOCAL STATE CONTRACT TESTS
// Validates that the Phase 5.3.28 optimization (removing redundant
// loadPredictions() call after save) correctly updates local state
// from the POST response.
// ============================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Prediction } from '../hooks/use-predictions';

// ═══════════════════════════════════════════════════════════════════
// MOCKS — mock external dependencies used by use-predictions hook
// ═══════════════════════════════════════════════════════════════════

// Mock the device module (getDeviceId, getAuthHeaders)
vi.mock('@/lib/device', () => ({
  getDeviceId: vi.fn(() => 'dev-test1234567890abcdef'),
  getAuthHeaders: vi.fn(async () => ({ 'x-device-id': 'dev-test1234567890abcdef' })),
}));

// Mock the config module
vi.mock('@/config/env', () => ({
  config: {
    api: {
      predictions: 'http://localhost:3000/api/predictions',
      verifyPredictionsUrl: 'http://localhost:3000/api/verify-predictions',
    },
  },
}));

// Global fetch mock
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function makePrediction(id: string, home: string, away: string): Prediction {
  return {
    id,
    matchId: 1,
    homeTeam: home,
    awayTeam: away,
    league: 'Test League',
    leagueId: '1',
    oddHome: 2.0, oddDraw: 3.0, oddAway: 4.0,
    probHome: 0.5, probDraw: 0.25, probAway: 0.25,
    prediction: '1', confidence: 50,
    predictedHomeScore: 1, predictedAwayScore: 0,
    predictedScore: '1-0',
    winner1x2: '1 — Test',
    status: 'pending',
    home: home, away: away,
    scoreHome: 1, scoreAway: 0,
    exactScore: '1-0',
    createdAt: '2026-09-29T12:00:00.000Z',
    verifiedAt: null,
    actualOutcome: null, actualScore: null,
    actualHomeScore: null, actualAwayScore: null,
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
    versionFreeze: null, tFeature: null, tPrediction: null,
    datasetSplit: null,
    probGg: null, probGn: null, bttsProb: null, over25Prob: null,
    firstHalfGoalProb: null, expectedGoals: null,
    ggResult: null, totalGoals: null, parity: null,
    overUnder15: null, overUnder25: null, overUnder35: null,
    oddDraw: 3.0, oddHome: 2.0, oddAway: 4.0,
    probDraw: 0.25, probHome: 0.5, probAway: 0.25,
    round: null,
  } as Prediction;
}

function mockFetchSuccess(prediction: Prediction) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 201,
    json: async () => ({ success: true, prediction }),
  } as any);
}

function mockFetch409() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 409,
    json: async () => ({ success: false, error: 'Duplicate prediction' }),
  } as any);
}

function mockFetch500() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 500,
    json: async () => ({ success: false, error: 'Internal error' }),
  } as any);
}

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

// Import AFTER mocks are set up
const { usePredictions } = await import('../hooks/use-predictions');

describe('Phase 5.3.28.1 — savePrediction() local state contract', () => {

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══ TEST A — success: POST returns P3, state becomes [P3, P1, P2] ═══
  it('TEST A — successful save prepends prediction to state', async () => {
    const { result } = renderHook(() => usePredictions());

    // Wait for initial loadPredictions (mount effect) — mock it to return [P1, P2]
    const P1 = makePrediction('uuid-1', 'Home1', 'Away1');
    const P2 = makePrediction('uuid-2', 'Home2', 'Away2');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, predictions: [P1, P2] }),
    } as any);

    // Wait for mount effect to run
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Verify initial state has [P1, P2]
    expect(result.current.predictions.length).toBe(2);

    // Now simulate savePrediction — POST returns P3
    const P3 = makePrediction('uuid-3', 'Home3', 'Away3');
    mockFetchSuccess(P3);

    let savedPrediction: Prediction | null = null;
    await act(async () => {
      savedPrediction = await result.current.savePrediction({
        home_team: 'Home3',
        away_team: 'Away3',
        league: 'Test League',
        oddHome: 2.0, oddDraw: 3.0, oddAway: 4.0,
        probHome: 0.5, probDraw: 0.25, probAway: 0.25,
        prediction: '1', confidence: 50,
      });
    });

    // TEST A: state should be [P3, P1, P2]
    expect(result.current.predictions.length).toBe(3);
    expect(result.current.predictions[0].id).toBe('uuid-3');
    expect(result.current.predictions[1].id).toBe('uuid-1');
    expect(result.current.predictions[2].id).toBe('uuid-2');

    // TEST C: returned value should be P3 with correct UUID
    expect(savedPrediction).not.toBeNull();
    expect(savedPrediction!.id).toBe('uuid-3');
  });

  // ═══ TEST B — conservation: P1 and P2 are not lost ═══
  it('TEST B — existing predictions are preserved after save', async () => {
    const { result } = renderHook(() => usePredictions());

    const P1 = makePrediction('uuid-1', 'Home1', 'Away1');
    const P2 = makePrediction('uuid-2', 'Home2', 'Away2');
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ success: true, predictions: [P1, P2] }),
    } as any);

    await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    expect(result.current.predictions.length).toBe(2);

    const P3 = makePrediction('uuid-3', 'Home3', 'Away3');
    mockFetchSuccess(P3);

    await act(async () => {
      await result.current.savePrediction({
        home_team: 'Home3', away_team: 'Away3', league: 'Test',
        oddHome: 2, oddDraw: 3, oddAway: 4,
        probHome: 0.5, probDraw: 0.25, probAway: 0.25,
        prediction: '1', confidence: 50,
      });
    });

    // P1 and P2 must still be in the state
    const ids = result.current.predictions.map(p => p.id);
    expect(ids).toContain('uuid-1');
    expect(ids).toContain('uuid-2');
    expect(ids).toContain('uuid-3');
    expect(result.current.predictions.length).toBe(3);
  });

  // ═══ TEST D — error: POST error does not add phantom entry ═══
  it('TEST D — HTTP 500 error does not add prediction to state', async () => {
    const { result } = renderHook(() => usePredictions());

    // Initial state: empty (mock loadPredictions to return empty)
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ success: true, predictions: [] }),
    } as any);

    await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    expect(result.current.predictions.length).toBe(0);

    // POST returns 500
    mockFetch500();

    await act(async () => {
      try {
        await result.current.savePrediction({
          home_team: 'Fail', away_team: 'Test', league: 'Test',
          oddHome: 2, oddDraw: 3, oddAway: 4,
          probHome: 0.5, probDraw: 0.25, probAway: 0.25,
          prediction: '1', confidence: 50,
        });
      } catch {
        // Expected to throw
      }
    });

    // State should remain empty — no phantom entry
    expect(result.current.predictions.length).toBe(0);
  });

  // ═══ TEST E — 409: returns null, state unchanged ═══
  it('TEST E — HTTP 409 returns null and does not modify state', async () => {
    const { result } = renderHook(() => usePredictions());

    const P1 = makePrediction('uuid-1', 'Home1', 'Away1');
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ success: true, predictions: [P1] }),
    } as any);

    await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    expect(result.current.predictions.length).toBe(1);

    // POST returns 409
    mockFetch409();

    let returnValue: any = 'not-null';
    await act(async () => {
      returnValue = await result.current.savePrediction({
        home_team: 'Dup', away_team: 'Test', league: 'Test',
        oddHome: 2, oddDraw: 3, oddAway: 4,
        probHome: 0.5, probDraw: 0.25, probAway: 0.25,
        prediction: '1', confidence: 50,
      });
    });

    // 409 should return null
    expect(returnValue).toBeNull();
    // State should remain [P1] — no new entry
    expect(result.current.predictions.length).toBe(1);
    expect(result.current.predictions[0].id).toBe('uuid-1');
  });

  // ═══ TEST F — no redundant GET after save ═══
  it('TEST F — savePrediction does NOT trigger a second GET /api/predictions', async () => {
    const { result } = renderHook(() => usePredictions());

    // Initial load
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ success: true, predictions: [] }),
    } as any);

    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    // Count fetch calls before save
    const callsBeforeSave = mockFetch.mock.calls.length;

    // Save
    const P3 = makePrediction('uuid-3', 'Home3', 'Away3');
    mockFetchSuccess(P3);

    await act(async () => {
      await result.current.savePrediction({
        home_team: 'Home3', away_team: 'Away3', league: 'Test',
        oddHome: 2, oddDraw: 3, oddAway: 4,
        probHome: 0.5, probDraw: 0.25, probAway: 0.25,
        prediction: '1', confidence: 50,
      });
    });

    // Count fetch calls after save
    const callsAfterSave = mockFetch.mock.calls.length;

    // Should have exactly 1 new call (the POST) — NOT 2 (POST + GET)
    expect(callsAfterSave - callsBeforeSave).toBe(1);

    // Verify the new call was a POST (not a GET)
    const saveCall = mockFetch.mock.calls[callsAfterSave - 1];
    expect(saveCall[1]?.method).toBe('POST');
  });
});
