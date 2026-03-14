// Client-side scraper for bet261.mg Instant League
// Uses Vercel API proxy to bypass CORS restrictions

import { supabase } from "@/integrations/supabase/client";

export interface ScraperResult {
  success: boolean;
  matches: number;
  results: number;
  ranking: number;
  error?: string;
  geoBlocked?: boolean;
}

export async function scrapeInstantLeague(): Promise<ScraperResult> {
  // In development mode, skip API proxy (Vite doesn't run serverless functions)
  // Go directly to scraping (works for users in Madagascar)
  if (!import.meta.env.PROD) {
    console.log('Development mode: using direct scraping');
    return await scrapeDirect();
  }

  try {
    // Production: Try Vercel API proxy first
    const apiUrl = '/api/scrape';
    
    let response: Response;
    
    try {
      response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });
    } catch (fetchError) {
      // If API proxy fails, try direct scraping (for users in Madagascar)
      console.log('API proxy failed, trying direct scraping...');
      return await scrapeDirect();
    }

    if (!response.ok) {
      // If API returns error, try direct scraping
      console.log('API returned error, trying direct scraping...');
      return await scrapeDirect();
    }

    const data = await response.json();

    if (!data.success) {
      // If API reports geo-blocking, try direct scraping
      if (data.geoBlocked) {
        console.log('API geo-blocked, trying direct scraping...');
        return await scrapeDirect();
      }
      
      return {
        success: false,
        matches: 0,
        results: 0,
        ranking: 0,
        error: data.error || "Échec du scraping",
      };
    }

    // Save to Supabase
    await saveToSupabase(data.matches, data.ranking, data.results);

    return {
      success: true,
      matches: data.matches?.length || 0,
      results: data.results?.length || 0,
      ranking: data.ranking?.length || 0,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    // Try direct scraping as fallback
    console.log('Error, trying direct scraping:', msg);
    return await scrapeDirect();
  }
}

// Direct scraping (fallback for users in Madagascar)
async function scrapeDirect(): Promise<ScraperResult> {
  const API_MATCHES = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/matches";
  const API_RANKING = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/ranking";
  const API_RESULTS = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035/results?skip=0&take=100";

  const HEADERS = {
    "Origin": "https://bet261.mg",
    "Referer": "https://bet261.mg/",
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36",
    "Accept": "application/json, text/plain, */*",
  };

  try {
    // Fetch all data in parallel
    const [matchesRes, rankingRes, resultsRes] = await Promise.all([
      fetch(API_MATCHES, { method: "GET", headers: HEADERS, mode: "cors" }),
      fetch(API_RANKING, { method: "GET", headers: HEADERS, mode: "cors" }),
      fetch(API_RESULTS, { method: "GET", headers: HEADERS, mode: "cors" }),
    ]);

    // Check for geo-blocking
    if (matchesRes.status === 403 || rankingRes.status === 403 || resultsRes.status === 403) {
      return {
        success: false,
        matches: 0,
        results: 0,
        ranking: 0,
        error: "Accès bloqué - Vous devez être à Madagascar",
        geoBlocked: true,
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

    // Save to Supabase
    await saveToSupabase(matches, ranking, results);

    return {
      success: true,
      matches: matches.length,
      results: results.length,
      ranking: ranking.length,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    
    // Detect CORS or network error
    if (msg.includes("Failed to fetch") || msg.includes("CORS") || msg.includes("NetworkError")) {
      return {
        success: false,
        matches: 0,
        results: 0,
        ranking: 0,
        error: "Impossible de contacter le serveur. Utilisez le scraper Python depuis Madagascar.",
        geoBlocked: true,
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

// Save scraped data to Supabase
async function saveToSupabase(matches: any[], ranking: any[], results: any[]): Promise<void> {
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
}
