// Client-side scraper for bet261.mg Instant League
// Works ONLY when user is in Madagascar (geo-restriction bypass)

import { supabase } from "@/integrations/supabase/client";

const API_MATCHES = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/matches";
const API_RANKING = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/ranking";
const API_RESULTS = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/results?skip=0&take=100";

const HEADERS = {
  "Origin": "https://bet261.mg",
  "Referer": "https://bet261.mg/",
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
};

export interface ScraperResult {
  success: boolean;
  matches: number;
  results: number;
  ranking: number;
  error?: string;
}

async function fetchWithTimeout(url: string, timeout = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: HEADERS,
      signal: controller.signal,
      mode: "cors",
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export async function scrapeInstantLeague(): Promise<ScraperResult> {
  try {
    // Fetch all data in parallel
    const [matchesRes, rankingRes, resultsRes] = await Promise.all([
      fetchWithTimeout(API_MATCHES),
      fetchWithTimeout(API_RANKING),
      fetchWithTimeout(API_RESULTS),
    ]);

    // Check for geo-blocking
    if (matchesRes.status === 403 || rankingRes.status === 403 || resultsRes.status === 403) {
      return {
        success: false,
        matches: 0,
        results: 0,
        ranking: 0,
        error: "Accès bloqué - Vous devez être à Madagascar",
      };
    }

    if (!matchesRes.ok || !rankingRes.ok || !resultsRes.ok) {
      return {
        success: false,
        matches: 0,
        results: 0,
        ranking: 0,
        error: `Erreur HTTP: ${matchesRes.status}`,
      };
    }

    // Parse JSON
    const matchesData = await matchesRes.json();
    const rankingData = await rankingRes.json();
    const resultsData = await resultsRes.json();

    // Parse matches
    const matches: any[] = [];
    if (matchesData?.rounds) {
      for (const round of matchesData.rounds) {
        if (round.matches) {
          for (const m of round.matches) {
            const odds = m.eventBetTypes?.[0]?.outcomes || [];
            const oddHome = odds.find((o: any) => o.type === "Home")?.odds || 0;
            const oddDraw = odds.find((o: any) => o.type === "Draw")?.odds || 0;
            const oddAway = odds.find((o: any) => o.type === "Away")?.odds || 0;
            
            matches.push({
              league: "Instant League",
              home: m.homeTeam?.name || "",
              away: m.awayTeam?.name || "",
              kickoff: m.startTime || "",
              oddHome,
              oddDraw,
              oddAway,
              status: "upcoming",
            });
          }
        }
      }
    }

    // Parse ranking
    const ranking: any[] = [];
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
    const results: any[] = [];
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

    // Clear old data and insert new
    const scrapedAt = new Date().toISOString();

    // Delete old data
    await supabase.from("scraped_data").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Insert new data
    const inserts = [];
    
    if (matches.length > 0) {
      inserts.push(supabase.from("scraped_data").insert({
        data_type: "matches",
        league: "Instant League",
        payload: matches,
        scraped_at: scrapedAt,
      }));
    }

    if (ranking.length > 0) {
      inserts.push(supabase.from("scraped_data").insert({
        data_type: "ranking",
        league: "Instant League",
        payload: ranking,
        scraped_at: scrapedAt,
      }));
    }

    if (results.length > 0) {
      inserts.push(supabase.from("scraped_data").insert({
        data_type: "results",
        league: "Instant League",
        payload: results,
        scraped_at: scrapedAt,
      }));
    }

    await Promise.all(inserts);

    return {
      success: true,
      matches: matches.length,
      results: results.length,
      ranking: ranking.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    
    // Detect geo-blocking or network error
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("CORS")) {
      return {
        success: false,
        matches: 0,
        results: 0,
        ranking: 0,
        error: "Impossible de contacter le serveur - Vérifiez votre connexion (4G Madagascar requise)",
      };
    }
    
    return {
      success: false,
      matches: 0,
      results: 0,
      ranking: 0,
      error: msg,
    };
  }
}
