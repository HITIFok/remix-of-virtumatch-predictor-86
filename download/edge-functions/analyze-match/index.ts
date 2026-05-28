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
    headers["Access-Control-Allow-Origin"] = "*";
  }

  return headers;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

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

    const { match_id, league, home_team, away_team, home_stats, away_stats, analysis } =
      await req.json();

    if (!match_id || !league) {
      return new Response(
        JSON.stringify({ error: "match_id and league are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Store analysis results
    const { data, error } = await supabase
      .from("match_analysis")
      .upsert(
        {
          match_id,
          league,
          home_team,
          away_team,
          home_stats: home_stats || {},
          away_stats: away_stats || {},
          analysis: analysis || {},
          analyzed_at: new Date().toISOString(),
        },
        { onConflict: "match_id" }
      );

    if (error) {
      console.error("[analyze-match] Upsert error:", error);
      return new Response(
        JSON.stringify({ error: `Database error: ${error.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        match_id,
        analysis: data,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[analyze-match] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
