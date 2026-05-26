import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').filter(Boolean);
const DEFAULT_ORIGIN = ''; // Définir votre domaine de production

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : DEFAULT_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-push-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate with push key
    const pushKey = req.headers.get("x-push-key");
    const expectedKey = Deno.env.get("SCRAPER_PUSH_KEY");
    
    if (!expectedKey) {
      return new Response(
        JSON.stringify({ success: false, error: "SCRAPER_PUSH_KEY not configured on server" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (pushKey !== expectedKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid push key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { matches, results, ranking, league } = body;

    if (!matches && !results && !ranking) {
      return new Response(
        JSON.stringify({ success: false, error: "No data provided (matches, results, or ranking required)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("DATABASE_URL")!;
    const supabaseKey = Deno.env.get("DATABASE_SERVICE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const leagueSlug = league || "";
    const now = new Date().toISOString();
    const upserts = [];

    if (Array.isArray(matches)) {
      upserts.push({ data_type: "matches", league: leagueSlug, payload: matches, scraped_at: now });
    }
    if (Array.isArray(results)) {
      upserts.push({ data_type: "results", league: leagueSlug, payload: results, scraped_at: now });
    }
    if (Array.isArray(ranking)) {
      upserts.push({ data_type: "ranking", league: leagueSlug, payload: ranking, scraped_at: now });
    }

    // Delete old data for this league, then insert fresh
    for (const entry of upserts) {
      await supabase
        .from("scraped_data")
        .delete()
        .eq("data_type", entry.data_type)
        .eq("league", entry.league);

      await supabase.from("scraped_data").insert(entry);
    }

    console.log(`[push-odds] Saved: ${matches?.length || 0} matches, ${results?.length || 0} results, ${ranking?.length || 0} ranking for league "${leagueSlug}"`);

    return new Response(
      JSON.stringify({
        success: true,
        saved: {
          matches: matches?.length || 0,
          results: results?.length || 0,
          ranking: ranking?.length || 0,
        },
        timestamp: now,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[push-odds] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
