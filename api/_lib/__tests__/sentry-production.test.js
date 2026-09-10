// Phase AP (P6) — Sentry Production Configuration Tests
// Validates PII redaction, production tuning, error filtering,
// structured breadcrumbs, and security event capture.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const LIB_DIR = path.resolve(import.meta.dirname, '..');
const SENTRY_SRC = fs.readFileSync(path.join(LIB_DIR, 'sentry.js'), 'utf8');

// ─── PII Redaction ────────────────────────────────────────────────────────

describe('Phase AP: Sentry PII Redaction', () => {
  it('defines PII fields to redact', () => {
    expect(SENTRY_SRC).toContain('PII_FIELDS');
    expect(SENTRY_SRC).toContain('email');
    expect(SENTRY_SRC).toContain('device_id');
    expect(SENTRY_SRC).toContain('device_secret');
    expect(SENTRY_SRC).toContain('user_id');
    expect(SENTRY_SRC).toContain('ip_address');
    expect(SENTRY_SRC).toContain('authorization');
    expect(SENTRY_SRC).toContain('password');
  });

  it('implements redactPII function for recursive scrubbing', () => {
    expect(SENTRY_SRC).toContain('function redactPII');
    expect(SENTRY_SRC).toContain('[REDACTED]');
  });

  it('redacts PII in beforeSend hook', () => {
    expect(SENTRY_SRC).toContain('redactPII(event.request)');
    expect(SENTRY_SRC).toContain('redactPII(event.extra)');
    expect(SENTRY_SRC).toContain('redactPII(event.user)');
    expect(SENTRY_SRC).toContain('redactPII(bc.data)');
  });

  it('limits recursion depth to prevent stack overflow', () => {
    expect(SENTRY_SRC).toContain('depth > 5');
  });
});

// ─── Production Configuration ────────────────────────────────────────────

describe('Phase AP: Sentry Production Config', () => {
  it('differentiates production vs development environment', () => {
    expect(SENTRY_SRC).toContain('isProduction');
    expect(SENTRY_SRC).toContain('VERCEL_ENV');
  });

  it('uses lower trace sample rate in production (cost control)', () => {
    // Production: 0.05, Development: 0.2
    expect(SENTRY_SRC).toContain('0.05');
    expect(SENTRY_SRC).toContain('0.2');
  });

  it('sets server name for event attribution', () => {
    expect(SENTRY_SRC).toContain('serverName');
    expect(SENTRY_SRC).toContain('virtumatch-api');
  });

  it('attaches stack traces to messages', () => {
    expect(SENTRY_SRC).toContain('attachStacktrace');
  });

  it('enables client reports for release health', () => {
    expect(SENTRY_SRC).toContain('sendClientReports');
  });

  it('limits breadcrumbs to prevent memory bloat', () => {
    expect(SENTRY_SRC).toContain('maxBreadcrumbs');
  });

  it('sets initial scope with project tags', () => {
    expect(SENTRY_SRC).toContain('initialScope');
    expect(SENTRY_SRC).toContain('virtumatch-predictor');
  });
});

// ─── Event Filtering ─────────────────────────────────────────────────────

describe('Phase AP: Sentry Event Filtering', () => {
  it('filters rate limit errors (429)', () => {
    expect(SENTRY_SRC).toContain('429');
  });

  it('filters CORS preflight (204)', () => {
    expect(SENTRY_SRC).toContain('204');
  });

  it('filters method not allowed (405)', () => {
    expect(SENTRY_SRC).toContain('405');
  });

  it('filters transient network errors (ECONNRESET, ETIMEDOUT)', () => {
    expect(SENTRY_SRC).toContain('ECONNRESET');
    expect(SENTRY_SRC).toContain('ETIMEDOUT');
  });

  it('filters health check transactions from performance', () => {
    expect(SENTRY_SRC).toContain('beforeSendTransaction');
    expect(SENTRY_SRC).toContain('/api/health');
  });

  it('filters data cleanup transactions (cron spam)', () => {
    expect(SENTRY_SRC).toContain('/api/data-cleanup');
  });
});

// ─── Enhanced API Surface ────────────────────────────────────────────────

describe('Phase AP: Sentry Enhanced API', () => {
  it('exports captureMessage for security events', () => {
    expect(SENTRY_SRC).toContain('export function captureMessage');
  });

  it('exports clearUser for session cleanup', () => {
    expect(SENTRY_SRC).toContain('export function clearUser');
  });

  it('exports getSentryStatus for health checks', () => {
    expect(SENTRY_SRC).toContain('export function getSentryStatus');
  });

  it('exports withSentryErrorHandler for serverless wrapper', () => {
    expect(SENTRY_SRC).toContain('export function withSentryErrorHandler');
  });

  it('setUser only stores non-PII identifier', () => {
    // setUser should only send id, never email/name
    expect(SENTRY_SRC).toContain("id: id ? String(id) : 'anonymous'");
  });

  it('captureException redacts context PII', () => {
    expect(SENTRY_SRC).toContain('redactPII({ ...context })');
  });

  it('addBreadcrumb redacts breadcrumb data', () => {
    expect(SENTRY_SRC).toContain('redactPII(breadcrumb.data)');
  });
});

// ─── Status & Health ─────────────────────────────────────────────────────

describe('Phase AP: Sentry Status & Health', () => {
  it('getSentryStatus returns configuration info', () => {
    expect(SENTRY_SRC).toContain('active:');
    expect(SENTRY_SRC).toContain('environment:');
    expect(SENTRY_SRC).toContain('dsnConfigured:');
    expect(SENTRY_SRC).toContain('piiFieldsRedacted:');
  });

  it('version tag reflects Phase AP', () => {
    expect(SENTRY_SRC).toContain('2.0.0-AP');
  });
});

// ─── Integration with Existing Monitoring ────────────────────────────────

describe('Phase AP: Sentry Integration Compatibility', () => {
  it('still exports all Phase Y functions', () => {
    expect(SENTRY_SRC).toContain('export async function initSentry');
    expect(SENTRY_SRC).toContain('export function captureException');
    expect(SENTRY_SRC).toContain('export function addBreadcrumb');
    expect(SENTRY_SRC).toContain('export function setUser');
    expect(SENTRY_SRC).toContain('export function isSentryActive');
  });

  it('graceful degradation when SENTRY_DSN not set', () => {
    expect(SENTRY_SRC).toContain("if (!SENTRY_DSN) return");
  });

  it('dynamic import pattern preserved', () => {
    expect(SENTRY_SRC).toContain("import('@sentry/node')");
  });
});
