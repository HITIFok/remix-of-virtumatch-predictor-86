// auto-scrape/index.ts — Supabase Edge Function v3
// Scrape league data and store in scraped_data table
// PRIMARY: API-Football (api-sports.io) — free tier: 100 req/day
// FALLBACK: Sporty API (sporty-tech.net) — may be geo-blocked
// NO imports — uses Deno.serve() + native fetch

// ─── CORS ───────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Supabase ────────────────────────────────────────────────────────
const DATABASE_URL = Deno.env.get("DATABASE_URL") || "";
const DATABASE_SERVICE_KEY = Deno.env.get("DATABASE_SERVICE_KEY") || "";

// ─── League mapping ──────────────────────────────────────────────────
const LEAGUES: Record<string, { id: string; name: string; apiFootballId: number }> = {
  "8035": { id: "8035", name: "English League", apiFootballId: 39 },
  "8060": { id: "8060", name: "Coupe d'Afrique", apiFootballId: 13 },
  "8056": { id: "8056", name: "Champions League", apiFootballId: 2 },
  "8036": { id: "8036", name: "Italian League", apiFootballId: 135 },
  "8037": { id: "8037", name: "Spanish League", apiFootballId: 140 },
  "8042": { id: "8042", name: "French League", apiFootballId: 61 },
  "8043": { id: "8043", name: "German League", apiFootballId: 78 },
  "8044": { id: "8044", name: "Portuguese League", apiFootballId: 94 },
  "8065": { id: "8065", name: "Coupe du monde", apiFootballId: 1 },
};

// ─── API Keys ────────────────────────────────────────────────────────
const FOOTBALL_API_KEY = Deno.env.get("FOOTBALL_API_KEY") || "";
const FOOTBALL_API_HOST = "https://v3.football.api-sports.io";

const SPORTY_API_BASE = Deno.env.get("SPORTY_API_BASE") || "";

// ─── Helper: env var cleanup ──────────────────────────────────────────
function env(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/^["']|["']$/g, "").trim();
}

// ─── Sporty headers ─────────────────────────────────────────────────
const SPORTY_HEADERS: Record<string, string> = {
  "Origin": env(Deno.env.get("API_ORIGIN")) || "https://www.sportybet.com",
  "Referer": env(Deno.env.get("API_REFERER")) || "https://www.sportybet.com/",
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "fr-FR,fr;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "App-Version": env(Deno.env.get("API_APP_VERSION")) || "13.0.0",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site",
  "X-Requested-With": "XMLHttpRequest",
};

// ─── Supabase upsert ─────────────────────────────────────────────────
async function supabaseUpsert(row: Record<string, any>): Promise<boolean> {
  try {
    const res = await fetch(`${DATABASE_URL}/rest/v1/scraped_data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": DATABASE_SERVICE_KEY,
        "Authorization": `Bearer ${DATABASE_SERVICE_KEY}`,
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

// ═══════════════════════════════════════════════════════════════════════
// API-Football fetching (primary source)
// ═══════════════════════════════════════════════════════════════════════

async function apiFootballGet(endpoint: string, timeoutMs = 12000): Promise<any> {
  if (!FOOTBALL_API_KEY) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${FOOTBALL_API_HOST}${endpoint}`, {
      headers: {
        "x-apisports-key": FOOTBALL_API_KEY,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.log(`  [API-Football] ${res.status} for ${endpoint}`);
      return null;
    }
    const json = await res.json();
    if (json.errors && Object.keys(json.errors).length > 0) {
      console.log(`  [API-Football] errors:`, JSON.stringify(json.errors));
      return null;
    }
    return json.response;
  } catch (e: any) {
    console.log(`  [API-Football] error: ${e.message}`);
    return null;
  }
}

/** Scrape one league from API-Football and save to Supabase */
async function scrapeFromApiFootball(leagueId: string, leagueName: string, apiFootballId: number): Promise<{
  matches: any[];
  ranking: any[];
  results: any[];
  source: string;
}> {
  const season = new Date().getFullYear();
  const useSeason = new Date().getMonth() < 7 ? season - 1 : season;

  console.log(`  [API-Football] League=${leagueName}, AF_ID=${apiFootballId}, Season=${useSeason}`);

  // Fetch in parallel: next fixtures, standings, last results
  const [fixtures, standings, lastFixtures] = await Promise.all([
    apiFootballGet(`/fixtures?league=${apiFootballId}&season=${useSeason}&next=50`),
    apiFootballGet(`/standings?league=${apiFootballId}&season=${useSeason}`),
    apiFootballGet(`/fixtures?league=${apiFootballId}&season=${useSeason}&last=50`),
  ]);

  // ─── Build matches ──────────────────────────────────────────────
  const matches: any[] = [];
  if (fixtures) {
    for (const f of fixtures) {
      const teams = f.teams || {};
      const fixture = f.fixture || {};
      const league_data = f.league || {};
      const fixtureStatus = (fixture.status?.short || "").toLowerCase();

      // Only include upcoming and live matches (not finished — those are in results)
      if (fixtureStatus === "ft" || fixtureStatus === "aet" || fixtureStatus === "pen" || fixtureStatus === "awd") continue;

      let oddHome = 0, oddDraw = 0, oddAway = 0;
      const oddsValues = f.odds || [];
      for (const odd of oddsValues) {
        if (odd.name === "Match Winner" || odd.name === "1X2" || odd.name === "Full Time Result") {
          const values = odd.values || [];
          for (const v of values) {
            const valName = (v.value || "").toUpperCase();
            const oddVal = parseFloat(v.odd) || 0;
            if (valName === "HOME" || valName === "1") oddHome = oddVal;
            else if (valName === "DRAW" || valName === "X") oddDraw = oddVal;
            else if (valName === "AWAY" || valName === "2") oddAway = oddVal;
          }
          break;
        }
      }

      if (oddHome === 0 && fixtureStatus === "ns") continue; // skip matches with no odds

      const roundNum = parseInt(String(league_data.round || "0").replace(/\D/g, "")) || 0;
      const status = fixtureStatus === "ns" || fixtureStatus === "pst" ? "upcoming" : "live";

      matches.push({
        id: fixture.id || 0,
        home: teams.home?.name || "",
        away: teams.away?.name || "",
        round: roundNum,
        league: leagueName,
        leagueId: leagueId,
        status,
        oddHome, oddDraw, oddAway,
        expectedStart: fixture.date || "",
      });
    }
  }

  // ─── Build ranking ───────────────────────────────────────────────
  const ranking: any[] = [];
  if (standings && standings.length > 0 && Array.isArray(standings[0])) {
    for (const entry of standings[0]) {
      const allData = entry.all || {};
      const teamData = entry.team || {};
      ranking.push({
        position: entry.rank || 0,
        team: teamData.name || "",
        played: allData.games || 0,
        won: allData.win || 0,
        drawn: allData.draw || 0,
        lost: allData.lose || 0,
        goalsFor: allData.goals?.for || 0,
        goalsAgainst: allData.goals?.against || 0,
        points: entry.points || 0,
      });
    }
  }

  // ─── Build results ───────────────────────────────────────────────
  const results: any[] = [];
  if (lastFixtures) {
    for (const f of lastFixtures) {
      const teams = f.teams || {};
      const goals = f.goals || {};
      const league_data = f.league || {};
      results.push({
        home: teams.home?.name || "",
        away: teams.away?.name || "",
        scoreHome: goals.home || 0,
        scoreAway: goals.away || 0,
        round: parseInt(String(league_data.round || "0").replace(/\D/g, "")) || 0,
        league: leagueName,
      });
    }
  }

  console.log(`  [API-Football] ${leagueName}: matches=${matches.length}, ranking=${ranking.length}, results=${results.length}`);
  return { matches, ranking, results, source: "api-football" };
}

// ═══════════════════════════════════════════════════════════════════════
// Sporty API fetching (legacy fallback)
// ═══════════════════════════════════════════════════════════════════════

async function sportyFetchAPI(url: string, name: string): Promise<any> {
  if (!SPORTY_API_BASE) return null;
  try {
    console.log(`  Fetching ${name}: ${url}`);
    const response = await fetch(url, { method: "GET", headers: SPORTY_HEADERS });
    console.log(`  ${name} status: ${response.status}`);
    if (!response.ok) {
      const text = await response.text();
      console.error(`  ${name} error: ${text}`);
      return null;
    }
    const data = await response.json();
    console.log(`  ${name} OK`);
    return data;
  } catch (error: any) {
    console.error(`  Fetch error for ${name}: ${error.message}`);
    return null;
  }
}

function scrapeMatchesSporty(leagueId: string, leagueName: string, data: any): any[] {
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
            id: m.id, home: m.homeTeam?.name || "", away: m.awayTeam?.name || "",
            round: roundNum, league: leagueName, leagueId, status: "upcoming",
            oddHome, oddDraw, oddAway, expectedStart: m.expectedStart || "",
          });
        } catch (e) {
          console.error("  Error parsing match:", e);
        }
      }
    }
  }
  return matches;
}

function scrapeRankingSporty(data: any): any[] {
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

function scrapeResultsSporty(leagueId: string, leagueName: string, data: any): any[] {
  const results: any[] = [];
  if (data?.rounds) {
    for (const roundData of data.rounds) {
      const roundNum = roundData.roundNumber || 0;
      for (const m of (roundData.matches || [])) {
        try {
          const score = m.score || "0:0";
          const parts = score.split(":");
          results.push({
            home: m.homeTeam?.name || "", away: m.awayTeam?.name || "",
            scoreHome: parts.length === 2 ? parseInt(parts[0]) : 0,
            scoreAway: parts.length === 2 ? parseInt(parts[1]) : 0,
            round: roundNum, league: leagueName,
          });
        } catch (e) {
          console.error("  Error parsing result:", e);
        }
      }
    }
  }
  return results;
}

/** Scrape one league from Sporty API and save to Supabase */
async function scrapeFromSporty(leagueId: string, leagueName: string): Promise<{
  matches: any[];
  ranking: any[];
  results: any[];
  source: string;
}> {
  console.log(`  [Sporty] League=${leagueName} (${leagueId})`);

  const [matchesData, rankingData, resultsData] = await Promise.all([
    sportyFetchAPI(`${SPORTY_API_BASE}/${leagueId}/matches`, `${leagueName}-matches`),
    sportyFetchAPI(`${SPORTY_API_BASE}/${leagueId}/ranking`, `${leagueName}-ranking`),
    sportyFetchAPI(`${SPORTY_API_BASE}/${leagueId}/results?skip=0&take=100`, `${leagueName}-results`),
  ]);

  const matches = scrapeMatchesSporty(leagueId, leagueName, matchesData);
  const ranking = scrapeRankingSporty(rankingData);
  const results = scrapeResultsSporty(leagueId, leagueName, resultsData);

  console.log(`  [Sporty] ${leagueName}: matches=${matches.length}, ranking=${ranking.length}, results=${results.length}`);
  return { matches, ranking, results, source: "sporty" };
}

// ═══════════════════════════════════════════════════════════════════════
// Main handler
// ═══════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // --- Authorization check ---
    const cronKey = req.headers.get("x-cron-key");
    const expectedCronKey = Deno.env.get("CRON_SECRET");

    if (!expectedCronKey) {
      console.error("CRON_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Server not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!cronKey || cronKey !== expectedCronKey) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Read body for optional league_id
    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const specificLeagueId = body.league_id || "";

    const leaguesToScrape = specificLeagueId
      ? [LEAGUES[specificLeagueId] || { id: specificLeagueId, name: specificLeagueId, apiFootballId: 0 }]
      : Object.values(LEAGUES);

    console.log(`\n=== auto-scrape v3 ===`);
    console.log(`[CONF] FOOTBALL_API_KEY=${FOOTBALL_API_KEY ? "SET" : "NOT SET"}`);
    console.log(`[CONF] SPORTY_API_BASE=${SPORTY_API_BASE ? "SET" : "NOT SET"}`);
    console.log(`[CONF] Leagues to scrape: ${leaguesToScrape.length}`);

    const allResults: any[] = [];
    let totalApiCalls = 0;

    for (const league of leaguesToScrape) {
      const leagueId = league.id;
      const leagueName = league.name;
      const apiFootballId = league.apiFootballId || 0;

      console.log(`\n--- Scraping ${leagueName} (${leagueId}) ---`);

      let scraped = null;
      let source = "none";

      // Try API-Football first
      if (FOOTBALL_API_KEY && apiFootballId > 0) {
        scraped = await scrapeFromApiFootball(leagueId, leagueName, apiFootballId);
        totalApiCalls += 3; // fixtures + standings + last
        if (scraped && (scraped.matches.length > 0 || scraped.ranking.length > 0 || scraped.results.length > 0)) {
          source = "api-football";
        }
      }

      // Fallback to Sporty
      if (!source && SPORTY_API_BASE) {
        scraped = await scrapeFromSporty(leagueId, leagueName);
        totalApiCalls += 3;
        if (scraped && (scraped.matches.length > 0 || scraped.ranking.length > 0 || scraped.results.length > 0)) {
          source = "sporty";
        }
      }

      if (!scraped || (scraped.matches.length === 0 && scraped.ranking.length === 0 && scraped.results.length === 0)) {
        allResults.push({ league: leagueName, league_id: leagueId, status: "no_data", source: "none" });
        continue;
      }

      const now = new Date().toISOString();
      let savedMatches = 0, savedRanking = 0, savedResults = 0;

      if (scraped.matches.length > 0) {
        const ok = await supabaseUpsert({
          data_type: "matches", league: leagueName, league_id: leagueId,
          payload: scraped.matches, scraped_at: now,
        });
        if (ok) savedMatches = scraped.matches.length;
      }

      if (scraped.ranking.length > 0) {
        const ok = await supabaseUpsert({
          data_type: "ranking", league: leagueName, league_id: leagueId,
          payload: scraped.ranking, scraped_at: now,
        });
        if (ok) savedRanking = scraped.ranking.length;
      }

      if (scraped.results.length > 0) {
        const ok = await supabaseUpsert({
          data_type: "results", league: leagueName, league_id: leagueId,
          payload: scraped.results, scraped_at: now,
        });
        if (ok) savedResults = scraped.results.length;
      }

      allResults.push({
        league: leagueName, league_id: leagueId, status: "ok", source,
        saved: { matches: savedMatches, ranking: savedRanking, results: savedResults },
      });
    }

    console.log(`\n=== auto-scrape done. Total API calls: ${totalApiCalls} ===`);

    return new Response(
      JSON.stringify({
        success: true,
        scraped_at: new Date().toISOString(),
        totalApiCalls,
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
