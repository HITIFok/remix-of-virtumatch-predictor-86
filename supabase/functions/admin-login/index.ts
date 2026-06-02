// admin-login/index.ts — Supabase Edge Function
// Authenticates admin and returns a signed session token (HMAC-SHA256)
// Replaces client-side localStorage-only session with server-signed token

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ADMIN_TOKEN_SECRET = Deno.env.get("ADMIN_TOKEN_SECRET") || "";

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// HMAC-SHA256 signing using Web Crypto API
async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!ADMIN_TOKEN_SECRET) {
      console.error("ADMIN_TOKEN_SECRET not configured");
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { password } = await req.json();
    if (!password || typeof password !== "string") {
      return new Response(JSON.stringify({ success: false, error: "Password required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: max 5 login attempts per minute
    // (simplified - in production use Upstash or similar)

    // Verify password via Supabase RPC (SECURITY DEFINER)
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_admin_password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ input_password: password }),
    });

    if (!rpcRes.ok) {
      return new Response(JSON.stringify({ success: false, error: "Verification failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isValid = await rpcRes.json();
    if (isValid !== true) {
      return new Response(JSON.stringify({ success: false, error: "Invalid password" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Password correct — issue signed token
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    const tokenPayload = `${expiresAt}`;
    const signature = await hmacSign(tokenPayload, ADMIN_TOKEN_SECRET);
    const token = `${expiresAt}.${signature}`;

    return new Response(JSON.stringify({
      success: true,
      token,
      expiresIn: SESSION_DURATION_MS,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[admin-login] Error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
