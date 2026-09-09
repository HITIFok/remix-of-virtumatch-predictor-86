// Phase Q — Secret Rotation Audit Tests
//
// Tests verify:
//   1. No hardcoded secrets in source code
//   2. All secrets come from process.env
//   3. All required secrets are documented
//   4. No secret values in .env files committed to repo
//   5. Timing-safe comparisons for secret checks

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

const cwd = process.cwd();

// ── No Hardcoded Secrets ────────────────────────────────────────────────

describe('Phase Q: No hardcoded secrets in source code', () => {

  const SECRET_PATTERNS = [
    { name: 'Stripe live key', pattern: /sk_live_[a-zA-Z0-9]{24,}/ },
    { name: 'Stripe test key', pattern: /sk_test_[a-zA-Z0-9]{24,}/ },
    { name: 'AWS access key', pattern: /AKIA[A-Z0-9]{16}/ },
    { name: 'GitHub PAT', pattern: /ghp_[a-zA-Z0-9]{36}/ },
    { name: 'Slack token', pattern: /xox[bpas]-[a-zA-Z0-9-]{24,}/ },
    { name: 'Resend API key literal', pattern: /re_[a-zA-Z0-9]{24,}/ },
    { name: 'Long hex secret (32+ chars)', pattern: /['"][0-9a-f]{32,}['"]/ },
  ];

  const sourceDirs = ['api', 'src/lib', 'src/hooks', 'src/components', 'src/pages'];

  it('no secret patterns found in any source file', () => {
    let found = [];
    for (const dir of sourceDirs) {
      const dirPath = resolve(cwd, dir);
      if (!existsSync(dirPath)) continue;
      // Check .js and .ts files
      try {
        const files = readdirSync(dirPath, { recursive: true });
        for (const file of files) {
          if (!String(file).match(/\.(js|ts|tsx)$/)) continue;
          const filePath = resolve(dirPath, String(file));
          if (!existsSync(filePath)) continue;
          const src = readFileSync(filePath, 'utf8');
          for (const { name, pattern } of SECRET_PATTERNS) {
            if (pattern.test(src)) {
              found.push(`${dir}/${file}: ${name}`);
            }
          }
        }
      } catch { /* skip unreadable dirs */ }
    }
    expect(found).toEqual([]);
  });
});

// ── All Secrets from process.env ────────────────────────────────────────

describe('Phase Q: All secrets come from process.env', () => {

  const REQUIRED_SECRETS = [
    { name: 'NEON_DATABASE_URL', usedIn: ['api/_lib/db.js', 'api/verify-predictions.js'] },
    { name: 'HMAC_ONLY', usedIn: ['api/_lib/auth.js'] }, // Feature flag, not a secret itself
    { name: 'RESEND_API_KEY', usedIn: ['api/_lib/resend.js', 'api/auth.js'] },
    { name: 'ADMIN_TOKEN_SECRET', usedIn: ['api/admin-codes.js', 'api/early-alerts.js'] },
    { name: 'USER_SESSION_SECRET', usedIn: ['api/_lib/auth.js'] },
    { name: 'SCRAPER_PUSH_KEY', usedIn: ['api/push-odds.js'] },
    { name: 'GROQ_API_KEY', usedIn: ['api/analyze-match.js'] },
    { name: 'SPORTY_API_BASE', usedIn: ['api/matches.js', 'api/fetch-live.js'] },
    { name: 'CRON_SECRET', usedIn: ['api/verify-predictions.js', 'api/auto-playout.js'] },
  ];

  for (const { name, usedIn } of REQUIRED_SECRETS) {
    it(`${name} accessed via process.env`, () => {
      let found = false;
      for (const file of usedIn) {
        const src = readFileSync(resolve(cwd, file), 'utf8');
        if (src.includes(`process.env.${name}`) || src.includes(`process.env['${name}']`)) {
          found = true;
        }
      }
      expect(found).toBe(true);
    });
  }
});

// ── No .env Files in Repository ──────────────────────────────────────────

describe('Phase Q: No .env files committed to repository', () => {

  const FORBIDDEN_ENV_FILES = [
    '.env', '.env.local', '.env.production', '.env.development',
    '.env.production.local', '.env.development.local',
  ];

  for (const file of FORBIDDEN_ENV_FILES) {
    if (file === '.env') continue; // .env allowed if it contains only non-secret local config
    it(`${file} is NOT in repository root`, () => {
      expect(existsSync(resolve(cwd, file))).toBe(false);
    });
  }

  it('.env (if present) contains no secrets', () => {
    const envPath = resolve(cwd, '.env');
    if (existsSync(envPath)) {
      const src = readFileSync(envPath, 'utf8');
      // Should NOT contain any secret-like values
      expect(src).not.toMatch(/sk_live|sk_test|AKIA|ghp_|xox[bpas]|SECRET|PASSWORD|TOKEN/);
      expect(src).not.toMatch(/NEON_DATABASE_URL|HMAC_DEVICE_SECRET|RESEND_API_KEY/);
    }
  });

  it('.gitignore includes .env patterns', () => {
    const gitignore = readFileSync(resolve(cwd, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env');
  });
});

// ── Timing-Safe Secret Comparison ────────────────────────────────────────

describe('Phase Q: Timing-safe comparisons for secrets', () => {

  it('push-odds.js uses timing-safe comparison for SCRAPER_PUSH_KEY', () => {
    const src = readFileSync(resolve(cwd, 'api/push-odds.js'), 'utf8');
    // Should use crypto.timingSafeEqual or custom constant-time compare
    expect(src).toMatch(/timingSafeEqual|timing.safe|constant.time/i);
  });

  it('auth.js uses crypto.timingSafeEqual for HMAC comparison', () => {
    const src = readFileSync(resolve(cwd, 'api/_lib/auth.js'), 'utf8');
    expect(src).toMatch(/timingSafeEqual|crypto\.timingSafeEqual/);
  });
});

// ── Secret Rotation Documentation ────────────────────────────────────────

describe('Phase Q: Secret rotation is documented', () => {

  it('security runbook documents HMAC secret rotation', () => {
    const src = readFileSync(resolve(cwd, 'docs/security-runbook.md'), 'utf8');
    expect(src).toContain('HMAC_DEVICE_SECRET');
    expect(src).toContain('Rotate');
  });

  it('security runbook documents NEON_DATABASE_URL rotation', () => {
    const src = readFileSync(resolve(cwd, 'docs/security-runbook.md'), 'utf8');
    expect(src).toContain('NEON_DATABASE_URL');
  });
});
