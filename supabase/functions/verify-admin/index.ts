// verify-admin/index.ts — Supabase Edge Function
// Validates an admin session token (HMAC-SHA256 signed)
// Use this before any admin-only operation

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_TOKEN_SECRET = Deno.env.get("ADMIN_TOKEN_SECRET") || "";

// HMAC-SHA256 verification
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
      return new Response(JSON.stringify({ valid: false, error: "Method not allowed" }), {
        status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!ADMIN_TOKEN_SECRET) {
      console.error("ADMIN_TOKEN_SECRET not configured");
      return new Response(JSON.stringify({ valid: false, error: "Server not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { token } = await req.json();

    if (!token || typeof token !== "string") {
      return new Response(JSON.stringify({ valid: false, error: "Token required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse token: "expiresAt.signature"
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex === -1) {
      return new Response(JSON.stringify({ valid: false, error: "Invalid token format" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiresAtStr = token.substring(0, dotIndex);
    const signature = token.substring(dotIndex + 1);

    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt)) {
      return new Response(JSON.stringify({ valid: false, error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check expiration
    if (Date.now() > expiresAt) {
      return new Response(JSON.stringify({ valid: false, error: "Token expired" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify HMAC signature
    const expectedSig = await hmacSign(expiresAtStr, ADMIN_TOKEN_SECRET);
    if (signature !== expectedSig) {
      return new Response(JSON.stringify({ valid: false, error: "Invalid signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      valid: true,
      expiresAt,
      remainingMs: expiresAt - Date.now(),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[verify-admin] Error:", error);
    return new Response(JSON.stringify({ valid: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
