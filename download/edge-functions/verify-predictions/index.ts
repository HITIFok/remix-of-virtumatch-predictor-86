import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

function getCorsHeaders(req: Request): Record<string, string> {
  const requestOrigin = req.headers.get("Origin") || "";
  const allowedFromEnv = Deno.env.get("ALLOWED_ORIGINS");

  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };

  if (allowedFromEnv) {
    const allowedList = allowedFromEnv.split(",").map((o) => o.trim());
    if (allowedList.includes(requestOrigin)) {
      headers["Access-Control-Allow-Origin"] = requestOrigin;
      headers["Vary"] = "Origin";
    }
  } else {
    // Fallback: allow ALL origins if secret is not configured
    headers["Access-Control-Allow-Origin"] = "*";
  }

  return headers;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { predictions } = await req.json();

    if (!predictions || !Array.isArray(predictions)) {
      return new Response(
        JSON.stringify({ error: "predictions array is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify all predictions in parallel with allSettled for resilience
    const results = await Promise.allSettled(
      predictions.map(async (prediction: Record<string, unknown>) => {
        const { id, predicted_home_score, predicted_away_score, league } =
          prediction;

        if (!id) throw new Error("Prediction missing id");

        // Fetch the actual match result
        const { data: matchData, error: matchError } = await supabase
          .from("matches")
          .select("*")
          .eq("id", id)
          .single();

        if (matchError) throw new Error(`Match lookup failed: ${matchError.message}`);
        if (!matchData) throw new Error(`Match ${id} not found`);

        const actualHome = matchData.home_score ?? matchData.home_goals;
        const actualAway = matchData.away_score ?? matchData.away_goals;

        // Determine if prediction was correct
        const predictedHome = Number(predicted_home_score);
        const predictedAway = Number(predicted_away_score);

        let isCorrect = false;
        if (
          !isNaN(predictedHome) &&
          !isNaN(predictedAway) &&
          actualHome !== null &&
          actualHome !== undefined &&
          actualAway !== null &&
          actualAway !== undefined
        ) {
          // Correct if exact score matches
          if (predictedHome === actualHome && predictedAway === actualAway) {
            isCorrect = true;
          }
        }

        return {
          predictionId: id,
          predicted_home: predictedHome,
          predicted_away: predictedAway,
          actual_home: actualHome,
          actual_away: actualAway,
          isCorrect,
          league: league || matchData.league,
        };
      })
    );

    // Process results - log failures but don't crash
    const verified: Record<string, unknown>[] = [];
    const errors: string[] = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        verified.push(result.value);
      } else {
        const reason = result.reason?.message || String(result.reason);
        errors.push(`Prediction ${index}: ${reason}`);
        console.error(`[verify-predictions] Prediction ${index} failed:`, reason);
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        verified,
        total: predictions.length,
        correct: verified.filter((v) => v.isCorrect).length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[verify-predictions] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
