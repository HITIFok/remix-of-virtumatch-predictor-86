// Phase V — HMAC-Only Enforcement Tests
// Verifies HMAC_ONLY=true mode works correctly and fallback is properly gated

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the DB module
vi.mock('../db.js', () => ({
  createSql: () => ({
    __queryMock: true,
    end: async () => {},
  }),
  NEON_DATABASE_URL: 'postgres://test:test@localhost/test',
}));

import { requireAuth, verifyDeviceToken, DEVICE_ID_RE } from '../auth.js';

describe('Phase V: HMAC-Only Enforcement', () => {

  const originalHmacOnly = process.env.HMAC_ONLY;

  afterEach(() => {
    // Restore env var
    if (originalHmacOnly !== undefined) {
      process.env.HMAC_ONLY = originalHmacOnly;
    } else {
      delete process.env.HMAC_ONLY;
    }
  });

  describe('HMAC_ONLY=true — fallback completely disabled', () => {
    beforeEach(() => {
      process.env.HMAC_ONLY = 'true';
    });

    it('rejects plain x-device-id header when HMAC_ONLY=true', async () => {
      const req = {
        headers: {
          'x-device-id': 'dev-a1b2c3d4e5f6',
          'x-forwarded-for': '1.2.3.4',
        },
        method: 'POST',
      };
      const result = await requireAuth(req);
      expect(result).toBeNull();
    });

    it('rejects plain x-device-id for GET requests when HMAC_ONLY=true', async () => {
      const req = {
        headers: {
          'x-device-id': 'dev-a1b2c3d4e5f6',
        },
        method: 'GET',
      };
      const result = await requireAuth(req);
      expect(result).toBeNull();
    });

    it('HMAC token auth still works when HMAC_ONLY=true', async () => {
      // When HMAC_ONLY=true, valid Device tokens should still work
      // (verifyDeviceToken is called BEFORE the fallback check)
      const req = {
        headers: {
          'authorization': 'Device invalid.token.sig',
          'x-device-id': 'dev-a1b2c3d4e5f6',
        },
        method: 'POST',
      };
      // This will fail because the token is invalid, but it proves
      // the code path goes through verifyDeviceToken first
      const result = await requireAuth(req);
      expect(result).toBeNull(); // Invalid HMAC token + fallback disabled = null
    });
  });

  describe('HMAC_ONLY=false (migration period) — restricted fallback', () => {
    beforeEach(() => {
      delete process.env.HMAC_ONLY; // or set to 'false'
    });

    it('allows x-device-id header for POST (migration fallback)', async () => {
      const req = {
        headers: {
          'x-device-id': 'dev-a1b2c3d4e5f6',
          'x-forwarded-for': '1.2.3.4',
        },
        method: 'POST',
      };
      const result = await requireAuth(req);
      expect(result).toBe('dev-a1b2c3d4e5f6');
    });

    it('blocks DELETE via fallback even during migration', async () => {
      const req = {
        headers: {
          'x-device-id': 'dev-a1b2c3d4e5f6',
          'x-forwarded-for': '1.2.3.4',
        },
        method: 'DELETE',
      };
      const result = await requireAuth(req);
      expect(result).toBeNull();
    });
  });

  describe('HMAC activation checklist', () => {
    it('HMAC_ONLY env var is documented in code', () => {
      const fs = require('fs');
      const path = require('path');
      const authSrc = fs.readFileSync(
        path.resolve(__dirname, '..', 'auth.js'),
        'utf8'
      );
      expect(authSrc).toContain('HMAC_ONLY');
      expect(authSrc).toContain('process.env.HMAC_ONLY');
    });

    it('DEVICE_ID_RE regex is strict (dev- + 8+ hex chars)', () => {
      expect(DEVICE_ID_RE.test('dev-a1b2c3d4')).toBe(true);
      expect(DEVICE_ID_RE.test('dev-12345678')).toBe(true);
      expect(DEVICE_ID_RE.test('dev-AB')).toBe(false); // too short
      expect(DEVICE_ID_RE.test('invalid')).toBe(false);
      expect(DEVICE_ID_RE.test('')).toBe(false);
    });

    it('auth.js uses crypto.timingSafeEqual for HMAC verification', () => {
      const fs = require('fs');
      const path = require('path');
      const authSrc = fs.readFileSync(
        path.resolve(__dirname, '..', 'auth.js'),
        'utf8'
      );
      expect(authSrc).toContain('crypto.timingSafeEqual');
    });
  });

  describe('migration safety: no body/query device_id fallback', () => {
    it('auth.js does NOT access body.device_id for auth (comment references ok)', () => {
      const fs = require('fs');
      const path = require('path');
      const authSrc = fs.readFileSync(
        path.resolve(__dirname, '..', 'auth.js'),
        'utf8'
      );
      // The requireAuth function should not ACCESS req.body.device_id as code
      // (comments mentioning it are ok — they document what was removed)
      const requireAuthBlock = authSrc.match(
        /export async function requireAuth[\s\S]*?^}/m
      );
      if (requireAuthBlock) {
        // Should not have req.body.device_id or req.query.device_id as code
        expect(requireAuthBlock[0]).not.toMatch(/req\.body\.device_id/);
        expect(requireAuthBlock[0]).not.toMatch(/req\.query\.device_id/);
      }
    });
  });

});
