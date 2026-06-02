// auto-scrape/index.ts — Supabase Edge Function
// Scrape Instant League data and store in scraped_data table
// NO imports — uses Deno.serve() + native fetch

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_BASE = Deno.env.get("SPORTY_API_BASE") || "https://hg-event-api-prod.sporty-tech.net/api/instantleagues";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Timing-safe comparison to prevent timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const result = new Uint8Array(aBytes.length);
  for (let i = 0; i < aBytes.length; i++) {
    result[i] = aBytes[i] ^ bBytes[i];
  }
  return result.every(byte => byte === 0);
}

const LEAGUES: Record<string, { id: string; name: string }> = {
  "8035": { id: "8035", name: "English League" },
  "8060": { id: "8060", name: "Coupe d'Afrique" },
  "8056": { id: "8056", name: "Champions League" },
  "8036": { id: "8036", name: "Italian League" },
  "8037": { id: "8037", name: "Spanish League" },
  "8042": { id: "8042", name: "French League" },
  "8043": { id: "8043", name: "German League" },
  "8044": { id: "8044", name: "Portuguese League" },
  "8065": { id: "8065", name: "Coupe du monde" },
};

const HEADERS: Record<string, string> = {
  "Origin": Deno.env.get("API_ORIGIN") || "https://bet261.mg",
  "Referer": Deno.env.get("API_REFERER") || "https://bet261.mg",
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "fr-FR,fr;q=0.9",
  "App-Version": Deno.env.get("API_APP_VERSION") || "33335",
};

// --- Native fetch helpers for Supabase REST API ---

async function supabaseUpsert(row: Record<string, any>): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scraped_data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`Upsert failed: ${res.status} ${err}`);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error(`Upsert error: ${e.message}`);
    return false;
  }
}

// --- API scraping helpers ---

async function fetchAPI(url: string, name: string): Promise<any> {
  try {
    console.log(`Fetching ${name}: ${url}`);
    const response = await fetch(url, { method: "GET", headers: HEADERS });
    console.log(`${name} status: ${response.status}`);
    if (!response.ok) {
      const text = await response.text();
      console.error(`${name} error: ${text}`);
      return null;
    }
    const data = await response.json();
    console.log(`${name} OK`);
    return data;
  } catch (error: any) {
    console.error(`Fetch error for ${name}: ${error.message}`);
    return null;
  }
}

function scrapeMatches(leagueId: string, leagueName: string, data: any): any[] {
  const matches: any[] = [];
  if (data?.rounds) {
    for (const roundData of data.rounds) {
      const roundNum = roundData.roundNumber || 0;
      for (const m of (roundData.matches || [])) {
        try {
          let hasActiveOdds = false;
          let oddHome = 0, oddDraw = 0, oddAway = 0;
          for (const betType of (m.eventBetTypes || [])) {
            if (betType.name === "1X2") {
              for (const item of (betType.eventBetTypeItems || [])) {
                if (item.active && item.bettingAllowed) hasActiveOdds = true;
                const shortName = (item.shortName || "").toUpperCase();
                const oddVal = item.odds || 0;
                if (shortName === "1") oddHome = oddVal;
                else if (shortName === "X") oddDraw = oddVal;
                else if (shortName === "2") oddAway = oddVal;
              }
              break;
            }
          }
          if (!hasActiveOdds && oddHome === 0) continue;
          matches.push({
            id: m.id,
            home: m.homeTeam?.name || "",
            away: m.awayTeam?.name || "",
            round: roundNum,
            league: leagueName,
            leagueId: leagueId,
            status: "upcoming",
            oddHome, oddDraw, oddAway,
            expectedStart: m.expectedStart || "",
          });
        } catch (e) {
          console.error("Error parsing match:", e);
        }
      }
    }
  }
  return matches;
}

function scrapeRanking(data: any): any[] {
  const ranking: any[] = [];
  if (data?.teams) {
    for (const r of data.teams) {
      ranking.push({
        position: r.position || 0, team: r.name || "",
        played: (r.won || 0) + (r.lost || 0) + (r.draw || 0),
        won: r.won || 0, drawn: r.draw || 0, lost: r.lost || 0,
        goalsFor: r.goalsFor || 0, goalsAgainst: r.goalsAgainst || 0,
        points: r.points || 0,
      });
    }
  }
  return ranking;
}

function scrapeResults(leagueId: string, leagueName: string, data: any): any[] {
  const results: any[] = [];
  if (data?.rounds) {
    for (const roundData of data.rounds) {
      const roundNum = roundData.roundNumber || 0;
      for (const m of (roundData.matches || [])) {
        try {
          const score = m.score || "0:0";
          const parts = score.split(":");
          results.push({
            id: m.id || 0,
            home: m.homeTeam?.name || "", away: m.awayTeam?.name || "",
            scoreHome: parts.length === 2 ? parseInt(parts[0]) : 0,
            scoreAway: parts.length === 2 ? parseInt(parts[1]) : 0,
            round: roundNum, league: leagueName,
          });
        } catch (e) {
          console.error("Error parsing result:", e);
        }
      }
    }
  }
  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // --- Authorization check ---
    // Auth stricte : uniquement via x-cron-key (pas de Bearer token)
    const cronKey = req.headers.get("x-cron-key");
    const expectedCronKey = Deno.env.get("CRON_SECRET");

    if (!expectedCronKey) {
      console.error("CRON_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Server not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!cronKey || !timingSafeEqual(cronKey, expectedCronKey)) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Read body for optional league_id
    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const specificLeagueId = body.league_id || "";

    // Determine which leagues to scrape
    const leaguesToScrape = specificLeagueId
      ? [LEAGUES[specificLeagueId] || { id: specificLeagueId, name: specificLeagueId }]
      : Object.values(LEAGUES);

    const allResults: any[] = [];

    for (const league of leaguesToScrape) {
      const leagueId = league.id;
      const leagueName = league.name;
      console.log(`\n=== Scraping ${leagueName} (${leagueId}) ===`);

      // Fetch all 3 data types in parallel
      const [matchesData, rankingData, resultsData] = await Promise.all([
        fetchAPI(`${API_BASE}/${leagueId}/matches`, `${leagueName}-matches`),
        fetchAPI(`${API_BASE}/${leagueId}/ranking`, `${leagueName}-ranking`),
        fetchAPI(`${API_BASE}/${leagueId}/results?skip=0&take=200`, `${leagueName}-results`),
      ]);

      const matches = scrapeMatches(leagueId, leagueName, matchesData);
      const ranking = scrapeRanking(rankingData);
      const results = scrapeResults(leagueId, leagueName, resultsData);

      console.log(`Matches: ${matches.length}, Ranking: ${ranking.length}, Results: ${results.length}`);

      if (matches.length === 0 && ranking.length === 0 && results.length === 0) {
        allResults.push({ league: leagueName, league_id: leagueId, status: "no_data" });
        continue;
      }

      const now = new Date().toISOString();

      // Upsert each data type to scraped_data
      let savedMatches = 0, savedRanking = 0, savedResults = 0;

      if (matches.length > 0) {
        const ok = await supabaseUpsert({
          data_type: "matches", league: leagueName, league_id: leagueId,
          payload: matches, scraped_at: now,
        });
        if (ok) savedMatches = matches.length;
      }

      if (ranking.length > 0) {
        const ok = await supabaseUpsert({
          data_type: "ranking", league: leagueName, league_id: leagueId,
          payload: ranking, scraped_at: now,
        });
        if (ok) savedRanking = ranking.length;
      }

      if (results.length > 0) {
        const ok = await supabaseUpsert({
          data_type: "results", league: leagueName, league_id: leagueId,
          payload: results, scraped_at: now,
        });
        if (ok) savedResults = results.length;
      }

      allResults.push({
        league: leagueName, league_id: leagueId, status: "ok",
        saved: { matches: savedMatches, ranking: savedRanking, results: savedResults },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        scraped_at: new Date().toISOString(),
        leagues: allResults,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("auto-scrape error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
