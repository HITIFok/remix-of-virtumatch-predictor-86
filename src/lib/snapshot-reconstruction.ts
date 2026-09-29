// ============================================
// SNAPSHOT RECONSTRUCTION — Phase 5.3.19
// Reconstructs analyzeMatch inputs from a stored feature_snapshot JSONB
// ============================================
//
// The feature_snapshot stored in Neon predictions is the AIContext
// serialization produced by computeAITraces() in api/analyze-match.js.
// Its top-level shape is:
//   {
//     odds: { home, draw, away, source_timestamp },
//     standings: { home: RankingInput|null, away: RankingInput|null, source_timestamp },
//     form: { home: FormEntry[]|null, away: FormEntry[]|null, source_timestamp },
//     h2h: { matches: H2HEntry[]|null, source_timestamp },
//     source_timestamps: { odds, ranking, form, h2h },
//     ai_snapshot: AIInputs,
//     match_index: number,
//     schema_version: string,
//   }
//
// This module transforms that JSONB back into the inputs that
// analyzeMatch() expects: MatchInput + teamStats + historicalResults.
//
// IMPORTANT LIMITATIONS:
//   1. Team names are NOT in the snapshot — they come from the prediction row
//      (home_team, away_team columns). The caller must supply them.
//   2. H2H matches in the snapshot have {scoreHome, scoreAway} WITHOUT team
//      assignment (which team was home in each historical match). We assume
//      all H2H matches had the prediction's home team as home. This may
//      produce a different homeTeamBias than production when the prediction's
//      away team was home in some historical H2H matches.
//   3. The AI prediction (AIPrediction) is NOT reconstructible from the
//      snapshot — only the AI INPUTS are stored (ai_snapshot), not the AI
//      RESPONSE. The ai_response_hash is the cryptographic proof that a
//      response existed, but the response content is not persisted.
//      Therefore, the backtest CANNOT reproduce the AI-blended model.
//      WITHOUT_AI is the only ablation that matches what we can backtest.
//
// PURITY CONTRACT:
//   - PURE function (no side effects)
//   - DETERMINISTIC (same input → same output, always)
//   - NO network calls
//   - NO database writes
//   - NO Groq calls

import type { MatchInput, TeamStats, HistoricalResult } from './prediction-engine';

// ─── Types matching the stored JSONB shape ─────────────────────────────

/** The FormEntry as stored in the snapshot (has extra 'opponent' field). */
export interface StoredFormEntry {
  result: string;       // 'V' | 'N' | 'D'
  opponent?: string;    // opponent team name (may be absent in old snapshots)
  scoreHome: number;    // goals scored by the team (from team's perspective)
  scoreAway: number;    // goals conceded by the team (from team's perspective)
}

/** The H2HEntry as stored in the snapshot. */
export interface StoredH2HEntry {
  scoreHome: number;    // historical match home team's score
  scoreAway: number;    // historical match away team's score
}

/** The RankingInput as stored in the snapshot (may have extra fields). */
export interface StoredRankingInput {
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  goalDifference?: number;
}

/** The exact shape of the feature_snapshot JSONB stored in Neon. */
export interface StoredFeatureSnapshot {
  odds: {
    home: number;
    draw: number;
    away: number;
    source_timestamp: string | null;
  };
  standings: {
    home: StoredRankingInput | null;
    away: StoredRankingInput | null;
    source_timestamp: string | null;
  };
  form: {
    home: StoredFormEntry[] | null;
    away: StoredFormEntry[] | null;
    source_timestamp: string | null;
  };
  h2h: {
    matches: StoredH2HEntry[] | null;
    source_timestamp: string | null;
  };
  source_timestamps: {
    odds: string | null;
    ranking: string | null;
    form: string | null;
    h2h: string | null;
  };
  ai_snapshot: unknown;  // AIInputs — not used for reconstruction
  match_index: number;
  schema_version: string;
}

// ─── Reconstruction result ─────────────────────────────────────────────

export interface ReconstructedInputs {
  match: MatchInput;
  teamStats: Map<string, TeamStats>;
  historicalResults: HistoricalResult[];
  /** Warnings encountered during reconstruction (non-fatal). */
  warnings: string[];
  /** True if any critical data was missing/invalid. */
  hasGaps: boolean;
}

// ─── Main reconstruction function ───────────────────────────────────────

/**
 * Reconstruct analyzeMatch inputs from a stored feature_snapshot.
 *
 * @param snapshot The feature_snapshot JSONB from Neon predictions table.
 * @param homeTeam The home team name (from predictions.home_team).
 * @param awayTeam The away team name (from predictions.away_team).
 * @param league The league name (from predictions.league, optional).
 * @returns ReconstructedInputs with match, teamStats, historicalResults.
 */
export function reconstructMatchInputFromSnapshot(
  snapshot: StoredFeatureSnapshot | null | undefined,
  homeTeam: string,
  awayTeam: string,
  league: string = 'Unknown',
): ReconstructedInputs {
  const warnings: string[] = [];
  let hasGaps = false;

  // Handle null/undefined snapshot
  if (!snapshot || typeof snapshot !== 'object') {
    hasGaps = true;
    warnings.push('snapshot is null/undefined — returning minimal odds-only inputs');
    return {
      match: {
        home: homeTeam,
        away: awayTeam,
        league,
        oddHome: 0,
        oddDraw: 0,
        oddAway: 0,
      },
      teamStats: new Map<string, TeamStats>(),
      historicalResults: [],
      warnings,
      hasGaps,
    };
  }

  // ── 1. Reconstruct MatchInput (odds) ──
  const odds = snapshot.odds;
  if (!odds || typeof odds.home !== 'number' || typeof odds.draw !== 'number' || typeof odds.away !== 'number') {
    hasGaps = true;
    warnings.push('odds missing or invalid — using 0.0 for all odds (will produce degenerate Poisson)');
  }
  const match: MatchInput = {
    home: homeTeam,
    away: awayTeam,
    league,
    oddHome: odds?.home ?? 0,
    oddDraw: odds?.draw ?? 0,
    oddAway: odds?.away ?? 0,
  };

  // ── 2. Reconstruct teamStats Map (standings) ──
  const teamStats = new Map<string, TeamStats>();
  const standings = snapshot.standings;

  if (standings?.home) {
    const s = standings.home;
    const played = s.played || 0;
    teamStats.set(homeTeam, {
      name: homeTeam,
      position: s.position || 0,
      played,
      won: s.won || 0,
      drawn: s.drawn || 0,
      lost: s.lost || 0,
      goalsFor: s.goalsFor || 0,
      goalsAgainst: s.goalsAgainst || 0,
      points: s.points || 0,
      form: [],  // form is reconstructed separately via historicalResults
      avgGoalsScored: played > 0 ? (s.goalsFor || 0) / played : 1.3,
      avgGoalsConceded: played > 0 ? (s.goalsAgainst || 0) / played : 1.1,
      winRate: played > 0 ? (s.won || 0) / played : 0.5,
    });
  } else {
    hasGaps = true;
    warnings.push('standings.home is null — home team stats will not be available');
  }

  if (standings?.away) {
    const s = standings.away;
    const played = s.played || 0;
    teamStats.set(awayTeam, {
      name: awayTeam,
      position: s.position || 0,
      played,
      won: s.won || 0,
      drawn: s.drawn || 0,
      lost: s.lost || 0,
      goalsFor: s.goalsFor || 0,
      goalsAgainst: s.goalsAgainst || 0,
      points: s.points || 0,
      form: [],
      avgGoalsScored: played > 0 ? (s.goalsFor || 0) / played : 1.3,
      avgGoalsConceded: played > 0 ? (s.goalsAgainst || 0) / played : 1.1,
      winRate: played > 0 ? (s.won || 0) / played : 0.5,
    });
  } else {
    hasGaps = true;
    warnings.push('standings.away is null — away team stats will not be available');
  }

  // ── 3. Reconstruct historicalResults (form + H2H) ──
  const historicalResults: HistoricalResult[] = [];

  // Form entries: each entry is {result, opponent, scoreHome, scoreAway}
  // from the TEAM's perspective. We reconstruct as HistoricalResult where
  // the team is always 'home' and the opponent is always 'away'.
  // extractTeamForm() checks rHome === teamName → matches on our reconstruction.
  const formData = snapshot.form;
  if (formData?.home && Array.isArray(formData.home)) {
    for (const entry of formData.home) {
      if (entry && typeof entry.scoreHome === 'number' && typeof entry.scoreAway === 'number') {
        historicalResults.push({
          home: homeTeam,
          away: entry.opponent || 'Unknown',
          scoreHome: entry.scoreHome,
          scoreAway: entry.scoreAway,
          round: 0,   // round not available in snapshot
          league: league,
        });
      }
    }
  } else {
    hasGaps = true;
    warnings.push('form.home is null/empty — home team form will not be available');
  }

  if (formData?.away && Array.isArray(formData.away)) {
    for (const entry of formData.away) {
      if (entry && typeof entry.scoreHome === 'number' && typeof entry.scoreAway === 'number') {
        historicalResults.push({
          home: awayTeam,
          away: entry.opponent || 'Unknown',
          scoreHome: entry.scoreHome,
          scoreAway: entry.scoreAway,
          round: 0,
          league: league,
        });
      }
    }
  } else {
    hasGaps = true;
    warnings.push('form.away is null/empty — away team form will not be available');
  }

  // H2H entries: each entry is {scoreHome, scoreAway} — the ACTUAL historical
  // match score. We don't know which team was home in each historical match.
  // We assume the prediction's home team was home in ALL H2H matches.
  // This is a KNOWN SIMPLIFICATION — see module-level comment above.
  const h2hData = snapshot.h2h;
  if (h2hData?.matches && Array.isArray(h2hData.matches) && h2hData.matches.length > 0) {
    for (const entry of h2hData.matches) {
      if (entry && typeof entry.scoreHome === 'number' && typeof entry.scoreAway === 'number') {
        historicalResults.push({
          home: homeTeam,   // simplification: prediction home = historical home
          away: awayTeam,
          scoreHome: entry.scoreHome,
          scoreAway: entry.scoreAway,
          round: 0,
          league: league,
        });
      }
    }
  }
  // Note: if h2h.matches is null/empty, we don't add a warning — H2H is
  // legitimately absent for many matches (especially new season).

  return {
    match,
    teamStats,
    historicalResults,
    warnings,
    hasGaps,
  };
}

// ─── Helper: check if snapshot has all required components ─────────────

export interface SnapshotCompleteness {
  hasOdds: boolean;
  hasStandingsHome: boolean;
  hasStandingsAway: boolean;
  hasFormHome: boolean;
  hasFormAway: boolean;
  hasH2H: boolean;
  hasSourceTimestamps: boolean;
  hasAiSnapshot: boolean;
  isComplete: boolean;  // all of the above (except hasH2H which is optional)
}

export function checkSnapshotCompleteness(snapshot: StoredFeatureSnapshot | null | undefined): SnapshotCompleteness {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      hasOdds: false, hasStandingsHome: false, hasStandingsAway: false,
      hasFormHome: false, hasFormAway: false, hasH2H: false,
      hasSourceTimestamps: false, hasAiSnapshot: false, isComplete: false,
    };
  }
  const hasOdds = !!snapshot.odds && typeof snapshot.odds.home === 'number';
  const hasStandingsHome = !!snapshot.standings?.home;
  const hasStandingsAway = !!snapshot.standings?.away;
  const hasFormHome = !!(snapshot.form?.home && Array.isArray(snapshot.form.home) && snapshot.form.home.length > 0);
  const hasFormAway = !!(snapshot.form?.away && Array.isArray(snapshot.form.away) && snapshot.form.away.length > 0);
  const hasH2H = !!(snapshot.h2h?.matches && Array.isArray(snapshot.h2h.matches) && snapshot.h2h.matches.length > 0);
  const hasSourceTimestamps = !!snapshot.source_timestamps;
  const hasAiSnapshot = !!snapshot.ai_snapshot;

  return {
    hasOdds,
    hasStandingsHome,
    hasStandingsAway,
    hasFormHome,
    hasFormAway,
    hasH2H,
    hasSourceTimestamps,
    hasAiSnapshot,
    isComplete: hasOdds && hasStandingsHome && hasStandingsAway && hasFormHome && hasFormAway && hasSourceTimestamps,
  };
}
