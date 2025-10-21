# Arc Core - Key Source Files Reference

This document maps Arc's key functionality to source files in the project.

## Core Files

### API Entry Point & Routing
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/main.py` (77KB)
- **Contains:**
  - FastAPI application initialization
  - All HTTP endpoint definitions
  - Request/response handling
  - Query execution endpoints (`/query`, `/query/arrow`, `/query/stream`)
  - Auth endpoints (`/auth/tokens`, `/auth/verify`)
  - Health check endpoints
  - Metrics endpoints
  - Database/measurement endpoints

### Authentication System
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/auth.py` (12KB)
- **Contains:**
  - `AuthManager` class - Token creation, verification, caching
  - `AuthMiddleware` - HTTP middleware for request auth
  - Token storage (SQLite hashed tokens)
  - Token cache with TTL (30 second default)
  - Cache statistics
  - Methods: `create_token()`, `verify_token()`, `list_tokens()`, `revoke_token()`

### Data Models & Validation
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/models.py` (15KB)
- **Contains:**
  - Pydantic models for request/response validation
  - `QueryRequest` - SQL query parameters
  - `QueryResponse` - Query results format
  - `TokenCreateRequest`, `TokenResponse` - Token management models
  - `InfluxDBConnectionCreate`, `StorageConnectionCreate` - Connection models
  - Enum definitions (InfluxVersionEnum, StorageBackendEnum, JobTypeEnum)

### Query Engine
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/duckdb_engine.py` (50KB)
- **Contains:**
  - `DuckDBEngine` class - Main query execution
  - Connection pool management
  - S3/MinIO/GCS configuration for backends
  - Query execution methods
  - Storage backend initialization
  - Database/table discovery

### Query Connection Pooling
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/duckdb_pool.py` (25KB)
- **Contains:**
  - `DuckDBConnectionPool` class
  - Connection lifecycle management
  - Queue management for queries
  - Health checks
  - Priority handling

### Query Result Caching
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/query_cache.py` (11KB)
- **Contains:**
  - `QueryCache` class
  - Cache hit/miss tracking
  - TTL-based expiration
  - Memory management for large results
  - Cache statistics

### MessagePack Binary Protocol (RECOMMENDED)
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/msgpack_routes.py` (9KB)
- **Contains:**
  - `/write/v1/msgpack` endpoint
  - Columnar format support (2.32M RPS)
  - Row format support (legacy, 908K RPS)
  - Gzip decompression
  - `init_arrow_buffer()`, `start_arrow_buffer()`, `stop_arrow_buffer()`
  - Stats and specification endpoints

### Line Protocol API (InfluxDB Compatibility)
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/line_protocol_routes.py` (14KB)
- **Contains:**
  - `/write`, `/api/v1/write` endpoints
  - InfluxDB 1.x and 2.x compatibility
  - Record merging logic
  - Gzip decompression
  - Telegraf integration support

---

## Data Ingestion

### MessagePack Decoder
- **File:** `/Users/nacho/dev/basekick-labs/arc/ingest/msgpack_decoder.py` (9KB)
- **Contains:**
  - `MessagePackDecoder` class
  - Columnar format parsing
  - Row format parsing
  - Batch format handling
  - Validation and error handling

### Arrow Parquet Writer
- **File:** `/Users/nacho/dev/basekick-labs/arc/ingest/arrow_writer.py` (24KB)
- **Contains:**
  - `ArrowParquetBuffer` class - Direct Arrow to Parquet
  - Columnar data buffering
  - Zero-copy passthrough optimization
  - WAL integration
  - Automatic flushing
  - Performance: 2.32M RPS columnar, 908K RPS row format

### Line Protocol Parser
- **File:** `/Users/nacho/dev/basekick-labs/arc/ingest/line_protocol_parser.py` (12KB)
- **Contains:**
  - `LineProtocolParser` class
  - Telegraf compatibility
  - Tag/field parsing
  - Timestamp handling
  - Error handling for malformed lines

### Parquet Buffer
- **File:** `/Users/nacho/dev/basekick-labs/arc/ingest/parquet_buffer.py` (13KB)
- **Contains:**
  - `ParquetBuffer` class - Buffering for row format
  - DataFrame creation
  - Parquet file writing
  - Memory management

---

## Storage & Configuration

### Configuration Loader
- **File:** `/Users/nacho/dev/basekick-labs/arc/config_loader.py` (12KB)
- **Contains:**
  - TOML configuration parsing
  - Environment variable overrides
  - Settings validation
  - Defaults for all parameters

### Configuration File
- **File:** `/Users/nacho/dev/basekick-labs/arc/arc.conf` (10KB)
- **Contains:**
  - Server configuration (host, port, workers, timeouts)
  - Authentication settings
  - Query cache settings
  - DuckDB pool configuration
  - Ingestion buffer settings
  - Storage backend configuration (local, MinIO, S3, GCS)
  - File compaction settings
  - Write-Ahead Log (WAL) settings

### Database Connection Manager
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/database.py` (39KB)
- **Contains:**
  - `ConnectionManager` class
  - InfluxDB connection management
  - Storage backend connections
  - Connection pooling
  - Connection testing

---

## Export & Integration

### InfluxDB 1.x Exporter
- **File:** `/Users/nacho/dev/basekick-labs/arc/exporter/influx1x_exporter.py` (21KB)
- **Contains:**
  - Migration from InfluxDB 1.x to Arc
  - Data export logic

### InfluxDB 2.x Exporter
- **File:** `/Users/nacho/dev/basekick-labs/arc/exporter/influx2x_exporter.py` (5KB)
- **Contains:**
  - Migration from InfluxDB 2.x to Arc

### HTTP/JSON Exporter
- **File:** `/Users/nacho/dev/basekick-labs/arc/exporter/http_json_exporter.py` (21KB)
- **Contains:**
  - HTTP webhook exports
  - JSON payload formatting

### TimescaleDB Exporter
- **File:** `/Users/nacho/dev/basekick-labs/arc/exporter/timescale_exporter.py` (7KB)
- **Contains:**
  - Migration from TimescaleDB to Arc

---

## Monitoring & Operations

### Compaction Routes
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/compaction_routes.py` (3KB)
- **Contains:**
  - `/api/compaction/status` - Current status
  - `/api/compaction/stats` - Statistics
  - `/api/compaction/trigger` - Manual trigger
  - Compaction job management

### Write-Ahead Log Routes
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/wal_routes.py` (10KB)
- **Contains:**
  - `/api/wal/status` - WAL status
  - `/api/wal/stats` - Statistics
  - WAL file management
  - Recovery procedures

### Monitoring
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/monitoring.py` (16KB)
- **Contains:**
  - Metrics collection
  - Performance tracking
  - Endpoint statistics
  - Query pool monitoring
  - Memory profiling

### Logging
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/logging_config.py` (9KB)
- **Contains:**
  - Structured logging setup
  - Request ID middleware
  - API call logging
  - Query execution logging

### HTTP/JSON Routes
- **File:** `/Users/nacho/dev/basekick-labs/arc/api/http_json_routes.py` (13KB)
- **Contains:**
  - HTTP/JSON export endpoints

---

## Examples & Documentation

### Complete End-to-End Example
- **File:** `/Users/nacho/dev/basekick-labs/arc/example.py` (6KB)
- **Contains:**
  - Token creation
  - Writing data via MessagePack
  - Querying data
  - Multi-database operations
  - Aggregations example

### Arrow Query with Pandas
- **File:** `/Users/nacho/dev/basekick-labs/arc/examples/query_arrow_pandas.py`
- **Contains:**
  - Arrow format querying
  - Pandas DataFrame conversion
  - Zero-copy operations
  - Window functions example
  - Cross-measurement joins

### Arrow Query with Polars
- **File:** `/Users/nacho/dev/basekick-labs/arc/examples/query_arrow_polars.py`
- **Contains:**
  - Arrow format querying
  - Polars DataFrame conversion
  - High-performance analytics

### Architecture Documentation
- **File:** `/Users/nacho/dev/basekick-labs/arc/docs/ARCHITECTURE.md` (32KB)
- **Contains:**
  - Detailed system design
  - Data flow diagrams
  - Buffering system explanation
  - WAL explanation
  - Storage layout
  - Multi-database architecture
  - Compaction system
  - Schema management
  - Performance tuning

### Compaction Documentation
- **File:** `/Users/nacho/dev/basekick-labs/arc/docs/COMPACTION.md` (25KB)
- **Contains:**
  - Why compaction matters
  - How it works
  - Configuration options
  - Monitoring
  - Real-world impact

### WAL Documentation
- **File:** `/Users/nacho/dev/basekick-labs/arc/docs/WAL.md` (20KB)
- **Contains:**
  - Write-Ahead Log design
  - Durability guarantees
  - Performance impact
  - Configuration
  - Recovery procedures

### Security Documentation
- **File:** `/Users/nacho/dev/basekick-labs/arc/docs/SECURITY.md` (9KB)
- **Contains:**
  - Authentication mechanisms
  - Token security
  - Performance implications

### Benchmarks
- **File:** `/Users/nacho/dev/basekick-labs/arc/docs/BENCHMARKS.md` (14KB)
- **Contains:**
  - ClickBench results
  - Write performance benchmarks
  - Query performance metrics

---

## Key Dependencies

### requirements.txt
- **File:** `/Users/nacho/dev/basekick-labs/arc/requirements.txt`
- **Key packages:**
  - `fastapi==0.119.0` - Web framework
  - `uvicorn[standard]==0.37.0` - ASGI server
  - `duckdb==1.4.1` - Query engine
  - `polars==1.34.0` - Data manipulation
  - `pyarrow==21.0.0` - Arrow support
  - `msgpack==1.1.2` - Binary protocol
  - `boto3`, `minio`, `google-cloud-storage` - Storage backends
  - `uvloop==0.21.0` - 2-4x faster event loop
  - `httptools==0.6.4` - 40% faster HTTP parser
  - `orjson==3.10.13` - 20-50% faster JSON

---

## File Statistics

| Module | Location | Size | Purpose |
|--------|----------|------|---------|
| Main API | api/main.py | 77KB | All HTTP endpoints |
| Auth | api/auth.py | 12KB | Token authentication |
| Query Engine | api/duckdb_engine.py | 50KB | SQL execution |
| Models | api/models.py | 15KB | Data validation |
| MessagePack | api/msgpack_routes.py | 9KB | Binary protocol |
| Arrow Writer | ingest/arrow_writer.py | 24KB | Direct Arrow→Parquet |
| Configuration | config_loader.py | 12KB | TOML config parsing |

---

## Quick Navigation

### For Token Management
- Go to: `api/auth.py`
- Key class: `AuthManager`
- Key methods: `create_token()`, `verify_token()`, `list_tokens()`

### For Data Writes
- MessagePack (FASTEST): `api/msgpack_routes.py` + `ingest/arrow_writer.py`
- Line Protocol: `api/line_protocol_routes.py` + `ingest/line_protocol_parser.py`
- Row format: `ingest/parquet_buffer.py`

### For Queries
- Main execution: `api/duckdb_engine.py`
- Connection pooling: `api/duckdb_pool.py`
- Result caching: `api/query_cache.py`
- Arrow output: `api/main.py` - `execute_sql_arrow()`

### For Configuration
- File format: `arc.conf` (TOML)
- Loader: `config_loader.py`
- API routes: `api/main.py` - startup event

### For Monitoring
- Metrics: `api/monitoring.py`
- Status: `api/main.py` - health/readiness endpoints
- Logs: `api/logging_config.py`

