// Phase AA — E2E Test Framework Setup Tests
// Verifies E2E test infrastructure and configuration

import { describe, it, expect } from 'vitest';
import {
  E2E_CONFIG,
  API_ENDPOINTS,
  E2E_FLOWS,
  checkE2EPrerequisites,
} from '../e2e-config.js';

describe('Phase AA: E2E Test Framework', () => {

  describe('E2E configuration', () => {
    it('has API URL configured', () => {
      expect(E2E_CONFIG.apiUrl).toBeTruthy();
      expect(E2E_CONFIG.apiUrl).toContain('/api');
    });

    it('has test device ID in correct format', () => {
      expect(E2E_CONFIG.testDeviceId).toMatch(/^dev-[a-z0-9]{8,}$/);
    });

    it('has test email configured', () => {
      expect(E2E_CONFIG.testEmail).toContain('@');
    });

    it('has test leagues for prediction testing', () => {
      expect(E2E_CONFIG.testLeagues).toHaveLength(3);
      E2E_CONFIG.testLeagues.forEach(id => {
        expect(id).toMatch(/^\d{4}$/);
      });
    });

    it('has sensible timeouts', () => {
      expect(E2E_CONFIG.defaultTimeout).toBe(10000);
      expect(E2E_CONFIG.navigationTimeout).toBe(30000);
    });
  });

  describe('API endpoints', () => {
    it('defines all required endpoints', () => {
      expect(API_ENDPOINTS.AUTH_REQUEST).toContain('/auth');
      expect(API_ENDPOINTS.DEVICE_REGISTER).toContain('/device-register');
      expect(API_ENDPOINTS.PREDICTIONS).toContain('/predictions');
      expect(API_ENDPOINTS.PREMIUM_ACTIVATE).toContain('/premium-activate');
      expect(API_ENDPOINTS.HEALTH).toContain('/health');
    });

    it('auth endpoint includes action query params', () => {
      expect(API_ENDPOINTS.AUTH_REQUEST).toContain('action=request');
      expect(API_ENDPOINTS.AUTH_VERIFY).toContain('action=verify');
    });
  });

  describe('E2E test flows', () => {
    it('defines auth flow with 5 steps', () => {
      expect(E2E_FLOWS.auth.steps).toHaveLength(5);
      expect(E2E_FLOWS.auth.description).toBeTruthy();
    });

    it('defines predictions flow', () => {
      expect(E2E_FLOWS.predictions.steps.length).toBeGreaterThan(0);
    });

    it('defines premium activation flow', () => {
      expect(E2E_FLOWS.premium.steps.length).toBeGreaterThan(0);
    });

    it('defines health check flow', () => {
      expect(E2E_FLOWS.health.steps.length).toBeGreaterThan(0);
    });

    it('defines CORS enforcement flow', () => {
      expect(E2E_FLOWS.cors.steps.length).toBeGreaterThan(0);
    });

    it('each flow step describes expected HTTP status', () => {
      for (const flow of Object.values(E2E_FLOWS)) {
        for (const step of flow.steps) {
          // Each step should mention a status code (200, 400, 401, 429, 204, 503, etc.)
          // OR describe a behavior (e.g., "Rate limit", "correct CORS headers")
          const hasStatusCode = /\d{3}/.test(step);
          const hasBehavior = /CORS|header|token|link|limit|status/i.test(step);
          expect(hasStatusCode || hasBehavior).toBe(true);
        }
      }
    });
  });

  describe('prerequisites check', () => {
    it('returns status for all prerequisites', () => {
      const prereqs = checkE2EPrerequisites();
      expect(prereqs).toHaveProperty('apiUrl');
      expect(prereqs).toHaveProperty('playwright');
      expect(prereqs).toHaveProperty('testDeviceId');
      expect(prereqs).toHaveProperty('testLeagues');
      expect(prereqs).toHaveProperty('flows');
    });

    it('test device ID prerequisite passes', () => {
      const prereqs = checkE2EPrerequisites();
      expect(prereqs.testDeviceId).toBe(true);
    });
  });

});
