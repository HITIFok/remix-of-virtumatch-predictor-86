// ============================================
// SNAPSHOT MONITORING SYSTEM v1.0
// Phase 5 — Production Monitoring, Health Check, Metrics
// ============================================
//
// Sections 13-14-15 of Phase 5:
// - Production metrics/logging
// - Health check
// - Scientific dashboard data

import type { ProvenanceStatus } from './feature-snapshot';

// ═══════════════════════════════════════════════════════════════════
// METRICS (Section 13)
// ═══════════════════════════════════════════════════════════════════

export type MetricEvent =
  | 'snapshot_created'
  | 'snapshot_failed'
  | 'snapshot_incomplete'
  | 'snapshot_unknown'
  | 'snapshot_unsafe'
  | 'snapshot_hash_mismatch'
  | 'snapshot_immutability_violation'
  | 'prediction_created'
  | 'prediction_verified'
  | 'leakage_detected';

export interface MetricRecord {
  event: MetricEvent;
  timestamp: string;  // ISO 8601 UTC
  prediction_id?: string | number;
  details?: Record<string, string | number | boolean>;
}

/**
 * In-memory metrics store for the current session.
 * In production, these would be sent to a monitoring service.
 */
class MetricsStore {
  private records: MetricRecord[] = [];
  private maxRecords: number = 10000;

  record(event: MetricEvent, predictionId?: string | number, details?: Record<string, string | number | boolean>): void {
    const record: MetricRecord = {
      event,
      timestamp: new Date().toISOString(),  // UTC
      prediction_id: predictionId,
      details,
    };

    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    // Log to console (never log secrets/tokens/credentials)
    if (event === 'snapshot_failed' || event === 'snapshot_hash_mismatch' || event === 'snapshot_immutability_violation' || event === 'leakage_detected') {
      console.warn(`[snapshot-monitoring] ${event}`, { prediction_id: predictionId, ...details });
    } else {
      console.info(`[snapshot-monitoring] ${event}`, { prediction_id: predictionId });
    }
  }

  getEvents(since?: string): MetricRecord[] {
    if (!since) return [...this.records];
    const sinceTs = new Date(since).getTime();
    return this.records.filter(r => new Date(r.timestamp).getTime() >= sinceTs);
  }

  countByEvent(since?: string): Record<string, number> {
    const events = this.getEvents(since);
    const counts: Record<string, number> = {};
    for (const e of events) {
      counts[e.event] = (counts[e.event] || 0) + 1;
    }
    return counts;
  }

  clear(): void {
    this.records = [];
  }
}

// Singleton metrics store
export const metrics = new MetricsStore();

// ═══════════════════════════════════════════════════════════════════
// HEALTH CHECK (Section 14)
// ═══════════════════════════════════════════════════════════════════

export interface HealthCheckResult {
  timestamp: string;
  /** Total predictions in last 24h */
  predictions_last_24h: number;
  /** Total snapshots in last 24h */
  snapshots_last_24h: number;
  /** Snapshot coverage percentage */
  snapshot_coverage_percent: number;
  /** Complete snapshots (all features present) */
  complete_snapshots: number;
  /** Incomplete snapshots (some features missing) */
  incomplete_snapshots: number;
  /** Predictions with UNKNOWN provenance */
  unknown_count: number;
  /** Predictions with UNSAFE provenance */
  unsafe_count: number;
  /** Hash mismatches detected */
  hash_mismatches: number;
  /** Immutability violations detected */
  immutability_violations: number;
  /** Leakage detections */
  leakage_detections: number;
  /** Overall health status */
  health: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
}

/**
 * Compute health check from metrics and database counts.
 * In production, this would query the Neon database.
 */
export function computeHealthCheck(dbStats: {
  predictions_last_24h: number;
  snapshots_last_24h: number;
  complete_snapshots: number;
  incomplete_snapshots: number;
  unknown_count: number;
  unsafe_count: number;
}): HealthCheckResult {
  const eventCounts = metrics.countByEvent(get24hAgo());
  const hashMismatches = eventCounts['snapshot_hash_mismatch'] || 0;
  const immutViolations = eventCounts['snapshot_immutability_violation'] || 0;
  const leakDetections = eventCounts['leakage_detected'] || 0;

  const coverage = dbStats.predictions_last_24h > 0
    ? Math.round((dbStats.snapshots_last_24h / dbStats.predictions_last_24h) * 10000) / 100
    : 0;

  // Health status
  let health: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY';
  if (hashMismatches > 0 || immutViolations > 0 || leakDetections > 0) {
    health = 'UNHEALTHY';
  } else if (dbStats.unsafe_count > 0 || coverage < 90 || dbStats.unknown_count > dbStats.predictions_last_24h * 0.2) {
    health = 'DEGRADED';
  }

  return {
    timestamp: new Date().toISOString(),
    predictions_last_24h: dbStats.predictions_last_24h,
    snapshots_last_24h: dbStats.snapshots_last_24h,
    snapshot_coverage_percent: coverage,
    complete_snapshots: dbStats.complete_snapshots,
    incomplete_snapshots: dbStats.incomplete_snapshots,
    unknown_count: dbStats.unknown_count,
    unsafe_count: dbStats.unsafe_count,
    hash_mismatches: hashMismatches,
    immutability_violations: immutViolations,
    leakage_detections: leakDetections,
    health,
  };
}

function get24hAgo(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

// ═══════════════════════════════════════════════════════════════════
// SCIENTIFIC DASHBOARD DATA (Section 15)
// ═══════════════════════════════════════════════════════════════════

export interface DashboardData {
  timestamp: string;
  total_predictions: number;
  verified_results: number;
  snapshot_coverage_percent: number;
  feature_coverage_percent: number;
  temporal_safety_percent: number;
  unknown_count: number;
  unknown_percent: number;
  unsafe_count: number;
  unsafe_percent: number;
  model_versions: string[];
  feature_versions: string[];
  config_versions: string[];
  provenance_breakdown: Record<ProvenanceStatus, number>;
  /** For audit only, not for prediction */
  purpose: 'AUDIT_ONLY';
}

/**
 * Generate scientific dashboard data.
 * This data is for AUDIT purposes only, not for prediction.
 */
export function generateDashboardData(dbStats: {
  total_predictions: number;
  verified_results: number;
  snapshot_coverage_percent: number;
  feature_coverage_percent: number;
  temporal_safety_percent: number;
  provenance_breakdown: Record<ProvenanceStatus, number>;
  model_versions: string[];
  feature_versions: string[];
  config_versions: string[];
}): DashboardData {
  const total = dbStats.total_predictions || 1; // avoid division by zero
  return {
    timestamp: new Date().toISOString(),
    total_predictions: dbStats.total_predictions,
    verified_results: dbStats.verified_results,
    snapshot_coverage_percent: dbStats.snapshot_coverage_percent,
    feature_coverage_percent: dbStats.feature_coverage_percent,
    temporal_safety_percent: dbStats.temporal_safety_percent,
    unknown_count: dbStats.provenance_breakdown['UNKNOWN'] || 0,
    unknown_percent: Math.round(((dbStats.provenance_breakdown['UNKNOWN'] || 0) / total) * 10000) / 100,
    unsafe_count: dbStats.provenance_breakdown['UNSAFE'] || 0,
    unsafe_percent: Math.round(((dbStats.provenance_breakdown['UNSAFE'] || 0) / total) * 10000) / 100,
    model_versions: dbStats.model_versions,
    feature_versions: dbStats.feature_versions,
    config_versions: dbStats.config_versions,
    provenance_breakdown: dbStats.provenance_breakdown,
    purpose: 'AUDIT_ONLY',
  };
}

// ═══════════════════════════════════════════════════════════════════
// UTC REFERENCE CLOCK (Section 3)
// ═══════════════════════════════════════════════════════════════════

export interface ClockConfig {
  /** Database timezone */
  db_timezone: string;
  /** API timezone */
  api_timezone: string;
  /** Frontend timezone */
  frontend_timezone: string;
  /** Sports data timezone */
  sports_data_timezone: string;
  /** All stored timestamps use this timezone */
  storage_timezone: 'UTC';
  /** Conversion notes */
  conversion_notes: string[];
}

/**
 * Document and verify the timezone configuration.
 * All stored timestamps MUST be UTC.
 */
export function getClockConfig(): ClockConfig {
  return {
    db_timezone: 'UTC (Neon PostgreSQL TIMESTAMPTZ)',
    api_timezone: 'UTC (Vercel Serverless — process.env.TZ)',
    frontend_timezone: 'Browser local (converted to UTC before sending)',
    sports_data_timezone: 'UTC (scraper outputs ISO 8601 UTC)',
    storage_timezone: 'UTC',
    conversion_notes: [
      'All timestamps stored in DB are TIMESTAMPTZ (UTC)',
      'API returns ISO 8601 UTC strings',
      'Frontend converts browser local → UTC before sending to API',
      'Sports data scraper outputs UTC timestamps',
      'snapshot_timestamp is NOW() at INSERT time (server UTC)',
      'DST transitions: UTC has no DST, all conversions handle DST correctly',
      'Verification: new Date().toISOString() always produces UTC',
    ],
  };
}

/**
 * Get current UTC timestamp as ISO 8601.
 */
export function nowUTC(): string {
  return new Date().toISOString();
}

/**
 * Verify a timestamp is valid UTC ISO 8601.
 */
export function isValidUTCTimestamp(ts: string): boolean {
  try {
    const d = new Date(ts);
    return !isNaN(d.getTime()) && d.toISOString() === ts;
  } catch {
    return false;
  }
}
