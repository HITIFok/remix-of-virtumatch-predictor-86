---
Task ID: 3
Agent: main
Task: Fix analyze-match 500 error (Vercel timeout on "Prédire tous les matchs")

Work Log:
- Diagnosed: "A server e..." = Vercel HTML error page, not JSON → function killed by 10s Hobby timeout
- Root cause: Groq API call (4.5s) + cold start (1-3s) + auth DB call (0-2s) > 10s budget
- Server fix (api/analyze-match.js):
  - Wrapped entire handler in global timeout guard (8s) → always returns JSON (504), never Vercel HTML
  - Auth moved inside try/catch (was outside — unhandled auth errors returned HTML)
  - Reduced DEADLINE_MS from 4500 to 2500 (leaves buffer for cold start + auth)
  - Dynamic deadline: effectiveDeadline = min(2500, remainingMs - 1000)
  - Aggressive batch routing: >3 matches → instant math fallback (no Groq call at all)
  - Lowered token threshold from 8000 to 5000 for 2-3 match batches
- Client fix (LiveMatches.tsx + Index.tsx):
  - Added content-type check before res.json() — handles Vercel HTML gracefully
  - Falls back to math predictions silently when AI is unavailable
- TypeScript compiles clean

Stage Summary:
- analyze-match v25: timeout-resilient, always returns JSON
- 1 match: Groq AI (up to 2.5s) with math fallback
- 2-3 matches: Groq if tokens < 5000, else math
- 4+ matches: instant math (no Groq, no timeout risk)
- Global 8s guard returns JSON 504 instead of Vercel HTML 500
- Client-side content-type check prevents JSON parse crash

---
Task ID: 1
Agent: main
Task: Fix cron-job.org timeout on auto-playout endpoint

Work Log:
- Diagnosed issue: auto-playout v2 took too long (9 API discovery calls + playout fetches + DB writes) → exceeded cron-job.org ~30s timeout
- Refactored to v3 (fire-and-forget): handler responds 202 Accepted immediately in <1s
- All heavy work moved to runPlayout() background function
- Uses res.unstable_waitUntil() to keep Vercel function alive after response
- Syntax checked with node -c
- Pushed to GitHub: bc6b445

Stage Summary:
- auto-playout v3: responds 202 instantly, processes in background
- No changes needed in frontend (202 is res.ok)
- cron-job.org will now get a response within 1-2 seconds instead of timing out

---
Task ID: 2
Agent: main
Task: Add searchable device ID dropdown in Admin Migration section

Work Log:
- Created `src/hooks/use-admin-device-ids.ts` — hook that fetches device list from `GET /api/admin-codes?action=migrate`, caches result, returns deviceInfos + activations
- Created `src/components/DeviceIdSearch.tsx` — searchable combobox for device IDs with: search filter, highlight matching text, stats per device (predictions count, correct/pending, premium status + expiry), "Sélectionné" badge, free-text fallback, excludeDeviceId to avoid showing source in destination picker
- Updated `src/pages/Admin.tsx` — replaced plain `<input>` for fromDevice/toDevice with `<DeviceIdSearch>`, added "Rafraîchir la liste des devices" button, refetch after session verification

Stage Summary:
- 3 files created/modified: `use-admin-device-ids.ts` (new), `DeviceIdSearch.tsx` (new), `Admin.tsx` (updated)
- TypeScript compiles with no errors
- Each device in the dropdown shows: device_id, total predictions, correct count, pending count, premium status + expiry date
- The "from" picker excludes the selected "to" device and vice versa (prevents same-device selection)
- Free-text input is still supported via "Utiliser tel quel" fallback option

---
Task ID: 1
Agent: Main Agent
Task: Audit complet Phase 1 du repository VirtuMatch Predictor - generation du rapport PDF

Work Log:
- Explore la structure complete du repository (1344 lignes prediction-engine.ts, 12+ API routes)
- Lit api/_lib/auth.js - identifie le fallback requireAuth() (V-01 CRITIQUE)
- Lit api/_lib/cors.js - identifie x-capacitor-request bypass (V-02 CRITIQUE)
- Lit vercel.json - identifie CSP unsafe-inline (V-03 HAUTE)
- Lit middleware.js - identifie rate limiting Map() en memoire inadequat
- Lit prediction-engine.ts - identifie 17 coefficients arbitraires
- Lit api/predictions.js, premium-activate.js, admin-codes.js, verify-predictions.js, auth.js, device-register.js
- Lit src/lib/device.ts - analyse le flux d'authentification client
- Lit docs/TODO-SECURITY.md, docs/SECURITY-NEON.md - contextualise les securite existantes
- Genere le rapport PDF complet (15 pages) avec ReportLab

Stage Summary:
- Rapport PDF genere: /home/z/my-project/download/audit-virtumatch-predictor.pdf (51.2 KB, 15 pages)
- 3 vulnerabilites critiques identifiees (V-01, V-02, V-03)
- 17 coefficients arbitraires documentes
- Phases de remediation A-M definies
- Risques residuels catalogues

---
Task ID: Phase-B
Agent: Main Agent
Task: Phase B - Tests de securite automatises pour V-01 (requireAuth), V-02 (isOriginAllowed), V-03 (CSP)

Work Log:
- Created vitest.api.config.ts with Node environment for server-side API tests
- Created api/_lib/__tests__/auth.test.js (22 tests):
  - HMAC_ONLY=true blocks ALL fallback (3 tests)
  - HMAC_ONLY=false allows restricted fallback (6 tests)
  - DELETE blocked via fallback (1 test)
  - body.device_id and query.device_id fallbacks REMOVED (3 tests)
  - Fallback monitoring/logging (1 test)
  - verifyDeviceToken() HMAC verification (7 tests)
  - DEVICE_ID_RE regex validation (2 tests)
- Created api/_lib/__tests__/cors.test.js (17 tests):
  - x-capacitor-request bypass REMOVED (5 tests)
  - Origin validation (5 tests)
  - setCorsHeaders() proper application (5 tests)
  - Vary: Origin cache poisoning prevention (1 test)
  - Max-Age reduced to 3600 (1 test)
- Created api/_lib/__tests__/csp.test.js (22 tests):
  - unsafe-inline removed from script-src and style-src (2 tests)
  - SHA-256 hashes present and matching (4 tests)
  - Inline style attributes removed from index.html (4 tests)
  - Positive security controls (7 tests)
  - Other security headers (5 tests)
- Added test:api, test:api:watch, test:all scripts to package.json
- All 61/61 tests pass

Stage Summary:
- 3 test files created: auth.test.js, cors.test.js, csp.test.js
- 61 automated security tests covering V-01, V-02, V-03
- vitest.api.config.ts for Node environment API testing
- All tests pass after Phase C CSP fix

---
Task ID: Phase-C
Agent: Main Agent
Task: Phase C - Implementer V-03 fix (CSP nonces/hashes, supprimer unsafe-inline)

Work Log:
- Computed SHA-256 hashes for inline <style> and <script> blocks in index.html
- Converted 5 inline style="" attributes to CSS classes in <style> block:
  - SVG gradient stops: stop-fire-start, stop-fire-end, stop-ice-start, stop-ice-end
  - Error detail paragraph: error-detail
- Removed 'unsafe-inline' from script-src in vercel.json CSP
- Removed 'unsafe-inline' from style-src in vercel.json CSP
- Added SHA-256 hash to script-src: 'sha256-XWIoOnInJ3c6lKL7NZrwU9qFGcSwijhMPOi0rX4b0tw='
- Added SHA-256 hash to style-src: 'sha256-u13w0P4wGV1/4mtD5670tcXw3DNUfQyEBmuzE+D/26c='
- Created scripts/compute_csp_hashes.js for hash computation
- Vite build succeeds with CSP changes
- All 61 security tests pass

Stage Summary:
- V-03 FIXED: unsafe-inline completely removed from CSP
- XSS protection via CSP is now EFFECTIVE
- SHA-256 hashes allow only known inline content
- 5 inline style attributes converted to CSS classes
- CSP is now: script-src 'self' 'sha256-...' https://cdn.jsdelivr.net; style-src 'self' 'sha256-...' https://cdn.jsdelivr.net
- Zero inline style attributes remain in index.html

---
Task ID: Phase-E
Agent: Main Agent
Task: Phase E - Rate limiting distribué (Upstash Redis + fallback in-memory)

Work Log:
- Installed @upstash/ratelimit and @upstash/redis packages
- Rewrote middleware.js with dual-mode rate limiting:
  - Distributed mode: Upstash Redis when UPSTASH_REDIS_REST_URL is configured
  - Fallback mode: in-memory Map() when Redis is not available
  - Graceful degradation: if Redis call fails, falls back to in-memory
- Added V-01 migration security: stricter rate limit (10 req/min) for HMAC fallback requests
  - Requests with Authorization: Device <token> → standard limit (30 req/min)
  - Requests without HMAC token → strict limit (10 req/min)
- Added proper rate limit headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
- Created ratelimit.test.js (8 tests): in-memory fallback, 429 headers, non-API routes, strict HMAC limit
- All 69 tests pass

Stage Summary:
- middleware.js: dual-mode rate limiting (Redis + in-memory fallback)
- V-01 migration: stricter 10 req/min for plain x-device-id fallback
- Standard 30 req/min for HMAC-authenticated requests
- 8 new rate limiting tests

---
Task ID: Phase-F+G
Agent: Main Agent
Task: Phase F (Backtesting) + Phase G (Coefficient Audit) du moteur de prédiction

Work Log:
- Created scripts/backtest_prediction_engine.js — comprehensive backtesting analysis
- Inventoried 17 hardcoded coefficients with values, units, line numbers, descriptions
- Tested 8 match types covering full spectrum: favori fort, équilibré, nul probable, domination, serré
- Analyzed sensitivity of 4 key coefficients: VIRTUAL_AVG_GOALS, AI_WEIGHT, STAT_WEIGHT_SPLIT, CONF_CAP
- Identified 5 key findings:
  1. VIRTUAL_AVG_GOALS=1.3 is most impactful, needs empirical validation
  2. 70/20/10 split has potential double-counting in cross-term
  3. AI_WEIGHT=35% is reasonable but arbitrary without data
  4. CONF_CAP=82% is prudent but needs calibration
  5. topVirtualBonus priors are not empirically based
- Generated 5 calibration recommendations by priority
- Created backtest.test.js (16 tests): coefficient audit, range validation, probability conservation
- All 85 tests pass

Stage Summary:
- 17 coefficients inventoried and documented
- Sensitivity analysis for 4 key coefficients
- 8 match types tested across full odds spectrum
- Backtesting report: /home/z/my-project/download/backtest-phase-f.txt
- Key risk: VIRTUAL_AVG_GOALS and 70/20/10 split need empirical validation
- 16 backtesting/coefficient tests added

---
Task ID: Phase-H
Agent: Main Agent
Task: Phase H - Coefficient calibration (centralized config, validation, bounds)

Work Log:
- Created src/lib/prediction-config.ts — centralized coefficient registry with:
  - 22 coefficient definitions with value, min, max, unit, description, calibrationStatus
  - CoefficientRegistry interface for type-safe access
  - validateCoefficients() function with conservation law checks
  - getArbitraryCount() and getCalibrationPriorities() for calibration tracking
  - Env var override mechanism (VIRTUMATCH_COEF_*) with bounds clamping
  - buildConfig() singleton pattern for runtime configuration
- Modified src/lib/prediction-engine.ts to import from config:
  - Added import { getConfig } from './prediction-config'
  - Replaced all 17 hardcoded coefficients with _cfg.* references
  - VIRTUAL_AVG_GOALS, FORM_WEIGHTS, grid search constants, stat weight split
  - AI_WEIGHT, VIRTUAL_CAP, confidence coefficients, form/momentum/H2H coefficients
- Updated backtest.test.js for Phase H config-aware assertions
- Created calibration.test.js (29 tests):
  - Coefficient registry completeness (6 tests)
  - Default value preservation (1 test)
  - Validation conservation laws (7 tests)
  - Prediction engine integration (9 tests)
  - Calibration priorities (5 tests)
  - Cross-term double-counting awareness (3 tests)
- All 117 tests pass (22 auth + 17 cors + 22 csp + 8 ratelimit + 19 backtest + 29 calibration)
- TypeScript compiles clean, Vite build succeeds

Stage Summary:
- prediction-config.ts: centralized coefficient registry with bounds, validation, env overrides
- prediction-engine.ts: all 17 hardcoded coefficients replaced with config references
- 6 coefficients marked 'arbitrary' (priority for calibration): VIRTUAL_AVG_GOALS, AI_WEIGHT, FORM_ATTACK_BOOST, FORM_DEFENSE_PENALTY, H2H_HOME_BOOST, H2H_AWAY_PENALTY
- STAT_DEF_WEIGHT cross-term documented as potential double-counting (can be reduced via VIRTUMATCH_COEF_STAT_DEF_WEIGHT env var)
- 117 total security + calibration tests passing

---
Task ID: Phase-I
Agent: Main Agent
Task: Phase I - Code refactoring (deduplicate rate limits, shared modules, DB normalization)

Work Log:
- Created api/_lib/ratelimit.js — unified in-memory rate limiter:
  - createRateLimiter(name, { max, windowMs }) with automatic stale entry cleanup (setInterval)
  - Consistent return type: { allowed, remaining, retryAfter }
  - reset() method for clearing limits on success
  - interval.unref() to not block process exit
  - Memory-safe: entries older than 2× windowMs evicted automatically
- Created api/_lib/request.js — shared request utilities:
  - getClientIp(req) with x-forwarded-for + x-real-ip fallback
  - Replaces 5 copy-pasted IP extraction one-liners
- Created api/_lib/resend.js — shared Resend email utility:
  - getResend() returns ready-to-use Resend instance (not class)
  - Exports RESEND_FROM and APP_URL constants
  - Replaces duplicate lazy-load pattern in auth.js + premium-activate.js
- Refactored api/predictions.js:
  - Replaced inline Map rate limiter with createRateLimiter('predictions', { max: 30, windowMs: 60s })
  - Replaced 5 inline postgres() calls with createSql()
  - Replaced raw x-forwarded-for with getClientIp()
- Refactored api/device-register.js:
  - Replaced inline Map rate limiter with createRateLimiter('device-register', { max: 5, windowMs: 60s })
  - Replaced raw x-forwarded-for with getClientIp()
- Refactored api/auth.js:
  - Replaced inline Map rate limiter with dual: createRateLimiter('auth-email') + createRateLimiter('auth-ip')
  - Replaced local getResend() with shared from _lib/resend.js
  - Replaced raw x-forwarded-for with getClientIp()
- Refactored api/admin-codes.js (CRITICAL fix):
  - Removed module-level postgres() singleton (stale connection risk)
  - Now uses per-request createSql() inside handler
  - Replaced inline Map rate limiter with createRateLimiter('admin-login', { max: 5, windowMs: 15min })
  - Replaced raw x-forwarded-for with getClientIp()
- Refactored api/premium-activate.js:
  - Replaced inline Map rate limiter with createRateLimiter('premium-activate', { max: 15, windowMs: 1h })
  - Replaced inline postgres() calls with createSql()
  - Replaced local getResend() with shared from _lib/resend.js
- Created refactor.test.js (19 tests):
  - Shared module API verification (9 tests)
  - Handler refactoring verification (7 tests)
  - Rate limiter functional behavior (3 tests)
- All 136 tests pass, TypeScript compiles clean, Vite build succeeds

Stage Summary:
- 3 new shared modules: ratelimit.js, request.js, resend.js
- 5 API handlers refactored to use shared modules
- CRITICAL fix: admin-codes.js module-level DB singleton removed
- All 5 duplicate inline rate limiters eliminated
- All inline postgres() calls replaced with createSql()
- All raw x-forwarded-for extraction replaced with getClientIp()
- 136 total tests passing
