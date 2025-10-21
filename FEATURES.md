# Arc VS Code Extension - Feature Documentation

## Table of Contents
1. [Overview](#overview)
2. [Connection Management](#connection-management)
3. [Query Execution](#query-execution)
4. [Schema Explorer](#schema-explorer)
5. [Query History & Saved Queries](#query-history--saved-queries)
6. [Arc Notebooks](#arc-notebooks)
7. [Parameterized Queries](#parameterized-queries)
8. [Data Ingestion](#data-ingestion)
9. [Alerting & Monitoring](#alerting--monitoring)
10. [Token Management](#token-management)

---

## Overview

The Arc VS Code Extension is a comprehensive development tool for Arc Database that provides:

- Visual database exploration
- SQL query execution with IntelliSense
- Notebook-style query development
- Data import/export capabilities
- Real-time alerting and monitoring
- Secure token management

---

## Connection Management

### Connecting to Arc Server

**Command:** `Arc: Connect` or click the status bar

1. Click the **Arc: Not Connected** status bar item (bottom left)
2. Enter connection details:
   - **Connection name**: A friendly name (e.g., "Production Arc")
   - **Host**: Server hostname or IP (e.g., `localhost` or `arc.example.com`)
   - **Port**: Server port (default: `8000`)
   - **Protocol**: Select `http` or `https`
3. Enter or create an authentication token

**Example:**
```
Name: My Arc Server
Host: localhost
Port: 8000
Protocol: http
Token: SUrawdObUZ4ocyvFd46Y0hAeIIdr6KrikK7TEX-tXyE
```

### Managing Multiple Connections

The extension supports multiple saved connections.

**To add a new connection:**
- Run `Arc: Connect` command
- Fill in the connection details
- The connection is automatically saved

**To switch between connections:**
1. Open the **Arc Connections** view in the sidebar
2. Click on a connection to activate it
3. The active connection shows a green checkmark (✓)

**To edit a connection:**
- Right-click the connection in **Arc Connections** view
- Select **Edit Connection**
- Update the details

**To delete a connection:**
- Right-click the connection
- Select **Delete Connection**
- Confirm the deletion

---

## Query Execution

### Writing SQL Queries

**Method 1: New Query File**
1. Run command: `Arc: New Query`
2. A new `.arcsql` file opens
3. Write your SQL query
4. Press `Ctrl+Enter` (Windows/Linux) or `Cmd+Enter` (Mac) to execute

**Method 2: From Editor**
- Create a new file with `.sql` or `.arcsql` extension
- Write SQL query
- Use `Ctrl+Enter` / `Cmd+Enter` to execute

**Example Query:**
```sql
SELECT
  time_bucket('5 minutes', time) as bucket,
  host,
  AVG(usage_user) as avg_cpu,
  MAX(usage_user) as max_cpu
FROM telegraf.cpu
WHERE time > now() - INTERVAL 1 HOUR
GROUP BY bucket, host
ORDER BY bucket DESC;
```

### Query Results

Results appear in a dedicated webview panel with:

- **Table view** of results (first 1000 rows)
- **Row count** and **execution time** statistics
- **Export options**: CSV, JSON, Markdown
- **Chart visualization** (auto-detected for time-series data)

**Export Results:**
1. Click **Export CSV**, **Export JSON**, or **Copy as Markdown**
2. Select save location
3. File is saved with formatted data

**Chart Visualization:**
- Automatically detects time-series data
- Creates line charts for time-based queries
- Falls back to bar charts for other numeric data
- Toggle chart visibility with **Show/Hide Chart** button

---

## Schema Explorer

The **Arc Explorer** view shows your database structure.

### Browsing Databases and Tables

**View Structure:**
```
📁 Arc Explorer
  └─ 📊 telegraf (database)
      ├─ 📋 cpu (table)
      ├─ 📋 mem (table)
      └─ 📋 disk (table)
```

### Table Operations

**Right-click any table to access:**

1. **Show Table Schema**
   - Displays column names and data types
   - Shows sample data
   - Example output:
   ```
   Column: time | Type: TIMESTAMP
   Column: host | Type: VARCHAR
   Column: usage_user | Type: DOUBLE
   Column: usage_system | Type: DOUBLE
   ```

2. **Preview Table Data**
   - Shows first 100 rows
   - Quick data inspection

3. **Show Table Statistics**
   - Total row count
   - Column count
   - Table size information

4. **Generate SELECT Query**
   - Automatically creates a SELECT statement
   - Opens in new editor
   - Example:
   ```sql
   SELECT * FROM telegraf.cpu LIMIT 100;
   ```

5. **Quick Time Filters**
   - **Query Last Hour**: Pre-filtered for last 60 minutes
   - **Query Today**: Pre-filtered for today's data
   - Automatically adds WHERE clause with time filter

---

## Query History & Saved Queries

### Query History

Every executed query is automatically saved to history.

**View History:**
1. Open **Arc Queries** view in sidebar
2. Expand **Query History** section
3. Click any query to open it in editor

**History includes:**
- Query text
- Execution timestamp
- Execution time (ms)
- Row count
- Success/failure status
- Error message (if failed)

**Clear History:**
- Right-click on **Query History**
- Select **Clear Query History**

### Saved Queries (Bookmarks)

Save frequently used queries for quick access.

**Save Current Query:**
1. Open a query in editor
2. Run command: `Arc: Save Current Query`
3. Enter a name for the query
4. Query appears in **Saved Queries** section

**Example Saved Query:**
```
Name: "CPU Usage Last 24h"
Query: SELECT time, host, usage_user
       FROM telegraf.cpu
       WHERE time > now() - INTERVAL 24 HOUR;
```

**Manage Saved Queries:**
- **Open**: Click the query in the tree view
- **Rename**: Right-click → Rename Saved Query
- **Delete**: Right-click → Delete Saved Query

---

## Arc Notebooks

Notebooks combine **markdown documentation** with **executable SQL queries** in a single file.

### Creating a Notebook

**Command:** `Arc: New Notebook`

1. Run the command
2. Choose save location
3. File is created with `.arcnb` extension
4. Notebook editor opens automatically

### Notebook Structure

A notebook consists of **cells**:

- **Markdown cells**: Documentation, notes, explanations
- **SQL cells**: Executable queries with results

**Example Notebook:**
```
[Markdown Cell]
# CPU Analysis Report
This notebook analyzes CPU usage patterns across our infrastructure.

[SQL Cell]
SELECT host, AVG(usage_user) as avg_cpu
FROM telegraf.cpu
WHERE time > now() - INTERVAL 1 HOUR
GROUP BY host;

[Results displayed inline]

[Markdown Cell]
## Observations
- Server01 shows 45% average CPU
- Server02 shows 78% average CPU (investigate)
```

### Working with Cells

**Add a new cell:**
- Click **+ Markdown Cell** or **+ SQL Cell** at the top

**Edit a cell:**
- Click inside the cell text area
- Type your content
- Changes auto-save after 500ms

**Run a SQL cell:**
- Click the **▶️ Run** button on the cell
- Results appear below the cell

**Run all SQL cells:**
- Click **▶️ Run All SQL Cells** at the top
- Cells execute sequentially
- Results update for each cell

**Delete a cell:**
- Click the **🗑️ Delete** button on the cell
- Confirm deletion

### Exporting Notebooks

**Export to Markdown:**
1. Click **📄 Export to Markdown** button
2. Choose save location
3. Markdown file includes:
   - All markdown content
   - SQL queries in code blocks
   - Query results as formatted tables
   - Execution statistics

**Exported Format:**
```markdown
# Arc Notebook Export

This is a markdown cell.

## SQL Query

```sql
SELECT * FROM telegraf.cpu LIMIT 10;
```

**Results:**

| time | host | usage_user |
| --- | --- | --- |
| 2024-10-20 10:00:00 | server01 | 45.2 |

*10 rows in 23.45ms*
```

---

## Parameterized Queries

Use variables in notebooks to create reusable, parameterized queries.

### Defining Variables

At the top of every notebook, there's a **Variables** section.

**Add a variable:**
1. Click **+ Add Variable**
2. Enter variable name (e.g., `table_name`)
3. Enter value (e.g., `cpu`)

**Example Variables:**
```
Variable Name: table_name  | Value: cpu
Variable Name: min_usage   | Value: 80
Variable Name: host        | Value: server01
Variable Name: interval    | Value: 1 HOUR
```

### Using Variables in Queries

Reference variables using `${variableName}` syntax.

**Example:**
```sql
-- Variables defined:
-- table_name = cpu
-- min_usage = 80
-- host = server01

SELECT
  time,
  host,
  usage_user
FROM telegraf.${table_name}
WHERE host = ${host}
  AND usage_user > ${min_usage}
  AND time > now() - INTERVAL 1 HOUR;
```

**After substitution (automatically):**
```sql
SELECT
  time,
  host,
  usage_user
FROM telegraf.'cpu'
WHERE host = 'server01'
  AND usage_user > 80
  AND time > now() - INTERVAL 1 HOUR;
```

### Variable Types

Variables are automatically typed:

- **Strings**: Automatically wrapped in quotes (`'value'`)
- **Numbers**: Used as-is (`123`, `45.67`)
- **SQL keywords**: Use as strings if needed

**Examples:**
```
${database}   → 'telegraf'  (string)
${limit}      → 100         (number)
${threshold}  → 80.5        (number)
${status}     → 'active'    (string)
```

### Use Cases

**1. Testing across environments:**
```
Development: database = dev_telegraf
Production:  database = telegraf

Query: SELECT * FROM ${database}.cpu LIMIT 10;
```

**2. Threshold adjustments:**
```
Try different values without editing SQL:
threshold = 50, then 70, then 90

Query: SELECT * FROM cpu WHERE usage > ${threshold};
```

**3. Time range exploration:**
```
interval = 1 HOUR
interval = 6 HOUR
interval = 24 HOUR

Query: SELECT * FROM cpu WHERE time > now() - INTERVAL ${interval};
```

---

## Data Ingestion

### CSV Import

Import CSV files directly into Arc using high-performance MessagePack protocol.

**Command:** `Arc: Import CSV`

#### Step-by-Step Guide

**1. Run the import command**
```
Command Palette → Arc: Import CSV
```

**2. Select CSV file**
- Choose your CSV file from the file picker
- Supported formats: `.csv`, `.tsv`, `.txt`

**3. Configure import settings**

The wizard will ask:

- **Measurement name**: Table/measurement name in Arc
  - Default: CSV filename
  - Example: `server_metrics`

- **Database name** (optional): Target database
  - Leave empty for default database
  - Example: `telegraf`

- **Header row**: Does file have headers?
  - Yes: First row contains column names
  - No: Auto-generate column names (column1, column2, ...)

- **Delimiter**: Column separator character
  - Comma (,)
  - Tab
  - Semicolon (;)
  - Pipe (|)

- **Timestamp column** (optional):
  - Select which column contains timestamps
  - Or choose "(Auto-generate timestamp)" for current time

**4. Import executes**
- Progress bar shows status
- Processes in batches of 10,000 rows
- Shows completion message with statistics

#### CSV Format Examples

**Example 1: Simple metrics with timestamp**
```csv
time,host,cpu_usage,memory_usage
2024-10-20 10:00:00,server01,45.2,68.3
2024-10-20 10:01:00,server01,47.8,69.1
2024-10-20 10:02:00,server01,44.1,67.8
```

**Configuration:**
- Measurement: `server_metrics`
- Timestamp column: `time`
- Format: ISO (auto-detected)
- Tags: `host` (string column)
- Fields: `cpu_usage`, `memory_usage` (numeric columns)

**Example 2: IoT sensor data**
```csv
timestamp,device_id,location,temperature,humidity,battery
1697808000000,sensor_001,warehouse_a,22.5,65.2,87
1697808060000,sensor_001,warehouse_a,22.7,65.4,87
1697808120000,sensor_002,warehouse_b,21.3,68.1,92
```

**Configuration:**
- Measurement: `sensors`
- Timestamp column: `timestamp`
- Format: Unix milliseconds
- Tags: `device_id`, `location` (strings)
- Fields: `temperature`, `humidity`, `battery` (numbers)

**Example 3: No header row**
```csv
1697808000,45.2,68.3,server01
1697808060,47.8,69.1,server01
1697808120,44.1,67.8,server02
```

**Configuration:**
- Measurement: `metrics`
- Has header: No
- Auto-generated columns: column1, column2, column3, column4
- Timestamp: Auto-generate (current time)

#### Column Type Detection

The importer automatically detects column types:

- **Strings** → Stored as **tags** (indexed, for filtering)
- **Numbers** → Stored as **fields** (for aggregation)
- **Booleans** → Stored as **fields**

**Detection Examples:**
```
"server01"     → Tag (string)
45.2           → Field (float)
100            → Field (integer)
true           → Field (boolean)
"2024-10-20"   → Tag (string, unless selected as timestamp)
```

#### Performance

- Uses **MessagePack columnar format** (25-35% faster than row format)
- Batch processing: 10,000 rows per batch
- Expected throughput: **50,000-100,000 rows/second**

**Performance Example:**
```
File: 1,000,000 rows
Time: ~15-20 seconds
Speed: ~50,000 rows/sec
```

---

### Bulk Data Generator

Generate realistic test data for development and testing.

**Command:** `Arc: Generate Test Data`

#### Built-in Data Presets

**1. CPU Metrics**
```
Measurement: cpu
Tags: host, region, cpu
Fields: usage_user, usage_system, usage_idle, usage_iowait

Example output:
time: 2024-10-20 10:00:00
host: server01
region: us-east-1
cpu: cpu0
usage_user: 42.3
usage_system: 12.1
usage_idle: 87.4
usage_iowait: 2.3
```

**2. Memory Metrics**
```
Measurement: mem
Tags: host, region
Fields: used, available, used_percent, cached

Example output:
time: 2024-10-20 10:00:00
host: server02
region: us-west-2
used: 8589934592 (8GB)
available: 7516192768 (7GB)
used_percent: 53.4
cached: 2147483648 (2GB)
```

**3. Network Metrics**
```
Measurement: net
Tags: host, interface
Fields: bytes_sent, bytes_recv, packets_sent, packets_recv, err_in, err_out

Example output:
time: 2024-10-20 10:00:00
host: server01
interface: eth0
bytes_sent: 524288000
bytes_recv: 838860800
packets_sent: 450123
packets_recv: 789456
err_in: 0
err_out: 0
```

**4. IoT Sensor Data**
```
Measurement: sensors
Tags: device_id, location, sensor_type
Fields: temperature, humidity, pressure, battery_level

Example output:
time: 2024-10-20 10:00:00
device_id: sensor_001
location: warehouse_a
sensor_type: DHT22
temperature: 22.5 (°C)
humidity: 65.2 (%)
pressure: 1013.2 (hPa)
battery_level: 87 (%)
```

**5. Custom**
- Define your own schema
- Customize tags and fields
- Control value ranges

#### Usage Steps

**1. Run the command**
```
Command Palette → Arc: Generate Test Data
```

**2. Select preset**
- Choose from CPU, Memory, Network, IoT, or Custom

**3. Enter row count**
- Minimum: 1
- Maximum: 10,000,000
- Default: 10,000

**Example:** Enter `50000` for 50,000 rows

**4. Enter database** (optional)
- Leave empty for default database
- Example: `telegraf`

**5. Generation starts**
- Progress bar shows status
- Generates in batches of 10,000
- Shows completion time and row count

#### Example Usage

**Generate 100,000 CPU metrics:**
```
1. Arc: Generate Test Data
2. Select: CPU Metrics
3. Row count: 100000
4. Database: telegraf
5. Wait ~2-3 seconds
6. Success: "Successfully generated 100,000 rows in 2.34s"
```

**Result in Arc:**
```sql
SELECT COUNT(*) FROM telegraf.cpu;
-- Returns: 100,000

SELECT * FROM telegraf.cpu LIMIT 5;
-- Returns:
time                  | host      | region     | cpu  | usage_user | usage_system | usage_idle | usage_iowait
2024-10-20 09:00:00  | server01  | us-east-1  | cpu0 | 42.3       | 12.1         | 87.4       | 2.3
2024-10-20 09:00:01  | server02  | us-west-2  | cpu1 | 38.7       | 15.2         | 91.2       | 1.8
2024-10-20 09:00:02  | server03  | eu-west-1  | cpu2 | 51.2       | 18.4         | 81.7       | 3.2
...
```

#### Time Series Generation

Data is generated with realistic timestamps:

- **Start time**: Current time minus (row_count × interval)
- **Interval**: 1 second (CPU, Memory, Network), 1 minute (IoT)
- **Result**: Historical data that looks like real monitoring

**Example:**
```
Current time: 2024-10-20 10:00:00
Row count: 3600
Interval: 1 second

Generated data spans:
Start: 2024-10-20 09:00:00 (1 hour ago)
End:   2024-10-20 10:00:00 (now)

Perfect for testing time-series queries!
```

#### Performance

- Uses **MessagePack columnar format**
- Batch size: 10,000 rows
- Expected generation speed: **100,000-200,000 rows/second**

**Benchmark:**
```
100,000 rows   → ~1-2 seconds
1,000,000 rows → ~10-15 seconds
10,000,000 rows → ~90-120 seconds
```

---

## Alerting & Monitoring

Create real-time alerts that monitor your Arc data and notify you when conditions are met.

### Alert Concepts

An alert consists of:
- **Query**: SQL query that returns a single value
- **Condition**: Comparison operator (>, <, =, !=, contains)
- **Threshold**: Value to compare against
- **Check Interval**: How often to check (minimum 10 seconds)

### Creating Alerts

**Command:** `Arc: Create Alert`

#### Step-by-Step

**1. Run the command**
```
Command Palette → Arc: Create Alert
```

**2. Enter alert name**
```
Example: "High CPU Usage"
```

**3. Enter query** (must return a single value)
```sql
SELECT AVG(usage_user)
FROM telegraf.cpu
WHERE time > now() - INTERVAL 5 MINUTE
```

**4. Select condition**
- Greater than
- Less than
- Equals
- Not equals
- Contains

**5. Enter threshold value**
```
Example: 80
```

**6. Set check interval**
```
Example: 60 (seconds)
Minimum: 10 seconds
```

**7. Alert is created and enabled**
- Appears in **Arc Alerts** view
- Starts checking immediately
- Shows green bell icon (🔔)

### Alert Examples

#### Example 1: High CPU Alert

**Alert Configuration:**
```
Name: High CPU Usage
Query: SELECT AVG(usage_user) FROM telegraf.cpu WHERE time > now() - INTERVAL 5 MINUTE
Condition: greater_than
Threshold: 80
Check Interval: 60s
```

**Behavior:**
- Checks every 60 seconds
- Calculates average CPU usage over last 5 minutes
- If average > 80%, alert triggers
- Notification appears in VS Code

#### Example 2: Low Memory Alert

**Alert Configuration:**
```
Name: Low Available Memory
Query: SELECT MIN(available) FROM telegraf.mem WHERE time > now() - INTERVAL 1 MINUTE
Condition: less_than
Threshold: 1073741824
Check Interval: 30s
```

**Behavior:**
- Checks every 30 seconds
- Finds minimum available memory in last minute
- If < 1GB (1073741824 bytes), alert triggers

#### Example 3: Error Detection

**Alert Configuration:**
```
Name: Application Errors Detected
Query: SELECT COUNT(*) FROM logs.errors WHERE time > now() - INTERVAL 10 MINUTE
Condition: greater_than
Threshold: 0
Check Interval: 120s
```

**Behavior:**
- Checks every 2 minutes
- Counts errors in last 10 minutes
- If any errors exist, alert triggers

#### Example 4: Service Health Check

**Alert Configuration:**
```
Name: Service Unavailable
Query: SELECT COUNT(*) FROM services.health WHERE status = 'up' AND time > now() - INTERVAL 1 MINUTE
Condition: equals
Threshold: 0
Check Interval: 15s
```

**Behavior:**
- Checks every 15 seconds
- Counts services with status 'up' in last minute
- If count = 0 (no healthy services), alert triggers

#### Example 5: String Matching Alert

**Alert Configuration:**
```
Name: Suspicious Activity Detected
Query: SELECT activity_type FROM security.events ORDER BY time DESC LIMIT 1
Condition: contains
Threshold: "failed_login"
Check Interval: 30s
```

**Behavior:**
- Checks every 30 seconds
- Gets most recent activity type
- If it contains "failed_login", alert triggers

### Managing Alerts

**View all alerts:**
- Open **Arc Alerts** view in sidebar
- Shows two sections:
  - **Active Alerts**: All configured alerts
  - **Recent Triggers**: Last 50 alert triggers

**Alert status indicators:**
- 🔔 Green bell = Enabled and monitoring
- 🔕 Gray bell = Disabled

**Toggle alert on/off:**
1. Right-click alert in tree view
2. Select **Toggle Alert**
3. Alert is enabled/disabled without deletion

**View alert details:**
1. Right-click alert
2. Select **Show Alert Details**
3. Panel shows:
   - Query
   - Condition and threshold
   - Check interval
   - Last check time
   - Last result value
   - Trigger count

**Delete an alert:**
1. Right-click alert
2. Select **Delete Alert**
3. Confirm deletion
4. Alert stops and is removed

### Alert Triggers

When an alert condition is met, a **trigger** is recorded.

**Trigger includes:**
- Alert name
- Timestamp
- Value that triggered the alert
- Description message

**View triggers:**
1. Open **Arc Alerts** view
2. Expand **Recent Triggers** section
3. See chronological list of last 50 triggers

**Trigger notification:**
When an alert triggers, you'll see:
```
🔔 Alert "High CPU Usage" triggered: 85.3 greater than 80

[View Alerts] [Dismiss]
```

**Clear trigger history:**
1. Right-click on **Recent Triggers**
2. Select **Clear Alert Triggers**
3. History is cleared (alerts continue running)

### Alert Best Practices

#### 1. Query Performance

✅ **Good** - Uses time filter, aggregation:
```sql
SELECT AVG(value)
FROM metrics.table
WHERE time > now() - INTERVAL 5 MINUTE
```

❌ **Bad** - Scans entire table:
```sql
SELECT AVG(value) FROM metrics.table
```

#### 2. Check Intervals

- **High-frequency checks** (10-30s): Critical alerts only
- **Medium-frequency checks** (60-120s): Standard monitoring
- **Low-frequency checks** (300-600s): Trends and reporting

#### 3. Threshold Selection

- Start conservative, adjust based on triggers
- Use aggregations (AVG, MIN, MAX) to smooth noise
- Consider time windows that match your data frequency

#### 4. Alert Naming

Use descriptive names:
- ✅ "Production CPU > 80% (5min avg)"
- ✅ "Low Disk Space - Server01"
- ❌ "Alert 1"
- ❌ "Test"

### Use Cases

**1. Infrastructure Monitoring**
```
Alert: High CPU across cluster
Query: SELECT AVG(usage_user) FROM cpu WHERE region = 'us-east'
Condition: > 85
Interval: 60s
```

**2. Application Performance**
```
Alert: Slow API Response Time
Query: SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time)
       FROM api_logs
       WHERE time > now() - INTERVAL 10 MINUTE
Condition: > 1000 (ms)
Interval: 120s
```

**3. Data Pipeline Monitoring**
```
Alert: No Data Ingested Recently
Query: SELECT COUNT(*) FROM events WHERE time > now() - INTERVAL 5 MINUTE
Condition: = 0
Interval: 300s
```

**4. Cost Monitoring**
```
Alert: High Query Volume
Query: SELECT COUNT(*) FROM query_logs WHERE time > now() - INTERVAL 1 HOUR
Condition: > 10000
Interval: 600s
```

---

## Token Management

### Server Tokens (API Keys)

Arc uses tokens for authentication. The extension can manage these directly.

#### Creating a Server Token

**Command:** `Arc: Create Server Token`

1. Run the command
2. Enter token name (e.g., "VSCode Extension")
3. Enter description (optional)
4. Token is created on Arc server
5. Token appears in **Server Tokens** view

**Example:**
```
Name: vscode-extension
Description: Token for VS Code development
Created: 2024-10-20 10:00:00
```

#### Viewing Server Tokens

**Arc Server Tokens** view shows:
- All tokens registered on the server
- Token names and descriptions
- Creation timestamps

**Note:** Actual token values are not shown (security)

#### Rotating a Token

**Purpose:** Replace an existing token with a new one (for security)

1. Right-click token in **Server Tokens** view
2. Select **Rotate Server Token**
3. New token is generated
4. Old token is invalidated
5. Update your connection with new token

#### Deleting a Server Token

1. Right-click token in **Server Tokens** view
2. Select **Delete Server Token**
3. Confirm deletion
4. Token is revoked on server

**Warning:** Any applications using this token will lose access

### Client Tokens (Connection Storage)

Connection tokens are stored securely in VS Code's secret storage.

#### Verifying a Token

**Command:** `Arc: Verify Token`

- Tests if current connection token is valid
- Shows success or error message
- Useful for troubleshooting connection issues

#### Updating a Connection Token

**Command:** `Arc: Update Token`

1. Run the command
2. Enter new token value
3. Token is stored securely
4. Connection uses new token

---

## SQL IntelliSense

The extension provides smart SQL completions while writing queries.

### Auto-completion Features

**1. SQL Keywords**
```sql
SEL → SELECT
WHE → WHERE
GRO → GROUP BY
ORD → ORDER BY
```

**2. DuckDB Functions**
```sql
time_bucket()
percentile_cont()
date_trunc()
string_agg()
```

**3. Database Names**
```sql
FROM telegraf.   → Shows: cpu, mem, disk (tables)
```

**4. Table Names**
```sql
FROM tel → telegraf
```

**5. Common Snippets**

**Time bucket aggregation:**
```sql
time-bucket →

SELECT
  time_bucket('5 minutes', time) as bucket,
  AVG(value) as avg_value
FROM table
WHERE time > now() - INTERVAL 1 HOUR
GROUP BY bucket
ORDER BY bucket DESC;
```

**Moving average:**
```sql
moving-avg →

SELECT
  time,
  value,
  AVG(value) OVER (ORDER BY time ROWS BETWEEN 10 PRECEDING AND CURRENT ROW) as moving_avg
FROM table;
```

**Time-filtered query:**
```sql
time-filter →

SELECT *
FROM table
WHERE time > now() - INTERVAL 1 HOUR;
```

### Trigger IntelliSense

- Press `Ctrl+Space` to manually trigger
- Auto-triggers after typing `.` (dot) or space
- Works in `.sql` and `.arcsql` files

---

## Tips & Tricks

### Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|--------------|-----|
| Execute Query | `Ctrl+Enter` | `Cmd+Enter` |
| Trigger IntelliSense | `Ctrl+Space` | `Cmd+Space` |
| New Query | `Ctrl+Shift+P` → Arc: New Query | `Cmd+Shift+P` → Arc: New Query |

### Performance Tips

**1. Use time filters**
```sql
-- Always filter time for large tables
WHERE time > now() - INTERVAL 1 HOUR
```

**2. Limit results**
```sql
-- Add LIMIT for exploration
LIMIT 1000
```

**3. Use columnar import**
- CSV Import uses columnar format automatically
- 25-35% faster than row format
- Optimal for large imports

### Workflow Examples

**Daily Monitoring Workflow:**
```
1. Open Arc Notebooks view
2. Open "Daily Dashboard" notebook
3. Click "Run All SQL Cells"
4. Review results inline
5. Export to Markdown for sharing
```

**Development Workflow:**
```
1. Generate test data (Arc: Generate Test Data)
2. Create new query file (Arc: New Query)
3. Write query with IntelliSense
4. Execute and view results
5. Save query when finalized
```

**Alert Setup Workflow:**
```
1. Identify metric to monitor
2. Write query in editor, test it
3. Create alert with tested query
4. Set appropriate threshold
5. Monitor triggers in Alerts view
```

---

## Troubleshooting

### Connection Issues

**Problem:** "Not connected to Arc server"

**Solutions:**
1. Check Arc server is running
2. Verify host and port are correct
3. Test with: `curl http://localhost:8000/health`
4. Check firewall settings

**Problem:** "Invalid token"

**Solutions:**
1. Run `Arc: Verify Token`
2. Create new token on server
3. Update connection with new token

### Query Execution Issues

**Problem:** Query times out

**Solutions:**
1. Add time filters to reduce data scanned
2. Add LIMIT clause
3. Check server performance
4. Increase timeout in settings (if available)

**Problem:** "Unknown table or database"

**Solutions:**
1. Refresh explorer: `Arc: Refresh Explorer`
2. Check database name spelling
3. Verify table exists in Arc

### Import/Export Issues

**Problem:** CSV import fails

**Solutions:**
1. Check CSV file encoding (UTF-8 recommended)
2. Verify delimiter is correct
3. Check for malformed rows
4. Try smaller file first to test

**Problem:** Export has formatting issues

**Solutions:**
1. Check for special characters in data
2. Try different export format (CSV vs JSON)
3. Limit result size if too large

### Alert Issues

**Problem:** Alert not triggering

**Solutions:**
1. Check query returns single value
2. Test query in editor first
3. Verify threshold and condition
4. Check alert is enabled (green bell icon)

**Problem:** Too many alerts

**Solutions:**
1. Increase check interval
2. Adjust threshold
3. Use aggregation to smooth data
4. Disable temporarily and tune parameters

---

## API Reference

### Commands

All commands available via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

**Connection:**
- `Arc: Connect`
- `Arc: Disconnect`
- `Arc: Activate Connection`
- `Arc: Edit Connection`
- `Arc: Delete Connection`

**Queries:**
- `Arc: New Query`
- `Arc: Execute Query`
- `Arc: Save Current Query`
- `Arc: Delete Saved Query`
- `Arc: Rename Saved Query`
- `Arc: Clear Query History`

**Explorer:**
- `Arc: Refresh Explorer`
- `Arc: Show Measurements`
- `Arc: Show Table Schema`
- `Arc: Preview Table Data`
- `Arc: Show Table Statistics`
- `Arc: Generate SELECT Query`
- `Arc: Query Last Hour`
- `Arc: Query Today`

**Notebooks:**
- `Arc: New Notebook`

**Data Ingestion:**
- `Arc: Import CSV`
- `Arc: Generate Test Data`

**Alerts:**
- `Arc: Create Alert`
- `Arc: Toggle Alert`
- `Arc: Delete Alert`
- `Arc: Show Alert Details`
- `Arc: Clear Alert Triggers`
- `Arc: Refresh Alerts`

**Tokens:**
- `Arc: Create Token`
- `Arc: Verify Token`
- `Arc: Update Token`
- `Arc: Create Server Token`
- `Arc: Delete Server Token`
- `Arc: Rotate Server Token`

**Monitoring:**
- `Arc: Show Health`
- `Arc: Show Metrics`

### Views

**Arc Explorer**
- Database and table browser
- Right-click context menus for operations

**Arc Connections**
- Saved connections list
- Click to activate

**Arc Server Tokens**
- Server-side token management
- Token rotation and deletion

**Arc Queries**
- Query history (automatic)
- Saved queries (bookmarks)

**Arc Alerts**
- Active alerts
- Recent triggers

### File Types

- `.arcsql` - Arc SQL query files
- `.arcnb` - Arc Notebook files (JSON format)
- `.sql` - Standard SQL files (also supported)

---

## Configuration

### Settings

Access via: File → Preferences → Settings → Search "Arc"

**Default Connection:**
```json
{
  "arc.defaultHost": "localhost",
  "arc.defaultPort": 8000,
  "arc.defaultProtocol": "http"
}
```

**Query Settings:**
```json
{
  "arc.maxResultRows": 1000,
  "arc.queryTimeout": 30000
}
```

### Customization

**Status Bar:**
- Click to connect/disconnect
- Shows active connection
- Color-coded status (green = connected, yellow = disconnected)

---

## Examples Gallery

### Example 1: Time-Series Analysis

**Notebook: "CPU Trend Analysis"**

```markdown
# CPU Usage Trend Analysis

## Overview
Analyzing CPU usage patterns for the last 24 hours.

## Variables
```
| Variable | Value |
|----------|-------|
| hours | 24 |
| bucket | 5 minutes |
```

## Hourly Average
```sql
SELECT
  time_bucket('${bucket}', time) as bucket,
  AVG(usage_user) as avg_cpu,
  MAX(usage_user) as max_cpu,
  MIN(usage_user) as min_cpu
FROM telegraf.cpu
WHERE time > now() - INTERVAL ${hours} HOUR
GROUP BY bucket
ORDER BY bucket DESC;
```

## Peak Usage Times
```sql
SELECT
  time,
  host,
  usage_user
FROM telegraf.cpu
WHERE time > now() - INTERVAL ${hours} HOUR
  AND usage_user > 90
ORDER BY usage_user DESC
LIMIT 10;
```

### Example 2: Multi-Metric Dashboard

**Notebook: "Infrastructure Dashboard"**

```markdown
# Infrastructure Health Dashboard

Generated: ${current_date}

## CPU Status
```sql
SELECT
  host,
  ROUND(AVG(usage_user), 2) as avg_cpu,
  ROUND(MAX(usage_user), 2) as peak_cpu
FROM telegraf.cpu
WHERE time > now() - INTERVAL 1 HOUR
GROUP BY host
ORDER BY avg_cpu DESC;
```

## Memory Status
```sql
SELECT
  host,
  ROUND(AVG(used_percent), 2) as avg_memory,
  ROUND(MAX(used_percent), 2) as peak_memory
FROM telegraf.mem
WHERE time > now() - INTERVAL 1 HOUR
GROUP BY host
ORDER BY avg_memory DESC;
```

## Disk Usage
```sql
SELECT
  host,
  path,
  ROUND(used_percent, 2) as disk_usage
FROM telegraf.disk
WHERE time > now() - INTERVAL 5 MINUTE
  AND used_percent > 80
ORDER BY disk_usage DESC;
```

---

## Frequently Asked Questions

**Q: Can I connect to multiple Arc servers?**
A: Yes, save multiple connections and switch between them in the Arc Connections view.

**Q: Are my tokens stored securely?**
A: Yes, tokens are stored in VS Code's encrypted secret storage (system keychain).

**Q: Can I export query results programmatically?**
A: Yes, use the Export CSV/JSON buttons in the results view.

**Q: How many rows can I import via CSV?**
A: There's no hard limit, but tested up to 10 million rows. Large imports are processed in batches.

**Q: Can alerts send notifications outside VS Code?**
A: Currently, alerts only show VS Code notifications. External notifications (email, Slack) are planned for future releases.

**Q: Can I share notebooks with my team?**
A: Yes, `.arcnb` files are JSON and can be committed to Git or shared via any file sharing method.

**Q: Does the extension work with InfluxDB?**
A: Arc uses a different protocol than InfluxDB. This extension is specifically for Arc Database.

**Q: Can I schedule queries to run automatically?**
A: Use alerts with scheduled intervals. For more complex scheduling, consider Arc's built-in scheduler.

**Q: How do I update the extension?**
A: VS Code will notify you of updates. Or manually check in Extensions view → Arc Database → Update.

---

## Support & Resources

**Documentation:**
- Arc Database Docs: https://github.com/basekick-labs/arc
- VS Code Extension API: https://code.visualstudio.com/api

**Report Issues:**
- GitHub Issues: https://github.com/basekick-labs/vscode-extension/issues

**Community:**
- Discussions: https://github.com/basekick-labs/arc/discussions

**Version:**
- Extension: v0.1.4
- Minimum Arc Version: v1.0.0
- Minimum VS Code Version: 1.80.0

---

## Changelog

### v0.1.4 - Latest

**New Features:**
- ✨ Parameterized queries with variables in notebooks
- ✨ CSV import with MessagePack columnar format
- ✨ Bulk data generator with 5 presets
- ✨ Alerting and monitoring system
- ✨ Notebook export to Markdown
- ✨ Sequential cell execution in notebooks

**Improvements:**
- 🚀 25-35% faster data ingestion with columnar format
- 🎨 Enhanced notebook UI with variables section
- 📊 Auto-chart detection for time-series queries
- 🔔 Desktop notifications for alerts

**Bug Fixes:**
- 🐛 Fixed schema query for Arc (DESCRIBE SELECT syntax)
- 🐛 Fixed notebook cell editing and deletion
- 🐛 Improved error handling in CSV import

### v0.1.3

**Features:**
- Query history and saved queries
- Schema explorer enhancements
- Export results (CSV, JSON, Markdown)
- Chart visualization
- SQL auto-completion
- Notebook support

### v0.1.2

**Features:**
- Connection management
- Query execution
- Tree view for databases and tables
- Token management

### v0.1.1

**Features:**
- Initial release
- Basic connection and query support

---

*This documentation is for Arc VS Code Extension v0.1.4*
*Last updated: October 2024*
