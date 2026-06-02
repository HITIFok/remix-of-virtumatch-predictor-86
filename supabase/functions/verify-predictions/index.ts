// verify-predictions/index.ts — Supabase Edge Function
// Verifies pending predictions by comparing with API results
// NO imports — uses Deno.serve() + native fetch
//
// v15: Two modes:
//   - CRON (x-cron-key): verifies ALL pending predictions (up to 200)
//   - CLIENT (apikey + device_id body): verifies only this device's pending predictions
// Both modes fetch results from all 9 leagues in parallel.

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_BASE = Deno.env.get("SPORTY_API_BASE") || "";
if (!API_BASE) {
  console.error("SPORTY_API_BASE not configured");
}

const DATABASE_URL = Deno.env.get("DATABASE_URL") || "";
const DATABASE_SERVICE_KEY = Deno.env.get("DATABASE_SERVICE_KEY") || "";

// Timing-safe comparison to prevent timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const result = new Uint8Array(aBytes.length);
  for (let i = 0; i < aBytes.length; i++) {
    result[i] = aBytes[i] ^ bBytes[i];
  }
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
  "Origin": Deno.env.get("API_ORIGIN") || "",
  "Referer": Deno.env.get("API_REFERER") || "",
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "fr-FR,fr;q=0.9",
  "App-Version": Deno.env.get("API_APP_VERSION") || "",
};

/** Fetch results from one league and return a Map keyed by "homeTeam|awayTeam" */
async function fetchResults(leagueId: string): Promise<Map<string, { homeScore: number; awayScore: number; outcome: string; league: string }>> {
  const resultsMap = new Map();
  try {
    const response = await fetch(`${API_BASE}/${leagueId}/results?skip=0&take=200`, { headers: HEADERS });
    if (!response.ok) {
      console.log(`League ${leagueId}: API returned ${response.status}`);
      return resultsMap;
    }
    const data = await response.json();
    if (data?.rounds) {
      for (const roundData of data.rounds) {
        for (const match of (roundData.matches || [])) {
          const homeTeam = match.homeTeam?.name;
          const awayTeam = match.awayTeam?.name;
          const score = match.score || "0:0";
          const parts = score.split(":");
          const homeScore = parseInt(parts[0]) || 0;
          const awayScore = parseInt(parts[1]) || 0;
          let outcome: string;
          if (homeScore > awayScore) outcome = "1";
          else if (homeScore < awayScore) outcome = "2";
          else outcome = "X";
          if (homeTeam && awayTeam) {
            resultsMap.set(`${homeTeam}|${awayTeam}`, {
              homeScore, awayScore, outcome,
              league: LEAGUES.find(l => l.id === leagueId)?.name || "Unknown",
            });
          }
        }
      }
    }
    console.log(`League ${leagueId}: ${resultsMap.size} results`);
  } catch (err: any) {
    console.log(`League ${leagueId}: ${err.message}`);
  }
  return resultsMap;
}

/** Fetch results from ALL leagues in parallel */
async function fetchAllResults(): Promise<Map<string, { homeScore: number; awayScore: number; outcome: string; league: string }>> {
  const allResults = await Promise.all(LEAGUES.map(l => fetchResults(l.id)));
  const resultsMap = new Map();
  for (const leagueResults of allResults) {
    for (const [key, value] of leagueResults) {
      resultsMap.set(key, value);
    }
  }
  console.log(`Total results across all leagues: ${resultsMap.size}`);
  return resultsMap;
}

/** Fetch pending predictions with optional device_id filter */
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
    console.error(`Failed to fetch predictions: ${dbRes.status}`);
    return [];
  }
  return await dbRes.json();
}

/** Compare predictions against results and update verified ones */
async function verifyPredictions(pendingPredictions: any[], resultsMap: Map<string, any>): Promise<{ correct: number; incorrect: number; failed: number }> {
  let correct = 0, incorrect = 0;
  const updates: Promise<any>[] = [];

  for (const pred of pendingPredictions) {
    const key = `${pred.home_team}|${pred.away_team}`;
    const result = resultsMap.get(key);
    if (result) {
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
            actual_score: `${result.homeScore}:${result.awayScore}`,
            status: status,
            verified_at: new Date().toISOString(),
          }),
        })
      );
      console.log(`${isCorrect ? "✅" : "❌"} ${pred.home_team} vs ${pred.away_team}: predicted ${pred.prediction}, actual ${result.outcome} (${result.homeScore}-${result.awayScore})`);
    }
  }

  const settledResults = await Promise.allSettled(updates);
  const failed = settledResults.filter(r => r.status === "rejected").length;
  console.log(`Verification: ${correct} correct, ${incorrect} incorrect, ${failed} failed`);

  return { correct, incorrect, failed };
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("=== verify-predictions called ===");

  try {
    // ── Mode detection: CRON vs CLIENT ──
    const cronKey = req.headers.get("x-cron-key");
    const expectedCronKey = Deno.env.get("CRON_SECRET");
    const isCron = cronKey && expectedCronKey && timingSafeEqual(cronKey, expectedCronKey);

    const apiKeyHeader = req.headers.get("apikey");
    let deviceId: string | undefined;
    let callerMode: string;

    if (isCron) {
      // CRON mode: verify ALL pending predictions
      callerMode = "cron";
      console.log("[verify-predictions] Mode: CRON (full scan)");
    } else if (apiKeyHeader) {
      // CLIENT mode: verify only this device's predictions
      callerMode = "client";
      try {
        const body = await req.json();
        deviceId = body?.deviceId;
      } catch {
        // Empty body — no device filter
      }
      console.log(`[verify-predictions] Mode: CLIENT (device: ${deviceId || "all"})`);
    } else {
      return new Response(
        JSON.stringify({ error: "Unauthorized: provide apikey or x-cron-key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Fetch pending predictions
    const pendingPredictions = await fetchPendingPredictions(deviceId);
    console.log(`Found ${pendingPredictions.length} pending predictions`);

    if (pendingPredictions.length === 0) {
      const elapsed = Date.now() - startTime;
      return new Response(
        JSON.stringify({ success: true, message: "Aucune prédiction en attente", verified: 0, elapsed }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch results from ALL leagues in parallel
    const resultsMap = await fetchAllResults();

    // 3. Compare and update predictions
    const { correct, incorrect, failed } = await verifyPredictions(pendingPredictions, resultsMap);

    const elapsed = Date.now() - startTime;
    console.log(`Done in ${elapsed}ms | Mode: ${callerMode}`);

    return new Response(
      JSON.stringify({
        success: true,
        mode: callerMode,
        verified: correct + incorrect,
        correct,
        incorrect,
        failedUpdates: failed,
        stillPending: pendingPredictions.length - correct - incorrect,
        totalResults: resultsMap.size,
        elapsed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("verify-predictions error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
