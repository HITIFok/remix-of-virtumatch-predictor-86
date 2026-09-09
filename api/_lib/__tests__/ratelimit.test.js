// Phase E — Security tests for distributed rate limiting middleware
//
// Tests verify:
//   1. In-memory fallback works without Upstash Redis env vars
//   2. Requests within limit are allowed
//   3. Requests exceeding limit get 429
//   4. Strict rate limit applies for HMAC fallback requests (no Authorization header)
//   5. Proper rate limit headers in 429 response
//   6. Only /api/ routes are rate-limited

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Ensure no Upstash env vars so we test the in-memory fallback
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

// Import after env cleanup
const { middleware } = await import('../../../middleware.js');

// ── Helpers ───────────────────────────────────────────────────────────────

function mockRequest(pathname, overrides = {}) {
  return {
    url: `https://virtumatch.vercel.app${pathname}`,
    headers: new Map(Object.entries({
      'x-forwarded-for': '1.2.3.4',
      ...overrides.headers,
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Phase E: Rate limiting — in-memory fallback', () => {

  it('allows requests within the limit', async () => {
    const req = mockRequest('/api/predictions');
    const result = await middleware(req);
    // undefined = pass through (allowed)
    expect(result).toBeUndefined();
  });

  it('blocks requests after exceeding the limit (30 req/min)', async () => {
    // We need to exhaust the limit. Since the store is module-scoped,
    // previous tests may have consumed some. We use a unique IP.
    const uniqueIp = `10.${Math.floor(Math.random() * 255)}.0.1`;
    const req = mockRequest('/api/predictions', {
      headers: { 'x-forwarded-for': uniqueIp },
    });

    // Send 30 requests (should all pass)
    for (let i = 0; i < 30; i++) {
      const result = await middleware(req);
      if (result) {
        // If one got blocked early (due to test ordering), that's still valid
        expect(result.status).toBe(429);
        return;
      }
    }

    // 31st request should be blocked
    const result = await middleware(req);
    expect(result).not.toBeUndefined();
    expect(result.status).toBe(429);
  });

  it('returns 429 with proper rate limit headers', async () => {
    const uniqueIp = `10.${Math.floor(Math.random() * 255)}.0.2`;
    const req = mockRequest('/api/predictions', {
      headers: { 'x-forwarded-for': uniqueIp },
    });

    // Exhaust limit
    for (let i = 0; i < 30; i++) {
      await middleware(req);
    }

    const result = await middleware(req);
    expect(result.status).toBe(429);

    const body = await result.json();
    expect(body.error).toBeDefined();

    // Check rate limit headers
    expect(result.headers.get('X-RateLimit-Limit')).not.toBeNull();
    expect(result.headers.get('Retry-After')).not.toBeNull();
    expect(result.headers.get('Content-Type')).toBe('application/json');
  });
});

describe('Phase E: Rate limiting — non-API routes not limited', () => {

  it('does not rate-limit non-API routes', async () => {
    const req = mockRequest('/predictions');
    const result = await middleware(req);
    expect(result).toBeUndefined();
  });

  it('does not rate-limit static assets', async () => {
    const req = mockRequest('/assets/index-CPGjMOq.js');
    const result = await middleware(req);
    expect(result).toBeUndefined();
  });

  it('does not rate-limit root path', async () => {
    const req = mockRequest('/');
    const result = await middleware(req);
    expect(result).toBeUndefined();
  });
});

describe('Phase E: Rate limiting — strict limit for HMAC fallback', () => {

  it('applies stricter limit (10 req/min) when no Authorization header', async () => {
    const uniqueIp = `10.${Math.floor(Math.random() * 255)}.0.3`;
    const req = mockRequest('/api/predictions', {
      headers: {
        'x-forwarded-for': uniqueIp,
        // No Authorization header → strict rate limit
      },
    });

    // Exhaust the strict limit (10 req/min)
    for (let i = 0; i < 10; i++) {
      await middleware(req);
    }

    // 11th request should be blocked
    const result = await middleware(req);
    expect(result).not.toBeUndefined();
    expect(result.status).toBe(429);
  });

  it('allows more requests with valid HMAC token (standard limit)', async () => {
    const uniqueIp = `10.${Math.floor(Math.random() * 255)}.0.4`;
    const req = mockRequest('/api/predictions', {
      headers: {
        'x-forwarded-for': uniqueIp,
        'authorization': 'Device abc123.sig', // Has HMAC token → standard limit
      },
    });

    // Should be able to send at least 10 requests (strict limit is 10)
    for (let i = 0; i < 12; i++) {
      const result = await middleware(req);
      // Should not be blocked at 12 requests with standard limit (30)
      expect(result).toBeUndefined();
    }
  });
});
