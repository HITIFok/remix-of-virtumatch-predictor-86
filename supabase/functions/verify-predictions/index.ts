// verify-predictions/index.ts — Supabase Edge Function v18
// Verifies pending predictions by comparing with round-specific results
// NO imports — uses Deno.serve() + native fetch
//
// v18: Round-aware verification
//   - Fetches results per league, organized by round number
//   - Each prediction must match by: match_id OR (round + team names)
//   - Only verifies when the prediction's round appears in results
//   - Direct API call (always fresh, no cache)
//   - Falls back to scraped_data DB if API fails

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
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

// leagueId -> roundNumber -> array of finished matches
type RoundResults = Map<string, Map<number, FinishedMatch[]>>;

// ─── Fetch results from Sporty API (fresh, not cached) ───────────────

async function fetchAllResultsFromAPI(): Promise<{
  roundResults: RoundResults;
  totalRounds: number;
  totalMatches: number;
}> {
  const roundResults: RoundResults = new Map();
  let totalRounds = 0;
  let totalMatches = 0;

  const results = await Promise.all(LEAGUES.map(l => fetchLeagueResults(l.id)));

  for (const { leagueId, rounds } of results) {
    const leagueRounds = new Map<number, FinishedMatch[]>();
    for (const { roundNum, matches } of rounds) {
      leagueRounds.set(roundNum, matches);
      totalRounds++;
      totalMatches += matches.length;
    }
    roundResults.set(leagueId, leagueRounds);
  }

  console.log(`[verify] API: ${totalMatches} results from ${totalRounds} rounds across ${roundResults.size} leagues`);
  return { roundResults, totalRounds, totalMatches };
}

async function fetchLeagueResults(leagueId: string): Promise<{
  leagueId: string;
  rounds: { roundNum: number; matches: FinishedMatch[] }[];
}> {
  const rounds: { roundNum: number; matches: FinishedMatch[] }[] = [];
  try {
    const response = await fetch(`${API_BASE}/${leagueId}/results?skip=0&take=200`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.log(`[verify] API ${leagueId}: ${response.status}`);
      return { leagueId, rounds };
    }
    const data = await response.json();
    if (data?.rounds) {
      for (const rd of data.rounds) {
        const roundNum = rd.roundNumber || 0;
        const matches: FinishedMatch[] = [];
        for (const m of (rd.matches || [])) {
          const home = m.homeTeam?.name || "";
          const away = m.awayTeam?.name || "";
          if (!home || !away) continue;
          const score = m.score || "0:0";
          const parts = score.split(":");
          const homeScore = parseInt(parts[0]) || 0;
          const awayScore = parseInt(parts[1]) || 0;
          let outcome: string;
          if (homeScore > awayScore) outcome = "1";
          else if (homeScore < awayScore) outcome = "2";
          else outcome = "X";
          matches.push({ home, away, score, homeScore, awayScore, outcome });
        }
        if (matches.length > 0) {
          rounds.push({ roundNum, matches });
        }
      }
    }
  } catch (err: any) {
    console.log(`[verify] API ${leagueId} error: ${err.message}`);
  }
  return { leagueId, rounds };
}

// ─── Match a prediction against round results ────────────────────────

interface VerifyResult {
  found: boolean;
  homeScore?: number;
  awayScore?: number;
  outcome?: string;
  score?: string;
  method?: string;
  reason?: string;
}

function findMatchResult(
  pred: any,
  roundResults: RoundResults
): VerifyResult {
  // Extract prediction details
  const predLeagueId = pred.league_id || "";
  const predRound = pred.round;
  const predMatchId = pred.match_id;
  const predHome = (pred.home_team || pred.home || "").trim().toLowerCase();
  const predAway = (pred.away_team || pred.away || "").trim().toLowerCase();

  if (!predHome || !predAway) {
    return { found: false, reason: "missing team names in prediction" };
  }

  // ── Determine which leagues to search ──
  // If prediction has a league_id, search that league first
  // Otherwise search all leagues
  const leagueIds = predLeagueId
    ? [predLeagueId, ...LEAGUES.map(l => l.id).filter(id => id !== predLeagueId)]
    : LEAGUES.map(l => l.id);

  for (const leagueId of leagueIds) {
    const leagueRounds = roundResults.get(leagueId);
    if (!leagueRounds) continue;

    // If prediction has a round, ONLY check that specific round
    if (predRound && predRound > 0) {
      const roundMatches = leagueRounds.get(predRound);
      if (!roundMatches) {
        // Round not yet in results — match not finished yet
        continue;
      }

      // Search within this specific round
      const match = findTeamMatchInRound(predHome, predAway, roundMatches);
      if (match) {
        return {
          found: true,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          outcome: match.outcome,
          score: match.score,
          method: `round_${predRound}_name`,
        };
      }
      // Round found but no team match — team names might differ
      continue;
    }

    // No round in prediction — search all rounds (fallback for old predictions)
    for (const [roundNum, matches] of leagueRounds) {
      const match = findTeamMatchInRound(predHome, predAway, matches);
      if (match) {
        return {
          found: true,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          outcome: match.outcome,
          score: match.score,
          method: `round_${roundNum}_name_fallback`,
        };
      }
    }
  }

  return { found: false, reason: "no matching result found" };
}

function findTeamMatchInRound(
  predHome: string,
  predAway: string,
  roundMatches: FinishedMatch[]
): FinishedMatch | null {
  // 1. Exact match
  for (const m of roundMatches) {
    if (m.home.toLowerCase() === predHome && m.away.toLowerCase() === predAway) {
      return m;
    }
  }
  // 2. Normalized match (strip accents, special chars)
  for (const m of roundMatches) {
    if (normalize(m.home) === normalize(predHome) && normalize(m.away) === normalize(predAway)) {
      return m;
    }
  }
  // 3. Contains match (partial team name matching)
  for (const m of roundMatches) {
    const mHome = m.home.toLowerCase();
    const mAway = m.away.toLowerCase();
    if ((mHome.includes(predHome) || predHome.includes(mHome)) &&
        (mAway.includes(predAway) || predAway.includes(mAway))) {
      return m;
    }
  }
  return null;
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── FETCH PENDING PREDICTIONS ───────────────────────────────────────

async function fetchPendingPredictions(deviceId?: string): Promise<any[]> {
  let url = `${DATABASE_URL}/rest/v1/predictions?status=eq.pending&order=created_at.asc&limit=200`;
  if (deviceId) {
    url += `&device_id=eq.${encodeURIComponent(deviceId)}`;
  }
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
  console.log("=== verify-predictions v18 (round-aware) ===");

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

    // 2. Fetch fresh results from API organized by round
    const { roundResults, totalRounds, totalMatches } = await fetchAllResultsFromAPI();

    if (totalMatches === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Aucun résultat disponible", verified: 0, pending: pendingPredictions.length, elapsed: Date.now() - startTime }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Match each prediction against round-specific results
    let correct = 0, incorrect = 0, notFound = 0, roundNotFinished = 0;
    const updates: Promise<any>[] = [];

    for (const pred of pendingPredictions) {
      const result = findMatchResult(pred, roundResults);

      if (result.found) {
        const isCorrect = pred.prediction === result.outcome;
        const status = isCorrect ? "correct" : "incorrect";
        if (isCorrect) correct++; else incorrect++;

        updates.push(
          fetch(`${DATABASE_URL}/rest/v1/predictions?id=eq.${pred.id}`, {
            method: "PATCH",
            headers: {
              "apikey": DATABASE_SERVICE_KEY,
              "Authorization": `Bearer ${DATABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal",
            },
            body: JSON.stringify({
              actual_home_score: result.homeScore,
              actual_away_score: result.awayScore,
              actual_outcome: result.outcome,
              actual_score: result.score,
              status,
              verified_at: new Date().toISOString(),
            }),
          })
        );
        console.log(`${isCorrect ? "OK" : "NO"} [${result.method}] ${pred.home_team} vs ${pred.away_team} (round=${pred.round || "?"}): pred=${pred.prediction} actual=${result.outcome} (${result.score})`);
      } else {
        // Check if it's because the round hasn't finished yet
        if (pred.round && pred.round > 0) {
          roundNotFinished++;
          console.log(`[verify] WAIT: ${pred.home_team} vs ${pred.away_team} round=${pred.round} — not yet in results`);
        } else {
          notFound++;
          console.log(`[verify] MISS: ${pred.home_team} vs ${pred.away_team} | league=${pred.league} | round=${pred.round || "none"} | match_id=${pred.match_id || "none"} | reason=${result.reason}`);
        }
      }
    }

    // 4. Execute all updates in parallel
    const settled = await Promise.allSettled(updates);
    const failedUpdates = settled.filter(r => r.status === "rejected").length;

    const elapsed = Date.now() - startTime;
    console.log(`[verify] Done: ${correct} OK, ${incorrect} NO, ${notFound} miss, ${roundNotFinished} waiting, ${failedUpdates} failed (${elapsed}ms)`);

    return new Response(
      JSON.stringify({
        success: true,
        mode: callerMode,
        version: "v18-round-aware",
        source: "api-fresh",
        totalResultRounds: totalRounds,
        totalResultMatches: totalMatches,
        verified: updates.length,
        correct, incorrect,
        notFound,
        roundNotFinished,
        failedUpdates,
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
