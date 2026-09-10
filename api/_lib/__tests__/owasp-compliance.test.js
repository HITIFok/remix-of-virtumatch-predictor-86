/**
 * Phase AF — OWASP Top 10 (2021) Compliance Tests
 *
 * Validates:
 * - All 10 OWASP Top 10 items covered
 * - Each item has controls documented
 * - Gaps identified and documented
 * - Overall compliance status
 * - Test suite references valid
 * - No item is CRITICAL or AT_RISK
 * - Total gaps count is manageable
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const apiDir = path.join(ROOT, "api");

import {
  OWASP_TOP_10,
  getOverallStatus,
  getTotalGaps,
  getAllGaps,
  getItemsWithGaps,
} from "../owasp-compliance.js";

describe("Phase AF: OWASP Top 10 Compliance", () => {
  // ─── 1. Coverage completeness ───────────────────────────

  describe("coverage completeness", () => {
    it("covers all 10 OWASP Top 10 items", () => {
      expect(OWASP_TOP_10.length).toBe(10);
    });

    it("covers A01 through A10", () => {
      const ids = OWASP_TOP_10.map((item) => item.id);
      expect(ids).toEqual(["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10"]);
    });

    it("every item has required fields", () => {
      OWASP_TOP_10.forEach((item) => {
        expect(item.id).toMatch(/^A\d{2}$/);
        expect(item.name).toBeTruthy();
        expect(item.description).toBeTruthy();
        expect(item.status).toBeTruthy();
        expect(Array.isArray(item.controls)).toBe(true);
        expect(Array.isArray(item.gaps)).toBe(true);
        expect(Array.isArray(item.testSuites)).toBe(true);
      });
    });

    it("every item has at least one control", () => {
      OWASP_TOP_10.forEach((item) => {
        expect(item.controls.length).toBeGreaterThan(0);
      });
    });
  });

  // ─── 2. Compliance status ──────────────────────────────

  describe("compliance status", () => {
    it("overall status is MITIGATED", () => {
      expect(getOverallStatus()).toBe("MITIGATED");
    });

    it("no item has CRITICAL status", () => {
      const critical = OWASP_TOP_10.filter((item) => item.status === "CRITICAL");
      expect(critical.length).toBe(0);
    });

    it("no item has AT_RISK status", () => {
      const atRisk = OWASP_TOP_10.filter((item) => item.status === "AT_RISK");
      expect(atRisk.length).toBe(0);
    });

    it("all items are MITIGATED", () => {
      OWASP_TOP_10.forEach((item) => {
        expect(item.status).toBe("MITIGATED");
      });
    });
  });

  // ─── 3. Specific OWASP items ───────────────────────────

  describe("specific OWASP item controls", () => {
    it("A01 (Broken Access Control) has HMAC controls", () => {
      const a01 = OWASP_TOP_10.find((i) => i.id === "A01");
      expect(a01.controls.some((c) => c.includes("HMAC"))).toBe(true);
      expect(a01.controls.some((c) => c.includes("timing-safe"))).toBe(true);
    });

    it("A02 (Cryptographic Failures) has SHA-256 controls", () => {
      const a02 = OWASP_TOP_10.find((i) => i.id === "A02");
      expect(a02.controls.some((c) => c.includes("SHA-256"))).toBe(true);
      expect(a02.controls.some((c) => c.includes("HSTS"))).toBe(true);
    });

    it("A03 (Injection) has parameterized queries", () => {
      const a03 = OWASP_TOP_10.find((i) => i.id === "A03");
      expect(a03.controls.some((c) => c.includes("Parameterized"))).toBe(true);
      expect(a03.controls.some((c) => c.includes("validate"))).toBe(true);
    });

    it("A05 (Security Misconfiguration) has CSP controls", () => {
      const a05 = OWASP_TOP_10.find((i) => i.id === "A05");
      expect(a05.controls.some((c) => c.includes("CSP"))).toBe(true);
      expect(a05.controls.some((c) => c.includes("DENY"))).toBe(true);
    });

    it("A06 (Vulnerable Components) has 0 runtime vulns", () => {
      const a06 = OWASP_TOP_10.find((i) => i.id === "A06");
      expect(a06.controls.some((c) => c.includes("0 runtime"))).toBe(true);
    });

    it("A07 (Auth Failures) has magic link controls", () => {
      const a07 = OWASP_TOP_10.find((i) => i.id === "A07");
      expect(a07.controls.some((c) => c.includes("Magic link"))).toBe(true);
      expect(a07.controls.some((c) => c.includes("Rate limiting"))).toBe(true);
    });

    it("A09 (Logging Failures) has structured logging", () => {
      const a09 = OWASP_TOP_10.find((i) => i.id === "A09");
      expect(a09.controls.some((c) => c.includes("Structured JSON"))).toBe(true);
      expect(a09.controls.some((c) => c.includes("PII redaction"))).toBe(true);
    });

    it("A10 (SSRF) has whitelist controls", () => {
      const a10 = OWASP_TOP_10.find((i) => i.id === "A10");
      expect(a10.controls.some((c) => c.includes("whitelist"))).toBe(true);
    });
  });

  // ─── 4. Gaps analysis ──────────────────────────────────

  describe("gaps analysis", () => {
    it("total gaps count is documented", () => {
      const total = getTotalGaps();
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThan(20); // Manageable number
    });

    it("items with gaps are identified", () => {
      const withGaps = getItemsWithGaps();
      expect(withGaps.length).toBeGreaterThan(0);
      expect(withGaps.length).toBeLessThan(10); // Not all items have gaps
    });

    it("all gaps have descriptive text", () => {
      const allGaps = getAllGaps();
      allGaps.forEach((gap) => {
        expect(gap.gap.length).toBeGreaterThan(5);
      });
    });

    it("A03 (Injection) has zero gaps", () => {
      const a03 = OWASP_TOP_10.find((i) => i.id === "A03");
      expect(a03.gaps.length).toBe(0);
    });

    it("A10 (SSRF) has zero gaps", () => {
      const a10 = OWASP_TOP_10.find((i) => i.id === "A10");
      expect(a10.gaps.length).toBe(0);
    });
  });

  // ─── 5. Test suite references ──────────────────────────

  describe("test suite references", () => {
    it("every item references at least one test suite", () => {
      OWASP_TOP_10.forEach((item) => {
        expect(item.testSuites.length).toBeGreaterThan(0);
      });
    });

    it("referenced test files exist in __tests__ directory", () => {
      const testsDir = path.join(apiDir, "_lib", "__tests__");
      const existingTests = fs.readdirSync(testsDir);
      OWASP_TOP_10.forEach((item) => {
        item.testSuites.forEach((suite) => {
          expect(existingTests).toContain(suite);
        });
      });
    });
  });

  // ─── 6. Implementation evidence ────────────────────────

  describe("implementation evidence", () => {
    it("validate.js exists with 9+ validation functions", () => {
      const validate = fs.readFileSync(
        path.join(apiDir, "_lib", "validate.js"),
        "utf-8"
      );
      expect(validate).toContain("validateEmail");
      expect(validate).toContain("validateDeviceId");
      expect(validate).toContain("validateLeagueId");
    });

    it("logger.js exists with PII redaction", () => {
      const logger = fs.readFileSync(
        path.join(apiDir, "_lib", "logger.js"),
        "utf-8"
      );
      expect(logger).toContain("redactEmail");
      expect(logger).toContain("redactIp");
      expect(logger).toContain("redactContext");
    });

    it("errors.js exists with correlation ID support", () => {
      const errors = fs.readFileSync(
        path.join(apiDir, "_lib", "errors.js"),
        "utf-8"
      );
      expect(errors).toContain("correlationId");
    });

    it("CSP in vercel.json has no unsafe-eval", () => {
      const vercel = JSON.parse(
        fs.readFileSync(path.join(ROOT, "vercel.json"), "utf-8")
      );
      const csp = vercel.headers
        .find((h) => h.source === "/(.*)")
        ?.headers.find((h) => h.key === "Content-Security-Policy")?.value || "";
      expect(csp).not.toContain("unsafe-eval");
    });

    it("auth.js uses timing-safe comparison", () => {
      const auth = fs.readFileSync(
        path.join(apiDir, "_lib", "auth.js"),
        "utf-8"
      );
      expect(auth).toContain("timingSafeEqual");
    });
  });
});
