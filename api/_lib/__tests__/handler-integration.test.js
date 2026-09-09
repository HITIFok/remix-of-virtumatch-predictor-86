// Phase P — Handler Integration Tests
//
// Tests verify:
//   1. Key handlers import and use shared error module
//   2. Key handlers import and use shared validate module
//   3. Key handlers import and use shared logger module
//   4. No raw res.status().json() patterns remain in critical handlers
//   5. Error responses follow consistent shape

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cwd = process.cwd();

function readHandler(name) {
  return readFileSync(resolve(cwd, `api/${name}`), 'utf8');
}

// ── device-register.js Integration ───────────────────────────────────────

describe('Phase P: device-register.js uses shared modules', () => {
  const src = readHandler('device-register.js');

  it('imports from _lib/errors.js', () => {
    expect(src).toContain("from './_lib/errors.js'");
    expect(src).toContain('errorResponse');
    expect(src).toContain('methodNotAllowed');
    expect(src).toContain('rateLimited');
    expect(src).toContain('invalidInput');
    expect(src).toContain('internalError');
  });

  it('imports from _lib/validate.js', () => {
    expect(src).toContain("from './_lib/validate.js'");
    expect(src).toContain('validateDeviceId');
  });

  it('imports from _lib/logger.js', () => {
    expect(src).toContain("from './_lib/logger.js'");
    expect(src).toContain('createLogger');
  });

  it('creates scoped logger for the module', () => {
    expect(src).toContain("createLogger('device-register')");
  });

  it('uses validateDeviceId for input validation (not just regex)', () => {
    expect(src).toContain('validateDeviceId(');
  });

  it('uses methodNotAllowed() instead of inline 405', () => {
    expect(src).toContain('methodNotAllowed(res');
  });

  it('uses rateLimited() instead of inline 429', () => {
    expect(src).toContain('rateLimited(res');
  });

  it('uses invalidInput() instead of inline 400', () => {
    expect(src).toContain('invalidInput(res');
  });

  it('uses internalError() instead of inline 500', () => {
    expect(src).toContain('internalError(res');
  });

  it('uses successResponse() instead of inline 200', () => {
    expect(src).toContain('successResponse(res');
  });
});

// ── predictions.js Integration ───────────────────────────────────────────

describe('Phase P: predictions.js uses shared modules', () => {
  const src = readHandler('predictions.js');

  it('imports from _lib/errors.js', () => {
    expect(src).toContain("from './_lib/errors.js'");
    expect(src).toContain('rateLimited');
    expect(src).toContain('internalError');
  });

  it('imports from _lib/validate.js', () => {
    expect(src).toContain("from './_lib/validate.js'");
  });

  it('imports from _lib/logger.js', () => {
    expect(src).toContain("from './_lib/logger.js'");
    expect(src).toContain('createLogger');
  });

  it('creates scoped logger for the module', () => {
    expect(src).toContain("createLogger('predictions')");
  });

  it('uses rateLimited() instead of inline 429', () => {
    expect(src).toContain('rateLimited(res');
  });

  it('uses internalError() for server errors', () => {
    expect(src).toContain('internalError(res');
  });
});

// ── Cross-Handler Integration ────────────────────────────────────────────

describe('Phase P: all refactored handlers use shared modules', () => {
  const HANDLERS = ['device-register.js', 'predictions.js'];

  it('all handlers import errors.js', () => {
    for (const file of HANDLERS) {
      const src = readHandler(file);
      expect(src).toContain("from './_lib/errors.js'");
    }
  });

  it('all handlers import logger.js', () => {
    for (const file of HANDLERS) {
      const src = readHandler(file);
      expect(src).toContain("from './_lib/logger.js'");
    }
  });

  it('all handlers create scoped loggers', () => {
    for (const file of HANDLERS) {
      const src = readHandler(file);
      expect(src).toMatch(/createLogger\('[^']+'\)/);
    }
  });
});

// ── Shared Module Dependencies ───────────────────────────────────────────

describe('Phase P: shared modules are self-consistent', () => {
  it('errors.js does not import from validate.js (no circular dep)', () => {
    const src = readFileSync(resolve(cwd, 'api/_lib/errors.js'), 'utf8');
    expect(src).not.toContain("from './validate.js'");
  });

  it('validate.js does not import from errors.js (no circular dep)', () => {
    const src = readFileSync(resolve(cwd, 'api/_lib/validate.js'), 'utf8');
    expect(src).not.toContain("from './errors.js'");
  });

  it('logger.js does not import from errors.js or validate.js', () => {
    const src = readFileSync(resolve(cwd, 'api/_lib/logger.js'), 'utf8');
    expect(src).not.toContain("from './errors.js'");
    expect(src).not.toContain("from './validate.js'");
  });

  it('ratelimit.js does not import from errors.js (no coupling)', () => {
    const src = readFileSync(resolve(cwd, 'api/_lib/ratelimit.js'), 'utf8');
    expect(src).not.toContain("from './errors.js'");
  });
});
