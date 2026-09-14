// Phase B+D — Security tests for V-03: CSP (Content Security Policy)
//
// After CSP hardening:
//   - 'unsafe-inline' is REMOVED from script-src (XSS protection effective)
//   - style-src allows 'unsafe-inline' (required by React/Radix UI inline styles)
//   - Inline scripts moved to external files (loading-handler.js)
//   - style-src retains SHA-256 hash for the <style> block in index.html
//   - Inline style attributes in index.html are converted to CSS classes

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

  it('style-src contains unsafe-inline (required by React/Radix UI)', () => {
    const styleSrc = cspValue.match(/style-src\s+([^;]+)/)?.[1] || '';
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  it('script-src has NO inline scripts (all external files)', () => {
    const scriptSrc = cspValue.match(/script-src\s+([^;]+)/)?.[1] || '';
    // No sha256 hashes needed — all inline scripts moved to external files
    expect(scriptSrc).not.toContain("'sha256-");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('style-src contains SHA-256 hash for inline style', () => {
    const styleSrc = cspValue.match(/style-src\s+([^;]+)/)?.[1] || '';
    expect(styleSrc).toContain("'sha256-");
  });

  it('no inline <script> blocks in index.html (moved to external files)', () => {
    // All inline scripts should be external files now
    const inlineScriptMatches = [...indexHtml.matchAll(/<script(?![^>]*src=)(?![^>]*type=["']module["'])([^>]*)>[\s\S]*?<\/script>/g)];
    const nonEmptyInline = inlineScriptMatches.filter(m => m[0].replace(/<script[^>]*>/, '').replace(/<\/script>/, '').trim().length > 0);
    expect(nonEmptyInline.length).toBe(0);
  });

  it('specific style hash matches inline <style> in index.html', () => {
    const styleSrc = cspValue.match(/style-src\s+([^;]+)/)?.[1] || '';
    // Must contain the exact hash for the loading/error CSS
    expect(styleSrc).toContain("'sha256-QjTmAxQeAK1KZTv/r/v9krpmyGlvW5iHfCan6CkO3gQ='");
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
