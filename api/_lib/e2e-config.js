// E2E Test Configuration & Infrastructure
// Phase AA — Playwright E2E test framework setup
//
// This module provides:
//   - Test configuration constants
//   - API endpoint URLs
//   - Authentication helpers for E2E tests
//   - Shared test utilities
//
// NOTE: Actual Playwright tests require @playwright/test dependency
// and a running Vercel dev server. This module sets up the infrastructure.

/**
 * Test environment configuration.
 */
export const E2E_CONFIG = {
  // Base URL for API tests (Vercel dev server)
  apiUrl: process.env.E2E_API_URL || 'http://localhost:3000/api',

  // Test device credentials (for HMAC auth testing)
  testDeviceId: 'dev-e2etest01',
  testDeviceSecret: '', // Generated during test setup

  // Timeouts
  defaultTimeout: 10000, // 10s for API calls
  navigationTimeout: 30000, // 30s for page navigation

  // Test user credentials
  testEmail: 'e2e-test@virtumatch.example.com',
  testAdminPassword: '', // Set via env var in CI

  // Leagues for prediction testing
  testLeagues: ['8035', '8056', '8042'], // English, Champions League, French
};

/**
 * API endpoint paths for E2E tests.
 */
export const API_ENDPOINTS = {
  AUTH_REQUEST: '/auth?action=request',
  AUTH_VERIFY: '/auth?action=verify',
  AUTH_LATEST_APK: '/auth?action=latest-apk',
  DEVICE_REGISTER: '/device-register',
  PREDICTIONS: '/predictions',
  PREMIUM_ACTIVATE: '/premium-activate',
  VERIFY_PREDICTIONS: '/verify-predictions',
  HEALTH: '/health',
  PUSH_ODDS: '/push-odds',
};

/**
 * E2E test flow definitions (describes what should be tested).
 */
export const E2E_FLOWS = {
  auth: {
    description: 'Magic link auth flow',
    steps: [
      'POST /auth?action=request with valid email → 200',
      'Click magic link → 200 with session token',
      'Use Bearer token for subsequent requests',
      'POST /auth?action=request with invalid email → 400',
      'Rate limit after 3 requests → 429',
    ],
  },
  predictions: {
    description: 'Prediction creation and verification',
    steps: [
      'POST /predictions with valid match data → 200 with prediction',
      'GET /predictions with auth → 200 with prediction list',
      'POST /verify-predictions with cron key → 200',
      'Invalid auth → 401',
      'Rate limit → 429',
    ],
  },
  premium: {
    description: 'Premium activation flow',
    steps: [
      'GET /premium-activate with auth → premium status',
      'POST /premium-activate with valid code → 200',
      'POST /premium-activate with invalid code → 400',
      'POST /premium-activate with used code → 400',
      'Rate limit → 429',
    ],
  },
  health: {
    description: 'Health check endpoint',
    steps: [
      'GET /health → 200 with status, db, coefficients, memory',
      'Returns 503 when degraded',
    ],
  },
  cors: {
    description: 'CORS policy enforcement',
    steps: [
      'Allowed origin → correct CORS headers',
      'Disallowed origin → 403 or no CORS headers',
      'Preflight OPTIONS → 204',
    ],
  },
};

/**
 * Verify E2E test infrastructure is ready.
 * Returns status of each prerequisite.
 */
export function checkE2EPrerequisites() {
  return {
    apiUrl: !!E2E_CONFIG.apiUrl,
    playwright: false, // Would need to check @playwright/test import
    testDeviceId: E2E_CONFIG.testDeviceId.startsWith('dev-'),
    testLeagues: E2E_CONFIG.testLeagues.length > 0,
    flows: Object.keys(E2E_FLOWS).length > 0,
  };
}
