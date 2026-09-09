// Phase B — Security tests for V-02 fix: isOriginAllowed() CORS bypass removal
//
// Tests verify:
//   1. x-capacitor-request header does NOT bypass origin checks
//   2. Allowed origins (localhost, capacitor://localhost) pass
//   3. Disallowed origins (evil.com) are rejected
//   4. Same-host origin is allowed
//   5. Empty/missing origin is rejected
//   6. setCorsHeaders() only sets ACAO for allowed origins

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import the module under test
const { isOriginAllowed, setCorsHeaders } = await import('../cors.js');

// ── Tests ─────────────────────────────────────────────────────────────────

describe('V-02: isOriginAllowed() — x-capacitor-request bypass REMOVED', () => {

  it('does NOT bypass when x-capacitor-request header is present', () => {
    // This is the CRITICAL V-02 regression test.
    // Before the fix, x-capacitor-request caused unconditional return true.
    // After the fix, origin is still validated even with this header.
    const result = isOriginAllowed(
      'https://evil.com',
      'virtumatch.vercel.app',
      { 'x-capacitor-request': 'true' }
    );
    expect(result).toBe(false);
  });

  it('does NOT bypass when x-capacitor-request + invalid origin', () => {
    const result = isOriginAllowed(
      'https://malware-site.net',
      'virtumatch.vercel.app',
      { 'x-capacitor-request': 'true', 'host': 'virtumatch.vercel.app' }
    );
    expect(result).toBe(false);
  });

  it('allows legitimate Capacitor origin even without x-capacitor-request', () => {
    // capacitor://localhost is in ALLOWED_ORIGINS — should pass normally
    const result = isOriginAllowed(
      'capacitor://localhost',
      'virtumatch.vercel.app',
      {}
    );
    expect(result).toBe(true);
  });

  it('allows https://localhost (Capacitor Android scheme)', () => {
    const result = isOriginAllowed(
      'https://localhost',
      'virtumatch.vercel.app',
      {}
    );
    expect(result).toBe(true);
  });

  it('allows http://localhost (dev server)', () => {
    const result = isOriginAllowed(
      'http://localhost',
      'virtumatch.vercel.app',
      {}
    );
    expect(result).toBe(true);
  });

  it('allows http://localhost:5173 (Vite dev)', () => {
    const result = isOriginAllowed(
      'http://localhost:5173',
      'virtumatch.vercel.app',
      {}
    );
    expect(result).toBe(true);
  });

  it('allows http://localhost:4173 (Vite preview)', () => {
    const result = isOriginAllowed(
      'http://localhost:4173',
      'virtumatch.vercel.app',
      {}
    );
    expect(result).toBe(true);
  });
});

describe('V-02: isOriginAllowed() — origin validation', () => {

  it('rejects arbitrary external origin', () => {
    const result = isOriginAllowed(
      'https://evil.com',
      'virtumatch.vercel.app',
      {}
    );
    expect(result).toBe(false);
  });

  it('rejects phishing subdomain', () => {
    const result = isOriginAllowed(
      'https://virtumatch.evil.com',
      'virtumatch.vercel.app',
      {}
    );
    expect(result).toBe(false);
  });

  it('allows same-host origin (self-referencing request)', () => {
    const result = isOriginAllowed(
      'https://virtumatch.vercel.app',
      'virtumatch.vercel.app',
      {}
    );
    expect(result).toBe(true);
  });

  it('rejects empty origin', () => {
    const result = isOriginAllowed(
      '',
      'virtumatch.vercel.app',
      {}
    );
    expect(result).toBe(false);
  });

  it('rejects malformed origin', () => {
    const result = isOriginAllowed(
      'not-a-url',
      'virtumatch.vercel.app',
      {}
    );
    expect(result).toBe(false);
  });
});

describe('V-02: setCorsHeaders() — proper CORS header application', () => {

  it('sets ACAO header for allowed origin', () => {
    const req = {
      headers: {
        origin: 'http://localhost:5173',
        host: 'virtumatch.vercel.app',
      },
    };
    const res = {
      headers: {},
      setHeader(key, val) { this.headers[key] = val; },
    };

    setCorsHeaders(req, res);

    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });

  it('does NOT set ACAO for disallowed origin', () => {
    const req = {
      headers: {
        origin: 'https://evil.com',
        host: 'virtumatch.vercel.app',
      },
    };
    const res = {
      headers: {},
      setHeader(key, val) { this.headers[key] = val; },
    };

    setCorsHeaders(req, res);

    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('sets Vary: Origin to prevent CDN cache poisoning', () => {
    const req = {
      headers: { origin: 'http://localhost', host: 'app.vercel.app' },
    };
    const res = {
      headers: {},
      setHeader(key, val) { this.headers[key] = val; },
    };

    setCorsHeaders(req, res);

    expect(res.headers['Vary']).toBe('Origin');
  });

  it('sets ACA-Max-Age to 3600 (1h, not 24h)', () => {
    const req = {
      headers: { origin: 'http://localhost', host: 'app.vercel.app' },
    };
    const res = {
      headers: {},
      setHeader(key, val) { this.headers[key] = val; },
    };

    setCorsHeaders(req, res);

    expect(res.headers['Access-Control-Max-Age']).toBe('3600');
  });

  it('does NOT bypass CORS for x-capacitor-request in setCorsHeaders', () => {
    const req = {
      headers: {
        origin: 'https://evil.com',
        host: 'virtumatch.vercel.app',
        'x-capacitor-request': 'true',
      },
    };
    const res = {
      headers: {},
      setHeader(key, val) { this.headers[key] = val; },
    };

    setCorsHeaders(req, res);

    // evil.com must NOT get ACAO even with x-capacitor-request
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
