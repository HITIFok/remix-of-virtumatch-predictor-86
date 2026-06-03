// fetch-live/index.ts — Supabase Edge Function v9
// Fetches VIRTUAL match data, ranking, results from Sporty Instant Leagues API
//
// v9: AGGRESSIVE POLLING — catch playout data the instant it becomes available
//   Problem: Playout data appears ~2-3s before match starts. Single retry at 1.5s
//            misses the window most of the time → preloaded=0 for multiple executions.
//   Fix: 10 retries at 300ms intervals (3s total) — catches data within 300ms of availability
//   Also: Track current round match IDs to avoid false matches from previous round

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

// ─── Polling config ──────────────────────────────────────────────────
const POLL_RETRIES = 15;       // Max retries when playout returns 400
const POLL_INTERVAL_MS = 400;  // Wait between retries (400ms)
const POLL_MAX_WAIT_MS = POLL_RETRIES * POLL_INTERVAL_MS; // 6s total max wait

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
 * Returns Map keyed by match ID (number).
 * Playout response per match: { id: number, entryPointId: 0, goals: [...], expectedStart: "..." }
 */
async function fetchPlayout(leagueId: string, round: number): Promise<Map<number, any>> {
  const playoutResults = new Map<number, any>();
  try {
    const data = await fetchAPI(
      `/round/${round}/playout?parentEventCategoryId=${leagueId}`,
      5000 // shorter timeout for faster polling
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
    if (playoutResults.size === 0) {
      console.log(`[Sporty] Playout round ${round}: empty (0 matches)`);
    }
  } catch (e: any) {
    console.log(`[Sporty] Playout error round ${round}: ${e.message}`);
  }
  return playoutResults;
}

/**
 * Aggressively poll playout for a round until data appears or max retries reached.
 * Returns Map<number, any> keyed by match ID.
 * v9: Polls every 300ms up to 10 times (3s total) to catch data ASAP.
 */
async function fetchPlayoutWithPolling(
  leagueId: string,
  round: number,
  targetMatchIds?: Set<number> // Optional: only count as success if these IDs are found
): Promise<Map<number, any>> {
  // First attempt (immediate, no delay)
  let result = await fetchPlayout(leagueId, round);

  // If we got results that match our target IDs, return immediately
  if (targetMatchIds && targetMatchIds.size > 0) {
    const matchedCount = [...result.keys()].filter(id => targetMatchIds.has(id)).length;
    if (matchedCount > 0) {
      console.log(`[Sporty] Playout round ${round}: IMMEDIATE hit! ${matchedCount}/${targetMatchIds.size} target matches found`);
      return result;
    }
  } else if (result.size > 0) {
    console.log(`[Sporty] Playout round ${round}: IMMEDIATE hit! ${result.size} matches`);
    return result;
  }

  // Aggressive polling loop
  console.log(`[Sporty] Playout round ${round}: empty, starting aggressive polling (${POLL_RETRIES}x${POLL_INTERVAL_MS}ms)...`);
  const startTime = Date.now();

  for (let attempt = 1; attempt <= POLL_RETRIES; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    result = await fetchPlayout(leagueId, round);

    if (targetMatchIds && targetMatchIds.size > 0) {
      const matchedCount = [...result.keys()].filter(id => targetMatchIds.has(id)).length;
      if (matchedCount > 0) {
        const elapsed = Date.now() - startTime;
        console.log(`[Sporty] Playout round ${round}: HIT at attempt ${attempt}/${POLL_RETRIES} after ${elapsed}ms! ${matchedCount}/${targetMatchIds.size} target matches`);
        return result;
      }
    } else if (result.size > 0) {
      const elapsed = Date.now() - startTime;
      console.log(`[Sporty] Playout round ${round}: HIT at attempt ${attempt}/${POLL_RETRIES} after ${elapsed}ms! ${result.size} matches`);
      return result;
    }

    // If we got some results but none match our targets, still return them
    // (they might be from a different round that shares the playout slot)
    if (result.size > 0 && (!targetMatchIds || targetMatchIds.size === 0)) {
      return result;
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Sporty] Playout round ${round}: No data after ${elapsed}ms (${POLL_RETRIES} attempts)`);
  return result;
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
  currentRound: number;
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

  // Step 2: Identify the CURRENT betting round and collect match IDs
  let currentBettingRound = 0;
  const currentRoundMatchIds = new Set<number>();

  if (matchesData?.rounds) {
    for (const rd of matchesData.rounds) {
      const rn = rd.roundNumber || 0;

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

    // Collect match IDs for the current betting round (used to validate playout)
    if (currentBettingRound > 0) {
      for (const rd of matchesData.rounds) {
        if (rd.roundNumber === currentBettingRound) {
          for (const m of rd.matches || []) {
            if (m.id) currentRoundMatchIds.add(m.id);
          }
          break;
        }
      }
    }
  }

  console.log(`[Sporty] Current betting round: ${currentBettingRound}, match IDs: ${currentRoundMatchIds.size}`);

  // Step 3: Fetch playout with AGGRESSIVE POLLING for current round
  let playoutMatches = new Map<number, any>();

  if (currentBettingRound > 0) {
    playoutMatches = await fetchPlayoutWithPolling(
      leagueId,
      currentBettingRound,
      currentRoundMatchIds // Only count as success if these IDs are found
    );
  }

  console.log(`[Sporty] Playout for round ${currentBettingRound}: ${playoutMatches.size} results`);

  // Step 4: Also try previous round ONLY for live matches still playing
  // (don't pollute playoutMatches with stale data from completed previous round)
  // Skip this during new round transition to avoid false matches
  const bettingMatchCount = matchesData?.rounds
    ?.flatMap((rd: any) => rd.matches || [])
    .filter((m: any) => m.eventBetTypes?.some((bt: any) =>
      bt.eventBetTypeItems?.some((it: any) => it.active && it.bettingAllowed)
    )).length || 0;

  if (currentBettingRound > 1 && playoutMatches.size === 0 && bettingMatchCount < 10) {
    const prevPlayout = await fetchPlayout(leagueId, currentBettingRound - 1);
    // Only add previous round data if match IDs overlap with known matches
    for (const [matchId, data] of prevPlayout) {
      if (matchId) playoutMatches.set(matchId, data);
    }
    console.log(`[Sporty] Previous round ${currentBettingRound - 1} playout: ${prevPlayout.size} results`);
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

        // Match playout by match ID
        const matchId = m.id;
        const playoutInfo = matchId ? playoutMatches.get(matchId) : null;

        // Determine match status
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

  return { matches, ranking, results, liveCount, bettingCount, finishedCount, preloadedCount, currentRound: currentBettingRound };
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

    console.log(`=== fetch-live v9: ${leagueName} (${leagueId}) ===`);

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
        currentRound: data.currentRound,
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
