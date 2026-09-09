// Phase R — Security Headers Tests
//
// Tests verify:
//   1. All OWASP-recommended security headers present in vercel.json
//   2. HSTS with proper max-age and includeSubDomains
//   3. X-Frame-Options: DENY (no clickjacking)
//   4. X-Content-Type-Options: nosniff (no MIME sniffing)
//   5. Referrer-Policy: strict-origin-when-cross-origin
//   6. Permissions-Policy restricting dangerous features
//   7. Cache headers for static assets

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cwd = process.cwd();

const vercelSrc = readFileSync(resolve(cwd, 'vercel.json'), 'utf8');
const vercelConfig = JSON.parse(vercelSrc);

// Find the global headers block (source: "/(.*)")
const globalHeaders = vercelConfig.headers?.find(h => h.source === '/(.*)')?.headers || [];

function getHeaderValue(key) {
  const header = globalHeaders.find(h => h.key === key);
  return header?.value || null;
}

// ── OWASP Recommended Headers ────────────────────────────────────────────

describe('Phase R: OWASP-recommended security headers', () => {

  it('Strict-Transport-Security (HSTS) is set', () => {
    const hsts = getHeaderValue('Strict-Transport-Security');
    expect(hsts).toBeTruthy();
    expect(hsts).toContain('max-age=');
    expect(hsts).toContain('includeSubDomains');
  });

  it('HSTS max-age is at least 1 year (31536000 seconds)', () => {
    const hsts = getHeaderValue('Strict-Transport-Security');
    const maxAge = parseInt(hsts.match(/max-age=(\d+)/)?.[1] || '0');
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
  });

  it('X-Content-Type-Options: nosniff', () => {
    expect(getHeaderValue('X-Content-Type-Options')).toBe('nosniff');
  });

  it('X-Frame-Options: DENY (prevents clickjacking)', () => {
    expect(getHeaderValue('X-Frame-Options')).toBe('DENY');
  });

  it('X-XSS-Protection: 1; mode=block (legacy browser protection)', () => {
    const value = getHeaderValue('X-XSS-Protection');
    expect(value).toContain('1');
    expect(value).toContain('mode=block');
  });

  it('Referrer-Policy: strict-origin-when-cross-origin', () => {
    expect(getHeaderValue('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});

// ── Permissions Policy ───────────────────────────────────────────────────

describe('Phase R: Permissions-Policy restricts dangerous features', () => {

  it('Permissions-Policy header is set', () => {
    expect(getHeaderValue('Permissions-Policy')).toBeTruthy();
  });

  it('camera access is disabled', () => {
    expect(getHeaderValue('Permissions-Policy')).toContain('camera=()');
  });

  it('microphone access is disabled', () => {
    expect(getHeaderValue('Permissions-Policy')).toContain('microphone=()');
  });

  it('geolocation access is disabled', () => {
    expect(getHeaderValue('Permissions-Policy')).toContain('geolocation=()');
  });
});

// ── CSP Verification (Phase C) ──────────────────────────────────────────

describe('Phase R: CSP is comprehensive and strict', () => {

  it('Content-Security-Policy header is set', () => {
    expect(getHeaderValue('Content-Security-Policy')).toBeTruthy();
  });

  it('CSP includes frame-ancestors none (supplements X-Frame-Options)', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('CSP includes base-uri self (prevents base tag injection)', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    expect(csp).toContain("base-uri 'self'");
  });

  it('CSP includes form-action self (prevents form hijacking)', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    expect(csp).toContain("form-action 'self'");
  });

  it('CSP default-src is self', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    expect(csp).toContain("default-src 'self'");
  });

  it('CSP does NOT contain unsafe-eval', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('CSP does NOT contain unsafe-inline in script-src', () => {
    const csp = getHeaderValue('Content-Security-Policy');
    // Parse script-src directive
    const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] || '';
    expect(scriptSrc).not.toContain('unsafe-inline');
  });
});

// ── Static Asset Caching ─────────────────────────────────────────────────

describe('Phase R: Static asset caching', () => {

  const assetHeaders = vercelConfig.headers?.find(h => h.source === '/assets/(.*)')?.headers || [];

  it('assets have long cache duration (immutable)', () => {
    const cc = assetHeaders.find(h => h.key === 'Cache-Control');
    expect(cc).toBeTruthy();
    expect(cc.value).toContain('max-age=31536000');
    expect(cc.value).toContain('immutable');
  });
});

// ── No Missing Headers ───────────────────────────────────────────────────

describe('Phase R: No missing security headers', () => {

  const REQUIRED_HEADERS = [
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'X-XSS-Protection',
    'Referrer-Policy',
    'Permissions-Policy',
    'Content-Security-Policy',
  ];

  for (const header of REQUIRED_HEADERS) {
    it(`${header} is present`, () => {
      const keys = globalHeaders.map(h => h.key);
      expect(keys).toContain(header);
    });
  }
});
