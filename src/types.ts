/**
 * Arc Database Extension Types
 */

export interface ArcConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  database?: string;
}

export interface ArcToken {
  token: string;
  description?: string;
  createdAt?: string;
}

export interface ArcQueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime?: number;
}

export interface ArcMeasurement {
  name: string;
  database: string;
  columnCount?: number;
  rowCount?: number;
}

export interface ArcDatabase {
  name: string;
  measurements?: ArcMeasurement[];
}

/**
 * License block from Arc's /health.
 *
 * Absent entirely on builds where the license client is not wired, so treat a
 * missing block as OSS/unknown rather than an error. Arc deliberately excludes
 * the license key, customer identity and feature list here because /health is
 * unauthenticated -- so this gives the tier, not per-feature capability.
 */
export interface ArcLicenseHealth {
  /** 'oss' when unlicensed; otherwise starter | professional | enterprise | unlimited */
  tier?: string;
  /** 'unlicensed' | 'expired' | ... */
  status?: string;
  source?: string;
  expires_at?: string;
  days_remaining?: number;
  site_license?: boolean;
}

/**
 * Response from Arc's /health.
 *
 * Field names and types mirror what the server actually sends. Note `uptime` is
 * a formatted string ("173h40m58s"), not a number -- it was previously typed as
 * a number here, so any arithmetic on it was already wrong. `uptime_sec`
 * carries the numeric value.
 */
export interface ArcHealthStatus {
  status: string;
  time?: string;
  uptime?: string;
  uptime_sec?: number;
  storage?: Record<string, any>;
  license?: ArcLicenseHealth;
}

export interface ArcMetrics {
  queries_executed?: number;
  data_points_written?: number;
  cache_hit_rate?: number;
  avg_query_time_ms?: number;
  [key: string]: any;
}

export interface TokenCreateRequest {
  name: string;
  description?: string;
  /**
   * Coarse permissions for the new token. Omit to take Arc's default,
   * `read,write`.
   *
   * Arc also accepts an empty array, which creates a token with no coarse
   * permissions at all — the documented way to ask for a token governed
   * purely by its RBAC grants. The extension does not offer that: a token
   * with no grants yet cannot read anything, so it would arrive unable to
   * browse the server it was just created on.
   */
  permissions?: ArcTokenPermission[];
}

/** The coarse permissions Arc recognises on a token. */
export type ArcTokenPermission = 'read' | 'write' | 'delete' | 'admin';

export interface TokenCreateResponse {
  token: string;
  message?: string;
}

export interface TokenVerifyResponse {
  valid: boolean;
  message?: string;
}

export interface QueryRequest {
  query: string;
  database?: string;
  format?: 'json' | 'arrow';
}

export interface WriteDataRequest {
  measurement: string;
  tags?: Record<string, string>;
  fields: Record<string, any>;
  timestamp?: number;
}

export interface MeasurementInfo {
  name: string;
  columns?: Array<{
    name: string;
    type: string;
  }>;
}

export interface ArcError {
  message: string;
  code?: string;
  statusCode?: number;
}
