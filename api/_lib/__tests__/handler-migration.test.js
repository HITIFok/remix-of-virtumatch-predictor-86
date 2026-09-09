// Phase U — Handler Migration Tests
// Verifies all 7 API handlers import shared modules (errors.js, validate.js, logger.js)

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const API_DIR = path.resolve(__dirname, '..', '..'); // api/

// Handlers that SHOULD use shared modules
const HANDLERS = [
  'auth.js',
  'admin-codes.js',
  'premium-activate.js',
  'device-register.js',
  'predictions.js',
  'verify-predictions.js',
  'push-odds.js',
  'auto-playout.js',
];

// ── Module Structure ──────────────────────────────────────────────────

describe('Phase U: Handler Migration', () => {

  describe('shared module imports', () => {
    HANDLERS.forEach(handler => {
      it(`${handler} imports errors.js`, () => {
        const src = fs.readFileSync(path.join(API_DIR, handler), 'utf8');
        expect(src).toContain("from './_lib/errors.js'");
      });

      it(`${handler} imports logger.js`, () => {
        const src = fs.readFileSync(path.join(API_DIR, handler), 'utf8');
        expect(src).toContain("from './_lib/logger.js'");
      });

      it(`${handler} uses createLogger()`, () => {
        const src = fs.readFileSync(path.join(API_DIR, handler), 'utf8');
        expect(src).toMatch(/createLogger\(/);
      });
    });
  });

  describe('no inline EMAIL_RE regex', () => {
    const EMAIL_HANDLERS = ['auth.js', 'premium-activate.js'];

    EMAIL_HANDLERS.forEach(handler => {
      it(`${handler} does NOT define inline EMAIL_RE`, () => {
        const src = fs.readFileSync(path.join(API_DIR, handler), 'utf8');
        // Should not have a standalone EMAIL_RE assignment (const EMAIL_RE =)
        expect(src).not.toMatch(/const EMAIL_RE\s*=/);
      });

      it(`${handler} imports validateEmail from validate.js`, () => {
        const src = fs.readFileSync(path.join(API_DIR, handler), 'utf8');
        expect(src).toContain('validateEmail');
      });
    });
  });

  describe('no direct postgres() import (use createSql)', () => {
    const DB_HANDLERS = [
      'verify-predictions.js',
      'push-odds.js',
      'auto-playout.js',
      'auth.js',
      'admin-codes.js',
      'premium-activate.js',
      'device-register.js',
      'predictions.js',
    ];

    DB_HANDLERS.forEach(handler => {
      it(`${handler} does NOT import postgres directly`, () => {
        const src = fs.readFileSync(path.join(API_DIR, handler), 'utf8');
        // Should not have bare "import postgres from 'postgres'"
        expect(src).not.toMatch(/^import postgres from/m);
      });
    });
  });

  describe('no error.message leakage in 500 responses', () => {
    const ALL_HANDLERS = HANDLERS;

    ALL_HANDLERS.forEach(handler => {
      it(`${handler} does NOT expose error.message in 500 response`, () => {
        const src = fs.readFileSync(path.join(API_DIR, handler), 'utf8');
        // Pattern: res.status(500).json({ ... error: error.message ... })
        expect(src).not.toMatch(/res\.status\(500\)\.json\(\{[^}]*error:\s*error\.message/);
      });
    });
  });

  describe('shared error factories used', () => {
    it('auth.js uses methodNotAllowed', () => {
      const src = fs.readFileSync(path.join(API_DIR, 'auth.js'), 'utf8');
      expect(src).toContain('methodNotAllowed');
    });

    it('push-odds.js uses unauthorized', () => {
      const src = fs.readFileSync(path.join(API_DIR, 'push-odds.js'), 'utf8');
      expect(src).toContain('unauthorized');
    });

    it('premium-activate.js uses invalidInput', () => {
      const src = fs.readFileSync(path.join(API_DIR, 'premium-activate.js'), 'utf8');
      expect(src).toContain('invalidInput');
    });

    it('admin-codes.js uses rateLimited', () => {
      const src = fs.readFileSync(path.join(API_DIR, 'admin-codes.js'), 'utf8');
      expect(src).toContain('rateLimited');
    });

    it('verify-predictions.js uses internalError', () => {
      const src = fs.readFileSync(path.join(API_DIR, 'verify-predictions.js'), 'utf8');
      expect(src).toContain('internalError');
    });

    it('auto-playout.js uses unauthorized + internalError', () => {
      const src = fs.readFileSync(path.join(API_DIR, 'auto-playout.js'), 'utf8');
      expect(src).toContain('unauthorized');
      expect(src).toContain('internalError');
    });
  });

  describe('structured logging (no bare console.error for errors)', () => {
    // Handlers should use log.error() instead of console.error for error-level messages
    const ERROR_HANDLERS = ['auth.js', 'push-odds.js', 'auto-playout.js'];

    ERROR_HANDLERS.forEach(handler => {
      it(`${handler} uses log.error for error reporting`, () => {
        const src = fs.readFileSync(path.join(API_DIR, handler), 'utf8');
        expect(src).toMatch(/log\.error\(/);
      });
    });
  });

  describe('timing-safe comparisons use crypto.timingSafeEqual', () => {
    const TIMING_SAFE_HANDLERS = ['verify-predictions.js', 'push-odds.js', 'auto-playout.js'];

    TIMING_SAFE_HANDLERS.forEach(handler => {
      it(`${handler} uses crypto.timingSafeEqual (not manual XOR)`, () => {
        const src = fs.readFileSync(path.join(API_DIR, handler), 'utf8');
        // Should use crypto.timingSafeEqual, not manual byte XOR
        expect(src).toContain('crypto.timingSafeEqual');
        // Should NOT have the old manual XOR pattern
        expect(src).not.toContain('result.every(byte => byte === 0)');
      });
    });
  });

  describe('correlation IDs in error responses', () => {
    // All handlers using errors.js get correlation IDs automatically
    it('all handlers import errorResponse which generates correlationId', () => {
      HANDLERS.forEach(handler => {
        const src = fs.readFileSync(path.join(API_DIR, handler), 'utf8');
        expect(src).toContain("from './_lib/errors.js'");
      });
    });

    it('errors.js generates correlationId in every error response', () => {
      const src = fs.readFileSync(path.join(API_DIR, '_lib', 'errors.js'), 'utf8');
      expect(src).toContain('correlationId');
      expect(src).toContain('generateCorrelationId');
    });
  });

  describe('PII redaction in logs', () => {
    it('auth.js uses createLogger with redactEmail/redactToken', () => {
      const src = fs.readFileSync(path.join(API_DIR, 'auth.js'), 'utf8');
      expect(src).toContain('redactEmail');
      expect(src).toContain('redactToken');
    });

    it('premium-activate.js uses redactEmail', () => {
      const src = fs.readFileSync(path.join(API_DIR, 'premium-activate.js'), 'utf8');
      expect(src).toContain('redactEmail');
    });

    it('logger.js redacts email/ip/token automatically', () => {
      const src = fs.readFileSync(path.join(API_DIR, '_lib', 'logger.js'), 'utf8');
      expect(src).toContain('redactEmail');
      expect(src).toContain('redactIp');
      expect(src).toContain('redactToken');
      expect(src).toContain('redactContext');
    });
  });

  describe('RESEND_API_KEY bug fix', () => {
    it('premium-activate.js does NOT reference bare RESEND_API_KEY', () => {
      const src = fs.readFileSync(path.join(API_DIR, 'premium-activate.js'), 'utf8');
      // Should use process.env.RESEND_API_KEY, not bare RESEND_API_KEY
      const bareReferences = src.match(/(?<!process\.env\.)RESEND_API_KEY/g);
      // Only import/reference is via process.env
      expect(bareReferences).toBeNull();
    });
  });

});
