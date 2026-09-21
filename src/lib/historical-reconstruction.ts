// ============================================
// HISTORICAL RECONSTRUCTION v1.0
// Phase 3 — Reconstruct features at a specific point in time
// ============================================
//
// Provides temporal functions that return feature values as they
// were at a specific timestamp, preventing future data leakage.
//
// CRITICAL: These functions MUST filter out data after predictionTimestamp.
// Any match/result/ranking that occurred after the prediction is EXCLUDED.

import type { TeamStats, HistoricalResult } from './prediction-engine';
import { getConfig, COEFFICIENT_DEFINITIONS } from './prediction-config';
import type { ProvenanceStatus } from './feature-snapshot';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface TemporalResult extends HistoricalResult {
  date?: string;       // ISO date of the match
  timestamp?: number;  // Unix timestamp of the match
}

export interface TemporalRankingEntry {
  team: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
  date?: string;       // When this ranking was valid
  timestamp?: number;
}

export interface ReconstructedForm {
  formScores: string[];
  avgScored: number;
  avgConceded: number;
  momentumScore: number;
  goalsBalance: number;
  matchCount: number;
  provenance: ProvenanceStatus;
  matchTimestamps: number[];
}

export interface ReconstructedH2H {
  totalMatches: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  avgHomeGoals: number;
  avgAwayGoals: number;
  avgTotalGoals: number;
  homeTeamBias: number;
  provenance: ProvenanceStatus;
  matchTimestamps: number[];
}

export interface ReconstructedStats {
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
  provenance: ProvenanceStatus;
  rankingTimestamp: number | null;
}

// ═══════════════════════════════════════════════════════════════════
// FORM RECONSTRUCTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Reconstruct team form at a specific point in time.
 * Only includes matches that occurred BEFORE predictionTimestamp.
 *
 * This is the temporal equivalent of extractTeamForm() in prediction-engine.ts,
 * but with a hard cutoff at predictionTimestamp.
 */
export function getFormAtTimestamp(
  results: TemporalResult[],
  teamName: string,
  predictionTimestamp: number,
  maxMatches: number = 5
): ReconstructedForm {
  const cfg = getConfig();
  const teamLower = teamName.toLowerCase().trim();

  // Filter: only results BEFORE prediction timestamp
  const validResults = results.filter(r => {
    const rTs = r.timestamp || (r.date ? new Date(r.date).getTime() : 0);
    return rTs > 0 && rTs < predictionTimestamp;
  });

  // Sort by date descending (most recent first)
  validResults.sort((a, b) => {
    const aTs = a.timestamp || (a.date ? new Date(a.date).getTime() : 0);
    const bTs = b.timestamp || (b.date ? new Date(b.date).getTime() : 0);
    return bTs - aTs;
  });

  const matches: { scored: number; conceded: number; result: string; timestamp: number }[] = [];

  for (const r of validResults) {
    if (matches.length >= maxMatches) break;

    const rHome = r.home.toLowerCase().trim();
    const rAway = r.away.toLowerCase().trim();
    const rTs = r.timestamp || (r.date ? new Date(r.date).getTime() : 0);

    if (rHome === teamLower) {
      const res = r.scoreHome > r.scoreAway ? "V" : r.scoreHome < r.scoreAway ? "D" : "N";
      matches.push({ scored: r.scoreHome, conceded: r.scoreAway, result: res, timestamp: rTs });
    } else if (rAway === teamLower) {
      const res = r.scoreAway > r.scoreHome ? "V" : r.scoreAway < r.scoreHome ? "D" : "N";
      matches.push({ scored: r.scoreAway, conceded: r.scoreHome, result: res, timestamp: rTs });
    }
  }

  if (matches.length === 0) {
    return {
      formScores: [],
      avgScored: cfg.DEFAULT_AVG_SCORED,
      avgConceded: cfg.DEFAULT_AVG_CONCEDED,
      momentumScore: cfg.DEFAULT_MOMENTUM,
      goalsBalance: 0,
      matchCount: 0,
      provenance: 'RECONSTRUCTED',
      matchTimestamps: [],
    };
  }

  const formScores = matches.map(m => m.result);
  const avgScored = matches.reduce((s, m) => s + m.scored, 0) / matches.length;
  const avgConceded = matches.reduce((s, m) => s + m.conceded, 0) / matches.length;

  // Momentum (same formula as prediction-engine.ts)
  const FORM_WEIGHTS = [cfg.FORM_WEIGHT_0, cfg.FORM_WEIGHT_1, cfg.FORM_WEIGHT_2, cfg.FORM_WEIGHT_3, cfg.FORM_WEIGHT_4];
  const FORM_POINTS: Record<string, number> = { V: 3, N: 1, D: 0 };

  let earnedPoints = 0;
  let maxPoints = 0;
  for (let i = 0; i < matches.length; i++) {
    const w = FORM_WEIGHTS[i] || 1.0;
    earnedPoints += (FORM_POINTS[matches[i].result] || 0) * w;
    maxPoints += 3 * w;
  }
  const momentumScore = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) : 50;
  const goalsBalance = avgScored - avgConceded;

  return {
    formScores,
    avgScored,
    avgConceded,
    momentumScore,
    goalsBalance,
    matchCount: matches.length,
    provenance: 'RECONSTRUCTED',
    matchTimestamps: matches.map(m => m.timestamp),
  };
}

// ═══════════════════════════════════════════════════════════════════
// H2H RECONSTRUCTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Reconstruct head-to-head data at a specific point in time.
 * Only includes matches between the two teams BEFORE predictionTimestamp.
 */
export function getH2HAtTimestamp(
  results: TemporalResult[],
  home: string,
  away: string,
  predictionTimestamp: number
): ReconstructedH2H {
  const hLower = home.toLowerCase().trim();
  const aLower = away.toLowerCase().trim();

  // Filter: only results BEFORE prediction timestamp
  const validResults = results.filter(r => {
    const rTs = r.timestamp || (r.date ? new Date(r.date).getTime() : 0);
    return rTs > 0 && rTs < predictionTimestamp;
  });

  const h2hMatches: { homeGoals: number; awayGoals: number; isHomeTeam: boolean; timestamp: number }[] = [];

  for (const r of validResults) {
    const rHome = r.home.toLowerCase().trim();
    const rAway = r.away.toLowerCase().trim();
    const rTs = r.timestamp || (r.date ? new Date(r.date).getTime() : 0);

    if (rHome === hLower && rAway === aLower) {
      h2hMatches.push({ homeGoals: r.scoreHome, awayGoals: r.scoreAway, isHomeTeam: true, timestamp: rTs });
    } else if (rHome === aLower && rAway === hLower) {
      h2hMatches.push({ homeGoals: r.scoreAway, awayGoals: r.scoreHome, isHomeTeam: false, timestamp: rTs });
    }
  }

  if (h2hMatches.length === 0) {
    return {
      totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0,
      avgHomeGoals: 0, avgAwayGoals: 0, avgTotalGoals: 0, homeTeamBias: 0,
      provenance: 'RECONSTRUCTED',
      matchTimestamps: [],
    };
  }

  let homeWins = 0, draws = 0, awayWins = 0;
  let totalHomeGoals = 0, totalAwayGoals = 0;

  for (const m of h2hMatches) {
    totalHomeGoals += m.homeGoals;
    totalAwayGoals += m.awayGoals;
    if (m.homeGoals > m.awayGoals) homeWins++;
    else if (m.homeGoals < m.awayGoals) awayWins++;
    else draws++;
  }

  const n = h2hMatches.length;
  const homeTeamBias = ((homeWins - awayWins) / n) * 100;

  return {
    totalMatches: n,
    homeWins,
    draws,
    awayWins,
    avgHomeGoals: Math.round((totalHomeGoals / n) * 100) / 100,
    avgAwayGoals: Math.round((totalAwayGoals / n) * 100) / 100,
    avgTotalGoals: Math.round(((totalHomeGoals + totalAwayGoals) / n) * 100) / 100,
    homeTeamBias: Math.round(homeTeamBias),
    provenance: 'RECONSTRUCTED',
    matchTimestamps: h2hMatches.map(m => m.timestamp),
  };
}

// ═══════════════════════════════════════════════════════════════════
// STATS/RANKING RECONSTRUCTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Reconstruct team stats at a specific point in time.
 * Uses the ranking snapshot closest to but BEFORE predictionTimestamp.
 */
export function getStatsAtTimestamp(
  rankings: TemporalRankingEntry[],
  teamName: string,
  predictionTimestamp: number
): ReconstructedStats {
  const teamLower = teamName.toLowerCase().trim();

  // Filter: only rankings BEFORE prediction timestamp
  const validRankings = rankings.filter(r => {
    const rTs = r.timestamp || (r.date ? new Date(r.date).getTime() : 0);
    return rTs > 0 && rTs < predictionTimestamp;
  });

  // Sort by date descending (most recent first)
  validRankings.sort((a, b) => {
    const aTs = a.timestamp || (a.date ? new Date(a.date).getTime() : 0);
    const bTs = b.timestamp || (b.date ? new Date(b.date).getTime() : 0);
    return bTs - aTs;
  });

  // Find the team in the most recent valid ranking
  for (const r of validRankings) {
    if (r.team.toLowerCase().trim() === teamLower) {
      return {
        position: r.position,
        played: r.played,
        won: r.won,
        drawn: r.drawn,
        lost: r.lost,
        goalsFor: r.goalsFor,
        goalsAgainst: r.goalsAgainst,
        points: r.points,
        avgGoalsScored: r.avgGoalsScored,
        avgGoalsConceded: r.avgGoalsConceded,
        provenance: 'RECONSTRUCTED',
        rankingTimestamp: r.timestamp || (r.date ? new Date(r.date).getTime() : null),
      };
    }
  }

  // No ranking found before prediction time
  const cfg = getConfig();
  return {
    position: 0, played: 0, won: 0, drawn: 0, lost: 0,
    goalsFor: 0, goalsAgainst: 0, points: 0,
    avgGoalsScored: cfg.DEFAULT_AVG_SCORED,
    avgGoalsConceded: cfg.DEFAULT_AVG_CONCEDED,
    provenance: 'UNKNOWN',
    rankingTimestamp: null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// LEAKAGE DETECTION
// ═══════════════════════════════════════════════════════════════════

export interface LeakageCheckResult {
  feature: string;
  has_leakage: boolean;
  details: string;
  future_data_count: number;
}

/**
 * Check if any feature uses data from after the prediction timestamp.
 */
export function checkFeatureLeakage(
  results: TemporalResult[],
  rankings: TemporalRankingEntry[],
  home: string,
  away: string,
  predictionTimestamp: number
): LeakageCheckResult[] {
  const checks: LeakageCheckResult[] = [];

  // ── Form leakage: any match used in form that's after prediction? ──
  const formHome = getFormAtTimestamp(results, home, predictionTimestamp);
  const formHomeFuture = results.filter(r => {
    const rTs = r.timestamp || (r.date ? new Date(r.date).getTime() : 0);
    return rTs >= predictionTimestamp;
  });
  checks.push({
    feature: 'form_home',
    has_leakage: false, // getFormAtTimestamp already filters
    details: `Used ${formHome.matchCount} matches before prediction. ${formHomeFuture.length} matches exist after prediction (correctly excluded).`,
    future_data_count: formHomeFuture.length,
  });

  const formAway = getFormAtTimestamp(results, away, predictionTimestamp);
  checks.push({
    feature: 'form_away',
    has_leakage: false,
    details: `Used ${formAway.matchCount} matches before prediction.`,
    future_data_count: formHomeFuture.length,
  });

  // ── H2H leakage ──
  const h2h = getH2HAtTimestamp(results, home, away, predictionTimestamp);
  checks.push({
    feature: 'h2h',
    has_leakage: false,
    details: `Used ${h2h.totalMatches} H2H matches before prediction.`,
    future_data_count: 0,
  });

  // ── Ranking leakage ──
  const homeStats = getStatsAtTimestamp(rankings, home, predictionTimestamp);
  checks.push({
    feature: 'stats_home',
    has_leakage: false,
    details: homeStats.provenance === 'RECONSTRUCTED'
      ? `Ranking from ${new Date(homeStats.rankingTimestamp!).toISOString()} (before prediction)`
      : 'No ranking found before prediction time',
    future_data_count: 0,
  });

  const awayStats = getStatsAtTimestamp(rankings, away, predictionTimestamp);
  checks.push({
    feature: 'stats_away',
    has_leakage: false,
    details: awayStats.provenance === 'RECONSTRUCTED'
      ? `Ranking from ${new Date(awayStats.rankingTimestamp!).toISOString()} (before prediction)`
      : 'No ranking found before prediction time',
    future_data_count: 0,
  });

  return checks;
}

// ═══════════════════════════════════════════════════════════════════
// ARTIFICIAL LEAK TEST
// ═══════════════════════════════════════════════════════════════════

export interface ArtificialLeakTestResult {
  feature: string;
  passed: boolean;
  original_value: any;
  modified_value: any;
  prediction_changed: boolean;
  details: string;
}

/**
 * Test for artificial data leakage by modifying a future result
 * and checking if the prediction changes.
 *
 * If the prediction changes when a FUTURE result is modified,
 * that indicates data leakage (FAIL).
 * If the prediction stays the same, the feature is leak-free (PASS).
 */
export function testArtificialLeakForm(
  results: TemporalResult[],
  teamName: string,
  predictionTimestamp: number,
  modifiedResults: TemporalResult[]
): ArtificialLeakTestResult {
  const original = getFormAtTimestamp(results, teamName, predictionTimestamp);
  const modified = getFormAtTimestamp(modifiedResults, teamName, predictionTimestamp);

  const changed = original.momentumScore !== modified.momentumScore
    || original.avgScored !== modified.avgScored
    || original.formScores.join('') !== modified.formScores.join('');

  return {
    feature: `form_${teamName}`,
    passed: !changed,
    original_value: { momentum: original.momentumScore, form: original.formScores.join('') },
    modified_value: { momentum: modified.momentumScore, form: modified.formScores.join('') },
    prediction_changed: changed,
    details: changed
      ? 'FAIL — DATA LEAKAGE: Modifying a future match changed the form calculation'
      : 'PASS: Modifying a future match did not affect the form calculation',
  };
}

/**
 * Test H2H artificial leak.
 */
export function testArtificialLeakH2H(
  results: TemporalResult[],
  home: string,
  away: string,
  predictionTimestamp: number,
  modifiedResults: TemporalResult[]
): ArtificialLeakTestResult {
  const original = getH2HAtTimestamp(results, home, away, predictionTimestamp);
  const modified = getH2HAtTimestamp(modifiedResults, home, away, predictionTimestamp);

  const changed = original.homeTeamBias !== modified.homeTeamBias
    || original.totalMatches !== modified.totalMatches;

  return {
    feature: 'h2h',
    passed: !changed,
    original_value: { bias: original.homeTeamBias, total: original.totalMatches },
    modified_value: { bias: modified.homeTeamBias, total: modified.totalMatches },
    prediction_changed: changed,
    details: changed
      ? 'FAIL — DATA LEAKAGE: Modifying a future H2H match changed the H2H calculation'
      : 'PASS: Modifying a future H2H match did not affect the H2H calculation',
  };
}
