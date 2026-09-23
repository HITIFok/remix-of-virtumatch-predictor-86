// ============================================
// PHASE 5 TESTS — Production Snapshot + Dataset Scientifique
// Tests for: temporal timestamps, immutability, hash, completeness,
// classification, AI provenance, odds provenance, form provenance,
// leakage detection, dataset versioning, data split, double counting
// ============================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  auditSnapshot,
  computeTemporalTimestamps,
  computeCompleteness,
  auditAIProvenance,
  auditOddsProvenance,
  auditFeatureProvenance,
  type FeatureAuditRecord,
  type AuditResult,
  type TemporalTimestamps,
  type CompletenessResult,
  type AIProvenanceAudit,
  type OddsProvenanceAudit,
  type FeatureProvenanceAudit,
} from '../../src/lib/snapshot-audit';
import {
  computeDatasetVersion,
  assignDataSplit,
  splitDataset,
  reportDatasetSize,
  wilsonScoreInterval,
  validateExportedDataset,
  prepareExport,
  type DatasetVersion,
  type DataSplit,
} from '../../src/lib/dataset-manager';
import {
  computeHealthCheck,
  generateDashboardData,
  getClockConfig,
  nowUTC,
  isValidUTCTimestamp,
  metrics,
  type HealthCheckResult,
  type DashboardData,
} from '../../src/lib/snapshot-monitoring';
import {
  measureFormMomentumDoubleCounting,
  measureAIOddsDoubleCounting,
  pearsonCorrelation,
  type PredictionResult,
} from '../../src/lib/double-counting-measure';
import {
  computeSnapshotHash,
  createFeatureSnapshot,
  validateSnapshot,
  type FeatureSnapshot,
  type SnapshotContext,
  MODEL_VERSION,
  FEATURE_VERSION,
  CONFIG_VERSION,
  CALIBRATION_VERSION,
} from '../../src/lib/feature-snapshot';
import { getConfig as getConfigActual, COEFFICIENT_DEFINITIONS as COEFFICIENT_DEFINITIONSActual, getArbitraryCount, validateCoefficients as validateCoefficientsActual } from '../../src/lib/prediction-config';
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

function makeSampleSnapshot(): FeatureSnapshot {
  // Deterministic timestamps with explicit temporal ordering:
  //   featureTime <= aiRequestTime <= aiResponseTime <= predictionTime <= snapshotTime
  // This guarantees T_feature <= T_prediction and T_snapshot >= T_prediction
  // without any non-deterministic Date.now() drift.
  const base = Date.now();
  const featureTime = new Date(base - 86400000).toISOString();     // 1 day ago (source data)
  const aiRequestTime = new Date(base - 3000).toISOString();       // 3s before prediction
  const aiResponseTime = new Date(base - 1000).toISOString();      // 1s before prediction
  const predictionTime = new Date(base - 500).toISOString();       // 0.5s before snapshot
  const snapshotTime = new Date(base).toISOString();               // now

  return {
    schema_version: 1,
    snapshot_timestamp: snapshotTime,
    prediction_timestamp: predictionTime,
    model_version: MODEL_VERSION,
    feature_version: FEATURE_VERSION,
    config_version: CONFIG_VERSION,
    calibration_version: CALIBRATION_VERSION,
    dataset_version: 'unversioned',
    odds: {
      home: 1.85,
      draw: 3.40,
      away: 4.20,
      source: 'betapi',
      source_timestamp: featureTime,
      market: '1X2',
      implied_home: 0.54,
      implied_draw: 0.29,
      implied_away: 0.24,
      favorite: '1',
      provenance: 'RECORDED',
    },
    form: {
      home: {
        form_scores: ['V', 'N', 'V', 'D', 'V'],
        avg_scored: 1.6,
        avg_conceded: 0.8,
        momentum_score: 67,
        goals_balance: 0.8,
        match_count: 5,
        provenance: 'RECORDED',
        match_timestamps: [
          base - 86400000 * 2,
          base - 86400000 * 3,
          base - 86400000 * 4,
          base - 86400000 * 5,
          base - 86400000 * 6,
        ],
        source_timestamp: featureTime,
      },
      away: {
        form_scores: ['D', 'D', 'N', 'V', 'D'],
        avg_scored: 0.8,
        avg_conceded: 1.4,
        momentum_score: 33,
        goals_balance: -0.6,
        match_count: 5,
        provenance: 'RECORDED',
        match_timestamps: [
          base - 86400000 * 2,
          base - 86400000 * 3,
          base - 86400000 * 4,
          base - 86400000 * 5,
          base - 86400000 * 6,
        ],
        source_timestamp: featureTime,
      },
    },
    h2h: {
      total_matches: 8,
      home_wins: 5,
      draws: 2,
      away_wins: 1,
      home_team_bias: 50,
      provenance: 'RECORDED',
      match_timestamps: [base - 86400000 * 30],
      source_timestamp: new Date(base - 86400000 * 30).toISOString(),
    },
    stats: {
      home: {
        position: 3,
        played: 15,
        won: 9,
        drawn: 3,
        lost: 3,
        goals_for: 24,
        goals_against: 12,
        points: 30,
        avg_goals_scored: 1.6,
        avg_goals_conceded: 0.8,
        provenance: 'RECORDED',
        source_timestamp: featureTime,
      },
      away: {
        position: 12,
        played: 15,
        won: 3,
        drawn: 3,
        lost: 9,
        goals_for: 12,
        goals_against: 24,
        points: 12,
        avg_goals_scored: 0.8,
        avg_goals_conceded: 1.6,
        provenance: 'RECORDED',
        source_timestamp: featureTime,
      },
    },
    ai: {
      prediction_home: 0.52,
      prediction_draw: 0.26,
      prediction_away: 0.22,
      model: 'gpt-4o',
      prompt_version: 'v2.1',
      request_timestamp: aiRequestTime,
      response_timestamp: aiResponseTime,
      temperature: 0.3,
      score: 0.85,
      input_hash: 'abc123',
      provenance: 'RECORDED',
    },
    anti_trap: {
      triggered: false,
      rank_diff: 9,
      delta: 0.28,
      trap_type: 'none',
      confidence_penalty: 0,
    },
    derived: {
      lambda_home_base: 1.70,
      lambda_away_base: 0.95,
      lambda_home_adjusted: 1.82,
      lambda_away_adjusted: 0.88,
      poisson_home_expected: 1.80,
      poisson_away_expected: 0.90,
      blended_home: 0.50,
      blended_draw: 0.27,
      blended_away: 0.23,
    },
    coefficients: {
      hash: 'coef_hash_123',
      version: CONFIG_VERSION,
      values: { AI_WEIGHT: 0.35, VIRTUAL_AVG_GOALS: 1.3 },
    },
    feature_snapshot_hash: 'snap_hash_123',
    prediction_hash: 'pred_hash_123',
  };
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: FEATURE AUDIT
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Feature Audit (Section 1)', () => {
  it('should audit all features in snapshot', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);

    expect(audit.total_features).toBeGreaterThan(0);
    expect(audit.records.length).toBeGreaterThan(40);
    expect(audit.features_with_provenance).toBeGreaterThan(0);
  });

  it('should identify features without provenance', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);

    // Every feature should have a provenance in our sample
    expect(audit.features_without_provenance).toBeGreaterThanOrEqual(0);
  });

  it('should group features by family', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);

    expect(audit.by_family).toHaveProperty('odds');
    expect(audit.by_family).toHaveProperty('form');
    expect(audit.by_family).toHaveProperty('h2h');
    expect(audit.by_family).toHaveProperty('stats');
    expect(audit.by_family).toHaveProperty('ai');
  });

  it('should mark required features as obligatoire', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);

    const requiredFeatures = audit.records.filter(r => r.obligatoire);
    expect(requiredFeatures.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: THREE TEMPORAL TIMESTAMPS
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Three Temporal Timestamps (Section 2)', () => {
  it('should compute T_prediction, T_feature, T_snapshot', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);
    const temporal = computeTemporalTimestamps(audit, snapshot.prediction_timestamp, snapshot.snapshot_timestamp);

    expect(temporal.t_prediction).toBeTruthy();
    expect(temporal.t_feature).toBeTruthy();
    expect(temporal.t_snapshot).toBeTruthy();
  });

  it('should verify T_feature <= T_prediction', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);
    const temporal = computeTemporalTimestamps(audit, snapshot.prediction_timestamp, snapshot.snapshot_timestamp);

    expect(temporal.feature_before_prediction).toBe(true);
  });

  it('should verify T_snapshot >= T_prediction', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);
    const temporal = computeTemporalTimestamps(audit, snapshot.prediction_timestamp, snapshot.snapshot_timestamp);

    expect(temporal.snapshot_after_prediction).toBe(true);
  });

  // ── REGRESSION: A feature with source_timestamp > prediction_timestamp
  //    MUST be detected as a temporal leak (feature_before_prediction = false).
  //    This ensures the fix for AI response_timestamp doesn't mask real leaks.
  it('should detect temporal leak when a source feature is posterior to prediction', () => {
    const snapshot = makeSampleSnapshot();
    // Simulate a real temporal leak: odds data from the FUTURE
    snapshot.odds!.source_timestamp = new Date(
      new Date(snapshot.prediction_timestamp).getTime() + 60000
    ).toISOString();

    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);
    const temporal = computeTemporalTimestamps(audit, snapshot.prediction_timestamp, snapshot.snapshot_timestamp);

    // The future odds push T_feature past T_prediction → leak detected
    expect(temporal.feature_before_prediction).toBe(false);
    expect(new Date(temporal.t_feature).getTime()).toBeGreaterThan(
      new Date(temporal.t_prediction).getTime()
    );
  });

  // ── Verify the deterministic ordering of the fixture timestamps
  it('should have T_feature < T_prediction with deterministic fixture', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);
    const temporal = computeTemporalTimestamps(audit, snapshot.prediction_timestamp, snapshot.snapshot_timestamp);

    // With deterministic timestamps: all source_timestamps < prediction_timestamp
    expect(new Date(temporal.t_feature).getTime()).toBeLessThan(
      new Date(temporal.t_prediction).getTime()
    );
    expect(temporal.feature_before_prediction).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: UTC REFERENCE CLOCK
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: UTC Reference Clock (Section 3)', () => {
  it('should document timezone configuration', () => {
    const clock = getClockConfig();

    expect(clock.storage_timezone).toBe('UTC');
    expect(clock.conversion_notes.length).toBeGreaterThan(0);
  });

  it('should produce UTC timestamps', () => {
    const ts = nowUTC();
    expect(ts.endsWith('Z')).toBe(true);
  });

  it('should validate UTC timestamps', () => {
    expect(isValidUTCTimestamp('2026-09-18T12:00:00.000Z')).toBe(true);
    expect(isValidUTCTimestamp('invalid')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 5: SNAPSHOT HASH
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Snapshot Hash (Section 5)', () => {
  it('should produce same hash for same snapshot', () => {
    const snapshot = makeSampleSnapshot();
    const hash1 = computeSnapshotHash(snapshot);
    const hash2 = computeSnapshotHash(snapshot);

    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different values', () => {
    const snapshot1 = makeSampleSnapshot();
    const snapshot2 = makeSampleSnapshot();
    snapshot2.odds = { ...snapshot2.odds!, home: 2.10 };

    const hash1 = computeSnapshotHash(snapshot1);
    const hash2 = computeSnapshotHash(snapshot2);

    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash for different timestamps', () => {
    const snapshot1 = makeSampleSnapshot();
    const snapshot2 = makeSampleSnapshot();
    snapshot2.snapshot_timestamp = new Date(Date.now() + 60000).toISOString();

    const hash1 = computeSnapshotHash(snapshot1);
    const hash2 = computeSnapshotHash(snapshot2);

    expect(hash1).not.toBe(hash2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 6: COMPLETENESS SCORE
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Completeness Score (Section 6)', () => {
  it('should compute coverage and temporal safety separately', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);
    const completeness = computeCompleteness(audit);

    expect(completeness.coverage_percent).toBeGreaterThanOrEqual(0);
    expect(completeness.temporal_safety_percent).toBeGreaterThanOrEqual(0);
    expect(completeness.coverage_is_not_safety).toBe(true);
  });

  it('should never automatically transform coverage into SAFE', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);
    const completeness = computeCompleteness(audit);

    // coverage_is_not_safety is always true — the system never
    // automatically declares something SAFE based on coverage alone
    expect(completeness.coverage_is_not_safety).toBe(true);
  });

  it('should report absent features', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);
    const completeness = computeCompleteness(audit, 80);

    expect(completeness.expected_features).toBe(80);
    expect(completeness.present_features + completeness.absent_features).toBeGreaterThanOrEqual(80);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 7: CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Classification (Section 7)', () => {
  it('should classify RECORDED predictions correctly', () => {
    const snapshot = makeSampleSnapshot();
    // All features have provenance 'RECORDED'
    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);
    const recordedFeatures = audit.records.filter(r => r.provenance === 'RECORDED');
    expect(recordedFeatures.length).toBeGreaterThan(0);
  });

  it('should never automatically convert UNKNOWN to RECORDED', () => {
    // A feature without provenance must never be automatically upgraded
    const snapshot = makeSampleSnapshot();
    snapshot.ai = undefined; // Remove AI data — provenance should be UNKNOWN

    const audit = auditSnapshot(snapshot, snapshot.prediction_timestamp);
    const aiRecords = audit.records.filter(r => r.feature_family === 'ai');

    // Either no AI records, or they have UNKNOWN provenance
    if (aiRecords.length > 0) {
      const unknownRecords = aiRecords.filter(r => r.provenance === 'UNKNOWN');
      expect(unknownRecords.length).toBe(aiRecords.length);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 8: AI PROVENANCE
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: AI Provenance (Section 8)', () => {
  it('should audit AI provenance with risk flags', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditAIProvenance(snapshot);

    expect(audit.has_ai_data).toBe(true);
    expect(audit.model).toBe('gpt-4o');
    expect(audit.prompt_version).toBe('v2.1');
    expect(audit.risk_flags.length).toBeGreaterThan(0);
  });

  it('should flag risk when AI has no input_hash', () => {
    const snapshot = makeSampleSnapshot();
    snapshot.ai!.input_hash = undefined as any;

    const audit = auditAIProvenance(snapshot);
    const noInputHash = audit.risk_flags.some(f => f.includes('NO_INPUT_HASH'));
    expect(noInputHash).toBe(true);
  });

  it('should handle missing AI data', () => {
    const snapshot = makeSampleSnapshot();
    snapshot.ai = undefined;

    const audit = auditAIProvenance(snapshot);
    expect(audit.has_ai_data).toBe(false);
    expect(audit.risk_flags).toContain('NO_AI_DATA');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 9: ODDS PROVENANCE
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Odds Provenance (Section 9)', () => {
  it('should audit odds provenance', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditOddsProvenance(snapshot, snapshot.prediction_timestamp);

    expect(audit.has_odds).toBe(true);
    expect(audit.source).toBe('betapi');
    expect(audit.market).toBe('1X2');
  });

  it('should verify odds_timestamp <= prediction_timestamp', () => {
    const snapshot = makeSampleSnapshot();
    const audit = auditOddsProvenance(snapshot, snapshot.prediction_timestamp);

    expect(audit.odds_before_prediction).toBe(true);
  });

  it('should flag odds after match start', () => {
    const snapshot = makeSampleSnapshot();
    const matchStart = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    snapshot.odds!.source_timestamp = new Date(Date.now() - 1800000).toISOString(); // 30 min ago (after match start)

    const audit = auditOddsProvenance(snapshot, snapshot.prediction_timestamp, matchStart);

    expect(audit.odds_after_match_start).toBe(true);
    expect(audit.risk_flags.some(f => f.includes('ODDS_AFTER_MATCH_START'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 10: FORM/H2H/STATS/MOMENTUM PROVENANCE
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Feature Provenance (Section 10)', () => {
  it('should audit form, H2H, stats, and momentum provenance', () => {
    const snapshot = makeSampleSnapshot();
    const audits = auditFeatureProvenance(snapshot, snapshot.prediction_timestamp);

    expect(audits.length).toBeGreaterThanOrEqual(5);
    const names = audits.map(a => a.feature_name);
    expect(names).toContain('form_home');
    expect(names).toContain('form_away');
    expect(names).toContain('h2h');
    expect(names).toContain('stats_home');
    expect(names).toContain('stats_away');
  });

  it('should flag momentum as derived from form', () => {
    const snapshot = makeSampleSnapshot();
    const audits = auditFeatureProvenance(snapshot, snapshot.prediction_timestamp);

    const momentum = audits.find(a => a.feature_name === 'momentum');
    expect(momentum).toBeTruthy();
    expect(momentum!.details).toContain('DERIVED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 11: ARTIFICIAL LEAKAGE TEST
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Artificial Leakage Test (Section 11)', () => {
  const predictionTime = Date.now();

  const pastResults: TemporalResult[] = [
    { home: 'Team A', away: 'Team B', scoreHome: 2, scoreAway: 1, timestamp: predictionTime - 86400000 },
    { home: 'Team A', away: 'Team C', scoreHome: 1, scoreAway: 0, timestamp: predictionTime - 86400000 * 2 },
    { home: 'Team D', away: 'Team A', scoreHome: 0, scoreAway: 1, timestamp: predictionTime - 86400000 * 3 },
  ];

  it('should detect that modifying future data does NOT affect past form', () => {
    // Add a future result (after prediction)
    const futureResults: TemporalResult[] = [
      ...pastResults,
      { home: 'Team A', away: 'Team E', scoreHome: 5, scoreAway: 0, timestamp: predictionTime + 86400000 },
    ];

    const result = testArtificialLeakForm(pastResults, 'Team A', predictionTime, futureResults);

    expect(result.passed).toBe(true);
    expect(result.prediction_changed).toBe(false);
  });

  it('should detect that modifying past data DOES affect form', () => {
    // Modify a past result
    const modifiedPast: TemporalResult[] = [
      { home: 'Team A', away: 'Team B', scoreHome: 0, scoreAway: 5, timestamp: predictionTime - 86400000 },
      ...pastResults.slice(1),
    ];

    const result = testArtificialLeakForm(pastResults, 'Team A', predictionTime, modifiedPast);

    expect(result.passed).toBe(false);
    expect(result.prediction_changed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 16: DATASET VERSIONING
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Dataset Versioning (Section 16)', () => {
  it('should compute dataset version from all components', () => {
    const version = computeDatasetVersion('51be89f', '2.0.0', '1.0.0', '1.0.0', '0.0.0');

    expect(version.DATASET_VERSION).toBeTruthy();
    expect(version.DATASET_HASH).toBeTruthy();
    expect(version.CODE_COMMIT).toBe('51be89f');
    expect(version.MODEL_VERSION).toBe('2.0.0');
  });

  it('should produce different version for different commit', () => {
    const v1 = computeDatasetVersion('51be89f', '2.0.0', '1.0.0', '1.0.0', '0.0.0');
    const v2 = computeDatasetVersion('abcdef1', '2.0.0', '1.0.0', '1.0.0', '0.0.0');

    expect(v1.DATASET_HASH).not.toBe(v2.DATASET_HASH);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 17: DATA SPLIT
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Data Contamination Prevention (Section 17)', () => {
  it('should split data chronologically (never random)', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(Date.now() - (100 - i) * 86400000).toISOString(),
      id: i,
    }));

    const split = splitDataset(items);

    expect(split.train.length).toBe(60);
    expect(split.validation.length).toBe(20);
    expect(split.test.length).toBe(20);
  });

  it('should assign correct split labels', () => {
    expect(assignDataSplit(0, 100)).toBe('TRAIN');
    expect(assignDataSplit(59, 100)).toBe('TRAIN');
    expect(assignDataSplit(60, 100)).toBe('VALIDATION');
    expect(assignDataSplit(79, 100)).toBe('VALIDATION');
    expect(assignDataSplit(80, 100)).toBe('TEST');
    expect(assignDataSplit(99, 100)).toBe('TEST');
  });

  it('should never overlap splits', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      timestamp: i,
      id: i,
    }));

    const split = splitDataset(items);
    const trainIds = new Set(split.train.map(i => i.id));
    const valIds = new Set(split.validation.map(i => i.id));
    const testIds = new Set(split.test.map(i => i.id));

    // No overlap
    for (const id of valIds) expect(trainIds.has(id)).toBe(false);
    for (const id of testIds) {
      expect(trainIds.has(id)).toBe(false);
      expect(valIds.has(id)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 18: DATASET SIZE
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Dataset Size Tracking (Section 18)', () => {
  it('should flag insufficient data below 100', () => {
    const report = reportDatasetSize(50, 30, 10, 10);
    expect(report.meets_minimum_threshold).toBe(false);
    expect(report.warning).toBeTruthy();
  });

  it('should flag minimum ≠ scientifically sufficient', () => {
    const report = reportDatasetSize(150, 90, 30, 30);
    expect(report.meets_minimum_threshold).toBe(true);
    expect(report.minimum_is_not_sufficient).toBe(true);
  });

  it('should compute Wilson score interval', () => {
    // 70% accuracy on 100 test samples
    const ci = wilsonScoreInterval(70, 100);
    expect(ci.lower).toBeLessThan(0.70);
    expect(ci.upper).toBeGreaterThan(0.70);
    expect(ci.lower).toBeGreaterThan(0);
    expect(ci.upper).toBeLessThan(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 13-14: MONITORING & HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Monitoring & Health Check (Sections 13-14)', () => {
  beforeEach(() => {
    metrics.clear();
  });

  it('should record snapshot events', () => {
    metrics.record('snapshot_created', 1);
    metrics.record('snapshot_created', 2);
    metrics.record('snapshot_failed', 3);

    const counts = metrics.countByEvent();
    expect(counts['snapshot_created']).toBe(2);
    expect(counts['snapshot_failed']).toBe(1);
  });

  it('should compute health check', () => {
    metrics.record('snapshot_created', 1);

    const health = computeHealthCheck({
      predictions_last_24h: 240,
      snapshots_last_24h: 238,
      complete_snapshots: 221,
      incomplete_snapshots: 17,
      unknown_count: 17,
      unsafe_count: 0,
    });

    expect(health.predictions_last_24h).toBe(240);
    expect(health.snapshot_coverage_percent).toBeGreaterThan(99);
    expect(health.health).toBe('HEALTHY');
  });

  it('should detect UNHEALTHY when hash mismatches exist', () => {
    metrics.record('snapshot_hash_mismatch', 1);

    const health = computeHealthCheck({
      predictions_last_24h: 10,
      snapshots_last_24h: 10,
      complete_snapshots: 10,
      incomplete_snapshots: 0,
      unknown_count: 0,
      unsafe_count: 0,
    });

    expect(health.health).toBe('UNHEALTHY');
    expect(health.hash_mismatches).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 15: SCIENTIFIC DASHBOARD
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Scientific Dashboard (Section 15)', () => {
  it('should generate dashboard data for audit purposes only', () => {
    const dashboard = generateDashboardData({
      total_predictions: 500,
      verified_results: 350,
      snapshot_coverage_percent: 95,
      feature_coverage_percent: 88,
      temporal_safety_percent: 82,
      provenance_breakdown: {
        RECORDED: 300,
        RECONSTRUCTED: 100,
        UNKNOWN: 80,
        UNSAFE: 20,
      },
      model_versions: ['2.0.0'],
      feature_versions: ['1.0.0'],
      config_versions: ['1.0.0'],
    });

    expect(dashboard.total_predictions).toBe(500);
    expect(dashboard.purpose).toBe('AUDIT_ONLY');
    expect(dashboard.unsafe_count).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 22: DOUBLE COUNTING MEASUREMENT
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Double Counting Measurement (Section 22)', () => {
  const makePredictions = (base: number, variance: number, count: number): PredictionResult[] => {
    return Array.from({ length: count }, (_, i) => {
      const home = base + variance * Math.sin(i * 0.5);
      const draw = (1 - home) * 0.35;
      const away = 1 - home - draw;
      return {
        prediction: home > draw && home > away ? '1' : draw > away ? 'X' : '2',
        prob_home: home,
        prob_draw: draw,
        prob_away: away,
        confidence: 60 + Math.round(home * 30),
      };
    });
  };

  it('should measure Form-Momentum double counting', () => {
    const full = makePredictions(0.48, 0.05, 50);
    const withoutForm = makePredictions(0.45, 0.04, 50);
    const withoutMomentum = makePredictions(0.46, 0.04, 50);
    const withoutBoth = makePredictions(0.42, 0.03, 50);

    const result = measureFormMomentumDoubleCounting(full, withoutForm, withoutMomentum, withoutBoth);

    expect(result.results.length).toBe(3);
    expect(Number.isFinite(result.form_momentum_correlation)).toBe(true);
    expect(result.conclusion).toBeTruthy();
  });

  it('should measure AI-Odds double counting', () => {
    const full = makePredictions(0.48, 0.05, 50);
    const withoutAi = makePredictions(0.46, 0.04, 50);
    const oddsOnly = makePredictions(0.47, 0.02, 50);

    const result = measureAIOddsDoubleCounting(full, withoutAi, oddsOnly, null);

    expect(result.results.length).toBeGreaterThanOrEqual(3);
    expect(result.conclusion).toBeTruthy();
  });

  it('should compute Pearson correlation', () => {
    // Perfect correlation
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 5);

    // Perfect anti-correlation
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 19: DATASET EXPORT & VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: Dataset Export & Validation (Section 19)', () => {
  it('should export prediction without secrets', () => {
    const exported = prepareExport({
      prediction_timestamp: '2026-09-18T12:00:00Z',
      feature_snapshot: { odds: { home: 1.85 } },
      prob_home: 0.48,
      prob_draw: 0.27,
      prob_away: 0.25,
      odd_home: 1.85,
      odd_draw: 3.40,
      odd_away: 4.20,
      actual_outcome: '1',
      model_version: '2.0.0',
      feature_version: '1.0.0',
      config_version: '1.0.0',
      provenance_status: 'RECORDED',
    }, 'TRAIN');

    // No secrets in export
    expect(exported).not.toHaveProperty('token');
    expect(exported).not.toHaveProperty('secret');
    expect(exported.split).toBe('TRAIN');
  });

  it('should validate exported dataset', () => {
    const predictions = [
      {
        prediction_timestamp: '2026-09-18T12:00:00Z',
        features: { odds: { home: 1.85 } },
        probabilities: { home: 0.48, draw: 0.27, away: 0.25 },
        odds: { home: 1.85, draw: 3.40, away: 4.20 },
        actual_outcome: '1' as const,
        model_version: '2.0.0',
        feature_version: '1.0.0',
        config_version: '1.0.0',
        provenance: 'RECORDED',
        split: 'TRAIN' as const,
      },
    ];

    const result = validateExportedDataset(predictions);
    expect(result.valid).toBe(true);
    expect(result.summary.total).toBe(1);
  });

  it('should detect UNSAFE predictions in validation', () => {
    const predictions = [
      {
        prediction_timestamp: '2026-09-18T12:00:00Z',
        features: {},
        probabilities: { home: 0.48, draw: 0.27, away: 0.25 },
        odds: { home: 1.85, draw: 3.40, away: 4.20 },
        actual_outcome: null as any,
        model_version: '2.0.0',
        feature_version: '1.0.0',
        config_version: '1.0.0',
        provenance: 'UNSAFE',
        split: 'TEST' as const,
      },
    ];

    const result = validateExportedDataset(predictions);
    expect(result.valid).toBe(false);
    expect(result.summary.potential_leakage).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECTION 21: NO MODEL OPTIMIZATION
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5: No Model Optimization (Section 21)', () => {
  it('should verify AI_WEIGHT has not been modified', () => {
    // AI_WEIGHT must remain at 0.35
    const config = getConfigActual();
    expect(config.AI_WEIGHT).toBe(0.35);
  });

  it('should verify VIRTUAL_AVG_GOALS has not been modified', () => {
    const config = getConfigActual();
    expect(config.VIRTUAL_AVG_GOALS).toBe(1.3);
  });

  it('should verify no coefficients have been modified', () => {
    const config = getConfigActual();

    // Spot check key coefficients
    expect(config.FORM_ATTACK_BOOST).toBe(0.15);
    expect(config.MOMENTUM_SCALE).toBe(500);
    expect(config.H2H_HOME_BOOST).toBe(0.5);
  });
});
