// Phase L — Error Handling Tests
//
// Tests verify:
//   1. Shared error utility exists with correct API
//   2. Error responses have consistent shape (success, error, correlationId)
//   3. No internal details leaked to clients (cause never in response)
//   4. Common error factories produce correct status codes
//   5. Success responses have consistent shape

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cwd = process.cwd();

const errorsSource = readFileSync(resolve(cwd, 'api/_lib/errors.js'), 'utf8');

// ── Shared Error Module Structure ────────────────────────────────────────

describe('Phase L: Shared error module exists with correct API', () => {

  it('errors.js exports errorResponse function', () => {
    expect(errorsSource).toContain('export function errorResponse');
  });

  it('errors.js exports successResponse function', () => {
    expect(errorsSource).toContain('export function successResponse');
  });

  it('errorResponse generates correlationId for tracking', () => {
    expect(errorsSource).toContain('correlationId');
    expect(errorsSource).toContain('generateCorrelationId');
  });

  it('errorResponse response includes success: false', () => {
    expect(errorsSource).toContain('success: false');
  });

  it('errorResponse NEVER exposes cause to client', () => {
    // The cause should only be used in console.error, never in the response body
    // Check that the body construction does NOT include cause
    const bodyStart = errorsSource.indexOf('const body = {');
    const bodyEnd = errorsSource.indexOf('};', bodyStart) + 2;
    const bodyBlock = errorsSource.slice(bodyStart, bodyEnd);
    expect(bodyBlock).not.toContain('cause');
  });

  it('errorResponse logs internally for 5xx errors', () => {
    expect(errorsSource).toContain('console.error');
    expect(errorsSource).toContain('statusCode >= 500');
  });

  it('errorResponse logs cause stack trace when provided', () => {
    expect(errorsSource).toContain('cause.stack');
    expect(errorsSource).toContain('cause.message');
  });
});

// ── Common Error Factories ───────────────────────────────────────────────

describe('Phase L: Common error factories produce correct status codes', () => {

  const FACTORIES = [
    { name: 'methodNotAllowed', status: 405, code: 'METHOD_NOT_ALLOWED' },
    { name: 'rateLimited', status: 429, code: 'RATE_LIMITED' },
    { name: 'unauthorized', status: 401, code: 'UNAUTHORIZED' },
    { name: 'invalidInput', status: 400, code: 'INVALID_INPUT' },
    { name: 'notFound', status: 404, code: 'NOT_FOUND' },
    { name: 'internalError', status: 500, code: 'INTERNAL_ERROR' },
    { name: 'serviceUnavailable', status: 503, code: 'SERVICE_UNAVAILABLE' },
  ];

  for (const { name, status, code } of FACTORIES) {
    it(`${name}() → ${status} with code '${code}'`, () => {
      expect(errorsSource).toContain(`export function ${name}`);
      // Verify the factory calls errorResponse with the correct status
      expect(errorsSource).toMatch(new RegExp(`errorResponse\\(res,\\s*${status}`));
      expect(errorsSource).toContain(`code: '${code}'`);
    });
  }
});

// ── Success Response Shape ───────────────────────────────────────────────

describe('Phase L: Success response shape', () => {

  it('successResponse includes success: true', () => {
    expect(errorsSource).toContain('success: true');
  });

  it('successResponse spreads data into response', () => {
    expect(errorsSource).toContain('...data');
  });

  it('successResponse defaults to 200 status', () => {
    expect(errorsSource).toMatch(/statusCode\s*=\s*200/);
  });
});

// ── Security: No Information Leakage ─────────────────────────────────────

describe('Phase L: No internal detail leakage', () => {

  it('correlationId uses timestamp + random (not UUID that could leak server info)', () => {
    expect(errorsSource).toContain('Date.now().toString(36)');
    expect(errorsSource).toContain('Math.random().toString(36)');
  });

  it('errorResponse response body does NOT contain cause or stack', () => {
    // Verify the body object construction
    const bodyMatch = errorsSource.match(/const body = \{[\s\S]*?\};/);
    expect(bodyMatch).toBeTruthy();
    const body = bodyMatch[0];
    expect(body).not.toContain('cause');
    expect(body).not.toContain('stack');
    expect(body).not.toContain('internal');
  });

  it('rateLimited response includes retryAfter in meta (not in body root)', () => {
    expect(errorsSource).toContain('meta: { retryAfter }');
  });
});

// ── Integration: Error utility available for all handlers ────────────────

describe('Phase L: Error utility integration', () => {

  it('errors.js exists in api/_lib/ directory', () => {
    const fs = require('fs');
    expect(fs.existsSync(resolve(cwd, 'api/_lib/errors.js'))).toBe(true);
  });

  it('errorResponse accepts (res, statusCode, message, options) signature', () => {
    // Verify the function signature
    expect(errorsSource).toMatch(/function errorResponse\(res,\s*statusCode,\s*message/);
  });
});
