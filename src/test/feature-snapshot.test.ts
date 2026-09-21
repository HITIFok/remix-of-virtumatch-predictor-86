// ============================================
// FEATURE SNAPSHOT TESTS — Phase 3
// Tests for: snapshot creation, validation, versioning,
// timestamp validation, leakage detection, reconstruction,
// immutability, reproducibility, missing features,
// unknown features, corrupted snapshot
// ============================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createFeatureSnapshot,
  validateSnapshot,
  computeSnapshotHash,
  computePredictionHash,
  analyzeProvenance,
  checkReproducibility,
  classifyLegacyPrediction,
  serializeSnapshot,
  deserializeSnapshot,
  createOddsOnlySnapshot,
  MODEL_VERSION,
  FEATURE_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  type FeatureSnapshot,
  type SnapshotContext,
} from '../../src/lib/feature-snapshot';
import {
  getFormAtTimestamp,
  getH2HAtTimestamp,
  getStatsAtTimestamp,
  checkFeatureLeakage,
  testArtificialLeakForm,
  testArtificialLeakH2H,
  type TemporalResult,
  type TemporalRankingEntry,
} from '../../src/lib/historical-reconstruction';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function makeSampleContext(): SnapshotContext {
  return {
    home: 'Team A',
    away: 'Team B',
    league: 'Virtual League',
    oddHome: 1.85,
    oddDraw: 3.40,
    oddAway: 4.20,
    probHome: 0.482,
    probDraw: 0.262,
    probAway: 0.256,
    favorite: '1',
    favoriteProb: 0.482,
    lambdaHome: 1.70,
    lambdaAway: 0.95,
    homeForm: {
      formScores: ['V', 'N', 'V', 'D', 'V'],
      avgScored: 1.4,
      avgConceded: 0.8,
      momentumScore: 73,
      goalsBalance: 3,
    },
    awayForm: {
      formScores: ['D', 'V', 'N', 'V', 'D'],
      avgScored: 1.1,
      avgConceded: 1.2,
      momentumScore: 47,
      goalsBalance: -1,
    },
    h2hData: {
      totalMatches: 5,
      homeWins: 3,
      draws: 1,
      awayWins: 1,
      avgHomeGoals: 1.6,
      avgAwayGoals: 0.8,
      avgTotalGoals: 2.4,
      homeTeamBias: 40,
    },
    homeStats: {
      name: 'Team A',
      position: 3,
      played: 10,
      won: 6,
      drawn: 2,
      lost: 2,
      goalsFor: 15,
      goalsAgainst: 8,
      points: 20,
      form: ['V', 'N', 'V', 'D', 'V'],
      avgGoalsScored: 1.5,
      avgGoalsConceded: 0.8,
      winRate: 0.6,
    },
    awayStats: {
      name: 'Team B',
      position: 8,
      played: 10,
      won: 3,
      drawn: 3,
      lost: 4,
      goalsFor: 11,
      goalsAgainst: 13,
      points: 12,
      form: ['D', 'V', 'N', 'V', 'D'],
      avgGoalsScored: 1.1,
      avgGoalsConceded: 1.3,
      winRate: 0.3,
    },
    aiPrediction: {
      scoreHome: 2,
      scoreAway: 0,
      confidence: 72,
      reasoning: 'Home favorite',
      isAntiTrap: false,
      firstHalfGoal: true,
      tendency: 'Match standard',
      dangerLevel: 'safe',
      topScores: [{ score: '2-0', probability: 0.15 }],
      bttsProb: 0.55,
      over25Prob: 0.45,
      firstHalfScore: '1-0',
    },
    aiAgreement: 1,
    isTrueTrap: false,
    isAntiTrap: false,
    isFalseTrap: false,
    isDomination: false,
    antiTrapAlerts: 0,
    antiTrapSignals: {
      momentum_trap: false,
      attack_trap: false,
      h2h_trap: false,
      ranking_trap: false,
      ai_disagreement: false,
    },
    lambdaHomeInitial: 1.55,
    lambdaAwayInitial: 1.05,
    lambdaHomeAfterStats: 1.62,
    lambdaAwayAfterStats: 0.98,
    lambdaHomeAfterHistory: 1.70,
    lambdaAwayAfterHistory: 0.95,
    gridSearchError: 0.0003,
    formAgreement: 1,
    h2hAgreement: 1,
    statsHasData: true,
    predictionTimestamp: '2026-09-18T14:30:00.000Z',
    oddsTimestamp: '2026-09-18T14:00:00.000Z',
    rankingTimestamp: '2026-09-18T12:00:00.000Z',
    formSourceTimestamp: '2026-09-17T00:00:00.000Z',
    aiTimestamp: '2026-09-18T14:30:01.000Z',
  };
}

function makeSampleResults(): TemporalResult[] {
  return [
    { home: 'Team A', away: 'Team C', scoreHome: 2, scoreAway: 0, round: 1, league: 'L', date: '2026-09-10', timestamp: new Date('2026-09-10').getTime() },
    { home: 'Team D', away: 'Team A', scoreHome: 1, scoreAway: 1, round: 2, league: 'L', date: '2026-09-07', timestamp: new Date('2026-09-07').getTime() },
    { home: 'Team A', away: 'Team E', scoreHome: 1, scoreAway: 2, round: 3, league: 'L', date: '2026-09-04', timestamp: new Date('2026-09-04').getTime() },
    { home: 'Team B', away: 'Team A', scoreHome: 0, scoreAway: 3, round: 4, league: 'L', date: '2026-09-01', timestamp: new Date('2026-09-01').getTime() },
    { home: 'Team A', away: 'Team B', scoreHome: 2, scoreAway: 1, round: 5, league: 'L', date: '2026-08-28', timestamp: new Date('2026-08-28').getTime() },
    // H2H matches
    { home: 'Team A', away: 'Team B', scoreHome: 1, scoreAway: 0, round: 6, league: 'L', date: '2026-08-15', timestamp: new Date('2026-08-15').getTime() },
    { home: 'Team B', away: 'Team A', scoreHome: 0, scoreAway: 2, round: 7, league: 'L', date: '2026-08-01', timestamp: new Date('2026-08-01').getTime() },
  ];
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT CREATION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Feature Snapshot Creation', () => {
  it('creates a snapshot with all fields populated', () => {
    const ctx = makeSampleContext();
    const snapshot = createFeatureSnapshot(ctx);

    expect(snapshot.schema_version).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.model_version).toBe(MODEL_VERSION);
    expect(snapshot.feature_version).toBe(FEATURE_VERSION);
    expect(snapshot.odds.odd_home).toBe(1.85);
    expect(snapshot.odds.odd_draw).toBe(3.40);
    expect(snapshot.odds.odd_away).toBe(4.20);
    expect(snapshot.odds.favorite).toBe('1');
    expect(snapshot.form.home.form_scores).toEqual(['V', 'N', 'V', 'D', 'V']);
    expect(snapshot.form.away.form_scores).toEqual(['D', 'V', 'N', 'V', 'D']);
    expect(snapshot.h2h.total_matches).toBe(5);
    expect(snapshot.h2h.home_team_bias).toBe(40);
    expect(snapshot.stats.home.position).toBe(3);
    expect(snapshot.stats.away.position).toBe(8);
    expect(snapshot.ai.enabled).toBe(true);
    expect(snapshot.ai.model).toBe('llama-3.3-70b-versatile');
    expect(snapshot.anti_trap.triggered).toBe(false);
    expect(snapshot.derived.lambda_home_final).toBe(1.70);
    expect(snapshot.derived.lambda_away_final).toBe(0.95);
  });

  it('includes feature_snapshot_hash', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    expect(snapshot.feature_snapshot_hash).toBeDefined();
    expect(snapshot.feature_snapshot_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('captures coefficient values and hash', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    expect(snapshot.coefficients.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(snapshot.coefficients.values.VIRTUAL_AVG_GOALS).toBe(1.3);
    expect(snapshot.coefficients.values.AI_WEIGHT).toBe(0.35);
    expect(snapshot.coefficients.values.STAT_BASE_WEIGHT).toBe(0.70);
  });

  it('handles missing optional features gracefully', () => {
    const minimalCtx: SnapshotContext = {
      home: 'Team A',
      away: 'Team B',
      league: 'Virtual League',
      oddHome: 2.0,
      oddDraw: 3.0,
      oddAway: 4.0,
      probHome: 0.48,
      probDraw: 0.32,
      probAway: 0.20,
      favorite: '1',
      favoriteProb: 0.48,
      lambdaHome: 1.5,
      lambdaAway: 1.0,
    };

    const snapshot = createFeatureSnapshot(minimalCtx);
    expect(snapshot.form.home.provenance).toBe('UNKNOWN');
    expect(snapshot.form.away.provenance).toBe('UNKNOWN');
    expect(snapshot.h2h.provenance).toBe('UNKNOWN');
    expect(snapshot.stats.home.provenance).toBe('UNKNOWN');
    expect(snapshot.ai.enabled).toBe(false);
    expect(snapshot.anti_trap.provenance).toBe('UNKNOWN');
  });

  it('records correct provenance when features are provided', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    expect(snapshot.odds.provenance).toBe('RECORDED');
    expect(snapshot.form.home.provenance).toBe('RECORDED');
    expect(snapshot.form.away.provenance).toBe('RECORDED');
    expect(snapshot.h2h.provenance).toBe('RECORDED');
    expect(snapshot.stats.home.provenance).toBe('RECORDED');
    expect(snapshot.stats.away.provenance).toBe('RECORDED');
    expect(snapshot.ai.provenance).toBe('RECORDED');
    expect(snapshot.anti_trap.provenance).toBe('RECORDED');
    expect(snapshot.derived.provenance).toBe('RECORDED');
    expect(snapshot.coefficients.provenance).toBe('RECORDED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SCHEMA VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Schema Validation', () => {
  it('validates a correct snapshot', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    const result = validateSnapshot(snapshot);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.leakage_detected).toBe(false);
  });

  it('detects invalid prediction_timestamp', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    snapshot.prediction_timestamp = 'invalid-date';
    const result = validateSnapshot(snapshot);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('prediction_timestamp'))).toBe(true);
  });

  it('detects probability conservation violation', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    snapshot.odds.implied_prob_home = 0.5;
    snapshot.odds.implied_prob_draw = 0.5;
    snapshot.odds.implied_prob_away = 0.5; // Sum = 1.5
    const result = validateSnapshot(snapshot);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("don't sum to 1.0"))).toBe(true);
  });

  it('detects negative lambda values', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    snapshot.derived.lambda_home_final = -0.5;
    const result = validateSnapshot(snapshot);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('positive'))).toBe(true);
  });

  it('detects schema version mismatch', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    snapshot.schema_version = 999;
    const result = validateSnapshot(snapshot);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Schema version'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIMESTAMP VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Timestamp Validation', () => {
  it('detects odds timestamp after prediction (leakage)', () => {
    const ctx = makeSampleContext();
    ctx.predictionTimestamp = '2026-09-18T14:00:00.000Z';
    ctx.oddsTimestamp = '2026-09-18T15:00:00.000Z'; // After prediction!
    const snapshot = createFeatureSnapshot(ctx);
    const result = validateSnapshot(snapshot);
    expect(result.leakage_detected).toBe(true);
    expect(result.leakage_details.some(d => d.includes('Odds'))).toBe(true);
    expect(snapshot.odds.provenance).toBe('UNSAFE');
  });

  it('detects ranking timestamp after prediction (leakage)', () => {
    const ctx = makeSampleContext();
    ctx.predictionTimestamp = '2026-09-18T14:00:00.000Z';
    ctx.rankingTimestamp = '2026-09-18T15:00:00.000Z'; // After prediction!
    const snapshot = createFeatureSnapshot(ctx);
    const result = validateSnapshot(snapshot);
    expect(result.leakage_detected).toBe(true);
    expect(result.leakage_details.some(d => d.includes('Stats'))).toBe(true);
  });

  it('detects form timestamp after prediction (leakage)', () => {
    const ctx = makeSampleContext();
    ctx.predictionTimestamp = '2026-09-18T14:00:00.000Z';
    ctx.formSourceTimestamp = '2026-09-18T15:00:00.000Z'; // After prediction!
    const snapshot = createFeatureSnapshot(ctx);
    const result = validateSnapshot(snapshot);
    expect(result.leakage_detected).toBe(true);
    expect(result.leakage_details.some(d => d.includes('Form'))).toBe(true);
  });

  it('allows AI timestamp within 5s tolerance', () => {
    const ctx = makeSampleContext();
    ctx.predictionTimestamp = '2026-09-18T14:30:00.000Z';
    ctx.aiTimestamp = '2026-09-18T14:30:03.000Z'; // 3s after prediction start
    const snapshot = createFeatureSnapshot(ctx);
    const result = validateSnapshot(snapshot);
    expect(result.leakage_detected).toBe(false);
  });

  it('rejects AI timestamp more than 5s after prediction', () => {
    const ctx = makeSampleContext();
    ctx.predictionTimestamp = '2026-09-18T14:30:00.000Z';
    ctx.aiTimestamp = '2026-09-18T14:30:10.000Z'; // 10s after prediction start
    const snapshot = createFeatureSnapshot(ctx);
    const result = validateSnapshot(snapshot);
    expect(result.leakage_detected).toBe(true);
    expect(result.leakage_details.some(d => d.includes('AI'))).toBe(true);
  });

  it('passes with all timestamps before prediction', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    const result = validateSnapshot(snapshot);
    expect(result.leakage_detected).toBe(false);
    expect(result.leakage_details).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEAKAGE DETECTION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Leakage Detection', () => {
  const predictionTs = new Date('2026-09-18T14:30:00.000Z').getTime();

  it('future match must never influence form', () => {
    const results = makeSampleResults();
    // Add a future match (after prediction)
    const withFuture = [...results, {
      home: 'Team A', away: 'Team F', scoreHome: 5, scoreAway: 0,
      round: 10, league: 'L',
      date: '2026-09-20', // AFTER prediction
      timestamp: new Date('2026-09-20').getTime(),
    }];

    const form = getFormAtTimestamp(withFuture, 'Team A', predictionTs);
    // The future match (5-0 win) should NOT appear in form
    expect(form.matchCount).toBeLessThanOrEqual(5);
    expect(form.avgScored).toBeLessThan(5); // If leaked, avg would be inflated
  });

  it('future match must never influence H2H', () => {
    const results = makeSampleResults();
    const withFuture = [...results, {
      home: 'Team A', away: 'Team B', scoreHome: 10, scoreAway: 0,
      round: 10, league: 'L',
      date: '2026-09-20',
      timestamp: new Date('2026-09-20').getTime(),
    }];

    const h2h = getH2HAtTimestamp(withFuture, 'Team A', 'Team B', predictionTs);
    // The 10-0 future match should NOT be counted
    expect(h2h.avgHomeGoals).toBeLessThan(10);
  });

  it('future ranking must never influence prediction', () => {
    const rankings: TemporalRankingEntry[] = [
      {
        team: 'Team A', position: 1, played: 10, won: 8, drawn: 1, lost: 1,
        goalsFor: 20, goalsAgainst: 5, points: 25,
        avgGoalsScored: 2.0, avgGoalsConceded: 0.5,
        date: '2026-09-20', // AFTER prediction
        timestamp: new Date('2026-09-20').getTime(),
      },
    ];

    const stats = getStatsAtTimestamp(rankings, 'Team A', predictionTs);
    // The future ranking should NOT be used
    expect(stats.provenance).toBe('UNKNOWN');
    expect(stats.position).toBe(0); // Default when no data
  });

  it('checkFeatureLeakage reports no leakage for temporal functions', () => {
    const results = makeSampleResults();
    const rankings: TemporalRankingEntry[] = [];
    const checks = checkFeatureLeakage(results, rankings, 'Team A', 'Team B', predictionTs);

    for (const check of checks) {
      expect(check.has_leakage).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// ARTIFICIAL LEAK TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Artificial Leak Tests', () => {
  const predictionTs = new Date('2026-09-18T14:30:00.000Z').getTime();

  it('modifying a future result does NOT change form', () => {
    const results = makeSampleResults();
    // Create modified results: change a FUTURE match (after prediction)
    const modified = results.map(r => ({ ...r }));
    modified.push({
      home: 'Team A', away: 'Team X', scoreHome: 99, scoreAway: 0,
      round: 100, league: 'L',
      date: '2026-09-25', // AFTER prediction
      timestamp: new Date('2026-09-25').getTime(),
    });

    const result = testArtificialLeakForm(results, 'Team A', predictionTs, modified);
    expect(result.passed).toBe(true);
    expect(result.prediction_changed).toBe(false);
  });

  it('modifying a future H2H result does NOT change H2H', () => {
    const results = makeSampleResults();
    const modified = results.map(r => ({ ...r }));
    modified.push({
      home: 'Team A', away: 'Team B', scoreHome: 99, scoreAway: 0,
      round: 100, league: 'L',
      date: '2026-09-25',
      timestamp: new Date('2026-09-25').getTime(),
    });

    const result = testArtificialLeakH2H(results, 'Team A', 'Team B', predictionTs, modified);
    expect(result.passed).toBe(true);
    expect(result.prediction_changed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// RECONSTRUCTION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Historical Reconstruction', () => {
  const predictionTs = new Date('2026-09-18T14:30:00.000Z').getTime();

  it('reconstructs form from historical results', () => {
    const results = makeSampleResults();
    const form = getFormAtTimestamp(results, 'Team A', predictionTs);
    expect(form.matchCount).toBeGreaterThan(0);
    expect(form.provenance).toBe('RECONSTRUCTED');
    expect(form.formScores.length).toBeGreaterThan(0);
    expect(form.momentumScore).toBeGreaterThanOrEqual(0);
    expect(form.momentumScore).toBeLessThanOrEqual(100);
  });

  it('reconstructs H2H from historical results', () => {
    const results = makeSampleResults();
    const h2h = getH2HAtTimestamp(results, 'Team A', 'Team B', predictionTs);
    expect(h2h.totalMatches).toBeGreaterThan(0);
    expect(h2h.provenance).toBe('RECONSTRUCTED');
    expect(h2h.homeWins + h2h.draws + h2h.awayWins).toBe(h2h.totalMatches);
  });

  it('reconstructs ranking from historical rankings', () => {
    const rankings: TemporalRankingEntry[] = [{
      team: 'Team A', position: 3, played: 10, won: 6, drawn: 2, lost: 2,
      goalsFor: 15, goalsAgainst: 8, points: 20,
      avgGoalsScored: 1.5, avgGoalsConceded: 0.8,
      date: '2026-09-17',
      timestamp: new Date('2026-09-17').getTime(),
    }];

    const stats = getStatsAtTimestamp(rankings, 'Team A', predictionTs);
    expect(stats.position).toBe(3);
    expect(stats.provenance).toBe('RECONSTRUCTED');
  });

  it('returns UNKNOWN when no data exists before prediction', () => {
    const results: TemporalResult[] = [];
    const form = getFormAtTimestamp(results, 'Team X', predictionTs);
    expect(form.matchCount).toBe(0);
    expect(form.provenance).toBe('RECONSTRUCTED'); // Empty but reconstructed (no data available)

    const rankings: TemporalRankingEntry[] = [];
    const stats = getStatsAtTimestamp(rankings, 'Team X', predictionTs);
    expect(stats.provenance).toBe('UNKNOWN');
  });
});

// ═══════════════════════════════════════════════════════════════════
// PROVENANCE ANALYSIS TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Provenance Analysis', () => {
  it('reports 100% RECORDED for full snapshot', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    const analysis = analyzeProvenance(snapshot);
    expect(analysis.recorded_pct).toBe(100);
    expect(analysis.unknown_pct).toBe(0);
    expect(analysis.unsafe_pct).toBe(0);
    expect(analysis.backtest_validity).toBe('VALID');
  });

  it('reports UNKNOWN for missing features', () => {
    const minimalCtx: SnapshotContext = {
      home: 'Team A', away: 'Team B', league: 'L',
      oddHome: 2.0, oddDraw: 3.0, oddAway: 4.0,
      probHome: 0.48, probDraw: 0.32, probAway: 0.20,
      favorite: '1', favoriteProb: 0.48,
      lambdaHome: 1.5, lambdaAway: 1.0,
    };
    const snapshot = createFeatureSnapshot(minimalCtx);
    const analysis = analyzeProvenance(snapshot);
    expect(analysis.unknown_pct).toBeGreaterThan(0);
    expect(analysis.backtest_validity).toBe('PARTIALLY_VALID');
  });

  it('reports INVALID when UNSAFE features exist', () => {
    const ctx = makeSampleContext();
    ctx.predictionTimestamp = '2026-09-18T14:00:00.000Z';
    ctx.oddsTimestamp = '2026-09-18T15:00:00.000Z'; // After prediction → UNSAFE
    const snapshot = createFeatureSnapshot(ctx);
    validateSnapshot(snapshot); // This sets provenance to UNSAFE
    const analysis = analyzeProvenance(snapshot);
    expect(analysis.unsafe_pct).toBeGreaterThan(0);
    expect(analysis.backtest_validity).toBe('INVALID');
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEGACY PREDICTION CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════

describe('Legacy Prediction Classification', () => {
  it('classifies odds as RECORDED for historical prediction', () => {
    const result = classifyLegacyPrediction({
      odd_home: 1.85,
      odd_draw: 3.40,
      odd_away: 4.20,
      prob_home: 0.48,
      prob_draw: 0.26,
      prob_away: 0.26,
      created_at: '2026-09-15T10:00:00.000Z',
    });
    expect(result.by_family.odds).toBe('RECORDED');
  });

  it('classifies all non-odds features as UNKNOWN', () => {
    const result = classifyLegacyPrediction({
      odd_home: 1.85, odd_draw: 3.40, odd_away: 4.20,
      prob_home: 0.48, prob_draw: 0.26, prob_away: 0.26,
      created_at: '2026-09-15T10:00:00.000Z',
    });
    expect(result.by_family.form_home).toBe('UNKNOWN');
    expect(result.by_family.form_away).toBe('UNKNOWN');
    expect(result.by_family.h2h).toBe('UNKNOWN');
    expect(result.by_family.stats_home).toBe('UNKNOWN');
    expect(result.by_family.stats_away).toBe('UNKNOWN');
    expect(result.by_family.ai).toBe('UNKNOWN');
    expect(result.by_family.anti_trap).toBe('UNKNOWN');
  });

  it('never marks UNKNOWN as SAFE', () => {
    const result = classifyLegacyPrediction({
      odd_home: 1.85, odd_draw: 3.40, odd_away: 4.20,
      prob_home: 0.48, prob_draw: 0.26, prob_away: 0.26,
      created_at: '2026-09-15T10:00:00.000Z',
    });
    for (const [key, status] of Object.entries(result.by_family)) {
      if (key !== 'odds') {
        expect(status).not.toBe('RECORDED');
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// REPRODUCIBILITY TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Reproducibility', () => {
  it('same snapshot + same model = EXACT_MATCH', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    const output = {
      prob_home: 0.482, prob_draw: 0.262, prob_away: 0.256,
      prediction: '1', confidence: 72, exact_score: '2-0',
      lambda_home: 1.70, lambda_away: 0.95,
    };
    snapshot.prediction_hash = computePredictionHash(output);

    const result = checkReproducibility(snapshot, snapshot, output, output);
    expect(result.status).toBe('EXACT_MATCH');
    expect(result.snapshot_hash_match).toBe(true);
  });

  it('detects NUMERICAL_DIFFERENCE for small variations', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    const output1 = {
      prob_home: 0.482, prob_draw: 0.262, prob_away: 0.256,
      prediction: '1', confidence: 72, exact_score: '2-0',
      lambda_home: 1.70, lambda_away: 0.95,
    };
    const output2 = {
      prob_home: 0.485, prob_draw: 0.260, prob_away: 0.255,
      prediction: '1', confidence: 71, exact_score: '2-0',
      lambda_home: 1.71, lambda_away: 0.94,
    };
    snapshot.prediction_hash = computePredictionHash(output1);

    const result = checkReproducibility(snapshot, snapshot, output1, output2);
    expect(result.status).toBe('NUMERICAL_DIFFERENCE');
  });

  it('reports MISSING_DATA when hashes are missing', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    delete snapshot.prediction_hash;
    const output = {
      prob_home: 0.482, prob_draw: 0.262, prob_away: 0.256,
      prediction: '1', confidence: 72, exact_score: '2-0',
      lambda_home: 1.70, lambda_away: 0.95,
    };

    const result = checkReproducibility(snapshot, snapshot, output, output);
    expect(result.status).toBe('MISSING_DATA');
  });
});

// ═══════════════════════════════════════════════════════════════════
// HASH TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Hash Computation', () => {
  it('produces consistent SHA-256 hashes', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    const hash1 = snapshot.feature_snapshot_hash;
    const hash2 = computeSnapshotHash(snapshot);
    expect(hash1).toBe(hash2);
  });

  it('different inputs produce different hashes', () => {
    const ctx1 = makeSampleContext();
    const ctx2 = makeSampleContext();
    ctx2.oddHome = 2.50; // Different odds

    const s1 = createFeatureSnapshot(ctx1);
    const s2 = createFeatureSnapshot(ctx2);
    expect(s1.feature_snapshot_hash).not.toBe(s2.feature_snapshot_hash);
  });

  it('prediction hash is deterministic', () => {
    const output = {
      prob_home: 0.482, prob_draw: 0.262, prob_away: 0.256,
      prediction: '1', confidence: 72, exact_score: '2-0',
      lambda_home: 1.70, lambda_away: 0.95,
    };
    const hash1 = computePredictionHash(output);
    const hash2 = computePredictionHash(output);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERIALIZATION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Serialization', () => {
  it('round-trips through JSON serialization', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    const json = serializeSnapshot(snapshot);
    const { snapshot: restored, valid } = deserializeSnapshot(json);
    expect(valid).toBe(true);
    expect(restored.schema_version).toBe(snapshot.schema_version);
    expect(restored.feature_snapshot_hash).toBe(snapshot.feature_snapshot_hash);
  });

  it('detects corrupted JSON', () => {
    const { valid, error } = deserializeSnapshot('not valid json{{{');
    expect(valid).toBe(false);
    expect(error).toContain('JSON parse error');
  });

  it('detects schema version mismatch in deserialized data', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    const json = serializeSnapshot(snapshot);
    const modified = json.replace('"schema_version":1', '"schema_version":999');
    const { valid, error } = deserializeSnapshot(modified);
    expect(valid).toBe(false);
    expect(error).toContain('Schema version');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ODDS-ONLY SNAPSHOT TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Odds-Only Snapshot', () => {
  it('creates snapshot with only odds as RECORDED', () => {
    const snapshot = createOddsOnlySnapshot(
      1.85, 3.40, 4.20,
      0.482, 0.262, 0.256,
      '1', 0.482
    );
    expect(snapshot.odds.provenance).toBe('RECORDED');
    expect(snapshot.form.home.provenance).toBe('UNKNOWN');
    expect(snapshot.h2h.provenance).toBe('UNKNOWN');
    expect(snapshot.stats.home.provenance).toBe('UNKNOWN');
    expect(snapshot.ai.provenance).toBe('UNKNOWN');
  });

  it('has PARTIALLY_VALID backtest validity', () => {
    const snapshot = createOddsOnlySnapshot(
      1.85, 3.40, 4.20,
      0.482, 0.262, 0.256,
      '1', 0.482
    );
    const analysis = analyzeProvenance(snapshot);
    expect(analysis.backtest_validity).toBe('PARTIALLY_VALID');
  });
});

// ═══════════════════════════════════════════════════════════════════
// NO FAKE DATA TESTS
// ═══════════════════════════════════════════════════════════════════

describe('No Fake Data Rule', () => {
  it('legacy prediction never claims RECORDED for non-odds features', () => {
    const result = classifyLegacyPrediction({
      odd_home: 1.85, odd_draw: 3.40, odd_away: 4.20,
      prob_home: 0.48, prob_draw: 0.26, prob_away: 0.26,
      created_at: '2026-09-10T10:00:00.000Z',
    });
    // Only odds can be RECORDED for a legacy prediction
    const nonOddsFeatures = Object.entries(result.by_family)
      .filter(([k]) => k !== 'odds');
    for (const [, status] of nonOddsFeatures) {
      expect(status).not.toBe('RECORDED');
    }
  });

  it('UNKNOWN is never default-elevated to SAFE', () => {
    const result = classifyLegacyPrediction({
      odd_home: 1.85, odd_draw: 3.40, odd_away: 4.20,
      prob_home: 0.48, prob_draw: 0.26, prob_away: 0.26,
      created_at: '2026-09-10T10:00:00.000Z',
    });
    // No feature should ever be marked RECORDED unless it was actually stored
    for (const [key, status] of Object.entries(result.by_family)) {
      if (status === 'RECORDED') {
        expect(key).toBe('odds'); // Only odds is truly RECORDED
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// VERSIONING TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Model Versioning', () => {
  it('snapshot includes all version fields', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    expect(snapshot.model_version).toBeDefined();
    expect(snapshot.feature_version).toBeDefined();
    expect(snapshot.config_version).toBeDefined();
    expect(snapshot.calibration_version).toBeDefined();
    expect(snapshot.dataset_version).toBeDefined();
  });

  it('versions are immutable strings', () => {
    const snapshot = createFeatureSnapshot(makeSampleContext());
    expect(typeof snapshot.model_version).toBe('string');
    expect(typeof snapshot.feature_version).toBe('string');
    expect(typeof snapshot.config_version).toBe('string');
    expect(typeof snapshot.calibration_version).toBe('string');
    expect(typeof snapshot.dataset_version).toBe('string');
  });
});
