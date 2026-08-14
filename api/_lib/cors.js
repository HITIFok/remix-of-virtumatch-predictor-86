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
    return envOrigins.split(',').map(s => s.trim()).filter(Boolean);
  }
  return DEFAULT_ORIGINS;
}

const ALLOWED_ORIGINS = parseAllowedOrigins();

export function isOriginAllowed(origin, reqHost) {
  // 1. Exact match against allowed list
  if (ALLOWED_ORIGINS.includes(origin)) return true;

  // 2. Same hostname as the Vercel deployment host (self-referencing)
  try {
    const originHost = new URL(origin).hostname;
    if (originHost === reqHost) return true;
  } catch {}

  // 3. Allow any origin from a Capacitor native app (localhost-based schemes)
  //    - Android with androidScheme: 'https' → https://localhost
  //    - iOS → https://localhost or capacitor://localhost
  //    These are always localhost regardless of port
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost') return true;
  } catch {}

  return false;
}

export function setCorsHeaders(req, res, methods = 'POST, OPTIONS', headers = 'Content-Type, Authorization') {
  const origin = req.headers.origin || '';
  if (isOriginAllowed(origin, req.headers.host || '')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);
  res.setHeader('Access-Control-Max-Age', '86400');
}
