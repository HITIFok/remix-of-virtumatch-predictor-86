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
