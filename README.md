# Arc Database Manager for VS Code

> Complete development toolkit for [Arc Database](https://github.com/basekick-labs/arc) - the high-performance time-series data warehouse.

[![Version](https://img.shields.io/badge/version-0.1.4-blue.svg)](https://marketplace.visualstudio.com/items?itemName=basekick-labs.arc-db-manager)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Features

### 🔌 Connection Management
- Multiple saved connections with secure token storage
- Quick connection switching
- Connection health monitoring
- Visual status indicators in sidebar and status bar

### 📊 Query Execution
- **SQL IntelliSense** with auto-completion for tables, columns, and DuckDB functions
- Execute queries with `Ctrl+Enter` / `Cmd+Enter`
- **Interactive results view** with:
  - Export to CSV, JSON, or Markdown
  - **Automatic chart visualization** for time-series data
  - Table sorting and filtering
  - Execution time and row count statistics

### 📓 Arc Notebooks
- **Mix SQL and Markdown** in a single document (`.arcnb` files)
- Execute cells individually or all at once
- **Parameterized queries** with variable substitution
- Export notebooks to Markdown with results
- Auto-save functionality

**Example Notebook:**
```markdown
# CPU Analysis

Variables:
- interval = 1 HOUR
- threshold = 80

SELECT AVG(usage_user) as avg_cpu
FROM telegraf.cpu
WHERE time > now() - INTERVAL ${interval}
  AND usage_user > ${threshold};
```

### 🗂️ Schema Explorer
- Browse databases and tables in sidebar
- **Right-click context menus** for:
  - Show table schema
  - Preview data (first 100 rows)
  - Show table statistics
  - Generate SELECT queries
  - Quick time filters (last hour, today)

### 📥 Data Ingestion
- **CSV Import** with guided wizard
  - Auto-detect delimiters and headers
  - Timestamp column selection
  - Batch processing for large files
  - Uses high-performance MessagePack columnar format
- **Bulk Data Generator** with 5 presets:
  - CPU Metrics
  - Memory Metrics
  - Network Metrics
  - IoT Sensor Data
  - Custom schemas

### 🔔 Alerting & Monitoring
- Create alerts based on query results
- **5 condition types**: greater than, less than, equals, not equals, contains
- Configurable check intervals (minimum 10 seconds)
- Desktop notifications when alerts trigger
- Alert history tracking
- Enable/disable alerts without deletion

**Example Alert:**
```
Name: High CPU Usage
Query: SELECT AVG(usage_user) FROM cpu WHERE time > now() - INTERVAL 5 MINUTE
Condition: greater_than
Threshold: 80
Interval: 60s
```

### 💾 Query Management
- **Automatic query history** - every query is logged
- **Saved queries** - bookmark frequently used queries
- View execution time, row counts, and errors
- Quick re-run from history

### 🔑 Token Management
- Create, rotate, and delete server tokens
- Verify token validity
- Secure storage in system keychain
- Visual token management in sidebar

### 🎨 Dark Mode Support
- **Automatic theme detection** - adapts to VS Code theme
- Works with Light, Dark, and High Contrast themes
- Theme-aware charts and visualizations
- No configuration needed

## Quick Start

### 1. Install the Extension
Search for "Arc Database Manager" in VS Code Extensions marketplace.

### 2. Connect to Arc Server
1. Click **"Arc: Not Connected"** in the status bar
2. Enter connection details:
   - Name: `My Arc Server`
   - Host: `localhost`
   - Port: `8000`
   - Protocol: `http` or `https`
3. Enter authentication token

### 3. Start Querying
- Press `Ctrl+Shift+P` → `Arc: New Query`
- Write your SQL query
- Press `Ctrl+Enter` / `Cmd+Enter` to execute

## Requirements

- **VS Code**: 1.85.0 or higher
- **Arc Database**: Running instance accessible via HTTP/HTTPS
- **Authentication Token**: From your Arc server

## Extension Settings

This extension contributes the following settings:

* `arc.defaultHost`: Default Arc server host (default: `localhost`)
* `arc.defaultPort`: Default Arc server port (default: `8000`)
* `arc.defaultProtocol`: Default protocol (default: `http`)

## Keyboard Shortcuts

| Command | Windows/Linux | macOS |
|---------|--------------|-------|
| Execute Query | `Ctrl+Enter` | `Cmd+Enter` |
| New Query | `Ctrl+Shift+P` → Arc: New Query | `Cmd+Shift+P` → Arc: New Query |

## Commands

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

**Connection:**
- `Arc: Connect to Server`
- `Arc: Disconnect`

**Queries:**
- `Arc: New Query`
- `Arc: Execute Query`
- `Arc: Save Current Query`

**Notebooks:**
- `Arc: New Notebook`

**Data:**
- `Arc: Import CSV`
- `Arc: Generate Test Data`

**Alerts:**
- `Arc: Create Alert`

**Explorer:**
- `Arc: Refresh Explorer`
- `Arc: Show Table Schema`
- `Arc: Preview Table Data`

[See full command list in documentation](FEATURES.md)

## Use Cases

### Development & Testing
```sql
-- Generate test data
Arc: Generate Test Data → CPU Metrics → 100,000 rows

-- Query the data
SELECT
  time_bucket('5 minutes', time) as bucket,
  AVG(usage_user) as avg_cpu
FROM telegraf.cpu
WHERE time > now() - INTERVAL 1 HOUR
GROUP BY bucket
ORDER BY bucket DESC;
```

### Data Analysis in Notebooks
Create `.arcnb` files with:
- Documentation in Markdown
- Parameterized SQL queries
- Inline results and visualizations
- Export to Markdown reports

### Production Monitoring
```
Alert: High Memory Usage
Query: SELECT AVG(used_percent) FROM mem WHERE time > now() - INTERVAL 5 MINUTE
Condition: > 90
Interval: 60s
→ Get notified when memory exceeds 90%
```

### Data Migration
```
Arc: Import CSV
→ Select your CSV file
→ Configure mapping
→ Import directly to Arc
```

## Performance

- **Query Results**: Displays up to 1,000 rows instantly
- **CSV Import**: ~50,000-100,000 rows/second using MessagePack columnar format
- **Data Generator**: ~100,000-200,000 rows/second
- **Batch Processing**: Handles millions of rows with progress tracking

## Documentation

- **[Complete Feature Guide](FEATURES.md)** - All features with examples
- **[Dark Mode Guide](DARK_MODE.md)** - Theme customization
- **[Arc Database Docs](https://github.com/basekick-labs/arc)** - Main Arc documentation

## Examples

### Time-Series Analysis
```sql
-- 5-minute moving average
SELECT
  time,
  usage_user,
  AVG(usage_user) OVER (
    ORDER BY time
    ROWS BETWEEN 5 PRECEDING AND CURRENT ROW
  ) as moving_avg
FROM telegraf.cpu
WHERE host = 'server01'
  AND time > now() - INTERVAL 24 HOUR
ORDER BY time DESC;
```

### Parameterized Notebook Query
```markdown
Variables:
- database = telegraf
- measurement = cpu
- interval = 6 HOUR

SELECT * FROM ${database}.${measurement}
WHERE time > now() - INTERVAL ${interval}
LIMIT 100;
```

## Troubleshooting

### Cannot connect to Arc server
1. Verify Arc is running: `curl http://localhost:8000/health`
2. Check host and port are correct
3. Ensure token is valid: Run `Arc: Verify Token`

### Query timeout
1. Add time filters: `WHERE time > now() - INTERVAL 1 HOUR`
2. Add `LIMIT` clause
3. Check Arc server performance

### Import fails
1. Verify CSV encoding is UTF-8
2. Check delimiter is correct
3. Try smaller file first to test

[More troubleshooting](FEATURES.md#troubleshooting)

## Release Notes

### 0.1.4 - Latest

**New Features:**
- ✨ Parameterized queries with variables in notebooks
- ✨ CSV import with MessagePack columnar format
- ✨ Bulk data generator with 5 presets
- ✨ Alerting and monitoring system
- ✨ Notebook export to Markdown
- ✨ Dark mode support

**Improvements:**
- 🚀 25-35% faster data ingestion
- 🎨 Enhanced notebook UI
- 📊 Auto-chart detection
- 🔔 Desktop notifications

**Bug Fixes:**
- 🐛 Fixed schema queries
- 🐛 Fixed notebook cell editing
- 🐛 Improved error handling

## Support

- **Documentation**: [Feature Guide](FEATURES.md)
- **Issues**: [GitHub Issues](https://github.com/basekick-labs/arc-vscode-extension/issues)
- **Discussions**: [GitHub Discussions](https://github.com/basekick-labs/arc/discussions)

## License

[MIT License](LICENSE)

---

**Enjoy using Arc Database Manager!** ⚡

Made with ❤️ by [Basekick Labs](https://github.com/basekick-labs)
