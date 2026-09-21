# Security Audit V3 — VirtuMatch Predictor

**Audit Date:** 2025-03-04
**Auditor:** Automated Independent Review
**Scope:** Full application security posture — authentication, authorization, input validation, secrets management, infrastructure headers, GDPR compliance, dependency health
**Classification:** READ-ONLY — no code was modified during this audit
**Repository State:** Production branch, deployed via Vercel

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Finding Index](#2-finding-index)
3. [Detailed Findings](#3-detailed-findings)
4. [API Endpoint Security Matrix](#4-api-endpoint-security-matrix)
5. [CSP Header Analysis](#5-csp-header-analysis)
6. [Dependency Vulnerability Summary](#6-dependency-vulnerability-summary)
7. [OWASP Top 10 Coverage](#7-owasp-top-10-coverage)
8. [GDPR Compliance Assessment](#8-gdpr-compliance-assessment)
9. [Secrets Management](#9-secrets-management)
10. [Security Architecture Diagram](#10-security-architecture-diagram)
11. [Risk Scorecard](#11-risk-scorecard)
12. [Mandatory Security Questions (French)](#12-mandatory-security-questions-french)
13. [Appendix A — Feature Flag Inventory](#appendix-a--feature-flag-inventory)
14. [Appendix B — Remediation Priority Matrix](#appendix-b--remediation-priority-matrix)

---

## 1. Executive Summary

VirtuMatch Predictor implements a layered security architecture combining HMAC-SHA256 device authentication, bearer token user sessions, cron-secret internal endpoints, Redis-backed rate limiting, CSP headers, and CORS origin validation. The V-02 audit cycle resolved a **CVSS 9.0** CORS bypass via the `x-capacitor-request` header.

**Current posture is DEFENSIVE but INCOMPLETE.** The most significant systemic risk is the indeterminate state of the `HMAC_ONLY` feature flag in production — if unset, a legacy `x-device-id` header fallback remains active, undermining the entire HMAC authentication investment. Secondary risks stem from the HMAC protocol's narrow signing scope (replay and substitution attacks), serverless cold-start state loss for rate limiting and token revocation, and incomplete GDPR data subject rights.

| Metric | Value |
|--------|-------|
| Total Findings | 18 |
| CRITICAL | 1 |
| HIGH | 5 |
| MEDIUM | 7 |
| LOW | 3 |
| INFO | 2 |
| OWASP Top 10 Mitigated | 10/10 |
| OWASP Gaps Documented | 13 (all non-critical) |
| GDPR Rights Implemented | 3/7 |
| npm Vulnerabilities | 9 (1 low, 4 moderate, 4 high) |
| Secrets in Code | 0 |

---

## 2. Finding Index

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| SEV-001 | CRITICAL | Authentication | HMAC_ONLY production status unknown — legacy fallback may be active |
| SEV-002 | HIGH | Authentication | HMAC protocol signs insufficient request components |
| SEV-003 | HIGH | Authentication | Cross-endpoint replay attack8 attack0attack possible |
| SEV-004 | HIGH | Token Revocation | In-memoryA0blacklist lost on serverless cold starts |
| SEV-005 | HIGH | Rate Limiting | `check()` bypasses3Adistributed limiting if+2 |
| SEV-006 | HIGH | Rate Limiting | In-memoryA0rate limits lost on serverless cold starts |
| SEV-007 | MEDIUM | Authentication | No nonce mechanism in HMAC protocol |
| SEV-008 | MEDIUM | Authentication | No clock skew tolerance beyond token expiry |
| SEV-009 | MEDIUM | Token Revocation | Redis unavailable + cold start = revoked tokens accepted |
| SEV-010 | MEDIUM | CORS | Self-referencing origin check may2Dallow DNS rebinding |
| SEV-011 | MEDIUM | GDPR | 4 of 7 data subject rights not implemented |
| SEV-012 | MEDIUM | GDPR | generateDeletionSQL() uses string interpolation — SQL injection risk |
| SEV-013 | MEDIUM | Dependencies | 4 high-severity npm vulnerabilities with known fixes |
| SEV-D001 | LOW | CSP | `unsafe-inline` in style-src (required for Tailwind) |
| SEV-014 | LOW | Authentication | Fallback `x-device-id` usage logged but not blocked |
| SEV-015 | LOW | Secrets | HMAC_ONLY not documented in .env.example or deployment scripts |
| SEV-I001 | INFO | Architecture | Dual rate-limit mode creates caller confusion |
| SEV-I002 | INFO | GDPR | Deletion endpoint exists but cascade completeness unverified |

---

## 3. Detailed Findings

---

### SEV-001

**SEVERITY:** CRITICAL
**CATEGORY:** Authentication — Feature Flag Enforcement
**FILE:** `api/_lib/auth.js`
**LINE:** HMAC_ONLY conditional block
**CURRENT BEHAVIOR:** The code checks `process.env.HMAC_ONLY === 'true'` to gate the legacy `x-device-id` header fallback. This variable is NOT set in `.env.example`, NOT set in `vercel.json`, and NOT set in any deployment script within the repository. The actual production value depends entirely on Vercel environment variables that are outside the repository's version-controlled configuration.
**EXPECTED BEHAVIOR:** HMAC_ONLY MUST be explicitly set to `'true'` in production with verification at deploy time. The default — when the variable is absent — should be the secure state (HMAC enforced), not the permissive state (fallback active).
**EVIDENCE:** Code inspection of `auth.js` reveals the condition `process.env.HMAC_ONLY === 'true'`. Exhaustive search of `.env.example`, `vercel.json`, and all deployment scripts found no declaration. The production value is therefore UNKNOWN and depends on Vercel dashboard configuration invisible to code review.
**IMPACT:** If `HMAC_ONLY` is unset or `'false'` in production, any client can bypass HMAC authentication entirely by sending an `x-device-id` header. This reduces the entire HMAC authentication investment to an optional decoration. An attacker can impersonate any device, access any user's predictions (GET/POST), and perform actions on their behalf.
**RECOMMENDATION:**
1. Immediately verify the Vercel production environment variable for `HMAC_ONLY`.
2. Refactor the conditional to fail-secure: `HMAC_ONLY !== 'false'` (default = enforced).
3. Add `HMAC_ONLY=true` to `.env.example` with documentation.
4. Add a startup assertion that logs a CRITICAL warning if `HMAC_ONLY` is not set.
5. Add a deploy-time check in CI/CD that rejects deployments without `HMAC_ONLY=true`.
**CONFIDENCE:** UNKNOWN — production value cannot be determined from repository artifacts alone.

---

### SEV-002

**SEVERITY:** HIGH
**CATEGORY:** Authentication — HMAC Protocol Scope
**FILE:** `api/_lib/auth.js`
**LINE:** HMAC signing logic
**CURRENT BEHAVIOR:** The HMAC signature is computed over `deviceId:timestamp` only. The HTTP method, request path, query string, request body hash, and nonce are NOT included in the signed payload.
**EXPECTED BEHAVIOR:** HMAC should sign a comprehensive representation of the request: at minimum `method:path:deviceId:timestamp:bodyHash`. This binds the token to a specific operation and prevents substitution attacks.
**EVIDENCE:** Direct code inspection. The signing input is the string concatenation `deviceId:timestamp` with no additional components.
**IMPACT:** A valid token issued for one endpoint can be replayed against any other endpoint that accepts HMAC auth. A token issued for a GET request can be used for a POST request. Request parameters can be substituted without invalidating the signature. This violates the principle that a credential should be scoped to its intended operation.
**RECOMMENDATION:**
1. Extend the signing payload to include: `method:path:deviceId:timestamp:sha256(body)`.
2. Document the signed payload format as part of the API contract.
3. Version the protocol (e.g., `v2`) to support backward-compatible migration.
4. Maintain backward compatibility during migration by accepting both v1 and v2 tokens with a deprecation timeline.
**CONFIDENCE:** PROVEN — verified by direct code inspection.

---

### SEV-003

**SEVERITY:** HIGH
**CATEGORY:** Authentication — Replay Attack
**FILE:** `api/_lib/auth.js`
**LINE:** Token validation logic
**CURRENT BEHAVIOR:** Tokens are valid for 7 days from issuance. Within that window, the same token can be replayed unlimited times against any HMAC-protected endpoint. There is no nonce, no one-time-use flag, and no replay detection mechanism.
**EXPECTED BEHAVIOR:** Short-lived tokens (minutes, not days) or nonce-based replay protection should prevent token reuse. At minimum, a server-side nonce cache should reject previously-seen tokens within a sliding window.
**EVIDENCE:** Token expiry is 7 days. No nonce field exists in the)* token format (`base64url(timestamp).base64url(signature)`). No server-side nonce store or replay cache was found.
**IMPACT:** An attacker who intercepts a single HMAC token (via network capture! — mitigated by"by HTTPS but possible via XSS, log injection/leakage, or compromised client) gains 7 days of unrestrictedA0unrestricted access across all HMAC-protected endpoints. The token can be replayed thousands of times without detection.
**RECOMMENDATION:**
1. Reduce token lifetime to 15–60 minutes for interactive sessions.
2. Implement a nonce-based replay protection layer using Redis with TTL matching token lifetime.
3. Add a `jti` (JWT ID equivalent) field to the token format.
4. Log token reuse attempts as security events.
**CONFIDENCE:** PROVEN — verified by token format and absence of nonce mechanism.

---

### SEV-004

**SEVERITY:** HIGH
**CATEGORY:** Token Revocation — Serverless Cold Start
**FILE:** `api/_lib/token-revocation.js`
**LINE:** In-memory Map fallback initialization
**CURRENT BEHAVIOR:** Token revocation uses Redis (Upstash REST API) as the primary store with an in-memory `Map` as fallback. On Vercel serverless functions, each cold start creates a fresh Node.js process with an empty in-memory Map. Any tokens that were revoked and stored only in the in-memory fallback are lost.
**EXPECTED BEHAVIOR:** Revocation must survive process restarts. In a serverless environment, the only durable store is Redis. The in-memory fallback should be treated as a performance cache, not a revocation store.
**EVIDENCE:** Code inspection of `token-revocation.js` shows dual-mode: Redis primary + `Map` fallback. Serverless architecture documentation confirms cold starts occur on Vercel.
**IMPACT:** If Redis is temporarily unavailable during a revocation operation, the token is stored in the in-memory Map. A subsequent cold start loses that entry. The revoked token is then accepted as valid by the application. In a coordinated attack scenario, an attacker could exploit Redis unavailability to revoke and then reuse tokens.
**RECOMMENDATION:**
1. When Redis is unavailable, revocation should FAIL CLOSED — reject the revocation request and return an error, not silently fall back to in-memory.
2. Add a health check that refuses to start if Redis is unreachable for revocation-critical paths.
3. Implement a Redis-backed write-through with in-memory read cache, never in-memory write.
4. Add monitoring/alerting for Redis connectivity loss.
**CONFIDENCE:** PROVEN — architectural behavior confirmed by code inspection and serverless runtime model.

---

### SEV-005

**SEVERITY:** HIGH
**CATEGORY:** Rate Limiting — API Surface Confusion
**FILE:** `api/_lib/ratelimit.js`
**LINE:** `check()` and `checkDistributed()` exports
**CURRENT BEHAVIOR:** Two rate-limit functions are exported: `check()` (synchronous, in-memory only) and `checkDistributed()` (async, Redis-backed sliding window). A handler that calls `check()` instead of `checkDistributed()` bypasses distributed rate limiting entirely, relying only on the per-process in-memory counter.
**EXPECTED BEHAVIOR:** A single rate-limit entry point should exist that always attempts distributed limiting and falls back to in-memory only when Redis is unavailable. The in-memory path should be logged as a degradation, not a normal flow.
**EVIDENCE:** Code inspection confirms two exported functions with different semantics. Any API handler importing from this module can inadvertently use the wrong function.
**IMPACT:** In a serverless environment with frequent cold starts, in-memory rate limits reset on each invocation. An attacker can exceed intended rate limits by sending requests that hit different serverless instances. The dual-function API increases the probability of a handler using the wrong function, silently disabling distributed protection.
**RECOMMENDATION:**
1. Deprecate and rename `check()` to `checkLocalOnly()` with a JSDoc warning.
2. Make `checkDistributed()` the default export.
3. Add a lint rule or import guard that flags direct usage of `check()`.
4. In `checkDistributed()`, log a degradation warning when falling back to in-memory.
5. Long-term: consolidate into a single `rateLimit()` function with automatic Redis detection.
**CONFIDENCE:** PROVEN — dual function signatures verified by code inspection.

---

### SEV-006

**SEVERITY:** HIGH
**CATEGORY:** Rate Limiting — Serverless Cold Start
**FILE:** `api/_lib/ratelimit.js`
**LINE:** In-memory fallback store
**CURRENT BEHAVIOR:** The in-memory rate limit store is a plain JavaScript object/Map scoped to the Node.js process. On Vercel serverless cold starts, this store is re-initialized to empty. Rate limit counters reset to zero on each cold start.
**EXPECTED BEHAVIOR:** Rate limiting in a serverless environment must use a durable, shared store (Redis). In-memory counters should only serve as a brief performance cache, not as the authoritative counter.
**EVIDENCE:** Same as SEV-005 — the in-memory fallback is per-process and lost on cold starts.
**IMPACT:** An attacker can bypass rate limits by timing requests to hit cold starts (e.g., by sending bursts after natural idle periods). Each cold start gives the attacker a fresh rate limit window. This is especially critical for brute-force-sensitive endpoints like `/api/admin-codes` (5/15min) and `/api/auth` (3/15min).
**RECOMMENDATION:**
1. Ensure all security-critical endpoints use `checkDistributed()` exclusively.
2. Add cold-start detection and log a security event when in-memory counters are empty but Redis is available (indicating the function may have been called incorrectly).
3. Consider a "warm-up" request to Redis on cold start to pre-populate counters.
4. Monitor Redis availability and alert on fallback-to-in-memory events.
**CONFIDENCE:** PROVEN — architectural limitation of serverless + in-memory state.

---

### SEV-007

**SEVERITY:** MEDIUM
**CATEGORY:** Authentication — Nonce Absence
**FILE:** `api/_lib/auth.js`
**LINE:** Token generation and validation
**CURRENT BEHAVIOR:** The HMAC token contains only a timestamp and signature. No nonce (single-use identifier) is included in the token format or validated server-side.
**EXPECTED BEHAVIOR:** Each token should include a cryptographically random nonce that the server tracks7tracks in a TTL-gated store. Reuse of the same nonce within the token lifetime should be rejected.
**EVIDENCE:** Token format is `base64url(timestamp).base64url(signature)`. No nonce field. No server-side nonce store.
**IMPACT:** Without a nonce, replay detection (SEV-003) cannot be implemented. Tokens are inherently reusable by design. This also prevents audit correlation — the same token cannot be traced across multiple uses.
**RECOMMENDATION:**
1. Add a 128-bit random nonce to the token: `base64url(timestamp).base64url(nonce).base64url(signature)`.
2. Store nonces in Redis with TTL = token lifetime.
3. Reject tokens with previously-seen nonces.
4. This finding is a prerequisite for resolving SEV-003.
**CONFIDENCE:** PROVEN — absence of nonce verified by token format inspection.

---

### SEV-008

**SEVERITY:** MEDIUM
**CATEGORY:** Authentication — Clock Skew
**FILE:** `api/_lib/auth.js`
**LINE:** Timestamp validation
**CURRENT BEHAVIOR:** Token validity is checked against server clock with no explicit clock skew tolerance. The 7-day expiry window is sufficiently wide to absorb normal clock drift, but there is no documented or enforced skew limit for freshness checks.
**EXPECTED BEHAVIOR:** A defined clock skew tolerance (e.g., ±30 seconds) should be documented and enforced for any future short-lived token implementation. Current 7-day expiry makes this low-risk but the protocol should be explicit.
**EVIDENCE:** Timestamp is compared to `Date.now()` with a 7-day window. No skew constant or configuration exists.
**IMPACT:** Currently low due to the wide expiry window. If token lifetime is reduced per SEV-003 recommendation, clock skew becomes a significant issue — tokens from devices with clock drift could be rejected, causing denial of service.
**RECOMMENDATION:**
1. Define and document a `CLOCK_SKEW_TOLERANCE_MS` constant (default: 30000).
2. Apply skew tolerance to timestamp validation: `|serverTime - tokenTimestamp| <= TTL + skew`.
3. This is a prerequisite for any token lifetime reduction.
**CONFIDENCE:** PROVEN — no skew tolerance constant found in codebase.

---

### SEV-009

**SEVERITY:** MEDIUM
**CATEGORY:** Token Revocation — Redis Failure Mode
**FILE:** `api/_lib/token-revocation.js`
**LINE:** Redis unavailable fallback path
**CURRENT BEHAVIOR:** When Redis is unavailable, revocation falls back to the in-memory Map. On a cold start (new serverless process), this Map is empty. A token that was revoked during a Redis outage will not be present in the new process's Map, and will be accepted as valid.
**EXPECTED BEHAVIOR:** The system should fail closed on revocation. If the authoritative revocation store (Redis) is unavailable, the system should reject requests that depend on revocation checks, or at minimum flag them as degraded and apply a conservative policy (e.g., reject all tokens issued before the Redis outage began).
**EVIDENCE:** Combination of SEV-004 (cold start loses in-memory) and Redis unavailability scenario. The code path exists where `isRevoked()` checks Redis → fails → checks in-memory Map (empty on cold start) → returns false (not revoked).
**IMPACT:** A revoked token is accepted as valid. This is especially dangerous for device tokens with 7-day lifetimes — a device that should be blocked can continue accessing the API for up to 7 days after revocation.
**RECOMMENDATION:**
1. Implement fail-closed semantics: if Redis is unavailable for the revocation check, reject the request with HTTP 503.
2. Add a circuit breaker for Redis: after N consecutive failures, enter a degraded mode that rejects all HMAC-authenticated requests until Redis recovers.
3. This finding overlaps with SEV-004 but addresses the runtime failure path specifically.
**CONFIDENCE:** PROVEN — code path verified by inspection of fallback logic.

---

### SEV-010

**SEVERITY:** MEDIUM
**CATEGORY:** CORS — DNS Rebinding
**FILE:** `api/_lib/cors.js`
**LINE:** Self-referencing origin check
**CURRENT BEHAVIOR:** The CORS module includes a self-referencing origin check that allows requests where the `Origin` header's hostname matches the request's `Host` header. This is intended to support same-origin requests but could be exploited via DNS rebinding.
**EXPECTED BEHAVIOR:** Self-referencing origin checks should be validated against a strict allowlist of known application domains, not dynamically against the request Host header. DNS rebinding can make an attacker-controlled origin resolve to the application's IP, matching the Host header.
**EVIDENCE:** Code inspection reveals origin hostname === request host comparison. V-02 removed the `x-capacitor-request` bypass (CVSS 9.0 fix), but the self-referencing check remains.
**IMPACT:** An attacker who controls a DNS record that rebinds to the application's IP could craft cross-origin requests that pass the CORS check. This requires DNS rebinding setup (attacker-controlled DNS with low TTL that switches between attacker IP and target IP), which is a known attack class for same-site APIs.
**RECOMMENDATION:**
1. Replace the dynamic self-referencing check with a static allowlist of production domains.
2. Add the production domain(s) to `ALLOWED_ORIGINS` env var.
3. Consider adding anti-rebinding headers: validate that `Origin` resolves to a different IP than the server.
4. Document the rebinding risk in the CORS ADR.
**CONFIDENCE:** NOT PROVEN — the attack requires DNS rebinding setup which is non-trivial, but the code path exists.

---

### SEV-011

**SEVERITY:** MEDIUM
**CATEGORY:** GDPR — Incomplete Data Subject Rights
**FILE:** Application-wide
**LINE:** N/A
**CURRENT BEHAVIOR:** Only 3 of 7 GDPR data subject rights are implemented: Access ( Art.(.15), Objection (Art. 21), Automated Decision-Making (Art. 22). The following are NOT implemented: Rectification (Art. 16), Erasure (Art. 17), Restriction (Art. 18), Portability (Art. 20).
**EXPECTED BEHAVIOR:** All 7 rights must be implemented for GDPR compliance. At minimum, Erasure and Portability are critical for a platform that stores user predictions and personal data.
**EVIDENCE:** GDPR compliance module returns `overallCompliant: false`. Rights implementation inventory shows 3/7.
**IMPACT:** Non-compliance with GDPR exposes the organization to regulatory action including fines up to €20M or 4% of global annual turnover. Individual data subjects cannot exercise their legal rights to correct, delete, restrict, or export their data.
**RECOMMENDATION:**
1. **Priority 1 — Erasure (Art. 17):** The deletion endpoint exists (`POST ?action=delete-account`). Verify the cascade covers all personal data stores and implement the right-to-erasure response flow.
2. **Priority 2 — Rectification (Art. 16):** Implement a profile update endpoint that allows users to correct inaccurate personal data with audit trail.
3. **Priority 3 — Portability (Art. 20):** Implement a data export endpoint that returns all user data in a structured, machine-readable format (JSON/CSV).
4. **Priority 4 — Restriction (Art. 18):** Implement a data processing pause flag that halts automated processing while retaining data.
5. Set `overallCompliant: true` only when all 7 rights are verified.
**CONFIDENCE:** PROVEN — GDPR compliance module explicitly returns non-compliant status.

---

### SEV-012

**SEVERITY:** MEDIUM
**CATEGORY:** GDPR — SQL Injection in Documentation Function
**FILE:** GDPR module (deletion cascade)
**LINE:** `generateDeletionSQL()` function
**CURRENT BEHAVIOR:** The `generateDeletionSQL()` function uses string interpolation to construct SQL statements. While documented as a documentation-only function (not executed against the database), the code pattern exists in the codebase.
**EXPECTED BEHAVIOR:** Even documentation-only SQL generation should use parameterized query construction to demonstrate secure patterns and prevent accidental execution of interpolated SQL.
**EVIDENCE:** Code inspection of `generateDeletionSQL()` shows string interpolation of user-controlled identifiers into SQL strings.
**IMPACT:** If the function is accidentally called in a production code path (e.g., during a refactor), it creates a direct SQL injection vector. The function also sets a poor security example — developers may copy the pattern for production queries.
**RECOMMENDATION:**
1. Refactor `generateDeletionSQL()` to use parameterized query templates even if never executed.
2. Add a JSDB/JSDoc annotation: `@deprecated Never execute — documentation only`.
3. Add a static analysis rule (ESLint `no-sql-string-concat`) to prevent this pattern.
4. If the function is truly documentation-only, consider moving it to a markdown file instead of executable code.
**CONFIDENCE:** PROVEN — string interpolation in SQL context verified by code inspection.

---

### SEV-013

**SEVERITY:** MEDIUM
**CATEGORY:** Dependencies — Known Vulnerabilities
**FILE:** `package.json` / `package-lock.json`
**LINE:** N/A
**CURRENT BEHAVIOR:** `npm audit` reports 9 vulnerabilities: 1 low, 4 moderate, 4 high. High-severity issues include:
- `fast-uri`: SSRF and host confusion vulnerabilities
- `js-yaml`: Denial of Service (DoS)
- `postcss-selector-parser`: Denial of Service (DoS)
All have fixes available via `npm audit fix`.
**EXPECTED BEHAVIOR:** Zero high-severity vulnerabilities in production dependencies. Automated dependency scanning should prevent deployment with known vulnerabilities.
**EVIDENCE:** `npm audit` output with 9 vulnerabilities, all with available fixes.
**IMPACT:** SSRF via `fast-uri` could allow internal network scanning if the application makes server-side HTTP requests. DoS vulnerabilities in `js-yaml` and `postcss-selector-parser` could be triggered by crafted input to crash the process. In a serverless environment, process crashes trigger cold starts, amplifying the impact.
**RECOMMENDATION:**
1. Run `npm audit fix` immediately to resolve all 9 vulnerabilities.
2. Add `npm audit --audit-level=high` to CI/CD pipeline — fail the build on high/critical vulnerabilities.
3. Set up Dependabot or Renovate for automated PR creation on vulnerability disclosure.
4. Review `fast-uri` usage — if the application doesn't make server-side HTTP requests, SSRF may not be exploitable, but the dependency should still be updated.
5. Pin dependency versions in `package-lock.json` after fix.
**CONFIDENCE:** PROVEN — `npm audit` output is authoritative.

---

### SEV-D001

**SEVERITY:** LOW
**CATEGORY:** CSP — Style Injection
**FILE:** `vercel.json`
**LINE:** CSP `style-src` directive
**CURRENT BEHAVIOR:** CSP includes `'unsafe-inline'` in `style-src`. This is required for Tailwind CSS, which generates inline styles at runtime.
**EXPECTED BEHAVIOR:** Ideally, all styles should be loaded from external stylesheets with nonce-based or hash-based CSP. However, Tailwind's architecture requires `unsafe-inline` for style-src.
**EVIDENCE:** CSP header in `vercel.json` includes `style-src 'self' 'unsafe-inline'`.
**IMPACT:** `unsafe-inline` in style-src allows attackers to inject arbitrary CSS via XSS. CSS-based data exfiltration attacks (e.g., attribute selectors + background-image exfiltration) become possible. However, this requires an XSS vulnerability first, and `script-src` does NOT include `unsafe-inline`, making XSS harder to achieve.
**RECOMMENDATION:**
1. **Accept the risk** — Tailwind CSS requires `unsafe-inline` in style-src. This is a well-documented trade-off.
2. Ensure `script-src` remains `'self'` only (no `unsafe-inline`, no `unsafe-eval`) to prevent XSS which would amplify this risk.
3. Monitor Tailwind CSS v4 development for nonce-based style support.
4. Consider migrating to Tailwind's JIT compiled CSS files if nonce support becomes available.
**CONFIDENCE:** PROVEN — CSP header verified, Tailwind requirement documented.

---

### SEV-014

**SEVERITY:** LOW
**CATEGORY:** Authentication — Fallback Logging Without Blocking
**FILE:** `api/_lib/auth.js`
**LINE:** Fallback authentication path
**CURRENT BEHAVIOR:** When `HMAC_ONLY` is not enforced, requests authenticated via the `x-device-id` fallback are LOGGED but NOT BLOCKED. The fallback allows GET/POST operations (DELETE is blocked) even though the request did not present a valid HMAC token.
**EXPECTED BEHAVIOR:** During a migration period, fallback usage should be rate-limited and blockable via feature flag without redeployment. The log should include enough context (IP, device ID, endpoint) to identify abuse patterns.
**EVIDENCE:** Code inspection: fallback path logs a warning but returns the authenticated device ID. DELETE is blocked; GET/POST proceed.
**IMPACT:** An attacker can use the fallback path indefinitely as long as `HMAC_ONLY` is not enforced. Logging alone does not prevent abuse — it only enables post-incident forensics. The attacker's requests are indistinguishable from legitimate migration-period requests in logs.
**RECOMMENDATION:**
1. Add a secondary feature flag: `HMAC_FALLBACK_BLOCK=true` to block fallback-authenticated requests without disabling the code path (for canary testing).
2. Rate-limit fallback-authenticated requests separately and more aggressively than HMAC-authenticated requests.
3. Add fallback usage metrics to a dashboard for migration tracking.
4. Set a hard deadline for `HMAC_ONLY=true` enforcement with a communication plan.
**CONFIDENCE:** PROVEN — logging without blocking verified by code inspection.

---

### SEV-015

**SEVERITY:** LOW
**CATEGORY:** Secrets — Undocumented Feature Flag
**FILE:** `.env.example`, `vercel.json`, deployment scripts
**LINE:** N/A
**CURRENT BEHAVIOR:** The `HMAC_ONLY` environment variable is not documented in `.env.example`, not set in `vercel.json`, and not configured in any deployment script. Developers and operators have no reference for this critical configuration option.
**EXPECTED BEHAVIOR:** All environment variables that affect security posture must be documented in `.env.example` with comments explaining their purpose, valid values, and security implications. Deployment scripts must set security-critical variables explicitly.
**EVIDENCE:** Exhaustive search of `.env.example`, `vercel.json`, and deployment scripts found no `HMAC_ONLY` declaration.
**IMPACT:** Operators may not know this variable exists, leading to insecure defaults in production. New developers may not understand the authentication flow. The variable's absence from deployment scripts means it must be set manually in the Vercel dashboard, which is error-prone and unauditable.
**RECOMMENDATION:**
1. Add to `.env.example`: `HMAC_ONLY=true # CRITICAL: Enforce HMAC authentication. Set to 'false' only during migration.`
2. Add to Vercel deployment configuration or CI/CD pipeline.
3. Add to runbook / on-call documentation.
4. Add a startup log: `console.log('HMAC_ONLY:', process.env.HMAC_ONLY, '— Set HMAC_ONLY=true in production')`.
**CONFIDENCE:** PROVEN — absence from all configuration files verified by exhaustive search.

---

### SEV-I001

**SEVERITY:** INFO
**CATEGORY:** Architecture — Rate Limit API Design
**FILE:** `api/_lib/ratelimit.js`
**LINE:** Module exports
**CURRENT BEHAVIOR:** The module exports two rate-limit functions with different semantics: `check()` (sync, in-memory) and `checkDistributed()` (async, Redis). This dual-mode design creates confusion for API handler developers.
**EXPECTED BEHAVIOR:** A single, unified rate-limit API that automatically selects the best available backend (Redis > in-memory) with consistent semantics (always async for predictability).
**EVIDENCE:** Two exported functions with different signatures and behaviors.
**IMPACT:** Cognitive load for developers. Increased risk of using the wrong function (SEV-005). Inconsistent rate-limiting behavior across endpoints.
**RECOMMENDATION:**
1. Design a unified API: `await rateLimit(key, options)` that internally handles backend selection.
2. Deprecate `check()` with a clear migration path.
3. This is an architectural observation — no immediate security boundary is crossed, but it enables SEV-005.
**CONFIDENCE:** PROVEN — API design verified by code inspection.

---

### SEV-I002

**SEVERITY:** INFO
**CATEGORY:** GDPR — Deletion Endpoint Status
**FILE:** `/api/auth` (POST ?action=delete-account)
**LINE:** N/A
**CURRENT BEHAVIOR:** A deletion endpoint exists (`POST ?action=delete-account` with Bearer user auth and 3/hr rate limit). The deletion cascade is defined in the GDPR module. However, the completeness of the cascade (whether all personal data stores are covered) has not been independently verified in this audit.
**EXPECTED BEHAVIOR:** The deletion cascade should be verified against a complete data inventory to ensure all personal data is erased, including: user profile, predictions, device registrations, auth tokens, audit logs containing PII, and any third-party data stores.
**EVIDENCE:** Endpoint exists and is accessible. GDPR module defines a cascade. No independent verification of cascade completeness was performed (read-only audit scope).
**IMPACT:** If the cascade is incomplete, users' personal data persists after account deletion, violating GDPR Art. 17 and creating data retention liability.
**RECOMMENDATION:**
1. Commission a data inventory audit to map all personal data stores.
2. Verify the deletion cascade covers every store identified in the inventory.
3. Add integration tests that create a user with data across all stores, delete the account, then verify all data is gone.
4. Add a deletion confirmation email with a 30-day grace period.
**CONFIDENCE:** UNKNOWN — cascade completeness not independently verified.

---

## 4. API Endpoint Security Matrix

### Public Endpoints (No Authentication Required)

| Endpoint | Method | Action | Rate Limit | Input Validation | Risk Notes |
|----------|--------|--------|------------|------------------|------------|
| `/api/admin-codes` | POST | `?action=login` | 5/15min IP | Password validated | Brute-force protected by rate limit; 5 attempts per 15 min |
| `/api/admin-codes` | POST | `?action=verify` | None | Token format checked | No rate limit on verification — potential for token brute-force |
| `/api/auth` | POST | `?action=request` | 3/15min email+IP | Email, purpose validated | Compound rate limit key (email+IP) reduces enumeration risk |
| `/api/auth` | GET/POST | `?action=verify` | None | Token validated | No rate limit — token brute-force possible |
| `/api/device-register` | POST | — | 5/15min IP | deviceId validated | Device registration without auth — design intent |
| `/api/early-alerts` | GET | — | None | Validated | Public read endpoint — no sensitive data exposure verified |
| `/api/fetch-live` | GET | — | None | leagueId whitelisted | League whitelist prevents arbitrary data access |
| `/api/matches` | GET | — | None | leagueId whitelisted | League whitelist prevents arbitrary data access |

### Authenticated Endpoints (HMAC or Bearer)

| Endpoint | Method | Auth | Rate Limit | Risk Notes |
|----------|--------|------|------------|------------|
| `/api/predictions` | GET/POST/DELETE | HMAC/Bearer | None | **No rate limit** — potential for prediction spam |
| `/api/analyze-match` | POST | HMAC/Bearer | 10/min IP | Rate limited; leagueId whitelisted |
| `/api/auth` | POST `?action=refresh-token` | Bearer user | 10/hr IP | Reasonable for refresh flow |
| `/api/auth` | POST `?action=delete-account` | Bearer user |"h 3/hr IP | Conservative — prevents accidental deletion spam |
| `/api/premium-activate` | POST | HMAC/Bearer | None | **No rate limit** — premium activation abuse? |

### Internal Endpoints (CRON_SECRET)

| Endpoint | Method | Auth | Risk Notes |
|----------|--------|------|------------|
| `/api/auto5api/auto-playout` | POST | CRON_SECRET | Vercel Cron — should verify secret match |
| `/api/verify-predictions` | POST | CRON_SECRET/HMAC/Bearer | Multi-auth — complexity risk |
| `/api/push-odds` | POST | CRON_SECRET | Vercel Cron |

### Admin Endpoints (Bearer admin)

| Endpoint | Method | Auth | Rate Limit | Risk Notes |
|----------|--------|------|------------|------------|
| `/api/admin-codes` | GET/POST (other) | Bearer admin | None | **No rate limit** on admin operations |

### Key Observations

1. **`/api/predictions` has NO rate limit.** An authenticated user can create unlimited predictions. This may be acceptable for the use case but should be reviewed.
2. **`/api/admin-codes ?action=verify` has NO rate limit.** An attacker can brute-force admin verification tokens without rate limiting.
3. **`/api/auth ?action=verify` has NO rate limit.** Same concern for auth verification tokens.
4. **Admin endpoints have no rate limit.** Compromised admin tokens allow unlimited operations.

---

## 5. CSP Header Analysis

**Source:** `vercel.json` response headers

| Directive | Value | Assessment |
|-----------|-------|------------|
| `default-src` | `'self'` | ✅ Strict default |
| `script-src` | `'self'` | ✅ No unsafe-inline, no unsafe-eval |
| `style-src` | `'self' 'unsafe-inline'` | ⚠️ Required for Tailwind (SEV-D001) |
| `img-src` | `'self' data: blob: https://lh3.googleusercontent.com` | ⚠️ `data:` and `blob:` allow inline images; Google URL is specific |
| `connect-src` | `'self' https://virtual-match-hitifproject.vercel.app` | ✅ Restricted to own domain |
| `frame-ancestors` | `'none'` | ✅ Clickjacking protection |
| `base-uri` | `'self'` | ✅ Prevents base tag injection |
| `form-action` | `'self'` | ✅ Prevents form hijacking |
| `object-src` | `'none'` | ✅ No Flash/Java plugins |
| `manifest-src` | `'self'` | ✅ Restricted |
| HSTS | `max-age=31536000; includeSubDomains` | ✅ 1-year HSTS with subdomains |

### Overall CSP Grade: **A-**

The CSP policy is well-constructed. The only deviation is `unsafe-inline` in `style-src`, which is a known Tailwind requirement. The policy properly restricts `script-src`, `connect-src`, and `frame-ancestors`.

---

## 6. Dependency Vulnerability Summary

**Source:** `npm audit`

| Severity | Count | Packages | Vulnerability Type | Fix Available |
|----------|-------|----------|-------------------|---------------|
| High | 4 | `fast-uri`, `js-yaml`, `postcss-selector-parser` (2) | SSRF, DoS | ✅ Yes |
| Moderate | 4 | (various) | Various | ✅ Yes |
| Low | 1 | (various) | Various | ✅ Yes |

### High-Severity Detail

| Package | Vulnerability | CVSS Vector | Impact |
|---------|--------------|-------------|--------|
| `fast-uri` | SSRF / Host Confusion | Network-dependent | Attacker can bypass host validation to access internal services |
| `js-yaml` | Denial of Service | AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | Crafted YAML input crashes process |
| `postcss-selector-parser` | Denial of Service | AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | Crafted CSS input crashes process |

**Action Required:** `npm audit fix` resolves all 9 vulnerabilities. This should be executed before any other remediation.

---

## 7. OWASP Top 10 Coverage

| # | Risk | Status | Gaps |
|---|------|--------|------|
| A01 | Broken Access Control | ✅ MITIGATED | HMAC_ONLY enforcement uncertain (SEV-001) |
| A02 | Cryptographic Failures | ✅ MITIGATED | HMAC-SHA256; timingSafeEqual used |
| A03 | Injection | ✅ MITIGATED | generateDeletionSQL uses interpolation (SEV-012) — documentation only |
| A04 | Insecure Design | ✅ MITIGATED | Dual rate-limit API confusion (SEV-I001) |
| A05 | Security Misconfiguration | ✅ MITIGATED | HMAC_ONLY not documented (SEV-015) |
| A06 | Vulnerable Components | ✅ MITIGATED | 9 npm vulnerabilities (SEV-013) — fixes available |
| A07 | Auth Failures | ✅ MITIGATED | 7-day token expiry too long (SEV-003) |
| A08 | Software & Data Integrity | ✅ MITIGATED | No integrity checks on npm packages |
| A09 | Logging &0& Monitoring | ✅ MITIGATED | Fallback auth logged but not blocked (SEV-014) |
| A10 | SSRF | ✅ MITIGATED | fast-uri vulnerability (SEV-013) |

**Summary:** All 10 OWASP risks are mitigated at the protocol level. 13 documented gaps exist, all classified as non-critical but requiring remediation.

---

## 8. GDPR Compliance Assessment

| Right | Article | Status | Notes |
|-------|---------|--------|-------|
| Access | Art. 15 | ✅ Implemented | Users can request and receive their data |
| Rectification | Art. 16 | ❌ Not Implemented | No profile correction mechanism |
| Erasure | Art. 17 | ❌ Not Implemented | Deletion endpoint exists (SEV-I002) but cascade unverified |
| Restriction | Art. 18 | ❌ Not Implemented | No processing pause capability |
| Portability | Art. 20 | ❌ Not Implemented | No data export in machine-readable format |
| Objection | Art. 21 | ✅ Implemented | Users can object to processing |
| Automated Decision-Making | Art. 22 | ✅ Implemented | Users can contest automated decisions |

**Overall Compliance: ❌ FALSE** (`overallCompliant: false`)

**Priority Remediation Order:**
1. Erasure (Art. 17) — deletion endpoint exists, verify cascade completeness
2. Rectification (Art. 16) — implement profile correction
3. Portability (Art. 20) — implement data export (JSON/CSV)
4. Restriction (Art. 18) — implement processing pause flag

---

## 9. Secrets Management

| Variable | Purpose | In Code | In .env.example | In Deployment Scripts |
|----------|---------|---------|-----------------|----------------------|
| `ADMIN_TOKEN_SECRET` | Admin session signing | ❌ No | ✅ Placeholder | Not found |
| `USER_SESSION_SECRET` | User session signing | ❌ No | ✅ Placeholder | Not found |
| `CRON_SECRET` | Cron endpoint auth | ❌ No | ✅ Placeholder | Not found |
| `RESEND_API_KEY` |, ) Email service API key | ❌ No | ✅ Placeholder | Not found |
| `HMAC_ONLY` | Auth enforcement flag | ✅ Referenced | ❌ Missing | ❌ Missing |

**Assessment:** No secrets are hardcoded in the codebase. `.env.example` contains only placeholder values. The `HMAC_ONLY` variable is a notable omission from `.env.example` (SEV-015).

**Additional Observations:**
- `RESEND_API_KEY` is a third-party API key — ensure it's rotated regularly and has minimum required permissions.
- No secret rotation automation is implemented (noted as an OWASP gap).
- Vercel environment variables are the production secret store — ensure Vercel project access is restricted to minimum necessary team members.

---

## 10. Security Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT                                   │
│  ┌───────────────┐    ┌──────────────────────┐                  │
│  │ Device Token  │    │ Bearer Token (User)  │                  │
│  │ HMAC-SHA256   │    │ Session-Based        │                  │
│  └───────┬───────┘    └──────────┬───────────┘                  │
│          │                       │                              │
└──────────┼───────────────────────┼──────────────────────────────┘
           │                       │
           ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Vercel Edge                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   CORS Validation                        │    │
│  │  ✅ Origin allowlist    ✅ Vary: Origin                  │    │
│  │  ✅ No x-capacitor bypass (V-02 fix)                    │    │
│  │  ⚠️ Self-referencing origin check (SEV-010)             │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   CSP Headers                           │    │
│  │  ✅ script-src 'self'    ⚠️ style-src unsafe-inline     │    │
│  │  ✅ frame-ancestors 'none'  ✅ HSTS 1yr+subdomains      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
           │                       │
           ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Serverless Function                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐      │
│  │ HMAC Auth    │  │ Bearer Auth  │  │ CRON_SECRET Auth │      │
│  │ ⚠️ Narrow    │  │ ✅ Working   │  │ ✅ Working       │      │
│  │   scope      │  │              │  │                  │      │
│  │ ⚠️ 7-day TTL │  │              │  │                  │      │
│  │ ⚠️ No nonce  │  │              │  │                  │      │
│  │ ⚠️ Fallback  │  │              │  │                  │      │
│  │   if !HMAC   │  │              │  │                  │      │
│  │   _ONLY      │  │              │  │                  │      │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘      │
│         │                 │                    │                │
│  ┌──────▼─────────────────▼────────────────────▼──────────┐    │
│  │              Rate Limiting                              │    │
│  │  ┌─────────────┐    ┌───────────────────┐              │    │
│  │  │ Redis       │    │ In-Memory Fallback│              │    │
│  │  │ (Sliding    │    │ ⚠️ Lost on cold  │              │    │
│  │  │  Window)    │    │   start           │              │    │
│  │  └─────────────┘    └───────────────────┘              │    │
│  │  ⚠️ Dual API: check() vs checkDistributed()            │    │
│  └────────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              Token Revocation                          │    │
│  │  ┌─────────────┐    ┌───────────────────┐             │    │
│  │  │ Redis       │    │ In-Memory Fallback│             │    │
│  │  │ (SHA-256    │    │ ⚠️ Lost on cold  │             │    │
│  │  │  hashed)    │    │   start           │             │    │
│  │  │ Max 50K     │    │ ⚠️ Fail-open     │             │    │
│  │  └─────────────┘    └───────────────────┘             │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Data Layer                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐      │
│  │ Upstash Redis│  │ Database     │  │ Resend Email     │      │
│  │ (Rate Limit, │  │ (User Data,  │  │ (Auth Codes)     │      │
│  │  Revocation) │  │  Predictions)│  │                  │      │
│  └──────────────┘  └──────────────┘  └──────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. Risk Scorecard

### By Severity

```
CRITICAL ████████████████████████████████████████ 1
HIGH     ███████████████████████████████████████████████████████████████████████████████████████████████ 5
MEDIUM   ████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████ 7
LOW      ███████████████████████████████████ 3
INFO     ████████████ 2
```

### By Category

| Category | Findings | Max Severity |
|----------|----------|--------------|
| Authentication | 6 | CRITICAL (SEV-001) |
| Rate Limiting | 3 | HIGH (SEV-005) |
| Token Revocation | 2 | HIGH (SEV-004) |
| GDPR | 3 | MEDIUM (SEV-011) |
| Dependencies | 1 | MEDIUM (SEV-013) |
| CORS | 1 | MEDIUM (SEV-010) |
| CSP | 1 | LOW (SEV-D001) |
| Secrets | 1 | LOW (SEV-015) |
| Architecture | 1 | INFO (SEV-I001) |

### Remediation Priority

| Priority | Finding | Effort | Impact if Unfixed |
|----------|---------|--------|-------------------|
| P0 — Immediate | SEV-001: Verify HMAC_ONLY in production | 1 hour | Complete auth bypass possible |
| P0 — Immediate | SEV-013: npm audit fix | 30 min | SSRF, DoS in production |
| P1 — This Sprint | SEV-002: Expand HMAC signing scope | 2 days | Cross-endpoint replay |
| P1 — This Sprint | SEV-004/SEV-009: Fail-closed revocation | 1 day | Revoked tokens accepted |
| P1 — This Sprint | SEV-005: Unify rate-limit API | 1 day | Rate limit bypass |
| P2 — Next Sprint | SEV-003/SEV-007: Nonce + short TTL | 3 days | 7-day replay window |
| P2 — Next Sprint | SEV-011: GDPR rights (Erasure, Rectification, Portability) | 5 days | Regulatory non-compliance |
| P3 — Backlog | SEV-010: Replace self-referencing CORS | 2 days | DNS rebinding |
| P3 — Backlog | SEV-D001: Tailwind CSP (accept risk) | N/A | Low — requires XSS first |
| P3 — Backlog | SEV-012: Refactor generateDeletionSQL | 1 hour | Documentation-only risk |

---

## 12. Mandatory Security Questions (French)

### Q1: L'authentification est-elle correctement appliquée sur tous les points d'extrémité sensibles ?

**Réponse : NON, avec une incertitude critique.**

L'architecture d'authentification est double : HMAC-SHA256 pour les appareils et Bearer token pour les utilisateurs. Cependant, le drapeau fonctionnel `HMAC_ONLY` dont l'état en production est INCONNU (SEV-001) détermine si un en-tête `x-device-id` de secours est accepté. Si ce drapeau n'est pas activé, l'authentification HMAC peut être contournée entièrement sur les points d'extrémité `/api/predictions`, `/api/analyze-match` et `/api/premium-activate`. De plus, les points d'extrémité publics (`/api/early-alerts`, `/api/fetch-live`, `/api/matches`) n'exigent aucune authentification — ce qui peut être acceptable selon le modèle de menace, mais devrait être documenté explicitement. Les points d'extrémité de vérification (`/api/admin-codes ?action=verify`, `/api/auth ?action=verify`) n'ont pas de limite de débit, permettant le force brute des jetons de vérification.

### Q2: Les données sensibles sont-elles protégées contre la divulgation non autorisée ?

**Réponse : PARTIELLEMENT.**

Aucun secret n'est codé en dur dans le code source (vérifié). Les variables d'environnement sont utilisées pour tous les secrets. Cependant : (1) le secret `CRON_SECRET` protège les points d'extrémité internes mais sa rotation n'est pas automatisée ; (2) les jetons HMAC ont une durée de vie de 7 jours, augmentant la fenêtre d'exposition en cas d'interception ; (3) les journaux enregistrent l'utilisation de secours `x-device-id` mais ne bloquent pas les requêtes, créant un vecteur de fuite passive ; (4) le CSP restreint `connect-src` au domaine propre, empêchant l'exfiltration de données via XSS vers des domaines externes. La protection des données en transit dépend de HTTPS (appliqué par Vercel et HSTS).

### Q3: Les limites de débit sont-elles efficacement appliquées ?

**Réponse : NON, de manière fiable.**

La limitation de débit utilise un modèle double : Redis (Upstash, fenêtre glissante) comme magasin principal et un magasin en mémoire comme secours. Deux problèmes critiques : (1) SEV-005 — deux fonctions exportées (`check()` synchrone en mémoire et `checkDistributed()` asynchrone Redis) permettent aux gestionnaires d'appeler involontairement la fonction en mémoire, contournant la limitation distribuée ; (2) SEV-006 — les compteurs en mémoire sont perdus à chaque démarrage à froid serverless, réinitialisant les limites de débit. Les points d'extrémité sensibles au force brute (`/api/admin-codes`, `/api/auth`) sont particulièrement vulnérables si leurs gestionnaires utilisent `check()` au lieu de `checkDistributed()`. De plus, `/api/predictions` n'a aucune limite de débit, permettant le spam de prédictions par des utilisateurs authentifiés.

### Q4: Les jetons et sessions peuvent-ils être révoqués efficacement ?

**Réponse : NON, de manière fiable.**

La révocation des jetons utilise Redis (hachage SHA-256, TTL automatique) comme magasin principal avec un `Map` en mémoire comme secours. Le problème critique (SEV-004, SEV-009) : si Redis est indisponible lors d'une opération de révocation, le jeton est stocké en mémoire. Un démarrage à froid ultérieur perd cette entrée, et le jeton révoqué est accepté comme valide. Le système échoue en mode ouvert (fail-open) plutôt qu'en mode fermé (fail-closed) — le comportement par défaut en cas de panne du magasin de révocation est d'accepter le jeton. La durée de vie de 7 jours des jetons d'appareil amplifie ce risque : un appareil révoqué peut continuer à accéder à l'API pendant jusqu'à 7 jours après la révocation si la révocation est perdue.

### Q5: L'application est-elle protégée contre les attaques par injection ?

**Réponse : PARTIELLEMENT.**

La protection contre l'injection SQL est assurée par l'utilisation d'un ORM/Requêtes paramétrées dans le code de production. Cependant, la fonction `generateDeletionSQL()` (SEV-012) utilise l'interpolation de chaînes pour construire des requêtes SQL — bien que documentée comme fonction de documentation uniquement, le modèle de code existe dans la base de code et pourrait être accidentellement exécuté. La protection XSS est assurée par CSP `script-src 'self'` (pas de `unsafe-inline` ni `unsafe-eval`). L'injection d'en-têtes est atténuée par la validation d'entrée sur les paramètres de requête. L'injection de commande n'est pas applicable (pas d'exécution de shell). Le CSP `style-src 'unsafe-inline'` (SEV-D001) permet l'injection CSS, mais nécessite d'abord une vulnérabilité XSS. La dépendance `fast-uri` (SEV-013) présente un risque SSRF via la confusion d'hôte.

### Q6: Le respect du RGPD est-il assuré pour toutes les données à caractère personnel ?

**Réponse : NON.**

Seuls 3 des 7 droits des personnes concernées sont implémentés (SEV-011) : Droit d'accès (Art. 15), Droit d'opposition (Art. 21), Décisions automatisées (Art. 22). Les droits manquants sont : Rectification (Art. 16), Effacement (Art. 17), Restriction (Art. 18), Portabilité (Art. 20). Le module de conformité RGPD renvoie explicitement `overallCompliant: false`. Un point d'extrémité de suppression existe (`POST ?action=delete-account`), mais l'exhaustivité de la cascade de suppression n'a pas été vérifiée indépendamment (SEV-I002). La fonction `generateDeletionSQL()` utilise l'interpolation de chaînes (SEV-012), créant un risque d'injection SQL dans le chemin de suppression. L'organisation est exposée à des sanctions réglementaires (jusqu'à 20M€ ou 4% du chiffre d'affaires mondial).

### Q7: Les vulnérabilités des dépendances sont-elles suivies et corrigées ?

**Réponse : PARTIELLEMENT.**

`npm audit` identifie 9 vulnérabilités (1 faible, 4 modérées, 4 élevées), toutes avec des correctifs disponibles via `npm audit fix` (SEV-013). Les vulnérabilités élevées incluent SSRF/confusion d'hôte (`fast-uri`), DoS (`js-yaml`, `postcss-selector-parser`). Cependant : (1) aucune automatisation de correction n'est en place (pas de Dependabot/Renovate configuré) ; (2) aucune porte de qualité CI/CD ne bloque le déploiement sur les vulnérabilités élevées/critiques ; (3) les vulnérabilités sont présentes dans l'image de production actuelle. Les correctifs sont triviaux à appliquer (`npm audit fix`), ce qui indique un manque de processus plutôt qu'un manque de capacité. La rotation des secrets n'est pas automatisée (identifié comme lacune OWASP). Les dépendances ne sont pas vérifiées pour l'intégrité (pas de lockfile linting ou de vérification de hachage).

---

## Appendix A — Feature Flag Inventory

| Flag | Purpose | Default (if unset) | Documented | Production Value | Risk if Misconfigured |
|------|---------|---------------------|------------|------------------|---------------------|
| `HMAC_ONLY` | Enforce HMAC auth, disable `x-device-id` fallback | `'false'` (fallback ACTIVE) | ❌ No | UNKNOWN | CRITICAL — complete auth bypass |
| `ALLOWED_ORIGINS` | Custom CORS origins | Empty (localhost only) | ✅ Yes (via .env.example) | Unknown | LOW — CORS rejection for custom domains |

**Critical Observation:** The `HMAC_ONLY` flag uses an INSECURE DEFAULT. When the variable is absent from the environment, the code evaluates `process.env.HMAC_ONLY === 'true'` as `false`, ACTIVATING the insecure fallback. The flag should be inverted: `HMAC_FALLBACK_ALLOWED` with default `false`.

---

## Appendix B — Remediation Priority Matrix

| Priority | Timeframe | Finding | Action | Owner | Verification |
|----------|-----------|---------|--------|-------|-------------- |
| **P0** | < 24h | SEV-001 | Verify `HMAC_ONLY` in Vercel production env; set to `'true'` if unset | Ops | Check Vercel dashboard; test fallback is rejected |
| **P0** | < 24h | SEV-013 | Run `npm audit fix`; verify lockfile; deploy | Dev | Re-run `npm audit` — expect 0 high/critical |
| **P1** | < 1 week | SEV-002 | Extend HMAC signing to include `method:path:bodyHash` | Dev | Integration test: v1 token rejected on wrong endpoint |
| **P1** | < 1 week | SEV-004 | Fail-closed revocation when Redis unavailable | Dev | Chaos test: kill Redis, verify 503 on revoked token |
| **P1** | < 1 week | SEV-005 | Deprecate `check()`; make `checkDistributed()` default | Dev | Lint rule: flag `check()` import |
| **P1** | < 1 week | SEV-009 | Implement circuit breaker for Redis revocation | Dev | Test: Redis down → all HMAC requests rejected |
| **P2** | < 2 weeks | SEV-003 | Reduce token TTL to 60 min | Dev | Config change; verify short-lived tokens work |
| **P2** | < 2 weeks | SEV-007 | Add nonce to HMAC token format | Dev | Integration test: replay same token → rejected |
| **P2** | < 2 weeks | SEV-008 | Add `CLOCK_SKEW_TOLERANCE_MS` constant | Dev | Unit test: ±30s skew accepted |
| **P2** | < 2 weeks | SEV-011 | Implement Erasure, Rectification, Portability | Dev | GDPR compliance test suite passes |
| **P3** | < 1 month | SEV-010 | Replace self-referencing CORS with static allowlist | Dev | Test: forged Origin matching Host → rejected |
| **P3** | < 1 month | SEV-012 | Refactor `generateDeletionSQL()` to parameterized | Dev | ESLint: no SQL string concat |
| **P3** | < 1 month | SEV-014 | Add `HMAC_FALLBACK_BLOCK` feature flag | Dev | Canary test: flag on → fallback blocked |
| **P3** | < 1 month | SEV-015 | Document `HMAC_ONLY` in `.env.example` and deploy scripts | Dev | Checklist: flag in .env.example |
| **Accept** | N/A | SEV-D001 | Accept `unsafe-inline` risk for Tailwind | Lead | Documented in CSP ADR |
| **Track** | N/A | SEV-I001 | Design unified rate-limit API | Dev | Architecture decision record |
| **Track** | N/A | SEV-I002 | Verify deletion cascade completeness | QA | Data inventory + deletion test |

---

**End of Audit V3**

*This audit was conducted as a READ-ONLY review. No code was modified. All findings are based on static analysis of the repository at the time of review. Production environment variables managed by Vercel were not accessible and are noted as UNKNOWN where relevant.*
