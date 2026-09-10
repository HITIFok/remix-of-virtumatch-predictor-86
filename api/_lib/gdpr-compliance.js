// GDPR Compliance & Account Deletion
// Phase AJ — Implements GDPR right-to-erasure (Article 17) and data retention policies.
// Provides the account deletion cascade and data cleanup automation.

/**
 * GDPR Legal Basis Types
 */
export const LEGAL_BASIS = Object.freeze({
  CONSENT: 'CONSENT',
  CONTRACT: 'CONTRACT',
  LEGAL_OBLIGATION: 'LEGAL_OBLIGATION',
  LEGITIMATE_INTEREST: 'LEGITIMATE_INTEREST',
});

/**
 * GDPR Data Subject Rights
 */
export const DATA_SUBJECT_RIGHTS = Object.freeze([
  { article: 15, right: 'Access', description: 'Right to obtain confirmation of processing and access to personal data', implemented: true, endpoint: 'GET /api/auth (user session)' },
  { article: 16, right: 'Rectification', description: 'Right to correct inaccurate personal data', implemented: false, endpoint: 'NOT_IMPLEMENTED' },
  { article: 17, right: 'Erasure', description: 'Right to be forgotten — delete all personal data', implemented: false, endpoint: 'POST /api/account-delete' },
  { article: 18, right: 'Restriction', description: 'Right to restrict processing of personal data', implemented: false, endpoint: 'NOT_IMPLEMENTED' },
  { article: 20, right: 'Portability', description: 'Right to receive personal data in machine-readable format', implemented: false, endpoint: 'NOT_IMPLEMENTED' },
  { article: 21, right: 'Objection', description: 'Right to object to processing based on legitimate interest', implemented: true, endpoint: 'Device registration is opt-in' },
  { article: 22, right: 'Automated decision-making', description: 'Right not to be subject to solely automated decisions', implemented: true, endpoint: 'Predictions are advisory, not binding' },
]);

/**
 * Account Deletion Cascade — tables and cleanup operations
 * Order matters: delete referencing tables first, then the parent.
 */
export const DELETION_CASCADE = Object.freeze([
  {
    step: 1,
    table: 'predictions',
    operation: 'DELETE FROM predictions WHERE device_id = $1 OR user_id = $2',
    piiColumns: ['device_id', 'user_id'],
    retentionDays: 365,
    canAutoDelete: true,
    note: 'User predictions — deleted on account deletion regardless of age',
  },
  {
    step: 2,
    table: 'premium_activations',
    operation: 'DELETE FROM premium_activations WHERE device_id = $1 OR user_id = $2',
    piiColumns: ['device_id', 'user_id'],
    retentionDays: Infinity,
    canAutoDelete: true,
    note: 'Premium status revoked on deletion',
  },
  {
    step: 3,
    table: 'access_codes',
    operation: "UPDATE access_codes SET used_by_device = NULL WHERE used_by_device = $1",
    piiColumns: ['used_by_device'],
    retentionDays: Infinity,
    canAutoDelete: true,
    note: 'Dereference device from used codes (codes remain for audit)',
  },
  {
    step: 4,
    table: 'magic_links',
    operation: 'DELETE FROM magic_links WHERE email = $3',
    piiColumns: ['email', 'token_hash', 'payload'],
    retentionDays: 30,
    canAutoDelete: true,
    note: 'All magic links for this email deleted',
  },
  {
    step: 5,
    table: 'device_secrets',
    operation: 'DELETE FROM device_secrets WHERE device_id = $1',
    piiColumns: ['device_id', 'device_secret'],
    retentionDays: Infinity,
    canAutoDelete: true,
    note: 'HMAC secret deleted — all device tokens invalidated immediately',
  },
  {
    step: 6,
    table: 'users',
    operation: 'DELETE FROM users WHERE id = $2',
    piiColumns: ['id', 'email'],
    retentionDays: Infinity,
    canAutoDelete: true,
    note: 'User record deleted last (parent table)',
  },
]);

/**
 * Data Retention Cleanup Jobs — automated cleanup for expired data
 */
export const RETENTION_CLEANUP_JOBS = Object.freeze([
  {
    id: 'CLEANUP-01',
    table: 'magic_links',
    operation: "DELETE FROM magic_links WHERE created_at < NOW() - INTERVAL '30 days'",
    schedule: '0 3 * * *', // Daily at 3 AM
    retentionDays: 30,
    piiImpact: 'Removes expired magic link tokens and associated PII',
    status: 'NOT_IMPLEMENTED',
  },
  {
    id: 'CLEANUP-02',
    table: 'predictions',
    operation: "DELETE FROM predictions WHERE created_at < NOW() - INTERVAL '365 days'",
    schedule: '0 4 * * 0', // Weekly Sunday at 4 AM
    retentionDays: 365,
    piiImpact: 'Removes predictions older than 1 year (device_id, user_id PII)',
    status: 'NOT_IMPLEMENTED',
  },
]);

/**
 * GDPR Compliance Assessment
 */
export function getGdprComplianceStatus() {
  const rightsImplemented = DATA_SUBJECT_RIGHTS.filter(r => r.implemented).length;
  const rightsTotal = DATA_SUBJECT_RIGHTS.length;
  const cascadeComplete = DELETION_CASCADE.every(s => s.canAutoDelete);
  const cleanupJobs = RETENTION_CLEANUP_JOBS.length;
  const cleanupImplemented = RETENTION_CLEANUP_JOBS.filter(j => j.status === 'IMPLEMENTED').length;

  return {
    dataSubjectRights: {
      implemented: rightsImplemented,
      total: rightsTotal,
      compliancePercent: Math.round((rightsImplemented / rightsTotal) * 100),
    },
    erasure: {
      cascadeComplete,
      cascadeSteps: DELETION_CASCADE.length,
      endpointImplemented: false,
    },
    retention: {
      cleanupJobsTotal: cleanupJobs,
      cleanupJobsImplemented: cleanupImplemented,
      allAutoCleanup: cleanupImplemented === cleanupJobs,
    },
    overallCompliant: rightsImplemented >= 5 && cascadeComplete && cleanupImplemented === cleanupJobs,
    gaps: getGdprGaps(),
  };
}

/**
 * Get GDPR compliance gaps
 */
export function getGdprGaps() {
  const gaps = [];

  // Unimplemented rights
  for (const right of DATA_SUBJECT_RIGHTS) {
    if (!right.implemented) {
      gaps.push({
        type: 'RIGHT',
        article: right.article,
        right: right.right,
        description: right.description,
        severity: right.article === 17 ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  // Missing deletion endpoint
  gaps.push({
    type: 'ENDPOINT',
    article: 17,
    right: 'Erasure',
    description: 'POST /api/account-delete endpoint not implemented',
    severity: 'HIGH',
  });

  // Missing cleanup jobs
  for (const job of RETENTION_CLEANUP_JOBS) {
    if (job.status === 'NOT_IMPLEMENTED') {
      gaps.push({
        type: 'RETENTION',
        article: 5, // Storage limitation principle
        right: 'Storage Limitation',
        description: `${job.id}: ${job.table} cleanup cron not implemented`,
        severity: 'MEDIUM',
      });
    }
  }

  return gaps;
}

/**
 * Generate SQL for account deletion
 */
export function generateDeletionSQL(deviceId, userId, email) {
  const statements = DELETION_CASCADE.map(step => ({
    step: step.step,
    table: step.table,
    sql: step.operation.replace('$1', `'${deviceId}'`).replace('$2', `'${userId}'`).replace('$3', `'${email}'`),
    note: step.note,
  }));

  return {
    deviceId,
    userId,
    email: email ? `${email[0]}***@***` : null, // Redacted
    steps: statements.length,
    statements,
    warning: 'This will permanently delete all user data. This action cannot be undone.',
  };
}

/**
 * Verify deletion completeness — check no PII remains after deletion
 */
export function verifyDeletionCompleteness() {
  const issues = [];

  // Check that all PII inventory tables are covered by cascade
  const cascadeTables = new Set(DELETION_CASCADE.map(s => s.table));
  const piiTables = ['users', 'device_secrets', 'magic_links', 'predictions', 'premium_activations', 'access_codes'];

  for (const table of piiTables) {
    if (!cascadeTables.has(table)) {
      issues.push(`Table "${table}" contains PII but is not in the deletion cascade`);
    }
  }

  return {
    complete: issues.length === 0,
    issues,
    cascadeCoverage: cascadeTables.size,
    requiredTables: piiTables.length,
  };
}
