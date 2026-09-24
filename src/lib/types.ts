export interface PredeterminedScore {
  home: number;
  away: number;
  minute: number;
}

export interface ScoreExactOdds {
  predictedHome: number;
  predictedAway: number;
  odds: number;
  topScores: { score: string; home: number; away: number; odds: number }[];
}

export interface ScrapedMatch {
  id?: number;
  league: string;
  leagueId?: string;
  home: string;
  away: string;
  kickoff?: string;
  expectedStart?: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
  status: string; // "upcoming" | "betting" | "preloaded" | "live" | "finished"
  round?: number;
  minute?: number | null;
  scoreHome?: number | null;
  scoreAway?: number | null;
  stats?: Record<string, any>;
  predeterminedScore?: PredeterminedScore | null;
  prediction?: ScoreExactOdds | null; // v14: Score exact odds from Sporty API (Tier 1)
  // Phase 5.3.3: Timestamps for scientific timeline
  //
  // CRITICAL SEMANTIC DISTINCTION:
  //   - If the external provider (Sporty) supplies a native timestamp → SOURCE_PROVIDED
  //   - If only our scraper observation time (scrapedAt) is available → OBSERVATION_TIME
  //   - If no timestamp at all → UNKNOWN
  //
  // Currently Sporty provides NO native timestamps, so all values are OBSERVATION_TIME.
  // The priority chain is: native source timestamp > scrapedAt > undefined
  // Never substitute with Date.now() or t_prediction.
  oddsTimestamp?: string;    // Observation time of odds (or source timestamp if Sporty provides one)
  rankingTimestamp?: string; // Observation time of ranking (or source timestamp if Sporty provides one)
  formTimestamp?: string;    // Observation time of form (or source timestamp if Sporty provides one)
  h2hTimestamp?: string;     // Observation time of h2h (or source timestamp if Sporty provides one)
}

export interface MatchResult {
  home: string;
  away: string;
  scoreHome: number;
  scoreAway: number;
  league?: string;
  round?: number;
  matchday?: string | number;
}

export interface RankingEntry {
  position: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface ScrapedData {
  success: boolean;
  matches: ScrapedMatch[];
  results: MatchResult[];
  ranking: RankingEntry[];
  scrapedAt: string;
  error?: string;
  geoBlocked?: boolean;
  url?: string;
}
