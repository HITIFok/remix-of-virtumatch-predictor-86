import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_MATCHES = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/matches";
const API_RANKING = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/ranking";
const API_RESULTS = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/results?skip=0&take=100";

const HEADERS = {
  "Origin": "https://bet261.mg",
  "Referer": "https://bet261.mg/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
};

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface MatchData {
  league: string;
  home: string;
  away: string;
  kickoff: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
  status: string;
}

interface RankingData {
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

interface ResultData {
  league: string;
  home: string;
  away: string;
  scoreHome: number;
  scoreAway: number;
  matchday: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).set(corsHeaders).send('');
  }

  // Set CORS headers
  res.set(corsHeaders);

  try {
    // Fetch all data in parallel
    const [matchesRes, rankingRes, resultsRes] = await Promise.all([
      fetch(API_MATCHES, { headers: HEADERS }),
      fetch(API_RANKING, { headers: HEADERS }),
      fetch(API_RESULTS, { headers: HEADERS }),
    ]);

    // Check for geo-blocking
    if (matchesRes.status === 403 || rankingRes.status === 403 || resultsRes.status === 403) {
      return res.status(200).json({
        success: false,
        error: "Accès bloqué - Vercel n'est pas autorisé à accéder à cette API",
        geoBlocked: true,
        matches: [],
        ranking: [],
        results: [],
      });
    }

    if (!matchesRes.ok || !rankingRes.ok || !resultsRes.ok) {
      return res.status(200).json({
        success: false,
        error: `Erreur HTTP: matches=${matchesRes.status}, ranking=${rankingRes.status}, results=${resultsRes.status}`,
        matches: [],
        ranking: [],
        results: [],
      });
    }

    // Parse JSON responses
    const matchesData = await matchesRes.json();
    const rankingData = await rankingRes.json();
    const resultsData = await resultsRes.json();

    // Parse matches
    const matches: MatchData[] = [];
    if (matchesData?.rounds) {
      for (const round of matchesData.rounds) {
        if (round.matches) {
          for (const m of round.matches) {
            const odds = m.eventBetTypes?.[0]?.outcomes || [];
            matches.push({
              league: "Instant League",
              home: m.homeTeam?.name || "",
              away: m.awayTeam?.name || "",
              kickoff: m.startTime || "",
              oddHome: odds.find((o: any) => o.type === "Home")?.odds || 0,
              oddDraw: odds.find((o: any) => o.type === "Draw")?.odds || 0,
              oddAway: odds.find((o: any) => o.type === "Away")?.odds || 0,
              status: "upcoming",
            });
          }
        }
      }
    }

    // Parse ranking
    const ranking: RankingData[] = [];
    if (rankingData?.teams) {
      for (const t of rankingData.teams) {
        ranking.push({
          position: t.position || 0,
          team: t.name || "",
          played: (t.won || 0) + (t.lost || 0) + (t.draw || 0),
          won: t.won || 0,
          drawn: t.draw || 0,
          lost: t.lost || 0,
          goalsFor: t.goalsFor || 0,
          goalsAgainst: t.goalsAgainst || 0,
          goalDifference: (t.goalsFor || 0) - (t.goalsAgainst || 0),
          points: t.points || 0,
        });
      }
    }

    // Parse results
    const results: ResultData[] = [];
    if (resultsData?.rounds) {
      for (const round of resultsData.rounds) {
        if (round.matches) {
          for (const m of round.matches) {
            const scoreParts = (m.score || "0:0").split(":");
            results.push({
              league: "Instant League",
              home: m.homeTeam?.name || "",
              away: m.awayTeam?.name || "",
              scoreHome: parseInt(scoreParts[0]) || 0,
              scoreAway: parseInt(scoreParts[1]) || 0,
              matchday: round.name || "",
            });
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      matches,
      ranking,
      results,
      scrapedAt: new Date().toISOString(),
      counts: {
        matches: matches.length,
        ranking: ranking.length,
        results: results.length,
      },
    });

  } catch (error) {
    console.error('Scrape error:', error);
    return res.status(200).json({
      success: false,
      error: error instanceof Error ? error.message : "Erreur inconnue",
      matches: [],
      ranking: [],
      results: [],
    });
  }
}
