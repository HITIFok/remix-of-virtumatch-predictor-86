// verify-predictions/index.ts — Supabase Edge Function
// Verifies pending predictions by comparing with results
// NO imports — uses Deno.serve() + native fetch
//
// v16: Dual source strategy
//   - PRIMARY: scraped_data table (populated by auto-scrape every 2min)
//   - FALLBACK: direct bet261 API calls
// Two modes:
//   - CRON (x-cron-key): verifies ALL pending predictions (up to 200)
//   - CLIENT (apikey): verifies pending predictions (optionally filtered by deviceId)

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Hardcoded fallback — always available even if env vars are not set
const API_BASE = Deno.env.get("SPORTY_API_BASE") || "https://hg-event-api-prod.sporty-tech.net/api/instantleagues";

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

// Headers for bet261 API — with fallback values
const HEADERS: Record<string, string> = {
  "Origin": Deno.env.get("API_ORIGIN") || "https://bet261.mg",
  "Referer": Deno.env.get("API_REFERER") || "https://bet261.mg/",
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "fr-FR,fr;q=0.9",
  "App-Version": Deno.env.get("API_APP_VERSION") || "33335",
};

// ─── STRATEGY 1: Read results from scraped_data table (PRIMARY) ──────────────

async function fetchResultsFromDB(): Promise<Map<string, { homeScore: number; awayScore: number; outcome: string; league: string }>> {
  const resultsMap = new Map();
  try {
    const res = await fetch(
      `${DATABASE_URL}/rest/v1/scraped_data?data_type=eq.results&select=league_id,league,payload,scraped_at&order=scraped_at.desc&limit=30`,
      {
        headers: {
          "apikey": DATABASE_SERVICE_KEY,
          "Authorization": `Bearer ${DATABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!res.ok) {
      console.log(`[verify] DB results fetch failed: ${res.status}`);
      return resultsMap;
    }
    const rows = await res.json();
    if (!rows || rows.length === 0) {
      console.log("[verify] No scraped results in DB");
      return resultsMap;
    }

    // Deduplicate by league (keep most recent per league)
    const seenLeagues = new Set<string>();
    let totalResults = 0;

    for (const row of rows) {
      if (seenLeagues.has(row.league_id)) continue;
      seenLeagues.add(row.league_id);

      const payload = row.payload;
      if (!Array.isArray(payload)) continue;

      for (const match of payload) {
        const homeTeam = match.home || match.homeTeam?.name || "";
        const awayTeam = match.away || match.awayTeam?.name || "";
        const homeScore = match.scoreHome ?? match.homeScore ?? 0;
        const awayScore = match.scoreAway ?? match.awayScore ?? 0;
        if (!homeTeam || !awayTeam) continue;

        let outcome: string;
        if (homeScore > awayScore) outcome = "1";
        else if (homeScore < awayScore) outcome = "2";
        else outcome = "X";

        resultsMap.set(`${homeTeam}|${awayTeam}`, { homeScore, awayScore, outcome, league: row.league || "Unknown" });
        totalResults++;
      }
    }
    console.log(`[verify] DB results: ${totalResults} from ${seenLeagues.size} leagues`);
  } catch (err: any) {
    console.log(`[verify] DB error: ${err.message}`);
  }
  return resultsMap;
}

// ─── STRATEGY 2: Fetch directly from bet261 API (FALLBACK) ───────────────

async function fetchResultsFromAPI(): Promise<Map<string, { homeScore: number; awayScore: number; outcome: string; league: string }>> {
  const allResults = await Promise.all(LEAGUES.map(l => fetchLeagueResults(l.id, l.name)));
  const resultsMap = new Map();
  for (const leagueResults of allResults) {
    for (const [key, value] of leagueResults) {
      resultsMap.set(key, value);
    }
  }
  console.log(`[verify] API results: ${resultsMap.size} total`);
  return resultsMap;
}

async function fetchLeagueResults(leagueId: string, leagueName: string): Promise<Map<string, { homeScore: number; awayScore: number; outcome: string; league: string }>> {
  const resultsMap = new Map();
  try {
    const response = await fetch(`${API_BASE}/${leagueId}/results?skip=0&take=200`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.log(`[verify] API League ${leagueId}: ${response.status}`);
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
            resultsMap.set(`${homeTeam}|${awayTeam}`, { homeScore, awayScore, outcome, league: leagueName });
          }
        }
      }
    }
    console.log(`[verify] API League ${leagueId}: ${resultsMap.size} results`);
  } catch (err: any) {
    console.log(`[verify] API League ${leagueId}: ${err.message}`);
  }
  return resultsMap;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────

/** Normalize team name for fuzzy matching */
function normalizeTeam(name: string): string {
  return (name || "").toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
}

/** Find best match for a prediction in results (exact → normalized) */
function findMatch(home: string, away: string, resultsMap: Map<string, any>): { key: string; result: any } | null {
  // Exact match
  const exactKey = `${home}|${away}`;
  if (resultsMap.has(exactKey)) {
    return { key: exactKey, result: resultsMap.get(exactKey) };
  }
  // Normalized match (handles slight name variations)
  const normHome = normalizeTeam(home);
  const normAway = normalizeTeam(away);
  for (const [key, value] of resultsMap) {
    const [rHome, rAway] = key.split("|");
    if (normalizeTeam(rHome) === normHome && normalizeTeam(rAway) === normAway) {
      return { key, result: value };
    }
  }
  return null;
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
    const errText = await dbRes.text();
    console.error(`[verify] Failed to fetch predictions: ${dbRes.status} ${errText}`);
    return [];
  }
  return await dbRes.json();
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("=== verify-predictions v16 ===");

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
      } catch {
        // Empty body — no device filter
      }
      console.log(`[verify] Mode: CLIENT (device: ${deviceId || "all"})`);
    } else {
      return new Response(
        JSON.stringify({ error: "Unauthorized: provide apikey or x-cron-key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Fetch pending predictions
    const pendingPredictions = await fetchPendingPredictions(deviceId);
    console.log(`[verify] Found ${pendingPredictions.length} pending predictions`);

    // Log samples for debugging
    for (let i = 0; i < Math.min(3, pendingPredictions.length); i++) {
      const p = pendingPredictions[i];
      console.log(`[verify]   Sample: ${p.home_team} vs ${p.away_team} (${p.league}) pred=${p.prediction} created=${p.created_at}`);
    }

    if (pendingPredictions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Aucune prédiction en attente", verified: 0, elapsed: Date.now() - startTime }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch results — Strategy 1: scraped_data table (primary)
    let resultsMap = await fetchResultsFromDB();
    let source = "db";

    // 3. Fallback: direct API if DB is empty
    if (resultsMap.size === 0) {
      console.log("[verify] DB empty, falling back to direct API...");
      resultsMap = await fetchResultsFromAPI();
      source = "api";
    }

    console.log(`[verify] Total results: ${resultsMap.size} (source: ${source})`);

    if (resultsMap.size === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Aucun résultat disponible pour vérification", verified: 0, pending: pendingPredictions.length, source, elapsed: Date.now() - startTime }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Compare and update predictions
    let correct = 0, incorrect = 0, notFound = 0;
    const updates: Promise<any>[] = [];

    for (const pred of pendingPredictions) {
      const match = findMatch(pred.home_team, pred.away_team, resultsMap);
      if (match) {
        const isCorrect = pred.prediction === match.result.outcome;
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
              actual_home_score: match.result.homeScore,
              actual_away_score: match.result.awayScore,
              actual_outcome: match.result.outcome,
              actual_score: `${match.result.homeScore}:${match.result.awayScore}`,
              status,
              verified_at: new Date().toISOString(),
            }),
          })
        );
        console.log(`${isCorrect ? "OK" : "NO"} ${pred.home_team} vs ${pred.away_team}: pred=${pred.prediction} actual=${match.result.outcome} (${match.result.homeScore}-${match.result.awayScore})`);
      } else {
        notFound++;
        if (notFound <= 5) {
          console.log(`[verify] NOT FOUND: ${pred.home_team} vs ${pred.away_team} (${pred.league})`);
        }
      }
    }

    // 5. Execute updates in parallel
    const settled = await Promise.allSettled(updates);
    const failedUpdates = settled.filter(r => r.status === "rejected").length;

    const elapsed = Date.now() - startTime;
    console.log(`[verify] Done: ${correct} OK, ${incorrect} NO, ${notFound} notFound, ${failedUpdates} failed (${elapsed}ms)`);

    return new Response(
      JSON.stringify({
        success: true,
        mode: callerMode,
        source,
        verified: updates.length,
        correct, incorrect,
        notFound,
        failedUpdates,
        stillPending: pendingPredictions.length - updates.length,
        totalResults: resultsMap.size,
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
