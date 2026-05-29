// check-premium/index.ts — Supabase Edge Function
// Server-side premium access validation
// Prevents client-side tampering with premium status

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ premium: false, error: "Method not allowed" }), {
        status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { device_id } = await req.json();

    if (!device_id || typeof device_id !== "string") {
      return new Response(JSON.stringify({ premium: false, error: "Device ID required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate device_id format: must match dev-timestamp-random pattern
    if (!/^dev-\d+-[a-z0-9]+$/.test(device_id)) {
      return new Response(JSON.stringify({ premium: false, error: "Invalid device ID format" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if this device has a valid access code (not expired)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/access_codes?used_by_device=eq.${encodeURIComponent(device_id)}&used=eq.true&select=used_at,duration_days`,
      {
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    if (!res.ok) {
      return new Response(JSON.stringify({ premium: false, error: "Database error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const codes = await res.json();

    // Check if any code is still valid (within duration)
    const now = Date.now();
    for (const code of codes) {
      if (code.used_at) {
        const usedAt = new Date(code.used_at).getTime();
        const durationMs = (code.duration_days || 0) * 24 * 60 * 60 * 1000;
        const expiresAt = usedAt + durationMs;
        if (now < expiresAt) {
          const remainingDays = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
          return new Response(JSON.stringify({
            premium: true,
            remainingDays,
            expiresAt: new Date(expiresAt).toISOString(),
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    return new Response(JSON.stringify({ premium: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[check-premium] Error:", error);
    return new Response(JSON.stringify({ premium: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
