// Phase AK — Token Revocation & Session Invalidation Tests
import { describe, it, expect, beforeEach } from 'vitest';
import {
  REVOCABLE_TOKEN_TYPES,
  REVOCATION_REASONS,
  hashTokenForBlacklist,
  revokeToken,
  revokeDeviceTokens,
  revokeUserSessions,
  isTokenRevoked,
  isDeviceRevoked,
  isUserRevoked,
  unrevokeToken,
  getBlacklistStats,
  _clearBlacklist,
  GAPS_ADDRESSED,
} from '../token-revocation.js';

beforeEach(() => {
  _clearBlacklist();
});

// ─── Token Hashing ────────────────────────────────────────────────────────

describe('Phase AK: Token Hashing', () => {
  it('produces SHA-256 hex hash', () => {
    const hash = hashTokenForBlacklist('test-token-123');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('same token produces same hash (deterministic)', () => {
    const h1 = hashTokenForBlacklist('my-token');
    const h2 = hashTokenForBlacklist('my-token');
    expect(h1).toBe(h2);
  });

  it('different tokens produce different hashes', () => {
    const h1 = hashTokenForBlacklist('token-a');
    const h2 = hashTokenForBlacklist('token-b');
    expect(h1).not.toBe(h2);
  });

  it('returns null for empty/invalid input', () => {
    expect(hashTokenForBlacklist('')).toBeNull();
    expect(hashTokenForBlacklist(null)).toBeNull();
    expect(hashTokenForBlacklist(undefined)).toBeNull();
    expect(hashTokenForBlacklist(123)).toBeNull();
  });
});

// ─── Token Revocation ─────────────────────────────────────────────────────

describe('Phase AK: Token Revocation', () => {
  it('revokes a valid token', () => {
    const result = revokeToken('my-hmac-token', REVOCATION_REASONS.SECURITY_INCIDENT);
    expect(result.success).toBe(true);
    expect(result.id).toMatch(/^rev-/);
    expect(result.tokenHash).toBeTruthy();
  });

  it('rejects invalid token input', () => {
    const result = revokeToken('', REVOCATION_REASONS.USER_REQUEST);
    expect(result.success).toBe(false);
  });

  it('rejects invalid reason', () => {
    const result = revokeToken('my-token', 'INVALID_REASON');
    expect(result.success).toBe(false);
  });

  it('revoked token is detected by isTokenRevoked', () => {
    revokeToken('compromised-token', REVOCATION_REASONS.SECURITY_INCIDENT);
    const check = isTokenRevoked('compromised-token');
    expect(check.revoked).toBe(true);
    expect(check.reason).toBe(REVOCATION_REASONS.SECURITY_INCIDENT);
  });

  it('non-revoked token is not flagged', () => {
    const check = isTokenRevoked('clean-token');
    expect(check.revoked).toBe(false);
  });

  it('stores all revocation reasons', () => {
    const reasons = Object.values(REVOCATION_REASONS);
    for (const reason of reasons) {
      const result = revokeToken(`token-${reason}`, reason);
      expect(result.success).toBe(true);
    }
  });
});

// ─── Device-Level Revocation ──────────────────────────────────────────────

describe('Phase AK: Device-Level Revocation', () => {
  it('revokes all tokens for a device', () => {
    const result = revokeDeviceTokens('dev-abc12345', REVOCATION_REASONS.SECURITY_INCIDENT);
    expect(result.success).toBe(true);
    expect(result.id).toMatch(/^dev-rev-/);
  });

  it('revoked device is detected by isDeviceRevoked', () => {
    revokeDeviceTokens('dev-victim123', REVOCATION_REASONS.ADMIN_ACTION);
    const check = isDeviceRevoked('dev-victim123');
    expect(check.revoked).toBe(true);
    expect(check.reason).toBe(REVOCATION_REASONS.ADMIN_ACTION);
  });

  it('non-revoked device is not flagged', () => {
    const check = isDeviceRevoked('dev-clean1234');
    expect(check.revoked).toBe(false);
  });

  it('rejects invalid device ID', () => {
    const result = revokeDeviceTokens('', REVOCATION_REASONS.USER_REQUEST);
    expect(result.success).toBe(false);
  });
});

// ─── User Session Revocation ──────────────────────────────────────────────

describe('Phase AK: User Session Revocation', () => {
  it('revokes all sessions for a user', () => {
    const result = revokeUserSessions('user-uuid-123', REVOCATION_REASONS.USER_REQUEST);
    expect(result.success).toBe(true);
    expect(result.id).toMatch(/^user-rev-/);
  });

  it('revoked user is detected by isUserRevoked', () => {
    revokeUserSessions('user-uuid-456', REVOCATION_REASONS.SECURITY_INCIDENT);
    const check = isUserRevoked('user-uuid-456');
    expect(check.revoked).toBe(true);
    expect(check.reason).toBe(REVOCATION_REASONS.SECURITY_INCIDENT);
  });

  it('non-revoked user is not flagged', () => {
    const check = isUserRevoked('user-uuid-789');
    expect(check.revoked).toBe(false);
  });

  it('rejects invalid user ID', () => {
    const result = revokeUserSessions('', REVOCATION_REASONS.USER_REQUEST);
    expect(result.success).toBe(false);
  });
});

// ─── Token Unrevocation ───────────────────────────────────────────────────

describe('Phase AK: Token Unrevocation', () => {
  it('removes a token from the blacklist', () => {
    revokeToken('temp-revoked', REVOCATION_REASONS.SECRET_ROTATION);
    expect(isTokenRevoked('temp-revoked').revoked).toBe(true);

    const removed = unrevokeToken('temp-revoked');
    expect(removed).toBe(true);
    expect(isTokenRevoked('temp-revoked').revoked).toBe(false);
  });

  it('returns false for non-blacklisted token', () => {
    const removed = unrevokeToken('never-revoked');
    expect(removed).toBe(false);
  });
});

// ─── Blacklist Statistics ─────────────────────────────────────────────────

describe('Phase AK: Blacklist Statistics', () => {
  it('reports empty blacklist initially', () => {
    const stats = getBlacklistStats();
    expect(stats.totalEntries).toBe(0);
    expect(stats.activeEntries).toBe(0);
  });

  it('tracks active entries by reason', () => {
    revokeToken('t1', REVOCATION_REASONS.SECURITY_INCIDENT);
    revokeToken('t2', REVOCATION_REASONS.USER_REQUEST);
    revokeToken('t3', REVOCATION_REASONS.SECURITY_INCIDENT);

    const stats = getBlacklistStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.activeEntries).toBe(3);
    expect(stats.byReason[REVOCATION_REASONS.SECURITY_INCIDENT]).toBe(2);
    expect(stats.byReason[REVOCATION_REASONS.USER_REQUEST]).toBe(1);
  });

  it('reports max entries limit', () => {
    const stats = getBlacklistStats();
    expect(stats.maxEntries).toBe(50000);
  });
});

// ─── GAP Resolution ───────────────────────────────────────────────────────

describe('Phase AK: GAP Resolution', () => {
  it('addresses GAP-01 (token revocation)', () => {
    const gap = GAPS_ADDRESSED.find(g => g.gapId === 'GAP-01');
    expect(gap).toBeTruthy();
    expect(gap.status).toBe('IMPLEMENTED');
  });

  it('addresses GAP-02 (session revocation)', () => {
    const gap = GAPS_ADDRESSED.find(g => g.gapId === 'GAP-02');
    expect(gap).toBeTruthy();
    expect(gap.status).toBe('IMPLEMENTED');
  });

  it('both gaps are HIGH severity', () => {
    for (const gap of GAPS_ADDRESSED) {
      expect(gap.severity).toBe('HIGH');
    }
  });
});

// ─── Revocable Token Types ────────────────────────────────────────────────

describe('Phase AK: Revocable Token Types', () => {
  it('includes DEVICE_HMAC, USER_SESSION, ADMIN_SESSION', () => {
    expect(REVOCABLE_TOKEN_TYPES.DEVICE_HMAC).toBe('DEVICE_HMAC');
    expect(REVOCABLE_TOKEN_TYPES.USER_SESSION).toBe('USER_SESSION');
    expect(REVOCABLE_TOKEN_TYPES.ADMIN_SESSION).toBe('ADMIN_SESSION');
  });

  it('excludes MAGIC_LINK (single-use, inherently safe)', () => {
    expect(REVOCABLE_TOKEN_TYPES.MAGIC_LINK).toBeUndefined();
  });
});
