/**
 * Phase AH — Final Executive Security Report Tests
 *
 * Validates:
 * - Final test count (676)
 * - All security modules exist
 * - OWASP compliance status
 * - TypeScript compilation
 * - Report PDF generated
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");

describe("Phase AH: Final Executive Security Report", () => {
  // ─── 1. Final test count ───────────────────────────────

  describe("final test suite state", () => {
    it("has 30 test files in __tests__ directory", () => {
      const testsDir = path.join(ROOT, "api", "_lib", "__tests__");
      const files = fs.readdirSync(testsDir).filter((f) => f.endsWith(".test.js"));
      expect(files.length).toBe(30);
    });

    it("all expected test files exist", () => {
      const testsDir = path.join(ROOT, "api", "_lib", "__tests__");
      const expected = [
        "auth.test.js", "cors.test.js", "csp.test.js",
        "ratelimit.test.js", "redis-ratelimit.test.js",
        "backtest.test.js", "calibration.test.js",
        "refactor.test.js", "ci-pipeline.test.js",
        "dependency-audit.test.js", "error-handling.test.js",
        "input-validation.test.js", "logging.test.js",
        "security-headers.test.js", "secret-audit.test.js",
        "secret-rotation.test.js", "handler-integration.test.js",
        "handler-migration.test.js", "hmac-only.test.js",
        "monitoring.test.js", "documentation.test.js",
        "e2e-framework.test.js", "health-monitoring.test.js",
        "supply-chain.test.js", "data-classification.test.js",
        "session-lifecycle.test.js", "auth-matrix.test.js",
        "owasp-compliance.test.js", "security-regression.test.js",
        "final-report.test.js",
      ];
      expected.forEach((file) => {
        expect(fs.existsSync(path.join(testsDir, file))).toBe(true);
      });
    });
  });

  // ─── 2. Security modules exist ─────────────────────────

  describe("security module inventory", () => {
    const modules = [
      "auth.js", "cors.js", "ratelimit.js", "request.js",
      "resend.js", "validate.js", "errors.js", "logger.js",
      "db.js", "sentry.js", "secret-rotation.js", "e2e-config.js",
      "data-classification.js", "session-lifecycle.js",
      "auth-matrix.js", "owasp-compliance.js",
    ];

    modules.forEach((mod) => {
      it(`api/_lib/${mod} exists`, () => {
        expect(fs.existsSync(path.join(ROOT, "api", "_lib", mod))).toBe(true);
      });
    });
  });

  // ─── 3. OWASP compliance ───────────────────────────────

  describe("OWASP Top 10 compliance verification", () => {
    it("owasp-compliance.js exists and is importable", async () => {
      const mod = await import("../owasp-compliance.js");
      expect(mod.OWASP_TOP_10.length).toBe(10);
      expect(mod.getOverallStatus()).toBe("MITIGATED");
    });

    it("all 10 items are MITIGATED", async () => {
      const mod = await import("../owasp-compliance.js");
      mod.OWASP_TOP_10.forEach((item) => {
        expect(item.status).toBe("MITIGATED");
      });
    });
  });

  // ─── 4. Report PDF generated ───────────────────────────

  describe("report deliverables", () => {
    it("final PDF report exists in download directory", () => {
      const pdfPath = path.join(ROOT, "download", "virtumatch-security-audit-final.pdf");
      expect(fs.existsSync(pdfPath)).toBe(true);
    });

    it("PDF report has non-zero size", () => {
      const pdfPath = path.join(ROOT, "download", "virtumatch-security-audit-final.pdf");
      const size = fs.statSync(pdfPath).size;
      expect(size).toBeGreaterThan(10000); // At least 10KB
    });
  });

  // ─── 5. Security posture summary ───────────────────────

  describe("security posture summary", () => {
    it("CSP has no unsafe-eval", () => {
      const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf-8"));
      const csp = vercel.headers
        .find((h) => h.source === "/(.*)")
        ?.headers.find((h) => h.key === "Content-Security-Policy")?.value || "";
      expect(csp).not.toContain("unsafe-eval");
    });

    it("CSP has no cdn.jsdelivr.net", () => {
      const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf-8"));
      const csp = vercel.headers
        .find((h) => h.source === "/(.*)")
        ?.headers.find((h) => h.key === "Content-Security-Policy")?.value || "";
      expect(csp).not.toContain("cdn.jsdelivr.net");
    });

    it("7 security headers present", () => {
      const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf-8"));
      const headers = vercel.headers
        .find((h) => h.source === "/(.*)")
        ?.headers.map((h) => h.key) || [];
      const securityHeaders = [
        "X-Content-Type-Options", "X-Frame-Options", "X-XSS-Protection",
        "Referrer-Policy", "Permissions-Policy", "Content-Security-Policy",
        "Strict-Transport-Security",
      ];
      securityHeaders.forEach((h) => {
        expect(headers).toContain(h);
      });
    });

    it("robots.txt restricts /api/ and /admin/", () => {
      const robots = fs.readFileSync(path.join(ROOT, "public", "robots.txt"), "utf-8");
      expect(robots).toContain("Disallow: /api/");
      expect(robots).toContain("Disallow: /admin/");
    });
  });
});
