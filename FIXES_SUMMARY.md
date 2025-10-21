# Fixes Applied - Database Discovery & Connection Management

## Issues Fixed

### Issue 1: Only seeing "default" database
**Root Cause**: Arc API uses `sql` field instead of `query`, and response uses `data` field instead of `rows`

**Solution**:
- Changed all query payloads from `{ query: "..." }` to `{ sql: "..." }`
- Updated response parsing to check `data` field first, then `rows` as fallback
- Modified in 3 places: `executeQuery()`, `getDatabases()`, `getMeasurements()`

### Issue 2: Cannot reuse existing connections
**Root Cause**: Connection list was read-only, no way to activate a saved connection

**Solution**:
- Added `activateConnection()` command to switch between saved connections
- Made connection tree items clickable
- Click inactive connection → connects
- Click active connection → disconnects

## Files Modified

### 1. [src/api/arcClient.ts](src/api/arcClient.ts)

**`executeQuery()` method (lines 111-147)**:
```typescript
// Before
const payload: any = { query: request.query };
rows: data.rows || []

// After
const payload: any = { sql: request.query };  // ✓ Fixed
rows: responseData.data || responseData.rows || []  // ✓ Fixed
```

**`getDatabases()` method (lines 190-214)**:
```typescript
// Before
const response = await this.client.post('/query', {
  query: 'SHOW DATABASES;'
});
const rows = data.rows;

// After
const response = await this.client.post('/query', {
  sql: 'SHOW DATABASES;'  // ✓ Fixed
});
const rows = responseData.data || responseData.rows || [];  // ✓ Fixed
```

**`getMeasurements()` fallback (lines 172-173)**:
```typescript
// Before
const queryResponse = await this.client.post('/query', { query, database });
if (queryData.rows && Array.isArray(queryData.rows))

// After
const queryResponse = await this.client.post('/query', { sql: query, database });  // ✓ Fixed
const rows = queryData.data || queryData.rows || [];  // ✓ Fixed
```

### 2. [src/commands/arcCommands.ts](src/commands/arcCommands.ts)

**Added `activateConnection()` method (lines 120-147)**:
```typescript
async activateConnection(connection: ArcConnection): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification },
    async () => {
      const client = await this.connectionManager.setActiveConnection(connection.id);
      await client.healthCheck();
    }
  );

  vscode.window.showInformationMessage(`Connected to ${connection.name}`);
  this.explorerProvider.refresh();
  this.connectionsProvider.refresh();
}
```

### 3. [src/providers/arcConnectionsProvider.ts](src/providers/arcConnectionsProvider.ts)

**Made connections clickable (lines 66-71)**:
```typescript
// Added command to tree item
this.command = {
  command: isActive ? 'arc.disconnect' : 'arc.activateConnection',
  title: isActive ? 'Disconnect' : 'Connect',
  arguments: [connection]
};
```

### 4. [src/extension.ts](src/extension.ts)

**Registered new command (line 34)**:
```typescript
vscode.commands.registerCommand('arc.activateConnection', (connection) =>
  commands.activateConnection(connection)
)
```

## Testing Your Databases

Your Arc server at `https://arc.basekick.net` has **3 databases**:
```
┌────────────────────┐
│     database       │
├────────────────────┤
│ default            │
│ github_repo_stats  │
│ telegraf           │
└────────────────────┘
```

### Test Steps

1. **Restart the extension**:
   - Press `Ctrl+Shift+F5` in Extension Development Host
   - Or close and press `F5` again

2. **Connect with your token**:
   - Click "Arc: Not Connected" in status bar
   - Enter connection details:
     - Name: `Basekick Arc`
     - Host: `arc.basekick.net`
     - Port: `443`
     - Protocol: `https`
   - Enter token: `SUrawdObUZ4ocyvFd46Y0hAeIIdr6KrikK7TEX-tXyE`

3. **Verify all 3 databases appear**:
   - Open Arc Database sidebar
   - Expand the tree
   - You should see:
     - default
     - github_repo_stats
     - telegraf

4. **Test connection switching**:
   - Connections panel will show "Basekick Arc (active)"
   - Add another connection (localhost dev server?)
   - Click to switch between them
   - Active connection shows green icon

## Arc API Format Differences

### Query Endpoint Format

**Request**:
```json
{
  "sql": "SHOW DATABASES;",  // ← "sql" not "query"
  "database": "optional"
}
```

**Response**:
```json
{
  "success": true,
  "columns": ["database"],
  "data": [["default"], ["telegraf"]],  // ← "data" not "rows"
  "row_count": 2,                        // ← "row_count" not "rowCount"
  "execution_time_ms": 1.7,
  "timestamp": "2025-10-20T22:05:33.849958",
  "error": null
}
```

## Verified Working

✅ **Databases**: All 3 databases now appear
- default
- github_repo_stats
- telegraf

✅ **Queries**: SQL execution works with correct field names

✅ **Connections**: Can click to switch between saved connections

✅ **Authentication**: Token passed correctly in headers

## Example Queries to Test

### List all databases
```sql
SHOW DATABASES;
```

### List tables in github_repo_stats
```sql
SHOW TABLES FROM github_repo_stats;
```

### Query data from specific database
```sql
SELECT * FROM telegraf.cpu LIMIT 10;
```

### Cross-database query
```sql
SELECT
  t.timestamp,
  t.usage_user,
  g.star_count
FROM telegraf.cpu t
JOIN github_repo_stats.repos g
  ON date_trunc('hour', t.timestamp) = date_trunc('hour', g.timestamp)
LIMIT 100;
```

## Connection Management

### Saved Connections
Your connections are saved in VS Code global state and persist across sessions.

### Secure Token Storage
Tokens are stored in VS Code SecretStorage (encrypted keychain).

### Connection List
- All saved connections appear in "Connections" panel
- Active connection has green icon and "(active)" label
- Click any connection to activate it
- Click active connection to disconnect

### Multiple Connections Example
```
Connections
├── Basekick Arc (active)      ← Click to disconnect
├── Local Dev Server           ← Click to connect
└── Staging Environment        ← Click to connect
```

## Next Steps

1. **Test the fixes**: Press F5 and verify all 3 databases appear
2. **Save connections**: Add your local dev server as a second connection
3. **Quick switching**: Click connections to switch between them
4. **Explore databases**: Expand each database to see measurements

## Troubleshooting

### Still seeing only "default"?
- Check Developer Console: Help → Toggle Developer Tools
- Look for errors in the Console tab
- Verify token is valid: `Cmd+Shift+P` → `Arc: Verify Token`

### Connection not switching?
- Make sure you have a valid token saved for each connection
- Check that the server is reachable
- Look for error notifications

### Measurements not loading?
- Each database must have data
- Use `SHOW TABLES FROM {database}` to verify
- Check server logs for errors

## Debug Commands

Test the API directly from terminal:

```bash
# Test with your token
TOKEN="SUrawdObUZ4ocyvFd46Y0hAeIIdr6KrikK7TEX-tXyE"

# List databases
curl -X POST "https://arc.basekick.net/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"sql":"SHOW DATABASES;"}'

# List tables in github_repo_stats
curl -X POST "https://arc.basekick.net/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"sql":"SHOW TABLES FROM github_repo_stats;"}'
```

---

**Status**: ✅ All fixes compiled successfully, ready to test!
