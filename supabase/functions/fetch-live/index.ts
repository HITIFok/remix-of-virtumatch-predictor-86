// fetch-live/index.ts — Supabase Edge Function v11
// Fetches VIRTUAL match data, ranking, results from Sporty Instant Leagues API
//
// v11: FAST SINGLE-CHECK — no aggressive polling (frontend handles RAPID polling)
//   - Removes 15x400ms internal polling (was 6s per call)
//   - Single playout check per round (~200ms total response)
//   - Frontend polls at 500ms (RAPID) or 5s (NORMAL) based on match status
//   - Uses ONLY Supabase Secrets for API_BASE, Origin, Referer (no hardcoded fallbacks)

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

// API base URL from Supabase Secret ONLY (no fallback)
const API_BASE = env(Deno.env.get("SPORTY_API_BASE"));

// ─── Dynamic headers with env var support ───────────────────────────
function buildHeaders(): Record<string, string> {
  const apiOrigin = env(Deno.env.get("API_ORIGIN"));
  const apiReferer = env(Deno.env.get("API_REFERER"));

  const headers: Record<string, string> = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "fr",
    "app-version": "33470",
    "referer": apiReferer || "",
    "origin": apiOrigin || "",
    "sec-ch-ua": '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
  };

  const bearer = env(Deno.env.get("SPORTY_BEARER"));
  if (bearer) {
    const token = bearer.replace(/^Bearer\s+/i, "");
    headers["authorization"] = `Bearer ${token}`;
    console.log(`[CONF] Bearer=✓ (${token.length} chars), Origin=✓, Referer=✓`);
  } else {
    console.log(`[CONF] Bearer=✗ (using headers only), Origin=${apiOrigin ? "✓" : "✗"}, Referer=${apiReferer ? "✓" : "✗"}`);
  }

  const cookie = env(Deno.env.get("SPORTY_COOKIE"));
  if (cookie) {
    headers["cookie"] = cookie;
    console.log(`[CONF] Cookie=✓ (${cookie.length} chars)`);
  }

  return headers;
}

// ═══════════════════════════════════════════════════════════════════════
// Sporty API fetching
// ═══════════════════════════════════════════════════════════════════════

async function fetchAPI(path: string, timeoutMs = 8000): Promise<any> {
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
 * Fetch playout data for a specific round (single check, no polling).
 * Returns Map keyed by match ID (number).
 */
async function fetchPlayout(leagueId: string, round: number): Promise<Map<number, any>> {
  const playoutResults = new Map<number, any>();
  try {
    const data = await fetchAPI(
      `/round/${round}/playout?parentEventCategoryId=${leagueId}`,
      4000
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
    } else {
      console.log(`[Sporty] Playout for round ${round}: ${playoutResults.size} results`);
    }
  } catch (e: any) {
    console.log(`[Sporty] Playout error round ${round}: ${e.message}`);
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

    // Collect match IDs for the current betting round
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

  // Step 3: Fetch playout for the current betting round (single check, no polling)
  // Frontend handles RAPID polling at 500ms — no need for internal polling
  let playoutMatches = new Map<number, any>();

  if (currentBettingRound > 0) {
    playoutMatches = await fetchPlayout(leagueId, currentBettingRound);
  }

  // Step 4: Also check previous round for any live matches still playing
  const bettingMatchCount = matchesData?.rounds
    ?.flatMap((rd: any) => rd.matches || [])
    .filter((m: any) => m.eventBetTypes?.some((bt: any) =>
      bt.eventBetTypeItems?.some((it: any) => it.active && it.bettingAllowed)
    )).length || 0;

  if (currentBettingRound > 1 && playoutMatches.size === 0 && bettingMatchCount < 10) {
    const prevPlayout = await fetchPlayout(leagueId, currentBettingRound - 1);
    for (const [matchId, data] of prevPlayout) {
      if (matchId) playoutMatches.set(matchId, data);
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

    const startTime = Date.now();
    console.log(`=== fetch-live v11: ${leagueName} (${leagueId}) ===`);

    if (!API_BASE) {
      console.error(`[CONF] SPORTY_API_BASE is not set! Check Supabase Secrets.`);
      return new Response(
        JSON.stringify({
          success: false,
          error: "SPORTY_API_BASE secret not configured",
          source: "error",
          matches: [],
          results: [],
          ranking: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await fetchFromSporty(leagueId);
    const elapsed = Date.now() - startTime;
    console.log(`[Sporty] Total: ${elapsed}ms`);

    if (!data) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Sporty API unavailable",
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
