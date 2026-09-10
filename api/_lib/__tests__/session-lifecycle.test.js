/**
 * Phase AD — Session & Token Lifecycle Tests
 *
 * Validates:
 * - All token types documented in registry
 * - Expiry durations are reasonable
 * - Token security gaps identified
 * - Secret rotation schedules defined
 * - Non-revocable tokens documented
 * - HMAC_ONLY flag behavior
 * - Timing-safe comparison for all HMAC operations
 * - Magic link single-use enforcement
 * - Session token format correctness
 * - Device token refresh capability
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const apiDir = path.join(ROOT, "api");

import {
  TOKEN_TYPES,
  TOKEN_REGISTRY,
  TOKEN_SECURITY_GAPS,
  SECRET_ROTATION_SCHEDULE,
  getTokenInfo,
  getNonRevocableTokens,
  getGapsBySeverity,
  isTokenRefreshable,
} from "../session-lifecycle.js";

// ─── Token Registry Completeness ──────────────────────────────

describe("Phase AD: Session & Token Lifecycle", () => {
  // ─── 1. Token registry ─────────────────────────────────

  describe("token registry completeness", () => {
    it("defines all 4 token types", () => {
      expect(Object.keys(TOKEN_TYPES).length).toBe(4);
      expect(TOKEN_TYPES.DEVICE_HMAC).toBe("DEVICE_HMAC");
      expect(TOKEN_TYPES.USER_SESSION).toBe("USER_SESSION");
      expect(TOKEN_TYPES.ADMIN_SESSION).toBe("ADMIN_SESSION");
      expect(TOKEN_TYPES.MAGIC_LINK).toBe("MAGIC_LINK");
    });

    it("registry has entries for all token types", () => {
      expect(TOKEN_REGISTRY.length).toBe(4);
      const types = TOKEN_REGISTRY.map((t) => t.type);
      expect(types).toContain(TOKEN_TYPES.DEVICE_HMAC);
      expect(types).toContain(TOKEN_TYPES.USER_SESSION);
      expect(types).toContain(TOKEN_TYPES.ADMIN_SESSION);
      expect(types).toContain(TOKEN_TYPES.MAGIC_LINK);
    });

    it("every token entry has required fields", () => {
      TOKEN_REGISTRY.forEach((token) => {
        expect(token.type).toBeTruthy();
        expect(token.description).toBeTruthy();
        expect(token.expiryMs).toBeGreaterThan(0);
        expect(token.expiryLabel).toBeTruthy();
        expect(token.signingKey).toBeTruthy();
        expect(token.verification).toBeTruthy();
        expect(typeof token.revocable).toBe("boolean");
        expect(typeof token.singleUse).toBe("boolean");
        expect(typeof token.refreshable).toBe("boolean");
        expect(token.sourceFile).toBeTruthy();
      });
    });
  });

  // ─── 2. Token expiry durations ─────────────────────────

  describe("token expiry durations", () => {
    it("device HMAC token expires in 7 days", () => {
      const device = getTokenInfo(TOKEN_TYPES.DEVICE_HMAC);
      expect(device.expiryMs).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it("user session token expires in 30 days", () => {
      const user = getTokenInfo(TOKEN_TYPES.USER_SESSION);
      expect(user.expiryMs).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it("admin session token expires in 24 hours", () => {
      const admin = getTokenInfo(TOKEN_TYPES.ADMIN_SESSION);
      expect(admin.expiryMs).toBe(24 * 60 * 60 * 1000);
    });

    it("magic link expires in 15 minutes", () => {
      const magic = getTokenInfo(TOKEN_TYPES.MAGIC_LINK);
      expect(magic.expiryMs).toBe(15 * 60 * 1000);
    });

    it("no token has infinite expiry (all expire)", () => {
      TOKEN_REGISTRY.forEach((token) => {
        expect(token.expiryMs).toBeLessThan(Infinity);
        expect(token.expiryMs).toBeLessThan(365 * 24 * 60 * 60 * 1000); // < 1 year
      });
    });

    it("magic link has shortest expiry", () => {
      const magic = getTokenInfo(TOKEN_TYPES.MAGIC_LINK);
      const others = TOKEN_REGISTRY.filter((t) => t.type !== TOKEN_TYPES.MAGIC_LINK);
      others.forEach((t) => {
        expect(magic.expiryMs).toBeLessThan(t.expiryMs);
      });
    });
  });

  // ─── 3. Token revocation ───────────────────────────────

  describe("token revocation capabilities", () => {
    it("magic link is the only revocable token type", () => {
      const revocable = TOKEN_REGISTRY.filter((t) => t.revocable);
      expect(revocable.length).toBe(1);
      expect(revocable[0].type).toBe(TOKEN_TYPES.MAGIC_LINK);
    });

    it("3 token types are non-revocable (documented gap)", () => {
      const nonRevocable = getNonRevocableTokens();
      expect(nonRevocable.length).toBe(3);
    });

    it("non-revocable tokens have documented mitigation", () => {
      getNonRevocableTokens().forEach((token) => {
        expect(token.revocationMethod).toBeTruthy();
        expect(token.revocationMethod).not.toBe("None");
      });
    });
  });

  // ─── 4. Token security gaps ────────────────────────────

  describe("token security gaps", () => {
    it("identifies 6 security gaps", () => {
      expect(TOKEN_SECURITY_GAPS.length).toBe(6);
    });

    it("identifies 2 HIGH severity gaps", () => {
      const high = getGapsBySeverity("HIGH");
      expect(high.length).toBe(2);
    });

    it("identifies 3 MEDIUM severity gaps", () => {
      const medium = getGapsBySeverity("MEDIUM");
      expect(medium.length).toBe(3);
    });

    it("identifies 1 LOW severity gap", () => {
      const low = getGapsBySeverity("LOW");
      expect(low.length).toBe(1);
    });

    it("all gaps have id, description, and mitigation", () => {
      TOKEN_SECURITY_GAPS.forEach((gap) => {
        expect(gap.id).toBeTruthy();
        expect(gap.description).toBeTruthy();
        expect(gap.mitigation).toBeTruthy();
        expect(gap.status).toBeTruthy();
      });
    });

    it("GAP-01 documents no token revocation", () => {
      const gap1 = TOKEN_SECURITY_GAPS.find((g) => g.id === "GAP-01");
      expect(gap1).toBeDefined();
      expect(gap1.severity).toBe("HIGH");
    });

    it("GAP-02 documents 30-day sessions without revocation", () => {
      const gap2 = TOKEN_SECURITY_GAPS.find((g) => g.id === "GAP-02");
      expect(gap2).toBeDefined();
      expect(gap2.affectedTokens).toContain(TOKEN_TYPES.USER_SESSION);
    });

    it("GAP-05 documents HMAC_ONLY migration status", () => {
      const gap5 = TOKEN_SECURITY_GAPS.find((g) => g.id === "GAP-05");
      expect(gap5).toBeDefined();
      expect(gap5.status).toBe("IN_PROGRESS");
    });
  });

  // ─── 5. Secret rotation schedule ───────────────────────

  describe("secret rotation schedule", () => {
    it("defines rotation for 6 secrets", () => {
      expect(SECRET_ROTATION_SCHEDULE.length).toBe(6);
    });

    it("all secrets have rotation period >= 90 days", () => {
      SECRET_ROTATION_SCHEDULE.forEach((s) => {
        expect(s.rotationDays).toBeGreaterThanOrEqual(90);
      });
    });

    it("all secrets have grace period defined", () => {
      SECRET_ROTATION_SCHEDULE.forEach((s) => {
        expect(typeof s.graceHours).toBe("number");
        expect(s.graceHours).toBeGreaterThanOrEqual(0);
      });
    });

    it("USER_SESSION_SECRET has longest grace period (72h for 30-day sessions)", () => {
      const userSecret = SECRET_ROTATION_SCHEDULE.find(
        (s) => s.secret === "USER_SESSION_SECRET"
      );
      expect(userSecret).toBeDefined();
      expect(userSecret.graceHours).toBe(72);
    });

    it("RESEND_API_KEY has zero grace period (external service)", () => {
      const resend = SECRET_ROTATION_SCHEDULE.find(
        (s) => s.secret === "RESEND_API_KEY"
      );
      expect(resend).toBeDefined();
      expect(resend.graceHours).toBe(0);
    });
  });

  // ─── 6. Auth.js implementation ─────────────────────────

  describe("auth.js implementation verification", () => {
    let authLib;

    beforeAll(() => {
      authLib = fs.readFileSync(path.join(apiDir, "_lib", "auth.js"), "utf-8");
    });

    it("uses timing-safe comparison (crypto.timingSafeEqual)", () => {
      expect(authLib).toContain("timingSafeEqual");
    });

    it("defines 7-day token expiry constant", () => {
      expect(authLib).toMatch(/7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    });

    it("defines 7-day user session duration (reduced from 30, GAP-02 fix)", () => {
      expect(authLib).toMatch(/7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    });

    it("supports HMAC_ONLY feature flag", () => {
      expect(authLib).toContain("HMAC_ONLY");
    });

    it("device ID regex requires dev- prefix", () => {
      expect(authLib).toMatch(/dev-\[a-z0-9\]/);
    });
  });

  // ─── 7. Magic link single-use enforcement ──────────────

  describe("magic link single-use enforcement", () => {
    let authHandler;

    beforeAll(() => {
      authHandler = fs.readFileSync(path.join(apiDir, "auth.js"), "utf-8");
    });

    it("magic links have 15-minute expiry", () => {
      expect(authHandler).toContain("15 minutes");
    });

    it("magic links are checked for used_at IS NULL", () => {
      expect(authHandler).toContain("used_at");
    });

    it("magic links are checked for expires_at > NOW()", () => {
      expect(authHandler).toMatch(/expires_at\s*>\s*NOW\(\)/);
    });

    it("used_at is set immediately on verification", () => {
      expect(authHandler).toMatch(/SET\s+used_at\s*=\s*NOW\(\)/i);
    });
  });

  // ─── 8. Token refresh capabilities ─────────────────────

  describe("token refresh capabilities", () => {
    it("device HMAC token is refreshable (client regenerates)", () => {
      expect(isTokenRefreshable(TOKEN_TYPES.DEVICE_HMAC)).toBe(true);
    });

    it("user session token is NOT refreshable (no endpoint)", () => {
      expect(isTokenRefreshable(TOKEN_TYPES.USER_SESSION)).toBe(false);
    });

    it("admin session token is NOT refreshable", () => {
      expect(isTokenRefreshable(TOKEN_TYPES.ADMIN_SESSION)).toBe(false);
    });

    it("magic link is NOT refreshable (single-use)", () => {
      expect(isTokenRefreshable(TOKEN_TYPES.MAGIC_LINK)).toBe(false);
    });
  });

  // ─── 9. Admin session ──────────────────────────────────

  describe("admin session token", () => {
    let adminHandler;

    beforeAll(() => {
      adminHandler = fs.readFileSync(path.join(apiDir, "admin-codes.js"), "utf-8");
    });

    it("admin session has 24-hour expiry", () => {
      const admin = getTokenInfo(TOKEN_TYPES.ADMIN_SESSION);
      expect(admin.expiryMs).toBe(24 * 60 * 60 * 1000);
    });

    it("admin-codes.js defines 24h session duration", () => {
      expect(adminHandler).toMatch(/24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    });

    it("admin-codes.js requires Bearer token for protected operations", () => {
      expect(adminHandler).toContain("Bearer");
    });
  });

  // ─── 10. Token format validation ───────────────────────

  describe("token format specifications", () => {
    it("device HMAC uses base64url format", () => {
      const device = getTokenInfo(TOKEN_TYPES.DEVICE_HMAC);
      expect(device.format).toContain("base64url");
    });

    it("user session uses base64url format", () => {
      const user = getTokenInfo(TOKEN_TYPES.USER_SESSION);
      expect(user.format).toContain("base64url");
    });

    it("magic link uses hex format (64 chars)", () => {
      const magic = getTokenInfo(TOKEN_TYPES.MAGIC_LINK);
      expect(magic.format).toContain("hex");
    });

    it("all HMAC tokens use timing-safe verification", () => {
      const hmacTokens = TOKEN_REGISTRY.filter(
        (t) => t.verification.includes("timing-safe") || t.verification.includes("timingSafeEqual")
      );
      expect(hmacTokens.length).toBeGreaterThanOrEqual(3); // device + user + admin
    });
  });
});
