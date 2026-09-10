// Phase B+D — Security tests for V-03: CSP (Content Security Policy)
//
// After Phase C implementation:
//   - 'unsafe-inline' is REMOVED from both script-src and style-src
//   - SHA-256 hashes replace 'unsafe-inline' for known inline content
//   - Inline style attributes in index.html are converted to CSS classes
//   - XSS protection via CSP is now EFFECTIVE

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let vercelConfig;
let cspValue;
let indexHtml;

beforeAll(() => {
  const configPath = resolve(process.cwd(), 'vercel.json');
  const raw = readFileSync(configPath, 'utf8');
  vercelConfig = JSON.parse(raw);

  // Find the CSP header value
  const globalHeaders = vercelConfig.headers?.find(h => h.source === '/(.*)');
  const cspHeader = globalHeaders?.headers?.find(h => h.key === 'Content-Security-Policy');
  cspValue = cspHeader?.value || '';

  // Read index.html
  indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
});

// ── V-03 FIX VERIFICATION: unsafe-inline REMOVED ─────────────────────────

describe('V-03 fix: unsafe-inline removed from CSP', () => {

  it('script-src does NOT contain unsafe-inline', () => {
    const scriptSrc = cspValue.match(/script-src\s+([^;]+)/)?.[1] || '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('style-src does NOT contain unsafe-inline', () => {
    const styleSrc = cspValue.match(/style-src\s+([^;]+)/)?.[1] || '';
    expect(styleSrc).not.toContain("'unsafe-inline'");
  });

  it('script-src contains SHA-256 hash for inline script', () => {
    const scriptSrc = cspValue.match(/script-src\s+([^;]+)/)?.[1] || '';
    expect(scriptSrc).toContain("'sha256-");
  });

  it('style-src contains SHA-256 hash for inline style', () => {
    const styleSrc = cspValue.match(/style-src\s+([^;]+)/)?.[1] || '';
    expect(styleSrc).toContain("'sha256-");
  });

  it('specific script hash matches inline <script> in index.html', () => {
    const scriptSrc = cspValue.match(/script-src\s+([^;]+)/)?.[1] || '';
    // Must contain the exact hash for the loading/error handler script
    expect(scriptSrc).toContain("'sha256-XWIoOnInJ3c6lKL7NZrwU9qFGcSwijhMPOi0rX4b0tw='");
  });

  it('specific style hash matches inline <style> in index.html', () => {
    const styleSrc = cspValue.match(/style-src\s+([^;]+)/)?.[1] || '';
    // Must contain the exact hash for the loading/error CSS
    expect(styleSrc).toContain("'sha256-u13w0P4wGV1/4mtD5670tcXw3DNUfQyEBmuzE+D/26c='");
  });
});

// ── V-03: Inline style attributes converted to CSS classes ────────────────

describe('V-03 fix: inline style attributes removed from index.html', () => {

  it('no inline style attributes remain in index.html', () => {
    // All style="" attributes should have been converted to CSS classes
    const styleAttrMatches = [...indexHtml.matchAll(/style="[^"]+"/g)];
    expect(styleAttrMatches.length).toBe(0);
  });

  it('SVG gradient stops use CSS classes', () => {
    expect(indexHtml).toContain('class="stop-fire-start"');
    expect(indexHtml).toContain('class="stop-fire-end"');
    expect(indexHtml).toContain('class="stop-ice-start"');
    expect(indexHtml).toContain('class="stop-ice-end"');
  });

  it('error detail uses CSS class', () => {
    expect(indexHtml).toContain('class="error-detail"');
  });

  it('CSS classes for gradient stops are defined in <style>', () => {
    expect(indexHtml).toContain('.stop-fire-start');
    expect(indexHtml).toContain('.stop-fire-end');
    expect(indexHtml).toContain('.stop-ice-start');
    expect(indexHtml).toContain('.stop-ice-end');
    expect(indexHtml).toContain('.error-detail');
  });
});

// ── CSP positive security controls ────────────────────────────────────────

describe('V-03: CSP — positive security controls', () => {

  it('sets default-src to self', () => {
    expect(cspValue).toContain("default-src 'self'");
  });

  it('sets frame-ancestors to none (clickjacking protection)', () => {
    expect(cspValue).toContain("frame-ancestors 'none'");
  });

  it('sets base-uri to self', () => {
    expect(cspValue).toContain("base-uri 'self'");
  });

  it('sets form-action to self', () => {
    expect(cspValue).toContain("form-action 'self'");
  });

  it('restricts connect-src to self and vercel.app', () => {
    const connectSrc = cspValue.match(/connect-src\s+([^;]+)/)?.[1] || '';
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain('https://*.vercel.app');
    // Should NOT contain bare wildcard (only subdomain wildcards like https://*.vercel.app are OK)
    expect(connectSrc).not.toMatch(/(^|\s)\*(\s|$)/);
  });

  it('restricts img-src appropriately', () => {
    const imgSrc = cspValue.match(/img-src\s+([^;]+)/)?.[1] || '';
    expect(imgSrc).toContain("'self'");
    expect(imgSrc).toContain('data:');
    expect(imgSrc).toContain('blob:');
    expect(imgSrc).toContain('https://lh3.googleusercontent.com');
  });

  it('includes script-src with self (CDN removed in Phase AB)', () => {
    const scriptSrc = cspValue.match(/script-src\s+([^;]+)/)?.[1] || '';
    expect(scriptSrc).toContain("'self'");
    // cdn.jsdelivr.net was removed from CSP in Phase AB (supply chain audit)
    expect(scriptSrc).not.toContain('cdn.jsdelivr.net');
  });
});

// ── Other security headers ───────────────────────────────────────────────

describe('V-03: Other security headers in vercel.json', () => {

  it('sets X-Content-Type-Options: nosniff', () => {
    const globalHeaders = vercelConfig.headers?.find(h => h.source === '/(.*)');
    const h = globalHeaders?.headers?.find(h => h.key === 'X-Content-Type-Options');
    expect(h?.value).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY', () => {
    const globalHeaders = vercelConfig.headers?.find(h => h.source === '/(.*)');
    const h = globalHeaders?.headers?.find(h => h.key === 'X-Frame-Options');
    expect(h?.value).toBe('DENY');
  });

  it('sets Referrer-Policy: strict-origin-when-cross-origin', () => {
    const globalHeaders = vercelConfig.headers?.find(h => h.source === '/(.*)');
    const h = globalHeaders?.headers?.find(h => h.key === 'Referrer-Policy');
    expect(h?.value).toBe('strict-origin-when-cross-origin');
  });

  it('sets Strict-Transport-Security with long max-age', () => {
    const globalHeaders = vercelConfig.headers?.find(h => h.source === '/(.*)');
    const h = globalHeaders?.headers?.find(h => h.key === 'Strict-Transport-Security');
    expect(h?.value).toContain('max-age=31536000');
    expect(h?.value).toContain('includeSubDomains');
  });

  it('sets Permissions-Policy denying camera, microphone, geolocation', () => {
    const globalHeaders = vercelConfig.headers?.find(h => h.source === '/(.*)');
    const h = globalHeaders?.headers?.find(h => h.key === 'Permissions-Policy');
    expect(h?.value).toContain('camera=()');
    expect(h?.value).toContain('microphone=()');
    expect(h?.value).toContain('geolocation=()');
  });
});
