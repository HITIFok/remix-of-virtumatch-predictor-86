// Auto-scraper direct depuis le navigateur (fonctionne depuis Madagascar)
// Scrape l'API sporty-tech.net et envoie les données à Supabase

import { supabase } from "@/integrations/supabase/client";

const LEAGUE_ID = "8035";
const API_MATCHES = `https://hg-event-api-prod.sporty-tech.net/api/instantleagues/${LEAGUE_ID}/matches`;
const API_RANKING = `https://hg-event-api-prod.sporty-tech.net/api/instantleagues/${LEAGUE_ID}/ranking`;
const API_RESULTS = `https://hg-event-api-prod.sporty-tech.net/api/instantleagues/${LEAGUE_ID}/results?skip=0&take=100`;

const HEADERS = {
  "Origin": "https://bet261.mg",
  "Referer": "https://bet261.mg/",
};

interface ScrapedMatch {
  id: number;
  home: string;
  away: string;
  round: number;
  league: string;
  status: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
  expectedStart: string;
  hasActiveOdds: boolean;
}

interface ScrapedRanking {
  position: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

interface ScrapedResult {
  home: string;
  away: string;
  scoreHome: number;
  scoreAway: number;
  round: number;
  league: string;
}

let scrapeIntervalId: ReturnType<typeof setInterval> | null = null;

async function fetchAPI(url: string): Promise<any> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: HEADERS,
    });

    if (!response.ok) {
      console.error(`API error: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Fetch error:', error);
    return null;
  }
}

async function scrapeMatches(): Promise<ScrapedMatch[]> {
  const matches: ScrapedMatch[] = [];
  const data = await fetchAPI(API_MATCHES);

  if (data && data.rounds) {
    for (const roundData of data.rounds) {
      const roundNum = roundData.roundNumber || 0;

      for (const m of (roundData.matches || [])) {
        try {
          let hasActiveOdds = false;
          let oddHome = 0, oddDraw = 0, oddAway = 0;

          const eventBetTypes = m.eventBetTypes || [];
          for (const betType of eventBetTypes) {
            if (betType.name === "1X2") {
              const items = betType.eventBetTypeItems || [];
              for (const item of items) {
                if (item.active && item.bettingAllowed) {
                  hasActiveOdds = true;
                }

                const shortName = (item.shortName || "").toUpperCase();
                const oddVal = item.odds || 0;

                if (shortName === "1") oddHome = oddVal;
                else if (shortName === "X") oddDraw = oddVal;
                else if (shortName === "2") oddAway = oddVal;
              }
              break;
            }
          }

          // Garder TOUS les matchs
          const status = hasActiveOdds ? "betting" : "upcoming";

          matches.push({
            id: m.id,
            home: m.homeTeam?.name || "",
            away: m.awayTeam?.name || "",
            round: roundNum,
            league: "Instant League",
            status,
            oddHome,
            oddDraw,
            oddAway,
            expectedStart: m.expectedStart || "",
            hasActiveOdds,
          });
        } catch (e) {
          console.error("Error parsing match:", e);
        }
      }
    }
  }

  return matches;
}

async function scrapeRanking(): Promise<ScrapedRanking[]> {
  const ranking: ScrapedRanking[] = [];
  const data = await fetchAPI(API_RANKING);

  if (data && data.teams) {
    for (const r of data.teams) {
      ranking.push({
        position: r.position || 0,
        team: r.name || "",
        played: (r.won || 0) + (r.lost || 0) + (r.draw || 0),
        won: r.won || 0,
        drawn: r.draw || 0,
        lost: r.lost || 0,
        goalsFor: r.goalsFor || 0,
        goalsAgainst: r.goalsAgainst || 0,
        points: r.points || 0,
      });
    }
  }

  return ranking;
}

async function scrapeResults(): Promise<ScrapedResult[]> {
  const results: ScrapedResult[] = [];
  const data = await fetchAPI(API_RESULTS);

  if (data && data.rounds) {
    for (const roundData of data.rounds) {
      const roundNum = roundData.roundNumber || 0;
      for (const m of (roundData.matches || [])) {
        try {
          const score = m.score || "0:0";
          const parts = score.split(":");
          const scoreHome = parts.length === 2 ? parseInt(parts[0]) : 0;
          const scoreAway = parts.length === 2 ? parseInt(parts[1]) : 0;

          results.push({
            home: m.homeTeam?.name || "",
            away: m.awayTeam?.name || "",
            scoreHome,
            scoreAway,
            round: roundNum,
            league: "Instant League",
          });
        } catch (e) {
          console.error("Error parsing result:", e);
        }
      }
    }
  }

  return results;
}

export async function runScrape(): Promise<{
  success: boolean;
  matches: number;
  ranking: number;
  results: number;
  error?: string;
}> {
  try {
    console.log("🔄 Auto-scraping...");

    const [matches, ranking, results] = await Promise.all([
      scrapeMatches(),
      scrapeRanking(),
      scrapeResults(),
    ]);

    console.log(`📊 Scraped: ${matches.length} matches, ${ranking.length} teams, ${results.length} results`);

    if (matches.length === 0 && ranking.length === 0 && results.length === 0) {
      return { success: false, matches: 0, ranking: 0, results: 0, error: "Aucune donnée - API bloquée?" };
    }

    // Sauvegarder dans Supabase
    const now = new Date().toISOString();

    if (matches.length > 0) {
      await supabase.from('scraped_data').upsert({
        data_type: 'matches',
        league: 'Instant League',
        payload: matches,
        scraped_at: now,
      }, { onConflict: 'data_type,league' });
    }

    if (ranking.length > 0) {
      await supabase.from('scraped_data').upsert({
        data_type: 'ranking',
        league: 'Instant League',
        payload: ranking,
        scraped_at: now,
      }, { onConflict: 'data_type,league' });
    }

    if (results.length > 0) {
      await supabase.from('scraped_data').upsert({
        data_type: 'results',
        league: 'Instant League',
        payload: results,
        scraped_at: now,
      }, { onConflict: 'data_type,league' });
    }

    console.log("✅ Data saved to Supabase");

    return {
      success: true,
      matches: matches.length,
      ranking: ranking.length,
      results: results.length,
    };
  } catch (error) {
    console.error("Scrape error:", error);
    return {
      success: false,
      matches: 0,
      ranking: 0,
      results: 0,
      error: error instanceof Error ? error.message : "Erreur inconnue",
    };
  }
}

// Démarrer le scraping automatique
export function startAutoScrape(intervalMs: number = 30000): void {
  if (scrapeIntervalId) {
    console.log("⚠️ Auto-scrape already running");
    return;
  }

  console.log(`🚀 Starting auto-scrape every ${intervalMs / 1000}s`);

  // Scrap immédiat
  runScrape();

  // Puis à intervalles réguliers
  scrapeIntervalId = setInterval(runScrape, intervalMs);
}

// Arrêter le scraping automatique
export function stopAutoScrape(): void {
  if (scrapeIntervalId) {
    clearInterval(scrapeIntervalId);
    scrapeIntervalId = null;
    console.log("🛑 Auto-scrape stopped");
  }
}

// Vérifier si le scraping est en cours
export function isAutoScrapeRunning(): boolean {
  return scrapeIntervalId !== null;
}
