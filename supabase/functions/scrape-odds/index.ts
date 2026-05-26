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
    const body = await req.json().catch(() => ({}));
    const leagueSlug = body.league || "";

    // Read cached data from DB (pushed by local scraper)
    const supabaseUrl = Deno.env.get("DATABASE_URL")!;
    const supabaseKey = Deno.env.get("DATABASE_SERVICE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: rows, error: dbError } = await supabase
      .from("scraped_data")
      .select("*")
      .eq("league", leagueSlug)
      .order("scraped_at", { ascending: false });

    if (dbError) {
      console.error("[scrape-odds] DB error:", dbError);
      throw new Error(dbError.message);
    }

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Aucune donnée disponible. Lancez le scraper local depuis Madagascar.",
          noData: true,
          hint: "Exécutez scripts/scraper-local.py depuis un PC à Madagascar pour alimenter l'app.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get latest data by type
    const getPayload = (type: string) => {
      const row = rows.find((r: any) => r.data_type === type);
      return row ? (Array.isArray(row.payload) ? row.payload : []) : [];
    };

    const matches = getPayload("matches");
    const results = getPayload("results");
    const ranking = getPayload("ranking");

    const latestRow = rows[0];
    const scrapedAt = latestRow?.scraped_at || new Date().toISOString();

    return new Response(
      JSON.stringify({
        success: true,
        matches,
        results,
        ranking,
        scrapedAt,
        source: "local-scraper",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Scrape error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Erreur inconnue" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
