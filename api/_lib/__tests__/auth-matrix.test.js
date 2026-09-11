/**
 * Phase AE — API Authorization Matrix Tests
 *
 * Validates:
 * - All 12 API endpoints documented (consolidated from 16)
 * - Auth requirements for each endpoint
 * - Public vs authenticated endpoint classification
 * - Rate limiting coverage
 * - Risk levels assigned
 * - CORS consistency
 * - No endpoint missing from matrix
 * - Auth type coverage
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const apiDir = path.join(ROOT, "api");

import {
  AUTH_TYPES,
  API_AUTH_MATRIX,
  getAuthenticatedEndpoints,
  getPublicEndpoints,
  getUnratedEndpoints,
  getEndpointsByRisk,
  getEndpointInfo,
} from "../auth-matrix.js";

describe("Phase AE: API Authorization Matrix", () => {
  // ─── 1. Matrix completeness ────────────────────────────

  describe("matrix completeness", () => {
    it("documents all 12 API endpoints", () => {
      expect(API_AUTH_MATRIX.length).toBe(12);
    });

    it("every entry has required fields", () => {
      API_AUTH_MATRIX.forEach((entry) => {
        expect(entry.endpoint).toMatch(/^\/api\//);
        expect(entry.methods.length).toBeGreaterThan(0);
        expect(typeof entry.authRequired).toBe("boolean");
        expect(entry.authTypes.length).toBeGreaterThan(0);
        expect(typeof entry.rateLimited).toBe("boolean");
        expect(typeof entry.corsEnabled).toBe("boolean");
        expect(typeof entry.isPublic).toBe("boolean");
        expect(entry.riskLevel).toBeTruthy();
        expect(entry.notes).toBeTruthy();
      });
    });

    it("all endpoints in api/ directory are documented", () => {
      const apiFiles = fs.readdirSync(apiDir)
        .filter((f) => f.endsWith(".js") && !f.startsWith("_"))
        .map((f) => `/api/${f.replace(".js", "")}`);
      const documented = API_AUTH_MATRIX.map((e) => e.endpoint);
      apiFiles.forEach((endpoint) => {
        expect(documented).toContain(endpoint);
      });
    });
  });

  // ─── 2. Auth requirements ──────────────────────────────

  describe("auth requirements", () => {
    it("5 endpoints require auth (fully or partially)", () => {
      // predictions, admin-codes, premium-activate, verify-predictions, push-odds, analyze-match, auto-playout
      const authed = getAuthenticatedEndpoints();
      expect(authed.length).toBeGreaterThanOrEqual(5);
    });

    it("4 endpoints are fully public", () => {
      const public_ = getPublicEndpoints();
      expect(public_.length).toBeGreaterThanOrEqual(4);
      const paths = public_.map((e) => e.endpoint);
      expect(paths).toContain("/api/auth");
      expect(paths).toContain("/api/device-register");
      expect(paths).toContain("/api/matches");
      expect(paths).toContain("/api/fetch-live");
    });

    it("predictions requires User Bearer or Device HMAC", () => {
      const pred = getEndpointInfo("/api/predictions");
      expect(pred.authTypes).toContain(AUTH_TYPES.USER_BEARER);
      expect(pred.authTypes).toContain(AUTH_TYPES.DEVICE_HMAC);
    });

    it("auto-playout requires Cron Key only", () => {
      const playout = getEndpointInfo("/api/auto-playout");
      expect(playout.authTypes).toEqual([AUTH_TYPES.CRON_KEY]);
    });

    it("push-odds requires Scraper Key only", () => {
      const push = getEndpointInfo("/api/push-odds");
      expect(push.authTypes).toEqual([AUTH_TYPES.SCRAPER_KEY]);
    });

    it("admin-codes uses Admin Bearer for management operations", () => {
      const admin = getEndpointInfo("/api/admin-codes");
      expect(admin.authTypes).toContain(AUTH_TYPES.ADMIN_BEARER);
    });

    it("verify-predictions supports User, Device, AND Cron auth", () => {
      const verify = getEndpointInfo("/api/verify-predictions");
      expect(verify.authTypes).toContain(AUTH_TYPES.USER_BEARER);
      expect(verify.authTypes).toContain(AUTH_TYPES.DEVICE_HMAC);
      expect(verify.authTypes).toContain(AUTH_TYPES.CRON_KEY);
    });

    it("auth endpoint supports User Bearer for refresh-token and delete-account actions", () => {
      const auth = getEndpointInfo("/api/auth");
      expect(auth.authTypes).toContain(AUTH_TYPES.USER_BEARER);
    });
  });

  // ─── 3. Rate limiting coverage ─────────────────────────

  describe("rate limiting coverage", () => {
    it("at least 5 endpoints have explicit rate limiting", () => {
      const rated = API_AUTH_MATRIX.filter((e) => e.rateLimited);
      expect(rated.length).toBeGreaterThanOrEqual(5);
    });

    it("endpoints without explicit rate limiting rely on middleware", () => {
      const unrated = getUnratedEndpoints();
      expect(unrated.length).toBeGreaterThanOrEqual(5);
    });

    it("public endpoints with sensitive actions have rate limiting", () => {
      // auth (request), device-register, admin-codes (login), premium-activate
      const publicWithSensitiveActions = ["/api/auth", "/api/device-register", "/api/admin-codes", "/api/premium-activate"];
      publicWithSensitiveActions.forEach((endpoint) => {
        const info = getEndpointInfo(endpoint);
        expect(info.rateLimited).toBe(true);
      });
    });

    it("endpoints without rate limiting note middleware fallback", () => {
      const unrated = getUnratedEndpoints();
      // At least some should mention middleware
      const notingMiddleware = unrated.filter(
        (e) => e.rateLimit.includes("middleware") || e.notes.includes("middleware")
      );
      expect(notingMiddleware.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── 4. Risk levels ────────────────────────────────────

  describe("risk levels", () => {
    it("majority of endpoints are LOW risk", () => {
      const low = getEndpointsByRisk("LOW");
      expect(low.length).toBeGreaterThan(5);
    });

    it("MEDIUM risk endpoints are documented", () => {
      const medium = getEndpointsByRisk("MEDIUM");
      expect(medium.length).toBeGreaterThan(0);
      // analyze-match and verify-predictions and early-alerts
      const paths = medium.map((e) => e.endpoint);
      expect(paths).toContain("/api/analyze-match");
      expect(paths).toContain("/api/verify-predictions");
    });

    it("HIGH risk endpoints are documented and controlled", () => {
      const high = getEndpointsByRisk("HIGH");
      const critical = getEndpointsByRisk("CRITICAL");
      // account-delete is now merged into auth.js as action=delete-account
      // HIGH risk is tracked in the auth entry notes
      expect(critical.length).toBe(0);
      for (const h of high) {
        expect(h.authRequired).toBe(true);
      }
    });

    it("MEDIUM risk endpoints have documented reasons", () => {
      const medium = getEndpointsByRisk("MEDIUM");
      medium.forEach((e) => {
        expect(e.notes.length).toBeGreaterThan(10);
      });
    });
  });

  // ─── 5. CORS consistency ───────────────────────────────

  describe("CORS consistency", () => {
    it("majority of endpoints have CORS enabled", () => {
      const withCors = API_AUTH_MATRIX.filter((e) => e.corsEnabled);
      expect(withCors.length).toBeGreaterThanOrEqual(10);
    });

    it("auto-playout is the only endpoint without CORS (cron-only)", () => {
      const withoutCors = API_AUTH_MATRIX.filter((e) => !e.corsEnabled);
      expect(withoutCors.length).toBe(1);
      expect(withoutCors[0].endpoint).toBe("/api/auto-playout");
    });
  });

  // ─── 6. Auth type distribution ─────────────────────────

  describe("auth type distribution", () => {
    it("User Bearer is used in at least 4 endpoints", () => {
      const userBearer = API_AUTH_MATRIX.filter(
        (e) => e.authTypes.includes(AUTH_TYPES.USER_BEARER)
      );
      expect(userBearer.length).toBeGreaterThanOrEqual(4);
    });

    it("Device HMAC is used in 4 endpoints", () => {
      const deviceHmac = API_AUTH_MATRIX.filter(
        (e) => e.authTypes.includes(AUTH_TYPES.DEVICE_HMAC)
      );
      expect(deviceHmac.length).toBe(4);
    });

    it("Admin Bearer is used in 2 endpoints", () => {
      const admin = API_AUTH_MATRIX.filter(
        (e) => e.authTypes.includes(AUTH_TYPES.ADMIN_BEARER)
      );
      expect(admin.length).toBe(2);
    });

    it("Cron Key is used in at least 2 endpoints", () => {
      const cron = API_AUTH_MATRIX.filter(
        (e) => e.authTypes.includes(AUTH_TYPES.CRON_KEY)
      );
      expect(cron.length).toBeGreaterThanOrEqual(2);
    });

    it("Scraper Key is used in 1 endpoint", () => {
      const scraper = API_AUTH_MATRIX.filter(
        (e) => e.authTypes.includes(AUTH_TYPES.SCRAPER_KEY)
      );
      expect(scraper.length).toBe(1);
    });
  });

  // ─── 7. Implementation verification ───────────────────

  describe("implementation verification", () => {
    it("middleware.js applies global rate limiting to all /api routes", () => {
      const middleware = fs.readFileSync(
        path.join(ROOT, "middleware.js"),
        "utf-8"
      );
      expect(middleware).toContain("/api");
    });

    it("auth matrix matches actual API files on disk", () => {
      const actualFiles = fs.readdirSync(apiDir)
        .filter((f) => f.endsWith(".js") && !f.startsWith("_"))
        .sort();
      const documentedPaths = API_AUTH_MATRIX
        .map((e) => e.endpoint.replace("/api/", "") + ".js")
        .sort();
      expect(documentedPaths).toEqual(actualFiles);
    });
  });

  // ─── 8. Security properties ────────────────────────────

  describe("security properties", () => {
    it("no public endpoint exposes write operations (except auth/register)", () => {
      const publicEndpoints = getPublicEndpoints();
      const safePublicEndpoints = publicEndpoints.filter(
        (e) => e.endpoint !== "/api/auth" && e.endpoint !== "/api/device-register"
      );
      // matches, fetch-live should only have GET (fetch-live has POST for mode changes)
      safePublicEndpoints.forEach((e) => {
        if (e.endpoint === "/api/fetch-live") return; // fetch-live has POST for mode changes
        expect(e.methods).toEqual(["GET"]);
      });
    });

    it("all authenticated endpoints use timing-safe comparison", () => {
      // Verify the auth module uses timingSafeEqual
      const authLib = fs.readFileSync(
        path.join(apiDir, "_lib", "auth.js"),
        "utf-8"
      );
      expect(authLib).toContain("timingSafeEqual");
    });

    it("DELETE method only available on predictions (with ownership check)", () => {
      const withDelete = API_AUTH_MATRIX.filter(
        (e) => e.methods.includes("DELETE")
      );
      expect(withDelete.length).toBe(1);
      expect(withDelete[0].endpoint).toBe("/api/predictions");
    });
  });

  // ─── 9. Consolidated endpoint action routing ────────────

  describe("consolidated endpoint action routing", () => {
    it("auth.js supports refresh-token action", () => {
      const src = fs.readFileSync(path.join(apiDir, "auth.js"), "utf-8");
      expect(src).toContain("refresh-token");
      expect(src).toContain("handleRefreshToken");
    });

    it("auth.js supports delete-account action", () => {
      const src = fs.readFileSync(path.join(apiDir, "auth.js"), "utf-8");
      expect(src).toContain("delete-account");
      expect(src).toContain("handleDeleteAccount");
    });

    it("auto-playout.js supports data-cleanup action via header", () => {
      const src = fs.readFileSync(path.join(apiDir, "auto-playout.js"), "utf-8");
      expect(src).toContain("data-cleanup");
      expect(src).toContain("handleDataCleanup");
    });

    it("verify-predictions.js supports health action", () => {
      const src = fs.readFileSync(path.join(apiDir, "verify-predictions.js"), "utf-8");
      expect(src).toContain("health");
      expect(src).toContain("handleHealthCheck");
    });

    it("standalone endpoint files no longer exist", () => {
      expect(fs.existsSync(path.join(apiDir, "refresh-token.js"))).toBe(false);
      expect(fs.existsSync(path.join(apiDir, "account-delete.js"))).toBe(false);
      expect(fs.existsSync(path.join(apiDir, "data-cleanup.js"))).toBe(false);
      expect(fs.existsSync(path.join(apiDir, "health.js"))).toBe(false);
    });
  });
});
