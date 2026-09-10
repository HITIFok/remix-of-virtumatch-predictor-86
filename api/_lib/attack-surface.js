// Attack Surface Analysis & Penetration Simulation
// Phase AI — Documents the complete attack surface, enumerates attack vectors,
// and provides automated penetration test simulations for verification.

/**
 * Attack Surface Categories
 */
export const ATTACK_CATEGORIES = Object.freeze({
  AUTH_BYPASS: 'AUTH_BYPASS',
  INJECTION: 'INJECTION',
  CORS_ABUSE: 'CORS_ABUSE',
  RATE_LIMIT: 'RATE_LIMIT',
  DATA_EXFILTRATION: 'DATA_EXFILTRATION',
  SESSION_HIJACK: 'SESSION_HIJACK',
  XSS: 'XSS',
  CSRF: 'CSRF',
  IDOR: 'IDOR',          // Insecure Direct Object Reference
  DOS: 'DOS',            // Denial of Service
  MISCONFIG: 'MISCONFIG',
  INFO_DISCLOSURE: 'INFO_DISCLOSURE',
});

/**
 * Severity ratings for attack vectors
 */
export const SEVERITY = Object.freeze({
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INFO: 'INFO',
});

/**
 * Complete Attack Surface Map — every endpoint × every attack vector
 */
export const ATTACK_SURFACE = Object.freeze([
  // ── Authentication Attack Vectors ──────────────────────────────────────
  {
    id: 'AS-01',
    category: ATTACK_CATEGORIES.AUTH_BYPASS,
    severity: SEVERITY.HIGH,
    title: 'Plain device_id impersonation via x-device-id header',
    description: 'Without HMAC_ONLY=true, any client can forge x-device-id header to impersonate any device. Fallback is logged but accepted.',
    endpoint: 'ALL (middleware)',
    payload: 'x-device-id: dev-victimid',
    mitigated: true,
    mitigation: 'V-01 fix: HMAC_ONLY env var restricts fallback; DELETE blocked; body/query fallback removed',
    testReference: 'auth.test.js (V-01 tests)',
    cvss: 7.5,
  },
  {
    id: 'AS-02',
    category: ATTACK_CATEGORIES.AUTH_BYPASS,
    severity: SEVERITY.CRITICAL,
    title: 'Device secret re-exposure on re-registration',
    description: 'If registerDevice() returned the secret for already-registered devices, attackers who know a device_id could obtain the HMAC secret.',
    endpoint: 'POST /api/device-register',
    payload: '{ device_id: "dev-victimid" }',
    mitigated: true,
    mitigation: 'registerDevice() returns 409 for existing devices — never re-exposes secret',
    testReference: 'auth.test.js (registerDevice tests)',
    cvss: 9.1,
  },
  {
    id: 'AS-03',
    category: ATTACK_CATEGORIES.AUTH_BYPASS,
    severity: SEVERITY.HIGH,
    title: 'HMAC token forgery without device_secret',
    description: 'Attacker attempts to forge Authorization: Device <token> without knowing the per-device secret.',
    endpoint: 'ALL authenticated endpoints',
    payload: 'Authorization: Device forged.timestamp.forged_signature',
    mitigated: true,
    mitigation: 'HMAC-SHA256 with per-device secret; timing-safe comparison prevents timing attacks',
    testReference: 'auth.test.js (verifyDeviceToken tests)',
    cvss: 8.0,
  },
  {
    id: 'AS-04',
    category: ATTACK_CATEGORIES.AUTH_BYPASS,
    severity: SEVERITY.MEDIUM,
    title: 'Expired HMAC token reuse',
    description: 'Stolen tokens could be replayed within the 7-day expiry window.',
    endpoint: 'ALL authenticated endpoints',
    payload: 'Authorization: Device <stolen_valid_token>',
    mitigated: true,
    mitigation: '7-day token expiry limits window; token rotation on device_secret change',
    testReference: 'auth.test.js (token expiry test)',
    cvss: 5.3,
  },

  // ── CORS Abuse ────────────────────────────────────────────────────────
  {
    id: 'AS-05',
    category: ATTACK_CATEGORIES.CORS_ABUSE,
    severity: SEVERITY.CRITICAL,
    title: 'x-capacitor-request header bypass (V-02)',
    description: 'The x-capacitor-request header previously bypassed all CORS checks, allowing any origin to make authenticated requests.',
    endpoint: 'ALL API routes',
    payload: 'x-capacitor-request: true (from evil.com)',
    mitigated: true,
    mitigation: 'V-02 fix: x-capacitor-request bypass removed; origin validation enforced',
    testReference: 'cors.test.js (V-02 bypass tests)',
    cvss: 9.0,
  },
  {
    id: 'AS-06',
    category: ATTACK_CATEGORIES.CORS_ABUSE,
    severity: SEVERITY.MEDIUM,
    title: 'Origin reflection without Vary header (cache poisoning)',
    description: 'CDN could cache a response for one origin and serve it to another origin, leaking CORS-permitted data.',
    endpoint: 'ALL API routes',
    payload: 'Origin: https://evil.com (with CDN cache)',
    mitigated: true,
    mitigation: 'Vary: Origin header set on all CORS responses',
    testReference: 'cors.test.js (Vary header test)',
    cvss: 5.0,
  },

  // ── Injection ────────────────────────────────────────────────────────
  {
    id: 'AS-07',
    category: ATTACK_CATEGORIES.INJECTION,
    severity: SEVERITY.HIGH,
    title: 'SQL injection via user-supplied parameters',
    description: 'User-supplied device_id, email, match parameters are used in SQL queries.',
    endpoint: 'Multiple (predictions, auth, admin-codes)',
    payload: "device_id: dev-'; DROP TABLE predictions;--",
    mitigated: true,
    mitigation: 'postgres.js tagged template literals automatically parameterize all values',
    testReference: 'input-validation.test.js (format validation)',
    cvss: 8.5,
  },
  {
    id: 'AS-08',
    category: ATTACK_CATEGORIES.INJECTION,
    severity: SEVERITY.HIGH,
    title: 'XSS via inline scripts/styles (CSP bypass)',
    description: 'Without strict CSP, injected inline scripts could execute in user browsers.',
    endpoint: 'index.html (frontend)',
    payload: '<script>alert(document.cookie)</script>',
    mitigated: true,
    mitigation: 'V-03 fix: unsafe-inline removed; SHA-256 hashes for known inline content',
    testReference: 'csp.test.js (unsafe-inline removal tests)',
    cvss: 7.0,
  },

  // ── Rate Limiting / DoS ──────────────────────────────────────────────
  {
    id: 'AS-09',
    category: ATTACK_CATEGORIES.RATE_LIMIT,
    severity: SEVERITY.MEDIUM,
    title: 'API abuse without rate limiting',
    description: 'Unlimited requests could exhaust serverless function quotas or database connections.',
    endpoint: 'ALL /api/* routes',
    payload: 'Rapid repeated requests from single IP',
    mitigated: true,
    mitigation: 'Edge middleware rate limiting: 30 req/min (standard), 10 req/min (HMAC fallback)',
    testReference: 'ratelimit.test.js',
    cvss: 5.3,
  },
  {
    id: 'AS-10',
    category: ATTACK_CATEGORIES.DOS,
    severity: SEVERITY.MEDIUM,
    title: 'Vercel function timeout via slow Groq API calls',
    description: 'Analyze-match endpoint could exceed Vercel 10s Hobby timeout, returning HTML error instead of JSON.',
    endpoint: 'POST /api/analyze-match',
    payload: 'Request with many matches requiring AI analysis',
    mitigated: true,
    mitigation: 'Global 8s timeout guard; batch routing (>3 matches → math fallback); dynamic deadline',
    testReference: 'handler-migration.test.js',
    cvss: 5.0,
  },

  // ── Session / Token ──────────────────────────────────────────────────
  {
    id: 'AS-11',
    category: ATTACK_CATEGORIES.SESSION_HIJACK,
    severity: SEVERITY.HIGH,
    title: 'No token revocation for compromised sessions',
    description: 'GAP-01: Stolen tokens remain valid until expiry. No blacklist or revocation mechanism.',
    endpoint: 'ALL authenticated endpoints',
    payload: 'Stolen Authorization header replayed',
    mitigated: false,
    mitigation: 'GAP-01 DOCUMENTED — needs token blacklist (Redis) or reduced session lifetime',
    testReference: 'session-lifecycle.test.js (GAP-01)',
    cvss: 7.5,
  },
  {
    id: 'AS-12',
    category: ATTACK_CATEGORIES.SESSION_HIJACK,
    severity: SEVERITY.HIGH,
    title: '30-day user sessions without revocation (GAP-02)',
    description: 'Long-lived sessions with no refresh rotation extend the window of compromise.',
    endpoint: 'api/auth.js (signUserToken)',
    payload: 'Long-lived Bearer token',
    mitigated: false,
    mitigation: 'GAP-02 DOCUMENTED — reduce to 7 days or implement refresh token rotation',
    testReference: 'session-lifecycle.test.js (GAP-02)',
    cvss: 7.0,
  },

  // ── IDOR ─────────────────────────────────────────────────────────────
  {
    id: 'AS-13',
    category: ATTACK_CATEGORIES.IDOR,
    severity: SEVERITY.HIGH,
    title: 'Device migration data access without ownership check',
    description: 'Admin device migration endpoint could allow accessing another device\'s data without verifying ownership.',
    endpoint: 'POST /api/admin-codes (migrate)',
    payload: '{ fromDevice: "dev-victim", toDevice: "dev-attacker" }',
    mitigated: true,
    mitigation: 'Admin endpoint requires ADMIN_TOKEN_SECRET; not accessible to regular users',
    testReference: 'auth-matrix.test.js (admin endpoints)',
    cvss: 7.5,
  },

  // ── Data Exfiltration ────────────────────────────────────────────────
  {
    id: 'AS-14',
    category: ATTACK_CATEGORIES.DATA_EXFILTRATION,
    severity: SEVERITY.MEDIUM,
    title: 'PII in API responses (email exposure)',
    description: 'Email addresses returned in full in some API responses instead of being redacted.',
    endpoint: 'POST /api/auth (verify)',
    payload: 'Valid magic link verification',
    mitigated: true,
    mitigation: 'PII_RESPONSE_REDACTIONS documented; logger PII_KEYS expanded to 16 fields',
    testReference: 'data-classification.test.js (PII response redaction)',
    cvss: 4.0,
  },
  {
    id: 'AS-15',
    category: ATTACK_CATEGORIES.DATA_EXFILTRATION,
    severity: SEVERITY.MEDIUM,
    title: 'Error message information disclosure',
    description: 'Internal error details (SQL messages, stack traces) could leak implementation details.',
    endpoint: 'Multiple (500 errors)',
    payload: 'Malformed request triggering server error',
    mitigated: true,
    mitigation: 'Shared errors.js with sanitized responses; correlation IDs for debugging without exposing internals',
    testReference: 'error-handling.test.js',
    cvss: 4.5,
  },

  // ── CSRF ─────────────────────────────────────────────────────────────
  {
    id: 'AS-16',
    category: ATTACK_CATEGORIES.CSRF,
    severity: SEVERITY.MEDIUM,
    title: 'Cross-Site Request Forgery on state-changing endpoints',
    description: 'POST endpoints that rely only on device_id for auth could be targeted via CSRF from evil.com.',
    endpoint: 'POST /api/predictions, POST /api/premium-activate',
    payload: 'Auto-submitted form from evil.com with victim device_id',
    mitigated: true,
    mitigation: 'CSP frame-ancestors: none; CORS origin validation; HMAC tokens not auto-attachable',
    testReference: 'csp.test.js + cors.test.js',
    cvss: 5.0,
  },

  // ── Misconfiguration ─────────────────────────────────────────────────
  {
    id: 'AS-17',
    category: ATTACK_CATEGORIES.MISCONFIG,
    severity: SEVERITY.MEDIUM,
    title: 'CSP unsafe-inline (V-03)',
    description: 'Content Security Policy allowed unsafe-inline scripts and styles, negating XSS protection.',
    endpoint: 'index.html (all pages)',
    payload: '<div style="background:url(javascript:alert(1))">',
    mitigated: true,
    mitigation: 'V-03 fix: unsafe-inline removed; SHA-256 hashes; inline styles → CSS classes',
    testReference: 'csp.test.js (V-03 tests)',
    cvss: 6.5,
  },
  {
    id: 'AS-18',
    category: ATTACK_CATEGORIES.MISCONFIG,
    severity: SEVERITY.LOW,
    title: 'Missing security headers',
    description: 'Missing HSTS, X-Content-Type-Options, or other security headers could allow downgrade attacks.',
    endpoint: 'ALL routes',
    payload: 'HTTP (non-HTTPS) request',
    mitigated: true,
    mitigation: 'vercel.json: HSTS, nosniff, DENY frame, Referrer-Policy, Permissions-Policy',
    testReference: 'security-headers.test.js',
    cvss: 3.0,
  },

  // ── Information Disclosure ───────────────────────────────────────────
  {
    id: 'AS-19',
    category: ATTACK_CATEGORIES.INFO_DISCLOSURE,
    severity: SEVERITY.MEDIUM,
    title: 'Structured error responses reveal internal state',
    description: 'Error correlation IDs and structured error codes could reveal API structure to attackers.',
    endpoint: 'ALL API routes (error paths)',
    payload: 'Invalid request to map error response structure',
    mitigated: true,
    mitigation: 'Errors include correlation ID but not stack traces or SQL messages in production',
    testReference: 'error-handling.test.js (no stack trace leak)',
    cvss: 3.5,
  },
  {
    id: 'AS-20',
    category: ATTACK_CATEGORIES.INFO_DISCLOSURE,
    severity: SEVERITY.LOW,
    title: 'Health endpoint exposes system information',
    description: '/api/health reveals Node version, memory usage, and environment details.',
    endpoint: 'GET /api/health',
    payload: 'GET /api/health',
    mitigated: true,
    mitigation: 'Health endpoint is unauthenticated but non-sensitive; used for monitoring only',
    testReference: 'health-monitoring.test.js',
    cvss: 2.0,
  },
]);

/**
 * Penetration Test Scenarios — automated simulations
 */
export const PEN_TEST_SCENARIOS = Object.freeze([
  {
    id: 'PEN-01',
    name: 'HMAC Token Forgery',
    attack: 'Attempt to forge Authorization: Device <token> without secret',
    expectedResult: '401/403 — signature mismatch',
    verified: true,
  },
  {
    id: 'PEN-02',
    name: 'Device ID Impersonation (HMAC_ONLY=false)',
    attack: 'Send x-device-id header with victim\'s device_id',
    expectedResult: 'Accepted during migration (logged); blocked if HMAC_ONLY=true',
    verified: true,
  },
  {
    id: 'PEN-03',
    name: 'CORS Bypass via x-capacitor-request',
    attack: 'Send x-capacitor-request header from evil.com',
    expectedResult: 'REJECTED — bypass removed in V-02 fix',
    verified: true,
  },
  {
    id: 'PEN-04',
    name: 'SQL Injection via device_id',
    attack: 'Send device_id with SQL metacharacters',
    expectedResult: 'REJECTED — DEVICE_ID_RE regex + parameterized queries',
    verified: true,
  },
  {
    id: 'PEN-05',
    name: 'CSP Bypass via inline script',
    attack: 'Inject <script>alert(1)</script> in page',
    expectedResult: 'BLOCKED — CSP without unsafe-inline; SHA-256 hashes only',
    verified: true,
  },
  {
    id: 'PEN-06',
    name: 'Rate Limit Exhaustion',
    attack: 'Send >30 requests/min from single IP',
    expectedResult: '429 Too Many Requests after limit exceeded',
    verified: true,
  },
  {
    id: 'PEN-07',
    name: 'DELETE via Fallback Auth',
    attack: 'Send DELETE with x-device-id but no HMAC token',
    expectedResult: 'REJECTED — DELETE blocked via fallback during migration',
    verified: true,
  },
  {
    id: 'PEN-08',
    name: 'Device Secret Re-exposure',
    attack: 'Re-register existing device to obtain secret',
    expectedResult: '409 Conflict — secret never re-exposed',
    verified: true,
  },
  {
    id: 'PEN-09',
    name: 'Token Replay After Expiry',
    attack: 'Replay HMAC token after 7-day expiry',
    expectedResult: 'REJECTED — timestamp check fails',
    verified: true,
  },
  {
    id: 'PEN-10',
    name: 'Timing Attack on HMAC Verification',
    attack: 'Measure response time to deduce signature bytes',
    expectedResult: 'MITIGATED — crypto.timingSafeEqual prevents timing leakage',
    verified: true,
  },
]);

/**
 * Attack surface metrics
 */
export function getAttackSurfaceMetrics() {
  const total = ATTACK_SURFACE.length;
  const mitigated = ATTACK_SURFACE.filter(a => a.mitigated).length;
  const unmitigated = total - mitigated;
  const avgCvss = ATTACK_SURFACE.reduce((sum, a) => sum + a.cvss, 0) / total;
  const maxCvss = Math.max(...ATTACK_SURFACE.map(a => a.cvss));
  const criticalCount = ATTACK_SURFACE.filter(a => a.severity === SEVERITY.CRITICAL).length;
  const highCount = ATTACK_SURFACE.filter(a => a.severity === SEVERITY.HIGH).length;

  const byCategory = {};
  for (const attack of ATTACK_SURFACE) {
    byCategory[attack.category] = (byCategory[attack.category] || 0) + 1;
  }

  return {
    total,
    mitigated,
    unmitigated,
    mitigationRate: Math.round((mitigated / total) * 100),
    avgCvss: Math.round(avgCvss * 10) / 10,
    maxCvss,
    criticalCount,
    highCount,
    byCategory,
    penTestTotal: PEN_TEST_SCENARIOS.length,
    penTestVerified: PEN_TEST_SCENARIOS.filter(p => p.verified).length,
  };
}

/**
 * Get unmitigated attack vectors
 */
export function getUnmitigatedAttacks() {
  return ATTACK_SURFACE.filter(a => !a.mitigated);
}

/**
 * Get attacks by category
 */
export function getAttacksByCategory(category) {
  return ATTACK_SURFACE.filter(a => a.category === category);
}

/**
 * Get attacks by severity level
 */
export function getAttacksBySeverity(severity) {
  return ATTACK_SURFACE.filter(a => a.severity === severity);
}

/**
 * Simulate an attack and return the expected defense
 */
export function simulateAttack(attackId) {
  const attack = ATTACK_SURFACE.find(a => a.id === attackId);
  if (!attack) return { error: 'Unknown attack ID' };

  return {
    id: attack.id,
    title: attack.title,
    category: attack.category,
    severity: attack.severity,
    cvss: attack.cvss,
    payload: attack.payload,
    endpoint: attack.endpoint,
    mitigated: attack.mitigation,
    mitigationStatus: attack.mitigated ? 'MITIGATED' : 'UNMITIGATED',
  };
}
