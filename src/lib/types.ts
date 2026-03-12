export interface ScrapedMatch {
  league: string;
  home: string;
  away: string;
  kickoff: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
  status: "upcoming" | "live" | "finished";
  minute?: number | null;
  scoreHome?: number | null;
  scoreAway?: number | null;
  stats?: Record<string, any>;
}

export interface MatchResult {
  home: string;
  away: string;
  scoreHome: number;
  scoreAway: number;
  league?: string;
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
