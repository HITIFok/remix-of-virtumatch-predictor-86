// fetch-live/index.ts — Supabase Edge Function v5
// Fetches VIRTUAL match data, ranking, results from Sporty Instant Leagues API
// Headers work without token (tested 2026-06-03). SPORTY_BEARER available as fallback.
// NO imports — uses Deno.serve() + native fetch

// ─── CORS ───────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// ─── League mapping ──────────────────────────────────────────────────
const LEAGUES: Record<string, string> = {
  "8035": "English League",
  "8060": "Coupe d'Afrique",
  "8056": "Champions League",
  "8036": "Italian League",
  "8037": "Spanish League",
  "8042": "French League",
  "8043": "German League",
  "8044": "Portuguese League",
  "8065": "Coupe du monde",
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
    // Strip "Bearer " prefix if user included it
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

// ═══════════════════════════════════════════════════════════════════════
// Sporty API fetching
// ═══════════════════════════════════════════════════════════════════════

async function fetchAPI(path: string, timeoutMs = 10000): Promise<any> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const headers = buildHeaders();
    const res = await fetch(`${API_BASE}${path}`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.log(`[Sporty] ${res.status} for ${path} — ${text.substring(0, 200)}`);
      return null;
    }
    return await res.json();
  } catch (e: any) {
    console.log(`[Sporty] fetch error for ${path}: ${e.message}`);
    return null;
  }
}

/** Fetch live playout data for a specific round */
async function fetchLiveData(leagueId: string, round: number): Promise<Map<number, any>> {
  const liveMatches = new Map();
  try {
    const data = await fetchAPI(
      `/round/${round}/playout?parentEventCategoryId=${leagueId}`,
      6000
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

/** Fetch all data for a league from Sporty API */
async function fetchFromSporty(leagueId: string): Promise<{
  matches: any[];
  ranking: any[];
  results: any[];
  liveCount: number;
  bettingCount: number;
  finishedCount: number;
} | null> {
  const leagueName = LEAGUES[leagueId];
  if (!leagueName) {
    console.log(`[Sporty] Unknown league: ${leagueId}`);
    return null;
  }

  console.log(`[Sporty] Fetching ${leagueName} (${leagueId})`);

  // Fetch matches, ranking, results in parallel
  const [matchesData, rankingData, resultsData] = await Promise.all([
    fetchAPI(`/${leagueId}/matches`),
    fetchAPI(`/${leagueId}/ranking`),
    fetchAPI(`/${leagueId}/results?skip=0&take=200`),
  ]);

  if (!matchesData) {
    console.log(`[Sporty] No matches data for ${leagueName}`);
    return null;
  }

  // Identify finished matches from results
  const finishedMatchIds = new Set<number>();
  if (resultsData?.rounds) {
    for (const rd of resultsData.rounds) {
      for (const m of rd.matches || []) {
        if (m.id) finishedMatchIds.add(m.id);
      }
    }
  }

  // Determine which rounds to check for live data (max 5)
  const roundsToCheck = new Set<number>();
  if (matchesData?.rounds) {
    for (const rd of matchesData.rounds) {
      roundsToCheck.add(rd.roundNumber || 0);
    }
  }
  const roundList = [...roundsToCheck].filter(r => r > 0).slice(0, 5);

  // Fetch live data for active rounds in parallel
  let liveMatches = new Map<number, any>();
  if (roundList.length > 0) {
    const liveResults = await Promise.allSettled(
      roundList.map(r => fetchLiveData(leagueId, r))
    );
    for (const result of liveResults) {
      if (result.status === "fulfilled") {
        for (const [id, data] of result.value) {
          liveMatches.set(id, data);
        }
      }
    }
  }
  console.log(`[Sporty] Total LIVE: ${liveMatches.size}`);

  // Build matches array
  const matches: any[] = [];
  let liveCount = 0, bettingCount = 0, finishedCount = 0;

  if (matchesData?.rounds) {
    for (const rd of matchesData.rounds) {
      const roundNum = rd.roundNumber || 0;
      for (const m of rd.matches || []) {
        // Extract 1X2 odds
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

        // Determine match status
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
          id: m.id,
          home: m.homeTeam?.name || "",
          away: m.awayTeam?.name || "",
          round: roundNum,
          league: leagueName,
          status,
          kickoff: m.expectedStart || "",
          oddHome, oddDraw, oddAway,
          scoreHome, scoreAway, minute, goals,
        });
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
        played: (t.won || 0) + (t.draw || 0) + (t.lost || 0),
        won: t.won || 0,
        drawn: t.draw || 0,
        lost: t.lost || 0,
        goalsFor: t.goalsFor || 0,
        goalsAgainst: t.goalsAgainst || 0,
        points: t.points || 0,
      });
    }
  }

  // Parse results
  const results: any[] = [];
  if (resultsData?.rounds) {
    for (const rd of resultsData.rounds) {
      for (const m of rd.matches || []) {
        const score = String(m.score || "0:0").split(":");
        results.push({
          home: m.homeTeam?.name || "",
          away: m.awayTeam?.name || "",
          scoreHome: parseInt(score[0]) || 0,
          scoreAway: parseInt(score[1]) || 0,
          league: leagueName,
          matchday: String(rd.roundNumber || ""),
        });
      }
    }
  }

  console.log(`[Sporty] ${leagueName}: matches=${matches.length}, ranking=${ranking.length}, results=${results.length}, live=${liveCount}, betting=${bettingCount}, finished=${finishedCount}`);

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
    const leagueName = LEAGUES[leagueId] || "Unknown League";

    console.log(`=== fetch-live v5: ${leagueName} (${leagueId}) ===`);
    console.log(`[CONF] API_BASE=${API_BASE.substring(0, 50)}...`);
    console.log(`[CONF] SPORTY_BEARER=${env(Deno.env.get("SPORTY_BEARER")) ? "SET" : "NOT SET"}`);
    console.log(`[CONF] SPORTY_COOKIE=${env(Deno.env.get("SPORTY_COOKIE")) ? "SET" : "NOT SET"}`);

    const data = await fetchFromSporty(leagueId);

    if (!data) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Sporty API unavailable. Try setting SPORTY_BEARER as fallback.",
          source: "sporty",
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
        source: "sporty",
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
