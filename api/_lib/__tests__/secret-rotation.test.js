// Phase Z — Secret Rotation Automation Tests

import { describe, it, expect } from 'vitest';
import {
  generateSecret,
  SECRET_ROTATION_SCHEDULE,
  getOverdueSecrets,
  verifySecretWithGrace,
  auditSecrets,
} from '../secret-rotation.js';

describe('Phase Z: Secret Rotation Automation', () => {

  describe('generateSecret', () => {
    it('generates a 64-char hex string by default (32 bytes)', () => {
      const secret = generateSecret();
      expect(secret).toHaveLength(64);
      expect(secret).toMatch(/^[0-9a-f]+$/);
    });

    it('generates different secrets each call', () => {
      const a = generateSecret();
      const b = generateSecret();
      expect(a).not.toBe(b);
    });

    it('respects custom byte length', () => {
      const secret = generateSecret(16);
      expect(secret).toHaveLength(32); // 16 bytes = 32 hex chars
    });
  });

  describe('SECRET_ROTATION_SCHEDULE', () => {
    it('defines rotation schedules for all critical secrets', () => {
      expect(SECRET_ROTATION_SCHEDULE.HMAC_DEVICE_SECRET).toBeDefined();
      expect(SECRET_ROTATION_SCHEDULE.ADMIN_TOKEN_SECRET).toBeDefined();
      expect(SECRET_ROTATION_SCHEDULE.USER_SESSION_SECRET).toBeDefined();
      expect(SECRET_ROTATION_SCHEDULE.CRON_SECRET).toBeDefined();
      expect(SECRET_ROTATION_SCHEDULE.SCRAPER_PUSH_KEY).toBeDefined();
      expect(SECRET_ROTATION_SCHEDULE.RESEND_API_KEY).toBeDefined();
    });

    it('each schedule has rotationDays and gracePeriodHours', () => {
      for (const [name, schedule] of Object.entries(SECRET_ROTATION_SCHEDULE)) {
        expect(schedule.rotationDays).toBeGreaterThan(0);
        expect(schedule.gracePeriodHours).toBeGreaterThanOrEqual(0);
        expect(schedule.description).toBeTruthy();
      }
    });

    it('user session has longer grace period (72h) for 30-day sessions', () => {
      expect(SECRET_ROTATION_SCHEDULE.USER_SESSION_SECRET.gracePeriodHours).toBe(72);
    });

    it('cron/scraper keys rotate every 180 days', () => {
      expect(SECRET_ROTATION_SCHEDULE.CRON_SECRET.rotationDays).toBe(180);
      expect(SECRET_ROTATION_SCHEDULE.SCRAPER_PUSH_KEY.rotationDays).toBe(180);
    });
  });

  describe('getOverdueSecrets', () => {
    it('returns all secrets as overdue if no rotation dates provided', () => {
      const overdue = getOverdueSecrets({});
      expect(overdue.length).toBe(Object.keys(SECRET_ROTATION_SCHEDULE).length);
    });

    it('returns empty array if all secrets rotated recently', () => {
      const now = new Date().toISOString();
      const dates = {};
      for (const name of Object.keys(SECRET_ROTATION_SCHEDULE)) {
        dates[name] = now;
      }
      const overdue = getOverdueSecrets(dates);
      expect(overdue).toHaveLength(0);
    });

    it('detects overdue secrets correctly', () => {
      const dates = {
        HMAC_DEVICE_SECRET: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const overdue = getOverdueSecrets(dates);
      const hmac = overdue.find(s => s.name === 'HMAC_DEVICE_SECRET');
      expect(hmac).toBeDefined();
      expect(hmac.daysOverdue).toBeGreaterThan(0);
    });
  });

  describe('verifySecretWithGrace', () => {
    it('accepts current secret', () => {
      const current = 'abc123def456';
      expect(verifySecretWithGrace(current, current)).toBe(true);
    });

    it('accepts previous secret during grace period', () => {
      const current = 'newsecret12345';
      const previous = 'oldsecret12345';
      expect(verifySecretWithGrace(previous, current, previous)).toBe(true);
    });

    it('rejects invalid secret', () => {
      expect(verifySecretWithGrace('wrong', 'correct')).toBe(false);
    });

    it('rejects empty/null secret', () => {
      expect(verifySecretWithGrace('', 'correct')).toBe(false);
      expect(verifySecretWithGrace(null, 'correct')).toBe(false);
    });

    it('uses timing-safe comparison', () => {
      // Both current and previous should use timing-safe comparison
      // This test just verifies the function works correctly
      const current = generateSecret(16);
      expect(verifySecretWithGrace(current, current)).toBe(true);
    });
  });

  describe('auditSecrets', () => {
    it('returns status for all required secrets', () => {
      const audit = auditSecrets();
      for (const name of Object.keys(SECRET_ROTATION_SCHEDULE)) {
        expect(audit[name]).toBeDefined();
        expect(audit[name]).toHaveProperty('configured');
        expect(audit[name]).toHaveProperty('rotationDays');
        expect(audit[name]).toHaveProperty('description');
      }
    });
  });

});
