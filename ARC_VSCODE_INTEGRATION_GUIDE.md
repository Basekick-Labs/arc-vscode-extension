# Arc VS Code Extension - Integration Guide

This guide provides code examples and implementation patterns for building a VS Code extension to interact with Arc Core.

## Quick Reference

### Base Configuration
```javascript
// Extension configuration
const ARC_CONFIG = {
    defaultUrl: 'http://localhost:8000',
    tokenStorageKey: 'arc-extension-tokens',
    defaultDatabase: 'default',
    requestTimeout: 30000, // 30 seconds
    retryAttempts: 3
};
```

---

## 1. Authentication Token Management

### Store Token Securely
```javascript
import * as vscode from 'vscode';

class TokenManager {
    constructor(context: vscode.ExtensionContext) {
        this.secrets = context.secrets;
    }

    async saveToken(name: string, token: string) {
        await this.secrets.store(`arc-token-${name}`, token);
    }

    async getToken(name: string): Promise<string | undefined> {
        return await this.secrets.get(`arc-token-${name}`);
    }

    async deleteToken(name: string) {
        await this.secrets.delete(`arc-token-${name}`);
    }

    async listTokens(): Promise<string[]> {
        // Note: VS Code doesn't expose list API, you'll need to track in context.globalState
        return await this.context.globalState.get('arc-token-list') || [];
    }
}
```

### Create Token via Arc API
```javascript
async function createTokenViaAPI(
    arcUrl: string,
    existingToken: string,
    newTokenName: string,
    description: string
): Promise<{token: string, id: number, name: string}> {
    const response = await fetch(`${arcUrl}/auth/tokens`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${existingToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: newTokenName,
            description: description,
            expires_at: null
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to create token: ${response.statusText}`);
    }

    return await response.json();
}
```

### Test Token Validity
```javascript
async function verifyToken(arcUrl: string, token: string): Promise<boolean> {
    try {
        const response = await fetch(`${arcUrl}/auth/verify`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}
```

---

## 2. Data Ingestion - MessagePack Columnar Format

### Write Columnar Data (FASTEST - 2.32M RPS)
```javascript
import * as msgpack from 'msgpack-lite'; // Install: npm install msgpack-lite

async function writeColumnarData(
    arcUrl: string,
    token: string,
    measurement: string,
    columns: Record<string, any[]>,
    database: string = 'default'
): Promise<void> {
    const payload = {
        m: measurement,
        columns: columns
    };

    const buffer = msgpack.encode(payload);

    const response = await fetch(`${arcUrl}/write/v1/msgpack`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/msgpack',
            'x-arc-database': database
        },
        body: buffer
    });

    if (response.status !== 204) {
        throw new Error(`Write failed: ${response.status} ${response.statusText}`);
    }
}

// Usage example
async function writeTestData(arcUrl: string, token: string) {
    const now = Date.now();
    const columns = {
        time: [now, now + 1000, now + 2000],
        host: ['server01', 'server02', 'server03'],
        region: ['us-east', 'us-west', 'eu-central'],
        usage_idle: [95.0, 85.0, 92.0],
        usage_user: [3.2, 10.5, 5.8],
        usage_system: [1.8, 4.5, 2.2]
    };

    await writeColumnarData(arcUrl, token, 'cpu', columns);
}
```

### Write Row Format (Legacy - 908K RPS)
```javascript
async function writeRowData(
    arcUrl: string,
    token: string,
    records: Array<{m: string, t: number, h?: string, fields: Record<string, number>, tags?: Record<string, string>}>,
    database: string = 'default'
): Promise<void> {
    const payload = { batch: records };
    const buffer = msgpack.encode(payload);

    const response = await fetch(`${arcUrl}/write/v1/msgpack`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/msgpack',
            'x-arc-database': database
        },
        body: buffer
    });

    if (response.status !== 204) {
        throw new Error(`Write failed: ${response.status}`);
    }
}
```

### Write Line Protocol (Text - 240K RPS)
```javascript
async function writeLineProtocol(
    arcUrl: string,
    token: string,
    lines: string[],
    database: string = 'default'
): Promise<void> {
    const payload = lines.join('\n');

    const response = await fetch(`${arcUrl}/write`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'text/plain',
            'x-arc-database': database
        },
        body: payload
    });

    if (response.status !== 204) {
        throw new Error(`Write failed: ${response.status}`);
    }
}

// Usage: Generate Telegraf-compatible line protocol
function generateLineProtocol(
    measurement: string,
    tags: Record<string, string>,
    fields: Record<string, number>,
    timestamp?: number
): string {
    const tagString = Object.entries(tags)
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
    
    const fieldString = Object.entries(fields)
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
    
    const ts = timestamp || Date.now() * 1000000; // nanoseconds
    
    return `${measurement}${tagString ? ',' + tagString : ''} ${fieldString} ${ts}`;
}
```

---

## 3. Query Execution

### Execute SQL Query (JSON)
```javascript
interface QueryResponse {
    success: boolean;
    columns: string[];
    data: any[][];
    row_count: number;
    execution_time_ms: number;
    timestamp: string;
    error?: string;
}

async function executeQuery(
    arcUrl: string,
    token: string,
    sql: string,
    limit: number = 1000
): Promise<QueryResponse> {
    const response = await fetch(`${arcUrl}/query`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            sql: sql,
            limit: limit,
            format: 'json'
        }),
        timeout: 300000 // 5 minutes
    });

    if (!response.ok) {
        throw new Error(`Query failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

// Usage
async function exampleQuery(arcUrl: string, token: string) {
    const result = await executeQuery(
        arcUrl,
        token,
        `SELECT * FROM cpu WHERE host = 'server01' LIMIT 10`
    );
    
    console.log(`Got ${result.row_count} rows in ${result.execution_time_ms}ms`);
    console.log('Columns:', result.columns);
    result.data.forEach(row => console.log(row));
}
```

### Execute Query (Arrow Format - Columnar)
```javascript
import * as Arrow from 'apache-arrow'; // Install: npm install apache-arrow

async function executeQueryArrow(
    arcUrl: string,
    token: string,
    sql: string
): Promise<Arrow.Table> {
    const response = await fetch(`${arcUrl}/query/arrow`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql: sql }),
        timeout: 300000
    });

    if (!response.ok) {
        throw new Error(`Query failed: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const reader = Arrow.RecordBatchReader.parse(buffer);
    return reader.readAll();
}

// Usage with columnar data
async function analyzeWithArrow(arcUrl: string, token: string) {
    const table = await executeQueryArrow(
        arcUrl,
        token,
        `SELECT time_bucket(INTERVAL '1 hour', time) as hour, host, AVG(usage_idle) as avg_cpu
         FROM cpu 
         WHERE time > now() - INTERVAL '24 hours'
         GROUP BY hour, host`
    );

    // Access columnar data
    for (const batch of table.batches()) {
        const hour = batch.getChild('hour');
        const host = batch.getChild('host');
        const avgCpu = batch.getChild('avg_cpu');
        
        for (let i = 0; i < batch.length; i++) {
            console.log(hour.get(i), host.get(i), avgCpu.get(i));
        }
    }
}
```

### Stream Large Results (CSV)
```javascript
async function streamQueryAsCSV(
    arcUrl: string,
    token: string,
    measurement: string
): Promise<string> {
    const response = await fetch(
        `${arcUrl}/query/${measurement}/csv`,
        {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }
    );

    if (!response.ok) {
        throw new Error(`Query failed: ${response.status}`);
    }

    return await response.text();
}
```

---

## 4. Database Management

### List All Databases
```javascript
async function listDatabases(arcUrl: string, token: string): Promise<string[]> {
    const result = await executeQuery(
        arcUrl,
        token,
        'SHOW DATABASES'
    );
    return result.data.map(row => row[0]);
}
```

### List Measurements (Tables)
```javascript
interface TableInfo {
    database: string;
    table_name: string;
    storage_path: string;
    file_count: number;
    total_size_mb: number;
}

async function listMeasurements(
    arcUrl: string,
    token: string
): Promise<TableInfo[]> {
    const result = await executeQuery(
        arcUrl,
        token,
        'SHOW TABLES'
    );

    return result.data.map(row => ({
        database: row[0],
        table_name: row[1],
        storage_path: row[2],
        file_count: row[3],
        total_size_mb: row[4]
    }));
}
```

### Get Table Schema
```javascript
async function getTableSchema(
    arcUrl: string,
    token: string,
    table: string,
    database?: string
): Promise<Array<{name: string, type: string}>> {
    const fullTable = database ? `${database}.${table}` : table;
    const result = await executeQuery(
        arcUrl,
        token,
        `DESCRIBE ${fullTable}`
    );

    return result.data.map(row => ({
        name: row[0],
        type: row[1]
    }));
}
```

---

## 5. Monitoring & Status

### Health Check
```javascript
interface HealthStatus {
    status: 'healthy' | 'unhealthy';
    service: string;
    version: string;
    timestamp: string;
}

async function checkHealth(arcUrl: string): Promise<HealthStatus> {
    const response = await fetch(`${arcUrl}/health`);
    return await response.json();
}
```

### Get Metrics
```javascript
interface Metrics {
    timestamp: string;
    write_throughput: number;
    query_latency_ms: number;
    cache_hit_rate: number;
    buffer_usage_percent: number;
    storage_used_mb: number;
}

async function getMetrics(arcUrl: string, token: string): Promise<Metrics> {
    const response = await fetch(
        `${arcUrl}/metrics`,
        {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }
    );
    return await response.json();
}
```

### Get Auth Cache Statistics
```javascript
interface CacheStats {
    cache_size: number;
    cache_ttl_seconds: number;
    total_requests: number;
    cache_hits: number;
    cache_misses: number;
    hit_rate_percent: number;
}

async function getAuthCacheStats(
    arcUrl: string,
    token: string
): Promise<CacheStats> {
    const response = await fetch(
        `${arcUrl}/auth/cache/stats`,
        {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }
    );
    return await response.json();
}
```

---

## 6. VS Code UI Components

### Token Selection Quick Pick
```javascript
import * as vscode from 'vscode';

async function selectToken(tokenManager: TokenManager): Promise<string | undefined> {
    const tokens = await tokenManager.listTokens();
    
    const selected = await vscode.window.showQuickPick(
        tokens.map(name => ({
            label: name,
            description: 'Arc token'
        })),
        {
            placeHolder: 'Select Arc token or create new one',
            canPickMany: false
        }
    );

    if (!selected) return undefined;
    return await tokenManager.getToken(selected.label);
}
```

### Database Selection
```javascript
async function selectDatabase(arcUrl: string, token: string): Promise<string> {
    const databases = await listDatabases(arcUrl, token);
    
    const selected = await vscode.window.showQuickPick(
        databases,
        {
            placeHolder: 'Select database',
            canPickMany: false
        }
    );

    return selected || 'default';
}
```

### Query Result Display
```javascript
async function displayQueryResults(result: QueryResponse) {
    const panel = vscode.window.createWebviewPanel(
        'arcQueryResults',
        'Arc Query Results',
        vscode.ViewColumn.Two,
        {}
    );

    const table = `
        <table style="border-collapse: collapse; width: 100%;">
            <tr style="background-color: #f0f0f0;">
                ${result.columns.map(col => `<th style="border: 1px solid #ddd; padding: 8px;">${col}</th>`).join('')}
            </tr>
            ${result.data.map(row => `
                <tr>
                    ${row.map((cell: any) => `<td style="border: 1px solid #ddd; padding: 8px;">${cell}</td>`).join('')}
                </tr>
            `).join('')}
        </table>
    `;

    panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial; padding: 10px; }
                .stats { margin-bottom: 15px; font-size: 12px; color: #666; }
            </style>
        </head>
        <body>
            <div class="stats">
                <p>Rows: ${result.row_count}</p>
                <p>Execution time: ${result.execution_time_ms}ms</p>
                ${result.error ? `<p style="color: orange;">⚠ ${result.error}</p>` : ''}
            </div>
            <div style="overflow-x: auto;">
                ${table}
            </div>
        </body>
        </html>
    `;
}
```

---

## 7. Error Handling

### Retry with Backoff
```javascript
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    delayMs: number = 1000
): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxAttempts) {
                throw error;
            }
            
            const delay = delayMs * Math.pow(2, attempt - 1); // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error('Failed after retries');
}

// Usage
async function robustQuery(arcUrl: string, token: string, sql: string) {
    return await retryWithBackoff(
        () => executeQuery(arcUrl, token, sql)
    );
}
```

### Handle Common Errors
```javascript
function getErrorMessage(error: any): string {
    if (error.message === 'Failed to fetch') {
        return 'Cannot connect to Arc server. Check URL and ensure server is running.';
    }
    
    if (error.status === 401) {
        return 'Authentication failed. Token may be invalid or expired.';
    }
    
    if (error.status === 408) {
        return 'Query timed out. Try with a smaller time range or limit.';
    }
    
    if (error.message.includes('Large result')) {
        return 'Result set too large. Use LIMIT clause or /query/stream endpoint.';
    }
    
    return error.message || 'Unknown error occurred';
}
```

---

## 8. Configuration Storage

### Store Arc Connection Details
```javascript
async function storeArcConfig(
    context: vscode.ExtensionContext,
    arcUrl: string,
    defaultDatabase: string
) {
    const config = vscode.workspace.getConfiguration('arc-extension');
    await config.update('server.url', arcUrl, vscode.ConfigurationTarget.Global);
    await config.update('server.defaultDatabase', defaultDatabase, vscode.ConfigurationTarget.Global);
}

function getArcConfig(): {url: string, defaultDatabase: string} {
    const config = vscode.workspace.getConfiguration('arc-extension');
    return {
        url: config.get('server.url') || 'http://localhost:8000',
        defaultDatabase: config.get('server.defaultDatabase') || 'default'
    };
}
```

### package.json Configuration
```json
{
    "contributes": {
        "configuration": {
            "title": "Arc Extension",
            "properties": {
                "arc-extension.server.url": {
                    "type": "string",
                    "default": "http://localhost:8000",
                    "description": "Arc server URL"
                },
                "arc-extension.server.defaultDatabase": {
                    "type": "string",
                    "default": "default",
                    "description": "Default database to use"
                },
                "arc-extension.query.timeout": {
                    "type": "number",
                    "default": 300000,
                    "description": "Query timeout in milliseconds"
                },
                "arc-extension.query.cacheResults": {
                    "type": "boolean",
                    "default": true,
                    "description": "Cache query results in Arc"
                }
            }
        },
        "commands": [
            {
                "command": "arc.executeQuery",
                "title": "Arc: Execute Query"
            },
            {
                "command": "arc.writeData",
                "title": "Arc: Write Test Data"
            },
            {
                "command": "arc.manageTokens",
                "title": "Arc: Manage Tokens"
            },
            {
                "command": "arc.showStatus",
                "title": "Arc: Show Status"
            }
        ]
    }
}
```

---

## Key Files to Reference in Arc Codebase

For implementation details, reference these Arc files:

- **Authentication:** `/Users/nacho/dev/basekick-labs/arc/api/auth.py`
- **MessagePack Routes:** `/Users/nacho/dev/basekick-labs/arc/api/msgpack_routes.py`
- **Query Execution:** `/Users/nacho/dev/basekick-labs/arc/api/main.py` (execute_sql, execute_sql_arrow)
- **Models/Validation:** `/Users/nacho/dev/basekick-labs/arc/api/models.py`
- **DuckDB Engine:** `/Users/nacho/dev/basekick-labs/arc/api/duckdb_engine.py`
- **Examples:** `/Users/nacho/dev/basekick-labs/arc/example.py`, `/Users/nacho/dev/basekick-labs/arc/examples/`

