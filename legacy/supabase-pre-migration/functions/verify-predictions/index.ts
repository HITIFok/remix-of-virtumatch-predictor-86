// verify-predictions/index.ts — Supabase Edge Function v20
// Verifies pending predictions using MATCH ID (no confusion)
// NO imports — uses Deno.serve() + native fetch
//
// v20: Match-ID-first verification
//   1. Fetch /matches for each league → build set of ACTIVE match IDs
//   2. If prediction.match_id NOT in active set → match is finished
//   3. Fetch /results for that league → find by round + team names (precise: 1 league, 1 round)
//   4. No more cross-league or cross-round confusion

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id, accept, cache-control",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_BASE = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues";

const DATABASE_URL = Deno.env.get("DATABASE_URL") || "";
const DATABASE_SERVICE_KEY = Deno.env.get("DATABASE_SERVICE_KEY") || "";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const result = new Uint8Array(aBytes.length);
  for (let i = 0; i < aBytes.length; i++) result[i] = aBytes[i] ^ bBytes[i];
  return result.every(byte => byte === 0);
}

const LEAGUES = [
  { id: "8035", name: "English League" },
  { id: "8060", name: "Coupe d'Afrique" },
  { id: "8056", name: "Champions League" },
  { id: "8036", name: "Italian League" },
  { id: "8037", name: "Spanish League" },
  { id: "8042", name: "French League" },
  { id: "8043", name: "German League" },
  { id: "8044", name: "Portuguese League" },
  { id: "8065", name: "Coupe du monde" },
];

const HEADERS: Record<string, string> = {
  "accept": "application/json, text/plain, */*",
  "accept-language": "fr",
  "app-version": "33470",
  "referer": "https://bet261.mg/",
  "sec-ch-ua": '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
};

// ─── Types ───────────────────────────────────────────────────────────

interface FinishedMatch {
  home: string;
  away: string;
  score: string;
  homeScore: number;
  awayScore: number;
  outcome: string; // "1", "X", or "2"
}

// ─── Fetch active match IDs from /matches endpoint ────────────────

async function fetchActiveMatchIds(): Promise<Map<string, Set<number>>> {
  // Returns: leagueId -> set of active match IDs
  const activeByLeague = new Map<string, Set<number>>();

  const results = await Promise.all(LEAGUES.map(async (l) => {
    try {
      const res = await fetch(`${API_BASE}/${l.id}/matches`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { leagueId: l.id, ids: [] as number[] };
      const data = await res.json();
      const ids: number[] = [];
      if (data?.rounds) {
        for (const rd of data.rounds) {
          for (const m of rd.matches || []) {
            if (m.id && m.id > 0) ids.push(m.id);
          }
        }
      }
      return { leagueId: l.id, ids };
    } catch (err: any) {
      console.log(`[verify] /matches ${l.id} error: ${err.message}`);
      return { leagueId: l.id, ids: [] as number[] };
    }
  }));

  for (const { leagueId, ids } of results) {
    activeByLeague.set(leagueId, new Set(ids));
  }
  const totalActive = results.reduce((s, r) => s + r.ids.length, 0);
  console.log(`[verify] Active matches: ${totalActive} across ${activeByLeague.size} leagues`);
  return activeByLeague;
}

// ─── Fetch results from /results endpoint (on demand per league) ───

async function fetchLeagueResults(leagueId: string): Promise<Map<number, FinishedMatch[]>> {
  const roundResults = new Map<number, FinishedMatch[]>();
  try {
    const res = await fetch(`${API_BASE}/${leagueId}/results?skip=0&take=200`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return roundResults;
    const data = await res.json();
    if (data?.rounds) {
      for (const rd of data.rounds) {
        const roundNum = rd.roundNumber || 0;
        if (roundNum <= 0) continue;
        const matches: FinishedMatch[] = [];
        for (const m of rd.matches || []) {
          const home = m.homeTeam?.name || "";
          const away = m.awayTeam?.name || "";
          if (!home || !away) continue;
          const score = m.score || "0:0";
          const parts = score.split(":");
          const h = parseInt(parts[0]) || 0;
          const a = parseInt(parts[1]) || 0;
          matches.push({
            home, away, score, homeScore: h, awayScore: a,
            outcome: h > a ? "1" : h < a ? "2" : "X",
          });
        }
        if (matches.length > 0) roundResults.set(roundNum, matches);
      }
    }
  } catch (err: any) {
    console.log(`[verify] /results ${leagueId} error: ${err.message}`);
  }
  return roundResults;
}

// ─── Match by team name within ONE round (precise context) ─────────

function findInRound(predHome: string, predAway: string, roundMatches: FinishedMatch[]): FinishedMatch | null {
  // 1. Exact
  for (const m of roundMatches) {
    if (m.home.toLowerCase() === predHome && m.away.toLowerCase() === predAway) return m;
  }
  // 2. Normalized (strip accents)
  const pH = norm(predHome), pA = norm(predAway);
  for (const m of roundMatches) {
    if (norm(m.home) === pH && norm(m.away) === pA) return m;
  }
  // 3. Contains (partial)
  for (const m of roundMatches) {
    const mH = m.home.toLowerCase(), mA = m.away.toLowerCase();
    if ((mH.includes(predHome) || predHome.includes(mH)) &&
        (mA.includes(predAway) || predAway.includes(mA))) return m;
  }
  return null;
}

function norm(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

// ─── FETCH PENDING PREDICTIONS ─────────────────────────────────────

async function fetchPendingPredictions(deviceId?: string): Promise<any[]> {
  let url = `${DATABASE_URL}/rest/v1/predictions?status=eq.pending&order=created_at.asc&limit=200`;
  if (deviceId) url += `&device_id=eq.${encodeURIComponent(deviceId)}`;
  const dbRes = await fetch(url, {
    headers: {
      "apikey": DATABASE_SERVICE_KEY,
      "Authorization": `Bearer ${DATABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!dbRes.ok) {
    console.error(`[verify] Failed to fetch predictions: ${dbRes.status}`);
    return [];
  }
  return await dbRes.json();
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("=== verify-predictions v20 (match-id-first) ===");

  try {
    // ── Mode detection: CRON vs CLIENT ──
    const cronKey = req.headers.get("x-cron-key");
    const expectedCronKey = Deno.env.get("CRON_SECRET");
    const isCron = cronKey && expectedCronKey && timingSafeEqual(cronKey, expectedCronKey);

    const apiKeyHeader = req.headers.get("apikey");
    let deviceId: string | undefined;
    let callerMode: string;

    if (isCron) {
      callerMode = "cron";
      console.log("[verify] Mode: CRON (full scan)");
    } else if (apiKeyHeader) {
      callerMode = "client";
      try {
        const body = await req.json();
        deviceId = body?.deviceId || body?.device_id;
      } catch { /* no body */ }
      console.log(`[verify] Mode: CLIENT (device: ${deviceId || "all"})`);
    } else {
      return new Response(
        JSON.stringify({ error: "Unauthorized: provide apikey or x-cron-key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Fetch pending predictions
    const pendingPredictions = await fetchPendingPredictions(deviceId);
    console.log(`[verify] ${pendingPredictions.length} pending predictions`);

    if (pendingPredictions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Aucune prédiction en attente", verified: 0, elapsed: Date.now() - startTime }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch ALL active match IDs from /matches (parallel, all leagues)
    const activeByLeague = await fetchActiveMatchIds();

    // 3. Separate predictions: those with match_id vs without
    const withId = pendingPredictions.filter(p => p.match_id && p.match_id > 0);
    const withoutId = pendingPredictions.filter(p => !p.match_id || p.match_id <= 0);
    console.log(`[verify] with match_id: ${withId.length}, without: ${withoutId.length}`);

    // 4. For predictions WITH match_id: check if still active
    //    If NOT active → the match is finished → fetch results for its league
    let correct = 0, incorrect = 0, stillActive = 0, notFound = 0;
    const updates: Promise<any>[] = [];

    // Track which leagues we already fetched results for (avoid duplicate fetches)
    const resultsCache = new Map<string, Map<number, FinishedMatch[]>>();

    async function getResultsForLeague(leagueId: string): Promise<Map<number, FinishedMatch[]>> {
      let cached = resultsCache.get(leagueId);
      if (cached) return cached;
      cached = await fetchLeagueResults(leagueId);
      resultsCache.set(leagueId, cached);
      return cached;
    }

    // ── 4a. Verify predictions WITH match_id ──
    for (const pred of withId) {
      const predLeagueId = String(pred.league_id || "");
      const predRound = pred.round || 0;
      const predMatchId = Number(pred.match_id);

      // Check if match is still active in ANY league
      let isActive = false;
      if (predLeagueId) {
        // Check the prediction's league first
        const activeIds = activeByLeague.get(predLeagueId);
        if (activeIds?.has(predMatchId)) {
          isActive = true;
        }
      }
      // If not found in specific league, check all leagues
      if (!isActive) {
        for (const [, ids] of activeByLeague) {
          if (ids.has(predMatchId)) {
            isActive = true;
            break;
          }
        }
      }

      if (isActive) {
        stillActive++;
        console.log(`[verify] ACTIVE: ${pred.home_team} vs ${pred.away_team} (id=${predMatchId}) — still in /matches`);
        continue;
      }

      // Match is NOT in /matches → it's finished. Find its result.
      // Use league_id + round for precise lookup
      const predHome = (pred.home_team || "").trim().toLowerCase();
      const predAway = (pred.away_team || "").trim().toLowerCase();
      if (!predHome || !predAway) {
        notFound++;
        continue;
      }

      // Determine which leagues to check for results
      const leaguesToCheck = predLeagueId
        ? [predLeagueId, ...LEAGUES.map(l => l.id).filter(id => id !== predLeagueId)]
        : LEAGUES.map(l => l.id);

      let found = false;
      for (const leagueId of leaguesToCheck) {
        const roundResults = await getResultsForLeague(leagueId);

        if (predRound > 0) {
          // Precise: search ONLY the specific round
          const roundMatches = roundResults.get(predRound);
          if (!roundMatches) continue; // Round not in results yet

          const match = findInRound(predHome, predAway, roundMatches);
          if (match) {
            const isCorrect = pred.prediction === match.outcome;
            const status = isCorrect ? "correct" : "incorrect";
            if (isCorrect) correct++; else incorrect++;

            updates.push(patchPrediction(pred.id, match, status));
            console.log(`${isCorrect ? "OK" : "NO"} [match_id=${predMatchId}] ${pred.home_team} vs ${pred.away_team} (round=${predRound}): pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
            found = true;
            break;
          }
        } else {
          // No round → search all rounds in this league
          for (const [roundNum, roundMatches] of roundResults) {
            const match = findInRound(predHome, predAway, roundMatches);
            if (match) {
              const isCorrect = pred.prediction === match.outcome;
              const status = isCorrect ? "correct" : "incorrect";
              if (isCorrect) correct++; else incorrect++;

              updates.push(patchPrediction(pred.id, match, status));
              console.log(`${isCorrect ? "OK" : "NO"} [match_id=${predMatchId}] ${pred.home_team} vs ${pred.away_team} (round=${roundNum}): pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }

      if (!found) {
        notFound++;
        console.log(`[verify] MISS: ${pred.home_team} vs ${pred.away_team} | id=${predMatchId} | league=${predLeagueId || "?"} | round=${predRound || "?"}`);
      }
    }

    // ── 4b. Verify predictions WITHOUT match_id (fallback: league+round+names) ──
    for (const pred of withoutId) {
      const predLeagueId = String(pred.league_id || "");
      const predRound = pred.round || 0;
      const predHome = (pred.home_team || "").trim().toLowerCase();
      const predAway = (pred.away_team || "").trim().toLowerCase();
      if (!predHome || !predAway) { notFound++; continue; }

      const leaguesToCheck = predLeagueId
        ? [predLeagueId, ...LEAGUES.map(l => l.id).filter(id => id !== predLeagueId)]
        : LEAGUES.map(l => l.id);

      let found = false;
      for (const leagueId of leaguesToCheck) {
        const roundResults = await getResultsForLeague(leagueId);
        const roundsToSearch = predRound > 0
          ? [[predRound, roundResults.get(predRound)] as [number, FinishedMatch[] | undefined]]
          : [...roundResults.entries()];

        for (const [roundNum, roundMatches] of roundsToSearch) {
          if (!roundMatches) continue;
          const match = findInRound(predHome, predAway, roundMatches);
          if (match) {
            const isCorrect = pred.prediction === match.outcome;
            const status = isCorrect ? "correct" : "incorrect";
            if (isCorrect) correct++; else incorrect++;

            updates.push(patchPrediction(pred.id, match, status));
            console.log(`${isCorrect ? "OK" : "NO"} [no_id] ${pred.home_team} vs ${pred.away_team} (round=${roundNum}): pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        notFound++;
        console.log(`[verify] MISS: ${pred.home_team} vs ${pred.away_team} | no match_id | league=${predLeagueId || "?"} | round=${predRound || "?"}`);
      }
    }

    // 5. Execute all updates in parallel
    const settled = await Promise.allSettled(updates);
    const failedUpdates = settled.filter(r => r.status === "rejected").length;

    const elapsed = Date.now() - startTime;
    console.log(`[verify] Done: ${correct} OK, ${incorrect} NO, ${stillActive} still_active, ${notFound} miss, ${failedUpdates} failed (${elapsed}ms)`);

    return new Response(
      JSON.stringify({
        success: true,
        mode: callerMode,
        version: "v20-match-id",
        withMatchId: withId.length,
        withoutMatchId: withoutId.length,
        correct, incorrect,
        stillActive,
        notFound,
        failedUpdates,
        verified: updates.length,
        stillPending: pendingPredictions.length - updates.length,
        elapsed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[verify] Error (${elapsed}ms):`, error);
    return new Response(
      JSON.stringify({ error: error.message, elapsed }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function patchPrediction(id: string, match: FinishedMatch, status: string): Promise<Response> {
  return fetch(`${DATABASE_URL}/rest/v1/predictions?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "apikey": DATABASE_SERVICE_KEY,
      "Authorization": `Bearer ${DATABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      actual_home_score: match.homeScore,
      actual_away_score: match.awayScore,
      actual_outcome: match.outcome,
      actual_score: match.score,
      status,
      verified_at: new Date().toISOString(),
    }),
  });
}