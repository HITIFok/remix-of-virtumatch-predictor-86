// Shared CORS configuration for all API routes
// Origines autorisées : lues depuis ALLOWED_ORIGINS env var (comma-separated)
// Fallback : localhost uniquement (dev mode)

const DEFAULT_ORIGINS = [
  'https://localhost',
  'capacitor://localhost',
  'http://localhost',
  'http://localhost:5173',
  'http://localhost:4173',
  // Capacitor Android with androidScheme: 'https' → origin is https://localhost
  // Capacitor iOS with ios.scheme: 'https' → same
];

function parseAllowedOrigins() {
  const envOrigins = process.env.ALLOWED_ORIGINS;
  if (envOrigins) {
    // Phase 5.3.54 — MERGE env var with DEFAULT_ORIGINS instead of overriding.
    // Previously this branch returned ONLY the env var list, completely
    // shadowing DEFAULT_ORIGINS. The production ALLOWED_ORIGINS env var is
    // typically set to the Vercel production URL + maybe capacitor://localhost
    // but does NOT include 'https://localhost' (the Capacitor WebView origin
    // when capacitor.config.ts uses `androidScheme: 'https'`). This caused
    // CORS preflight to omit Access-Control-Allow-Origin for the APK origin,
    // blocking all /api/* POST requests from the APK (including /api/fetch-live
    // which the Matches tab depends on) — manifesting as the runtime error
    // "Les données en direct pour English League ne sont pas disponibles".
    //
    // Fix: Capacitor native app origins are LEGITIMATE origins that must
    // always be allowed regardless of env var configuration. The env var
    // remains the authority for ADDITIONAL origins (e.g., preview deployments,
    // staging URLs) but cannot be used to DENY the native app origins.
    const envList = envOrigins.split(',').map(s => s.trim()).filter(Boolean);
    return [...new Set([...envList, ...DEFAULT_ORIGINS])];
  }
  return DEFAULT_ORIGINS;
}

const ALLOWED_ORIGINS = parseAllowedOrigins();

export function isOriginAllowed(origin, reqHost, reqHeaders) {
  // ── V-02 FIX: x-capacitor-request bypass REMOVED ─────────────────────
  // Previously, the presence of x-capacitor-request header caused this
  // function to return true unconditionally, bypassing all origin checks.
  // This was exploitable: any HTTP client (curl, fetch on evil.com) could
  // send this header and bypass CORS protection entirely.
  //
  // FIX: Native Capacitor apps now authenticate via HMAC device tokens
  // (Authorization: Device <token>). The token is verified by requireAuth()
  // independently of CORS. The Capacitor origin (capacitor://localhost or
  // https://localhost) is already in ALLOWED_ORIGINS, so legitimate native
  // requests pass the origin check normally.
  //
  // If a Capacitor app sends a request WITHOUT a valid origin (e.g., some
  // Android WebView configurations), the HMAC token still authenticates the
  // request at the handler level. CORS is a browser-enforced mechanism and
  // does not apply to native HTTP clients (curl, Capacitor HTTP plugin).

  // 1. Exact match against allowed list (includes capacitor://localhost)
  if (ALLOWED_ORIGINS.includes(origin)) return true;

  // 2. Same hostname as the Vercel deployment host (self-referencing)
  try {
    const originHost = new URL(origin).hostname;
    if (originHost === reqHost) return true;
  } catch {}

  return false;
}

export function setCorsHeaders(req, res, methods = 'POST, OPTIONS', headers = 'Content-Type, Authorization, x-device-id') {
  const origin = req.headers.origin || '';
  if (isOriginAllowed(origin, req.headers.host || '', req.headers)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);
  res.setHeader('Access-Control-Max-Age', '3600'); // 1h (was 24h — faster security fix propagation)
  res.setHeader('Vary', 'Origin'); // Prevent CDN cache poisoning between origins
}
