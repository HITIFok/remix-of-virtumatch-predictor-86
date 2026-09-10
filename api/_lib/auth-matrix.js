// API Authorization Matrix
// Phase AE — Complete authorization registry for all API endpoints

/**
 * Auth types used across the system
 */
export const AUTH_TYPES = Object.freeze({
  NONE: 'NONE',
  USER_BEARER: 'USER_BEARER',
  DEVICE_HMAC: 'DEVICE_HMAC',
  ADMIN_BEARER: 'ADMIN_BEARER',
  CRON_KEY: 'CRON_KEY',
  SCRAPER_KEY: 'SCRAPER_KEY',
});

/**
 * Complete API Authorization Matrix
 * Every endpoint, its methods, auth requirements, rate limiting, and CORS status.
 */
export const API_AUTH_MATRIX = Object.freeze([
  {
    endpoint: '/api/predictions',
    methods: ['GET', 'POST', 'DELETE'],
    authRequired: true,
    authTypes: [AUTH_TYPES.USER_BEARER, AUTH_TYPES.DEVICE_HMAC],
    authFallback: 'Device HMAC accepted when User Bearer not present',
    rateLimited: true,
    rateLimit: '30 req/60s per IP',
    corsEnabled: true,
    isPublic: false,
    riskLevel: 'LOW',
    notes: 'Ownership enforced — users can only access their own predictions',
  },
  {
    endpoint: '/api/auth',
    methods: ['GET', 'POST'],
    authRequired: false,
    authTypes: [AUTH_TYPES.NONE],
    authFallback: null,
    rateLimited: true,
    rateLimit: '3 req/15min per email + 3 req/15min per IP (request action only)',
    corsEnabled: true,
    isPublic: true,
    riskLevel: 'LOW',
    notes: 'Email enumeration protection; magic links are single-use, 15-min expiry',
  },
  {
    endpoint: '/api/admin-codes',
    methods: ['GET', 'POST'],
    authRequired: true, // Partial — login/verify are public
    authTypes: [AUTH_TYPES.ADMIN_BEARER],
    authFallback: 'Login (action=login) and verify (action=verify) are public entry points',
    rateLimited: true,
    rateLimit: '5 req/15min per IP (login only)',
    corsEnabled: true,
    isPublic: false, // Management operations require auth
    riskLevel: 'LOW',
    notes: 'Admin operations require Bearer token; origin check on login',
  },
  {
    endpoint: '/api/device-register',
    methods: ['POST'],
    authRequired: false,
    authTypes: [AUTH_TYPES.NONE],
    authFallback: null,
    rateLimited: true,
    rateLimit: '5 req/60s per IP',
    corsEnabled: true,
    isPublic: true,
    riskLevel: 'LOW',
    notes: 'Bootstrapping endpoint — returns device_secret exactly once; 409 for re-registration',
  },
  {
    endpoint: '/api/premium-activate',
    methods: ['GET', 'POST'],
    authRequired: true, // Partial — email POST is public
    authTypes: [AUTH_TYPES.USER_BEARER, AUTH_TYPES.DEVICE_HMAC],
    authFallback: 'POST with email triggers magic link (public); legacy POST requires Device HMAC',
    rateLimited: true,
    rateLimit: '15 req/60min per email/device',
    corsEnabled: true,
    isPublic: false,
    riskLevel: 'LOW',
    notes: 'GET status and legacy activation require auth; email flow delegates to magic link',
  },
  {
    endpoint: '/api/analyze-match',
    methods: ['POST'],
    authRequired: true,
    authTypes: [AUTH_TYPES.USER_BEARER, AUTH_TYPES.DEVICE_HMAC],
    authFallback: null,
    rateLimited: false,
    rateLimit: 'None — protected by middleware.js global rate limit',
    corsEnabled: true,
    isPublic: false,
    riskLevel: 'MEDIUM',
    notes: 'No explicit rate limit; relies on middleware.js 30/min; has 8s timeout guard',
  },
  {
    endpoint: '/api/verify-predictions',
    methods: ['GET', 'POST'],
    authRequired: true,
    authTypes: [AUTH_TYPES.USER_BEARER, AUTH_TYPES.DEVICE_HMAC, AUTH_TYPES.CRON_KEY],
    authFallback: 'Cron mode via x-cron-key header; client mode via Bearer/HMAC',
    rateLimited: false,
    rateLimit: 'None',
    corsEnabled: true,
    isPublic: false,
    riskLevel: 'MEDIUM',
    notes: 'No explicit rate limit; cron key timing-safe; cron mode scans ALL predictions',
  },
  {
    endpoint: '/api/matches',
    methods: ['GET'],
    authRequired: false,
    authTypes: [AUTH_TYPES.NONE],
    authFallback: null,
    rateLimited: false,
    rateLimit: 'None',
    corsEnabled: true,
    isPublic: true,
    riskLevel: 'LOW',
    notes: 'Public match data; SSRF protection via league ID whitelist; 8s timeout',
  },
  {
    endpoint: '/api/fetch-live',
    methods: ['GET', 'POST'],
    authRequired: false,
    authTypes: [AUTH_TYPES.NONE],
    authFallback: null,
    rateLimited: false,
    rateLimit: 'None',
    corsEnabled: true,
    isPublic: true,
    riskLevel: 'LOW',
    notes: 'Public live data; SSRF protection; server-side SPORTY_BEARER never exposed',
  },
  {
    endpoint: '/api/push-odds',
    methods: ['POST'],
    authRequired: true,
    authTypes: [AUTH_TYPES.SCRAPER_KEY],
    authFallback: null,
    rateLimited: false,
    rateLimit: 'None',
    corsEnabled: true,
    isPublic: false,
    riskLevel: 'LOW',
    notes: 'Timing-safe key comparison; data upsert only; no read operations',
  },
  {
    endpoint: '/api/early-alerts',
    methods: ['GET'],
    authRequired: true, // Partial — default GET is public
    authTypes: [AUTH_TYPES.ADMIN_BEARER],
    authFallback: 'Default GET (active alerts) is public; ?all=true requires Admin Bearer',
    rateLimited: false,
    rateLimit: 'None',
    corsEnabled: true,
    isPublic: false, // History requires auth
    riskLevel: 'MEDIUM',
    notes: 'Inline admin verification (not shared _lib/auth.js) — drift risk',
  },
  {
    endpoint: '/api/auto-playout',
    methods: ['GET', 'POST'],
    authRequired: true,
    authTypes: [AUTH_TYPES.CRON_KEY],
    authFallback: null,
    rateLimited: false,
    rateLimit: 'None',
    corsEnabled: false, // Cron-only — no CORS
    isPublic: false,
    riskLevel: 'LOW',
    notes: 'CRON key mandatory; timing-safe comparison; 202 fire-and-forget; no CORS (cron-only)',
  },
  {
    endpoint: '/api/health',
    methods: ['GET'],
    authRequired: false,
    authTypes: [AUTH_TYPES.NONE],
    authFallback: null,
    rateLimited: false,
    rateLimit: 'None',
    corsEnabled: true,
    isPublic: true,
    riskLevel: 'LOW',
    notes: 'Monitoring/uptime endpoint; returns DB status, memory, version',
  },
  {
    endpoint: '/api/account-delete',
    methods: ['POST'],
    authRequired: true,
    authTypes: [AUTH_TYPES.USER_BEARER],
    authFallback: null,
    rateLimited: true,
    rateLimit: '3 req/60min per IP',
    corsEnabled: true,
    isPublic: false,
    riskLevel: 'HIGH',
    notes: 'GDPR Article 17; requires Bearer session + explicit { confirmation: "DELETE" }; cascading deletion of all PII',
  },
  {
    endpoint: '/api/data-cleanup',
    methods: ['POST'],
    authRequired: true,
    authTypes: [AUTH_TYPES.CRON_KEY],
    authFallback: null,
    rateLimited: false,
    rateLimit: 'None',
    corsEnabled: true,
    isPublic: false,
    riskLevel: 'MEDIUM',
    notes: 'GDPR data retention cron; requires CRON_SECRET; deletes expired magic_links (30d) + old predictions (365d)',
  },
  {
    endpoint: '/api/refresh-token',
    methods: ['POST'],
    authRequired: true,
    authTypes: [AUTH_TYPES.USER_BEARER],
    authFallback: null,
    rateLimited: true,
    rateLimit: '10 req/60min per IP',
    corsEnabled: true,
    isPublic: false,
    riskLevel: 'LOW',
    notes: 'Token rotation; requires active Bearer session; old token revoked on refresh; 7-day max session',
  },
]);

/**
 * Get endpoints that require auth
 */
export function getAuthenticatedEndpoints() {
  return API_AUTH_MATRIX.filter((e) => e.authRequired);
}

/**
 * Get endpoints that are fully public
 */
export function getPublicEndpoints() {
  return API_AUTH_MATRIX.filter((e) => e.isPublic);
}

/**
 * Get endpoints without rate limiting
 */
export function getUnratedEndpoints() {
  return API_AUTH_MATRIX.filter((e) => !e.rateLimited);
}

/**
 * Get endpoints by risk level
 */
export function getEndpointsByRisk(risk) {
  return API_AUTH_MATRIX.filter((e) => e.riskLevel === risk);
}

/**
 * Get endpoint info by path
 */
export function getEndpointInfo(path) {
  return API_AUTH_MATRIX.find((e) => e.endpoint === path) || null;
}
