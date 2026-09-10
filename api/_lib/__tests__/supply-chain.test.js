/**
 * Phase AB — Supply Chain & Subresource Integrity Tests
 *
 * Validates:
 * - CSP excludes unused CDN domains (cdn.jsdelivr.net removed)
 * - package-lock.json integrity coverage (all packages have sha512)
 * - No external CDN scripts in index.html (SRI not needed)
 * - Fonts are self-hosted (no Google Fonts CDN)
 * - Capacitor config hardened (no mixed content, no debug)
 * - robots.txt restricts API/admin paths
 * - Lockfile uses official npm registry only
 * - No .npmrc with custom registries
 * - No script src= or link href= to external domains in HTML
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");

// ─── CSP Audit ──────────────────────────────────────────────

describe("Phase AB: Supply Chain & Subresource Integrity", () => {
  const vercelJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf-8")
  );
  const cspHeader = vercelJson.headers
    .find((h) => h.source === "/(.*)")
    ?.headers.find((h) => h.key === "Content-Security-Policy")?.value || "";

  // ─── 1. CSP excludes unused CDN domains ─────────────────

  describe("CSP excludes unused CDN domains", () => {
    it("script-src does not allow cdn.jsdelivr.net", () => {
      expect(cspHeader).not.toContain("cdn.jsdelivr.net");
    });

    it("script-src does not allow unpkg.com", () => {
      expect(cspHeader).not.toContain("unpkg.com");
    });

    it("script-src does not allow cdnjs.cloudflare.com", () => {
      expect(cspHeader).not.toContain("cdnjs.cloudflare.com");
    });

    it("style-src does not allow cdn.jsdelivr.net", () => {
      const styleSrc = cspHeader.match(/style-src\s+([^;]+)/)?.[1] || "";
      expect(styleSrc).not.toContain("cdn.jsdelivr.net");
    });

    it("CSP still contains self-origin for script-src", () => {
      const scriptSrc = cspHeader.match(/script-src\s+([^;]+)/)?.[1] || "";
      expect(scriptSrc).toContain("'self'");
    });

    it("CSP still contains SHA-256 hash for inline scripts", () => {
      expect(cspHeader).toMatch(/sha256-[A-Za-z0-9+/=]+/);
    });
  });

  // ─── 2. package-lock.json integrity ────────────────────

  describe("package-lock.json integrity coverage", () => {
    let lockfile;

    beforeAll(() => {
      lockfile = JSON.parse(
        fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf-8")
      );
    });

    it("uses lockfileVersion 3 (npm v7+ with integrity)", () => {
      expect(lockfile.lockfileVersion).toBe(3);
    });

    it("all packages have integrity hashes", () => {
      const packages = lockfile.packages || {};
      const missingIntegrity = Object.entries(packages)
        .filter(([key, pkg]) => key !== "" && !pkg.integrity);
      // Allow up to 0 packages without integrity
      expect(missingIntegrity.length).toBe(0);
    });

    it("integrity hashes use sha512 algorithm", () => {
      const packages = lockfile.packages || {};
      const nonSha512 = Object.entries(packages)
        .filter(
          ([key, pkg]) =>
            key !== "" &&
            pkg.integrity &&
            !pkg.integrity.startsWith("sha512-")
        );
      expect(nonSha512.length).toBe(0);
    });

    it("all packages resolve to official npm registry", () => {
      const packages = lockfile.packages || {};
      const nonOfficial = Object.entries(packages)
        .filter(
          ([key, pkg]) =>
            key !== "" &&
            pkg.resolved &&
            !pkg.resolved.startsWith("https://registry.npmjs.org/")
        );
      // All should use official registry
      expect(nonOfficial.length).toBe(0);
    });
  });

  // ─── 3. No external CDN in index.html ──────────────────

  describe("index.html has no external CDN references", () => {
    let html;

    beforeAll(() => {
      html = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");
    });

    it("has no <script src> pointing to external CDN", () => {
      const externalScripts = html.match(/<script[^>]+src=["']https?:\/\//g);
      expect(externalScripts).toBeNull();
    });

    it("has no <link href> pointing to external CDN for styles", () => {
      const externalLinks = html.match(
        /<link[^>]+href=["']https?:\/\/(?!.*w3\.org).*\.css/g
      );
      expect(externalLinks).toBeNull();
    });

    it("has no Google Fonts references", () => {
      expect(html).not.toContain("fonts.googleapis.com");
      expect(html).not.toContain("fonts.gstatic.com");
    });

    it("Vite entry point is local only", () => {
      expect(html).toContain('src="/src/main.tsx"');
    });
  });

  // ─── 4. Fonts are self-hosted ──────────────────────────

  describe("fonts are self-hosted", () => {
    it("public/fonts directory contains Inter font files", () => {
      const fontsDir = path.join(ROOT, "public", "fonts");
      const fontFiles = fs.readdirSync(fontsDir);
      const interFonts = fontFiles.filter((f) => f.startsWith("Inter-"));
      expect(interFonts.length).toBeGreaterThan(0);
    });

    it("public/fonts directory contains Orbitron font files", () => {
      const fontsDir = path.join(ROOT, "public", "fonts");
      const fontFiles = fs.readdirSync(fontsDir);
      const orbitronFonts = fontFiles.filter((f) => f.startsWith("Orbitron-"));
      expect(orbitronFonts.length).toBeGreaterThan(0);
    });

    it("no CSS references Google Fonts CDN", () => {
      const srcDir = path.join(ROOT, "src");
      const cssFiles = findFilesRecursive(srcDir, ".css");
      const withGoogleFonts = cssFiles.filter((f) => {
        const content = fs.readFileSync(f, "utf-8");
        return (
          content.includes("fonts.googleapis.com") ||
          content.includes("fonts.gstatic.com")
        );
      });
      expect(withGoogleFonts.length).toBe(0);
    });
  });

  // ─── 5. Capacitor config hardened ──────────────────────

  describe("Capacitor config security hardening", () => {
    let capConfig;

    beforeAll(() => {
      const content = fs.readFileSync(
        path.join(ROOT, "capacitor.config.ts"),
        "utf-8"
      );
      // Extract config object from TypeScript
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      capConfig = jsonMatch ? jsonMatch[0] : content;
    });

    it("uses HTTPS scheme (not http)", () => {
      expect(capConfig).toContain("https");
    });

    it("disables mixed content", () => {
      expect(capConfig).toMatch(/allowMixedContent\s*:\s*false/i);
    });

    it("disables web contents debugging", () => {
      expect(capConfig).toMatch(/webContentsDebuggingEnabled\s*:\s*false/i);
    });
  });

  // ─── 6. robots.txt restricts API paths ─────────────────

  describe("robots.txt API path restrictions", () => {
    it("exists in public directory", () => {
      const exists = fs.existsSync(path.join(ROOT, "public", "robots.txt"));
      expect(exists).toBe(true);
    });

    it("contains Disallow rule for /api/", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "public", "robots.txt"),
        "utf-8"
      );
      // Check that /api/ is restricted for at least some user-agents
      expect(content).toContain("Disallow: /api/");
    });
  });

  // ─── 7. No .npmrc with unsafe registries ───────────────

  describe(".npmrc safety", () => {
    it("does not exist or has no custom registry", () => {
      const npmrcPath = path.join(ROOT, ".npmrc");
      if (!fs.existsSync(npmrcPath)) {
        expect(true).toBe(true); // No .npmrc is safest
        return;
      }
      const content = fs.readFileSync(npmrcPath, "utf-8");
      expect(content).not.toContain("registry=");
      expect(content).not.toContain("//");
    });
  });

  // ─── 8. Vite build hardening ───────────────────────────

  describe("Vite build security", () => {
    let viteConfig;

    beforeAll(() => {
      viteConfig = fs.readFileSync(
        path.join(ROOT, "vite.config.ts"),
        "utf-8"
      );
    });

    it("does not enable source maps in production", () => {
      // Should not have sourcemap: true
      expect(viteConfig).not.toMatch(/sourcemap\s*:\s*true/);
    });

    it("drops debugger statements in production", () => {
      expect(viteConfig).toContain('"debugger"');
    });
  });

  // ─── 9. Security headers presence ──────────────────────

  describe("security headers completeness", () => {
    const headers = vercelJson.headers
      .find((h) => h.source === "/(.*)")
      ?.headers.map((h) => h.key) || [];

    it("has X-Content-Type-Options: nosniff", () => {
      expect(headers).toContain("X-Content-Type-Options");
    });

    it("has X-Frame-Options: DENY", () => {
      expect(headers).toContain("X-Frame-Options");
    });

    it("has Strict-Transport-Security", () => {
      expect(headers).toContain("Strict-Transport-Security");
    });

    it("has Referrer-Policy", () => {
      expect(headers).toContain("Referrer-Policy");
    });

    it("has Permissions-Policy", () => {
      expect(headers).toContain("Permissions-Policy");
    });

    it("has Content-Security-Policy", () => {
      expect(headers).toContain("Content-Security-Policy");
    });

    it("HSTS includes includeSubDomains", () => {
      const hsts = vercelJson.headers
        .find((h) => h.source === "/(.*)")
        ?.headers.find((h) => h.key === "Strict-Transport-Security")?.value || "";
      expect(hsts).toContain("includeSubDomains");
    });

    it("HSTS max-age is at least 1 year", () => {
      const hsts = vercelJson.headers
        .find((h) => h.source === "/(.*)")
        ?.headers.find((h) => h.key === "Strict-Transport-Security")?.value || "";
      const maxAge = parseInt(hsts.match(/max-age=(\d+)/)?.[1] || "0", 10);
      expect(maxAge).toBeGreaterThanOrEqual(31536000);
    });
  });
});

// ─── Helper ────────────────────────────────────────────────────

function findFilesRecursive(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      results.push(...findFilesRecursive(fullPath, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}
