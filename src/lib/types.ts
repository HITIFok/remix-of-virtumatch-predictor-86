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

export interface ScrapedData {
  success: boolean;
  matches: ScrapedMatch[];
  scrapedAt: string;
  error?: string;
}
