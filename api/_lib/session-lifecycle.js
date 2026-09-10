// Session & Token Lifecycle Configuration
// Phase AD — Documents all token types, their expiry, revocation capabilities,
// and security properties for the VirtuMatch authentication system.

/**
 * Token types in the system
 */
export const TOKEN_TYPES = Object.freeze({
  DEVICE_HMAC: 'DEVICE_HMAC',
  USER_SESSION: 'USER_SESSION',
  ADMIN_SESSION: 'ADMIN_SESSION',
  MAGIC_LINK: 'MAGIC_LINK',
});

/**
 * Token Lifecycle Registry — every token type in the system
 */
export const TOKEN_REGISTRY = Object.freeze([
  {
    type: TOKEN_TYPES.DEVICE_HMAC,
    description: 'HMAC-SHA256 signed device token',
    format: 'base64url(timestamp).base64url(hmac_signature)',
    expiryMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    expiryLabel: '7 days',
    signingKey: 'device_secret (per-device)',
    verification: 'timing-safe comparison (crypto.timingSafeEqual)',
    revocable: false,
    revocationMethod: 'None — rotate device_secret to invalidate all tokens for that device',
    singleUse: false,
    refreshable: true, // Client regenerates with stored secret
    rotationAutomated: false,
    sourceFile: 'api/_lib/auth.js',
  },
  {
    type: TOKEN_TYPES.USER_SESSION,
    description: 'HMAC-SHA256 signed user session token (magic link verification)',
    format: 'base64url(timestamp).base64url(userId).base64url(hmac)',
    expiryMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    expiryLabel: '30 days',
    signingKey: 'USER_SESSION_SECRET (env var)',
    verification: 'timing-safe HMAC verification',
    revocable: false,
    revocationMethod: 'None — rotate USER_SESSION_SECRET to invalidate ALL sessions',
    singleUse: false,
    refreshable: false, // No refresh endpoint — must re-authenticate
    rotationAutomated: false,
    sourceFile: 'api/_lib/auth.js',
  },
  {
    type: TOKEN_TYPES.ADMIN_SESSION,
    description: 'HMAC-SHA256 signed admin session token',
    format: 'base64url(timestamp).base64url(hmac)',
    expiryMs: 24 * 60 * 60 * 1000, // 24 hours
    expiryLabel: '24 hours',
    signingKey: 'ADMIN_TOKEN_SECRET (env var)',
    verification: 'timing-safe HMAC verification',
    revocable: false,
    revocationMethod: 'None — rotate ADMIN_TOKEN_SECRET to invalidate ALL admin sessions',
    singleUse: false,
    refreshable: false,
    rotationAutomated: false,
    sourceFile: 'api/admin-codes.js',
  },
  {
    type: TOKEN_TYPES.MAGIC_LINK,
    description: 'One-time magic link token (sent via email)',
    format: '64 hex characters (crypto.randomBytes(32))',
    expiryMs: 15 * 60 * 1000, // 15 minutes
    expiryLabel: '15 minutes',
    signingKey: 'N/A — stored as SHA-256 hash in DB',
    verification: 'SHA-256 hash lookup in magic_links table',
    revocable: true,
    revocationMethod: 'Set used_at or delete from magic_links table',
    singleUse: true,
    refreshable: false,
    rotationAutomated: false,
    sourceFile: 'api/auth.js',
  },
]);

/**
 * Security gaps in the token lifecycle
 */
export const TOKEN_SECURITY_GAPS = Object.freeze([
  {
    id: 'GAP-01',
    severity: 'HIGH',
    description: 'No token revocation mechanism — compromised tokens remain valid until expiry',
    affectedTokens: [TOKEN_TYPES.USER_SESSION, TOKEN_TYPES.DEVICE_HMAC, TOKEN_TYPES.ADMIN_SESSION],
    mitigation: 'Implement token blacklist (Redis) or reduce session lifetime',
    status: 'DOCUMENTED',
  },
  {
    id: 'GAP-02',
    severity: 'HIGH',
    description: '30-day user sessions with no revocation or refresh rotation',
    affectedTokens: [TOKEN_TYPES.USER_SESSION],
    mitigation: 'Reduce to 7 days or implement refresh token rotation',
    status: 'DOCUMENTED',
  },
  {
    id: 'GAP-03',
    severity: 'MEDIUM',
    description: 'No concurrent session limits — unlimited sessions per user',
    affectedTokens: [TOKEN_TYPES.USER_SESSION],
    mitigation: 'Add session tracking if abuse is observed',
    status: 'ACCEPTED', // Stateless HMAC design — acceptable trade-off
  },
  {
    id: 'GAP-04',
    severity: 'MEDIUM',
    description: 'Secret rotation schedules defined but not automated',
    affectedTokens: [TOKEN_TYPES.DEVICE_HMAC, TOKEN_TYPES.USER_SESSION, TOKEN_TYPES.ADMIN_SESSION],
    mitigation: 'Implement cron-based rotation using secret-rotation.js',
    status: 'DOCUMENTED',
  },
  {
    id: 'GAP-05',
    severity: 'MEDIUM',
    description: 'HMAC_ONLY flag is false — legacy fallback still active',
    affectedTokens: [TOKEN_TYPES.DEVICE_HMAC],
    mitigation: 'Monitor fallback logs, activate after 2-week migration period',
    status: 'IN_PROGRESS',
  },
  {
    id: 'GAP-06',
    severity: 'LOW',
    description: 'No refresh token endpoint for user sessions',
    affectedTokens: [TOKEN_TYPES.USER_SESSION],
    mitigation: 'Consider refresh token flow for seamless re-authentication',
    status: 'DEFERRED',
  },
]);

/**
 * Secret rotation schedule (from secret-rotation.js)
 */
export const SECRET_ROTATION_SCHEDULE = Object.freeze([
  { secret: 'HMAC_DEVICE_SECRET', rotationDays: 90, graceHours: 24 },
  { secret: 'ADMIN_TOKEN_SECRET', rotationDays: 90, graceHours: 48 },
  { secret: 'USER_SESSION_SECRET', rotationDays: 90, graceHours: 72 },
  { secret: 'CRON_SECRET', rotationDays: 180, graceHours: 1 },
  { secret: 'SCRAPER_PUSH_KEY', rotationDays: 180, graceHours: 1 },
  { secret: 'RESEND_API_KEY', rotationDays: 365, graceHours: 0 },
]);

/**
 * Get token info by type
 */
export function getTokenInfo(type) {
  return TOKEN_REGISTRY.find((t) => t.type === type) || null;
}

/**
 * Get all non-revocable tokens
 */
export function getNonRevocableTokens() {
  return TOKEN_REGISTRY.filter((t) => !t.revocable);
}

/**
 * Get all security gaps by severity
 */
export function getGapsBySeverity(severity) {
  return TOKEN_SECURITY_GAPS.filter((g) => g.severity === severity);
}

/**
 * Check if a token type has a refresh mechanism
 */
export function isTokenRefreshable(type) {
  const token = getTokenInfo(type);
  return token ? token.refreshable : false;
}
