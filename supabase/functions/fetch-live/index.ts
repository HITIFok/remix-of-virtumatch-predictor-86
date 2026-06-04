// fetch-live/index.ts — Supabase Edge Function v14
// Fetches live match data, ranking, results from sporty-tech.net API
// v14 FIX: predeterminedScore sent for preloaded matches → LEAK badge works
// v14 FIX: loadFromDatabaseRaw (silent) → no Cache ↔ API flickering
// v13: CORRECT SCORE ODDS PREDICTION — extracts lowest-odds scoreline from
//      "Score exact" market for each match. Available ~2 min before playout!
//      Combined with playout exploit for two-tier early data system:
//        Tier 1 (odds): Available immediately when round appears in /matches
//        Tier 2 (playout): Confirmed score, available ~30s before match start
// NO imports — uses Deno.serve() + native fetch

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const API_BASE = Deno.env.get("SPORTY_API_BASE") || "";

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

const HEADERS: Record<string, string> = {
  "Origin": Deno.env.get("API_ORIGIN") || "",
  "Referer": Deno.env.get("API_REFERER") || "",
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "fr-FR,fr;q=0.9",
  "App-Version": Deno.env.get("API_APP_VERSION") || "",
};

const CONF_BEARER = Deno.env.get("SPORTY_BEARER") || "";
const API_HEADERS = CONF_BEARER
  ? { ...HEADERS, "Authorization": `Bearer ${CONF_BEARER}` }
  : HEADERS;
console.log(`[CONF] Bearer=${CONF_BEARER ? "✓" : "✗"} (using headers only), Origin=${HEADERS.Origin ? "✓" : "✗"}, Referer=${HEADERS.Referer ? "✓" : "✗"}`);

async function fetchAPI(path: string, timeoutMs = 8000): Promise<any> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${API_BASE}${path}`, {
      headers: API_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
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
 * v13: Extract Correct Score prediction from "Score exact" market odds.
 * The lowest-odds scoreline is the most likely predetermined result.
 * Available as soon as the round appears in /matches (~2 min before playout).
 *
 * Returns: { predictedHome: number, predictedAway: number, odds: number, topScores: Array }
 *   topScores = top 3 most likely scorelines for display
 */
function extractScoreExactPrediction(match: any): {
  predictedHome: number;
  predictedAway: number;
  odds: number;
  topScores: Array<{ score: string; home: number; away: number; odds: number }>;
} | null {
  try {
    for (const bt of match.eventBetTypes || []) {
      const name = (bt.name || "").toLowerCase();
      // Match "Score exact" but NOT "Mi-tps" (half-time) or "2ème" (2nd half)
      if (
        (name.includes("score") && name.includes("exact")) ||
        (name.includes("score") && name.includes("correct"))
      ) {
        if (name.includes("mi-tps") || name.includes("2") || name.includes("ht") || name.includes("half")) {
          continue; // Skip half-time correct score markets
        }

        const items = bt.eventBetTypeItems || [];
        if (items.length === 0) continue;

        // Sort by odds ascending (lowest = most likely)
        const sorted = [...items].sort(
          (a: any, b: any) => parseFloat(a.odds || 999) - parseFloat(b.odds || 999)
        );

        // Parse shortName format: "1:0", "2-1", "0 - 0", etc.
        const parseScore = (sn: string): { home: number; away: number } => {
          const cleaned = sn.replace(/\s/g, "").replace("-", ":");
          const parts = cleaned.split(":");
          if (parts.length === 2) {
            return { home: parseInt(parts[0]) || 0, away: parseInt(parts[1]) || 0 };
          }
          return { home: 0, away: 0 };
        };

        const top3 = sorted.slice(0, 3).map((it: any) => {
          const parsed = parseScore(it.shortName || "");
          return {
            score: `${parsed.home}-${parsed.away}`,
            home: parsed.home,
            away: parsed.away,
            odds: parseFloat(it.odds) || 0,
          };
        });

        const best = top3[0];
        if (!best || best.home === 0 && best.away === 0) continue;

        return {
          predictedHome: best.home,
          predictedAway: best.away,
          odds: best.odds,
          topScores: top3,
        };
      }
    }
  } catch (e: any) {
    // Silently skip — prediction is a bonus, not critical
  }
  return null;
}

/**
 * Fetch playout for a specific round — single attempt, fast return.
 * Returns a Map<matchId, {scoreHome, scoreAway, minute, goals}>.
 */
async function fetchPlayout(leagueId: string, round: number): Promise<Map<number, any>> {
  const playoutMatches = new Map();
  try {
    const data = await fetchAPI(
      `/round/${round}/playout?parentEventCategoryId=${leagueId}`,
      3000
    );
    if (data?.matches && Array.isArray(data.matches)) {
      for (const m of data.matches) {
        const matchId = m.id;
        const goals = m.goals || [];
        if (matchId) {
          const lastGoal = goals.length > 0 ? goals[goals.length - 1] : null;
          playoutMatches.set(matchId, {
            scoreHome: lastGoal ? (lastGoal.homeScore || 0) : 0,
            scoreAway: lastGoal ? (lastGoal.awayScore || 0) : 0,
            minute: lastGoal ? (lastGoal.minute || 0) : 90,
            goals: goals,
          });
        }
      }
      console.log(`[Sporty] Playout round ${round}: ${playoutMatches.size} results ✓`);
    } else {
      console.log(`[Sporty] Playout round ${round}: empty (0 matches)`);
    }
  } catch (e: any) {
    console.log(`[Sporty] Playout error round ${round}: ${e.message}`);
  }
  return playoutMatches;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const url = new URL(req.url);
    const leagueId = url.searchParams.get("leagueId") || "8035";
    const leagueName = LEAGUES[leagueId] || "Unknown League";
    const mode = url.searchParams.get("mode") || "";
    console.log(`=== fetch-live v14: ${leagueName} (${leagueId}) ===`);

    // === LIGHTWEIGHT PLOAYOUT MODE ===
    if (mode === "playout") {
      const roundStr = url.searchParams.get("round");
      if (!roundStr) {
        return new Response(
          JSON.stringify({ success: false, error: "round parameter required for playout mode", playoutResults: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const round = parseInt(roundStr);
      if (isNaN(round) || round <= 0) {
        return new Response(
          JSON.stringify({ success: false, error: "invalid round", playoutResults: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const playoutData = await fetchPlayout(leagueId, round);
      const playoutResults: any[] = [];
      for (const [id, data] of playoutData) {
        playoutResults.push({ matchId: id, ...data });
      }

      return new Response(
        JSON.stringify({
          success: true, mode: "playout", league: leagueName, leagueId,
          round, playoutResults, playoutCount: playoutResults.length,
          scrapedAt: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === FULL MODE ===
    console.log(`[Sporty] Fetching ${leagueName} (${leagueId})`);

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

    // Identify finished matches from results (note: /results has id=0, so use team name matching)
    // Actually results have id=0, so we can't match by ID. We'll rely on playout + betting detection.
    const _finishedMatchIds = new Set<number>();
    if (resultsData?.rounds) {
      for (const rd of resultsData.rounds) {
        for (const m of rd.matches || []) {
          if (m.id && m.id > 0) _finishedMatchIds.add(m.id);
        }
      }
    }

    // === v13: TWO-TIER EARLY DATA SYSTEM ===
    // Tier 1: Correct Score Odds Prediction (available immediately)
    // Tier 2: Playout Exploit (available ~30s before match start)

    // Step 1: Find all rounds and identify betting matches
    const bettingMatchIds = new Set<number>();
    const allRoundNumbers = new Set<number>();
    let nextRoundStart: string | null = null;
    let bettingRound: number | null = null;

    if (matchesData?.rounds) {
      for (const rd of matchesData.rounds) {
        const roundNum = rd.roundNumber || 0;
        if (roundNum > 0) allRoundNumbers.add(roundNum);

        // Track the next round's start time (for betting round)
        for (const m of rd.matches || []) {
          const hasActiveBetting = m.eventBetTypes?.some((bt: any) =>
            bt.eventBetTypeItems?.some((it: any) => it.active && it.bettingAllowed)
          );
          if (hasActiveBetting) {
            bettingMatchIds.add(m.id);
          }
        }
      }
    }

    // Determine the betting round
    if (matchesData?.rounds) {
      for (const rd of matchesData.rounds) {
        const roundNum = rd.roundNumber || 0;
        const hasBettingMatch = (rd.matches || []).some((m: any) =>
          bettingMatchIds.has(m.id)
        );
        if (hasBettingMatch && roundNum > 0) {
          bettingRound = roundNum;
          nextRoundStart = rd.expectedStart || null;
          break;
        }
      }
    }

    // Step 2: Extract Correct Score predictions from /matches (Tier 1 — IMMEDIATE)
    const oddsPredictions = new Map<number, any>();
    if (matchesData?.rounds) {
      for (const rd of matchesData.rounds) {
        for (const m of rd.matches || []) {
          const prediction = extractScoreExactPrediction(m);
          if (prediction && m.id) {
            oddsPredictions.set(m.id, prediction);
          }
        }
      }
    }
    const predictionCount = oddsPredictions.size;
    console.log(`[Sporty] Score Exact predictions: ${predictionCount} matches`);

    // Step 3: Fetch playout for active rounds (Tier 2 — CONFIRMED)
    const roundList = [...allRoundNumbers].sort((a, b) => b - a).slice(0, 5);

    const nextRound = bettingRound ? bettingRound + 1 : 0;
    const startsInMs = nextRoundStart
      ? new Date(nextRoundStart).getTime() - Date.now()
      : -1;
    console.log(`[Sporty] Betting round: ${bettingRound} (${bettingMatchIds.size} IDs), Next round: ${nextRound} (0 IDs, starts in ${Math.round(startsInMs / 1000)}s)`);

    const allPlayoutMatches = new Map<number, any>();
    if (roundList.length > 0) {
      const playoutResults = await Promise.allSettled(
        roundList.map(r => fetchPlayout(leagueId, r))
      );
      for (const result of playoutResults) {
        if (result.status === "fulfilled") {
          for (const [id, data] of result.value) {
            allPlayoutMatches.set(id, data);
          }
        }
      }
    }
    console.log(`[Sporty] Total playout results available: ${allPlayoutMatches.size}`);

    // Step 4: Cross-reference playout with betting matches (EXPLOIT)
    const preloadedMatches = new Map<number, any>();
    for (const [matchId, playoutData] of allPlayoutMatches) {
      if (bettingMatchIds.has(matchId)) {
        preloadedMatches.set(matchId, playoutData);
      }
    }
    const preloadedCount = preloadedMatches.size;

    // Step 5: Build matches array with predictions
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
          let prediction: any = null;
          let predeterminedScore: { home: number; away: number; minute: number } | null = null;

          if (preloadedMatches.has(m.id)) {
            // TIER 2 CONFIRMED: Playout exploit — score known before match starts!
            const preloaded = preloadedMatches.get(m.id)!;
            status = "preloaded";
            scoreHome = preloaded.scoreHome;
            scoreAway = preloaded.scoreAway;
            minute = preloaded.minute;
            goals = preloaded.goals;
            // v14 FIX: Send predeterminedScore so frontend can show LEAK badge
            predeterminedScore = {
              home: preloaded.scoreHome,
              away: preloaded.scoreAway,
              minute: preloaded.minute,
            };
            // Also include the odds prediction for comparison
            prediction = oddsPredictions.get(m.id) || null;
            console.log(`[EXPLOIT] ${m.homeTeam?.name || '?'} vs ${m.awayTeam?.name || '?'} → ${scoreHome}-${scoreAway} (betting still open! round ${roundNum})`);
          } else if (allPlayoutMatches.has(m.id)) {
            // Match is in playout but NOT in betting → it's a live match
            const liveInfo = allPlayoutMatches.get(m.id)!;
            status = "live";
            scoreHome = liveInfo.scoreHome;
            scoreAway = liveInfo.scoreAway;
            minute = liveInfo.minute;
            goals = liveInfo.goals;
            liveCount++;
          } else if (bettingMatchIds.has(m.id) || oddHome > 0) {
            status = "betting";
            bettingCount++;
            // TIER 1: Include odds prediction for betting matches
            prediction = oddsPredictions.get(m.id) || null;
          }

          matches.push({
            id: m.id, home: m.homeTeam?.name || "", away: m.awayTeam?.name || "",
            round: roundNum, league: leagueName, status, kickoff: m.expectedStart || "",
            oddHome, oddDraw, oddAway, scoreHome, scoreAway, minute, goals,
            predeterminedScore: predeterminedScore || null, // v14: for LEAK badge
            prediction, // v13: { predictedHome, predictedAway, odds, topScores }
          });
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Sporty] ${leagueName}: matches=${matches.length}, ranking=${rankingData?.teams?.length || 0}, results=${resultsData?.rounds?.length || 0}, preloaded=${preloadedCount}, live=${liveCount}, betting=${bettingCount}, finished=${finishedCount}`);
    console.log(`[Sporty] Total: ${elapsed}ms`);

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
        matches, ranking, results, liveCount, bettingCount, finishedCount, preloadedCount,
        predictionCount,
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
