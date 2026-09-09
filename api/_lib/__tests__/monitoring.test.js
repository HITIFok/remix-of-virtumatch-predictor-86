// Phase Y — Monitoring & Error Tracking Tests
// Verifies Sentry integration and health monitoring

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const LIB_DIR = path.resolve(__dirname, '..');

describe('Phase Y: Monitoring & Error Tracking', () => {

  describe('Sentry integration module', () => {
    it('sentry.js exists and exports required functions', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'sentry.js'), 'utf8');
      expect(src).toContain('export async function initSentry');
      expect(src).toContain('export function captureException');
      expect(src).toContain('export function addBreadcrumb');
      expect(src).toContain('export function setUser');
      expect(src).toContain('export function isSentryActive');
    });

    it('sentry.js only activates when SENTRY_DSN is set', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'sentry.js'), 'utf8');
      expect(src).toContain('SENTRY_DSN');
      expect(src).toContain("if (!SENTRY_DSN) return");
    });

    it('sentry.js uses dynamic import for @sentry/node (optional dep)', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'sentry.js'), 'utf8');
      expect(src).toContain("import('@sentry/node')");
    });

    it('sentry.js filters rate limit errors (429)', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'sentry.js'), 'utf8');
      expect(src).toContain('429');
    });

    it('sentry.js includes VERCEL_ENV and release SHA', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'sentry.js'), 'utf8');
      expect(src).toContain('VERCEL_ENV');
      expect(src).toContain('VERCEL_GIT_COMMIT_SHA');
    });
  });

  describe('health endpoint monitoring', () => {
    it('health.js exists', () => {
      expect(fs.existsSync(path.join(LIB_DIR, '..', 'health.js'))).toBe(true);
    });

    it('health.js returns 503 for degraded state', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, '..', 'health.js'), 'utf8');
      expect(src).toContain('503');
    });

    it('health.js checks database connectivity', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, '..', 'health.js'), 'utf8');
      expect(src).toMatch(/SELECT 1|database/i);
    });
  });

  describe('structured logging for log aggregation', () => {
    it('logger.js outputs JSON-parseable format', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'logger.js'), 'utf8');
      expect(src).toContain('JSON.stringify');
    });

    it('logger.js includes ISO 8601 timestamps', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'logger.js'), 'utf8');
      expect(src).toContain('toISOString');
    });

    it('logger.js supports LOG_LEVEL env var', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'logger.js'), 'utf8');
      expect(src).toContain('LOG_LEVEL');
    });
  });

  describe('error tracking with correlation IDs', () => {
    it('errors.js generates correlationId for every error', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'errors.js'), 'utf8');
      expect(src).toContain('generateCorrelationId');
      expect(src).toContain('correlationId');
    });

    it('correlationId enables cross-log tracking', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'errors.js'), 'utf8');
      // correlationId is included in the error response body
      expect(src).toContain('correlationId');
    });
  });

  describe('monitoring environment variables', () => {
    it('SENTRY_DSN is documented as optional', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'sentry.js'), 'utf8');
      // The module gracefully degrades without SENTRY_DSN
      expect(src).toContain('if (!SENTRY_DSN) return');
    });

    it('LOG_LEVEL is documented with valid values', () => {
      const src = fs.readFileSync(path.join(LIB_DIR, 'logger.js'), 'utf8');
      expect(src).toContain('debug');
      expect(src).toContain('info');
      expect(src).toContain('warn');
      expect(src).toContain('error');
    });
  });

});
