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

    const body = await req.json();
    const { league, matches, odds_data, scraped_at } = body;

    if (!league || !matches) {
      return new Response(
        JSON.stringify({ error: "league and matches are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Upsert odds data into the scraped_data table
    const records = (matches || []).map((match: Record<string, unknown>) => ({
      league,
      home_team: match.home_team || match.home,
      away_team: match.away_team || match.away,
      home_odds: match.home_odds || match.odds_home || match.home_win,
      draw_odds: match.draw_odds || match.odds_draw || match.draw,
      away_odds: match.away_odds || match.odds_away || match.away_win,
      match_time: match.match_time || match.kickoff || match.time,
      match_date: match.match_date || match.date,
      scraped_at: scraped_at || new Date().toISOString(),
      ...(odds_data ? { raw_data: odds_data } : {}),
      ...(match.match_id ? { match_id: match.match_id } : {}),
      ...(match.id ? { id: match.id } : {}),
    }));

    if (records.length > 0) {
      const { error } = await supabase
        .from("scraped_data")
        .upsert(records, { onConflict: "league,home_team,away_team,match_date" });

      if (error) {
        console.error("[push-odds] Upsert error:", error);
        return new Response(
          JSON.stringify({ error: `Database error: ${error.message}` }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: records.length,
        league,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[push-odds] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
