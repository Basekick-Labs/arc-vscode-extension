# Testing Multiple Databases in Arc

## Changes Made

Updated the Arc API client to properly discover all databases using Arc's `SHOW DATABASES` SQL query instead of relying on a non-existent `/databases` endpoint.

### What Changed

**File: [src/api/arcClient.ts](src/api/arcClient.ts)**

1. **`getDatabases()` method** - Now uses `SHOW DATABASES` SQL query
   ```typescript
   async getDatabases(): Promise<string[]> {
     const response = await this.client.post('/query', {
       query: 'SHOW DATABASES;'
     });
     return data.rows.map(row => row[0]);
   }
   ```

2. **`getMeasurements()` method** - Added fallback to `SHOW TABLES` query
   ```typescript
   async getMeasurements(database?: string): Promise<MeasurementInfo[]> {
     // Try /measurements endpoint first
     // If it fails, use SHOW TABLES FROM {database} query
   }
   ```

## How Arc Manages Databases

Arc uses a **hierarchical storage structure**:

```
{bucket}/{database}/{measurement}/{year}/{month}/{day}/{hour}/file.parquet
```

### Example Structure
```
arc-data/
├── default/              # Database 1
│   ├── cpu_metrics/
│   ├── memory_usage/
│   └── disk_io/
├── production/           # Database 2
│   ├── api_requests/
│   └── errors/
└── staging/              # Database 3
    └── test_data/
```

## Testing Your Databases

### 1. Check Your Arc Databases

Run this query in Arc to see your databases:
```sql
SHOW DATABASES;
```

Expected result:
```
┌──────────────┐
│   database   │
├──────────────┤
│ default      │
│ production   │
│ staging      │
└──────────────┘
```

### 2. Test in VS Code Extension

1. **Restart the extension** (if already running):
   - Press `Ctrl+Shift+F5` in the Extension Development Host
   - Or close and press `F5` again

2. **Connect to Arc**:
   - Click status bar "Arc: Not Connected"
   - Enter your connection details

3. **Check the Arc Database Explorer**:
   - Open the Arc sidebar (activity bar icon)
   - You should now see **all three databases**:
     - default
     - production (or your second database name)
     - staging (or your third database name)

4. **Expand each database**:
   - Click the expand arrow next to each database
   - You should see the measurements (tables) in that database

### 3. Query Specific Databases

Create a new query and test:

```sql
-- List all tables in production database
SHOW TABLES FROM production;

-- Query data from specific database
SELECT * FROM production.api_requests LIMIT 10;

-- Cross-database query
SELECT
  p.timestamp,
  p.request_count,
  d.cpu_usage
FROM production.api_requests p
JOIN default.cpu_metrics d
  ON date_trunc('minute', p.timestamp) = date_trunc('minute', d.timestamp)
LIMIT 100;
```

## Troubleshooting

### Issue: Still seeing only "default" database

**Cause**: Extension cache or connection not refreshed

**Solution**:
1. Click the refresh button in the Arc Explorer view
2. Or disconnect and reconnect: `Cmd+Shift+P` → `Arc: Disconnect` → `Arc: Connect`

### Issue: "No measurements" shown for a database

**Cause**: Database exists but has no data

**Solution**:
1. Verify the database has data in Arc:
   ```sql
   SHOW TABLES FROM {database_name};
   ```

2. If empty, insert test data:
   ```
   Cmd+Shift+P → Arc: Insert Test Data
   ```

### Issue: Query fails with "database not found"

**Cause**: Database name case sensitivity or typo

**Solution**:
1. Check exact database names:
   ```sql
   SHOW DATABASES;
   ```

2. Use the exact name from the result (case-sensitive)

## How Arc Discovers Databases

Arc scans the storage backend (local filesystem, S3, MinIO, etc.) to find databases:

### Local Filesystem
- Scans the base data directory
- Each top-level folder = database
- Skips hidden folders (starting with `.`)

### S3/MinIO/Cloud Storage
- Lists bucket prefixes with delimiter `/`
- Top-level "directories" = databases
- Filters out numeric folders (year partitions)

### Example Storage Scan Result
```python
# Arc scans: s3://my-arc-bucket/
# Finds:
#   default/          ← Database
#   production/       ← Database
#   staging/          ← Database
#   2024/             ← Ignored (numeric - year partition)
```

## Verify Database Configuration

Check your Arc configuration (`arc.conf` or environment variables):

```toml
[storage]
backend = "local"  # or "minio", "s3", "gcs", etc.
base_path = "/path/to/arc-data"

# For MinIO/S3
[storage.minio]
endpoint = "localhost:9000"
bucket = "arc-data"
access_key = "..."
secret_key = "..."
```

Each database should be a top-level directory in the `base_path` or bucket.

## Advanced: Creating New Databases

Arc creates databases automatically when you write data to them:

```python
# Python example using Arc client
import requests

# Write to a new database called "analytics"
requests.post('http://localhost:8000/write',
    data='cpu_usage,host=server1 value=50.0',
    params={'db': 'analytics'}
)
```

Or via VS Code extension:
1. Create a query:
   ```sql
   -- This will auto-create 'analytics' database
   CREATE TABLE analytics.events AS
   SELECT * FROM default.test_data LIMIT 0;
   ```

## SQL Database Operations

Arc supports these database-related SQL commands:

```sql
-- List all databases
SHOW DATABASES;

-- List tables in current database
SHOW TABLES;

-- List tables in specific database
SHOW TABLES FROM production;

-- Query with database prefix
SELECT * FROM production.api_requests;
SELECT * FROM default.cpu_metrics;

-- Cross-database join
SELECT *
FROM production.requests p
JOIN staging.tests t ON p.id = t.request_id;
```

## Next Steps

Once your databases are showing correctly:

1. **Bookmark frequently used queries** per database
2. **Create database-specific connections** if you work with one database at a time
3. **Use cross-database queries** to correlate data
4. **Monitor each database separately** using the health/metrics commands

## Need Help?

If databases still aren't showing:
1. Check Arc server logs for errors
2. Verify storage backend is accessible
3. Run `SHOW DATABASES;` directly in a query to see what Arc sees
4. Check file/bucket permissions
