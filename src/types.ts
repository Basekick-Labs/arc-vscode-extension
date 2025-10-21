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

export interface ArcHealthStatus {
  status: string;
  version?: string;
  uptime?: number;
  timestamp?: string;
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
}

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
