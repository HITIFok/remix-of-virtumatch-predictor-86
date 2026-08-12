// Shared Neon PostgreSQL connection utility
// Centralizes connection logic used across all API routes

import postgres from 'postgres';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

/**
 * Create a new postgres connection instance.
 * Each handler gets its own connection (serverless-safe).
 */
export function createSql() {
  if (!NEON_DATABASE_URL) {
    throw new Error('NEON_DATABASE_URL not configured');
  }
  return postgres(NEON_DATABASE_URL);
}

export { NEON_DATABASE_URL };
