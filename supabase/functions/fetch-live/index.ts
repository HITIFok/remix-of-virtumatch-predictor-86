// fetch-live/index.ts — Supabase Edge Function v7
// Fetches VIRTUAL match data, ranking, results from Sporty Instant Leagues API
//
// v7: Fixed playout exploit — 3 bugs resolved:
//   1. Check preloaded (playout+betting) BEFORE finished status
//   2. Key playout by team name instead of match ID (IDs don't align)
//   3. Add retry for current round playout (400 → wait 1.5s → retry)

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const API_BASE = env(Deno.env.get("SPORTY_API_BASE")) || "https://hg-event-api-prod.sporty-tech.net/api/instantleagues";

/** Normalize team name for matching (trim, lowercase) */
function teamKey(name: string): string {
  return (name || "").trim().toLowerCase();
}

/** Create match key from home+away team names */
function matchKey(home: string, away: string): string {
  return `${teamKey(home)}|${teamKey(away)}`;
}

// ─── Dynamic headers with token injection ─────────────────────────────
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

  const bearer = env(Deno.env.get("SPORTY_BEARER"));
  if (bearer) {
    const token = bearer.replace(/^Bearer\s+/i, "");
    headers["authorization"] = `Bearer ${token}`;
    console.log(`[CONF] Using SPORTY_BEARER token (${token.length} chars)`);
  } else {
    console.log(`[CONF] No SPORTY_BEARER — using headers only`);
  }

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

/**
 * Fetch playout data for a specific round.
 * Returns Map keyed by "home|away" team name (normalized) for reliable matching.
 */
async function fetchPlayout(leagueId: string, round: number): Promise<Map<string, any>> {
  const playoutResults = new Map<string, any>();
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
          // Key by team names for reliable cross-endpoint matching
          const home = m.homeTeam?.name || m.homeName || "";
          const away = m.awayTeam?.name || m.awayName || "";
          const key = matchKey(home, away);
          if (key !== "|") { // Skip if both names empty
            playoutResults.set(key, {
              scoreHome: lastGoal.homeScore || 0,
              scoreAway: lastGoal.awayScore || 0,
              minute: lastGoal.minute || 0,
              totalGoals: goals.length,
              goals: goals,
              matchId: m.id,
            });
          }
        }
      }
    }
    console.log(`[Sporty] Playout round ${round}: ${playoutResults.size} match(es) with results`);
  } catch (e: any) {
    console.log(`[Sporty] Playout error: ${e.message}`);
  }
  return playoutResults;
}

/** Fetch all data for a league from Sporty API */
async function fetchFromSporty(leagueId: string): Promise<{
  matches: any[];
  ranking: any[];
  results: any[];
  liveCount: number;
  bettingCount: number;
  finishedCount: number;
  preloadedCount: number;
} | null> {
  const leagueName = LEAGUES[leagueId];
  if (!leagueName) {
    console.log(`[Sporty] Unknown league: ${leagueId}`);
    return null;
  }

  console.log(`[Sporty] Fetching ${leagueName} (${leagueId})`);

  // Step 1: Fetch matches, ranking, results in parallel
  const [matchesData, rankingData, resultsData] = await Promise.all([
    fetchAPI(`/${leagueId}/matches`),
    fetchAPI(`/${leagueId}/ranking`),
    fetchAPI(`/${leagueId}/results?skip=0&take=200`),
  ]);

  if (!matchesData) {
    console.log(`[Sporty] No matches data for ${leagueName}`);
    return null;
  }

  // Step 2: Identify the CURRENT betting round and ALL round numbers
  const roundsToCheck = new Set<number>();
  let currentBettingRound = 0;

  if (matchesData?.rounds) {
    for (const rd of matchesData.rounds) {
      const rn = rd.roundNumber || 0;
      if (rn > 0) roundsToCheck.add(rn);

      // Find the round with active betting
      for (const m of rd.matches || []) {
        const hasBetting = m.eventBetTypes?.some((bt: any) =>
          bt.eventBetTypeItems?.some((it: any) => it.active && it.bettingAllowed)
        );
        if (hasBetting && rn > currentBettingRound) {
          currentBettingRound = rn;
        }
      }
    }
  }
  const roundList = [...roundsToCheck].filter(r => r > 0).sort((a, b) => b - a).slice(0, 5);
  console.log(`[Sporty] Current betting round: ${currentBettingRound}, rounds to check: [${roundList.join(", ")}]`);

  // Step 3: Fetch playout for all rounds in parallel (first attempt)
  let playoutMatches = new Map<string, any>();
  let currentRoundPlayoutEmpty = false;

  if (roundList.length > 0) {
    const playoutResults = await Promise.allSettled(
      roundList.map(r => fetchPlayout(leagueId, r))
    );
    for (let i = 0; i < playoutResults.length; i++) {
      if (playoutResults[i].status === "fulfilled") {
        const resultMap = playoutResults[i].value;
        for (const [key, data] of resultMap) {
          playoutMatches.set(key, data);
        }
        // Check if current round had empty playout
        if (roundList[i] === currentBettingRound && resultMap.size === 0) {
          currentRoundPlayoutEmpty = true;
        }
      }
    }
  }

  // Step 4: RETRY current round playout after 1.5s delay (Bug #3 fix)
  // The playout for the current round might not be generated yet when we first check.
  // Waiting 1.5s gives the server time to generate the playout data.
  if (currentRoundPlayoutEmpty && currentBettingRound > 0) {
    console.log(`[Sporty] Current round ${currentBettingRound} playout was empty, retrying after 1500ms...`);
    await sleep(1500);
    const retryResult = await fetchPlayout(leagueId, currentBettingRound);
    for (const [key, data] of retryResult) {
      playoutMatches.set(key, data);
      console.log(`[Sporty] Retry got ${retryResult.size} match(es) for round ${currentBettingRound}`);
    }
  }

  console.log(`[Sporty] Total playout results available: ${playoutMatches.size}`);

  // Step 5: Build matches array with FIXED priority order (Bug #1 fix)
  const matches: any[] = [];
  let liveCount = 0, bettingCount = 0, finishedCount = 0, preloadedCount = 0;

  if (matchesData?.rounds) {
    for (const rd of matchesData.rounds) {
      const roundNum = rd.roundNumber || 0;
      for (const m of rd.matches || []) {
        // Extract 1X2 odds + betting status
        let oddHome = 0, oddDraw = 0, oddAway = 0;
        let hasActiveBetting = false;
        for (const bt of m.eventBetTypes || []) {
          if (bt.name === "1X2") {
            for (const it of bt.eventBetTypeItems || []) {
              const sn = (it.shortName || "").toUpperCase();
              const val = parseFloat(it.odds) || 0;
              if (sn === "1") oddHome = val;
              else if (sn === "X") oddDraw = val;
              else if (sn === "2") oddAway = val;
              if (it.active && it.bettingAllowed) hasActiveBetting = true;
            }
            break;
          }
        }

        // Build team key for playout matching (Bug #2 fix: match by team name)
        const tKey = matchKey(m.homeTeam?.name, m.awayTeam?.name);
        const playoutInfo = playoutMatches.has(tKey) ? playoutMatches.get(tKey) : null;

        // Determine match status — FIXED PRIORITY (Bug #1 fix):
        // 1. PRELOADED: playout data exists AND betting is open → THE EXPLOIT
        // 2. LIVE: playout data exists, no betting → currently playing
        // 3. FINISHED: appears in results (past completed rounds)
        // 4. BETTING: no playout, but betting is open
        // 5. UPCOMING: no data at all
        let status = "upcoming";
        let scoreHome: number | null = null;
        let scoreAway: number | null = null;
        let minute: number | null = null;
        let goals: any[] | null = null;
        let predeterminedScore: { home: number; away: number; minute: number } | null = null;

        // PRIORITY 1: If playout exists AND betting is open → PRELOADED (the exploit!)
        if (playoutInfo && hasActiveBetting) {
          status = "preloaded";
          predeterminedScore = {
            home: playoutInfo.scoreHome,
            away: playoutInfo.scoreAway,
            minute: playoutInfo.minute,
          };
          preloadedCount++;
          console.log(`[EXPLOIT] 🎯 ${m.homeTeam?.name} vs ${m.awayTeam?.name} → ${playoutInfo.scoreHome}-${playoutInfo.scoreAway} (betting still open, round ${roundNum})`);
        }
        // PRIORITY 2: If playout exists but no betting → LIVE
        else if (playoutInfo) {
          status = "live";
          scoreHome = playoutInfo.scoreHome;
          scoreAway = playoutInfo.scoreAway;
          minute = playoutInfo.minute;
          goals = playoutInfo.goals;
          liveCount++;
        }
        // PRIORITY 3: No playout, has betting → BETTING (waiting for playout)
        else if (hasActiveBetting || oddHome > 0) {
          status = "betting";
          bettingCount++;
        }
        // PRIORITY 4: No playout, no betting, check if it's from a past round
        // (matches from past rounds that don't have playout are finished)
        else if (roundNum < currentBettingRound) {
          status = "finished";
          finishedCount++;
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
          predeterminedScore,
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

  console.log(`[Sporty] ${leagueName}: matches=${matches.length}, ranking=${ranking.length}, results=${results.length}, preloaded=${preloadedCount}, live=${liveCount}, betting=${bettingCount}, finished=${finishedCount}`);

  return { matches, ranking, results, liveCount, bettingCount, finishedCount, preloadedCount };
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

    console.log(`=== fetch-live v7: ${leagueName} (${leagueId}) ===`);

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
        preloadedCount: data.preloadedCount,
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
