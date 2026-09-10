// OWASP Top 10 (2021) Compliance Assessment
// Phase AF — Maps each OWASP Top 10 risk to VirtuMatch's controls

/**
 * OWASP Top 10 (2021) — Complete Compliance Registry
 * Each item maps to specific controls, tests, and status in the project.
 */
export const OWASP_TOP_10 = Object.freeze([
  {
    id: 'A01',
    name: 'Broken Access Control',
    description: 'Restrictions on authenticated users are not properly enforced',
    status: 'MITIGATED',
    controls: [
      'HMAC-SHA256 device authentication with timing-safe comparison',
      'User session Bearer tokens with 30-day expiry',
      'Admin Bearer tokens with 24-hour expiry',
      'Cron key and scraper push key with timing-safe verification',
      'Ownership checks on predictions (users can only access their own)',
      'DELETE blocked via HMAC fallback path',
      'HMAC_ONLY flag for strict enforcement (migration in progress)',
      'Admin origin check (isOriginAllowed)',
    ],
    gaps: [
      'No token revocation mechanism (GAP-01)',
      'Legacy x-device-id fallback still active (GAP-05)',
      'early-alerts inlines admin verification (drift risk)',
    ],
    testSuites: ['auth.test.js', 'hmac-only.test.js', 'auth-matrix.test.js'],
  },
  {
    id: 'A02',
    name: 'Cryptographic Failures',
    description: 'Failures related to cryptography which often lead to sensitive data exposure',
    status: 'MITIGATED',
    controls: [
      'HMAC-SHA256 for device and session tokens',
      'SHA-256 for magic link token hashing in DB',
      'crypto.randomBytes(32) for token/secret generation',
      'crypto.timingSafeEqual for all comparisons',
      'HTTPS enforced via HSTS (1 year + includeSubDomains)',
      'No TLS 1.0/1.1 (Vercel enforces TLS 1.2+)',
      'NEON_DATABASE_URL never exposed to client (server-only)',
      'VITE_ prefix excludes secrets from client bundle',
    ],
    gaps: [
      'No certificate pinning in mobile APK',
    ],
    testSuites: ['auth.test.js', 'secret-audit.test.js', 'secret-rotation.test.js'],
  },
  {
    id: 'A03',
    name: 'Injection',
    description: 'SQL, NoSQL, OS, and LDAP injection flaws',
    status: 'MITIGATED',
    controls: [
      'Parameterized queries via postgres tagged template literals',
      'Input validation in api/_lib/validate.js (9 functions)',
      'Type checking before DB queries (prevents object injection)',
      'Length limits on all inputs (prevents buffer overflow)',
      'Control character rejection in sanitizeString()',
      'CRLF injection prevention in validateEmail()',
      'League ID whitelist (SSRF protection)',
      'Purpose whitelist (activate, login, migrate)',
    ],
    gaps: [],
    testSuites: ['input-validation.test.js', 'error-handling.test.js'],
  },
  {
    id: 'A04',
    name: 'Insecure Design',
    description: 'Missing or ineffective security controls and architecture flaws',
    status: 'MITIGATED',
    controls: [
      'Architecture Decision Records (5 ADRs)',
      'Security runbook with incident response procedures',
      'Centralized coefficient registry (38 parameters)',
      'Startup validation for coefficient integrity',
      'CI pipeline with coefficient audit step',
      'Branch guard with CORS and secret checks',
      'Data classification with PII inventory',
      'API authorization matrix (13 endpoints)',
    ],
    gaps: [
      'No account deletion/GDPR mechanism',
      'Secret rotation not automated',
    ],
    testSuites: ['documentation.test.js', 'ci-pipeline.test.js', 'calibration.test.js'],
  },
  {
    id: 'A05',
    name: 'Security Misconfiguration',
    description: 'Improperly configured permissions, unnecessary features, default accounts',
    status: 'MITIGATED',
    controls: [
      'CSP with no unsafe-eval, no unsafe-inline for scripts',
      'X-Frame-Options: DENY',
      'X-Content-Type-Options: nosniff',
      'Permissions-Policy: camera=(), microphone=(), geolocation=()',
      'Referrer-Policy: strict-origin-when-cross-origin',
      'HSTS: max-age=31536000; includeSubDomains',
      'CDN domains removed from CSP (Phase AB)',
      'Capacitor: mixedContent=false, debug=false, scheme=https',
      'Vite: debugger dropped, dev labels dropped in production',
      'robots.txt restricts /api/ and /admin/',
    ],
    gaps: [
      'style-src still has unsafe-inline (Tailwind requirement)',
    ],
    testSuites: ['csp.test.js', 'security-headers.test.js', 'supply-chain.test.js'],
  },
  {
    id: 'A06',
    name: 'Vulnerable and Outdated Components',
    description: 'Using components with known vulnerabilities',
    status: 'MITIGATED',
    controls: [
      'npm audit: 0 runtime vulnerabilities',
      '9 dev/build-time vulnerabilities (all low, none critical)',
      'Lockfile integrity: 100% sha512 coverage (946 packages)',
      'All packages from official npm registry',
      'No .npmrc with custom registries',
      'CI pipeline runs npm audit on every push/PR',
    ],
    gaps: [
      '9 dev-time vulnerabilities (not runtime, acceptable risk)',
    ],
    testSuites: ['dependency-audit.test.js', 'supply-chain.test.js'],
  },
  {
    id: 'A07',
    name: 'Identification and Authentication Failures',
    description: 'Authentication failures allow identity attacks',
    status: 'MITIGATED',
    controls: [
      'Magic link authentication (passwordless — no password storage)',
      'HMAC device authentication (cryptographic proof of identity)',
      'Rate limiting on auth endpoints (3/15min per email+IP)',
      'Email enumeration protection (identical responses)',
      'Magic links: single-use, 15-minute expiry',
      'Device secrets: one-time issuance, never re-exposed',
      'Admin login: rate limited (5/15min per IP)',
    ],
    gaps: [
      '30-day user sessions without revocation (GAP-02)',
      'No concurrent session limits (GAP-03)',
    ],
    testSuites: ['auth.test.js', 'hmac-only.test.js', 'session-lifecycle.test.js'],
  },
  {
    id: 'A08',
    name: 'Software and Data Integrity Failures',
    description: 'Code and infrastructure without integrity verification',
    status: 'MITIGATED',
    controls: [
      'No external CDN scripts in HTML (SRI not needed)',
      'Self-hosted fonts (Inter + Orbitron in public/fonts/)',
      'Lockfile version 3 with full integrity coverage',
      'CI pipeline validates coefficients on every build',
      'Branch guard audits for hardcoded secrets and CORS changes',
      'Capacitor APK signed with release keystore',
    ],
    gaps: [
      'No SRI for Vercel-hosted assets (managed platform — acceptable)',
    ],
    testSuites: ['supply-chain.test.js', 'ci-pipeline.test.js'],
  },
  {
    id: 'A09',
    name: 'Security Logging and Monitoring Failures',
    description: 'Insufficient logging and monitoring for security events',
    status: 'MITIGATED',
    controls: [
      'Structured JSON logging with PII redaction (logger.js)',
      'Correlation IDs on all error responses',
      'HMAC fallback usage logged with method + IP',
      'Rate limit violations logged with redacted context',
      'Sentry error tracking integration (sentry.js)',
      'Health check endpoint for monitoring (health.js)',
      'Security runbook with incident response procedures',
    ],
    gaps: [
      'Bare console.log/warn in verify-predictions.js and analyze-match.js',
      'userId not originally in PII_KEYS (fixed in Phase AC)',
    ],
    testSuites: ['logging.test.js', 'monitoring.test.js', 'error-handling.test.js'],
  },
  {
    id: 'A10',
    name: 'Server-Side Request Forgery (SSRF)',
    description: 'Web app fetches remote resources without validating the URL',
    status: 'MITIGATED',
    controls: [
      'League ID whitelist (8 known leagues only)',
      'Server-side SPORTY_BEARER never exposed to client',
      'Upstream API timeouts (8 seconds)',
      'No user-supplied URLs in any fetch call',
      'fetch-live and matches only connect to known sporty-tech.net API',
    ],
    gaps: [],
    testSuites: ['input-validation.test.js', 'cors.test.js'],
  },
]);

/**
 * Get overall compliance status
 */
export function getOverallStatus() {
  const statuses = OWASP_TOP_10.map((item) => item.status);
  if (statuses.every((s) => s === 'MITIGATED')) return 'MITIGATED';
  if (statuses.some((s) => s === 'CRITICAL')) return 'CRITICAL';
  if (statuses.some((s) => s === 'AT_RISK')) return 'AT_RISK';
  return 'PARTIAL';
}

/**
 * Get total number of gaps
 */
export function getTotalGaps() {
  return OWASP_TOP_10.reduce((sum, item) => sum + item.gaps.length, 0);
}

/**
 * Get all gaps across all items
 */
export function getAllGaps() {
  const gaps = [];
  OWASP_TOP_10.forEach((item) => {
    item.gaps.forEach((gap) => {
      gaps.push({ owaspId: item.id, owaspName: item.name, gap });
    });
  });
  return gaps;
}

/**
 * Get items with gaps
 */
export function getItemsWithGaps() {
  return OWASP_TOP_10.filter((item) => item.gaps.length > 0);
}
