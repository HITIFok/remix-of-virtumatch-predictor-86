// scrape-odds/index.ts — Supabase Edge Function
// Reads cached scraped data from scraped_data table (pushed by auto-scrape)
// NO imports — uses Deno.serve() + native fetch

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const DATABASE_URL = Deno.env.get("DATABASE_URL") || "";
const DATABASE_SERVICE_KEY = Deno.env.get("DATABASE_SERVICE_KEY") || "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Verification : requete doit provenir du frontend (apikey header)
    // Validate that the apikey matches the anon key (not just presence)
    const apiKey = req.headers.get("apikey");
    const ANON_KEY = Deno.env.get("DATABASE_ANON_KEY") || "";
    if (!apiKey || (ANON_KEY && apiKey !== ANON_KEY)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or missing apikey" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const leagueSlug = body.league || "";

    // Read cached data from scraped_data
    const leagueFilter = leagueSlug ? `&league=eq.${encodeURIComponent(leagueSlug)}` : "";
    const res = await fetch(
      `${DATABASE_URL}/rest/v1/scraped_data?select=*&order=scraped_at.desc${leagueFilter}`,
      {
        headers: {
          "apikey": DATABASE_SERVICE_KEY,
          "Authorization": `Bearer ${DATABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error(`DB error: ${err}`);
      return new Response(
        JSON.stringify({ success: false, error: "Database error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rows = await res.json();

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Aucune donnée disponible. Le cron auto-scrape va les créer.",
          noData: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract latest data by type
    const getPayload = (type: string): any[] => {
      const row = rows.find((r: any) => r.data_type === type);
      return row?.payload && Array.isArray(row.payload) ? row.payload : [];
    };

    const matches = getPayload("matches");
    const results = getPayload("results");
    const ranking = getPayload("ranking");
    const scrapedAt = rows[0]?.scraped_at || new Date().toISOString();

    return new Response(
      JSON.stringify({
        success: true,
        matches,
        results,
        ranking,
        scrapedAt,
        source: "auto-scrape-cron",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("scrape-odds error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
