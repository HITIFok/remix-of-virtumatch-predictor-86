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

export function isOriginAllowed(origin, reqHost, reqHeaders) {
  // 0. Capacitor native app: custom header that browsers never send
  if (reqHeaders?.['x-capacitor-request']) return true;

  // 1. Exact match against allowed list
  if (ALLOWED_ORIGINS.includes(origin)) return true;

  // 2. Same hostname as the Vercel deployment host (self-referencing)
  try {
    const originHost = new URL(origin).hostname;
    if (originHost === reqHost) return true;
  } catch {}

  // NOTE: Previously allowed any origin with hostname='localhost'.
  // Removed: this enabled CORS bypass from any website by spoofing Origin.
  // Capacitor apps now use a custom X-Capacitor-Request header instead.

  return false;
}

export function setCorsHeaders(req, res, methods = 'POST, OPTIONS', headers = 'Content-Type, Authorization') {
  const origin = req.headers.origin || '';
  if (isOriginAllowed(origin, req.headers.host || '', req.headers)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);
  res.setHeader('Access-Control-Max-Age', '3600'); // 1h (was 24h — faster security fix propagation)
  res.setHeader('Vary', 'Origin'); // Prevent CDN cache poisoning between origins
}
