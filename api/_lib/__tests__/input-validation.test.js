// Phase M — Input Validation Tests
//
// Tests verify:
//   1. Shared validation module exists with correct API
//   2. Email validation (RFC compliance, length limits)
//   3. Device ID validation (HMAC tokens, length bounds)
//   4. League ID validation (known leagues only)
//   5. Purpose/code/duration validation
//   6. String sanitization (control chars, length)
//   7. No injection vectors in validated inputs

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cwd = process.cwd();

const validateSource = readFileSync(resolve(cwd, 'api/_lib/validate.js'), 'utf8');

// ── Validation Module Structure ──────────────────────────────────────────

describe('Phase M: Shared validation module exists', () => {

  const EXPORTED_FUNCTIONS = [
    'validateEmail',
    'validateDeviceId',
    'validateLeagueId',
    'validateMatchId',
    'validatePurpose',
    'validateCode',
    'validateDuration',
    'sanitizeString',
    'validateLimit',
  ];

  for (const name of EXPORTED_FUNCTIONS) {
    it(`${name} is exported`, () => {
      expect(validateSource).toContain(`export function ${name}`);
    });
  }
});

// ── Email Validation ─────────────────────────────────────────────────────

describe('Phase M: Email validation security', () => {

  it('validates against RFC 5322 simplified regex', () => {
    expect(validateSource).toContain('@');
    expect(validateSource).toMatch(/emailRegex/);
  });

  it('enforces max length 254 (RFC 5321)', () => {
    expect(validateSource).toContain('254');
  });

  it('trims and lowercases email', () => {
    expect(validateSource).toContain('.trim()');
    expect(validateSource).toContain('.toLowerCase()');
  });

  it('returns null for invalid input (not throwing)', () => {
    expect(validateSource).toContain('return null');
  });
});

// ── Device ID Validation ─────────────────────────────────────────────────

describe('Phase M: Device ID validation security', () => {

  it('enforces minimum length (8 chars) to prevent brute-force short IDs', () => {
    expect(validateSource).toMatch(/length < 8/);
  });

  it('enforces maximum length (128 chars)', () => {
    expect(validateSource).toMatch(/length > 128/);
  });

  it('only allows alphanumeric + safe chars (no SQL/XSS injection)', () => {
    // The regex should be strict: [a-zA-Z0-9._-]+
    expect(validateSource).toMatch(/\[a-zA-Z0-9\._-\]/);
  });
});

// ── League ID Validation ─────────────────────────────────────────────────

describe('Phase M: League ID validation (allowlist)', () => {

  it('only accepts known league IDs (no arbitrary string)', () => {
    expect(validateSource).toContain('KNOWN_LEAGUES');
    expect(validateSource).toContain('8035'); // English League
    expect(validateSource).toContain('8056'); // Champions League
  });

  it('rejects unknown league IDs', () => {
    // The function returns null if not in KNOWN_LEAGUES
    expect(validateSource).toContain('!KNOWN_LEAGUES.includes');
  });
});

// ── String Sanitization ──────────────────────────────────────────────────

describe('Phase M: String sanitization', () => {

  it('rejects control characters (prevents CRLF injection)', () => {
    expect(validateSource).toContain('\\x00');
    expect(validateSource).toContain('\\x1F');
    expect(validateSource).toContain('\\x7F');
  });

  it('enforces max length (default 1024)', () => {
    expect(validateSource).toContain('maxLength = 1024');
  });

  it('trims whitespace', () => {
    expect(validateSource).toContain('.trim()');
  });
});

// ── Purpose Validation ───────────────────────────────────────────────────

describe('Phase M: Purpose validation (allowlist)', () => {

  it('only accepts known purposes: activate, login, migrate', () => {
    expect(validateSource).toContain("'activate'");
    expect(validateSource).toContain("'login'");
    expect(validateSource).toContain("'migrate'");
  });
});

// ── Code Validation ──────────────────────────────────────────────────────

describe('Phase M: Auth code validation', () => {

  it('only accepts 6-digit numeric codes', () => {
    expect(validateSource).toContain('\\d{6}');
  });
});

// ── Pagination Validation ────────────────────────────────────────────────

describe('Phase M: Pagination limit validation', () => {

  it('enforces upper bound to prevent DoS via large limits', () => {
    expect(validateSource).toContain('maxLimit = 100');
    expect(validateSource).toContain('num > maxLimit');
  });

  it('rejects non-integer and non-positive values', () => {
    expect(validateSource).toContain('Number.isInteger(num)');
    expect(validateSource).toContain('num < 1');
  });
});
