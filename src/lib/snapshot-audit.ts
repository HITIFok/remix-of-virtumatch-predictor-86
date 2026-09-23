// ============================================
// SNAPSHOT AUDIT SYSTEM v1.0
// Phase 5 — Complete Feature Audit
// ============================================
//
// Audits every feature in the snapshot system:
// - Lists all features with source, timestamp, provenance
// - Verifies each feature has required traceability fields
// - Produces the 80-feature audit table
// - Computes completeness score and temporal safety

import type {
  FeatureSnapshot,
  OddsSnapshot,
  FormTeamSnapshot,
  H2HSnapshot,
  StatsTeamSnapshot,
  AISnapshot,
  AntiTrapSnapshot,
  DerivedSnapshot,
  CoefficientSnapshot,
} from './feature-snapshot';
import type { ProvenanceStatus } from './feature-snapshot';

// ═══════════════════════════════════════════════════════════════════
// FEATURE AUDIT RECORD
// ═══════════════════════════════════════════════════════════════════

export interface FeatureAuditRecord {
  feature: string;           // Feature name (e.g., "odds_home", "form_home_momentum")
  source: string;            // Where the data comes from (e.g., "bookmaker", "historical_matches")
  source_timestamp: string | null;  // When the source data was available (ISO 8601)
  calculation_timestamp: string | null;  // When we computed this feature
  calculation_version: string;   // Code version that computed this
  value: string;            // Stringified value for audit
  provenance: ProvenanceStatus;  // RECORDED | RECONSTRUCTED | UNKNOWN | UNSAFE
  obligatoire: boolean;     // Is this feature required for full model?
  feature_family: string;   // e.g., "odds", "form", "h2h", "stats", "ai", "anti_trap", "derived", "coefficients"
}

export interface AuditResult {
  total_features: number;
  features_with_provenance: number;
  features_without_provenance: number;
  features_with_source_timestamp: number;
  features_with_calculation_timestamp: number;
  completeness_score: number;         // % of features present
  temporal_safety_score: number;       // % of features with proven T_feature <= T_prediction
  records: FeatureAuditRecord[];
  by_family: Record<string, { count: number; with_provenance: number; without_provenance: number }>;
}

// ═══════════════════════════════════════════════════════════════════
// COMPLETE FEATURE AUDIT
// ═══════════════════════════════════════════════════════════════════

/**
 * Audit every feature in a snapshot.
 * Produces the complete feature table for Phase 5 Section 1.
 */
export function auditSnapshot(snapshot: FeatureSnapshot, predictionTimestamp: string): AuditResult {
  const records: FeatureAuditRecord[] = [];
  const calcVersion = snapshot.config_version || '1.0.0';

  // ── ODDS FEATURES ──────────────────────────────────────────────────
  if (snapshot.odds) {
    const o = snapshot.odds;
    const oddsTs = o.source_timestamp || null;

    records.push(makeRecord('odds_home', 'bookmaker/scraper', oddsTs, snapshot.snapshot_timestamp, calcVersion, String(o.home), o.provenance || 'UNKNOWN', true, 'odds'));
    records.push(makeRecord('odds_draw', 'bookmaker/scraper', oddsTs, snapshot.snapshot_timestamp, calcVersion, String(o.draw), o.provenance || 'UNKNOWN', true, 'odds'));
    records.push(makeRecord('odds_away', 'bookmaker/scraper', oddsTs, snapshot.snapshot_timestamp, calcVersion, String(o.away), o.provenance || 'UNKNOWN', true, 'odds'));
    records.push(makeRecord('odds_source', 'bookmaker/scraper', oddsTs, snapshot.snapshot_timestamp, calcVersion, o.source || 'unknown', o.provenance || 'UNKNOWN', false, 'odds'));
    records.push(makeRecord('odds_source_timestamp', 'bookmaker/scraper', oddsTs, snapshot.snapshot_timestamp, calcVersion, o.source_timestamp || 'null', o.provenance || 'UNKNOWN', false, 'odds'));
    records.push(makeRecord('odds_market', 'bookmaker/scraper', oddsTs, snapshot.snapshot_timestamp, calcVersion, o.market || '1X2', o.provenance || 'UNKNOWN', false, 'odds'));
    records.push(makeRecord('odds_implied_home', 'calculated_from_odds', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(o.implied_home ?? 'null'), o.provenance || 'RECONSTRUCTED', false, 'odds'));
    records.push(makeRecord('odds_implied_draw', 'calculated_from_odds', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(o.implied_draw ?? 'null'), o.provenance || 'RECONSTRUCTED', false, 'odds'));
    records.push(makeRecord('odds_implied_away', 'calculated_from_odds', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(o.implied_away ?? 'null'), o.provenance || 'RECONSTRUCTED', false, 'odds'));
    records.push(makeRecord('odds_favorite', 'calculated_from_odds', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, o.favorite || 'null', 'RECONSTRUCTED', false, 'odds'));
  }

  // ── FORM HOME FEATURES ─────────────────────────────────────────────
  if (snapshot.form?.home) {
    addFormFeatures(records, snapshot.form.home, 'form_home', snapshot.snapshot_timestamp, calcVersion, true);
  }

  // ── FORM AWAY FEATURES ─────────────────────────────────────────────
  if (snapshot.form?.away) {
    addFormFeatures(records, snapshot.form.away, 'form_away', snapshot.snapshot_timestamp, calcVersion, true);
  }

  // ── H2H FEATURES ───────────────────────────────────────────────────
  if (snapshot.h2h) {
    const h = snapshot.h2h;
    const h2hProv = h.provenance || 'UNKNOWN';
    const h2hTs = h.source_timestamp || null;

    records.push(makeRecord('h2h_total_matches', 'historical_matches', h2hTs, snapshot.snapshot_timestamp, calcVersion, String(h.total_matches), h2hProv, true, 'h2h'));
    records.push(makeRecord('h2h_home_wins', 'historical_matches', h2hTs, snapshot.snapshot_timestamp, calcVersion, String(h.home_wins), h2hProv, true, 'h2h'));
    records.push(makeRecord('h2h_draws', 'historical_matches', h2hTs, snapshot.snapshot_timestamp, calcVersion, String(h.draws), h2hProv, true, 'h2h'));
    records.push(makeRecord('h2h_away_wins', 'historical_matches', h2hTs, snapshot.snapshot_timestamp, calcVersion, String(h.away_wins), h2hProv, true, 'h2h'));
    records.push(makeRecord('h2h_home_team_bias', 'calculated_from_h2h', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(h.home_team_bias), h2hProv, true, 'h2h'));
    records.push(makeRecord('h2h_provenance', 'system', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, h2hProv, h2hProv, false, 'h2h'));
    records.push(makeRecord('h2h_match_timestamps', 'historical_matches', h2hTs, snapshot.snapshot_timestamp, calcVersion, JSON.stringify(h.match_timestamps || []), h2hProv, false, 'h2h'));
  }

  // ── STATS HOME FEATURES ────────────────────────────────────────────
  if (snapshot.stats?.home) {
    addStatsFeatures(records, snapshot.stats.home, 'stats_home', snapshot.snapshot_timestamp, calcVersion, true);
  }

  // ── STATS AWAY FEATURES ────────────────────────────────────────────
  if (snapshot.stats?.away) {
    addStatsFeatures(records, snapshot.stats.away, 'stats_away', snapshot.snapshot_timestamp, calcVersion, true);
  }

  // ── AI FEATURES ────────────────────────────────────────────────────
  if (snapshot.ai) {
    const a = snapshot.ai;
    const aiProv = a.provenance || 'UNKNOWN';
    const aiTs = a.request_timestamp || null;

    records.push(makeRecord('ai_prediction_home', 'ai_model', aiTs, snapshot.snapshot_timestamp, calcVersion, String(a.prediction_home ?? 'null'), aiProv, true, 'ai'));
    records.push(makeRecord('ai_prediction_draw', 'ai_model', aiTs, snapshot.snapshot_timestamp, calcVersion, String(a.prediction_draw ?? 'null'), aiProv, true, 'ai'));
    records.push(makeRecord('ai_prediction_away', 'ai_model', aiTs, snapshot.snapshot_timestamp, calcVersion, String(a.prediction_away ?? 'null'), aiProv, true, 'ai'));
    records.push(makeRecord('ai_model', 'ai_model', aiTs, snapshot.snapshot_timestamp, calcVersion, a.model || 'unknown', aiProv, false, 'ai'));
    records.push(makeRecord('ai_prompt_version', 'ai_model', aiTs, snapshot.snapshot_timestamp, calcVersion, a.prompt_version || 'unknown', aiProv, false, 'ai'));
    records.push(makeRecord('ai_request_timestamp', 'ai_model', aiTs, snapshot.snapshot_timestamp, calcVersion, a.request_timestamp || 'null', aiProv, false, 'ai'));
    // AI response_timestamp is an OUTPUT, not source data.
    // The source_timestamp for T_feature must represent when inputs were available,
    // which is the AI request_timestamp (when all inputs were assembled).
    // Using response_timestamp as source_timestamp would make T_feature > T_prediction,
    // falsely flagging a temporal leak when the AI simply responded after the prediction.
    records.push(makeRecord('ai_response_timestamp', 'ai_model', aiTs, snapshot.snapshot_timestamp, calcVersion, a.response_timestamp || 'null', aiProv, false, 'ai'));
    records.push(makeRecord('ai_temperature', 'ai_model', aiTs, snapshot.snapshot_timestamp, calcVersion, String(a.temperature ?? 'null'), aiProv, false, 'ai'));
    records.push(makeRecord('ai_score', 'ai_model', aiTs, snapshot.snapshot_timestamp, calcVersion, String(a.score ?? 'null'), aiProv, false, 'ai'));
    records.push(makeRecord('ai_input_hash', 'ai_model', aiTs, snapshot.snapshot_timestamp, calcVersion, a.input_hash || 'null', aiProv, false, 'ai'));
    records.push(makeRecord('ai_provenance', 'system', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, aiProv, aiProv, false, 'ai'));
  }

  // ── ANTI-TRAP FEATURES ─────────────────────────────────────────────
  if (snapshot.anti_trap) {
    const at = snapshot.anti_trap;
    records.push(makeRecord('anti_trap_triggered', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(at.triggered), 'RECONSTRUCTED', true, 'anti_trap'));
    records.push(makeRecord('anti_trap_rank_diff', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(at.rank_diff ?? 'null'), 'RECONSTRUCTED', true, 'anti_trap'));
    records.push(makeRecord('anti_trap_delta', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(at.delta ?? 'null'), 'RECONSTRUCTED', true, 'anti_trap'));
    records.push(makeRecord('anti_trap_trap_type', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, at.trap_type || 'none', 'RECONSTRUCTED', false, 'anti_trap'));
    records.push(makeRecord('anti_trap_confidence_penalty', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(at.confidence_penalty ?? 0), 'RECONSTRUCTED', true, 'anti_trap'));
  }

  // ── DERIVED FEATURES ───────────────────────────────────────────────
  if (snapshot.derived) {
    const d = snapshot.derived;
    records.push(makeRecord('derived_lambda_home_base', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(d.lambda_home_base ?? 'null'), 'RECONSTRUCTED', true, 'derived'));
    records.push(makeRecord('derived_lambda_away_base', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(d.lambda_away_base ?? 'null'), 'RECONSTRUCTED', true, 'derived'));
    records.push(makeRecord('derived_lambda_home_adjusted', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(d.lambda_home_adjusted ?? 'null'), 'RECONSTRUCTED', true, 'derived'));
    records.push(makeRecord('derived_lambda_away_adjusted', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(d.lambda_away_adjusted ?? 'null'), 'RECONSTRUCTED', true, 'derived'));
    records.push(makeRecord('derived_poisson_home_expected', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(d.poisson_home_expected ?? 'null'), 'RECONSTRUCTED', true, 'derived'));
    records.push(makeRecord('derived_poisson_away_expected', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(d.poisson_away_expected ?? 'null'), 'RECONSTRUCTED', true, 'derived'));
    records.push(makeRecord('derived_blended_home', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(d.blended_home ?? 'null'), 'RECONSTRUCTED', true, 'derived'));
    records.push(makeRecord('derived_blended_draw', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(d.blended_draw ?? 'null'), 'RECONSTRUCTED', true, 'derived'));
    records.push(makeRecord('derived_blended_away', 'calculated', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(d.blended_away ?? 'null'), 'RECONSTRUCTED', true, 'derived'));
  }

  // ── COEFFICIENT FEATURES ───────────────────────────────────────────
  if (snapshot.coefficients) {
    const c = snapshot.coefficients;
    records.push(makeRecord('coefficients_hash', 'config', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, c.hash || 'null', 'RECORDED', true, 'coefficients'));
    records.push(makeRecord('coefficients_version', 'config', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, c.version || 'null', 'RECORDED', true, 'coefficients'));
    // Individual coefficients as features
    if (c.values) {
      for (const [key, val] of Object.entries(c.values)) {
        records.push(makeRecord(`coef_${key}`, 'config', snapshot.snapshot_timestamp, snapshot.snapshot_timestamp, calcVersion, String(val), 'RECORDED', false, 'coefficients'));
      }
    }
  }

  // ── COMPUTE SCORES ─────────────────────────────────────────────────
  const totalFeatures = records.length;
  const withProvenance = records.filter(r => r.provenance !== 'UNKNOWN' && r.provenance !== 'UNSAFE').length;
  const withoutProvenance = records.filter(r => r.provenance === 'UNKNOWN' || r.provenance === 'UNSAFE').length;
  const withSourceTs = records.filter(r => r.source_timestamp !== null).length;
  const withCalcTs = records.filter(r => r.calculation_timestamp !== null).length;

  // Temporal safety: features where source_timestamp <= predictionTimestamp
  const predTs = new Date(predictionTimestamp).getTime();
  const temporallySafe = records.filter(r => {
    if (!r.source_timestamp) return false;
    return new Date(r.source_timestamp).getTime() <= predTs;
  }).length;

  // By-family breakdown
  const byFamily: Record<string, { count: number; with_provenance: number; without_provenance: number }> = {};
  for (const r of records) {
    if (!byFamily[r.feature_family]) {
      byFamily[r.feature_family] = { count: 0, with_provenance: 0, without_provenance: 0 };
    }
    byFamily[r.feature_family].count++;
    if (r.provenance !== 'UNKNOWN' && r.provenance !== 'UNSAFE') {
      byFamily[r.feature_family].with_provenance++;
    } else {
      byFamily[r.feature_family].without_provenance++;
    }
  }

  return {
    total_features: totalFeatures,
    features_with_provenance: withProvenance,
    features_without_provenance: withoutProvenance,
    features_with_source_timestamp: withSourceTs,
    features_with_calculation_timestamp: withCalcTs,
    completeness_score: totalFeatures > 0 ? Math.round((withProvenance / totalFeatures) * 10000) / 100 : 0,
    temporal_safety_score: totalFeatures > 0 ? Math.round((temporallySafe / totalFeatures) * 10000) / 100 : 0,
    records,
    by_family: byFamily,
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function makeRecord(
  feature: string,
  source: string,
  sourceTimestamp: string | null,
  calculationTimestamp: string | null,
  calculationVersion: string,
  value: string,
  provenance: ProvenanceStatus,
  obligatoire: boolean,
  featureFamily: string,
): FeatureAuditRecord {
  return {
    feature,
    source,
    source_timestamp: sourceTimestamp,
    calculation_timestamp: calculationTimestamp,
    calculation_version: calculationVersion,
    value,
    provenance,
    obligatoire,
    feature_family: featureFamily,
  };
}

function addFormFeatures(
  records: FeatureAuditRecord[],
  form: FormTeamSnapshot,
  prefix: string,
  snapshotTs: string,
  calcVersion: string,
  required: boolean,
): void {
  const prov = form.provenance || 'UNKNOWN';
  const srcTs = form.source_timestamp || null;

  records.push(makeRecord(`${prefix}_form_scores`, 'historical_matches', srcTs, snapshotTs, calcVersion, JSON.stringify(form.form_scores || []), prov, required, 'form'));
  records.push(makeRecord(`${prefix}_avg_scored`, 'calculated_from_form', snapshotTs, snapshotTs, calcVersion, String(form.avg_scored ?? 'null'), prov, required, 'form'));
  records.push(makeRecord(`${prefix}_avg_conceded`, 'calculated_from_form', snapshotTs, snapshotTs, calcVersion, String(form.avg_conceded ?? 'null'), prov, required, 'form'));
  records.push(makeRecord(`${prefix}_momentum_score`, 'calculated_from_form', snapshotTs, snapshotTs, calcVersion, String(form.momentum_score ?? 'null'), prov, required, 'form'));
  records.push(makeRecord(`${prefix}_goals_balance`, 'calculated_from_form', snapshotTs, snapshotTs, calcVersion, String(form.goals_balance ?? 'null'), prov, required, 'form'));
  records.push(makeRecord(`${prefix}_match_count`, 'historical_matches', srcTs, snapshotTs, calcVersion, String(form.match_count ?? 0), prov, required, 'form'));
  records.push(makeRecord(`${prefix}_provenance`, 'system', snapshotTs, snapshotTs, calcVersion, prov, prov, false, 'form'));
  records.push(makeRecord(`${prefix}_match_timestamps`, 'historical_matches', srcTs, snapshotTs, calcVersion, JSON.stringify(form.match_timestamps || []), prov, false, 'form'));
  records.push(makeRecord(`${prefix}_source_timestamp`, 'historical_matches', srcTs, snapshotTs, calcVersion, form.source_timestamp || 'null', prov, false, 'form'));
}

function addStatsFeatures(
  records: FeatureAuditRecord[],
  stats: StatsTeamSnapshot,
  prefix: string,
  snapshotTs: string,
  calcVersion: string,
  required: boolean,
): void {
  const prov = stats.provenance || 'UNKNOWN';
  const srcTs = stats.source_timestamp || null;

  records.push(makeRecord(`${prefix}_position`, 'ranking_table', srcTs, snapshotTs, calcVersion, String(stats.position ?? 'null'), prov, required, 'stats'));
  records.push(makeRecord(`${prefix}_played`, 'ranking_table', srcTs, snapshotTs, calcVersion, String(stats.played ?? 'null'), prov, required, 'stats'));
  records.push(makeRecord(`${prefix}_won`, 'ranking_table', srcTs, snapshotTs, calcVersion, String(stats.won ?? 'null'), prov, required, 'stats'));
  records.push(makeRecord(`${prefix}_drawn`, 'ranking_table', srcTs, snapshotTs, calcVersion, String(stats.drawn ?? 'null'), prov, required, 'stats'));
  records.push(makeRecord(`${prefix}_lost`, 'ranking_table', srcTs, snapshotTs, calcVersion, String(stats.lost ?? 'null'), prov, required, 'stats'));
  records.push(makeRecord(`${prefix}_goals_for`, 'ranking_table', srcTs, snapshotTs, calcVersion, String(stats.goals_for ?? 'null'), prov, required, 'stats'));
  records.push(makeRecord(`${prefix}_goals_against`, 'ranking_table', srcTs, snapshotTs, calcVersion, String(stats.goals_against ?? 'null'), prov, required, 'stats'));
  records.push(makeRecord(`${prefix}_points`, 'ranking_table', srcTs, snapshotTs, calcVersion, String(stats.points ?? 'null'), prov, required, 'stats'));
  records.push(makeRecord(`${prefix}_avg_goals_scored`, 'calculated_from_ranking', snapshotTs, snapshotTs, calcVersion, String(stats.avg_goals_scored ?? 'null'), prov, required, 'stats'));
  records.push(makeRecord(`${prefix}_avg_goals_conceded`, 'calculated_from_ranking', snapshotTs, snapshotTs, calcVersion, String(stats.avg_goals_conceded ?? 'null'), prov, required, 'stats'));
  records.push(makeRecord(`${prefix}_provenance`, 'system', snapshotTs, snapshotTs, calcVersion, prov, prov, false, 'stats'));
  records.push(makeRecord(`${prefix}_source_timestamp`, 'ranking_table', srcTs, snapshotTs, calcVersion, stats.source_timestamp || 'null', prov, false, 'stats'));
}

// ═══════════════════════════════════════════════════════════════════
// THREE TEMPORAL TIMESTAMPS
// ═══════════════════════════════════════════════════════════════════

/**
 * Represents the three temporal moments for a prediction.
 * Section 2: T_prediction, T_feature, T_snapshot
 */
export interface TemporalTimestamps {
  /** Moment when the prediction is produced */
  t_prediction: string;  // ISO 8601 UTC
  /** Earliest moment when ALL feature source data was available */
  t_feature: string;     // ISO 8601 UTC
  /** Moment when the snapshot was recorded */
  t_snapshot: string;    // ISO 8601 UTC
  /** Verification: t_feature <= t_prediction */
  feature_before_prediction: boolean;
  /** Verification: t_snapshot >= t_prediction */
  snapshot_after_prediction: boolean;
}

/**
 * Compute the three temporal timestamps from audit records.
 *
 * IMPORTANT: t_feature = the LATEST source_timestamp across all features,
 * but ONLY source data timestamps (inputs), NOT AI output timestamps.
 * An AI response_timestamp is an OUTPUT of the pipeline, not a historical
 * source input. Using it as source_timestamp would falsely push T_feature
 * past T_prediction, since T_AI_response > T_AI_request.
 *
 * The relevant timestamp for AI features is T_AI_request (when inputs
 * were assembled), which guarantees:
 *   T_feature (source inputs) <= T_AI_request <= T_AI_response <= T_prediction
 */
export function computeTemporalTimestamps(
  auditResult: AuditResult,
  predictionTimestamp: string,
  snapshotTimestamp: string,
): TemporalTimestamps {
  // Find the latest source timestamp across SOURCE DATA features only.
  // Derived/computed/system/config features use snapshot_timestamp as
  // their source_timestamp (they're pipeline outputs, not external inputs).
  // Including them would make T_feature = snapshot_timestamp > T_prediction,
  // which is a false positive — a derived value is not a temporal leak.
  const DERIVED_SOURCES = new Set([
    'calculated', 'calculated_from_odds', 'calculated_from_h2h',
    'calculated_from_form', 'calculated_from_ranking',
    'system', 'config',
  ]);
  let maxFeatureTs = 0;
  for (const r of auditResult.records) {
    if (r.source_timestamp && !DERIVED_SOURCES.has(r.source)) {
      const ts = new Date(r.source_timestamp).getTime();
      if (ts > maxFeatureTs) maxFeatureTs = ts;
    }
  }

  const tFeature = maxFeatureTs > 0 ? new Date(maxFeatureTs).toISOString() : snapshotTimestamp;
  const tPrediction = predictionTimestamp;
  const tSnapshot = snapshotTimestamp;

  return {
    t_prediction: tPrediction,
    t_feature: tFeature,
    t_snapshot: tSnapshot,
    feature_before_prediction: new Date(tFeature).getTime() <= new Date(tPrediction).getTime(),
    snapshot_after_prediction: new Date(tSnapshot).getTime() >= new Date(tPrediction).getTime(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT COMPLETENESS SCORE (Section 6)
// ═══════════════════════════════════════════════════════════════════

export interface CompletenessResult {
  /** Total features expected */
  expected_features: number;
  /** Features present in snapshot */
  present_features: number;
  /** Features absent from snapshot */
  absent_features: number;
  /** Coverage percentage (present / expected) */
  coverage_percent: number;
  /** Features with proven temporal safety */
  temporally_safe_features: number;
  /** Features without proven temporal safety */
  temporally_unsafe_features: number;
  /** Temporal safety percentage */
  temporal_safety_percent: number;
  /** IMPORTANT: coverage != safety. 90% coverage does NOT mean SAFE. */
  coverage_is_not_safety: true;
}

/**
 * Compute snapshot completeness score.
 * NEVER transforms coverage into SAFE automatically.
 */
export function computeCompleteness(auditResult: AuditResult, expectedFeatures: number = 80): CompletenessResult {
  const present = auditResult.features_with_provenance;
  const absent = expectedFeatures - present;
  const safe = auditResult.records.filter(r =>
    r.source_timestamp !== null &&
    r.provenance !== 'UNKNOWN' &&
    r.provenance !== 'UNSAFE'
  ).length;

  return {
    expected_features: expectedFeatures,
    present_features: present,
    absent_features: Math.max(0, absent),
    coverage_percent: expectedFeatures > 0 ? Math.round((present / expectedFeatures) * 10000) / 100 : 0,
    temporally_safe_features: safe,
    temporally_unsafe_features: auditResult.total_features - safe,
    temporal_safety_percent: auditResult.total_features > 0 ? Math.round((safe / auditResult.total_features) * 10000) / 100 : 0,
    coverage_is_not_safety: true,
  };
}

// ═══════════════════════════════════════════════════════════════════
// AI PROVENANCE AUDIT (Section 8)
// ═══════════════════════════════════════════════════════════════════

export interface AIProvenanceAudit {
  has_ai_data: boolean;
  model: string;
  prompt_version: string;
  request_timestamp: string | null;
  response_timestamp: string | null;
  input_hash: string | null;
  temperature: number | null;
  score: number | null;
  /** Check: did AI prompt contain odds? */
  prompt_contains_odds: boolean | null;  // cannot verify without prompt text
  /** Check: did AI prompt contain future results? */
  prompt_contains_future_results: boolean | null;  // cannot verify without prompt text
  /** Check: did AI prompt contain future rankings? */
  prompt_contains_future_rankings: boolean | null;  // cannot verify without prompt text
  provenance: ProvenanceStatus;
  risk_flags: string[];
}

/**
 * Audit AI provenance (Section 8).
 * Flags risks where AI may have had access to future data.
 */
export function auditAIProvenance(snapshot: FeatureSnapshot): AIProvenanceAudit {
  const ai = snapshot.ai;
  const riskFlags: string[] = [];

  if (!ai) {
    return {
      has_ai_data: false,
      model: 'N/A',
      prompt_version: 'N/A',
      request_timestamp: null,
      response_timestamp: null,
      input_hash: null,
      temperature: null,
      score: null,
      prompt_contains_odds: null,
      prompt_contains_future_results: null,
      prompt_contains_future_rankings: null,
      provenance: 'UNKNOWN',
      risk_flags: ['NO_AI_DATA'],
    };
  }

  // Check: if AI has no input_hash, we can't verify what it saw
  if (!ai.input_hash) {
    riskFlags.push('NO_INPUT_HASH — cannot verify AI input contents');
  }

  // Check: if AI has no request_timestamp, we can't verify timing
  if (!ai.request_timestamp) {
    riskFlags.push('NO_REQUEST_TIMESTAMP — cannot verify AI timing');
  }

  // Check: if AI prompt_version is unknown
  if (!ai.prompt_version || ai.prompt_version === 'unknown') {
    riskFlags.push('UNKNOWN_PROMPT_VERSION — cannot audit prompt content');
  }

  // Risk: AI may integrate odds, which creates double counting
  riskFlags.push('RISK: AI may integrate odds → potential double counting with odds-based lambda');

  // Risk: AI may integrate form/stats
  riskFlags.push('RISK: AI may integrate form/stats → potential double counting with explicit features');

  return {
    has_ai_data: true,
    model: ai.model || 'unknown',
    prompt_version: ai.prompt_version || 'unknown',
    request_timestamp: ai.request_timestamp || null,
    response_timestamp: ai.response_timestamp || null,
    input_hash: ai.input_hash || null,
    temperature: ai.temperature ?? null,
    score: ai.score ?? null,
    prompt_contains_odds: null,  // Cannot verify without prompt text
    prompt_contains_future_results: null,  // Cannot verify without prompt text
    prompt_contains_future_rankings: null,  // Cannot verify without prompt text
    provenance: ai.provenance || 'UNKNOWN',
    risk_flags: riskFlags,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ODDS PROVENANCE AUDIT (Section 9)
// ═══════════════════════════════════════════════════════════════════

export interface OddsProvenanceAudit {
  has_odds: boolean;
  source: string;
  source_timestamp: string | null;
  market: string;
  /** Check: odds_timestamp <= prediction_timestamp */
  odds_before_prediction: boolean | null;
  /** Check: odds captured after match start should be excluded */
  odds_after_match_start: boolean | null;
  provenance: ProvenanceStatus;
  risk_flags: string[];
}

/**
 * Audit odds provenance (Section 9).
 * Verifies that odds were available before prediction.
 */
export function auditOddsProvenance(snapshot: FeatureSnapshot, predictionTimestamp: string, matchStartTime?: string): OddsProvenanceAudit {
  const o = snapshot.odds;
  const riskFlags: string[] = [];

  if (!o) {
    return {
      has_odds: false, source: 'N/A', source_timestamp: null, market: 'N/A',
      odds_before_prediction: null, odds_after_match_start: null,
      provenance: 'UNKNOWN', risk_flags: ['NO_ODDS_DATA'],
    };
  }

  let oddsBeforePrediction: boolean | null = null;
  if (o.source_timestamp) {
    const oddsTs = new Date(o.source_timestamp).getTime();
    const predTs = new Date(predictionTimestamp).getTime();
    oddsBeforePrediction = oddsTs <= predTs;
    if (!oddsBeforePrediction) {
      riskFlags.push('ODDS_AFTER_PREDICTION — odds timestamp is after prediction timestamp');
    }
  } else {
    riskFlags.push('NO_ODDS_SOURCE_TIMESTAMP — cannot verify odds timing');
  }

  let oddsAfterMatchStart: boolean | null = null;
  if (matchStartTime && o.source_timestamp) {
    const oddsTs = new Date(o.source_timestamp).getTime();
    const matchTs = new Date(matchStartTime).getTime();
    oddsAfterMatchStart = oddsTs >= matchTs;
    if (oddsAfterMatchStart) {
      riskFlags.push('ODDS_AFTER_MATCH_START — odds captured after match start must be excluded');
    }
  }

  return {
    has_odds: true,
    source: o.source || 'unknown',
    source_timestamp: o.source_timestamp || null,
    market: o.market || '1X2',
    odds_before_prediction: oddsBeforePrediction,
    odds_after_match_start: oddsAfterMatchStart,
    provenance: o.provenance || 'UNKNOWN',
    risk_flags: riskFlags,
  };
}

// ═══════════════════════════════════════════════════════════════════
// FORM/H2H/STATS/MOMENTUM PROVENANCE AUDIT (Section 10)
// ═══════════════════════════════════════════════════════════════════

export interface FeatureProvenanceAudit {
  feature_name: string;
  matches_used: number;
  latest_source_timestamp: string | null;
  latest_source_before_prediction: boolean | null;
  provenance: ProvenanceStatus;
  details: string;
}

/**
 * Audit provenance of form, H2H, stats, and momentum features.
 * Section 10: For each, identify exact data used and verify timestamps.
 */
export function auditFeatureProvenance(snapshot: FeatureSnapshot, predictionTimestamp: string): FeatureProvenanceAudit[] {
  const audits: FeatureProvenanceAudit[] = [];
  const predTs = new Date(predictionTimestamp).getTime();

  // Form Home
  if (snapshot.form?.home) {
    const f = snapshot.form.home;
    const latestTs = getLatestTimestamp(f.match_timestamps);
    audits.push({
      feature_name: 'form_home',
      matches_used: f.match_count ?? 0,
      latest_source_timestamp: latestTs,
      latest_source_before_prediction: latestTs ? new Date(latestTs).getTime() <= predTs : null,
      provenance: f.provenance || 'UNKNOWN',
      details: `Used ${f.match_count ?? 0} matches. Latest: ${latestTs || 'unknown'}.`,
    });
  }

  // Form Away
  if (snapshot.form?.away) {
    const f = snapshot.form.away;
    const latestTs = getLatestTimestamp(f.match_timestamps);
    audits.push({
      feature_name: 'form_away',
      matches_used: f.match_count ?? 0,
      latest_source_timestamp: latestTs,
      latest_source_before_prediction: latestTs ? new Date(latestTs).getTime() <= predTs : null,
      provenance: f.provenance || 'UNKNOWN',
      details: `Used ${f.match_count ?? 0} matches. Latest: ${latestTs || 'unknown'}.`,
    });
  }

  // H2H
  if (snapshot.h2h) {
    const h = snapshot.h2h;
    const latestTs = getLatestTimestamp(h.match_timestamps);
    audits.push({
      feature_name: 'h2h',
      matches_used: h.total_matches ?? 0,
      latest_source_timestamp: latestTs,
      latest_source_before_prediction: latestTs ? new Date(latestTs).getTime() <= predTs : null,
      provenance: h.provenance || 'UNKNOWN',
      details: `Used ${h.total_matches ?? 0} H2H matches. Latest: ${latestTs || 'unknown'}.`,
    });
  }

  // Stats Home
  if (snapshot.stats?.home) {
    const s = snapshot.stats.home;
    const srcTs = s.source_timestamp || null;
    audits.push({
      feature_name: 'stats_home',
      matches_used: s.played ?? 0,
      latest_source_timestamp: srcTs,
      latest_source_before_prediction: srcTs ? new Date(srcTs).getTime() <= predTs : null,
      provenance: s.provenance || 'UNKNOWN',
      details: `Position: ${s.position ?? 'N/A'}. Ranking from: ${srcTs || 'unknown'}.`,
    });
  }

  // Stats Away
  if (snapshot.stats?.away) {
    const s = snapshot.stats.away;
    const srcTs = s.source_timestamp || null;
    audits.push({
      feature_name: 'stats_away',
      matches_used: s.played ?? 0,
      latest_source_timestamp: srcTs,
      latest_source_before_prediction: srcTs ? new Date(srcTs).getTime() <= predTs : null,
      provenance: s.provenance || 'UNKNOWN',
      details: `Position: ${s.position ?? 'N/A'}. Ranking from: ${srcTs || 'unknown'}.`,
    });
  }

  // Momentum (derived from form)
  if (snapshot.form?.home || snapshot.form?.away) {
    audits.push({
      feature_name: 'momentum',
      matches_used: (snapshot.form?.home?.match_count ?? 0) + (snapshot.form?.away?.match_count ?? 0),
      latest_source_timestamp: snapshot.form?.home?.source_timestamp || snapshot.form?.away?.source_timestamp || null,
      latest_source_before_prediction: null, // Derived from form, same data
      provenance: snapshot.form?.home?.provenance || 'UNKNOWN',
      details: 'Momentum is DERIVED from form data. Same timestamps as form. RISK: double counting Form → Momentum.',
    });
  }

  return audits;
}

function getLatestTimestamp(timestamps: number[] | undefined): string | null {
  if (!timestamps || timestamps.length === 0) return null;
  const max = Math.max(...timestamps);
  return new Date(max).toISOString();
}
