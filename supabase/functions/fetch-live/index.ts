// fetch-live/index.ts — Supabase Edge Function v3
// Fetches live match data, ranking, results
// PRIMARY: API-Football (api-sports.io) — free tier: 100 req/day
// FALLBACK: Sporty API (sporty-tech.net) — may be geo-blocked
// NO imports — uses Deno.serve() + native fetch

// ─── CORS ───────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// ─── League mapping ──────────────────────────────────────────────────
// Sporty ID → API-Football ID + Name
const LEAGUES: Record<string, { name: string; apiFootballId: number }> = {
  "8035": { name: "English League", apiFootballId: 39 },
  "8060": { name: "Coupe d'Afrique", apiFootballId: 13 },
  "8056": { name: "Champions League", apiFootballId: 2 },
  "8036": { name: "Italian League", apiFootballId: 135 },
  "8037": { name: "Spanish League", apiFootballId: 140 },
  "8042": { name: "French League", apiFootballId: 61 },
  "8043": { name: "German League", apiFootballId: 78 },
  "8044": { name: "Portuguese League", apiFootballId: 94 },
  "8065": { name: "Coupe du monde", apiFootballId: 1 },
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

// ─── Sporty headers (legacy) ─────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════
// API-Football fetching (primary source)
// ═══════════════════════════════════════════════════════════════════════

async function apiFootballGet(endpoint: string, timeoutMs = 10000): Promise<any> {
  if (!FOOTBALL_API_KEY) {
    console.log("[API-Football] No FOOTBALL_API_KEY configured");
    return null;
  }
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
      console.log(`[API-Football] ${res.status} for ${endpoint}`);
      return null;
    }
    const json = await res.json();
    if (json.errors && Object.keys(json.errors).length > 0) {
      console.log(`[API-Football] errors:`, JSON.stringify(json.errors));
      return null;
    }
    return json.response;
  } catch (e: any) {
    console.log(`[API-Football] error for ${endpoint}: ${e.message}`);
    return null;
  }
}

/** Fetch data from API-Football for a league — returns same shape as Sporty response */
async function fetchFromApiFootball(leagueId: string): Promise<{
  matches: any[];
  ranking: any[];
  results: any[];
  liveCount: number;
  bettingCount: number;
  finishedCount: number;
} | null> {
  const league = LEAGUES[leagueId];
  if (!league) {
    console.log(`[API-Football] Unknown league: ${leagueId}`);
    return null;
  }

  const afId = league.apiFootballId;
  const season = new Date().getFullYear();
  // If we're before August, use previous season
  const useSeason = new Date().getMonth() < 7 ? season - 1 : season;

  console.log(`[API-Football] Fetching ${league.name} (AF:${afId}) season=${useSeason}`);

  // Fetch fixtures, standings, and last results in parallel (3 API calls)
  const [fixtures, standings, lastFixtures] = await Promise.all([
    // Upcoming + live fixtures
    apiFootballGet(`/fixtures?league=${afId}&season=${useSeason}&next=50`),
    // League standings
    apiFootballGet(`/standings?league=${afId}&season=${useSeason}`),
    // Last 50 finished fixtures (results)
    apiFootballGet(`/fixtures?league=${afId}&season=${useSeason}&last=50`),
  ]);

  if (!fixtures) {
    console.log(`[API-Football] No fixtures data for ${league.name}`);
    return null;
  }

  // ─── Build matches ──────────────────────────────────────────────
  const matches: any[] = [];
  let liveCount = 0, bettingCount = 0, finishedCount = 0;

  for (const f of fixtures) {
    const teams = f.teams || {};
    const goals = f.goals || {};
    const fixture = f.fixture || {};
    const league_data = f.league || {};

    // Determine status
    let status = "upcoming";
    let scoreHome: number | null = null;
    let scoreAway: number | null = null;
    let minute: number | null = null;
    let goalsArr: any[] | null = null;

    const fixtureStatus = (fixture.status?.short || "").toLowerCase();

    if (fixtureStatus === "ft" || fixtureStatus === "aet" || fixtureStatus === "pen" || fixtureStatus === "awd") {
      status = "finished";
      scoreHome = goals.home ?? null;
      scoreAway = goals.away ?? null;
      finishedCount++;
    } else if (fixtureStatus.startsWith("1h") || fixtureStatus.startsWith("2h") || fixtureStatus === "ht" || fixtureStatus === "et" || fixtureStatus === "bt" || fixtureStatus === "p" || fixtureStatus === "susp" || fixtureStatus === "int" || fixtureStatus === "live") {
      status = "live";
      scoreHome = goals.home ?? null;
      scoreAway = goals.away ?? null;
      minute = fixture.status?.elapsed ?? null;
      liveCount++;
    } else if (fixtureStatus === "ns" || fixtureStatus === "pst" || fixtureStatus === "canc") {
      // Not started / postponed — check if odds exist
      if (f.odds) {
        status = "betting";
        bettingCount++;
      }
    } else {
      // Time TBD or other
      status = "upcoming";
    }

    // Extract odds from odds object
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

    // Build a composite matchday from league round info
    const roundNum = parseInt(String(league_data.round || "0").replace(/\D/g, "")) || 0;

    matches.push({
      id: fixture.id || 0,
      home: teams.home?.name || "",
      away: teams.away?.name || "",
      round: roundNum,
      league: league.name,
      status,
      kickoff: fixture.date || "",
      oddHome, oddDraw, oddAway,
      scoreHome, scoreAway, minute,
      goals: goalsArr,
    });
  }

  // ─── Build ranking ───────────────────────────────────────────────
  const ranking: any[] = [];
  if (standings && standings.length > 0) {
    const leagueStandings = standings[0];
    const table = leagueStandings || [];
    for (const entry of table) {
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
        league: league.name,
        matchday: String(league_data.round || ""),
      });
    }
  }

  console.log(`[API-Football] ${league.name}: matches=${matches.length}, ranking=${ranking.length}, results=${results.length}, live=${liveCount}, betting=${bettingCount}, finished=${finishedCount}`);

  return { matches, ranking, results, liveCount, bettingCount, finishedCount };
}

// ═══════════════════════════════════════════════════════════════════════
// Sporty API fetching (legacy fallback)
// ═══════════════════════════════════════════════════════════════════════

async function sportyFetchAPI(path: string, timeoutMs = 8000): Promise<any> {
  if (!SPORTY_API_BASE) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${SPORTY_API_BASE}${path}`, {
      headers: SPORTY_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.log(`[Sporty] API ${res.status} for ${path}`);
      return null;
    }
    return await res.json();
  } catch (e: any) {
    console.log(`[Sporty] fetchAPI error for ${path}: ${e.message}`);
    return null;
  }
}

async function fetchLiveDataSporty(leagueId: string, round: number): Promise<Map<number, any>> {
  const liveMatches = new Map();
  try {
    const data = await sportyFetchAPI(
      `/round/${round}/playout?parentEventCategoryId=${leagueId}`,
      5000
    );
    if (data?.matches && Array.isArray(data.matches)) {
      for (const m of data.matches) {
        const goals = m.goals || [];
        if (goals.length > 0) {
          const lastGoal = goals[goals.length - 1];
          liveMatches.set(m.id, {
            scoreHome: lastGoal.homeScore || 0,
            scoreAway: lastGoal.awayScore || 0,
            minute: lastGoal.minute || 0,
            goals: goals,
          });
        }
      }
    }
    console.log(`[Sporty] LIVE round ${round}: ${liveMatches.size} matches`);
  } catch (e: any) {
    console.log(`[Sporty] Playout error: ${e.message}`);
  }
  return liveMatches;
}

/** Fetch data from Sporty API (legacy) — returns same shape */
async function fetchFromSporty(leagueId: string): Promise<{
  matches: any[];
  ranking: any[];
  results: any[];
  liveCount: number;
  bettingCount: number;
  finishedCount: number;
} | null> {
  const league = LEAGUES[leagueId];
  if (!league) return null;

  console.log(`[Sporty] Fetching ${league.name} (${leagueId})`);

  const [matchesData, rankingData, resultsData] = await Promise.all([
    sportyFetchAPI(`/${leagueId}/matches`),
    sportyFetchAPI(`/${leagueId}/ranking`),
    sportyFetchAPI(`/${leagueId}/results?skip=0&take=200`),
  ]);

  if (!matchesData) {
    console.log(`[Sporty] No matches data for ${league.name}`);
    return null;
  }

  // Identify finished matches
  const finishedMatchIds = new Set<number>();
  if (resultsData?.rounds) {
    for (const rd of resultsData.rounds) {
      for (const m of rd.matches || []) {
        if (m.id) finishedMatchIds.add(m.id);
      }
    }
  }

  // Check live data for active rounds
  const roundsToCheck = new Set<number>();
  if (matchesData?.rounds) {
    for (const rd of matchesData.rounds) {
      roundsToCheck.add(rd.roundNumber || 0);
    }
  }
  const roundList = [...roundsToCheck].filter(r => r > 0).slice(0, 5);

  let liveMatches = new Map<number, any>();
  if (roundList.length > 0) {
    const liveResults = await Promise.allSettled(
      roundList.map(r => fetchLiveDataSporty(leagueId, r))
    );
    for (const result of liveResults) {
      if (result.status === "fulfilled") {
        for (const [id, data] of result.value) {
          liveMatches.set(id, data);
        }
      }
    }
  }

  const matches: any[] = [];
  let liveCount = 0, bettingCount = 0, finishedCount = 0;

  if (matchesData?.rounds) {
    for (const rd of matchesData.rounds) {
      const roundNum = rd.roundNumber || 0;
      for (const m of rd.matches || []) {
        let oddHome = 0, oddDraw = 0, oddAway = 0;
        for (const bt of m.eventBetTypes || []) {
          if (bt.name === "1X2") {
            for (const it of bt.eventBetTypeItems || []) {
              const sn = (it.shortName || "").toUpperCase();
              const val = parseFloat(it.odds) || 0;
              if (sn === "1") oddHome = val;
              else if (sn === "X") oddDraw = val;
              else if (sn === "2") oddAway = val;
            }
            break;
          }
        }

        let status = "upcoming";
        let scoreHome: number | null = null;
        let scoreAway: number | null = null;
        let minute: number | null = null;
        let goals: any[] | null = null;

        if (finishedMatchIds.has(m.id)) {
          status = "finished";
          finishedCount++;
        } else if (liveMatches.has(m.id)) {
          const liveInfo = liveMatches.get(m.id)!;
          status = "live";
          scoreHome = liveInfo.scoreHome;
          scoreAway = liveInfo.scoreAway;
          minute = liveInfo.minute;
          goals = liveInfo.goals;
          liveCount++;
        } else {
          const hasActiveBetting = m.eventBetTypes?.some((bt: any) =>
            bt.eventBetTypeItems?.some((it: any) => it.active && it.bettingAllowed)
          );
          if (hasActiveBetting || oddHome > 0) {
            status = "betting";
            bettingCount++;
          }
        }

        matches.push({
          id: m.id, home: m.homeTeam?.name || "", away: m.awayTeam?.name || "",
          round: roundNum, league: league.name, status, kickoff: m.expectedStart || "",
          oddHome, oddDraw, oddAway, scoreHome, scoreAway, minute, goals,
        });
      }
    }
  }

  const ranking: any[] = [];
  if (rankingData?.teams) {
    for (const t of rankingData.teams) {
      ranking.push({
        position: t.position || 0, team: t.name || "",
        played: (t.won || 0) + (t.draw || 0) + (t.lost || 0),
        won: t.won || 0, drawn: t.draw || 0, lost: t.lost || 0,
        goalsFor: t.goalsFor || 0, goalsAgainst: t.goalsAgainst || 0,
        points: t.points || 0,
      });
    }
  }

  const results: any[] = [];
  if (resultsData?.rounds) {
    for (const rd of resultsData.rounds) {
      for (const m of rd.matches || []) {
        const score = String(m.score || "0:0").split(":");
        results.push({
          home: m.homeTeam?.name || "", away: m.awayTeam?.name || "",
          scoreHome: parseInt(score[0]) || 0, scoreAway: parseInt(score[1]) || 0,
          league: league.name, matchday: String(rd.roundNumber || ""),
        });
      }
    }
  }

  console.log(`[Sporty] ${league.name}: matches=${matches.length}, ranking=${ranking.length}, results=${results.length}, live=${liveCount}, betting=${bettingCount}, finished=${finishedCount}`);

  return { matches, ranking, results, liveCount, bettingCount, finishedCount };
}

// ═══════════════════════════════════════════════════════════════════════
// Main handler
// ═══════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const leagueId = url.searchParams.get("leagueId") || "8035";
    const leagueInfo = LEAGUES[leagueId];
    const leagueName = leagueInfo?.name || "Unknown League";

    console.log(`=== fetch-live v3: ${leagueName} (${leagueId}) ===`);
    console.log(`[CONF] FOOTBALL_API_KEY=${FOOTBALL_API_KEY ? "SET" : "NOT SET"}`);
    console.log(`[CONF] SPORTY_API_BASE=${SPORTY_API_BASE ? "SET" : "NOT SET"}`);

    let data: {
      matches: any[];
      ranking: any[];
      results: any[];
      liveCount: number;
      bettingCount: number;
      finishedCount: number;
    } | null = null;
    let source = "none";

    // Strategy: try API-Football first, then Sporty fallback
    if (FOOTBALL_API_KEY) {
      data = await fetchFromApiFootball(leagueId);
      if (data) {
        source = "api-football";
      } else {
        console.log("[MAIN] API-Football failed, trying Sporty fallback...");
      }
    }

    if (!data && SPORTY_API_BASE) {
      data = await fetchFromSporty(leagueId);
      if (data) {
        source = "sporty";
      }
    }

    if (!data) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "All data sources unavailable. Configure FOOTBALL_API_KEY in Supabase secrets.",
          source: "none",
          matches: [],
          results: [],
          ranking: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        source,
        league: leagueName,
        leagueId,
        matches: data.matches,
        ranking: data.ranking,
        results: data.results,
        liveCount: data.liveCount,
        bettingCount: data.bettingCount,
        finishedCount: data.finishedCount,
        scrapedAt: new Date().toISOString(),
        counts: {
          matches: data.matches.length,
          ranking: data.ranking.length,
          results: data.results.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[fetch-live] error:", error.message);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        source: "error",
        matches: [],
        results: [],
        ranking: [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
