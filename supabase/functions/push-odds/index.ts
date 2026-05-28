// push-odds/index.ts — Supabase Edge Function
// Receives scraped data from external scraper and stores in scraped_data
// NO imports — uses Deno.serve() + native fetch

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DATABASE_URL = Deno.env.get("DATABASE_URL") || "";
const DATABASE_SERVICE_KEY = Deno.env.get("DATABASE_SERVICE_KEY") || "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Authenticate with push key
    const pushKey = req.headers.get("x-push-key");
    const expectedKey = Deno.env.get("SCRAPER_PUSH_KEY");

    if (!expectedKey) {
      return new Response(
        JSON.stringify({ success: false, error: "SCRAPER_PUSH_KEY not configured" }),
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
        JSON.stringify({ success: false, error: "No data provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const leagueSlug = league || "";
    const now = new Date().toISOString();
    const upserts: Promise<boolean>[] = [];

    if (Array.isArray(matches)) {
      upserts.push(supabasePush("matches", leagueSlug, matches, now));
    }
    if (Array.isArray(results)) {
      upserts.push(supabasePush("results", leagueSlug, results, now));
    }
    if (Array.isArray(ranking)) {
      upserts.push(supabasePush("ranking", leagueSlug, ranking, now));
    }

    const results2 = await Promise.allSettled(upserts);
    const successCount = results2.filter(r => r.status === "fulfilled" && r.value).length;

    return new Response(
      JSON.stringify({
        success: true,
        saved: {
          matches: matches?.length || 0,
          results: results?.length || 0,
          ranking: ranking?.length || 0,
        },
        upserted: successCount,
        timestamp: now,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[push-odds] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function supabasePush(
  dataType: string,
  leagueSlug: string,
  payload: any[],
  scrapedAt: string,
): Promise<boolean> {
  try {
    // Delete old data for this type+league, then insert fresh
    const deleteRes = await fetch(
      `${DATABASE_URL}/rest/v1/scraped_data?data_type=eq.${dataType}&league=eq.${encodeURIComponent(leagueSlug)}`,
      {
        method: "DELETE",
        headers: {
          "apikey": DATABASE_SERVICE_KEY,
          "Authorization": `Bearer ${DATABASE_SERVICE_KEY}`,
        },
      }
    );

    const insertRes = await fetch(`${DATABASE_URL}/rest/v1/scraped_data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": DATABASE_SERVICE_KEY,
        "Authorization": `Bearer ${DATABASE_SERVICE_KEY}`,
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        data_type: dataType,
        league: leagueSlug,
        payload: payload,
        scraped_at: scrapedAt,
      }),
    });

    return insertRes.ok;
  } catch (e: any) {
    console.error(`Push error for ${dataType}:`, e.message);
    return false;
  }
}
