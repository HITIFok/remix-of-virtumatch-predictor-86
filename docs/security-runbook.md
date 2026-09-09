# Security Runbook — VirtuMatch Predictor

## Incident Response

### 1. HMAC Token Compromise

**Detection**: Unexpected auth patterns in logs  
**Response**:
1. Rotate `HMAC_DEVICE_SECRET` env var immediately
2. Set `HMAC_ONLY=true` to reject all plain tokens
3. Force client update (old tokens invalidated)
4. Audit `device_tokens` table for suspicious registrations

### 2. CORS Origin Bypass

**Detection**: Requests from unknown origins in access logs  
**Response**:
1. Check `cors.js` allowlist for misconfiguration
2. Add `Vary: Origin` header verification
3. Deploy fix and verify with `curl -H "Origin: https://evil.com"`

### 3. Rate Limit Evasion

**Detection**: Sudden spike in requests from single IP  
**Response**:
1. Check `ratelimit.js` store stats via `getRateLimiterStats()`
2. Consider reducing `max` or `windowMs` for affected endpoint
3. For distributed attacks: implement IP-based blocking at CDN level

### 4. Coefficient Drift

**Detection**: `validateCoefficients()` fails at startup  
**Response**:
1. Check env var overrides: `VIRTUMATCH_COEF_*` values
2. Verify conservation laws (stat weights sum to 1.0, form weights decreasing)
3. Reset overrides and restart
4. Run backtesting to verify prediction accuracy

### 5. Data Breach (Database)

**Detection**: Unauthorized query patterns or leaked data  
**Response**:
1. Rotate `NEON_DATABASE_URL` immediately
2. Audit access logs for data exfiltration
3. Notify affected users (email breach notification)
4. Implement IP-based access restriction on Neon dashboard

## Pre-Deployment Checklist

- [ ] `npm run test:all` passes
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] `validateCoefficients()` passes
- [ ] No secrets in git diff (branch-guard.yml checks)
- [ ] CORS allowlist reviewed
- [ ] CSP headers in vercel.json reviewed
- [ ] Rate limits configured for all endpoints

## Key Security Files

| File | Purpose |
|------|---------|
| `api/_lib/auth.js` | HMAC-SHA256 device token auth |
| `api/_lib/cors.js` | Origin-based CORS with allowlist |
| `api/_lib/ratelimit.js` | Unified in-memory rate limiter |
| `api/_lib/errors.js` | Standardized error responses |
| `api/_lib/validate.js` | Input validation & sanitization |
| `api/_lib/logger.js` | Structured logging with PII redaction |
| `api/_lib/request.js` | IP extraction utility |
| `src/lib/prediction-config.ts` | Coefficient registry with validation |
| `src/lib/startup-validation.ts` | Startup coefficient validation |
| `vercel.json` | CSP headers, security config |

## Test Suites

| Suite | Tests | Purpose |
|-------|-------|---------|
| `auth.test.js` | 22 | HMAC auth, fallback, timing safety |
| `cors.test.js` | 17 | CORS origin, preflight, caching |
| `csp.test.js` | 22 | CSP directives, no unsafe-inline JS |
| `ratelimit.test.js` | 8 | Rate limit behavior, cleanup |
| `backtest.test.js` | 17 | Prediction engine backtesting |
| `calibration.test.js` | 31 | Coefficient bounds, conservation laws |
| `refactor.test.js` | 19 | Shared modules, no inline patterns |
| `ci-pipeline.test.js` | 18 | CI workflow, startup validation |
| `dependency-audit.test.js` | 15 | Dependency security, lock file |
| `error-handling.test.js` | 22 | Error shapes, no info leakage |
| `input-validation.test.js` | 25 | Input sanitization, injection prevention |
| `logging.test.js` | 18 | PII redaction, structured output |
