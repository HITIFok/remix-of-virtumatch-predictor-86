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

    const { league, auto } = await req.json();

    if (!league) {
      return new Response(
        JSON.stringify({ error: "league parameter is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch odds from external API
    const apiKey = Deno.env.get("HIGH FLYER") || Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      console.error("[scrape-odds] No API key configured");
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Map league names to API-Football league IDs
    const leagueMap: Record<string, number> = {
      "English League": 39,
      "Spanish League": 140,
      "Italian League": 135,
      "German League": 78,
      "French League": 61,
    };

    const apiLeagueId = leagueMap[league];
    if (!apiLeagueId) {
      return new Response(
        JSON.stringify({ error: `Unknown league: ${league}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch upcoming fixtures with odds from API-Football
    const oddsUrl = `https://api-football-v1.p.rapidapi.com/v3/odds?league=${apiLeagueId}&season=2024`;
    const response = await fetch(oddsUrl, {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      console.error(`[scrape-odds] API error: ${response.status}`);
      return new Response(
        JSON.stringify({ error: `External API error: ${response.status}` }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.json();
    const scraped_at = new Date().toISOString();

    // Transform and store the odds data
    const matches = (data.response || []).map(
      (item: Record<string, unknown>) => {
        const fixture = item.fixture || {};
        const teams = item.teams || {};
        const values = (item.values || [])[0] || {};
        const oddValues = values.values || [];

        return {
          league,
          home_team: teams.home?.name,
          away_team: teams.away?.name,
          home_logo: teams.home?.logo,
          away_logo: teams.away?.logo,
          home_odds:
            oddValues.find(
              (o: Record<string, unknown>) => o.value === "Home"
            )?.odd || null,
          draw_odds:
            oddValues.find(
              (o: Record<string, unknown>) => o.value === "Draw"
            )?.odd || null,
          away_odds:
            oddValues.find(
              (o: Record<string, unknown>) => o.value === "Away"
            )?.odd || null,
          match_date: fixture.date,
          match_time: fixture.timestamp,
          match_id: String(fixture.id),
          scraped_at,
        };
      }
    );

    // Store in database
    if (matches.length > 0) {
      const { error } = await supabase.from("scraped_data").upsert(matches, {
        onConflict: "league,home_team,away_team,match_date",
      });

      if (error) {
        console.error("[scrape-odds] Database error:", error);
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
        league,
        scraped: matches.length,
        scraped_at,
        auto: !!auto,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[scrape-odds] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
