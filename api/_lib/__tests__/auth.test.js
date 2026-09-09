// Phase B — Security tests for V-01 fix: requireAuth() HMAC migration
//
// Tests verify:
//   1. HMAC token auth is the primary path
//   2. HMAC_ONLY=true completely disables the legacy fallback
//   3. HMAC_ONLY=false allows RESTRICTED fallback (no DELETE, x-device-id header only)
//   4. body.device_id and query.device_id fallbacks are REMOVED
//   5. DELETE requests are BLOCKED via fallback even during migration
//   6. Fallback usage triggers console.warn for monitoring

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock database before importing auth ───────────────────────────────────
// verifyDeviceToken() calls createSql() → postgres query. We mock the entire
// DB layer so tests run without a real Neon connection.

const mockQueryResult = { rows: [] };
const mockSql = vi.fn(() => Promise.resolve([mockQueryResult]));
mockSql.end = vi.fn(() => Promise.resolve());

vi.mock('../db.js', () => ({
  createSql: () => mockSql,
}));

// Import after mock setup
const { requireAuth, verifyDeviceToken, DEVICE_ID_RE } = await import('../auth.js');
import crypto from 'crypto';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Create a valid HMAC device token for testing */
function createTestToken(deviceId, secret, timestamp = Date.now()) {
  const message = `${deviceId}:${timestamp}`;
  const sig = crypto.createHmac('sha256', secret).update(message).digest();
  const tsB64 = Buffer.from(String(timestamp)).toString('base64url');
  const sigB64 = sig.toString('base64url');
  return `${tsB64}.${sigB64}`;
}

/** Create a mock request object */
function mockReq(overrides = {}) {
  return {
    method: 'GET',
    headers: {
      'x-forwarded-for': '1.2.3.4',
      ...overrides.headers,
    },
    body: overrides.body || {},
    query: overrides.query || {},
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('V-01: requireAuth() — HMAC device token auth', () => {
  const ORIGINAL_HMAC_ONLY = process.env.HMAC_ONLY;

  afterEach(() => {
    // Restore HMAC_ONLY env var
    if (ORIGINAL_HMAC_ONLY !== undefined) {
      process.env.HMAC_ONLY = ORIGINAL_HMAC_ONLY;
    } else {
      delete process.env.HMAC_ONLY;
    }
    vi.restoreAllMocks();
  });

  // ── 1. HMAC_ONLY=true: fallback COMPLETELY disabled ────────────────────

  describe('HMAC_ONLY=true (migration complete)', () => {
    beforeEach(() => {
      process.env.HMAC_ONLY = 'true';
    });

    it('rejects plain x-device-id header when HMAC_ONLY=true', async () => {
      const req = mockReq({
        headers: {
          'x-device-id': 'dev-a1b2c3d4',
          // No Authorization header → verifyDeviceToken fails
        },
      });

      const result = await requireAuth(req);
      expect(result).toBeNull();
    });

    it('rejects DELETE even with x-device-id when HMAC_ONLY=true', async () => {
      const req = mockReq({
        headers: { 'x-device-id': 'dev-a1b2c3d4' },
      });
      req.method = 'DELETE';

      const result = await requireAuth(req);
      expect(result).toBeNull();
    });

    it('rejects POST with x-device-id when HMAC_ONLY=true', async () => {
      const req = mockReq({
        headers: { 'x-device-id': 'dev-a1b2c3d4' },
      });
      req.method = 'POST';

      const result = await requireAuth(req);
      expect(result).toBeNull();
    });
  });

  // ── 2. HMAC_ONLY=false: RESTRICTED fallback during migration ───────────

  describe('HMAC_ONLY=false (migration period — restricted fallback)', () => {
    beforeEach(() => {
      process.env.HMAC_ONLY = 'false';
    });

    it('accepts x-device-id header for GET requests (migration fallback)', async () => {
      const req = mockReq({
        headers: { 'x-device-id': 'dev-a1b2c3d4' },
      });

      const result = await requireAuth(req);
      expect(result).toBe('dev-a1b2c3d4');
    });

    it('accepts x-device-id header for POST requests (migration fallback)', async () => {
      const req = mockReq({
        headers: { 'x-device-id': 'dev-a1b2c3d4' },
      });
      req.method = 'POST';

      const result = await requireAuth(req);
      expect(result).toBe('dev-a1b2c3d4');
    });

    it('BLOCKS DELETE via fallback — destructive ops require HMAC', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const req = mockReq({
        headers: { 'x-device-id': 'dev-a1b2c3d4' },
      });
      req.method = 'DELETE';

      const result = await requireAuth(req);
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('BLOCKED')
      );
    });

    it('rejects invalid device_id format even during migration', async () => {
      const req = mockReq({
        headers: { 'x-device-id': 'invalid-id' },
      });

      const result = await requireAuth(req);
      expect(result).toBeNull();
    });

    it('rejects empty x-device-id', async () => {
      const req = mockReq({
        headers: { 'x-device-id': '' },
      });

      const result = await requireAuth(req);
      expect(result).toBeNull();
    });

    it('rejects missing x-device-id entirely', async () => {
      const req = mockReq();

      const result = await requireAuth(req);
      expect(result).toBeNull();
    });
  });

  // ── 3. body.device_id and query.device_id fallbacks REMOVED ───────────

  describe('Legacy fallback vectors removed', () => {
    beforeEach(() => {
      process.env.HMAC_ONLY = 'false';
    });

    it('does NOT accept device_id from request body', async () => {
      const req = mockReq({
        body: { device_id: 'dev-a1b2c3d4' },
      });

      const result = await requireAuth(req);
      expect(result).toBeNull();
    });

    it('does NOT accept device_id from query string', async () => {
      const req = mockReq({
        query: { device_id: 'dev-a1b2c3d4' },
      });

      const result = await requireAuth(req);
      expect(result).toBeNull();
    });

    it('does NOT accept device_id from body even when header is missing', async () => {
      const req = mockReq({
        body: { device_id: 'dev-bodyhack1' },
      });

      const result = await requireAuth(req);
      expect(result).toBeNull();
    });
  });

  // ── 4. Fallback logging for abuse detection ────────────────────────────

  describe('Fallback monitoring', () => {
    beforeEach(() => {
      process.env.HMAC_ONLY = 'false';
    });

    it('logs warning with device_id, method, and IP on fallback use', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const req = mockReq({
        headers: {
          'x-device-id': 'dev-monitor1',
          'x-forwarded-for': '10.20.30.40',
        },
      });
      req.method = 'GET';

      await requireAuth(req);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('FALLBACK')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('dev-monitor1')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('GET')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('10.20.30.40')
      );
    });
  });
});

// ── verifyDeviceToken() unit tests ────────────────────────────────────────

describe('V-01: verifyDeviceToken() — HMAC token verification', () => {
  const TEST_SECRET = 'a'.repeat(64); // 32 bytes = 64 hex chars
  const TEST_DEVICE_ID = 'dev-test0001';

  beforeEach(() => {
    // Mock DB to return our test secret
    mockSql.mockReset();
    mockSql.end.mockReset();
    mockSql.mockResolvedValue([{ device_secret: TEST_SECRET }]);
    mockSql.end.mockResolvedValue(undefined);
  });

  it('accepts a valid HMAC token', async () => {
    const token = createTestToken(TEST_DEVICE_ID, TEST_SECRET);
    const req = mockReq({
      headers: {
        'authorization': `Device ${token}`,
        'x-device-id': TEST_DEVICE_ID,
      },
    });

    const result = await verifyDeviceToken(req);
    expect(result.valid).toBe(true);
    expect(result.deviceId).toBe(TEST_DEVICE_ID);
  });

  it('rejects missing Authorization header', async () => {
    const req = mockReq();
    const result = await verifyDeviceToken(req);
    expect(result.valid).toBe(false);
  });

  it('rejects wrong prefix (not "Device ")', async () => {
    const req = mockReq({
      headers: { 'authorization': 'Bearer some-token' },
    });
    const result = await verifyDeviceToken(req);
    expect(result.valid).toBe(false);
  });

  it('rejects expired token (timestamp > 7 days ago)', async () => {
    const expiredTimestamp = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
    const token = createTestToken(TEST_DEVICE_ID, TEST_SECRET, expiredTimestamp);
    const req = mockReq({
      headers: {
        'authorization': `Device ${token}`,
        'x-device-id': TEST_DEVICE_ID,
      },
    });

    const result = await verifyDeviceToken(req);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('rejects invalid signature (tampered token)', async () => {
    const token = createTestToken(TEST_DEVICE_ID, TEST_SECRET);
    // Tamper with the signature part
    const [ts, _sig] = token.split('.');
    const tamperedToken = `${ts}.AAAAAAtampered`;
    const req = mockReq({
      headers: {
        'authorization': `Device ${tamperedToken}`,
        'x-device-id': TEST_DEVICE_ID,
      },
    });

    const result = await verifyDeviceToken(req);
    expect(result.valid).toBe(false);
  });

  it('rejects token for unregistered device (no secret in DB)', async () => {
    mockSql.mockResolvedValue([]); // No secret found

    const token = createTestToken('dev-unreg01', TEST_SECRET);
    const req = mockReq({
      headers: {
        'authorization': `Device ${token}`,
        'x-device-id': 'dev-unreg01',
      },
    });

    const result = await verifyDeviceToken(req);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not registered');
  });

  it('rejects malformed token (not 2 parts)', async () => {
    const req = mockReq({
      headers: { 'authorization': 'Device onepart' },
    });
    const result = await verifyDeviceToken(req);
    expect(result.valid).toBe(false);
  });
});

// ── DEVICE_ID_RE regex validation ─────────────────────────────────────────

describe('DEVICE_ID_RE — device ID format validation', () => {
  it('accepts valid device IDs', () => {
    expect(DEVICE_ID_RE.test('dev-a1b2c3d4')).toBe(true);
    expect(DEVICE_ID_RE.test('dev-abcdefgh')).toBe(true);
    expect(DEVICE_ID_RE.test('dev-12345678')).toBe(true);
    expect(DEVICE_ID_RE.test('dev-a1b2c3d4e5')).toBe(true); // >8 chars OK
  });

  it('rejects invalid device IDs', () => {
    expect(DEVICE_ID_RE.test('dev-abc')).toBe(false);       // Too short
    expect(DEVICE_ID_RE.test('dev-A1B2C3D4')).toBe(false);  // Uppercase
    expect(DEVICE_ID_RE.test('device-abc')).toBe(false);    // Wrong prefix
    expect(DEVICE_ID_RE.test('dev-a1b2c3d!')).toBe(false);  // Special char
    expect(DEVICE_ID_RE.test('')).toBe(false);               // Empty
    expect(DEVICE_ID_RE.test('dev-')).toBe(false);           // No hex part
  });
});
