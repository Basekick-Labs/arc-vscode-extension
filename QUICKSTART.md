# Arc Database Manager - Quick Start Guide

Get started with Arc Database Manager in 5 minutes!

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Compile the Extension

```bash
npm run compile
```

## Step 3: Run the Extension

1. Open this folder in VS Code
2. Press **F5** to launch the Extension Development Host
3. A new VS Code window will open with the extension loaded

## Step 4: Connect to Arc

### Option A: Use Local Arc Server

If you have Arc running locally on `http://localhost:8000`:

1. Click the **"Arc: Not Connected"** status bar item (bottom left)
2. Enter connection details:
   - Name: `Local Arc`
   - Host: `localhost`
   - Port: `8000`
   - Protocol: `http`
3. Press Enter to skip token (or enter one if you have it)

### Option B: Start Arc Server First

If you don't have Arc running:

```bash
# Navigate to Arc directory
cd ../arc

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run Arc
python arc.py
```

Then follow Option A above.

## Step 5: Create a Token (Optional but Recommended)

1. Open Command Palette: `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. Type: `Arc: Create Token`
3. Enter description: `VS Code Extension`
4. Click **"Copy Token"** when prompted
5. Token is automatically saved and used

## Step 6: Run Your First Query

1. Open Command Palette: `Cmd+Shift+P`
2. Type: `Arc: New Query`
3. Try this query:

```sql
-- List all measurements
SELECT * FROM information_schema.tables;
```

4. Press `Ctrl+Enter` (or `Cmd+Enter` on Mac) to execute
5. View results in the panel that opens

## Step 7: Insert Test Data

1. Open Command Palette: `Cmd+Shift+P`
2. Type: `Arc: Insert Test Data`
3. Enter measurement name: `test_metrics`
4. 10 test records will be inserted

Now query your test data:

```sql
SELECT * FROM test_metrics ORDER BY time DESC;
```

## Common Tasks

### View Databases and Tables

- Look at the **Arc Database** icon in the Activity Bar (left sidebar)
- Expand databases to see measurements
- Click the refresh icon to reload

### Check Server Health

Command Palette → `Arc: Show Health Status`

### View Performance Metrics

Command Palette → `Arc: Show Metrics`

### Execute Selected Query

1. Write multiple queries in a file
2. Select the query you want to run
3. Press `Ctrl+Enter`

### Disconnect

Command Palette → `Arc: Disconnect`

## Example Queries

### Time-series data
```sql
SELECT
  time,
  value,
  host
FROM cpu_metrics
WHERE time > now() - INTERVAL '1 hour'
ORDER BY time DESC
LIMIT 100;
```

### Aggregation
```sql
SELECT
  time_bucket(INTERVAL '5 minutes', time) AS bucket,
  AVG(value) as avg_value,
  MAX(value) as max_value
FROM cpu_metrics
GROUP BY bucket
ORDER BY bucket DESC;
```

### Count measurements
```sql
SELECT COUNT(*) as total_rows FROM test_metrics;
```

## Troubleshooting

### "Cannot connect to Arc server"

**Check if Arc is running:**
```bash
curl http://localhost:8000/health
```

Should return: `{"status":"healthy"}`

### "Token is invalid"

Create a new token:
1. `Cmd+Shift+P` → `Arc: Create Token`
2. Follow prompts

### "No such table"

Make sure you've inserted data first or check available measurements:
```
Cmd+Shift+P → Arc: Show Measurements
```

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Check [ARC_VSCODE_INTEGRATION_GUIDE.md](ARC_VSCODE_INTEGRATION_GUIDE.md) for API details
- Explore Arc documentation in `../arc/README.md`
- Try the example queries in `../arc/example.py`

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Execute Query | `Ctrl+Enter` / `Cmd+Enter` |
| Open Command Palette | `Ctrl+Shift+P` / `Cmd+Shift+P` |
| Debug Extension | `F5` |

## Development Mode

To make changes to the extension:

1. Edit files in `src/`
2. Run `npm run watch` in terminal (auto-compiles on save)
3. Press `Ctrl+Shift+F5` to reload the extension

## Get Help

- Check the [README.md](README.md)
- Review Arc server logs
- Open an issue on GitHub

Happy querying!
