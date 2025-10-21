# Arc Time-Series Database/Data Warehouse - Comprehensive Overview

## Project Summary

**Arc Core** is a high-performance time-series data warehouse built on DuckDB and Parquet with flexible storage options. It's written in **Python** and designed to be a drop-in replacement for InfluxDB while providing superior performance through columnar storage and advanced query capabilities.

**Performance:** 2.42M records/second (with authentication enabled)
**License:** AGPL-3.0
**Status:** Alpha Release - Technical Preview (not production-ready yet)

---

## 1. PROJECT STRUCTURE & MAIN COMPONENTS

### Directory Layout
```
arc/
├── api/                          # FastAPI REST API server
│   ├── main.py                   # Main application entry point
│   ├── auth.py                   # Token-based authentication
│   ├── msgpack_routes.py         # Binary MessagePack protocol
│   ├── line_protocol_routes.py   # InfluxDB Line Protocol
│   ├── duckdb_engine.py          # Query execution engine
│   ├── duckdb_pool.py            # Connection pooling
│   ├── query_cache.py            # Query result caching
│   ├── monitoring.py             # Metrics and monitoring
│   ├── database.py               # Connection management
│   ├── compaction_routes.py      # File compaction
│   ├── wal_routes.py             # Write-Ahead Log
│   ├── http_json_routes.py       # HTTP/JSON exporter
│   └── models.py                 # Pydantic validation models
├── ingest/                       # Data ingestion modules
│   ├── msgpack_decoder.py        # MessagePack parsing
│   ├── arrow_writer.py           # Direct Arrow→Parquet writer
│   ├── parquet_buffer.py         # Buffering system
│   ├── line_protocol_parser.py   # Line Protocol parsing
│   └── parquet_buffer_batched.py # Batched writes
├── exporter/                     # Data export/migration
│   ├── influx1x_exporter.py      # InfluxDB 1.x export
│   ├── influx2x_exporter.py      # InfluxDB 2.x export
│   ├── http_json_exporter.py     # HTTP/JSON export
│   └── timescale_exporter.py     # TimescaleDB export
├── storage/                      # Storage backends (inferred)
├── docs/                         # Architecture & design docs
│   ├── ARCHITECTURE.md
│   ├── COMPACTION.md
│   ├── WAL.md
│   ├── SECURITY.md
│   └── BENCHMARKS.md
├── config.py                     # Configuration management
├── config_loader.py              # TOML config loader
├── arc.conf                      # Main TOML configuration
├── requirements.txt              # Python dependencies
├── example.py                    # End-to-end example
└── examples/                     # Additional examples
    ├── query_arrow_pandas.py
    └── query_arrow_polars.py
```

---

## 2. PROGRAMMING LANGUAGES

- **Primary:** Python 3.11+
- **Performance Libraries:**
  - `uvloop` - 2-4x faster async event loop (Cython-based)
  - `httptools` - 40% faster HTTP parser
  - `orjson` - 20-50% faster JSON serialization (Rust + SIMD)
  - `msgpack` - Binary serialization for columnar protocol
  - `polars` - Fast data manipulation
  - `pyarrow` - Apache Arrow for columnar data
  - `duckdb` - SQL query engine
  - `minio` - S3-compatible storage client
  - `boto3` - AWS S3 client

---

## 3. API/INTERFACE - REST API (HTTP/HTTPS)

Arc uses **FastAPI** for HTTP REST API with the following interface layers:

### Base URL
```
http://localhost:8000
```

### Public Endpoints (No Authentication)
- `GET /` - API information
- `GET /health` - Service health check
- `GET /ready` - Readiness probe
- `GET /docs` - Swagger UI documentation
- `GET /redoc` - ReDoc documentation
- `GET /openapi.json` - OpenAPI specification

### Data Ingestion Endpoints

#### MessagePack Binary Protocol (RECOMMENDED - 2.32M RPS)
```
POST /write/v1/msgpack
POST /api/v1/msgpack
```

**Format:** Binary MessagePack payload
**Content-Type:** `application/msgpack`
**Supports:** Columnar or row format, optional gzip compression

**Columnar Format (Recommended):**
```json
{
    "m": "cpu",
    "columns": {
        "time": [1633024800000, 1633024801000],
        "host": ["server01", "server02"],
        "usage_idle": [95.0, 85.0]
    }
}
```

**Row Format (Legacy):**
```json
{
    "m": "cpu",
    "t": 1633024800000,
    "h": "server01",
    "fields": {"usage_idle": 95.0},
    "tags": {"region": "us-east"}
}
```

#### Line Protocol (InfluxDB Compatibility - 240K RPS)
```
POST /write
POST /api/v1/write
POST /api/v1/write/influxdb
```

**Format:** Text-based line protocol (InfluxDB 1.x/2.x compatible)
**Content-Type:** `text/plain`

**Example:**
```
cpu,host=server01,region=us-east usage_idle=95.0,usage_user=3.2 1633024800000000000
```

### Query Endpoints

#### SQL Query (JSON)
```
POST /query
```

**Request:**
```json
{
    "sql": "SELECT * FROM cpu WHERE host = 'server01'",
    "limit": 1000,
    "format": "json"
}
```

**Response:**
```json
{
    "success": true,
    "columns": ["time", "host", "usage_idle"],
    "data": [[1633024800000, "server01", 95.0]],
    "row_count": 1,
    "execution_time_ms": 45.2,
    "timestamp": "2025-10-20T12:00:00Z"
}
```

#### SQL Query (Apache Arrow - Columnar)
```
POST /query/arrow
```

**Response:** Apache Arrow IPC stream format (binary columnar)
- 7.36x faster for large result sets (100K+ rows)
- 43% smaller payloads vs JSON
- Zero-copy conversion to Pandas/Polars

#### Query Estimation
```
POST /query/estimate
```

#### Stream Large Results
```
POST /query/stream
```

#### List Measurements
```
GET /measurements
```

#### Query by Measurement
```
GET /query/{measurement}
GET /query/{measurement}/csv
```

### Authentication Endpoints

```
GET /auth/verify                  # Verify token validity
GET /auth/tokens                  # List all tokens
POST /auth/tokens                 # Create new token
GET /auth/tokens/{id}             # Get token details
PATCH /auth/tokens/{id}           # Update token
DELETE /auth/tokens/{id}          # Delete token
POST /auth/tokens/{id}/rotate     # Generate new token
GET /auth/cache/stats             # Cache statistics
POST /auth/cache/invalidate       # Clear token cache
```

### Health & Monitoring

```
GET /health                       # Service health
GET /ready                        # Readiness check
GET /metrics                      # Prometheus metrics
GET /metrics/timeseries/{type}   # Time-series metrics
GET /metrics/endpoints            # Endpoint stats
GET /metrics/query-pool           # Query pool status
GET /logs                         # Application logs
```

### Compaction Management

```
GET /api/compaction/status        # Current status
GET /api/compaction/stats         # Detailed statistics
GET /api/compaction/candidates    # Eligible partitions
POST /api/compaction/trigger      # Manual trigger
GET /api/compaction/jobs          # Active jobs
GET /api/compaction/history       # Job history
```

### Write-Ahead Log (WAL)

```
GET /api/wal/status               # WAL status
GET /api/wal/stats                # Statistics
GET /api/wal/files                # List WAL files
GET /api/wal/health               # Health check
POST /api/wal/cleanup             # Cleanup old files
```

---

## 4. AUTHENTICATION MECHANISM

### Token-Based Authentication

Arc uses **simple token-based authentication** (no RBAC):

#### Token Storage
- SQLite database: `./data/arc.db`
- Table: `api_tokens`
- Fields: `id, name, token_hash, description, created_at, last_used_at, enabled`

#### Token Format
- Secure random: `secrets.token_urlsafe(32)`
- Storage: SHA256 hashed
- Example: `random-base64-string-like-RK_2xK9pZ_L2mQvW3sT8uH1fG4jK5lM9n0`

#### Authentication Methods

**1. Bearer Token (Recommended)**
```bash
Authorization: Bearer YOUR_TOKEN_HERE
```

**2. API Key Header**
```bash
x-api-key: YOUR_TOKEN_HERE
```

**3. Token Prefix**
```bash
Authorization: Token YOUR_TOKEN_HERE
```

#### Token Management

**Create Token:**
```python
from api.auth import AuthManager

auth = AuthManager(db_path='./data/arc.db')
token = auth.create_token(name='my-app', description='My application')
print(f"Token: {token}")  # Only shown on creation
```

**List Tokens:**
```bash
curl http://localhost:8000/auth/tokens \
  -H "Authorization: Bearer $ARC_TOKEN"
```

**Response:**
```json
{
    "tokens": [
        {
            "id": 1,
            "name": "admin",
            "description": "Initial admin token",
            "created_at": "2025-10-20T12:00:00Z",
            "last_used_at": "2025-10-20T14:30:00Z",
            "enabled": true
        }
    ],
    "count": 1
}
```

**Revoke/Delete Token:**
```bash
DELETE /auth/tokens/{id}
```

**Rotate Token (Get New One):**
```bash
POST /auth/tokens/{id}/rotate
```

#### Token Caching

Arc includes intelligent token caching for minimal performance overhead:
- **Cache TTL:** 30 seconds (configurable via `AUTH_CACHE_TTL`)
- **Hit Rate:** 99.9%+ at 2.4M RPS workloads
- **Performance Impact:** +0.1ms overhead vs no auth
- **Manual Invalidation:** `POST /auth/cache/invalidate`

#### Initial Token Setup

On first run, Arc auto-generates an admin token:
```bash
# Docker
docker exec -it arc-api python3 -c "
from api.auth import AuthManager
auth = AuthManager(db_path='/data/arc.db')
token = auth.create_token('my-admin', description='Admin token')
print(f'Token: {token}')
"

# Native
source venv/bin/activate
python3 -c "
from api.auth import AuthManager
auth = AuthManager(db_path='./data/arc.db')
token = auth.create_token('my-admin', description='Admin token')
print(f'Token: {token}')
"
```

#### Security Configuration

In `arc.conf`:
```toml
[auth]
enabled = true
allowlist = "/health,/ready,/docs,/openapi.json,/auth/verify"
```

---

## 5. QUERY STRUCTURE & EXECUTION

### SQL Dialect

Arc uses **DuckDB SQL** (Postgres-compatible):

#### Basic SELECT
```sql
SELECT * FROM cpu 
WHERE host = 'server01' 
ORDER BY time DESC 
LIMIT 10
```

#### Time-Series Aggregation
```sql
SELECT
    time_bucket(INTERVAL '5 minutes', time) as bucket,
    host,
    AVG(usage_idle) as avg_idle,
    MAX(usage_user) as max_user
FROM cpu
WHERE time > now() - INTERVAL '1 hour'
GROUP BY bucket, host
ORDER BY bucket DESC
```

#### Window Functions
```sql
SELECT
    timestamp,
    host,
    usage_idle,
    AVG(usage_idle) OVER (
        PARTITION BY host
        ORDER BY timestamp
        ROWS BETWEEN 5 PRECEDING AND CURRENT ROW
    ) as moving_avg
FROM cpu
ORDER BY timestamp DESC
LIMIT 100
```

#### Cross-Measurement Joins
```sql
SELECT
    c.timestamp,
    c.host,
    c.usage_idle as cpu_idle,
    m.used_percent as mem_used
FROM cpu c
JOIN mem m ON c.timestamp = m.timestamp AND c.host = m.host
WHERE c.timestamp > now() - INTERVAL '10 minutes'
ORDER BY c.timestamp DESC
```

#### Multi-Database Queries
```sql
-- Query specific database
SELECT * FROM production.cpu 
WHERE timestamp > NOW() - INTERVAL 1 HOUR

-- Show databases
SHOW DATABASES

-- Show tables
SHOW TABLES
```

### Query Execution Flow

1. **Request arrives** at `/query` endpoint
2. **Authentication** verified via Bearer token
3. **Query validation** - checks for dangerous keywords
4. **Cache check** - look for cached result (60s TTL by default)
5. **DuckDB execution** - queries Parquet files from storage
6. **Result caching** - store successful results
7. **Response** - JSON or Arrow format

### Query Response Format

**JSON:**
```json
{
    "success": true,
    "columns": ["time", "host", "usage_idle"],
    "data": [
        [1633024800000, "server01", 95.0],
        [1633024801000, "server01", 94.5]
    ],
    "row_count": 2,
    "execution_time_ms": 45.2,
    "timestamp": "2025-10-20T12:00:00Z",
    "error": null
}
```

**Arrow (Binary Columnar):**
```
Apache Arrow IPC stream format
(import with: pa.ipc.open_stream(response.content))
```

### Query Configuration

In `arc.conf`:
```toml
[query_cache]
enabled = true
ttl_seconds = 60
max_size = 100
max_result_mb = 10

[duckdb]
pool_size = 5
max_queue_size = 100
enable_object_cache = true
```

---

## 6. EXISTING CLI TOOLS & CLIENT LIBRARIES

### Python Examples Provided

1. **Complete End-to-End Example** (`example.py`)
   - Write data via MessagePack
   - Query with aggregations
   - Multi-database operations
   - Shows token creation

2. **Arrow Query Example** (`examples/query_arrow_pandas.py`)
   - Query using Arrow format
   - Convert to Pandas DataFrame
   - Zero-copy columnar processing
   - Window functions example

3. **Arrow Polars Example** (`examples/query_arrow_polars.py`)
   - Query using Arrow format
   - Convert to Polars DataFrame
   - Even faster than Pandas

### No Built-In CLI Tool

Arc does NOT include a command-line tool - it's HTTP API first. However, you can use:

**curl for quick testing:**
```bash
# Write
curl -X POST http://localhost:8000/write/v1/msgpack \
  -H "Authorization: Bearer $ARC_TOKEN" \
  -H "Content-Type: application/msgpack" \
  --data-binary @payload.msgpack

# Query
curl -X POST http://localhost:8000/query \
  -H "Authorization: Bearer $ARC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM cpu"}'
```

**Python client (minimal):**
```python
import requests
import msgpack

token = "your-token"
headers = {"Authorization": f"Bearer {token}"}

# Write
data = {"m": "cpu", "columns": {...}}
requests.post(
    "http://localhost:8000/write/v1/msgpack",
    headers=headers,
    data=msgpack.packb(data)
)

# Query
response = requests.post(
    "http://localhost:8000/query",
    headers=headers,
    json={"sql": "SELECT * FROM cpu"}
)
print(response.json())
```

### Available Integrations

1. **Telegraf** - Drop-in InfluxDB replacement
2. **Apache Superset** - BI dashboards via SQL
3. **Apache Arrow** - Pandas/Polars compatibility
4. **InfluxDB Exporters** - Migrate from InfluxDB 1.x, 2.x, 3.x
5. **HTTP/JSON Exporter** - Generic webhook integration

---

## 7. CONFIGURATION FILES & SERVER ARCHITECTURE

### Main Configuration: arc.conf

**TOML Format** with environment variable overrides:

```toml
# Server Configuration
[server]
host = "0.0.0.0"
port = 8000
workers = 8                    # CPU count for optimal performance
worker_timeout = 120
graceful_shutdown = 60
max_requests = 50000

# Authentication
[auth]
enabled = true
default_token = ""             # Auto-generate on first run
allowlist = "/health,/ready,/docs,/openapi.json"

# Query Cache
[query_cache]
enabled = true
ttl_seconds = 60
max_size = 100
max_result_mb = 10

# DuckDB Query Engine
[duckdb]
pool_size = 5
max_queue_size = 100
enable_object_cache = true

# Data Ingestion
[ingestion]
buffer_size = 50000            # Records before flush
buffer_age_seconds = 5         # Seconds before flush
compression = "snappy"
wal_enabled = false

# Storage Backend (pick one)
[storage]
backend = "local"              # Options: local, minio, s3, gcs

[storage.local]
base_path = "./data/arc"
database = "default"

# Or MinIO (distributed)
# [storage]
# backend = "minio"
# [storage.minio]
# endpoint = "http://minio:9000"
# access_key = "minioadmin"
# secret_key = "minioadmin123"
# bucket = "arc"
# database = "default"

# File Compaction
[compaction]
enabled = true
min_age_hours = 1
min_files = 10
target_file_size_mb = 512
schedule = "5 * * * *"         # Cron: every hour at :05
max_concurrent_jobs = 2
compression = "zstd"

# Write-Ahead Log (Optional)
[wal]
enabled = false
sync_mode = "fdatasync"        # Options: fdatasync, fsync, async
dir = "./data/wal"
max_size_mb = 100
max_age_seconds = 3600
```

### Environment Variable Overrides

```bash
# Server
ARC_HOST=0.0.0.0
ARC_PORT=8000
ARC_WORKERS=8

# Storage
STORAGE_BACKEND=local
STORAGE_LOCAL_BASE_PATH=/data/arc

# Authentication
AUTH_ENABLED=true
AUTH_CACHE_TTL=30

# Query
QUERY_CACHE_TTL=60
DUCKDB_POOL_SIZE=5

# Logging
LOG_LEVEL=INFO
LOG_FORMAT=structured
```

### Server Architecture

#### Component Stack

```
Client (Python/JS/Telegraf)
    ↓ HTTP/HTTPS
FastAPI Application (Port 8000)
    ├── Auth Middleware → Token verification
    ├── CORS Middleware → Cross-origin support
    └── Rate Limiter → 100/minute default
        ↓
    Routers (Endpoints):
    ├── MessagePack Binary (write_msgpack)
    ├── Line Protocol (write_lineprotocol)
    ├── Query (execute_sql, execute_sql_arrow)
    ├── Auth (token management)
    └── Monitoring (health, metrics, logs)
        ↓
    Buffering & Processing:
    ├── ArrowParquetBuffer (Columnar - 2.32M RPS)
    ├── ParquetBuffer (Row format - 908K RPS)
    └── Write-Ahead Log (Optional durability)
        ↓
    Storage Backend (Pluggable):
    ├── Local Filesystem (2.32M RPS)
    ├── MinIO (S3-compatible, ~2.0M RPS)
    ├── AWS S3 (Cloud-native)
    └── Google Cloud Storage (Cloud-native)
        ↓
    Parquet Files (Columnar format)
    {storage}/{database}/{measurement}/{year}/{month}/{day}/{hour}/
        ↓
    Query Engine (DuckDB):
    ├── Connection Pool (5-10 connections)
    ├── Query Cache (60s TTL)
    ├── Metadata Cache (Parquet statistics)
    └── Parallel execution
```

#### Workers & Scaling

**Auto-Detection:**
```bash
./start.sh native  # Auto-detects CPU cores, sets workers = 3x cores
```

**Manual Configuration:**
```toml
[server]
workers = 16  # Recommended: 3-4x CPU cores for I/O-bound workloads
```

**Deployment Modes:**
- **Native:** 2.32M RPS (MacOS M3 Max measured)
- **Docker:** 570K RPS (~4x slower)

---

## 8. KEY CONCEPTS FOR VS CODE EXTENSION

### Multi-Database Architecture

Arc supports multiple isolated databases within one instance:

```
Storage Layout:
arc/
├── default/
│   ├── cpu/2025/01/15/14/
│   └── mem/2025/01/15/14/
├── production/
│   └── cpu/2025/01/15/14/
└── staging/
    └── cpu/2025/01/15/14/
```

**Usage:**
```python
# Write to specific database
headers = {
    "Authorization": f"Bearer {token}",
    "x-arc-database": "production"
}

# Query specific database
SELECT * FROM production.cpu
```

### High-Performance Data Ingestion

**Columnar Format (RECOMMENDED):**
- 2.32M records/second
- Zero-copy Arrow passthrough
- MessagePack binary protocol
- 78x lower p50 latency

**Row Format (Legacy):**
- 908K records/second
- 20-26x higher latency
- For compatibility only

### File Compaction

Automatic merging of small Parquet files:
- 2,704 files → 3 files (901x reduction)
- 80.4% compression ratio
- 100x faster queries after compaction

### Query Caching

- 60-second default TTL
- 99.9%+ hit rate at 2.4M RPS
- Configurable via `QUERY_CACHE_TTL`

---

## Summary for VS Code Extension

For building a VS Code extension to query Arc, you'll need:

### Essential Features
1. **Token Management**
   - Create/view/rotate/delete tokens
   - Store tokens securely
   - Test token validity

2. **Data Ingestion**
   - Support MessagePack columnar format (fastest)
   - Support Line Protocol (InfluxDB compatibility)
   - Real-time preview of ingestion stats

3. **Query Builder**
   - SQL editor with syntax highlighting
   - Auto-complete for measurements/columns
   - Query caching visualization
   - Result formatting (JSON, Arrow)
   - CSV export

4. **Monitoring**
   - Health check status
   - Query performance metrics
   - Token cache statistics
   - Buffer/compaction status

5. **Database Management**
   - List/switch between databases
   - Create new databases
   - View database statistics

### API Integration Points
- `POST /auth/tokens` - Create tokens
- `GET /auth/verify` - Validate tokens
- `POST /write/v1/msgpack` - Write columnar data
- `POST /query` - Execute SQL
- `POST /query/arrow` - Get columnar results
- `GET /measurements` - List tables
- `GET /health` - Service status
- `GET /metrics` - Performance metrics

