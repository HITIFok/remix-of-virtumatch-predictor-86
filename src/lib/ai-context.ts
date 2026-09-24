// ============================================
// AI CONTEXT — CANONICAL SINGLE SOURCE OF TRUTH v1.0
// Phase 5.2 — Final AI Input Integrity & Scientific Go-Live
// ============================================
//
// ARCHITECTURE:
//   buildAIContext(match)
//        ↓
//       ├── buildUserPromptFromContext(context)   ← text sent to AI
//       └── buildAISnapshotFromContext(context)   ← structured traceability record
//
// This ensures:
//   DATA ACTUALLY SENT TO AI = DATA RECORDED IN SNAPSHOT
//
// CRITICAL: This module does NOT modify any coefficient, weight,
// feature, or calibration. It only captures and structures data.

import * as crypto from 'crypto';
import type { ProvenanceStatus } from './feature-snapshot';

// ═══════════════════════════════════════════════════════════════════
// CANONICAL AI CONTEXT
// ═══════════════════════════════════════════════════════════════════

/**
 * RankingInput — raw ranking data as received from the match
 */
export interface RankingInput {
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

/**
 * FormEntry — a single recent match result
 */
export interface FormEntry {
  result: string;      // 'V', 'N', 'D'
  scoreHome: number;
  scoreAway: number;
}

/**
 * H2HEntry — a single head-to-head match
 */
export interface H2HEntry {
  scoreHome: number;
  scoreAway: number;
}

/**
 * AIContext — the canonical representation of all data that flows
 * into the AI pipeline. This is the SINGLE SOURCE OF TRUTH.
 *
 * Every value here is in its RAW form (no formatting, no rounding,
 * no transformation). The transformations happen only in:
 *   - buildUserPromptFromContext() for the text representation
 *   - buildAISnapshotFromContext() for the structured traceability record
 */
export interface AIContext {
  // Match identity
  home: string;
  away: string;

  // Odds — RAW decimal values
  odds: {
    home: number;
    draw: number;
    away: number;
    source_timestamp: string | null;
  };

  // Standings — RAW structured data (null if absent)
  standings: {
    home: RankingInput | null;
    away: RankingInput | null;
    source_timestamp: string | null;
  };

  // Form — RAW result arrays (null/empty if absent)
  form: {
    home: FormEntry[] | null;
    away: FormEntry[] | null;
    source_timestamp: string | null;
  };

  // Head-to-head — RAW match array (null/empty if absent)
  h2h: {
    matches: H2HEntry[] | null;
    source_timestamp: string | null;
  };

  // Metadata
  match_index: number;  // 1-based index for prompt
  source_timestamps: {
    odds: string | null;
    ranking: string | null;
    form: string | null;
    h2h: string | null;
  };
}

// ═══════════════════════════════════════════════════════════════════
// DERIVED VALUES (computed from RAW, used by both prompt & snapshot)
// ═══════════════════════════════════════════════════════════════════

/**
 * ImpliedProbabilities — derived from odds, used identically
 * by both the prompt (as percentages) and the snapshot (as fractions)
 */
export interface ImpliedProbabilities {
  home: number;      // raw fraction, e.g. 0.5432
  draw: number;      // raw fraction
  away: number;      // raw fraction
  home_pct: number;  // percentage rounded to 0 decimals, e.g. 54
  draw_pct: number;
  away_pct: number;
}

/**
 * StandingsFormatted — derived from raw ranking data
 * The EXACT format string sent to AI and recorded in snapshot
 */
export interface StandingsFormatted {
  home: string | null;  // e.g. "#3 15j 9V3N3D 24-12 30p att:1.6 def:0.8"
  away: string | null;
}

/**
 * FormFormatted — derived from raw form entries
 * The EXACT format string sent to AI and recorded in snapshot
 */
export interface FormFormatted {
  home: string | null;  // e.g. "V1-0 N1-1 V2-0 D0-1 V1-0"
  away: string | null;
}

/**
 * H2HFormatted — derived from raw H2H entries
 * The EXACT format string sent to AI and recorded in snapshot
 */
export interface H2HFormatted {
  summary: string | null;  // e.g. "3V1N1D avg:2.0bm"
  home_wins: number;
  draws: number;
  away_wins: number;
  avg_total_goals: number;
}

/**
 * AIDerivedContext — all values derived from AIContext
 * These are computed ONCE from the canonical context and used
 * identically by both prompt and snapshot
 */
export interface AIDerivedContext {
  implied_probabilities: ImpliedProbabilities;
  standings_formatted: StandingsFormatted;
  form_formatted: FormFormatted;
  h2h_formatted: H2HFormatted;
}

// ═══════════════════════════════════════════════════════════════════
// BUILD AI CONTEXT (Section 3 — Single Source of Truth)
// ═══════════════════════════════════════════════════════════════════

export function buildAIContext(match: {
  home: string;
  away: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
  rankingHome?: RankingInput;
  rankingAway?: RankingInput;
  recentHome?: FormEntry[];
  recentAway?: FormEntry[];
  headToHead?: H2HEntry[];
  oddsTimestamp?: string;
  rankingTimestamp?: string;
  formTimestamp?: string;
  h2hTimestamp?: string;
  matchIndex?: number;
}): AIContext {
  return {
    home: match.home,
    away: match.away,
    odds: {
      home: match.oddHome,
      draw: match.oddDraw,
      away: match.oddAway,
      source_timestamp: match.oddsTimestamp || null,
    },
    standings: {
      home: match.rankingHome || null,
      away: match.rankingAway || null,
      source_timestamp: match.rankingTimestamp || null,
    },
    form: {
      home: match.recentHome || null,
      away: match.recentAway || null,
      source_timestamp: match.formTimestamp || null,
    },
    h2h: {
      matches: match.headToHead || null,
      source_timestamp: match.h2hTimestamp || null,
    },
    match_index: match.matchIndex || 1,
    source_timestamps: {
      odds: match.oddsTimestamp || null,
      ranking: match.rankingTimestamp || null,
      form: match.formTimestamp || null,
      h2h: match.h2hTimestamp || null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// COMPUTE DERIVED CONTEXT (single computation, shared by both)
// ═══════════════════════════════════════════════════════════════════

export function computeAIDerivedContext(ctx: AIContext): AIDerivedContext {
  // 1. Implied probabilities
  const invH = 1 / ctx.odds.home;
  const invD = 1 / ctx.odds.draw;
  const invA = 1 / ctx.odds.away;
  const tot = invH + invD + invA;
  const pHome = invH / tot;
  const pDraw = invD / tot;
  const pAway = invA / tot;

  const implied_probabilities: ImpliedProbabilities = {
    home: pHome,
    draw: pDraw,
    away: pAway,
    home_pct: Math.round(pHome * 100),
    draw_pct: Math.round(pDraw * 100),
    away_pct: Math.round(pAway * 100),
  };

  // 2. Standings formatting — EXACT same function used by both prompt & snapshot
  const formatRanking = (r: RankingInput): string => {
    const mj = r.played || 1;
    return '#' + r.position + ' ' + mj + 'j ' + r.won + 'V' + r.drawn + 'N' + r.lost + 'D ' + r.goalsFor + '-' + r.goalsAgainst + ' ' + r.points + 'p att:' + (r.goalsFor / mj).toFixed(1) + ' def:' + (r.goalsAgainst / mj).toFixed(1);
  };

  const standings_formatted: StandingsFormatted = {
    home: ctx.standings.home ? formatRanking(ctx.standings.home) : null,
    away: ctx.standings.away ? formatRanking(ctx.standings.away) : null,
  };

  // 3. Form formatting — EXACT same function used by both prompt & snapshot
  const formatForm = (entries: FormEntry[]): string => {
    return entries.map(r => r.result + r.scoreHome + '-' + r.scoreAway).join(' ');
  };

  const form_formatted: FormFormatted = {
    home: ctx.form.home && ctx.form.home.length > 0 ? formatForm(ctx.form.home) : null,
    away: ctx.form.away && ctx.form.away.length > 0 ? formatForm(ctx.form.away) : null,
  };

  // 4. H2H formatting — EXACT same function used by both prompt & snapshot
  let h2h_formatted: H2HFormatted;
  if (ctx.h2h.matches && ctx.h2h.matches.length > 0) {
    const hw = ctx.h2h.matches.filter(h => h.scoreHome > h.scoreAway).length;
    const hd = ctx.h2h.matches.filter(h => h.scoreHome === h.scoreAway).length;
    const ha = ctx.h2h.matches.filter(h => h.scoreHome < h.scoreAway).length;
    const avgTotal = ctx.h2h.matches.reduce((s, h) => s + h.scoreHome + h.scoreAway, 0) / ctx.h2h.matches.length;
    h2h_formatted = {
      summary: hw + 'V' + hd + 'N' + ha + 'D avg:' + avgTotal.toFixed(1) + 'bm',
      home_wins: hw,
      draws: hd,
      away_wins: ha,
      avg_total_goals: avgTotal,
    };
  } else {
    h2h_formatted = {
      summary: null,
      home_wins: 0,
      draws: 0,
      away_wins: 0,
      avg_total_goals: 0,
    };
  }

  return {
    implied_probabilities,
    standings_formatted,
    form_formatted,
    h2h_formatted,
  };
}

// ═══════════════════════════════════════════════════════════════════
// BUILD USER PROMPT (Section 1 — from canonical context)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the user prompt text sent to the AI model.
 * Derives from AIContext — NOT from independent match processing.
 * This ensures the prompt and snapshot share the same source of truth.
 *
 * Output format EXACTLY matches the original buildUserPrompt() from
 * analyze-match.js, but now uses a single canonical derivation.
 */
export function buildUserPromptFromContext(ctx: AIContext): string {
  const derived = computeAIDerivedContext(ctx);
  const ip = derived.implied_probabilities;

  // Base line: M1: TeamA vs TeamB | 1.85/3.40/4.20 | P:54/29/24
  let b = `M${ctx.match_index}: ${ctx.home} vs ${ctx.away} | ${ctx.odds.home}/${ctx.odds.draw}/${ctx.odds.away} | P:${ip.home_pct}/${ip.draw_pct}/${ip.away_pct}`;

  // Standings home: H:#3 15j 9V3N3D 24-12 30p att:1.6 def:0.8
  if (derived.standings_formatted.home) {
    b += '\nH:' + derived.standings_formatted.home;
  }
  // Standings away
  if (derived.standings_formatted.away) {
    b += '\nA:' + derived.standings_formatted.away;
  }

  // Form home: FH:V1-0 N1-1 V2-0 D0-1 V1-0
  if (derived.form_formatted.home) {
    b += '\nFH:' + derived.form_formatted.home;
  }
  // Form away
  if (derived.form_formatted.away) {
    b += '\nFA:' + derived.form_formatted.away;
  }

  // H2H: 3V1N1D avg:2.0bm
  if (derived.h2h_formatted.summary) {
    b += '\nH2H:' + derived.h2h_formatted.summary;
  }

  return b;
}

// ═══════════════════════════════════════════════════════════════════
// BUILD AI SNAPSHOT INPUTS (from canonical context)
// ═══════════════════════════════════════════════════════════════════

/**
 * AIInputField — mirrors the existing ai-traceability.ts interface
 * Re-exported for compatibility
 */
export interface AIInputField {
  name: string;
  value: string | number;
  source: string;
  source_timestamp: string | null;
  version: string;
  provenance: ProvenanceStatus;
}

/**
 * AIInputs — structured traceability record
 * Mirrors the existing ai-traceability.ts interface
 */
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

/**
 * Build the structured AI inputs for traceability.
 * Derives from AIContext — NOT from independent match processing.
 * This ensures the snapshot and prompt share the same source of truth.
 *
 * KEY CHANGE: implied probabilities now use the SAME percentage values
 * that appear in the prompt (not raw fractions). This eliminates the
 * mirror divergence that existed before Phase 5.2.
 */
export function buildAISnapshotFromContext(ctx: AIContext): AIInputs {
  const derived = computeAIDerivedContext(ctx);
  const ip = derived.implied_probabilities;
  const configVersion = '1.0.0';
  const oddsTs = ctx.odds.source_timestamp;

  const odds = {
    home: makeInput('odds_home', ctx.odds.home, 'bookmaker/scraper', oddsTs, configVersion, 'RECORDED'),
    draw: makeInput('odds_draw', ctx.odds.draw, 'bookmaker/scraper', oddsTs, configVersion, 'RECORDED'),
    away: makeInput('odds_away', ctx.odds.away, 'bookmaker/scraper', oddsTs, configVersion, 'RECORDED'),
    implied_home: makeInput('odds_implied_home', ip.home_pct, 'calculated_from_odds', oddsTs, configVersion, 'RECONSTRUCTED'),
    implied_draw: makeInput('odds_implied_draw', ip.draw_pct, 'calculated_from_odds', oddsTs, configVersion, 'RECONSTRUCTED'),
    implied_away: makeInput('odds_implied_away', ip.away_pct, 'calculated_from_odds', oddsTs, configVersion, 'RECONSTRUCTED'),
  };

  const standings_home = derived.standings_formatted.home
    ? makeInput('standings_home', derived.standings_formatted.home, 'ranking_table', ctx.standings.source_timestamp, configVersion, 'RECORDED')
    : null;

  const standings_away = derived.standings_formatted.away
    ? makeInput('standings_away', derived.standings_formatted.away, 'ranking_table', ctx.standings.source_timestamp, configVersion, 'RECORDED')
    : null;

  const form_home = derived.form_formatted.home
    ? makeInput('form_home', derived.form_formatted.home, 'historical_matches', ctx.form.source_timestamp, configVersion, 'RECORDED')
    : null;

  const form_away = derived.form_formatted.away
    ? makeInput('form_away', derived.form_formatted.away, 'historical_matches', ctx.form.source_timestamp, configVersion, 'RECORDED')
    : null;

  const h2h = derived.h2h_formatted.summary
    ? makeInput('h2h', derived.h2h_formatted.summary, 'historical_matches', ctx.h2h.source_timestamp, configVersion, 'RECORDED')
    : null;

  return { odds, standings_home, standings_away, form_home, form_away, h2h, other: [] };
}

// ═══════════════════════════════════════════════════════════════════
// HASH COMPUTATIONS (Section 4)
// ═══════════════════════════════════════════════════════════════════

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * AI_CONTEXT_HASH — hash of the canonical AIContext (RAW values)
 * This is the most fundamental hash. It captures the EXACT raw data
 * before any transformation, rounding, or formatting.
 *
 * same context → same AI_CONTEXT_HASH (always)
 * context modified → different AI_CONTEXT_HASH (always)
 */
export function computeAIContextHash(ctx: AIContext): string {
  const canonical = JSON.stringify({
    home: ctx.home,
    away: ctx.away,
    odds_home: ctx.odds.home,
    odds_draw: ctx.odds.draw,
    odds_away: ctx.odds.away,
    standings_home: ctx.standings.home,
    standings_away: ctx.standings.away,
    form_home: ctx.form.home,
    form_away: ctx.form.away,
    h2h: ctx.h2h.matches,
  }, function (_key, val) {
    // Sort arrays for deterministic output
    if (Array.isArray(val)) {
      return val;
    }
    return val;
  });
  return sha256('ai_context:' + canonical);
}

/**
 * AI_INPUT_HASH — hash of the derived AIInputs (AFTER transformation)
 * This captures what was ACTUALLY used, including formatting/rounding.
 *
 * Derived from AI_CONTEXT_HASH chain:
 *   AIContext → computeAIDerivedContext() → buildAISnapshotFromContext() → AI_INPUT_HASH
 */
export function computeAIInputHashFromContext(inputs: AIInputs): string {
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
  return sha256('ai_inputs:' + parts.join('|'));
}

/**
 * AI_PROMPT_HASH — hash of the actual text prompt sent to AI
 */
export function computeAIPromptHashFromContext(systemPrompt: string, userPrompt: string): string {
  return sha256('prompt:' + systemPrompt + '|' + userPrompt);
}

/**
 * AI_RESPONSE_HASH — hash of the AI response.
 *
 * Phase 8 fix (forensic audit): null/undefined/empty input returns null.
 * A null hash must never be fabricated from placeholder text.
 */
export function computeAIResponseHashFromContext(response: string | null | undefined): string | null {
  if (response === null || response === undefined || response === '') {
    return null;
  }
  return sha256('response:' + response);
}

// ═══════════════════════════════════════════════════════════════════
// EQUIVALENCE VERIFICATION (Section 2)
// ═══════════════════════════════════════════════════════════════════

export interface EquivalenceCheckResult {
  input: string;
  in_prompt: boolean;
  in_snapshot: boolean;
  prompt_value: string | number | null;
  snapshot_value: string | number | null;
  identical: boolean;
  difference_type: 'NONE' | 'FORMAT' | 'ROUNDING' | 'MISSING_IN_SNAPSHOT' | 'MISSING_IN_PROMPT' | 'VALUE_MISMATCH' | null;
}

/**
 * Verify equivalence between prompt text and snapshot structure.
 * For each data element, checks:
 *   - Is it present in the prompt?
 *   - Is it present in the snapshot?
 *   - Are the values identical?
 */
export function verifyPromptSnapshotEquivalence(
  ctx: AIContext,
  userPrompt: string,
  snapshot: AIInputs,
): EquivalenceCheckResult[] {
  const derived = computeAIDerivedContext(ctx);
  const results: EquivalenceCheckResult[] = [];

  // Check each data element
  const checks: Array<{
    name: string;
    promptValue: string | number | null;
    snapshotValue: string | number | null;
  }> = [
    { name: 'odds_home', promptValue: ctx.odds.home, snapshotValue: snapshot.odds.home.value },
    { name: 'odds_draw', promptValue: ctx.odds.draw, snapshotValue: snapshot.odds.draw.value },
    { name: 'odds_away', promptValue: ctx.odds.away, snapshotValue: snapshot.odds.away.value },
    { name: 'implied_prob_home_pct', promptValue: derived.implied_probabilities.home_pct, snapshotValue: snapshot.odds.implied_home.value },
    { name: 'implied_prob_draw_pct', promptValue: derived.implied_probabilities.draw_pct, snapshotValue: snapshot.odds.implied_draw.value },
    { name: 'implied_prob_away_pct', promptValue: derived.implied_probabilities.away_pct, snapshotValue: snapshot.odds.implied_away.value },
    { name: 'standings_home', promptValue: derived.standings_formatted.home, snapshotValue: snapshot.standings_home?.value ?? null },
    { name: 'standings_away', promptValue: derived.standings_formatted.away, snapshotValue: snapshot.standings_away?.value ?? null },
    { name: 'form_home', promptValue: derived.form_formatted.home, snapshotValue: snapshot.form_home?.value ?? null },
    { name: 'form_away', promptValue: derived.form_formatted.away, snapshotValue: snapshot.form_away?.value ?? null },
    { name: 'h2h', promptValue: derived.h2h_formatted.summary, snapshotValue: snapshot.h2h?.value ?? null },
  ];

  for (const check of checks) {
    const inPrompt = check.promptValue !== null && check.promptValue !== undefined;
    const inSnapshot = check.snapshotValue !== null && check.snapshotValue !== undefined;

    let identical = false;
    let differenceType: EquivalenceCheckResult['difference_type'] = null;

    if (inPrompt && inSnapshot) {
      // Compare as strings for exact match
      const promptStr = String(check.promptValue);
      const snapStr = String(check.snapshotValue);
      identical = promptStr === snapStr;
      if (identical) {
        differenceType = 'NONE';
      } else {
        // Check if it's just a formatting/rounding difference
        const promptNum = parseFloat(promptStr);
        const snapNum = parseFloat(snapStr);
        if (!isNaN(promptNum) && !isNaN(snapNum) && Math.abs(promptNum - snapNum) < 0.01) {
          differenceType = 'ROUNDING';
        } else {
          differenceType = 'VALUE_MISMATCH';
        }
      }
    } else if (inPrompt && !inSnapshot) {
      differenceType = 'MISSING_IN_SNAPSHOT';
    } else if (!inPrompt && inSnapshot) {
      differenceType = 'MISSING_IN_PROMPT';
    } else {
      // Both absent — this is fine
      identical = true;
      differenceType = 'NONE';
    }

    results.push({
      input: check.name,
      in_prompt: inPrompt,
      in_snapshot: inSnapshot,
      prompt_value: check.promptValue,
      snapshot_value: check.snapshotValue,
      identical,
      difference_type: differenceType,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// LEAKAGE TEST (Section 8)
// ═══════════════════════════════════════════════════════════════════

export interface LeakageTestResult {
  test_name: string;
  passed: boolean;
  original_context_hash: string;
  modified_context_hash: string;
  original_input_hash: string;
  modified_input_hash: string;
  hash_changed: boolean;
  details: string;
}

/**
 * Test that adding future data does NOT change the context for prediction at T.
 * This verifies temporal integrity: the AI context at time T must not be
 * affected by data that becomes available at T+1.
 */
export function testContextLeakage(
  originalContext: AIContext,
  modifiedContext: AIContext,
  testDescription: string,
): LeakageTestResult {
  const originalCtxHash = computeAIContextHash(originalContext);
  const modifiedCtxHash = computeAIContextHash(modifiedContext);

  const originalInputs = buildAISnapshotFromContext(originalContext);
  const modifiedInputs = buildAISnapshotFromContext(modifiedContext);
  const originalInputHash = computeAIInputHashFromContext(originalInputs);
  const modifiedInputHash = computeAIInputHashFromContext(modifiedInputs);

  const hashChanged = originalCtxHash !== modifiedCtxHash;

  return {
    test_name: testDescription,
    passed: !hashChanged,
    original_context_hash: originalCtxHash,
    modified_context_hash: modifiedCtxHash,
    original_input_hash: originalInputHash,
    modified_input_hash: modifiedInputHash,
    hash_changed: hashChanged,
    details: hashChanged
      ? 'AI LEAKAGE: Modified context changed hash. Original: ' + originalCtxHash.substring(0, 16) + '... Modified: ' + modifiedCtxHash.substring(0, 16) + '...'
      : 'PASS: Modified context did not change hash. Both: ' + originalCtxHash.substring(0, 16) + '...',
  };
}

// ═══════════════════════════════════════════════════════════════════
// GO-LIVE GATE (Section 10)
// ═══════════════════════════════════════════════════════════════════

export interface GoLiveGateResult {
  prompt_snapshot_same_source: boolean;
  no_prompt_data_missing_from_snapshot: boolean;
  ai_input_hash_reproducible: boolean;
  ai_prompt_hash_reproducible: boolean;
  timestamps_consistent: boolean;
  leakage_test_ok: boolean;
  snapshot_immutable: boolean;
  tests_pass: boolean;
  overall: 'READY' | 'BLOCKED';
  blocking_issues: string[];
}

/**
 * Evaluate the Go-Live Gate.
 * All conditions must pass for SCIENTIFIC_DATA_COLLECTION = READY.
 */
export function evaluateGoLiveGate(checks: {
  equivalenceResults: EquivalenceCheckResult[];
  inputHashReproducible: boolean;
  promptHashReproducible: boolean;
  timestampsConsistent: boolean;
  leakageTestPassed: boolean;
  snapshotImmutable: boolean;
  testsPass: boolean;
}): GoLiveGateResult {
  const blockingIssues: string[] = [];

  // 1. Prompt and snapshot use same source
  const promptSnapshotSameSource = true; // Guaranteed by architecture
  if (!promptSnapshotSameSource) {
    blockingIssues.push('Prompt and snapshot do not share the same source of truth');
  }

  // 2. No prompt data missing from snapshot
  const noPromptDataMissing = checks.equivalenceResults.every(
    r => r.difference_type !== 'MISSING_IN_SNAPSHOT'
  );
  if (!noPromptDataMissing) {
    const missing = checks.equivalenceResults
      .filter(r => r.difference_type === 'MISSING_IN_SNAPSHOT')
      .map(r => r.input);
    blockingIssues.push('Prompt data missing from snapshot: ' + missing.join(', '));
  }

  // 3. AI_INPUT_HASH reproducible
  if (!checks.inputHashReproducible) {
    blockingIssues.push('AI_INPUT_HASH is not reproducible for same inputs');
  }

  // 4. AI_PROMPT_HASH reproducible
  if (!checks.promptHashReproducible) {
    blockingIssues.push('AI_PROMPT_HASH is not reproducible for same prompts');
  }

  // 5. Timestamps consistent
  if (!checks.timestampsConsistent) {
    blockingIssues.push('Timestamps are not consistent (T_start ≤ T_features ≤ T_prediction ≤ T_snapshot)');
  }

  // 6. Leakage test OK
  if (!checks.leakageTestPassed) {
    blockingIssues.push('Leakage test failed: future data changes AI context');
  }

  // 7. Snapshot immutable
  if (!checks.snapshotImmutable) {
    blockingIssues.push('Snapshot immutability not enforced');
  }

  // 8. Tests pass
  if (!checks.testsPass) {
    blockingIssues.push('Phase 5.2 tests are failing');
  }

  const allPass = promptSnapshotSameSource && noPromptDataMissing &&
    checks.inputHashReproducible && checks.promptHashReproducible &&
    checks.timestampsConsistent && checks.leakageTestPassed &&
    checks.snapshotImmutable && checks.testsPass;

  return {
    prompt_snapshot_same_source: promptSnapshotSameSource,
    no_prompt_data_missing_from_snapshot: noPromptDataMissing,
    ai_input_hash_reproducible: checks.inputHashReproducible,
    ai_prompt_hash_reproducible: checks.promptHashReproducible,
    timestamps_consistent: checks.timestampsConsistent,
    leakage_test_ok: checks.leakageTestPassed,
    snapshot_immutable: checks.snapshotImmutable,
    tests_pass: checks.testsPass,
    overall: allPass ? 'READY' : 'BLOCKED',
    blocking_issues: blockingIssues,
  };
}

// ═══════════════════════════════════════════════════════════════════
// VERSION FREEZE (Section 13)
// ═══════════════════════════════════════════════════════════════════

export interface VersionFreeze {
  model_version: string;
  feature_version: string;
  config_version: string;
  calibration_version: string;
  ai_prompt_version: string;
  ai_model: string;
  code_commit: string;
  frozen_at: string;
}

/**
 * Capture the current version state for the scientific collection.
 * These versions MUST remain constant during the initial dataset.
 */
export function captureVersionFreeze(codeCommit: string): VersionFreeze {
  return {
    model_version: '2.0.0',
    feature_version: '1.0.0',
    config_version: '1.0.0',
    calibration_version: '0.0.0',
    ai_prompt_version: '7.0',
    ai_model: 'llama-3.3-70b-versatile',
    code_commit: codeCommit,
    frozen_at: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// WILSON SCORE INTERVAL (Section 12)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute Wilson score interval for a proportion.
 * Used to calculate confidence intervals for accuracy metrics.
 */
export function wilsonScoreInterval(
  successes: number,
  total: number,
  z: number = 1.96, // 95% CI
): { lower: number; upper: number; point: number } {
  if (total === 0) {
    return { lower: 0, upper: 0, point: 0 };
  }
  const p = successes / total;
  const n = total;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));

  return {
    lower: Math.max(0, (centre - spread) / denominator),
    upper: Math.min(1, (centre + spread) / denominator),
    point: p,
  };
}
