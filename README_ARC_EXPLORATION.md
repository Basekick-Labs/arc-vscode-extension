# Arc Core Exploration - Complete Analysis

This folder contains comprehensive documentation for understanding Arc Core, a high-performance time-series data warehouse built with Python, FastAPI, DuckDB, and Parquet.

## Documentation Files

### 1. ARC_PROJECT_SUMMARY.md (830 lines)
**The main reference document** - Start here for complete overview.

Contains:
- Project summary and capabilities
- Project structure and components
- Programming languages and tech stack
- Complete REST API reference
- Authentication mechanism details
- Query structure and execution
- Configuration files and server architecture
- Key concepts for extension development

**Sections:**
1. Project Structure
2. Programming Languages
3. API/Interface (REST)
4. Authentication (Token-based)
5. Query Execution (DuckDB SQL)
6. CLI Tools & Client Libraries
7. Configuration & Server Architecture
8. Key Concepts for VS Code Extension

### 2. ARC_VSCODE_INTEGRATION_GUIDE.md
**Practical code examples** - Use this for actual implementation.

Contains JavaScript/TypeScript code patterns for:
- Token management (create, store, validate)
- Data ingestion (MessagePack columnar, row format, Line Protocol)
- Query execution (JSON, Arrow columnar format)
- Database management
- Monitoring and status
- VS Code UI components
- Error handling and retry logic
- Configuration storage

**Complete working examples for:**
- Authentication token handling
- Writing 2.32M RPS columnar data
- Executing SQL queries
- Arrow columnar result processing
- Database listing and switching
- Health checks and metrics

### 3. ARC_KEY_FILES_REFERENCE.md
**Source file navigation** - Maps functionality to actual code.

Contains file-by-file reference:
- Core API files (`main.py`, `auth.py`, `models.py`)
- Query execution (`duckdb_engine.py`, `duckdb_pool.py`, `query_cache.py`)
- Data ingestion (MessagePack, Line Protocol, Arrow)
- Storage and configuration
- Export and integration modules
- Monitoring and operations
- Examples and documentation
- Quick navigation index

---

## Quick Start for VS Code Extension Development

### Essential API Endpoints

**Authentication:**
```bash
POST /auth/tokens                 # Create token
GET /auth/verify                  # Verify token
DELETE /auth/tokens/{id}          # Delete token
```

**Data Ingestion:**
```bash
POST /write/v1/msgpack            # Columnar binary (FASTEST: 2.32M RPS)
POST /write                       # Line Protocol (240K RPS)
```

**Queries:**
```bash
POST /query                       # SQL to JSON
POST /query/arrow                 # SQL to Arrow (columnar)
GET /measurements                 # List tables
```

**Management:**
```bash
GET /health                       # Health check
GET /auth/cache/stats             # Token cache stats
GET /metrics                      # Performance metrics
```

### Key Technologies

| Component | Technology | Performance |
|-----------|-----------|-------------|
| API Server | FastAPI + Uvicorn | 2.42M RPS auth-enabled |
| Query Engine | DuckDB | 4.4M rows/sec (M3 Max) |
| Storage | Parquet columnar | 80% compression |
| Binary Protocol | MessagePack | 2.32M RPS (columnar) |
| Fast JSON | orjson | 20-50% faster |
| Fast Loop | uvloop | 2-4x faster |

### Authentication Overview

- **Type:** Simple token-based (no RBAC)
- **Storage:** SQLite hashed tokens
- **Format:** `Authorization: Bearer <token>`
- **Cache:** 30-second TTL, 99.9% hit rate
- **Performance Impact:** +0.1ms overhead

### Database Architecture

- **Multi-tenancy:** Support multiple isolated databases
- **Organization:** `{storage}/{database}/{measurement}/{year}/{month}/{day}/{hour}/`
- **Query across databases:** `SELECT * FROM production.cpu`
- **Default:** Named "default", customizable

---

## For VS Code Extension: Essential Integrations

### 1. Token Management Interface
- Store tokens in VS Code secrets
- Create new tokens via Arc API
- List available tokens
- Validate token on connection

### 2. Query Interface
- SQL editor with syntax highlighting
- Execute queries (JSON or Arrow)
- Display results in tables/charts
- Export to CSV
- Query caching visibility

### 3. Data Ingestion
- Push test data via MessagePack (fastest)
- Support columnar format (2.55x faster)
- Real-time ingestion stats

### 4. Database Management
- List/switch databases
- Show available measurements
- View table schemas

### 5. Monitoring
- Health check status
- Query performance metrics
- Cache hit rates
- Buffer status

---

## Arc Core Key Facts

### Performance
- **2.42M records/second** (MessagePack columnar with auth)
- **2.32M RPS native** vs 570K RPS Docker (4.1x faster)
- **2.55x faster** columnar vs row format
- **7.36x faster** Arrow vs JSON for large results

### Storage
- **Columnar format:** Parquet with Snappy/ZSTD compression
- **Multi-backend:** Local, MinIO, AWS S3, Google Cloud Storage
- **Automatic compaction:** 2,704 files → 3 files (901x reduction)

### Query Engine
- **DuckDB SQL:** Postgres-compatible SQL
- **Window functions, time_bucket, aggregations**
- **Connection pooling:** 5-10 connections per worker
- **Result caching:** 60-second TTL default

### Ingestion Formats
1. **MessagePack Columnar** (RECOMMENDED): 2.32M RPS, zero-copy
2. **MessagePack Row**: 908K RPS, for compatibility
3. **Line Protocol**: 240K RPS, InfluxDB compatibility

### Configuration
- **TOML format:** `arc.conf` (clean, organized)
- **Environment overrides:** `ARC_WORKERS=8` overrides config
- **Auto-scaling:** `workers = 3x CPU cores` recommended
- **Optional durability:** Write-Ahead Log (WAL) configurable

---

## Project Status

- **State:** Alpha Release - Technical Preview
- **Language:** Python 3.11+
- **License:** AGPL-3.0
- **Status:** Not production-ready yet, evolving rapidly
- **Performance:** Stable at 2.42M RPS
- **Recommendation:** Use for development/testing, not production

---

## File Reference Summary

| Document | Purpose | Length |
|----------|---------|--------|
| ARC_PROJECT_SUMMARY.md | Complete overview | 830 lines |
| ARC_VSCODE_INTEGRATION_GUIDE.md | Code examples | ~500 lines |
| ARC_KEY_FILES_REFERENCE.md | File navigation | ~300 lines |
| README_ARC_EXPLORATION.md | This index | Navigation |

---

## Next Steps for Extension Development

1. **Start with ARC_PROJECT_SUMMARY.md** - Understand overall architecture
2. **Review ARC_VSCODE_INTEGRATION_GUIDE.md** - Study code examples
3. **Reference ARC_KEY_FILES_REFERENCE.md** - Navigate Arc source code
4. **Implement features in priority:**
   - Token management
   - Query interface
   - Data ingestion
   - Monitoring

---

## Key Source Files in Arc

All paths relative to `/Users/nacho/dev/basekick-labs/arc/`:

### Must-Read Core Files
- `api/main.py` (77KB) - All endpoints
- `api/auth.py` (12KB) - Token authentication
- `api/msgpack_routes.py` (9KB) - Binary protocol
- `ingest/arrow_writer.py` (24KB) - Zero-copy Arrow→Parquet

### Configuration
- `arc.conf` - TOML configuration
- `config_loader.py` - Config parsing

### Documentation
- `docs/ARCHITECTURE.md` - System design
- `docs/WAL.md` - Durability
- `docs/COMPACTION.md` - Query optimization
- `README.md` - Full documentation

### Examples
- `example.py` - End-to-end example
- `examples/query_arrow_pandas.py` - Arrow integration

---

## Arc Core REST API Quick Reference

### Base URL
```
http://localhost:8000
```

### Authentication Header
```
Authorization: Bearer YOUR_TOKEN_HERE
```

### High-Throughput Write
```bash
POST /write/v1/msgpack
Content-Type: application/msgpack

# Columnar format (2.32M RPS)
{
    "m": "cpu",
    "columns": {
        "time": [...],
        "host": [...],
        "usage_idle": [...]
    }
}
```

### Query
```bash
POST /query
Content-Type: application/json

{
    "sql": "SELECT * FROM cpu WHERE host = 'server01'",
    "limit": 1000,
    "format": "json"
}
```

### Arrow Query (Columnar)
```bash
POST /query/arrow

{
    "sql": "SELECT * FROM cpu LIMIT 100000"
}
# Response: Apache Arrow IPC stream (binary columnar)
```

---

## Contact & Resources

- **GitHub:** https://github.com/basekick-labs/arc-core
- **Discord:** https://discord.gg/nxnWfUxsdm
- **License:** AGPL-3.0
- **Status:** Active development, alpha release

