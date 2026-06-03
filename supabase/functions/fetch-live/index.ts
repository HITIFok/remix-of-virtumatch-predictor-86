// fetch-live/index.ts — Supabase Edge Function v8
// Fetches VIRTUAL match data, ranking, results from Sporty Instant Leagues API
//
// v8: CRITICAL FIX — Playout exploit WORKS, was broken by team-name matching!
//   Discovery: /round/{N}/playout returns results for CURRENT betting round!
//   Bug: Playout response has NO team names (homeTeam/awayTeam = null)
//         only match IDs. v7 matched by team name → all matches ignored → preloaded=0
//   Fix: Match playout by match ID (m.id) instead of team name
//   v7 comment "IDs don't align" was WRONG — IDs DO align perfectly!
//
// Playout data structure (per match):
//   { id: 69044871, entryPointId: 0, goals: [...], expectedStart: "..." }
//   NO homeTeam, NO awayTeam, NO homeName, NO awayName fields at all!
//
// Match status priority:
//   1. PRELOADED: playout data exists AND betting still open → THE EXPLOIT
//   2. LIVE: playout data exists, no betting → match currently playing
//   3. BETTING: no playout, but odds active → waiting for simulation
//   4. FINISHED: past round, no playout, no betting
//   5. UPCOMING: no data at all

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
 * v8: Returns Map keyed by match ID (number) — playout has NO team names!
 * Playout response per match: { id: number, entryPointId: 0, goals: [...], expectedStart: "..." }
 */
async function fetchPlayout(leagueId: string, round: number): Promise<Map<number, any>> {
  const playoutResults = new Map<number, any>();
  try {
    const data = await fetchAPI(
      `/round/${round}/playout?parentEventCategoryId=${leagueId}`,
      6000
    );
    if (data?.matches && Array.isArray(data.matches)) {
      for (const m of data.matches) {
        const matchId = m.id;
        const goals = m.goals || [];
        if (matchId && goals.length > 0) {
          const lastGoal = goals[goals.length - 1];
          playoutResults.set(matchId, {
            scoreHome: lastGoal.homeScore || 0,
            scoreAway: lastGoal.awayScore || 0,
            minute: lastGoal.minute || 0,
            totalGoals: goals.length,
            goals: goals,
            matchId: matchId,
          });
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
  // Only check the current betting round (playout is only useful for this round)
  // and maybe the previous round for live matches still finishing
  const roundsToFetch: number[] = [];
  if (currentBettingRound > 0) {
    roundsToFetch.push(currentBettingRound);
    if (currentBettingRound > 1) {
      roundsToFetch.push(currentBettingRound - 1); // previous round might still be live
    }
  }
  console.log(`[Sporty] Current betting round: ${currentBettingRound}, fetching playout for rounds: [${roundsToFetch.join(", ")}]`);

  // Step 3: Fetch playout for relevant rounds in parallel
  let playoutMatches = new Map<number, any>();

  if (roundsToFetch.length > 0) {
    const playoutResults = await Promise.allSettled(
      roundsToFetch.map(r => fetchPlayout(leagueId, r))
    );
    for (const result of playoutResults) {
      if (result.status === "fulfilled") {
        for (const [matchId, data] of result.value) {
          playoutMatches.set(matchId, data);
        }
      }
    }
  }

  // Step 4: If current round playout was empty, retry after 1.5s
  // (server might still be generating playout data between rounds)
  const currentRoundHasData = [...playoutMatches.values()].some(d => {
    // We can't easily tell which round each playout belongs to from ID alone,
    // but if we got NO results at all and current round exists, retry
    return true;
  });
  if (playoutMatches.size === 0 && currentBettingRound > 0) {
    console.log(`[Sporty] No playout data found, retrying current round ${currentBettingRound} after 1500ms...`);
    await sleep(1500);
    const retryResult = await fetchPlayout(leagueId, currentBettingRound);
    for (const [matchId, data] of retryResult) {
      playoutMatches.set(matchId, data);
    }
    if (retryResult.size > 0) {
      console.log(`[Sporty] Retry SUCCESS: got ${retryResult.size} match(es) for round ${currentBettingRound}`);
    }
  }

  console.log(`[Sporty] Total playout results available: ${playoutMatches.size}`);

  // Step 5: Build matches array with correct status priority
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

        // v8: Match playout by match ID (the ONLY reliable key)
        const matchId = m.id;
        const playoutInfo = matchId ? playoutMatches.get(matchId) : null;

        // Determine match status:
        // 1. PRELOADED: playout data exists AND betting is open → THE EXPLOIT
        // 2. LIVE: playout data exists, no betting → currently playing
        // 3. BETTING: no playout, but odds active → waiting
        // 4. FINISHED: past round, no playout, no betting
        // 5. UPCOMING: no data at all
        let status = "upcoming";
        let scoreHome: number | null = null;
        let scoreAway: number | null = null;
        let minute: number | null = null;
        let goals: any[] | null = null;
        let predeterminedScore: { home: number; away: number; minute: number } | null = null;

        // PRIORITY 1: Playout exists AND betting is open → PRELOADED (the exploit!)
        if (playoutInfo && hasActiveBetting) {
          status = "preloaded";
          predeterminedScore = {
            home: playoutInfo.scoreHome,
            away: playoutInfo.scoreAway,
            minute: playoutInfo.minute,
          };
          preloadedCount++;
          console.log(`[EXPLOIT] ${m.homeTeam?.name} vs ${m.awayTeam?.name} → ${playoutInfo.scoreHome}-${playoutInfo.scoreAway} (betting still open! round ${roundNum})`);
        }
        // PRIORITY 2: Playout exists but no betting → LIVE
        else if (playoutInfo) {
          status = "live";
          scoreHome = playoutInfo.scoreHome;
          scoreAway = playoutInfo.scoreAway;
          minute = playoutInfo.minute;
          goals = playoutInfo.goals;
          liveCount++;
        }
        // PRIORITY 3: No playout, has betting → BETTING
        else if (hasActiveBetting || oddHome > 0) {
          status = "betting";
          bettingCount++;
        }
        // PRIORITY 4: Past round, no playout, no betting → FINISHED
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

    console.log(`=== fetch-live v8: ${leagueName} (${leagueId}) ===`);

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
