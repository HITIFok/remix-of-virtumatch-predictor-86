// auto-scrape/index.ts — Supabase Edge Function v5
// Scrape VIRTUAL league data from Sporty Instant Leagues API and store in scraped_data table
// Headers work without token (tested 2026-06-03). SPORTY_BEARER available as fallback.
// NO imports — uses Deno.serve() + native fetch

// ─── CORS ───────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key, x-device-id, accept, cache-control",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ─── Supabase ────────────────────────────────────────────────────────
const DATABASE_URL = Deno.env.get("DATABASE_URL") || "";
const DATABASE_SERVICE_KEY = Deno.env.get("DATABASE_SERVICE_KEY") || "";

// ─── League mapping ──────────────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────
function env(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/^["']|["']$/g, "").trim();
}

const API_BASE = env(Deno.env.get("SPORTY_API_BASE")) || "https://hg-event-api-prod.sporty-tech.net/api/instantleagues";

// ─── Dynamic headers with token injection ─────────────────────────────
// The user captures their working browser token from bet261.mg DevTools:
//   1. Open bet261.mg → F12 → Network tab
//   2. Find any request to hg-event-api-prod.sporty-tech.net
//   3. Copy the "Authorization: Bearer xxx" value → set as SPORTY_BEARER secret
//   4. Optionally copy the "Cookie: ..." value → set as SPORTY_COOKIE secret
//   5. Deploy: supabase secrets set SPORTY_BEARER="your_token_here"
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "fr",
    "app-version": "33470",
    "referer": "https://bet261.mg/",
    "sec-ch-ua": '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
  };

  // Inject bearer token from Supabase secret (captured from browser)
  const bearer = env(Deno.env.get("SPORTY_BEARER"));
  if (bearer) {
    const token = bearer.replace(/^Bearer\s+/i, "");
    headers["authorization"] = `Bearer ${token}`;
    console.log(`[CONF] Using SPORTY_BEARER token (${token.length} chars)`);
  } else {
    console.log(`[CONF] No SPORTY_BEARER — using headers only (works as of 2026-06-03)`);
  }

  // Inject cookie from Supabase secret (if user captured it)
  const cookie = env(Deno.env.get("SPORTY_COOKIE"));
  if (cookie) {
    headers["cookie"] = cookie;
    console.log(`[CONF] Using SPORTY_COOKIE (${cookie.length} chars)`);
  }

  return headers;
}

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
// Sporty API fetching
// ═══════════════════════════════════════════════════════════════════════

async function sportyFetchAPI(url: string, name: string): Promise<any> {
  try {
    console.log(`  Fetching ${name}: ${url}`);
    const headers = buildHeaders();
    const response = await fetch(url, { method: "GET", headers });
    console.log(`  ${name} status: ${response.status}`);
    if (!response.ok) {
      const text = await response.text();
      console.error(`  ${name} error: ${text.substring(0, 200)}`);
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
          console.error("  Error parsing match:", e);
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
            home: m.homeTeam?.name || "",
            away: m.awayTeam?.name || "",
            scoreHome: parts.length === 2 ? parseInt(parts[0]) : 0,
            scoreAway: parts.length === 2 ? parseInt(parts[1]) : 0,
            round: roundNum,
            league: leagueName,
          });
        } catch (e) {
          console.error("  Error parsing result:", e);
        }
      }
    }
  }
  return results;
}

/** Scrape one league from Sporty API */
async function scrapeFromSporty(leagueId: string, leagueName: string): Promise<{
  matches: any[];
  ranking: any[];
  results: any[];
  source: string;
}> {
  console.log(`  [Sporty] League=${leagueName} (${leagueId})`);

  const [matchesData, rankingData, resultsData] = await Promise.all([
    sportyFetchAPI(`${API_BASE}/${leagueId}/matches`, `${leagueName}-matches`),
    sportyFetchAPI(`${API_BASE}/${leagueId}/ranking`, `${leagueName}-ranking`),
    sportyFetchAPI(`${API_BASE}/${leagueId}/results?skip=0&take=100`, `${leagueName}-results`),
  ]);

  const matches = scrapeMatches(leagueId, leagueName, matchesData);
  const ranking = scrapeRanking(rankingData);
  const results = scrapeResults(leagueId, leagueName, resultsData);

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
      ? [LEAGUES[specificLeagueId] || { id: specificLeagueId, name: specificLeagueId }]
      : Object.values(LEAGUES);

    console.log(`\n=== auto-scrape v5 ===`);
    console.log(`[CONF] API_BASE=${API_BASE.substring(0, 50)}...`);
    console.log(`[CONF] SPORTY_BEARER=${env(Deno.env.get("SPORTY_BEARER")) ? "SET" : "NOT SET"}`);
    console.log(`[CONF] SPORTY_COOKIE=${env(Deno.env.get("SPORTY_COOKIE")) ? "SET" : "NOT SET"}`);
    console.log(`[CONF] Leagues to scrape: ${leaguesToScrape.length}`);

    const allResults: any[] = [];
    let totalApiCalls = 0;

    for (const league of leaguesToScrape) {
      const leagueId = league.id;
      const leagueName = league.name;

      console.log(`\n--- Scraping ${leagueName} (${leagueId}) ---`);

      const scraped = await scrapeFromSporty(leagueId, leagueName);
      totalApiCalls += 3;

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
        league: leagueName, league_id: leagueId, status: "ok", source: "sporty",
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
