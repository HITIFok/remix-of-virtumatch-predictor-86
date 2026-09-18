// ============================================
// DATASET MANAGER v1.0
// Phase 5 — Dataset Versioning, Export, Validation, Splitting
// ============================================
//
// Sections 16-17-18-19 of Phase 5:
// - Dataset versioning
// - Data contamination separation (TRAIN/VALIDATION/TEST)
// - Dataset size tracking with CI calculation
// - Export and validation

import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// DATASET VERSIONING (Section 16)
// ═══════════════════════════════════════════════════════════════════

export interface DatasetVersion {
  DATASET_VERSION: string;
  DATASET_HASH: string;
  CODE_COMMIT: string;
  MODEL_VERSION: string;
  FEATURE_VERSION: string;
  CONFIG_VERSION: string;
  CALIBRATION_VERSION: string;
}

/**
 * Compute a dataset version fingerprint.
 * A change in any of these elements creates a new analytical version.
 */
export function computeDatasetVersion(
  codeCommit: string,
  modelVersion: string,
  featureVersion: string,
  configVersion: string,
  calibrationVersion: string,
): DatasetVersion {
  const versionString = `${codeCommit}|${modelVersion}|${featureVersion}|${configVersion}|${calibrationVersion}`;
  const hash = crypto.createHash('sha256').update(versionString).digest('hex').substring(0, 16);

  return {
    DATASET_VERSION: `v${hash.substring(0, 8)}`,
    DATASET_HASH: hash,
    CODE_COMMIT: codeCommit,
    MODEL_VERSION: modelVersion,
    FEATURE_VERSION: featureVersion,
    CONFIG_VERSION: configVersion,
    CALIBRATION_VERSION: calibrationVersion,
  };
}

// ═══════════════════════════════════════════════════════════════════
// DATA SPLIT: TRAIN / VALIDATION / TEST (Section 17)
// ═══════════════════════════════════════════════════════════════════

export type DataSplit = 'TRAIN' | 'VALIDATION' | 'TEST';

export interface SplitConfig {
  /** Percentage for TRAIN (default 60) */
  train_percent: number;
  /** Percentage for VALIDATION (default 20) */
  validation_percent: number;
  /** Percentage for TEST (default 20) */
  test_percent: number;
  /** Split method: always chronological, never random */
  method: 'chronological';
}

export const DEFAULT_SPLIT_CONFIG: SplitConfig = {
  train_percent: 60,
  validation_percent: 20,
  test_percent: 20,
  method: 'chronological',
};

/**
 * Assign a data split based on chronological position.
 * Data is sorted by timestamp, then split sequentially.
 * NEVER random — always chronological to prevent leakage.
 *
 * IMPORTANT: Once TEST is used, it must NEVER be reused for optimization.
 */
export function assignDataSplit(
  index: number,
  total: number,
  config: SplitConfig = DEFAULT_SPLIT_CONFIG,
): DataSplit {
  // Verify percentages sum to 100
  const sum = config.train_percent + config.validation_percent + config.test_percent;
  if (Math.abs(sum - 100) > 0.01) {
    throw new Error(`Split percentages must sum to 100, got ${sum}`);
  }

  const trainEnd = Math.floor(total * config.train_percent / 100);
  const valEnd = trainEnd + Math.floor(total * config.validation_percent / 100);

  if (index < trainEnd) return 'TRAIN';
  if (index < valEnd) return 'VALIDATION';
  return 'TEST';
}

/**
 * Split a dataset chronologically.
 * Items must be pre-sorted by timestamp (oldest first).
 */
export function splitDataset<T extends { timestamp: string | number }>(
  items: T[],
  config: SplitConfig = DEFAULT_SPLIT_CONFIG,
): { train: T[]; validation: T[]; test: T[]; split_timestamps: { train_end: string; val_end: string } } {
  // Sort by timestamp (oldest first) — enforce chronological order
  const sorted = [...items].sort((a, b) => {
    const aTs = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp;
    const bTs = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp;
    return aTs - bTs;
  });

  const total = sorted.length;
  const trainEnd = Math.floor(total * config.train_percent / 100);
  const valEnd = trainEnd + Math.floor(total * config.validation_percent / 100);

  const train = sorted.slice(0, trainEnd);
  const validation = sorted.slice(trainEnd, valEnd);
  const test = sorted.slice(valEnd);

  return {
    train,
    validation,
    test,
    split_timestamps: {
      train_end: train.length > 0 ? getTimestamp(train[train.length - 1]) : 'N/A',
      val_end: validation.length > 0 ? getTimestamp(validation[validation.length - 1]) : 'N/A',
    },
  };
}

function getTimestamp(item: { timestamp: string | number }): string {
  if (typeof item.timestamp === 'number') {
    return new Date(item.timestamp).toISOString();
  }
  return item.timestamp;
}

// ═══════════════════════════════════════════════════════════════════
// DATASET SIZE TRACKING (Section 18)
// ═══════════════════════════════════════════════════════════════════

export interface DatasetSizeReport {
  total_predictions: number;
  train_size: number;
  validation_size: number;
  test_size: number;
  /** 100+ is a MINIMUM technical threshold, NOT scientifically sufficient */
  meets_minimum_threshold: boolean;
  /** Important: minimum ≠ scientifically sufficient */
  minimum_is_not_sufficient: true;
  /** Wilson score interval for accuracy (95% CI) */
  accuracy_ci: { lower: number; upper: number } | null;
  /** Sample size warning */
  warning: string | null;
}

/**
 * Wilson score interval for binomial proportion (95% CI).
 * Used for accuracy confidence intervals.
 */
export function wilsonScoreInterval(successes: number, total: number, z: number = 1.96): { lower: number; upper: number } {
  if (total === 0) return { lower: 0, upper: 0 };

  const p = successes / total;
  const n = total;
  const z2 = z * z;

  const denominator = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);

  return {
    lower: Math.max(0, (center - spread) / denominator),
    upper: Math.min(1, (center + spread) / denominator),
  };
}

/**
 * Report dataset size with confidence intervals.
 * 100+ snapshots is a MINIMUM technical threshold.
 * It is NOT called "scientifically sufficient" automatically.
 */
export function reportDatasetSize(
  totalPredictions: number,
  trainSize: number,
  valSize: number,
  testSize: number,
  accuracy?: number,
): DatasetSizeReport {
  let warning: string | null = null;

  if (totalPredictions < 30) {
    warning = 'INSUFFICIENT: Fewer than 30 predictions. Results will be extremely uncertain. Continue collecting data.';
  } else if (totalPredictions < 100) {
    warning = 'BELOW MINIMUM: Fewer than 100 predictions. Pipeline verification possible, but scientific conclusions unreliable. Continue collecting data.';
  } else if (totalPredictions < 300) {
    warning = 'MINIMUM MET but NOT SUFFICIENT: 100+ predictions allow pipeline verification. However, confidence intervals will be wide. Continue collecting for tighter bounds.';
  } else if (totalPredictions < 1000) {
    warning = 'MODERATE: 300+ predictions. Confidence intervals narrowing. Consider continuing collection for robust statistical significance.';
  }

  // Compute accuracy CI if accuracy provided
  let accuracyCi: { lower: number; upper: number } | null = null;
  if (accuracy !== undefined && testSize > 0) {
    const successes = Math.round(accuracy * testSize);
    accuracyCi = wilsonScoreInterval(successes, testSize);
  }

  return {
    total_predictions: totalPredictions,
    train_size: trainSize,
    validation_size: valSize,
    test_size: testSize,
    meets_minimum_threshold: totalPredictions >= 100,
    minimum_is_not_sufficient: true,
    accuracy_ci: accuracyCi,
    warning,
  };
}

// ═══════════════════════════════════════════════════════════════════
// DATASET EXPORT (Section 19)
// ═══════════════════════════════════════════════════════════════════

export interface ExportablePrediction {
  prediction_timestamp: string;
  features: Record<string, unknown>;
  probabilities: { home: number; draw: number; away: number };
  odds: { home: number; draw: number; away: number };
  actual_outcome: '1' | 'X' | '2' | null;
  model_version: string;
  feature_version: string;
  config_version: string;
  provenance: string;
  split: DataSplit;
}

/**
 * Export a dataset for analysis.
 * NEVER export secrets, tokens, credentials, or unnecessary personal data.
 */
export function prepareExport(
  prediction: {
    prediction_timestamp: string;
    feature_snapshot: Record<string, unknown> | null;
    prob_home: number;
    prob_draw: number;
    prob_away: number;
    odd_home: number;
    odd_draw: number;
    odd_away: number;
    actual_outcome: string | null;
    model_version: string;
    feature_version: string;
    config_version: string;
    provenance_status: string;
  },
  split: DataSplit,
): ExportablePrediction {
  return {
    prediction_timestamp: prediction.prediction_timestamp,
    features: prediction.feature_snapshot || {},
    probabilities: {
      home: prediction.prob_home,
      draw: prediction.prob_draw,
      away: prediction.prob_away,
    },
    odds: {
      home: prediction.odd_home,
      draw: prediction.odd_draw,
      away: prediction.odd_away,
    },
    actual_outcome: (['1', 'X', '2'].includes(prediction.actual_outcome || '') ? prediction.actual_outcome : null) as '1' | 'X' | '2' | null,
    model_version: prediction.model_version,
    feature_version: prediction.feature_version,
    config_version: prediction.config_version,
    provenance: prediction.provenance_status,
    split,
  };
}

// ═══════════════════════════════════════════════════════════════════
// DATASET VALIDATION
// ═══════════════════════════════════════════════════════════════════

export interface ValidationIssue {
  level: 'ERROR' | 'WARNING';
  message: string;
  prediction_id?: string | number;
}

export interface DatasetValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    without_snapshot: number;
    without_hash: number;
    without_provenance: number;
    potential_leakage: number;
  };
}

/**
 * Validate an exported dataset for scientific integrity.
 */
export function validateExportedDataset(predictions: ExportablePrediction[]): DatasetValidationResult {
  const issues: ValidationIssue[] = [];
  let withoutSnapshot = 0;
  let withoutHash = 0;
  let withoutProvenance = 0;
  let potentialLeakage = 0;

  for (const p of predictions) {
    // Check snapshot
    if (!p.features || Object.keys(p.features).length === 0) {
      withoutSnapshot++;
      issues.push({ level: 'WARNING', message: 'No feature snapshot', prediction_id: p.prediction_timestamp });
    }

    // Check provenance
    if (!p.provenance || p.provenance === 'UNKNOWN') {
      withoutProvenance++;
      issues.push({ level: 'WARNING', message: `Provenance: ${p.provenance}`, prediction_id: p.prediction_timestamp });
    }

    if (p.provenance === 'UNSAFE') {
      potentialLeakage++;
      issues.push({ level: 'ERROR', message: 'UNSAFE provenance detected', prediction_id: p.prediction_timestamp });
    }

    // Check probabilities sum
    const probSum = p.probabilities.home + p.probabilities.draw + p.probabilities.away;
    if (Math.abs(probSum - 1.0) > 0.05) {
      issues.push({ level: 'ERROR', message: `Probabilities sum = ${probSum.toFixed(3)} (expected ~1.0)`, prediction_id: p.prediction_timestamp });
    }
  }

  const errors = issues.filter(i => i.level === 'ERROR').length;
  const warnings = issues.filter(i => i.level === 'WARNING').length;

  return {
    valid: errors === 0 && potentialLeakage === 0,
    issues,
    summary: {
      total: predictions.length,
      errors,
      warnings,
      without_snapshot: withoutSnapshot,
      without_hash: withoutHash,
      without_provenance: withoutProvenance,
      potential_leakage: potentialLeakage,
    },
  };
}
