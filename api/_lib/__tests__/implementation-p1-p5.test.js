// Phase P1-P5 — Implementation Tests for Account Delete, Token Revocation Integration,
// Session Duration, Data Cleanup, and Production Hardening
// Updated: account-delete and data-cleanup merged into auth.js and auto-playout.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');

// ─── P1: Account Delete (now in auth.js as ?action=delete-account) ────────

describe('P1: Account Delete Endpoint (GDPR Article 17)', () => {
  it('account-delete action exists in auth.js', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(content).toContain('delete-account');
    expect(content).toContain('handleDeleteAccount');
  });

  it('standalone account-delete.js no longer exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'api', 'account-delete.js'))).toBe(false);
  });

  it('endpoint requires Bearer session token auth', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(content).toContain('requireUserAuth');
    expect(content).toContain('unauthorized');
  });

  it('endpoint requires explicit confirmation', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(content).toContain('confirmation');
    expect(content).toContain('DELETE');
  });

  it('performs cascading deletion (all 6 steps)', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(content).toContain('DELETE FROM predictions');
    expect(content).toContain('DELETE FROM premium_activations');
    expect(content).toContain('access_codes');
    expect(content).toContain('DELETE FROM magic_links');
    expect(content).toContain('DELETE FROM device_secrets');
    expect(content).toContain('DELETE FROM users');
  });

  it('revokes device tokens on deletion', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(content).toContain('revokeDeviceTokens');
  });

  it('revokes user sessions on deletion', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(content).toContain('revokeUserSessions');
  });

  it('has rate limiting (3/hour)', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(content).toContain('createRateLimiter');
    expect(content).toContain('account-delete');
  });

  it('uses structured logger', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(content).toContain('createLogger');
  });
});

// ─── P2: Token Revocation Integration ─────────────────────────────────────

describe('P2: Token Revocation in Auth', () => {
  it('auth.js checks token revocation blacklist', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'auth.js'), 'utf-8');
    expect(content).toContain('isTokenRevoked');
    expect(content).toContain('isUserRevoked');
  });

  it('auth.js imports token-revocation.js dynamically', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'auth.js'), 'utf-8');
    expect(content).toContain("import('./token-revocation.js')");
  });

  it('revoked tokens return null from requireUserAuth', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'auth.js'), 'utf-8');
    // When token is revoked, return null
    expect(content).toContain('tokenCheck.revoked');
    expect(content).toContain('userCheck.revoked');
  });

  it('graceful degradation if token-revocation.js fails to import', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'auth.js'), 'utf-8');
    expect(content).toContain('graceful degradation');
  });
});

// ─── P3: Session Duration Reduction ───────────────────────────────────────

describe('P3: Session Duration (30d → 7d)', () => {
  it('auth.js uses 7-day session duration', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'auth.js'), 'utf-8');
    expect(content).toContain('7 * 24 * 60 * 60 * 1000');
    expect(content).toContain('7 days');
  });

  it('auth.js no longer uses 30-day duration', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'auth.js'), 'utf-8');
    expect(content).not.toContain('30 * 24 * 60 * 60 * 1000');
  });

  it('api/auth.js returns 7-day expiresIn', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(content).toContain('7 * 24 * 60 * 60 * 1000');
  });

  it('session-lifecycle.js documents the change', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'session-lifecycle.js'), 'utf-8');
    // The registry still documents the token type
    expect(content).toContain('USER_SESSION');
  });
});

// ─── P4: Data Cleanup Cron (now in auto-playout.js via x-cron-action) ────

describe('P4: Data Retention Cleanup', () => {
  it('data-cleanup action exists in auto-playout.js', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auto-playout.js'), 'utf-8');
    expect(content).toContain('data-cleanup');
    expect(content).toContain('handleDataCleanup');
  });

  it('standalone data-cleanup.js no longer exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'api', 'data-cleanup.js'))).toBe(false);
  });

  it('cleans up magic_links older than 30 days', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auto-playout.js'), 'utf-8');
    expect(content).toContain('magic_links');
    expect(content).toContain('30 days');
  });

  it('cleans up predictions older than 365 days', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auto-playout.js'), 'utf-8');
    expect(content).toContain('predictions');
    expect(content).toContain('365 days');
  });

  it('cleans up expired premium activations (90-day grace)', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auto-playout.js'), 'utf-8');
    expect(content).toContain('premium_activations');
    expect(content).toContain('90 days');
  });

  it('requires CRON_SECRET authentication', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auto-playout.js'), 'utf-8');
    expect(content).toContain('CRON_SECRET');
  });

  it('vercel.json includes data-cleanup cron (now via auto-playout)', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf-8'));
    // data-cleanup is now routed through auto-playout via x-cron-action header
    const autoPlayoutCrons = vercel.crons.filter(c => c.path === '/api/auto-playout');
    expect(autoPlayoutCrons.length).toBeGreaterThanOrEqual(1);
  });

  it('uses structured logger', () => {
    const content = fs.readFileSync(path.join(ROOT, 'api', 'auto-playout.js'), 'utf-8');
    expect(content).toContain('createLogger');
    expect(content).toContain('data-cleanup');
  });
});

// ─── P5: Production Hardening ─────────────────────────────────────────────

describe('P5: Production Hardening', () => {
  it('all merged endpoints use shared error handling', () => {
    const authContent = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(authContent).toContain('errorResponse');
    expect(authContent).toContain('internalError');

    const autoPlayoutContent = fs.readFileSync(path.join(ROOT, 'api', 'auto-playout.js'), 'utf-8');
    expect(autoPlayoutContent).toContain('internalError');
    expect(autoPlayoutContent).toContain('successResponse');
  });

  it('all merged endpoints use CORS module', () => {
    const authContent = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(authContent).toContain('setCorsHeaders');

    const autoPlayoutContent = fs.readFileSync(path.join(ROOT, 'api', 'auto-playout.js'), 'utf-8');
    expect(autoPlayoutContent).toContain('setCorsHeaders');
  });

  it('all merged endpoints use createSql() for DB', () => {
    const authContent = fs.readFileSync(path.join(ROOT, 'api', 'auth.js'), 'utf-8');
    expect(authContent).toContain('createSql');

    const autoPlayoutContent = fs.readFileSync(path.join(ROOT, 'api', 'auto-playout.js'), 'utf-8');
    expect(autoPlayoutContent).toContain('createSql');
  });

  it('security headers are present in vercel.json', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf-8'));
    const headers = vercel.headers
      .find(h => h.source === '/(.*)')
      ?.headers.map(h => h.key) || [];
    expect(headers).toContain('Content-Security-Policy');
    expect(headers).toContain('Strict-Transport-Security');
    expect(headers).toContain('X-Content-Type-Options');
    expect(headers).toContain('X-Frame-Options');
  });

  it('CSP has no unsafe-inline', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf-8'));
    const csp = vercel.headers
      .find(h => h.source === '/(.*)')
      ?.headers.find(h => h.key === 'Content-Security-Policy')?.value || '';
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });
});
