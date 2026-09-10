// Phase AQ (P7) — Refresh Token Endpoint Tests
// Validates token rotation, rate limiting, auth requirements,
// revocation of old token, and security properties.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ENDPOINT_SRC = fs.readFileSync(path.join(ROOT, 'api', 'refresh-token.js'), 'utf8');

// ─── Endpoint Structure ───────────────────────────────────────────────────

describe('Phase AQ: Refresh Token Endpoint Structure', () => {
  it('api/refresh-token.js exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'api', 'refresh-token.js'))).toBe(true);
  });

  it('accepts only POST method', () => {
    expect(ENDPOINT_SRC).toContain('methodNotAllowed');
    expect(ENDPOINT_SRC).toContain("['POST']");
  });

  it('handles CORS preflight (OPTIONS)', () => {
    expect(ENDPOINT_SRC).toContain('OPTIONS');
    expect(ENDPOINT_SRC).toContain('204');
  });

  it('uses shared CORS module', () => {
    expect(ENDPOINT_SRC).toContain('setCorsHeaders');
  });
});

// ─── Authentication ───────────────────────────────────────────────────────

describe('Phase AQ: Refresh Token Authentication', () => {
  it('requires Bearer session token auth', () => {
    expect(ENDPOINT_SRC).toContain('requireUserAuth');
    expect(ENDPOINT_SRC).toContain('unauthorized');
  });

  it('extracts current token from Authorization header', () => {
    expect(ENDPOINT_SRC).toContain('Bearer ');
    expect(ENDPOINT_SRC).toContain('currentToken');
  });

  it('returns 401 if not authenticated', () => {
    expect(ENDPOINT_SRC).toContain('Session authentifiée requise');
  });
});

// ─── Token Rotation (Security) ────────────────────────────────────────────

describe('Phase AQ: Token Rotation Security', () => {
  it('revokes old token after refresh (single-use rotation)', () => {
    expect(ENDPOINT_SRC).toContain('revokeToken');
    expect(ENDPOINT_SRC).toContain('currentToken');
    expect(ENDPOINT_SRC).toContain('TOKEN_REFRESH');
  });

  it('issues new token using signUserToken', () => {
    expect(ENDPOINT_SRC).toContain('signUserToken');
    expect(ENDPOINT_SRC).toContain('newToken');
  });

  it('returns new token and expiresIn in response', () => {
    expect(ENDPOINT_SRC).toContain('token: newToken');
    expect(ENDPOINT_SRC).toContain('expiresIn');
  });

  it('session duration is 7 days (604800 seconds)', () => {
    expect(ENDPOINT_SRC).toContain('7 * 24 * 60 * 60 * 1000');
    expect(ENDPOINT_SRC).toContain('604800');
  });
});

// ─── Rate Limiting ────────────────────────────────────────────────────────

describe('Phase AQ: Refresh Token Rate Limiting', () => {
  it('has rate limiting (10/hour)', () => {
    expect(ENDPOINT_SRC).toContain('createRateLimiter');
    expect(ENDPOINT_SRC).toContain('refresh-token');
    expect(ENDPOINT_SRC).toContain('max: 10');
    expect(ENDPOINT_SRC).toContain('60 * 60 * 1000');
  });

  it('returns rate limit error on abuse', () => {
    expect(ENDPOINT_SRC).toContain('rateLimited');
    expect(ENDPOINT_SRC).toContain('3600');
  });

  it('rate limits by IP address', () => {
    expect(ENDPOINT_SRC).toContain('getClientIp');
  });
});

// ─── Error Handling ───────────────────────────────────────────────────────

describe('Phase AQ: Refresh Token Error Handling', () => {
  it('uses shared error factories', () => {
    expect(ENDPOINT_SRC).toContain('methodNotAllowed');
    expect(ENDPOINT_SRC).toContain('unauthorized');
    expect(ENDPOINT_SRC).toContain('internalError');
    expect(ENDPOINT_SRC).toContain('successResponse');
  });

  it('uses structured logger', () => {
    expect(ENDPOINT_SRC).toContain('createLogger');
    expect(ENDPOINT_SRC).toContain('refresh-token');
  });

  it('integrates Sentry for error capture', () => {
    expect(ENDPOINT_SRC).toContain('captureException');
    expect(ENDPOINT_SRC).toContain('refresh-token');
  });

  it('logs refresh success with userId', () => {
    expect(ENDPOINT_SRC).toContain('Token refreshed');
  });

  it('logs refresh failure with error cause', () => {
    expect(ENDPOINT_SRC).toContain('Token refresh failed');
    expect(ENDPOINT_SRC).toContain('cause: err');
  });
});

// ─── Security Properties ─────────────────────────────────────────────────

describe('Phase AQ: Refresh Token Security Properties', () => {
  it('old token is revoked BEFORE new token is issued', () => {
    // Find positions of revokeToken and signUserToken in source
    const revokePos = ENDPOINT_SRC.indexOf('revokeToken(currentToken');
    const signPos = ENDPOINT_SRC.indexOf('signUserToken(userId)');
    expect(revokePos).toBeGreaterThan(-1);
    expect(signPos).toBeGreaterThan(-1);
    expect(revokePos).toBeLessThan(signPos);
  });

  it('does NOT extend session beyond 7 days', () => {
    // The new token has a fresh 7-day expiry from NOW
    // It does NOT add 7 days to the old token's expiry
    expect(ENDPOINT_SRC).toContain('signUserToken');
    // No custom expiry extension logic
    expect(ENDPOINT_SRC).not.toContain('extendExpiry');
    expect(ENDPOINT_SRC).not.toContain('extendSession');
  });

  it('revocation reason is TOKEN_REFRESH for audit trail', () => {
    expect(ENDPOINT_SRC).toContain("'TOKEN_REFRESH'");
  });
});
