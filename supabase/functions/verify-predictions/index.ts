// verify-predictions/index.ts — Supabase Edge Function
// Verifies pending predictions by comparing with results
// NO imports — uses Deno.serve() + native fetch
//
// v17: Comprehensive fix
//   - PRIMARY: scraped_data table (match_id + team name matching)
//   - SECONDARY: Always merges direct API results (supplements DB, never skipped)
//   - Triple matching: match_id first, then exact team name, then normalized
//   - Stores verified match_id for future debugging
//   - Logs ALL not-found predictions

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Hardcoded fallback — always available even if env vars are not set
const API_BASE = Deno.env.get("SPORTY_API_BASE") || "https://hg-event-api-prod.sporty-tech.net/api/instantleagues";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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
  "Origin": Deno.env.get("API_ORIGIN") || "https://bet261.mg",
  "Referer": Deno.env.get("API_REFERER") || "https://bet261.mg/",
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "fr-FR,fr;q=0.9",
  "App-Version": Deno.env.get("API_APP_VERSION") || "33335",
};

// ─── Result entry type ───────────────────────────────────────────────────

interface ResultEntry {
  matchId: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  outcome: string;
  league: string;
}

// ─── STRATEGY 1: scraped_data table (PRIMARY) ─────────────────────────────

async function fetchResultsFromDB(): Promise<{ byTeamName: Map<string, ResultEntry>; byMatchId: Map<number, ResultEntry>; count: number; leagues: number }> {
  const byTeamName = new Map<string, ResultEntry>();
  const byMatchId = new Map<number, ResultEntry>();
  let count = 0;
  const seenLeagues = new Set<string>();

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/scraped_data?data_type=eq.results&select=league_id,league,payload,scraped_at&order=scraped_at.desc&limit=30`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!res.ok) {
      console.log(`[verify] DB results fetch failed: ${res.status}`);
      return { byTeamName, byMatchId, count: 0, leagues: 0 };
    }
    const rows = await res.json();
    if (!rows || rows.length === 0) {
      console.log("[verify] No scraped results in DB");
      return { byTeamName, byMatchId, count: 0, leagues: 0 };
    }

    for (const row of rows) {
      const leagueKey = row.league_id || row.league || "";
      if (seenLeagues.has(leagueKey)) continue;
      seenLeagues.add(leagueKey);

      const payload = row.payload;
      if (!Array.isArray(payload)) continue;

      for (const match of payload) {
        const home = match.home || match.homeTeam?.name || "";
        const away = match.away || match.awayTeam?.name || "";
        const homeScore = match.scoreHome ?? match.homeScore ?? 0;
        const awayScore = match.scoreAway ?? match.awayScore ?? 0;
        const matchId = match.id || 0;
        if (!home || !away) continue;

        let outcome: string;
        if (homeScore > awayScore) outcome = "1";
        else if (homeScore < awayScore) outcome = "2";
        else outcome = "X";

        const entry: ResultEntry = { matchId, home, away, homeScore, awayScore, outcome, league: row.league || "Unknown" };
        byTeamName.set(`${home}|${away}`, entry);
        if (matchId) byMatchId.set(matchId, entry);
        count++;
      }
    }
    console.log(`[verify] DB: ${count} results from ${seenLeagues.size} leagues`);
  } catch (err: any) {
    console.log(`[verify] DB error: ${err.message}`);
  }
  return { byTeamName, byMatchId, count, leagues: seenLeagues.size };
}

// ─── STRATEGY 2: Direct API (ALWAYS runs — supplements DB) ────────────────

async function fetchResultsFromAPI(): Promise<{ byTeamName: Map<string, ResultEntry>; byMatchId: Map<number, ResultEntry>; count: number }> {
  const byTeamName = new Map<string, ResultEntry>();
  const byMatchId = new Map<number, ResultEntry>();

  const allResults = await Promise.all(LEAGUES.map(l => fetchLeagueResults(l.id, l.name)));

  for (const leagueResults of allResults) {
    for (const entry of leagueResults) {
      byTeamName.set(`${entry.home}|${entry.away}`, entry);
      if (entry.matchId) byMatchId.set(entry.matchId, entry);
    }
  }

  console.log(`[verify] API: ${byTeamName.size} results total`);
  return { byTeamName, byMatchId, count: byTeamName.size };
}

async function fetchLeagueResults(leagueId: string, leagueName: string): Promise<ResultEntry[]> {
  const results: ResultEntry[] = [];
  try {
    const response = await fetch(`${API_BASE}/${leagueId}/results?skip=0&take=200`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.log(`[verify] API League ${leagueId}: ${response.status}`);
      return results;
    }
    const data = await response.json();
    if (data?.rounds) {
      for (const roundData of data.rounds) {
        for (const match of (roundData.matches || [])) {
          const home = match.homeTeam?.name;
          const away = match.awayTeam?.name;
          const score = match.score || "0:0";
          const parts = score.split(":");
          const homeScore = parseInt(parts[0]) || 0;
          const awayScore = parseInt(parts[1]) || 0;
          let outcome: string;
          if (homeScore > awayScore) outcome = "1";
          else if (homeScore < awayScore) outcome = "2";
          else outcome = "X";
          if (home && away) {
            results.push({
              matchId: match.id || 0, home, away, homeScore, awayScore,
              outcome, league: leagueName,
            });
          }
        }
      }
    }
    console.log(`[verify] API League ${leagueId}: ${results.length} results`);
  } catch (err: any) {
    console.log(`[verify] API League ${leagueId}: ${err.message}`);
  }
  return results;
}

// ─── MERGE: DB + API → combined maps ────────────────────────────────────────

function mergeResults(
  db: { byTeamName: Map<string, ResultEntry>; byMatchId: Map<number, ResultEntry> },
  api: { byTeamName: Map<string, ResultEntry>; byMatchId: Map<number, ResultEntry> }
): { byTeamName: Map<string, ResultEntry>; byMatchId: Map<number, ResultEntry>; sources: string } {
  const byTeamName = new Map<string, ResultEntry>(db.byTeamName);
  const byMatchId = new Map<number, ResultEntry>(db.byMatchId);
  let apiAdded = 0;

  // API supplements DB — only add entries not already in DB
  for (const [key, entry] of api.byTeamName) {
    if (!byTeamName.has(key)) {
      byTeamName.set(key, entry);
      apiAdded++;
    }
  }
  for (const [key, entry] of api.byMatchId) {
    if (!byMatchId.has(key)) {
      byMatchId.set(key, entry);
    }
  }

  const sources = db.count > 0
    ? `db(${db.count})+api(+${apiAdded})`
    : `api(${api.count})`;

  return { byTeamName, byMatchId, sources };
}

// ─── MATCHING: match_id → exact name → normalized name ────────────────────

function normalizeTeam(name: string): string {
  return (name || "").toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
}

function findMatch(
  pred: any,
  byMatchId: Map<number, ResultEntry>,
  byTeamName: Map<string, ResultEntry>
): { result: ResultEntry; method: string } | null {
  // 1. Match by match_id (most reliable)
  if (pred.match_id && byMatchId.has(pred.match_id)) {
    return { result: byMatchId.get(pred.match_id)!, method: "match_id" };
  }

  // 2. Exact team name match
  const exactKey = `${pred.home_team}|${pred.away_team}`;
  if (byTeamName.has(exactKey)) {
    return { result: byTeamName.get(exactKey)!, method: "exact_name" };
  }

  // 3. Normalized team name match
  const normHome = normalizeTeam(pred.home_team);
  const normAway = normalizeTeam(pred.away_team);
  for (const [key, value] of byTeamName) {
    const [rHome, rAway] = key.split("|");
    if (normalizeTeam(rHome) === normHome && normalizeTeam(rAway) === normAway) {
      return { result: value, method: "normalized_name" };
    }
  }

  return null;
}

// ─── FETCH PENDING PREDICTIONS ───────────────────────────────────────────

async function fetchPendingPredictions(deviceId?: string): Promise<any[]> {
  let url = `${SUPABASE_URL}/rest/v1/predictions?status=eq.pending&order=created_at.asc&limit=200`;
  if (deviceId) {
    url += `&device_id=eq.${encodeURIComponent(deviceId)}`;
  }
  const dbRes = await fetch(url, {
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
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

// ─── MAIN HANDLER ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("=== verify-predictions v17 ===");

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

    // 2. Fetch results from BOTH sources and merge (no short-circuit!)
    const [db, api] = await Promise.all([
      fetchResultsFromDB(),
      fetchResultsFromAPI(),
    ]);
    const merged = mergeResults(db, api);
    console.log(`[verify] Merged results: ${merged.byTeamName.size} team-matches, ${merged.byMatchId.size} match-ids (source: ${merged.sources})`);

    if (merged.byTeamName.size === 0 && merged.byMatchId.size === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Aucun résultat disponible", verified: 0, pending: pendingPredictions.length, elapsed: Date.now() - startTime }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Match and update predictions
    let correct = 0, incorrect = 0, notFound = 0;
    const matchMethods = { match_id: 0, exact_name: 0, normalized_name: 0 };
    const updates: Promise<any>[] = [];

    for (const pred of pendingPredictions) {
      const matched = findMatch(pred, merged.byMatchId, merged.byTeamName);
      if (matched) {
        matchMethods[matched.method as keyof typeof matchMethods]++;
        const isCorrect = pred.prediction === matched.result.outcome;
        const status = isCorrect ? "correct" : "incorrect";
        if (isCorrect) correct++; else incorrect++;

        updates.push(
          fetch(`${SUPABASE_URL}/rest/v1/predictions?id=eq.${pred.id}`, {
            method: "PATCH",
            headers: {
              "apikey": SUPABASE_SERVICE_KEY,
              "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal",
            },
            body: JSON.stringify({
              actual_home_score: matched.result.homeScore,
              actual_away_score: matched.result.awayScore,
              actual_outcome: matched.result.outcome,
              actual_score: `${matched.result.homeScore}:${matched.result.awayScore}`,
              status,
              verified_at: new Date().toISOString(),
            }),
          })
        );
        console.log(`${isCorrect ? "OK" : "NO"} [${matched.method}] ${pred.home_team} vs ${pred.away_team}: pred=${pred.prediction} actual=${matched.result.outcome} (${matched.result.homeScore}-${matched.result.awayScore})`);
      } else {
        notFound++;
        // Log ALL not-found predictions (no truncation)
        console.log(`[verify] NOT FOUND: ${pred.home_team} vs ${pred.away_team} | league=${pred.league} | match_id=${pred.match_id || "none"} | created=${pred.created_at}`);
      }
    }

    // 4. Execute all updates in parallel
    const settled = await Promise.allSettled(updates);
    const failedUpdates = settled.filter(r => r.status === "rejected").length;

    const elapsed = Date.now() - startTime;
    console.log(`[verify] Done: ${correct} OK, ${incorrect} NO, ${notFound} notFound, ${failedUpdates} failed (${elapsed}ms)`);
    console.log(`[verify] Match methods: match_id=${matchMethods.match_id} exact=${matchMethods.exact_name} normalized=${matchMethods.normalized_name}`);

    return new Response(
      JSON.stringify({
        success: true,
        mode: callerMode,
        source: merged.sources,
        verified: updates.length,
        correct, incorrect,
        notFound,
        failedUpdates,
        matchMethods,
        stillPending: pendingPredictions.length - updates.length,
        totalResults: merged.byTeamName.size,
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
