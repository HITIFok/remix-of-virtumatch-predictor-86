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

    // Verify cron secret for security (only cron jobs should trigger this)
    const cronSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization");
    const providedKey = authHeader?.replace("Bearer ", "");

    if (cronSecret && providedKey !== cronSecret) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: invalid cron key" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Trigger scraping for all configured leagues
    const leagues = [
      "English League",
      "Spanish League",
      "Italian League",
      "German League",
      "French League",
    ];

    const results: Record<string, unknown>[] = [];

    for (const league of leagues) {
      try {
        // Call the scrape-odds function internally
        const scrapeUrl = `${supabaseUrl}/functions/v1/scrape-odds`;
        const response = await fetch(scrapeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || supabaseKey}`,
          },
          body: JSON.stringify({ league, auto: true }),
        });

        const data = await response.json();
        results.push({ league, status: response.status, ...data });
      } catch (err) {
        console.error(`[auto-scrape] Failed for ${league}:`, err);
        results.push({ league, status: "error", error: String(err) });
      }
    }

    const succeeded = results.filter((r) => r.status === 200).length;
    const failed = results.length - succeeded;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Auto-scrape completed: ${succeeded} succeeded, ${failed} failed`,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[auto-scrape] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
