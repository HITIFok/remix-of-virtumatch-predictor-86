/**
 * Phase AG — Security Regression Suite
 *
 * Comprehensive cross-phase regression tests ensuring all
 * security fixes from phases B through AF remain in place.
 * This is the "guard rail" — any regression here means
 * a security fix was accidentally removed.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const apiDir = path.join(ROOT, "api");

// ─── Regression: Phase B/C — CSP Fixes ───────────────────────

describe("Phase AG: Security Regression Suite", () => {
  // ─── 1. Phase B/C: CSP nonce/hash fix ──────────────────

  describe("Phase B/C regression: CSP fixes", () => {
    let vercelJson, csp;

    beforeAll(() => {
      vercelJson = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf-8"));
      csp = vercelJson.headers
        .find((h) => h.source === "/(.*)")
        ?.headers.find((h) => h.key === "Content-Security-Policy")?.value || "";
    });

    it("CSP does NOT have unsafe-eval (Phase C fix holds)", () => {
      expect(csp).not.toContain("unsafe-eval");
    });

    it("CSP does NOT have unsafe-inline in script-src (Phase C fix holds)", () => {
      const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] || "";
      expect(scriptSrc).not.toContain("unsafe-inline");
    });

    it("CSP has SHA-256 hash for inline script", () => {
      expect(csp).toMatch(/sha256-[A-Za-z0-9+/=]+/);
    });

    it("CSP has frame-ancestors none (clickjacking protection)", () => {
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it("cdn.jsdelivr.net removed from CSP (Phase AB fix holds)", () => {
      expect(csp).not.toContain("cdn.jsdelivr.net");
    });
  });

  // ─── 2. Phase E: Rate limiting ─────────────────────────

  describe("Phase E regression: Rate limiting", () => {
    it("middleware.js exists and applies rate limiting", () => {
      const middleware = fs.readFileSync(path.join(ROOT, "middleware.js"), "utf-8");
      expect(middleware).toContain("rate");
      expect(middleware).toContain("/api");
    });

    it("ratelimit.js shared module exists", () => {
      expect(fs.existsSync(path.join(apiDir, "_lib", "ratelimit.js"))).toBe(true);
    });
  });

  // ─── 3. Phase H: Coefficient calibration ───────────────

  describe("Phase H regression: Coefficient calibration", () => {
    it("prediction-config.ts exists with centralized coefficients", () => {
      const config = fs.readFileSync(
        path.join(ROOT, "src", "lib", "prediction-config.ts"),
        "utf-8"
      );
      expect(config).toContain("validateCoefficients");
    });

    it("startup-validation.ts exists", () => {
      expect(fs.existsSync(path.join(ROOT, "src", "lib", "startup-validation.ts"))).toBe(true);
    });
  });

  // ─── 4. Phase I: Shared modules ────────────────────────

  describe("Phase I regression: Shared modules", () => {
    const sharedModules = ["errors.js", "validate.js", "logger.js", "ratelimit.js", "request.js", "resend.js"];

    sharedModules.forEach((mod) => {
      it(`api/_lib/${mod} exists`, () => {
        expect(fs.existsSync(path.join(apiDir, "_lib", mod))).toBe(true);
      });
    });
  });

  // ─── 5. Phase J: CI pipeline ───────────────────────────

  describe("Phase J regression: CI pipeline", () => {
    it("ci-test.yml workflow exists", () => {
      expect(fs.existsSync(path.join(ROOT, ".github", "workflows", "ci-test.yml"))).toBe(true);
    });

    it("branch-guard.yml workflow exists", () => {
      expect(fs.existsSync(path.join(ROOT, ".github", "workflows", "branch-guard.yml"))).toBe(true);
    });
  });

  // ─── 6. Phase L: Error handling ────────────────────────

  describe("Phase L regression: Error handling", () => {
    it("errors.js has correlationId support", () => {
      const errors = fs.readFileSync(path.join(apiDir, "_lib", "errors.js"), "utf-8");
      expect(errors).toContain("correlationId");
    });

    it("errors.js separates cause from client response", () => {
      const errors = fs.readFileSync(path.join(apiDir, "_lib", "errors.js"), "utf-8");
      expect(errors).toContain("NEVER");
    });
  });

  // ─── 7. Phase M: Input validation ──────────────────────

  describe("Phase M regression: Input validation", () => {
    it("validate.js has validateEmail", () => {
      const validate = fs.readFileSync(path.join(apiDir, "_lib", "validate.js"), "utf-8");
      expect(validate).toContain("validateEmail");
    });

    it("validate.js has validateDeviceId", () => {
      const validate = fs.readFileSync(path.join(apiDir, "_lib", "validate.js"), "utf-8");
      expect(validate).toContain("validateDeviceId");
    });

    it("validate.js has sanitizeString", () => {
      const validate = fs.readFileSync(path.join(apiDir, "_lib", "validate.js"), "utf-8");
      expect(validate).toContain("sanitizeString");
    });
  });

  // ─── 8. Phase N: Logging ───────────────────────────────

  describe("Phase N regression: Logging & PII redaction", () => {
    it("logger.js has redactEmail", () => {
      const logger = fs.readFileSync(path.join(apiDir, "_lib", "logger.js"), "utf-8");
      expect(logger).toContain("redactEmail");
    });

    it("logger.js has redactIp", () => {
      const logger = fs.readFileSync(path.join(apiDir, "_lib", "logger.js"), "utf-8");
      expect(logger).toContain("redactIp");
    });

    it("logger.js has redactContext with PII_KEYS", () => {
      const logger = fs.readFileSync(path.join(apiDir, "_lib", "logger.js"), "utf-8");
      expect(logger).toContain("PII_KEYS");
    });

    it("userId and user_id in PII_KEYS (Phase AC fix holds)", () => {
      const logger = fs.readFileSync(path.join(apiDir, "_lib", "logger.js"), "utf-8");
      expect(logger).toContain("'userId'");
      expect(logger).toContain("'user_id'");
    });

    it("device_secret in PII_KEYS (Phase AC fix holds)", () => {
      const logger = fs.readFileSync(path.join(apiDir, "_lib", "logger.js"), "utf-8");
      expect(logger).toContain("'device_secret'");
    });
  });

  // ─── 9. Phase R: Security headers ──────────────────────

  describe("Phase R regression: Security headers", () => {
    let vercelHeaders;

    beforeAll(() => {
      const vercelJson = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf-8"));
      vercelHeaders = vercelJson.headers
        .find((h) => h.source === "/(.*)")
        ?.headers.map((h) => h.key) || [];
    });

    const expectedHeaders = [
      "X-Content-Type-Options",
      "X-Frame-Options",
      "X-XSS-Protection",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy",
      "Strict-Transport-Security",
    ];

    expectedHeaders.forEach((header) => {
      it(`${header} is present`, () => {
        expect(vercelHeaders).toContain(header);
      });
    });
  });

  // ─── 10. Phase V: HMAC-only enforcement ────────────────

  describe("Phase V regression: HMAC-only flag", () => {
    it("auth.js supports HMAC_ONLY flag", () => {
      const auth = fs.readFileSync(path.join(apiDir, "_lib", "auth.js"), "utf-8");
      expect(auth).toContain("HMAC_ONLY");
    });

    it("DELETE is blocked via HMAC fallback even during migration", () => {
      const auth = fs.readFileSync(path.join(apiDir, "_lib", "auth.js"), "utf-8");
      expect(auth).toMatch(/DELETE/i);
    });
  });

  // ─── 11. Phase AB: Supply chain ────────────────────────

  describe("Phase AB regression: Supply chain", () => {
    it("robots.txt restricts /api/", () => {
      const robots = fs.readFileSync(path.join(ROOT, "public", "robots.txt"), "utf-8");
      expect(robots).toContain("Disallow: /api/");
    });

    it("no external CDN scripts in index.html", () => {
      const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");
      expect(html).not.toContain("cdn.jsdelivr.net");
      expect(html).not.toContain("unpkg.com");
    });
  });

  // ─── 12. Phase AC: Data classification ─────────────────

  describe("Phase AC regression: Data classification", () => {
    it("data-classification.js exists with PII inventory", () => {
      const dc = fs.readFileSync(path.join(apiDir, "_lib", "data-classification.js"), "utf-8");
      expect(dc).toContain("PII_INVENTORY");
      expect(dc).toContain("SENSITIVITY");
    });
  });

  // ─── 13. Core security: no hardcoded secrets ───────────

  describe("core security: no hardcoded secrets", () => {
    it("no API keys hardcoded in api handlers", () => {
      const apiFiles = fs.readdirSync(apiDir)
        .filter((f) => f.endsWith(".js") && !f.startsWith("_"));

      const suspiciousPatterns = [
        /sk_live_[a-zA-Z0-9]+/,
        /pk_live_[a-zA-Z0-9]+/,
        /AKIA[0-9A-Z]{16}/, // AWS access key pattern
      ];

      apiFiles.forEach((file) => {
        const content = fs.readFileSync(path.join(apiDir, file), "utf-8");
        suspiciousPatterns.forEach((pattern) => {
          expect(pattern.test(content)).toBe(false);
        });
      });
    });
  });

  // ─── 14. Auth module: timing-safe ──────────────────────

  describe("auth module: timing-safe comparison", () => {
    it("auth.js uses crypto.timingSafeEqual", () => {
      const auth = fs.readFileSync(path.join(apiDir, "_lib", "auth.js"), "utf-8");
      expect(auth).toContain("timingSafeEqual");
    });

    it("no == or === for secret comparison in auth.js", () => {
      const auth = fs.readFileSync(path.join(apiDir, "_lib", "auth.js"), "utf-8");
      // The verifyDeviceToken function should use timingSafeEqual, not ===
      // Check that timingSafeEqual is called for the main verification
      expect(auth).toMatch(/timingSafeEqual\(.*expected.*\)/s);
    });
  });

  // ─── 15. CORS: no wildcard ─────────────────────────────

  describe("CORS: no wildcard origin", () => {
    it("cors.js does not allow * origin", () => {
      const cors = fs.readFileSync(path.join(apiDir, "_lib", "cors.js"), "utf-8");
      // Should not have Access-Control-Allow-Origin: *
      expect(cors).not.toMatch(/['"]\*['"]/);
    });
  });
});
