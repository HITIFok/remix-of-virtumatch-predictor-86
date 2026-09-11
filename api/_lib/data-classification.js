// Data Classification & PII Inventory
// Phase AC — Classifies all data in the VirtuMatch system by sensitivity level
// and tracks retention/deletion policies for GDPR compliance.

/**
 * Data Sensitivity Levels
 * PUBLIC    — Safe to expose publicly (e.g., match results)
 * INTERNAL  — Internal use only, not PII (e.g., prediction coefficients)
 * SENSITIVE — Pseudonymous/identifiable (e.g., device_id, user_id)
 * PII       — Directly identifies a person (e.g., email)
 * SECRET    — Cryptographic secrets (e.g., device_secret, token_hash)
 */
export const SENSITIVITY = Object.freeze({
  PUBLIC: 'PUBLIC',
  INTERNAL: 'INTERNAL',
  SENSITIVE: 'SENSITIVE',
  PII: 'PII',
  SECRET: 'SECRET',
});

/**
 * Complete PII Inventory — every column in every table
 * that contains or could contain personally identifiable information.
 */
export const PII_INVENTORY = Object.freeze([
  // ── users table ─────────────────────────────────────
  {
    table: 'users',
    column: 'id',
    type: 'TEXT (UUID)',
    sensitivity: SENSITIVITY.SENSITIVE,
    description: 'User UUID — linkable to email in same row',
    retentionDays: null, // Indefinite until account deletion
    deletionMethod: 'account-delete',
  },
  {
    table: 'users',
    column: 'email',
    type: 'TEXT',
    sensitivity: SENSITIVITY.PII,
    description: 'User email address — direct PII',
    retentionDays: null,
    deletionMethod: 'account-delete',
    redactionInLogs: true,
    redactionInApi: true,
  },

  // ── device_secrets table ────────────────────────────
  {
    table: 'device_secrets',
    column: 'device_id',
    type: 'TEXT (PK)',
    sensitivity: SENSITIVITY.SENSITIVE,
    description: 'Pseudonymous device identifier',
    retentionDays: null,
    deletionMethod: 'account-delete',
  },
  {
    table: 'device_secrets',
    column: 'device_secret',
    type: 'TEXT',
    sensitivity: SENSITIVITY.SECRET,
    description: 'HMAC-SHA256 signing secret — returned once at registration',
    retentionDays: null,
    deletionMethod: 'account-delete',
    neverLog: true,
    neverReturnAfterCreation: true,
  },

  // ── magic_links table ───────────────────────────────
  {
    table: 'magic_links',
    column: 'email',
    type: 'TEXT',
    sensitivity: SENSITIVITY.PII,
    description: 'Email used for magic link auth — direct PII',
    retentionDays: 30, // Should be cleaned after expiry
    deletionMethod: 'expired-cleanup-cron',
    redactionInLogs: true,
  },
  {
    table: 'magic_links',
    column: 'token_hash',
    type: 'TEXT (SHA-256)',
    sensitivity: SENSITIVITY.SECRET,
    description: 'SHA-256 hash of magic link token — not reversible',
    retentionDays: 30,
    deletionMethod: 'expired-cleanup-cron',
  },
  {
    table: 'magic_links',
    column: 'payload',
    type: 'JSONB',
    sensitivity: SENSITIVITY.SENSITIVE,
    description: 'Contains device_id and/or access code',
    retentionDays: 30,
    deletionMethod: 'expired-cleanup-cron',
  },

  // ── predictions table ───────────────────────────────
  {
    table: 'predictions',
    column: 'device_id',
    type: 'TEXT',
    sensitivity: SENSITIVITY.SENSITIVE,
    description: 'Pseudonymous device identifier per prediction',
    retentionDays: 365,
    deletionMethod: 'user-delete-or-ttl',
  },
  {
    table: 'predictions',
    column: 'user_id',
    type: 'TEXT (FK)',
    sensitivity: SENSITIVITY.SENSITIVE,
    description: 'Linkable user UUID per prediction',
    retentionDays: 365,
    deletionMethod: 'user-delete-or-ttl',
  },

  // ── premium_activations table ───────────────────────
  {
    table: 'premium_activations',
    column: 'device_id',
    type: 'TEXT',
    sensitivity: SENSITIVITY.SENSITIVE,
    description: 'Legacy device_id for premium binding',
    retentionDays: null,
    deletionMethod: 'account-delete',
  },
  {
    table: 'premium_activations',
    column: 'user_id',
    type: 'TEXT (FK)',
    sensitivity: SENSITIVITY.SENSITIVE,
    description: 'User UUID for premium binding',
    retentionDays: null,
    deletionMethod: 'account-delete',
  },

  // ── access_codes table ──────────────────────────────
  {
    table: 'access_codes',
    column: 'used_by_device',
    type: 'TEXT',
    sensitivity: SENSITIVITY.SENSITIVE,
    description: 'Device/user that redeemed the code',
    retentionDays: null,
    deletionMethod: 'admin-cleanup',
  },
]);

/**
 * Tables that contain PII or SENSITIVE data
 * and their recommended retention/deletion policies.
 */
export const DATA_RETENTION_POLICIES = Object.freeze([
  {
    table: 'users',
    piiColumns: ['email', 'id'],
    defaultRetentionDays: Infinity,
    deletionEndpoint: '/api/auth?action=delete-account',
    deletionStatus: 'NOT_IMPLEMENTED', // ← needs implementation
    gdprCompliant: false,
  },
  {
    table: 'device_secrets',
    piiColumns: ['device_id', 'device_secret'],
    defaultRetentionDays: Infinity,
    deletionEndpoint: '/api/auth?action=delete-account',
    deletionStatus: 'NOT_IMPLEMENTED',
    gdprCompliant: false,
  },
  {
    table: 'magic_links',
    piiColumns: ['email', 'token_hash', 'payload'],
    defaultRetentionDays: 30,
    cleanupMethod: 'expired-cleanup-cron',
    deletionStatus: 'NOT_IMPLEMENTED', // ← no cron yet
    gdprCompliant: false,
  },
  {
    table: 'predictions',
    piiColumns: ['device_id', 'user_id'],
    defaultRetentionDays: 365,
    cleanupMethod: 'ttl-cron',
    deletionStatus: 'PARTIAL', // users can delete own, but no auto-TTL
    gdprCompliant: false,
  },
  {
    table: 'premium_activations',
    piiColumns: ['device_id', 'user_id'],
    defaultRetentionDays: Infinity,
    deletionEndpoint: '/api/auth?action=delete-account',
    deletionStatus: 'NOT_IMPLEMENTED',
    gdprCompliant: false,
  },
]);

/**
 * PII fields that must be redacted in API responses
 * (not just logs — these should never be sent to client in full).
 */
export const PII_RESPONSE_REDACTIONS = Object.freeze({
  'auth.verify': {
    redactFields: ['email'],
    method: 'partial', // u***@domain.com
    note: 'Email returned in full in auth.js:310 — should be redacted or omitted',
  },
});

/**
 * Check if a table contains PII-level data
 */
export function tableContainsPII(tableName) {
  return PII_INVENTORY.some(
    (entry) => entry.table === tableName && entry.sensitivity === SENSITIVITY.PII
  );
}

/**
 * Get all PII entries for a specific table
 */
export function getPIIForTable(tableName) {
  return PII_INVENTORY.filter((entry) => entry.table === tableName);
}

/**
 * Get all tables that are not GDPR compliant
 */
export function getNonCompliantTables() {
  return DATA_RETENTION_POLICIES.filter((policy) => !policy.gdprCompliant);
}

/**
 * Get all entries that should never be logged
 */
export function getNeverLogEntries() {
  return PII_INVENTORY.filter((entry) => entry.neverLog);
}

/**
 * Classify a data field by sensitivity
 */
export function classifyData(tableName, columnName) {
  const entry = PII_INVENTORY.find(
    (e) => e.table === tableName && e.column === columnName
  );
  return entry ? entry.sensitivity : SENSITIVITY.PUBLIC;
}
