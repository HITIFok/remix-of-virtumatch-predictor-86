// verify-predictions/index.ts — Supabase Edge Function
// Verifies pending predictions by comparing with API results
// NO imports — uses Deno.serve() + native fetch

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_BASE = Deno.env.get("SPORTY_API_BASE") || "";
if (!API_BASE) {
  console.error("SPORTY_API_BASE not configured");
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  console.log("=== verify-predictions called ===");

  try {
    // 1. Fetch pending predictions from DB
    const dbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/predictions?status=eq.pending&order=created_at.asc&limit=100`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (!dbRes.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch predictions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const pendingPredictions = await dbRes.json();
    console.log(`Found ${pendingPredictions?.length || 0} pending predictions`);

    if (!pendingPredictions || pendingPredictions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Aucune prédiction à vérifier", verified: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch results from ALL leagues in parallel
    const allResults = await Promise.all(LEAGUES.map(l => fetchResults(l.id)));
    const resultsMap = new Map();
    for (const leagueResults of allResults) {
      for (const [key, value] of leagueResults) {
        resultsMap.set(key, value);
      }
    }
    console.log(`Total results: ${resultsMap.size}`);

    // 3. Compare and update predictions
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
          fetch(`${SUPABASE_URL}/rest/v1/predictions?id=eq.${pred.id}`, {
            method: "PATCH",
            headers: {
              "apikey": SUPABASE_SERVICE_KEY,
              "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
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
        console.log(`${isCorrect ? "✅" : "❌"} ${pred.home_team} vs ${pred.away_team}: predicted ${pred.prediction}, actual ${result.outcome}`);
      }
    }

    const settledResults = await Promise.allSettled(updates);
    const failedUpdates = settledResults.filter(r => r.status === "rejected").length;
    console.log(`Verification: ${correct} correct, ${incorrect} incorrect, ${failedUpdates} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        verified: updates.length,
        correct, incorrect, failedUpdates,
        stillPending: pendingPredictions.length - updates.length,
        totalResults: resultsMap.size,
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
