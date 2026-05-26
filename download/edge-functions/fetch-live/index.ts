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
    // Support both GET and POST
    let leagueId: string | null = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      leagueId = url.searchParams.get("leagueId") || url.searchParams.get("league");
    } else if (req.method === "POST") {
      const body = await req.json();
      leagueId = body.leagueId || body.league;
    }

    if (!leagueId) {
      return new Response(
        JSON.stringify({ error: "leagueId parameter is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch live matches from external API
    const apiKey = Deno.env.get("HIGH FLYER") || Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      console.error("[fetch-live] No API key configured");
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const apiUrl = `https://api-football-v1.p.rapidapi.com/v3/fixtures?league=${leagueId}&live=all`;
    const response = await fetch(apiUrl, {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      console.error(`[fetch-live] API error: ${response.status}`);
      return new Response(
        JSON.stringify({ error: `External API error: ${response.status}` }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.json();

    // Transform and return live match data
    const liveMatches = (data.response || []).map(
      (fixture: Record<string, unknown>) => {
        const fixtureData = fixture.fixture || fixture;
        const teams = fixture.teams || {};
        const goals = fixture.goals || {};
        const score = fixture.score || {};

        return {
          id: fixtureData.id,
          league: fixtureData.league,
          home_team: teams.home?.name || teams.home,
          away_team: teams.away?.name || teams.away,
          home_logo: teams.home?.logo,
          away_logo: teams.away?.logo,
          status: fixtureData.status?.short || fixtureData.status,
          home_score: goals.home ?? score.fulltime?.home ?? null,
          away_score: goals.away ?? score.fulltime?.away ?? null,
          minute: fixtureData.status?.elapsed || null,
          match_date: fixtureData.date,
        };
      }
    );

    return new Response(
      JSON.stringify({
        success: true,
        league: leagueId,
        live: liveMatches,
        total: liveMatches.length,
        fetched_at: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[fetch-live] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
