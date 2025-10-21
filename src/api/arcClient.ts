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

export class ArcClient {
  private client: AxiosInstance;
  private connection: ArcConnection;
  private token?: string;

  constructor(connection: ArcConnection, token?: string) {
    this.connection = connection;
    this.token = token;

    const baseURL = `${connection.protocol}://${connection.host}:${connection.port}`;
    console.log(`[ArcClient] Creating client with baseURL: ${baseURL}`, {
      hasToken: !!token,
      tokenLength: token?.length
    });

    this.client = axios.create({
      baseURL,
      timeout: 30000,
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
      console.error('[ArcClient] Health check failed:', error);
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

      if (request.database) {
        payload.database = request.database;
      }

      const response = await this.client.post(endpoint, payload);

      // Parse response based on format
      if (request.format === 'arrow') {
        // Arrow format returns binary data - for now return raw
        // You'll need apache-arrow library to parse properly
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          executionTime: response.data.execution_time_ms
        };
      } else {
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
   * List all measurements (tables) in a database
   */
  async getMeasurements(database?: string): Promise<MeasurementInfo[]> {
    try {
      // Use SHOW TABLES query - more reliable than /measurements endpoint
      const query = database ? `SHOW TABLES FROM ${database};` : 'SHOW TABLES;';
      const response = await this.client.post('/api/v1/query', { sql: query });
      const responseData = response.data;

      // Response format: { data: [[db, table_name, path, ...], ...] }
      const rows = responseData.data || responseData.rows || [];
      if (Array.isArray(rows) && rows.length > 0) {
        // SHOW TABLES returns multiple columns, table name is in column 1 (index 1)
        return rows.map((row: any[]) => ({ name: row[1] || row[0] }));
      }

      return [];
    } catch (error) {
      // Fallback to /measurements endpoint if query fails
      try {
        const params = database ? { database } : {};
        const response = await this.client.get('/api/v1/measurements', { params });
        const data = response.data;

        if (Array.isArray(data)) {
          return data;
        } else if (data.measurements && Array.isArray(data.measurements)) {
          return data.measurements.map((name: string) => ({ name }));
        }
      } catch (endpointError) {
        console.warn('Both SHOW TABLES and /measurements failed:', endpointError);
      }

      throw this.handleError(error);
    }
  }

  /**
   * List all databases using SHOW DATABASES SQL query
   */
  async getDatabases(): Promise<string[]> {
    try {
      // Arc supports SHOW DATABASES SQL query
      const response = await this.client.post('/api/v1/query', {
        sql: 'SHOW DATABASES;'  // Arc API expects 'sql' not 'query'
      });

      const responseData = response.data;

      // Response format: { columns: ['database'], data: [['default'], ['production'], ...] }
      const rows = responseData.data || responseData.rows || [];
      if (Array.isArray(rows)) {
        return rows.map((row: any[]) => row[0]).filter((db: any) => db);
      }

      return ['default'];
    } catch (error) {
      // If query fails, fallback to default database
      if (axios.isAxiosError(error)) {
        console.warn('Failed to get databases, using default:', error.message);
        return ['default'];
      }
      throw this.handleError(error);
    }
  }

  /**
   * Write data using MessagePack columnar format (highest performance)
   * Note: This is a simplified version - full implementation needs msgpack encoding
   */
  async writeData(measurement: string, data: any[], database?: string): Promise<void> {
    try {
      // For now, use line protocol format as it's simpler
      // Full msgpack implementation would require @msgpack/msgpack library
      const lines = data.map(point => {
        const tags = point.tags ? Object.entries(point.tags)
          .map(([k, v]) => `${k}=${v}`)
          .join(',') : '';

        const fields = Object.entries(point.fields)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`)
          .join(',');

        const timestamp = point.timestamp || Date.now() * 1000000; // nanoseconds

        return `${measurement}${tags ? ',' + tags : ''} ${fields} ${timestamp}`;
      }).join('\n');

      await this.client.post('/api/v1/write/line-protocol', lines, {
        headers: { 'Content-Type': 'text/plain' },
        params: database ? { db: database } : {}
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

      // Build detailed error message
      let message = responseData?.message || axiosError.message || 'Unknown error';

      // Add more context for common errors
      if (axiosError.code === 'ECONNREFUSED') {
        message = `Cannot connect to ${this.connection.protocol}://${this.connection.host}:${this.connection.port} - Connection refused`;
      } else if (axiosError.code === 'ENOTFOUND') {
        message = `Cannot resolve hostname: ${this.connection.host}`;
      } else if (axiosError.code === 'ETIMEDOUT') {
        message = `Connection timeout to ${this.connection.host}:${this.connection.port}`;
      } else if (axiosError.response?.status === 401) {
        message = 'Authentication failed - Invalid or missing token';
      } else if (axiosError.response?.status === 403) {
        message = 'Access forbidden - Check token permissions';
      } else if (axiosError.response?.status === 404) {
        message = 'Endpoint not found - Check server URL';
      }

      const err = new Error(message);
      (err as any).code = axiosError.code;
      (err as any).statusCode = axiosError.response?.status;
      (err as any).originalError = axiosError;

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
