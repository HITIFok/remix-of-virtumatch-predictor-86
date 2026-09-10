// HMAC_ONLY Migration Readiness & Activation Metrics
// Phase AL — Tracks migration progress from legacy fallback to HMAC-only auth.
// Provides readiness criteria and metrics for the HMAC_ONLY=true activation.

/**
 * Migration Readiness Criteria
 */
export const READINESS_CRITERIA = Object.freeze([
  {
    id: 'RC-01',
    criterion: 'All API handlers verify HMAC tokens via requireAuth()',
    status: 'IMPLEMENTED',
    evidence: 'All 13 endpoints use requireAuth() or verifyDeviceToken()',
    blocking: true,
  },
  {
    id: 'RC-02',
    criterion: 'DELETE method blocked via fallback (even during migration)',
    status: 'IMPLEMENTED',
    evidence: 'auth.js line 218: DELETE returns null via fallback',
    blocking: true,
  },
  {
    id: 'RC-03',
    criterion: 'body.device_id and query.device_id fallbacks removed',
    status: 'IMPLEMENTED',
    evidence: 'auth.js line 231: body/query fallbacks REMOVED in V-01 fix',
    blocking: true,
  },
  {
    id: 'RC-04',
    criterion: 'Fallback usage monitored and logged with IP + method',
    status: 'IMPLEMENTED',
    evidence: 'auth.js line 227: console.warn with device_id, method, ip',
    blocking: true,
  },
  {
    id: 'RC-05',
    criterion: 'Stricter rate limit for fallback requests (10 req/min)',
    status: 'IMPLEMENTED',
    evidence: 'middleware.js: strict=true for requests without HMAC token',
    blocking: true,
  },
  {
    id: 'RC-06',
    criterion: 'Fallback usage below threshold (<5% of total auth)',
    status: 'NEEDS_DATA',
    evidence: 'Requires production monitoring data (2-week migration window)',
    blocking: false,
  },
  {
    id: 'RC-07',
    criterion: 'All active APK clients updated to HMAC auth',
    status: 'NEEDS_DEPLOY',
    evidence: 'APK must include device-register + HMAC token generation',
    blocking: true,
  },
  {
    id: 'RC-08',
    criterion: 'HMAC_ONLY=true tested in staging environment',
    status: 'NEEDS_TESTING',
    evidence: 'Set HMAC_ONLY=true in staging, verify no fallback usage',
    blocking: true,
  },
]);

/**
 * Migration Metrics — tracks fallback vs HMAC usage
 */
export class MigrationMetrics {
  constructor() {
    this.hmacAuthCount = 0;
    this.fallbackAuthCount = 0;
    this.fallbackByMethod = {};
    this.fallbackByIp = {};
    this.deleteBlockedCount = 0;
    this.startTime = Date.now();
  }

  /**
   * Record an HMAC authentication event
   */
  recordHmacAuth() {
    this.hmacAuthCount++;
  }

  /**
   * Record a fallback authentication event
   */
  recordFallbackAuth(method, ip) {
    this.fallbackAuthCount++;
    this.fallbackByMethod[method] = (this.fallbackByMethod[method] || 0) + 1;
    this.fallbackByIp[ip] = (this.fallbackByIp[ip] || 0) + 1;
  }

  /**
   * Record a DELETE blocked via fallback
   */
  recordDeleteBlocked() {
    this.deleteBlockedCount++;
  }

  /**
   * Get migration progress metrics
   */
  getMetrics() {
    const totalAuth = this.hmacAuthCount + this.fallbackAuthCount;
    const fallbackRate = totalAuth > 0 ? (this.fallbackAuthCount / totalAuth) * 100 : 0;
    const durationMs = Date.now() - this.startTime;
    const uniqueIps = Object.keys(this.fallbackByIp).length;

    return {
      totalAuth,
      hmacAuthCount: this.hmacAuthCount,
      fallbackAuthCount: this.fallbackAuthCount,
      fallbackRate: Math.round(fallbackRate * 100) / 100,
      deleteBlockedCount: this.deleteBlockedCount,
      fallbackByMethod: { ...this.fallbackByMethod },
      uniqueFallbackIps: uniqueIps,
      durationHours: Math.round((durationMs / 3600000) * 100) / 100,
      readyForActivation: fallbackRate < 5 && this.deleteBlockedCount === 0,
    };
  }

  /**
   * Reset metrics (for testing)
   */
  reset() {
    this.hmacAuthCount = 0;
    this.fallbackAuthCount = 0;
    this.fallbackByMethod = {};
    this.fallbackByIp = {};
    this.deleteBlockedCount = 0;
    this.startTime = Date.now();
  }
}

/**
 * Get migration readiness status
 */
export function getMigrationReadiness() {
  const total = READINESS_CRITERIA.length;
  const implemented = READINESS_CRITERIA.filter(c => c.status === 'IMPLEMENTED').length;
  const blocking = READINESS_CRITERIA.filter(c => c.blocking);
  const blockingImplemented = blocking.filter(c => c.status === 'IMPLEMENTED').length;
  const blockingTotal = blocking.length;

  return {
    criteriaTotal: total,
    criteriaImplemented: implemented,
    implementationPercent: Math.round((implemented / total) * 100),
    blockingTotal,
    blockingImplemented,
    blockingPercent: Math.round((blockingImplemented / blockingTotal) * 100),
    canActivate: blocking.every(c => c.status === 'IMPLEMENTED'),
    remainingBlocking: blocking.filter(c => c.status !== 'IMPLEMENTED').map(c => c.id),
    pendingCriteria: READINESS_CRITERIA.filter(c => c.status !== 'IMPLEMENTED'),
  };
}

/**
 * Activation procedure — steps to enable HMAC_ONLY=true
 */
export const ACTIVATION_PROCEDURE = Object.freeze([
  { step: 1, action: 'Deploy APK with HMAC auth to all users', prerequisite: 'RC-07' },
  { step: 2, action: 'Monitor fallback rate for 2 weeks', prerequisite: 'RC-06' },
  { step: 3, action: 'Verify fallback rate < 5% in production', prerequisite: 'RC-06' },
  { step: 4, action: 'Set HMAC_ONLY=true in staging', prerequisite: 'RC-08' },
  { step: 5, action: 'Run full E2E test suite in staging', prerequisite: 'RC-08' },
  { step: 6, action: 'Set HMAC_ONLY=true in production', prerequisite: 'All RCs' },
  { step: 7, action: 'Monitor for 24h — no auth failures expected', prerequisite: 'Production' },
  { step: 8, action: 'Remove fallback code from auth.js (cleanup)', prerequisite: '7 days clean' },
]);

/**
 * Rollback procedure — if HMAC_ONLY=true causes issues
 */
export const ROLLBACK_PROCEDURE = Object.freeze([
  { step: 1, action: 'Set HMAC_ONLY=false in Vercel environment' },
  { step: 2, action: 'Redeploy (auto-triggered by env change)' },
  { step: 3, action: 'Verify fallback auth is working' },
  { step: 4, action: 'Investigate root cause of HMAC auth failures' },
  { step: 5, action: 'Fix client issue and redeploy APK' },
]);
