// ============================================
// AI TRACEABILITY SYSTEM v1.0
// Phase 5.1 — Complete AI Pipeline Traceability
// ============================================
//
// For each prediction using AI, demonstrates:
// 1. What data was provided to the AI
// 2. When each datum was available
// 3. Which prompt version was used
// 4. Which AI model was used
// 5. What response was received
// 6. Which part of the response was used
// 7. That no post-T_prediction data was used
//
// CRITICAL: This module does NOT modify the model.
// It only captures and traces AI inputs/outputs.

import * as crypto from 'crypto';
import type { ProvenanceStatus } from './feature-snapshot';

// ═══════════════════════════════════════════════════════════════════
// AI PROVIDER CONFIGURATION (Section 2)
// ═══════════════════════════════════════════════════════════════════

export const AI_PROVIDER = 'groq';
export const AI_MODEL_DEFAULT = 'llama-3.3-70b-versatile';
export const AI_PROMPT_VERSION = '7.0';
export const AI_TEMPERATURE = 0.3;
export const AI_MAX_TOKENS = 4096;
export const AI_DEADLINE_MS = 2500;

// ═══════════════════════════════════════════════════════════════════
// AI INPUT STRUCTURE (Section 4)
// ═══════════════════════════════════════════════════════════════════

export interface AIInputField {
  name: string;
  value: string | number;
  source: string;
  source_timestamp: string | null;
  version: string;
  provenance: ProvenanceStatus;
}

export interface AIInputs {
  odds: {
    home: AIInputField;
    draw: AIInputField;
    away: AIInputField;
    implied_home: AIInputField;
    implied_draw: AIInputField;
    implied_away: AIInputField;
  };
  standings_home: AIInputField | null;
  standings_away: AIInputField | null;
  form_home: AIInputField | null;
  form_away: AIInputField | null;
  h2h: AIInputField | null;
  other: AIInputField[];
}

// ═══════════════════════════════════════════════════════════════════
// AI TRACE RECORD (Sections 2-3-4-6)
// ═══════════════════════════════════════════════════════════════════

export interface AITraceRecord {
  ai_provider: string;
  ai_model: string;
  ai_prompt_version: string;
  ai_system_prompt_hash: string;
  ai_user_prompt_hash: string;
  ai_prompt_hash: string;
  ai_inputs: AIInputs;
  ai_input_hash: string;
  ai_request_timestamp: string | null;
  ai_response_timestamp: string | null;
  ai_response_hash: string | null;
  ai_response_stored: boolean;
  ai_prediction_used: {
    score_home: number;
    score_away: number;
    confidence: number;
  };
  ai_provenance: ProvenanceStatus;
  ai_provenance_risk_flags: string[];
}

// ═══════════════════════════════════════════════════════════════════
// TEMPORAL PIPELINE EVENTS (Sections 7-8)
// ═══════════════════════════════════════════════════════════════════

export interface PredictionTimeline {
  t_start: string;
  t_features: string;
  t_ai_request: string | null;
  t_ai_response: string | null;
  t_prediction_final: string;
  t_snapshot: string;
  invariants: {
    t_start_leq_t_features: boolean;
    t_features_leq_t_ai_request: boolean | null;
    t_ai_request_leq_t_ai_response: boolean | null;
    t_ai_response_leq_t_prediction_final: boolean | null;
    t_prediction_final_leq_t_snapshot: boolean;
    all_inputs_before_t_prediction: boolean;
  };
}

/**
 * OFFICIAL DEFINITION of T_prediction (Section 8):
 *
 * T_prediction = T_prediction_final
 *
 * This is the moment when the prediction becomes officially available
 * to the user/system. It corresponds to the completion of the entire
 * pipeline, including AI response (if used).
 *
 * We do NOT use:
 * - DB created_at (may differ due to network latency)
 * - snapshot_timestamp (is T_snapshot, which is >= T_prediction)
 * - AI response timestamp (is only one step in the pipeline)
 */
export function computePredictionTimeline(events: {
  t_start: string;
  t_features?: string;
  t_ai_request?: string | null;
  t_ai_response?: string | null;
  t_prediction_final?: string;
  t_snapshot?: string;
}): PredictionTimeline {
  const tStart = events.t_start;
  const tFeatures = events.t_features || tStart;
  const tAiRequest = events.t_ai_request || null;
  const tAiResponse = events.t_ai_response || null;
  const tPredictionFinal = events.t_prediction_final || tAiResponse || tFeatures;
  const tSnapshot = events.t_snapshot || tPredictionFinal;

  const startMs = new Date(tStart).getTime();
  const featuresMs = new Date(tFeatures).getTime();
  const aiReqMs = tAiRequest ? new Date(tAiRequest).getTime() : null;
  const aiResMs = tAiResponse ? new Date(tAiResponse).getTime() : null;
  const predMs = new Date(tPredictionFinal).getTime();
  const snapMs = new Date(tSnapshot).getTime();

  return {
    t_start: tStart,
    t_features: tFeatures,
    t_ai_request: tAiRequest,
    t_ai_response: tAiResponse,
    t_prediction_final: tPredictionFinal,
    t_snapshot: tSnapshot,
    invariants: {
      t_start_leq_t_features: startMs <= featuresMs,
      t_features_leq_t_ai_request: aiReqMs !== null ? featuresMs <= aiReqMs : null,
      t_ai_request_leq_t_ai_response: aiReqMs !== null && aiResMs !== null ? aiReqMs <= aiResMs : null,
      t_ai_response_leq_t_prediction_final: aiResMs !== null ? aiResMs <= predMs : null,
      t_prediction_final_leq_t_snapshot: predMs <= snapMs,
      all_inputs_before_t_prediction: featuresMs <= predMs,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// HASH COMPUTATIONS (Sections 3, 6)
// ═══════════════════════════════════════════════════════════════════

export function computeHash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function computeSystemPromptHash(systemPrompt: string): string {
  return computeHash('system:' + systemPrompt);
}

export function computeUserPromptHash(userPrompt: string): string {
  return computeHash('user:' + userPrompt);
}

export function computePromptHash(systemPrompt: string, userPrompt: string): string {
  return computeHash('prompt:' + systemPrompt + '|' + userPrompt);
}

/**
 * Compute deterministic hash of AI inputs.
 * Two calls with exactly the same inputs -> same hash.
 * A modification of any input -> different hash.
 */
export function computeAIInputHash(inputs: AIInputs): string {
  const parts: string[] = [];

  parts.push('odds_home:' + inputs.odds.home.value);
  parts.push('odds_draw:' + inputs.odds.draw.value);
  parts.push('odds_away:' + inputs.odds.away.value);
  parts.push('odds_implicit_h:' + inputs.odds.implied_home.value);
  parts.push('odds_implicit_d:' + inputs.odds.implied_draw.value);
  parts.push('odds_implicit_a:' + inputs.odds.implied_away.value);
  parts.push('odds_ts:' + (inputs.odds.home.source_timestamp || 'null'));

  if (inputs.standings_home) {
    parts.push('standings_h:' + inputs.standings_home.value);
    parts.push('standings_h_ts:' + (inputs.standings_home.source_timestamp || 'null'));
  }
  if (inputs.standings_away) {
    parts.push('standings_a:' + inputs.standings_away.value);
    parts.push('standings_a_ts:' + (inputs.standings_away.source_timestamp || 'null'));
  }
  if (inputs.form_home) {
    parts.push('form_h:' + inputs.form_home.value);
    parts.push('form_h_ts:' + (inputs.form_home.source_timestamp || 'null'));
  }
  if (inputs.form_away) {
    parts.push('form_a:' + inputs.form_away.value);
    parts.push('form_a_ts:' + (inputs.form_away.source_timestamp || 'null'));
  }
  if (inputs.h2h) {
    parts.push('h2h:' + inputs.h2h.value);
    parts.push('h2h_ts:' + (inputs.h2h.source_timestamp || 'null'));
  }
  for (const field of inputs.other) {
    parts.push('other_' + field.name + ':' + field.value);
    parts.push('other_' + field.name + '_ts:' + (field.source_timestamp || 'null'));
  }

  parts.sort();
  return computeHash('ai_inputs:' + parts.join('|'));
}

export function computeAIResponseHash(response: string): string {
  return computeHash('response:' + response);
}

// ═══════════════════════════════════════════════════════════════════
// AI INPUT AUDIT TABLE (Section 1)
// ═══════════════════════════════════════════════════════════════════

export interface AIInputAuditRow {
  input: string;
  source: string;
  timestamp: string | null;
  available_before_prediction: boolean | null;
  in_snapshot: boolean;
}

export function buildAIInputAuditTable(
  inputs: AIInputs,
  predictionTimestamp: string,
): AIInputAuditRow[] {
  const predMs = new Date(predictionTimestamp).getTime();
  const rows: AIInputAuditRow[] = [];

  const addRow = (field: AIInputField) => {
    const tsMs = field.source_timestamp ? new Date(field.source_timestamp).getTime() : null;
    rows.push({
      input: field.name,
      source: field.source,
      timestamp: field.source_timestamp,
      available_before_prediction: tsMs !== null ? tsMs <= predMs : null,
      in_snapshot: true,
    });
  };

  addRow(inputs.odds.home);
  addRow(inputs.odds.draw);
  addRow(inputs.odds.away);
  addRow(inputs.odds.implied_home);
  addRow(inputs.odds.implied_draw);
  addRow(inputs.odds.implied_away);
  if (inputs.standings_home) addRow(inputs.standings_home);
  if (inputs.standings_away) addRow(inputs.standings_away);
  if (inputs.form_home) addRow(inputs.form_home);
  if (inputs.form_away) addRow(inputs.form_away);
  if (inputs.h2h) addRow(inputs.h2h);
  for (const field of inputs.other) addRow(field);

  return rows;
}

// ═══════════════════════════════════════════════════════════════════
// AI LEAKAGE DETECTION (Section 5)
// ═══════════════════════════════════════════════════════════════════

export interface AILeakageTestResult {
  test_name: string;
  passed: boolean;
  original_input_hash: string;
  modified_input_hash: string;
  hash_changed: boolean;
  details: string;
}

/**
 * Test AI leakage: adding future data should NOT change AI_INPUT_HASH.
 */
export function testAILeakage(
  originalInputs: AIInputs,
  modifiedInputs: AIInputs,
  testDescription: string,
): AILeakageTestResult {
  const originalHash = computeAIInputHash(originalInputs);
  const modifiedHash = computeAIInputHash(modifiedInputs);
  const hashChanged = originalHash !== modifiedHash;

  return {
    test_name: testDescription,
    passed: !hashChanged,
    original_input_hash: originalHash,
    modified_input_hash: modifiedHash,
    hash_changed: hashChanged,
    details: hashChanged
      ? 'AI LEAKAGE RISK: Adding future data changed AI_INPUT_HASH. Original: ' + originalHash.substring(0, 16) + '... Modified: ' + modifiedHash.substring(0, 16) + '...'
      : 'PASS: Adding future data did not change AI_INPUT_HASH. Both: ' + originalHash.substring(0, 16) + '...',
  };
}

// ═══════════════════════════════════════════════════════════════════
// AI PROVENANCE CLASSIFICATION (Section 7)
// ═══════════════════════════════════════════════════════════════════

export function classifyAIProvenance(
  inputs: AIInputs,
  predictionTimestamp: string,
): { provenance: ProvenanceStatus; risk_flags: string[] } {
  const predMs = new Date(predictionTimestamp).getTime();
  const riskFlags: string[] = [];
  let hasUnknown = false;
  let hasUnsafe = false;

  const checkField = (field: AIInputField) => {
    if (!field.source_timestamp) {
      hasUnknown = true;
      riskFlags.push(field.name + ': NO source_timestamp -> UNKNOWN');
    } else {
      const tsMs = new Date(field.source_timestamp).getTime();
      if (tsMs > predMs) {
        hasUnsafe = true;
        riskFlags.push(field.name + ': source_timestamp (' + field.source_timestamp + ') > T_prediction -> UNSAFE');
      }
    }
  };

  checkField(inputs.odds.home);
  checkField(inputs.odds.draw);
  checkField(inputs.odds.away);
  if (inputs.standings_home) checkField(inputs.standings_home);
  if (inputs.standings_away) checkField(inputs.standings_away);
  if (inputs.form_home) checkField(inputs.form_home);
  if (inputs.form_away) checkField(inputs.form_away);
  if (inputs.h2h) checkField(inputs.h2h);
  for (const field of inputs.other) checkField(field);

  let provenance: ProvenanceStatus;
  if (hasUnsafe) {
    provenance = 'UNSAFE';
  } else if (hasUnknown) {
    provenance = 'UNKNOWN';
  } else {
    provenance = 'RECORDED';
  }

  riskFlags.push('RISK: AI receives odds in prompt -> potential double counting with odds-based lambda');

  return { provenance, risk_flags: riskFlags };
}

// ═══════════════════════════════════════════════════════════════════
// BUILD AI INPUTS FROM MATCH DATA
// ═══════════════════════════════════════════════════════════════════

function makeInput(
  name: string,
  value: string | number,
  source: string,
  sourceTimestamp: string | null,
  version: string,
  provenance: ProvenanceStatus,
): AIInputField {
  return { name, value, source, source_timestamp: sourceTimestamp, version, provenance };
}

export function buildAIInputsFromMatch(match: {
  home: string;
  away: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
  rankingHome?: { position: number; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; points: number };
  rankingAway?: { position: number; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; points: number };
  recentHome?: Array<{ result: string; scoreHome: number; scoreAway: number }>;
  recentAway?: Array<{ result: string; scoreHome: number; scoreAway: number }>;
  headToHead?: Array<{ scoreHome: number; scoreAway: number }>;
  oddsTimestamp?: string;
  rankingTimestamp?: string;
  formTimestamp?: string;
  h2hTimestamp?: string;
}): AIInputs {
  const invH = 1 / match.oddHome;
  const invD = 1 / match.oddDraw;
  const invA = 1 / match.oddAway;
  const tot = invH + invD + invA;
  const configVersion = '1.0.0';
  const oddsTs = match.oddsTimestamp || null;

  const odds = {
    home: makeInput('odds_home', match.oddHome, 'bookmaker/scraper', oddsTs, configVersion, 'RECORDED'),
    draw: makeInput('odds_draw', match.oddDraw, 'bookmaker/scraper', oddsTs, configVersion, 'RECORDED'),
    away: makeInput('odds_away', match.oddAway, 'bookmaker/scraper', oddsTs, configVersion, 'RECORDED'),
    implied_home: makeInput('odds_implied_home', invH / tot, 'calculated_from_odds', oddsTs, configVersion, 'RECONSTRUCTED'),
    implied_draw: makeInput('odds_implied_draw', invD / tot, 'calculated_from_odds', oddsTs, configVersion, 'RECONSTRUCTED'),
    implied_away: makeInput('odds_implied_away', invA / tot, 'calculated_from_odds', oddsTs, configVersion, 'RECONSTRUCTED'),
  };

  let standingsHome: AIInputField | null = null;
  if (match.rankingHome) {
    const r = match.rankingHome;
    const mj = r.played || 1;
    const val = '#' + r.position + ' ' + mj + 'j ' + r.won + 'V' + r.drawn + 'N' + r.lost + 'D ' + r.goalsFor + '-' + r.goalsAgainst + ' ' + r.points + 'p att:' + (r.goalsFor / mj).toFixed(1) + ' def:' + (r.goalsAgainst / mj).toFixed(1);
    standingsHome = makeInput('standings_home', val, 'ranking_table', match.rankingTimestamp || null, configVersion, 'RECORDED');
  }

  let standingsAway: AIInputField | null = null;
  if (match.rankingAway) {
    const r = match.rankingAway;
    const mj = r.played || 1;
    const val = '#' + r.position + ' ' + mj + 'j ' + r.won + 'V' + r.drawn + 'N' + r.lost + 'D ' + r.goalsFor + '-' + r.goalsAgainst + ' ' + r.points + 'p att:' + (r.goalsFor / mj).toFixed(1) + ' def:' + (r.goalsAgainst / mj).toFixed(1);
    standingsAway = makeInput('standings_away', val, 'ranking_table', match.rankingTimestamp || null, configVersion, 'RECORDED');
  }

  let formHome: AIInputField | null = null;
  if (match.recentHome && match.recentHome.length > 0) {
    const val = match.recentHome.map(function (r) { return r.result + r.scoreHome + '-' + r.scoreAway; }).join(' ');
    formHome = makeInput('form_home', val, 'historical_matches', match.formTimestamp || null, configVersion, 'RECORDED');
  }

  let formAway: AIInputField | null = null;
  if (match.recentAway && match.recentAway.length > 0) {
    const val = match.recentAway.map(function (r) { return r.result + r.scoreHome + '-' + r.scoreAway; }).join(' ');
    formAway = makeInput('form_away', val, 'historical_matches', match.formTimestamp || null, configVersion, 'RECORDED');
  }

  let h2h: AIInputField | null = null;
  if (match.headToHead && match.headToHead.length > 0) {
    const hw = match.headToHead.filter(function (h) { return h.scoreHome > h.scoreAway; }).length;
    const hd = match.headToHead.filter(function (h) { return h.scoreHome === h.scoreAway; }).length;
    const ha = match.headToHead.filter(function (h) { return h.scoreHome < h.scoreAway; }).length;
    const avg = (match.headToHead.reduce(function (s, h) { return s + h.scoreHome + h.scoreAway; }, 0) / match.headToHead.length).toFixed(1);
    h2h = makeInput('h2h', hw + 'V' + hd + 'N' + ha + 'D avg:' + avg + 'bm', 'historical_matches', match.h2hTimestamp || null, configVersion, 'RECORDED');
  }

  return { odds: odds, standings_home: standingsHome, standings_away: standingsAway, form_home: formHome, form_away: formAway, h2h: h2h, other: [] };
}

// ═══════════════════════════════════════════════════════════════════
// CREATE FULL AI TRACE RECORD
// ═══════════════════════════════════════════════════════════════════

export function createAITraceRecord(params: {
  systemPrompt: string;
  userPrompt: string;
  inputs: AIInputs;
  model: string;
  requestTimestamp: string | null;
  responseTimestamp: string | null;
  responseContent: string | null;
  predictionUsed: { score_home: number; score_away: number; confidence: number };
  predictionTimestamp: string;
}): AITraceRecord {
  const classification = classifyAIProvenance(params.inputs, params.predictionTimestamp);

  return {
    ai_provider: AI_PROVIDER,
    ai_model: params.model,
    ai_prompt_version: AI_PROMPT_VERSION,
    ai_system_prompt_hash: computeSystemPromptHash(params.systemPrompt),
    ai_user_prompt_hash: computeUserPromptHash(params.userPrompt),
    ai_prompt_hash: computePromptHash(params.systemPrompt, params.userPrompt),
    ai_inputs: params.inputs,
    ai_input_hash: computeAIInputHash(params.inputs),
    ai_request_timestamp: params.requestTimestamp,
    ai_response_timestamp: params.responseTimestamp,
    ai_response_hash: params.responseContent ? computeAIResponseHash(params.responseContent) : null,
    ai_response_stored: false,
    ai_prediction_used: params.predictionUsed,
    ai_provenance: classification.provenance,
    ai_provenance_risk_flags: classification.risk_flags,
  };
}
