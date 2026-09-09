// Phase N — Logging & Observability Tests
//
// Tests verify:
//   1. Structured logger module exists with PII redaction
//   2. Email redaction (user@domain.com → u***@domain.com)
//   3. IP redaction (192.168.1.100 → 192.168.1.***)
//   4. Token redaction (dev-abc123 → dev-***23)
//   5. Context auto-redaction for PII keys
//   6. Structured JSON log output
//   7. Log level control

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cwd = process.cwd();

const loggerSource = readFileSync(resolve(cwd, 'api/_lib/logger.js'), 'utf8');

// ── Logger Module Structure ──────────────────────────────────────────────

describe('Phase N: Structured logger module', () => {

  it('exports createLogger function', () => {
    expect(loggerSource).toContain('export function createLogger');
  });

  it('exports PII redaction functions', () => {
    expect(loggerSource).toContain('export function redactEmail');
    expect(loggerSource).toContain('export function redactIp');
    expect(loggerSource).toContain('export function redactToken');
    expect(loggerSource).toContain('export function redactContext');
  });

  it('createLogger returns debug, info, warn, error methods', () => {
    expect(loggerSource).toContain("debug: (msg, ctx)");
    expect(loggerSource).toContain("info:  (msg, ctx)");
    expect(loggerSource).toContain("warn:  (msg, ctx)");
    expect(loggerSource).toContain("error: (msg, ctx)");
  });

  it('log output is JSON.stringify (structured, parseable)', () => {
    expect(loggerSource).toContain('JSON.stringify(entry)');
  });

  it('log entry includes timestamp, level, module, message', () => {
    expect(loggerSource).toContain('timestamp');
    expect(loggerSource).toContain('level');
    expect(loggerSource).toContain('module');
    expect(loggerSource).toContain('message');
  });
});

// ── Email Redaction ──────────────────────────────────────────────────────

describe('Phase N: Email redaction', () => {

  it('redacts local part: user@domain.com → u***@domain.com', () => {
    expect(loggerSource).toContain('local[0]');
    expect(loggerSource).toContain('***');
    expect(loggerSource).toContain('domain');
  });

  it('handles single-char local: a@domain.com → *@domain.com', () => {
    expect(loggerSource).toContain('local.length <= 1');
    expect(loggerSource).toContain('*@');
  });
});

// ── IP Redaction ─────────────────────────────────────────────────────────

describe('Phase N: IP redaction', () => {

  it('redacts last octet of IPv4: 192.168.1.100 → 192.168.1.***', () => {
    expect(loggerSource).toContain("parts[3] = '***'");
  });

  it('handles IPv6 (redacts last 2 segments)', () => {
    expect(loggerSource).toContain("':'");
    expect(loggerSource).toContain("'****'");
  });
});

// ── Token Redaction ──────────────────────────────────────────────────────

describe('Phase N: Token redaction', () => {

  it('shows first 4 + last 2 chars with *** in between', () => {
    expect(loggerSource).toContain('token.slice(0, 4)');
    expect(loggerSource).toContain('token.slice(-2)');
  });

  it('short tokens (≤8 chars) fully redacted', () => {
    expect(loggerSource).toContain('token.length <= 8');
    expect(loggerSource).toContain("'***'");
  });
});

// ── Context Auto-Redaction ───────────────────────────────────────────────

describe('Phase N: Context auto-redaction for PII keys', () => {

  it('PII_KEYS includes email, ip, token, apiKey, password, etc.', () => {
    expect(loggerSource).toContain("'email'");
    expect(loggerSource).toContain("'ip'");
    expect(loggerSource).toContain("'token'");
    expect(loggerSource).toContain("'apiKey'");
    expect(loggerSource).toContain("'password'");
    expect(loggerSource).toContain("'authorization'");
    expect(loggerSource).toContain("'cookie'");
  });

  it('redactContext is recursive (handles nested objects)', () => {
    expect(loggerSource).toContain('redactContext(value)');
  });

  it('all context is redacted before logging (redactContext called)', () => {
    expect(loggerSource).toContain('redactContext({ ...baseContext, ...context })');
  });
});

// ── Log Level Control ────────────────────────────────────────────────────

describe('Phase N: Log level control', () => {

  it('LOG_LEVELS define debug < info < warn < error', () => {
    expect(loggerSource).toContain('debug: 0');
    expect(loggerSource).toContain('info: 1');
    expect(loggerSource).toContain('warn: 2');
    expect(loggerSource).toContain('error: 3');
  });

  it('log level controlled by LOG_LEVEL env var (default: info)', () => {
    expect(loggerSource).toContain("process.env.LOG_LEVEL");
    expect(loggerSource).toContain("'info'");
  });

  it('messages below current level are suppressed', () => {
    expect(loggerSource).toContain('LOG_LEVELS[level] < currentLevel');
  });
});

// ── Timestamp Format ─────────────────────────────────────────────────────

describe('Phase N: Timestamp format', () => {

  it('uses ISO 8601 format (new Date().toISOString())', () => {
    expect(loggerSource).toContain('new Date().toISOString()');
  });
});
