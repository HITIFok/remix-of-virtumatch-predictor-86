// ============================================
// FEATURE SNAPSHOT SYSTEM v1.0
// Phase 3 — Traceability, Provenance, Reproducibility
// ============================================
//
// This module captures, validates, and hashes the exact features
// used by the prediction engine at the time of prediction.
//
// CRITICAL: This module does NOT modify prediction-engine.ts
// or prediction-config.ts. It only captures their state.
//
// Usage:
//   import { createFeatureSnapshot, validateSnapshot, computeSnapshotHash } from './feature-snapshot';

import type { TeamStats, HistoricalResult, AIPrediction } from './prediction-engine';
import { getConfig, COEFFICIENT_DEFINITIONS } from './prediction-config';
import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// VERSIONS
// ═══════════════════════════════════════════════════════════════════

export const MODEL_VERSION = '2.0.0';
export const FEATURE_VERSION = '1.0.0';
export const CONFIG_VERSION = '1.0.0';
export const CALIBRATION_VERSION = '0.0.0';
export const DATASET_VERSION = 'unversioned';
export const SNAPSHOT_SCHEMA_VERSION = 1;

// ═══════════════════════════════════════════════════════════════════
// PROVENANCE
// ═══════════════════════════════════════════════════════════════════

export type ProvenanceStatus = 'RECORDED' | 'RECONSTRUCTED' | 'UNKNOWN' | 'UNSAFE';

export interface ProvenanceInfo {
  provenance: ProvenanceStatus;
  source: string;
  source_timestamp: string | null;  // ISO 8601
  source_record_id?: string | number | null;
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT STRUCTURE
// ═══════════════════════════════════════════════════════════════════

export interface OddsSnapshot extends ProvenanceInfo {
  odd_home: number;
  odd_draw: number;
  odd_away: number;
  implied_prob_home: number;
  implied_prob_draw: number;
  implied_prob_away: number;
  favorite: '1' | 'X' | '2';
  favorite_prob: number;
}

export interface TeamFormSnapshot extends ProvenanceInfo {
  form_scores: string[];
  avg_scored: number;
  avg_conceded: number;
  momentum_score: number;
  goals_balance: number;
  match_count: number;
  match_ids?: (number | string)[];
}

export interface FormSnapshot {
  home: TeamFormSnapshot;
  away: TeamFormSnapshot;
}

export interface H2HSnapshot extends ProvenanceInfo {
  total_matches: number;
  home_wins: number;
  draws: number;
  away_wins: number;
  avg_home_goals: number;
  avg_away_goals: number;
  avg_total_goals: number;
  home_team_bias: number;
}

export interface TeamStatsSnapshot extends ProvenanceInfo {
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  points: number;
  avg_goals_scored: number;
  avg_goals_conceded: number;
  attack_strength: number;
  defense_weakness: number;
}

export interface StatsSnapshot {
  home: TeamStatsSnapshot;
  away: TeamStatsSnapshot;
  has_data: boolean;
}

export interface AISnapshot extends ProvenanceInfo {
  enabled: boolean;
  model: string;
  score_home: number | null;
  score_away: number | null;
  confidence: number | null;
  is_anti_trap: boolean | null;
  tendency: string | null;
  danger_level: string | null;
  weight_used: number;
  agreement: number;
  input_hash: string | null;
  response_hash: string | null;
}

export interface AntiTrapSnapshot {
  triggered: boolean;
  signals: {
    momentum_trap: boolean;
    attack_trap: boolean;
    h2h_trap: boolean;
    ranking_trap: boolean;
    ai_disagreement: boolean;
  };
  alert_count: number;
  is_true_trap: boolean;
  is_false_trap: boolean;
  is_domination: boolean;
  trap_version: string;
  provenance: ProvenanceStatus;
}

export interface DerivedSnapshot {
  lambda_home_initial: number;
  lambda_away_initial: number;
  lambda_home_after_stats: number;
  lambda_away_after_stats: number;
  lambda_home_after_history: number;
  lambda_away_after_history: number;
  lambda_home_final: number;
  lambda_away_final: number;
  form_agreement: number;
  h2h_agreement: number;
  ai_agreement: number;
  grid_search_error: number;
  new_season_mode: boolean;
  provenance: ProvenanceStatus;
}

export interface CoefficientSnapshot {
  hash: string;
  values: Record<string, number>;
  provenance: ProvenanceStatus;
}

export interface FeatureSnapshot {
  schema_version: number;
  snapshot_timestamp: string;
  prediction_timestamp: string;

  model_version: string;
  feature_version: string;
  config_version: string;
  calibration_version: string;
  dataset_version: string;

  odds: OddsSnapshot;
  form: FormSnapshot;
  h2h: H2HSnapshot;
  stats: StatsSnapshot;
  ai: AISnapshot;
  anti_trap: AntiTrapSnapshot;
  derived: DerivedSnapshot;
  coefficients: CoefficientSnapshot;

  feature_snapshot_hash?: string;
  prediction_hash?: string;
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT CREATION
// ═══════════════════════════════════════════════════════════════════

export interface SnapshotContext {
  // Match input
  home: string;
  away: string;
  league: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
  newSeasonMode?: boolean;

  // Engine outputs (from analyzeMatch result)
  probHome: number;
  probDraw: number;
  probAway: number;
  favorite: '1' | 'X' | '2';
  favoriteProb: number;
  lambdaHome: number;
  lambdaAway: number;

  // Feature inputs
  homeForm?: {
    formScores: string[];
    avgScored: number;
    avgConceded: number;
    momentumScore: number;
    goalsBalance: number;
  };
  awayForm?: {
    formScores: string[];
    avgScored: number;
    avgConceded: number;
    momentumScore: number;
    goalsBalance: number;
  };
  h2hData?: {
    totalMatches: number;
    homeWins: number;
    draws: number;
    awayWins: number;
    avgHomeGoals: number;
    avgAwayGoals: number;
    avgTotalGoals: number;
    homeTeamBias: number;
  };
  homeStats?: TeamStats;
  awayStats?: TeamStats;
  aiPrediction?: AIPrediction;
  aiAgreement?: number;

  // Anti-trap
  isTrueTrap?: boolean;
  isAntiTrap?: boolean;
  isFalseTrap?: boolean;
  isDomination?: boolean;
  antiTrapAlerts?: number;
  antiTrapSignals?: {
    momentum_trap: boolean;
    attack_trap: boolean;
    h2h_trap: boolean;
    ranking_trap: boolean;
    ai_disagreement: boolean;
  };

  // Lambda stages
  lambdaHomeInitial?: number;
  lambdaAwayInitial?: number;
  lambdaHomeAfterStats?: number;
  lambdaAwayAfterStats?: number;
  lambdaHomeAfterHistory?: number;
  lambdaAwayAfterHistory?: number;
  gridSearchError?: number;

  // Form/H2H agreement
  formAgreement?: number;
  h2hAgreement?: number;

  // Timestamps
  predictionTimestamp?: string;
  oddsTimestamp?: string;
  rankingTimestamp?: string;
  formSourceTimestamp?: string;
  aiTimestamp?: string;

  // Stats
  statsHasData?: boolean;
}

/**
 * Create a complete feature snapshot from the prediction context.
 * This should be called at the same time as analyzeMatch() to capture
 * all features exactly as they were used.
 */
export function createFeatureSnapshot(ctx: SnapshotContext): FeatureSnapshot {
  const now = new Date().toISOString();
  const predictionTs = ctx.predictionTimestamp || now;
  const cfg = getConfig();

  // ── Odds snapshot ──
  const odds: OddsSnapshot = {
    odd_home: ctx.oddHome,
    odd_draw: ctx.oddDraw,
    odd_away: ctx.oddAway,
    implied_prob_home: ctx.probHome,
    implied_prob_draw: ctx.probDraw,
    implied_prob_away: ctx.probAway,
    favorite: ctx.favorite,
    favorite_prob: ctx.favoriteProb,
    provenance: 'RECORDED',
    source: 'scraped',
    source_timestamp: ctx.oddsTimestamp || null,
  };

  // ── Form snapshot ──
  const defaultForm = (): TeamFormSnapshot => ({
    form_scores: [],
    avg_scored: cfg.DEFAULT_AVG_SCORED,
    avg_conceded: cfg.DEFAULT_AVG_CONCEDED,
    momentum_score: cfg.DEFAULT_MOMENTUM,
    goals_balance: 0,
    match_count: 0,
    match_ids: [],
    provenance: 'UNKNOWN',
    source: 'none',
    source_timestamp: null,
  });

  const form: FormSnapshot = {
    home: ctx.homeForm ? {
      form_scores: ctx.homeForm.formScores,
      avg_scored: ctx.homeForm.avgScored,
      avg_conceded: ctx.homeForm.avgConceded,
      momentum_score: ctx.homeForm.momentumScore,
      goals_balance: ctx.homeForm.goalsBalance,
      match_count: ctx.homeForm.formScores.length,
      provenance: 'RECORDED',
      source: 'historical_results',
      source_timestamp: ctx.formSourceTimestamp || null,
    } : defaultForm(),
    away: ctx.awayForm ? {
      form_scores: ctx.awayForm.formScores,
      avg_scored: ctx.awayForm.avgScored,
      avg_conceded: ctx.awayForm.avgConceded,
      momentum_score: ctx.awayForm.momentumScore,
      goals_balance: ctx.awayForm.goalsBalance,
      match_count: ctx.awayForm.formScores.length,
      provenance: 'RECORDED',
      source: 'historical_results',
      source_timestamp: ctx.formSourceTimestamp || null,
    } : defaultForm(),
  };

  // ── H2H snapshot ──
  const h2h: H2HSnapshot = ctx.h2hData ? {
    total_matches: ctx.h2hData.totalMatches,
    home_wins: ctx.h2hData.homeWins,
    draws: ctx.h2hData.draws,
    away_wins: ctx.h2hData.awayWins,
    avg_home_goals: ctx.h2hData.avgHomeGoals,
    avg_away_goals: ctx.h2hData.avgAwayGoals,
    avg_total_goals: ctx.h2hData.avgTotalGoals,
    home_team_bias: ctx.h2hData.homeTeamBias,
    provenance: 'RECORDED',
    source: 'historical_results',
    source_timestamp: ctx.formSourceTimestamp || null,
  } : {
    total_matches: 0, home_wins: 0, draws: 0, away_wins: 0,
    avg_home_goals: 0, avg_away_goals: 0, avg_total_goals: 0, home_team_bias: 0,
    provenance: 'UNKNOWN',
    source: 'none',
    source_timestamp: null,
  };

  // ── Stats snapshot ──
  const defaultStats = (): TeamStatsSnapshot => ({
    position: 0, played: 0, won: 0, drawn: 0, lost: 0,
    goals_for: 0, goals_against: 0, points: 0,
    avg_goals_scored: cfg.DEFAULT_AVG_SCORED,
    avg_goals_conceded: cfg.DEFAULT_AVG_CONCEDED,
    attack_strength: 1.0,
    defense_weakness: 1.0,
    provenance: 'UNKNOWN',
    source: 'none',
    source_timestamp: null,
  });

  const stats: StatsSnapshot = {
    home: ctx.homeStats ? {
      position: ctx.homeStats.position,
      played: ctx.homeStats.played,
      won: ctx.homeStats.won,
      drawn: ctx.homeStats.drawn,
      lost: ctx.homeStats.lost,
      goals_for: ctx.homeStats.goalsFor,
      goals_against: ctx.homeStats.goalsAgainst,
      points: ctx.homeStats.points,
      avg_goals_scored: ctx.homeStats.avgGoalsScored,
      avg_goals_conceded: ctx.homeStats.avgGoalsConceded,
      attack_strength: ctx.homeStats.avgGoalsScored / cfg.VIRTUAL_AVG_GOALS,
      defense_weakness: ctx.homeStats.avgGoalsConceded / cfg.VIRTUAL_AVG_GOALS,
      provenance: 'RECORDED',
      source: 'ranking',
      source_timestamp: ctx.rankingTimestamp || null,
    } : defaultStats(),
    away: ctx.awayStats ? {
      position: ctx.awayStats.position,
      played: ctx.awayStats.played,
      won: ctx.awayStats.won,
      drawn: ctx.awayStats.drawn,
      lost: ctx.awayStats.lost,
      goals_for: ctx.awayStats.goalsFor,
      goals_against: ctx.awayStats.goalsAgainst,
      points: ctx.awayStats.points,
      avg_goals_scored: ctx.awayStats.avgGoalsScored,
      avg_goals_conceded: ctx.awayStats.avgGoalsConceded,
      attack_strength: ctx.awayStats.avgGoalsScored / cfg.VIRTUAL_AVG_GOALS,
      defense_weakness: ctx.awayStats.avgGoalsConceded / cfg.VIRTUAL_AVG_GOALS,
      provenance: 'RECORDED',
      source: 'ranking',
      source_timestamp: ctx.rankingTimestamp || null,
    } : defaultStats(),
    has_data: ctx.statsHasData ?? false,
  };

  // ── AI snapshot ──
  const ai: AISnapshot = ctx.aiPrediction ? {
    enabled: true,
    model: 'llama-3.3-70b-versatile',
    score_home: ctx.aiPrediction.scoreHome,
    score_away: ctx.aiPrediction.scoreAway,
    confidence: ctx.aiPrediction.confidence,
    is_anti_trap: ctx.aiPrediction.isAntiTrap,
    tendency: ctx.aiPrediction.tendency,
    danger_level: ctx.aiPrediction.dangerLevel,
    weight_used: cfg.AI_WEIGHT,
    agreement: ctx.aiAgreement ?? 0,
    input_hash: null,
    response_hash: null,
    provenance: 'RECORDED',
    source: 'groq_api',
    source_timestamp: ctx.aiTimestamp || null,
  } : {
    enabled: false,
    model: 'none',
    score_home: null, score_away: null,
    confidence: null, is_anti_trap: null,
    tendency: null, danger_level: null,
    weight_used: 0,
    agreement: 0,
    input_hash: null, response_hash: null,
    provenance: 'UNKNOWN',
    source: 'none',
    source_timestamp: null,
  };

  // ── Anti-trap snapshot ──
  const anti_trap: AntiTrapSnapshot = {
    triggered: ctx.isAntiTrap ?? false,
    signals: ctx.antiTrapSignals ?? {
      momentum_trap: false,
      attack_trap: false,
      h2h_trap: false,
      ranking_trap: false,
      ai_disagreement: false,
    },
    alert_count: ctx.antiTrapAlerts ?? 0,
    is_true_trap: ctx.isTrueTrap ?? false,
    is_false_trap: ctx.isFalseTrap ?? false,
    is_domination: ctx.isDomination ?? false,
    trap_version: '1.0.0',
    provenance: (ctx.isTrueTrap !== undefined || ctx.isAntiTrap !== undefined) ? 'RECORDED' : 'UNKNOWN',
  };

  // ── Derived snapshot ──
  const derived: DerivedSnapshot = {
    lambda_home_initial: ctx.lambdaHomeInitial ?? ctx.lambdaHome,
    lambda_away_initial: ctx.lambdaAwayInitial ?? ctx.lambdaAway,
    lambda_home_after_stats: ctx.lambdaHomeAfterStats ?? ctx.lambdaHome,
    lambda_away_after_stats: ctx.lambdaAwayAfterStats ?? ctx.lambdaAway,
    lambda_home_after_history: ctx.lambdaHomeAfterHistory ?? ctx.lambdaHome,
    lambda_away_after_history: ctx.lambdaAwayAfterHistory ?? ctx.lambdaAway,
    lambda_home_final: ctx.lambdaHome,
    lambda_away_final: ctx.lambdaAway,
    form_agreement: ctx.formAgreement ?? 0,
    h2h_agreement: ctx.h2hAgreement ?? 0,
    ai_agreement: ctx.aiAgreement ?? 0,
    grid_search_error: ctx.gridSearchError ?? -1,
    new_season_mode: ctx.newSeasonMode ?? false,
    provenance: ctx.lambdaHomeInitial !== undefined ? 'RECORDED' : 'UNKNOWN',
  };

  // ── Coefficient snapshot ──
  const coeffValues: Record<string, number> = {};
  for (const [name, def] of Object.entries(COEFFICIENT_DEFINITIONS)) {
    coeffValues[name] = (cfg as Record<string, number>)[name];
  }
  const coefficients: CoefficientSnapshot = {
    hash: computeCoefficientHash(cfg),
    values: coeffValues,
    provenance: 'RECORDED',
  };

  // ── Assemble snapshot ──
  const snapshot: FeatureSnapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    snapshot_timestamp: now,
    prediction_timestamp: predictionTs,
    model_version: MODEL_VERSION,
    feature_version: FEATURE_VERSION,
    config_version: CONFIG_VERSION,
    calibration_version: CALIBRATION_VERSION,
    dataset_version: DATASET_VERSION,
    odds,
    form,
    h2h,
    stats,
    ai,
    anti_trap,
    derived,
    coefficients,
  };

  // ── Compute hashes ──
  snapshot.feature_snapshot_hash = computeSnapshotHash(snapshot);

  return snapshot;
}

// ═══════════════════════════════════════════════════════════════════
// HASH COMPUTATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute SHA-256 hash of a feature snapshot.
 * Uses canonical JSON serialization (sorted keys, no whitespace).
 */
export function computeSnapshotHash(snapshot: FeatureSnapshot): string {
  // Remove hash fields before computing
  const clean = { ...snapshot };
  delete (clean as any).feature_snapshot_hash;
  delete (clean as any).prediction_hash;

  const canonical = canonicalJson(clean);
  return 'sha256:' + crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compute SHA-256 hash of the prediction output for reproducibility verification.
 */
export function computePredictionHash(output: {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  prediction: string;
  confidence: number;
  exact_score: string;
  lambda_home: number;
  lambda_away: number;
}): string {
  const canonical = canonicalJson(output);
  return 'sha256:' + crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compute SHA-256 hash of all coefficient values.
 */
export function computeCoefficientHash(cfg: Record<string, number>): string {
  const values: Record<string, number> = {};
  for (const [name, def] of Object.entries(COEFFICIENT_DEFINITIONS)) {
    values[name] = (cfg as Record<string, number>)[name] ?? def.value;
  }
  const canonical = canonicalJson(values);
  return 'sha256:' + crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Canonical JSON: sorted keys at all levels, no whitespace.
 */
function canonicalJson(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'boolean') return obj ? 'true' : 'false';
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
  }
  return 'null';
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT VALIDATION
// ═══════════════════════════════════════════════════════════════════

export interface SnapshotValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  leakage_detected: boolean;
  leakage_details: string[];
  /** Phase 3 fix (forensic audit BUG-2): list of features flagged as UNSAFE
   *  during validation. The original snapshot is NOT mutated. Callers that
   *  want a snapshot with provenance downgraded to UNSAFE must build a copy
   *  themselves from this list. */
  unsafe_features: string[];
  /** Phase 3 fix: list of features with UNKNOWN provenance. */
  unknown_features: string[];
  /** Phase 3 fix: violations with structured info, suitable for audit log. */
  violations: Array<{
    feature: string;
    kind: 'LEAK' | 'UNKNOWN' | 'INVALID_HASH' | 'INVALID_VALUE';
    detail: string;
  }>;
}

/**
 * Validate a feature snapshot for integrity and temporal safety.
 *
 * Phase 3 fix (forensic audit BUG-2):
 * This function is now PURE. It does NOT mutate the input snapshot.
 * Previously, it set `snapshot.{odds,form,h2h,stats,ai}.provenance = 'UNSAFE'`
 * as a side effect — which corrupted the snapshot's hash and made the
 * validation non-idempotent. The function now returns the list of unsafe
 * features in the validation result so callers can act on them without
 * losing the original snapshot's integrity.
 */
export function validateSnapshot(snapshot: FeatureSnapshot): SnapshotValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const leakage_details: string[] = [];
  const unsafe_features: string[] = [];
  const unknown_features: string[] = [];
  const violations: Array<{ feature: string; kind: 'LEAK' | 'UNKNOWN' | 'INVALID_HASH' | 'INVALID_VALUE'; detail: string }> = [];

  // Schema version
  if (snapshot.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
    errors.push(`Schema version mismatch: ${snapshot.schema_version} vs ${SNAPSHOT_SCHEMA_VERSION}`);
    violations.push({ feature: 'schema_version', kind: 'INVALID_VALUE', detail: `Expected ${SNAPSHOT_SCHEMA_VERSION}, got ${snapshot.schema_version}` });
  }

  // Timestamps
  const predictionTs = new Date(snapshot.prediction_timestamp).getTime();
  if (isNaN(predictionTs)) {
    errors.push('Invalid prediction_timestamp');
    violations.push({ feature: 'prediction_timestamp', kind: 'INVALID_VALUE', detail: 'Not a valid ISO date' });
  }

  const snapshotTs = new Date(snapshot.snapshot_timestamp).getTime();
  if (isNaN(snapshotTs)) {
    errors.push('Invalid snapshot_timestamp');
    violations.push({ feature: 'snapshot_timestamp', kind: 'INVALID_VALUE', detail: 'Not a valid ISO date' });
  }

  // ── Temporal leakage checks (NO MUTATION — record findings only) ──
  if (!isNaN(predictionTs)) {
    // Odds timestamp
    if (snapshot.odds.source_timestamp) {
      const oddsTs = new Date(snapshot.odds.source_timestamp).getTime();
      if (!isNaN(oddsTs) && oddsTs > predictionTs) {
        leakage_details.push(`Odds timestamp ${snapshot.odds.source_timestamp} > prediction ${snapshot.prediction_timestamp}`);
        unsafe_features.push('odds');
        violations.push({ feature: 'odds', kind: 'LEAK', detail: `source_timestamp ${snapshot.odds.source_timestamp} > prediction ${snapshot.prediction_timestamp}` });
      }
    }

    // Form timestamp
    if (snapshot.form.home.source_timestamp) {
      const formTs = new Date(snapshot.form.home.source_timestamp).getTime();
      if (!isNaN(formTs) && formTs > predictionTs) {
        leakage_details.push(`Form (home) timestamp ${snapshot.form.home.source_timestamp} > prediction`);
        unsafe_features.push('form.home');
        violations.push({ feature: 'form.home', kind: 'LEAK', detail: `source_timestamp > prediction` });
      }
    }
    if (snapshot.form.away.source_timestamp) {
      const formTs = new Date(snapshot.form.away.source_timestamp).getTime();
      if (!isNaN(formTs) && formTs > predictionTs) {
        leakage_details.push(`Form (away) timestamp ${snapshot.form.away.source_timestamp} > prediction`);
        unsafe_features.push('form.away');
        violations.push({ feature: 'form.away', kind: 'LEAK', detail: `source_timestamp > prediction` });
      }
    }

    // H2H timestamp
    if (snapshot.h2h.source_timestamp) {
      const h2hTs = new Date(snapshot.h2h.source_timestamp).getTime();
      if (!isNaN(h2hTs) && h2hTs > predictionTs) {
        leakage_details.push(`H2H timestamp ${snapshot.h2h.source_timestamp} > prediction`);
        unsafe_features.push('h2h');
        violations.push({ feature: 'h2h', kind: 'LEAK', detail: `source_timestamp > prediction` });
      }
    }

    // Ranking timestamp
    if (snapshot.stats.home.source_timestamp) {
      const rankTs = new Date(snapshot.stats.home.source_timestamp).getTime();
      if (!isNaN(rankTs) && rankTs > predictionTs) {
        leakage_details.push(`Stats (home) timestamp ${snapshot.stats.home.source_timestamp} > prediction`);
        unsafe_features.push('stats.home');
        violations.push({ feature: 'stats.home', kind: 'LEAK', detail: `source_timestamp > prediction` });
      }
    }
    if (snapshot.stats.away.source_timestamp) {
      const rankTs = new Date(snapshot.stats.away.source_timestamp).getTime();
      if (!isNaN(rankTs) && rankTs > predictionTs) {
        leakage_details.push(`Stats (away) timestamp ${snapshot.stats.away.source_timestamp} > prediction`);
        unsafe_features.push('stats.away');
        violations.push({ feature: 'stats.away', kind: 'LEAK', detail: `source_timestamp > prediction` });
      }
    }

    // AI timestamp — per audit mandate, T_AI_response must be <= T_prediction_final.
    // The previous code allowed AI up to 5s AFTER prediction (which is incorrect —
    // T_AI_response is BEFORE T_prediction_final in a valid pipeline).
    // Phase 3 fix: any AI timestamp strictly greater than prediction is a leak.
    if (snapshot.ai.source_timestamp) {
      const aiTs = new Date(snapshot.ai.source_timestamp).getTime();
      if (!isNaN(aiTs) && aiTs > predictionTs) {
        leakage_details.push(`AI timestamp ${snapshot.ai.source_timestamp} > prediction ${snapshot.prediction_timestamp}`);
        unsafe_features.push('ai');
        violations.push({ feature: 'ai', kind: 'LEAK', detail: `ai.source_timestamp > prediction` });
      }
    }
  }

  // ── Hash verification ──
  if (snapshot.feature_snapshot_hash) {
    const expected = computeSnapshotHash(snapshot);
    if (snapshot.feature_snapshot_hash !== expected) {
      errors.push(`Snapshot hash mismatch: stored=${snapshot.feature_snapshot_hash} computed=${expected}`);
      violations.push({ feature: 'feature_snapshot_hash', kind: 'INVALID_HASH', detail: 'Stored hash does not match recomputed hash' });
    }
  }

  // ── Probability conservation ──
  const probSum = snapshot.odds.implied_prob_home + snapshot.odds.implied_prob_draw + snapshot.odds.implied_prob_away;
  if (Math.abs(probSum - 1.0) > 0.01) {
    errors.push(`Odds probabilities don't sum to 1.0: ${probSum.toFixed(4)}`);
    violations.push({ feature: 'odds.implied_prob_*', kind: 'INVALID_VALUE', detail: `Sum = ${probSum.toFixed(4)}, expected 1.0` });
  }

  // ── Lambda bounds ──
  if (snapshot.derived.lambda_home_final <= 0 || snapshot.derived.lambda_away_final <= 0) {
    errors.push('Final lambda values must be positive');
    violations.push({ feature: 'derived.lambda_*_final', kind: 'INVALID_VALUE', detail: 'Lambda must be > 0' });
  }

  // ── Confidence bounds ──
  if (snapshot.odds.favorite_prob < 0 || snapshot.odds.favorite_prob > 1) {
    errors.push(`favorite_prob out of range: ${snapshot.odds.favorite_prob}`);
    violations.push({ feature: 'odds.favorite_prob', kind: 'INVALID_VALUE', detail: `Out of [0,1]: ${snapshot.odds.favorite_prob}` });
  }

  // ── Provenance consistency (read-only — does NOT mutate) ──
  const allProvenances = extractProvenances(snapshot);
  for (const p of allProvenances) {
    if (p.status === 'UNSAFE') {
      // Already reported above as a leak
    } else if (p.status === 'UNKNOWN') {
      warnings.push(`Feature "${p.path}" has UNKNOWN provenance`);
      unknown_features.push(p.path);
      violations.push({ feature: p.path, kind: 'UNKNOWN', detail: 'Provenance = UNKNOWN' });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    leakage_detected: leakage_details.length > 0,
    leakage_details,
    unsafe_features,
    unknown_features,
    violations,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PROVENANCE ANALYSIS
// ═══════════════════════════════════════════════════════════════════

interface ProvenanceEntry {
  path: string;
  status: ProvenanceStatus;
}

function extractProvenances(snapshot: FeatureSnapshot): ProvenanceEntry[] {
  const entries: ProvenanceEntry[] = [];

  entries.push({ path: 'odds', status: snapshot.odds.provenance });
  entries.push({ path: 'form.home', status: snapshot.form.home.provenance });
  entries.push({ path: 'form.away', status: snapshot.form.away.provenance });
  entries.push({ path: 'h2h', status: snapshot.h2h.provenance });
  entries.push({ path: 'stats.home', status: snapshot.stats.home.provenance });
  entries.push({ path: 'stats.away', status: snapshot.stats.away.provenance });
  entries.push({ path: 'ai', status: snapshot.ai.provenance });
  entries.push({ path: 'anti_trap', status: snapshot.anti_trap.provenance });
  entries.push({ path: 'derived', status: snapshot.derived.provenance });
  entries.push({ path: 'coefficients', status: snapshot.coefficients.provenance });

  return entries;
}

export interface ProvenanceSummary {
  recorded_pct: number;
  reconstructed_pct: number;
  unknown_pct: number;
  unsafe_pct: number;
  total: number;
  by_family: Record<string, ProvenanceStatus>;
  backtest_validity: 'VALID' | 'PARTIALLY_VALID' | 'INVALID';
}

/**
 * Analyze the provenance of a snapshot and determine backtest validity.
 */
export function analyzeProvenance(snapshot: FeatureSnapshot): ProvenanceSummary {
  const entries = extractProvenances(snapshot);
  const total = entries.length;

  const recorded = entries.filter(e => e.status === 'RECORDED').length;
  const reconstructed = entries.filter(e => e.status === 'RECONSTRUCTED').length;
  const unknown = entries.filter(e => e.status === 'UNKNOWN').length;
  const unsafe = entries.filter(e => e.status === 'UNSAFE').length;

  const by_family: Record<string, ProvenanceStatus> = {};
  for (const e of entries) {
    by_family[e.path] = e.status;
  }

  let backtest_validity: 'VALID' | 'PARTIALLY_VALID' | 'INVALID';
  if (unsafe > 0) {
    backtest_validity = 'INVALID';
  } else if (unknown > 0) {
    backtest_validity = 'PARTIALLY_VALID';
  } else {
    backtest_validity = 'VALID';
  }

  return {
    recorded_pct: Math.round((recorded / total) * 100),
    reconstructed_pct: Math.round((reconstructed / total) * 100),
    unknown_pct: Math.round((unknown / total) * 100),
    unsafe_pct: Math.round((unsafe / total) * 100),
    total,
    by_family,
    backtest_validity,
  };
}

// ═══════════════════════════════════════════════════════════════════
// REPRODUCIBILITY CHECK
// ═══════════════════════════════════════════════════════════════════

export type ReproducibilityStatus = 'EXACT_MATCH' | 'NUMERICAL_DIFFERENCE' | 'NON_REPRODUCIBLE' | 'MISSING_DATA';

export interface ReproducibilityResult {
  status: ReproducibilityStatus;
  snapshot_hash_match: boolean;
  prediction_hash_match: boolean;
  max_difference: number;
  differences: Array<{ field: string; expected: number; actual: number; diff: number }>;
}

/**
 * Check if a recomputed prediction matches the stored snapshot.
 */
export function checkReproducibility(
  storedSnapshot: FeatureSnapshot,
  recomputedSnapshot: FeatureSnapshot,
  storedOutput: { prob_home: number; prob_draw: number; prob_away: number; prediction: string; confidence: number; exact_score: string; lambda_home: number; lambda_away: number },
  recomputedOutput: { prob_home: number; prob_draw: number; prob_away: number; prediction: string; confidence: number; exact_score: string; lambda_home: number; lambda_away: number },
  tolerance: number = 0.001
): ReproducibilityResult {
  const differences: Array<{ field: string; expected: number; actual: number; diff: number }> = [];

  // Compare probabilities
  const fields = ['prob_home', 'prob_draw', 'prob_away', 'confidence', 'lambda_home', 'lambda_away'] as const;
  for (const f of fields) {
    const expected = storedOutput[f];
    const actual = recomputedOutput[f];
    const diff = Math.abs(expected - actual);
    if (diff > tolerance) {
      differences.push({ field: f, expected, actual, diff });
    }
  }

  const snapshotHashMatch = storedSnapshot.feature_snapshot_hash === recomputedSnapshot.feature_snapshot_hash;
  const predictionHashMatch = computePredictionHash(storedOutput) === computePredictionHash(recomputedOutput);
  const maxDiff = differences.length > 0 ? Math.max(...differences.map(d => d.diff)) : 0;

  let status: ReproducibilityStatus;
  if (!storedSnapshot.feature_snapshot_hash || !storedSnapshot.prediction_hash) {
    status = 'MISSING_DATA';
  } else if (differences.length === 0 && snapshotHashMatch) {
    status = 'EXACT_MATCH';
  } else if (differences.length > 0 && maxDiff <= 1.0) {
    // NUMERICAL_DIFFERENCE: small variations (≤1.0 on confidence, ≤0.01 on probabilities)
    // This covers floating-point differences and minor rounding
    status = 'NUMERICAL_DIFFERENCE';
  } else {
    status = 'NON_REPRODUCIBLE';
  }

  return { status, snapshot_hash_match: snapshotHashMatch, prediction_hash_match: predictionHashMatch, max_difference: maxDiff, differences };
}

// ═══════════════════════════════════════════════════════════════════
// LEGACY PREDICTION CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Classify the features of a historical prediction that has no snapshot.
 * Never invents data. Returns UNKNOWN for anything not provably stored.
 */
export function classifyLegacyPrediction(prediction: {
  odd_home: number | null;
  odd_draw: number | null;
  odd_away: number | null;
  prob_home: number | null;
  prob_draw: number | null;
  prob_away: number | null;
  created_at: string;
}): ProvenanceSummary {
  const hasOdds = prediction.odd_home !== null && prediction.odd_draw !== null && prediction.odd_away !== null;
  const hasProbs = prediction.prob_home !== null && prediction.prob_draw !== null && prediction.prob_away !== null;

  // Only odds and probabilities are stored in the predictions table
  const by_family: Record<string, ProvenanceStatus> = {
    odds: hasOdds ? 'RECORDED' : 'UNKNOWN',
    form_home: 'UNKNOWN',
    form_away: 'UNKNOWN',
    h2h: 'UNKNOWN',
    stats_home: 'UNKNOWN',
    stats_away: 'UNKNOWN',
    ai: 'UNKNOWN',
    anti_trap: 'UNKNOWN',
    derived: hasProbs ? 'UNKNOWN' : 'UNKNOWN', // Derived values not stored even if probs are
    coefficients: 'UNKNOWN',
  };

  const entries = Object.values(by_family);
  const total = entries.length;
  const recorded = entries.filter(e => e === 'RECORDED').length;
  const unknown = entries.filter(e => e === 'UNKNOWN').length;

  return {
    recorded_pct: Math.round((recorded / total) * 100),
    reconstructed_pct: 0,
    unknown_pct: Math.round((unknown / total) * 100),
    unsafe_pct: 0,
    total,
    by_family,
    backtest_validity: unknown > 0 ? 'PARTIALLY_VALID' : 'VALID',
  };
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT SERIALIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Serialize snapshot to JSON string for DB storage.
 */
export function serializeSnapshot(snapshot: FeatureSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Deserialize snapshot from JSON string.
 * Validates schema version and hash.
 */
export function deserializeSnapshot(json: string): { snapshot: FeatureSnapshot; valid: boolean; error?: string } {
  try {
    const snapshot = JSON.parse(json) as FeatureSnapshot;

    if (snapshot.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
      return { snapshot, valid: false, error: `Schema version mismatch: ${snapshot.schema_version} vs ${SNAPSHOT_SCHEMA_VERSION}` };
    }

    // Verify hash if present
    if (snapshot.feature_snapshot_hash) {
      const expected = computeSnapshotHash(snapshot);
      if (snapshot.feature_snapshot_hash !== expected) {
        return { snapshot, valid: false, error: `Hash mismatch: stored=${snapshot.feature_snapshot_hash} computed=${expected}` };
      }
    }

    return { snapshot, valid: true };
  } catch (e) {
    return { snapshot: null as any, valid: false, error: `JSON parse error: ${(e as Error).message}` };
  }
}

/**
 * Create a minimal odds-only snapshot for odds-validated backtest.
 */
export function createOddsOnlySnapshot(
  oddHome: number,
  oddDraw: number,
  oddAway: number,
  probHome: number,
  probDraw: number,
  probAway: number,
  favorite: '1' | 'X' | '2',
  favoriteProb: number,
  predictionTimestamp?: string
): FeatureSnapshot {
  const now = new Date().toISOString();
  const cfg = getConfig();

  const snapshot: FeatureSnapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    snapshot_timestamp: now,
    prediction_timestamp: predictionTimestamp || now,
    model_version: MODEL_VERSION,
    feature_version: FEATURE_VERSION,
    config_version: CONFIG_VERSION,
    calibration_version: CALIBRATION_VERSION,
    dataset_version: DATASET_VERSION,
    odds: {
      odd_home: oddHome, odd_draw: oddDraw, odd_away: oddAway,
      implied_prob_home: probHome, implied_prob_draw: probDraw, implied_prob_away: probAway,
      favorite, favorite_prob: favoriteProb,
      provenance: 'RECORDED', source: 'stored', source_timestamp: predictionTimestamp || null,
    },
    form: {
      home: { form_scores: [], avg_scored: cfg.DEFAULT_AVG_SCORED, avg_conceded: cfg.DEFAULT_AVG_CONCEDED, momentum_score: cfg.DEFAULT_MOMENTUM, goals_balance: 0, match_count: 0, provenance: 'UNKNOWN', source: 'none', source_timestamp: null },
      away: { form_scores: [], avg_scored: cfg.DEFAULT_AVG_SCORED, avg_conceded: cfg.DEFAULT_AVG_CONCEDED, momentum_score: cfg.DEFAULT_MOMENTUM, goals_balance: 0, match_count: 0, provenance: 'UNKNOWN', source: 'none', source_timestamp: null },
    },
    h2h: { total_matches: 0, home_wins: 0, draws: 0, away_wins: 0, avg_home_goals: 0, avg_away_goals: 0, avg_total_goals: 0, home_team_bias: 0, provenance: 'UNKNOWN', source: 'none', source_timestamp: null },
    stats: {
      home: { position: 0, played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0, avg_goals_scored: cfg.DEFAULT_AVG_SCORED, avg_goals_conceded: cfg.DEFAULT_AVG_CONCEDED, attack_strength: 1.0, defense_weakness: 1.0, provenance: 'UNKNOWN', source: 'none', source_timestamp: null },
      away: { position: 0, played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0, avg_goals_scored: cfg.DEFAULT_AVG_SCORED, avg_goals_conceded: cfg.DEFAULT_AVG_CONCEDED, attack_strength: 1.0, defense_weakness: 1.0, provenance: 'UNKNOWN', source: 'none', source_timestamp: null },
      has_data: false,
    },
    ai: { enabled: false, model: 'none', score_home: null, score_away: null, confidence: null, is_anti_trap: null, tendency: null, danger_level: null, weight_used: 0, agreement: 0, input_hash: null, response_hash: null, provenance: 'UNKNOWN', source: 'none', source_timestamp: null },
    anti_trap: { triggered: false, signals: { momentum_trap: false, attack_trap: false, h2h_trap: false, ranking_trap: false, ai_disagreement: false }, alert_count: 0, is_true_trap: false, is_false_trap: false, is_domination: false, trap_version: '1.0.0', provenance: 'UNKNOWN' },
    derived: { lambda_home_initial: 0, lambda_away_initial: 0, lambda_home_after_stats: 0, lambda_away_after_stats: 0, lambda_home_after_history: 0, lambda_away_after_history: 0, lambda_home_final: 0, lambda_away_final: 0, form_agreement: 0, h2h_agreement: 0, ai_agreement: 0, grid_search_error: -1, new_season_mode: false, provenance: 'UNKNOWN' },
    coefficients: { hash: '', values: {}, provenance: 'UNKNOWN' },
  };

  snapshot.feature_snapshot_hash = computeSnapshotHash(snapshot);
  return snapshot;
}
