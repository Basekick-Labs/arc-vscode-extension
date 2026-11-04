import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  ArcConnection,
  ArcQueryResult,
  ArcHealthStatus,
  ArcMetrics,
  TokenCreateRequest,
  TokenCreateResponse,
  TokenVerifyResponse,
  QueryRequest,
  MeasurementInfo
} from '../types';
import { filterValidNames } from '../utils/sqlUtils.js';
import { validateDatabaseName } from '../utils/databaseNames';
import {
  ArcAccessError,
  classifyArcError
} from '../utils/arcErrors.js';

export class ArcClient {
  private client: AxiosInstance;
  private connection: ArcConnection;
  private token?: string;

  constructor(connection: ArcConnection, token?: string, timeout?: number) {
    this.connection = connection;
    this.token = token;

    const baseURL = `${connection.protocol}://${connection.host}:${connection.port}`;
    console.log(`[ArcClient] Creating client with baseURL: ${baseURL}`, {
      hasToken: !!token
    });

    this.client = axios.create({
      baseURL,
      timeout: timeout ?? 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add request interceptor to inject token
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      console.log(`[ArcClient] Request to: ${config.baseURL}${config.url}`, {
        method: config.method,
        hasAuth: !!config.headers.Authorization
      });
      return config;
    });
  }

  /**
   * Update the authentication token
   */
  setToken(token: string): void {
    this.token = token;
  }

  /**
   * Get current connection info
   */
  getConnection(): ArcConnection {
    return this.connection;
  }

  /**
   * Health check - verify server is reachable
   */
  async healthCheck(): Promise<ArcHealthStatus> {
    try {
      console.log(`[ArcClient] Attempting health check to: ${this.client.defaults.baseURL}/health`);
      const response = await this.client.get('/health');
      console.log('[ArcClient] Health check successful:', response.data);
      return response.data;
    } catch (error) {
      console.error('[ArcClient] Health check failed:', describeForLog(error));
      throw this.handleError(error);
    }
  }

  /**
   * Get server metrics
   */
  async getMetrics(): Promise<ArcMetrics> {
    try {
      const response = await this.client.get('/api/v1/metrics');
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Create a new authentication token
   */
  async createToken(request?: TokenCreateRequest): Promise<TokenCreateResponse> {
    try {
      const response = await this.client.post('/api/v1/auth/tokens', request || {});
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Verify an authentication token
   */
  async verifyToken(): Promise<TokenVerifyResponse> {
    try {
      const response = await this.client.get('/api/v1/auth/verify');
      return { valid: true, message: response.data.message };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        return { valid: false, message: 'Token is invalid or expired' };
      }
      throw this.handleError(error);
    }
  }

  /**
   * List all tokens from Arc server
   */
  async listTokens(): Promise<any[]> {
    try {
      const response = await this.client.get('/api/v1/auth/tokens');
      const data = response.data;
      return data.tokens || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete a token from Arc server by ID
   */
  async deleteServerToken(tokenId: number): Promise<void> {
    try {
      await this.client.delete(`/api/v1/auth/tokens/${tokenId}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Rotate a token - generates new token value while keeping metadata
   */
  async rotateServerToken(tokenId: number): Promise<any> {
    try {
      const response = await this.client.post(`/api/v1/auth/tokens/${tokenId}/rotate`);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Execute a SQL query
   */
  async executeQuery(request: QueryRequest): Promise<ArcQueryResult> {
    try {
      const endpoint = request.format === 'arrow' ? '/api/v1/query/arrow' : '/api/v1/query';
      const payload: any = {
        sql: request.query  // Arc API expects 'sql' not 'query'
      };

      // Send database via x-arc-database header (more performant than database.table syntax)
      const headers: Record<string, string> = {};
      if (request.database) {
        headers['x-arc-database'] = request.database;
      }

      // Parse response based on format
      if (request.format === 'arrow') {
        const response = await this.client.post(endpoint, payload, {
          headers,
          responseType: 'arraybuffer'
        });

        // Arrow format returns binary IPC data -- parsed in arrowParser.ts
        const { parseArrowResponse } = await import('../utils/arrowParser.js');
        const parsed = parseArrowResponse(response.data);
        return {
          columns: parsed.columns,
          rows: parsed.rows,
          rowCount: parsed.rowCount,
          executionTime: undefined
        };
      } else {
        const response = await this.client.post(endpoint, payload, { headers });

        // JSON format - Arc returns 'data' field with rows
        const responseData = response.data;
        return {
          columns: responseData.columns || [],
          rows: responseData.data || responseData.rows || [],  // Try 'data' first, then 'rows'
          rowCount: responseData.row_count || responseData.data?.length || 0,
          executionTime: responseData.execution_time_ms
        };
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * List measurements through Arc's database-scoped endpoint. This avoids
   * guessing column positions in SHOW TABLES responses and lets Arc apply
   * per-database RBAC before returning names.
   */
  async getMeasurements(database?: string): Promise<MeasurementInfo[]> {
    try {
      // Name the database with FROM: Arc 26.09 and earlier ignore the
      // x-arc-database header for SHOW TABLES, and FROM works on every version.
      // Arc's regex only accepts unquoted identifiers ([\w-]+), and database
      // names come from SHOW DATABASES (server-controlled), so no injection risk.
      const sql = database ? `SHOW TABLES FROM ${database};` : 'SHOW TABLES;';
      const response = await this.client.post('/api/v1/query', { sql });
      const responseData = response.data;

      const columns: string[] = responseData.columns || [];
      const rows = responseData.data || responseData.rows || [];
      if (Array.isArray(rows) && rows.length > 0) {
        // Find the table name column by header; fall back to positional heuristic
        const nameIdx = columns.findIndex(c =>
          c.toLowerCase() === 'table_name' || c.toLowerCase() === 'name'
        );
        if (nameIdx >= 0) {
          return filterValidNames(rows.map((row: any[]) => row[nameIdx])).map(name => ({ name }));
        }
        // Fallback: if multiple columns, table name is typically index 1; if single column, index 0
        const idx = rows[0].length > 1 ? 1 : 0;
        return filterValidNames(rows.map((row: any[]) => row[idx])).map(name => ({ name }));
      }
      return filterValidNames(measurements.map((item: any) =>
        typeof item === 'string' ? item : item?.name
      )).map(name => ({ name }));
    } catch (error) {
      const refusal = this.asAccessError(error);
      if (refusal) {
        throw refusal;
      }

      // Fallback to /measurements endpoint if the query failed for any other
      // reason (an older server, a transport error). `SHOW TABLES;` without
      // FROM lists Arc's `default` database, so ask the fallback for the same
      // one: without a database the endpoint lists every database's
      // measurements, which is a different answer to the same question.
      try {
        const response = await this.client.get('/api/v1/measurements', {
          params: { database: database ?? 'default' }
        });
        const names = measurementNames(response.data);
        if (names) {
          return filterValidNames(names).map(name => ({ name }));
        }
      } catch (endpointError) {
        const fallbackRefusal = this.asAccessError(endpointError);
        if (fallbackRefusal) {
          throw fallbackRefusal;
        }
        console.warn('Both SHOW TABLES and /measurements failed:', describeForLog(endpointError));
      }
      throw this.handleError(error);
    }
  }

  /**
   * Returns an ArcAccessError when the error is Arc refusing the request —
   * 401, one of the different things it answers 403 with, or a 503 from its
   * permission store failing closed — and undefined for anything else.
   *
   * Arc's 403s are told apart by message, not by status, so this is the one
   * place that reads them (see utils/arcErrors.ts). It exists separately from
   * handleError because callers need to branch on WHICH refusal it was, not
   * just print it: a scoped token can still work once a database is named,
   * while a token with no read permission cannot.
   */
  private asAccessError(error: unknown): ArcAccessError | undefined {
    if (error instanceof ArcAccessError) {
      return error;
    }
    if (!axios.isAxiosError(error)) {
      return undefined;
    }
    const status = error.response?.status;
    if (status !== 401 && status !== 403 && status !== 503) {
      return undefined;
    }
    const info = classifyArcError(
      status,
      serverErrorMessage(error.response?.data),
      undefined,
      serverErrorReason(error.response?.data)
    );
    // A 503 is a refusal only when it is Arc's permission store failing
    // closed; any other 503 is an ordinary server error.
    if (status === 503 && info.kind !== 'unavailable') {
      return undefined;
    }
    return new ArcAccessError(info);
  }

  /**
   * List databases using Arc's first-class database API.
   */
  async getDatabases(): Promise<string[]> {
    try {
      const response = await this.client.get('/api/v1/databases');
      const databases = response.data?.databases;
      if (!Array.isArray(databases)) {
        throw new Error('Unexpected database listing response from Arc');
      }

      return [];
    } catch (error) {
      // No failure is answered with a made-up database. The old blanket
      // `return ['default']` put a database in the tree that might not exist,
      // or that the token might not be able to read, with nothing anywhere
      // saying why. Arc 26.09 and earlier refuse this listing for a token
      // scoped to particular databases (newer Arc returns a filtered list
      // instead), so a refusal is a normal state the caller can degrade from;
      // an unreachable server or a server fault is reported as what it is.
      const refusal = this.asAccessError(error);
      if (refusal) {
        throw refusal;
      }
      // Older Arc versions may not expose the database resource route yet.
      // Fall back to SHOW DATABASES only for a missing route; a 401/403 from
      // either endpoint is surfaced rather than turned into a fake database.
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        try {
          const legacy = await this.client.post('/api/v1/query', { sql: 'SHOW DATABASES;' });
          const rows = legacy.data?.data || legacy.data?.rows || [];
          if (Array.isArray(rows)) {
            return filterValidNames(rows.map((row: any[]) => row[0]));
          }
        } catch (fallbackError) {
          const fallbackRefusal = this.asAccessError(fallbackError);
          if (fallbackRefusal) {
            throw fallbackRefusal;
          }
          console.warn('Legacy SHOW DATABASES fallback failed:', fallbackError);
        }
      }
      throw this.handleError(error);
    }
  }

  /** Create a database through Arc's admin-protected database API. */
  async createDatabase(name: string): Promise<void> {
    const validation = validateDatabaseName(name);
    if (validation) {
      throw new Error(validation);
    }
    try {
      await this.client.post('/api/v1/databases', { name });
    } catch (error) {
      throw this.handleDatabaseMutationError(error, 'create');
    }
  }

  /**
   * Delete a database after the UI has confirmed the destructive action.
   * Arc requires both an admin token and the explicit `confirm=true` query.
   */
  async deleteDatabase(name: string): Promise<void> {
    const validation = validateDatabaseName(name);
    if (validation) {
      throw new Error(validation);
    }
    try {
      await this.client.delete(`/api/v1/databases/${encodeURIComponent(name)}`, {
        params: { confirm: 'true' }
      });
    } catch (error) {
      throw this.handleDatabaseMutationError(error, 'delete');
    }
  }

  private handleDatabaseMutationError(error: unknown, operation: 'create' | 'delete'): Error {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const detail = serverErrorMessage(error.response?.data);
      if (status === 403) {
        // Delete can also be disabled server-side or target a reserved name;
        // neither is an admin-token problem. A broken permission store is a
        // server fault, not a reason to rotate the token.
        if (detail && /delete operations are disabled|reserved database/i.test(detail)) {
          return new Error(detail);
        }
        if (detail && /permission data unavailable/i.test(detail)) {
          return new Error(`${detail} This is a server-side fault; check the Arc server log.`);
        }
        if (detail && /enterprise license/i.test(detail)) {
          return new Error(detail);
        }
        return new Error(`${detail || `Arc refused to ${operation} the database.`} This operation requires an admin token.`);
      }
      if (detail) {
        return new Error(detail);
      }
      if (status === 400 || status === 404 || status === 409) {
        return new Error(`Arc could not ${operation} the database.`);
      }
    }
    return this.handleError(error);
  }

  /**
   * Write data points using Arc's MessagePack columnar format.
   *
   * Previously this built line protocol by string concatenation with no
   * escaping, so any tag or field value containing a space, comma, '=' or
   * quote produced a malformed line -- silently corrupting data, or splitting
   * a value into extra tags. msgpack carries values as typed data instead, so
   * there is nothing to escape and nothing to get wrong. It is also the format
   * CSVImporter already uses, and the faster path on the Arc side.
   *
   * Timestamps are passed through untouched: Arc auto-detects seconds,
   * milliseconds, microseconds or nanoseconds from magnitude.
   */
  async writeData(measurement: string, data: any[], database?: string): Promise<void> {
    try {
      if (data.length === 0) {
        return;
      }

      // Row-wise input -> columnar. Every column must be the same length, so
      // collect the full key set first and pad rows that omit a key with null.
      const tagKeys = new Set<string>();
      const fieldKeys = new Set<string>();
      for (const point of data) {
        Object.keys(point.tags ?? {}).forEach(k => tagKeys.add(k));
        Object.keys(point.fields ?? {}).forEach(k => fieldKeys.add(k));
      }

      // The timestamp column is generated from point.timestamp and cannot be
      // replaced by a user-provided tag or field. Arc treats the reserved name
      // case-insensitively, so reject every casing before building columns.
      const reserved = [...tagKeys, ...fieldKeys].find(k => k.toLowerCase() === 'time');
      if (reserved !== undefined) {
        throw new Error(
          `Column "${reserved}" is reserved for timestamps and cannot be used as a tag or field`
        );
      }

      const columns: Record<string, any[]> = {
        time: data.map(p => p.timestamp ?? Date.now())
      };
      for (const key of tagKeys) {
        columns[key] = data.map(p => p.tags?.[key] ?? null);
      }
      for (const key of fieldKeys) {
        // A field colliding with a tag name would otherwise overwrite it
        // silently; keep the tag and surface the conflict.
        if (key in columns) {
          throw new Error(`Column "${key}" is used as both a tag and a field`);
        }
        columns[key] = data.map(p => p.fields?.[key] ?? null);
      }

      const { encode } = await import('@msgpack/msgpack');
      const payload = encode({ m: measurement, columns });

      const writeHeaders: Record<string, string> = { 'Content-Type': 'application/msgpack' };
      if (database) {
        writeHeaders['x-arc-database'] = database;
      }

      await this.client.post('/api/v1/write/msgpack', payload, {
        headers: writeHeaders
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Handle and normalize errors
   */
  private handleError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const responseData = axiosError.response?.data as any;

      // Arc's own explanation. It sends it as `error` on most routes and
      // `message` on a few; reading only `message` lost almost all of them.
      const serverMessage = serverErrorMessage(responseData);
      let message = serverMessage || axiosError.message || 'Unknown error';
      const accessError = this.asAccessError(error);

      // Add more context for common errors
      if (axiosError.code === 'ECONNREFUSED') {
        message = `Cannot connect to ${this.connection.protocol}://${this.connection.host}:${this.connection.port} - Connection refused`;
      } else if (axiosError.code === 'ENOTFOUND') {
        message = `Cannot resolve hostname: ${this.connection.host}`;
      } else if (axiosError.code === 'ETIMEDOUT') {
        message = `Connection timeout to ${this.connection.host}:${this.connection.port}`;
      } else if (accessError) {
        // 401 and 403 are not one condition, and 403 is not even one
        // condition by itself: Arc answers it for a token with no read
        // permission, for a token whose grants do not cover the database
        // asked for, for a licence-gated feature, and for its own permission
        // store being unreadable — distinguishable only by message. The
        // classifier reads them (utils/arcErrors.ts) and returns a sentence
        // naming the fix, so no caller has to pattern-match here and a
        // scoped token is never reported as a bad token.
        message = accessError.message;
      } else if (axiosError.response?.status === 404 && (!serverMessage || /^Cannot [A-Z]+ /.test(serverMessage))) {
        // Arc's router answers an unknown route with "Cannot GET /path"; a
        // handler's 404 ("Database 'x' not found") is kept as Arc wrote it.
        message = 'Endpoint not found - Check server URL';
      }

      // The original AxiosError is deliberately not attached: its config
      // carries the Authorization header, and any caller that logs this
      // error would otherwise write the token to the Extension Host log.
      const err = new Error(message);
      (err as any).code = axiosError.code;
      (err as any).statusCode = axiosError.response?.status;

      console.error('[ArcClient] Error details:', {
        code: axiosError.code,
        status: axiosError.response?.status,
        url: axiosError.config?.url,
        baseURL: axiosError.config?.baseURL,
        message
      });

      return err;
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error('Unknown error occurred');
  }
}

/**
 * Arc's own message from an error body. It uses `error` on most routes and
 * `message` on a few, so both are read; a non-object body (an HTML error page
 * from a proxy, say) yields undefined rather than a misleading string.
 */
function serverErrorMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const body = data as { error?: unknown; message?: unknown };
  if (typeof body.error === 'string' && body.error !== '') {
    return body.error;
  }
  if (typeof body.message === 'string' && body.message !== '') {
    return body.message;
  }
  return undefined;
}

/** Arc's machine-readable reason for an error, when it sends one. */
function serverErrorReason(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const reason = (data as { reason?: unknown }).reason;
  return typeof reason === 'string' && reason !== '' ? reason : undefined;
}

/**
 * Measurement names from a `/api/v1/measurements` body. Arc answers
 * `{ measurements: [{ database, measurement, ... }] }`; plain string entries
 * and a `name` key are accepted too, for older or proxied responses.
 * Returns undefined for a body it does not recognise.
 */
function measurementNames(data: unknown): string[] | undefined {
  const list = Array.isArray(data)
    ? data
    : (typeof data === 'object' && data !== null && Array.isArray((data as { measurements?: unknown }).measurements)
        ? (data as { measurements: unknown[] }).measurements
        : undefined);
  if (!list) {
    return undefined;
  }
  return list.map(entry => {
    if (typeof entry === 'string') {
      return entry;
    }
    if (typeof entry === 'object' && entry !== null) {
      const e = entry as { measurement?: unknown; name?: unknown };
      return typeof e.measurement === 'string' ? e.measurement : e.name;
    }
    return undefined;
  }) as string[];
}

/**
 * What to log for a failed request: status, method, path and Arc's message.
 * Never the error object itself, whose config carries the Authorization
 * header (logging it writes the bearer token to the Extension Host log).
 */
function describeForLog(error: unknown): Record<string, unknown> | string {
  if (axios.isAxiosError(error)) {
    return {
      code: error.code,
      status: error.response?.status,
      method: error.config?.method,
      url: error.config?.url,
      message: serverErrorMessage(error.response?.data) ?? error.message
    };
  }
  return error instanceof Error ? error.message : String(error);
}
