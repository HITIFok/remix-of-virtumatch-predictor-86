// fetch-live/index.ts — Supabase Edge Function
// Fetches live match data, ranking, results
// NO imports — uses Deno.serve() + native fetch

/** Helper: read env var and strip accidental surrounding quotes */
function env(key: string, fallback = ""): string {
  const raw = Deno.env.get(key) || fallback;
  return raw.replace(/^["']|["']$/g, "");
}

const ALLOWED_ORIGIN = env("ALLOWED_ORIGIN", "https://virtual-match-hitifproject.vercel.app");
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
// Si ALLOWED_ORIGIN est défini, le restreindre (sécurité)
if (ALLOWED_ORIGIN) {
  corsHeaders["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  corsHeaders["Vary"] = "Origin";
  console.log(`[fetch-live] CORS restreint à: ${ALLOWED_ORIGIN}`);
} else {
  console.log(`[fetch-live] CORS ouvert (pas de ALLOWED_ORIGIN configuré)`);
}

const API_BASE = env("SPORTY_API_BASE", "https://hg-event-api-prod.sporty-tech.net/api/instantleagues");

console.log(`[DIAG] API_BASE=${API_BASE}`);

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

const API_ORIGIN_VAL = env("API_ORIGIN", "https://www.sportybet.com");
const API_REFERER_VAL = env("API_REFERER", "https://www.sportybet.com/");
const API_APP_VERSION_VAL = env("API_APP_VERSION", "13.0.0");
console.log(`[DIAG] Origin=${API_ORIGIN_VAL}, Referer=${API_REFERER_VAL}, App-Version=${API_APP_VERSION_VAL}`);

const HEADERS: Record<string, string> = {
  "Origin": API_ORIGIN_VAL,
  "Referer": API_REFERER_VAL,
  "User-Agent": "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.113 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "App-Version": API_APP_VERSION_VAL,
  "X-Requested-With": "com.sportybet.android",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

const HEADERS_FALLBACK: Record<string, string> = {
  "Origin": "https://www.sportybet.com",
  "Referer": "https://www.sportybet.com/ng/",
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-NG,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "App-Version": "12.8.0",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site",
};

let diagLogged = false;

async function fetchAPI(path: string, timeoutMs = 8000): Promise<any> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res = await fetch(`${API_BASE}${path}`, {
      headers: HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });
    // If 403, try with fallback headers
    if (res.status === 403) {
      console.log(`API 403 for ${path}, trying fallback headers...`);
      res = await fetch(`${API_BASE}${path}`, {
        headers: HEADERS_FALLBACK,
        signal: controller.signal,
        redirect: "follow",
      });
    }
    clearTimeout(timeoutId);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (!diagLogged) {
        console.log(`[DIAG] ${res.status} body: ${body.substring(0, 300)}`);
        diagLogged = true;
      }
      console.log(`API ${res.status} for ${path}`);
      return null;
    }
    return await res.json();
  } catch (e: any) {
    console.log(`fetchAPI error for ${path}: ${e.message}`);
    return null;
  }
}

/**
 * Fetch live playout data for a specific round.
 * Uses parentEventCategoryId (leagueId) for live data fetching.
 */
async function fetchLiveData(leagueId: string, round: number): Promise<Map<number, any>> {
  const liveMatches = new Map();
  try {
    const data = await fetchAPI(
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
    console.log(`LIVE round ${round}: ${liveMatches.size} matches`);
  } catch (e: any) {
    console.log(`Playout error: ${e.message}`);
  }
  return liveMatches;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const leagueId = url.searchParams.get("leagueId") || "8035";
    const leagueName = LEAGUES[leagueId] || "Unknown League";
    console.log(`=== fetch-live: ${leagueName} (${leagueId}) ===`);

    // Fetch matches, ranking, results in parallel
    const [matchesData, rankingData, resultsData] = await Promise.all([
      fetchAPI(`/${leagueId}/matches`),
      fetchAPI(`/${leagueId}/ranking`),
      fetchAPI(`/${leagueId}/results?skip=0&take=200`),
    ]);

    if (!matchesData) {
      return new Response(
        JSON.stringify({ success: false, error: "API unavailable", matches: [], results: [], ranking: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

    // Determine which rounds to check for live data (max 5 to save CPU)
    const roundsToCheck = new Set<number>();
    if (matchesData?.rounds) {
      for (const rd of matchesData.rounds) {
        roundsToCheck.add(rd.roundNumber || 0);
      }
    }
    const roundList = [...roundsToCheck].filter(r => r > 0).slice(0, 5);

    // Fetch live data for active rounds (parallel, max 5)
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
    console.log(`Total LIVE matches: ${liveMatches.size}`);

    // Build matches array
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
            round: roundNum, league: leagueName, status, kickoff: m.expectedStart || "",
            oddHome, oddDraw, oddAway, scoreHome, scoreAway, minute, goals,
          });
        }
      }
    }

    console.log(`live=${liveCount}, betting=${bettingCount}, finished=${finishedCount}`);

    // Parse ranking
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

    // Parse results
    const results: any[] = [];
    if (resultsData?.rounds) {
      for (const rd of resultsData.rounds) {
        for (const m of rd.matches || []) {
          const score = String(m.score || "0:0").split(":");
          results.push({
            home: m.homeTeam?.name || "", away: m.awayTeam?.name || "",
            scoreHome: parseInt(score[0]) || 0, scoreAway: parseInt(score[1]) || 0,
            league: leagueName, matchday: String(rd.roundNumber || ""),
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true, league: leagueName, leagueId,
        matches, ranking, results, liveCount, bettingCount, finishedCount,
        scrapedAt: new Date().toISOString(),
        counts: { matches: matches.length, ranking: ranking.length, results: results.length },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("fetch-live error:", error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message, matches: [], results: [], ranking: [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
