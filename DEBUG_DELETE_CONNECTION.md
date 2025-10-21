# Debugging Delete Connection Issue

## Changes Made

### 1. Added Validation & Verification

**File**: [src/commands/arcCommands.ts:224-263](src/commands/arcCommands.ts#L224-L263)

```typescript
async deleteConnection(connection: ArcConnection): Promise<void> {
  // ✓ Validate connection exists
  if (!connection || !connection.id) {
    vscode.window.showErrorMessage('Invalid connection');
    return;
  }

  // User confirms deletion
  const confirm = await vscode.window.showWarningMessage(...);

  // ✓ Remove connection
  await this.connectionManager.removeConnection(connection.id);

  // ✓ Verify it was actually removed
  const connections = this.connectionManager.getConnections();
  const stillExists = connections.find(c => c.id === connection.id);

  if (stillExists) {
    throw new Error('Connection was not deleted properly');
  }

  // ✓ Refresh views
  this.explorerProvider.refresh();
  this.connectionsProvider.refresh();
}
```

### 2. Added Status Bar Update

**File**: [src/extension.ts:97-101](src/extension.ts#L97-L101)

```typescript
const originalDeleteConnection = commands.deleteConnection.bind(commands);
commands.deleteConnection = async (connection) => {
  await originalDeleteConnection(connection);
  updateStatusBar();  // ✓ Update UI
};
```

Also added for `activateConnection` to keep status bar in sync.

---

## How to Debug

### 1. Check Developer Console

**Open Console**:
- Help → Toggle Developer Tools
- Console tab

**What to Look For**:
- Any errors when clicking delete
- "Delete connection error:" messages
- Connection manager errors

### 2. Test Delete Flow

**Step by Step**:
```
1. Right-click a connection
2. Select "Delete Connection"
3. Confirm deletion
4. Check console for errors
5. Check if connection still appears
```

**Expected Behavior**:
- ✅ Confirmation dialog appears
- ✅ "Deleted connection: {name}" message
- ✅ Connection disappears from list
- ✅ Status bar updates if was active
- ✅ No errors in console

**If Connection Still Appears**:
- Check console for verification error
- Look for "Connection was not deleted properly"
- Connection Manager might not be saving

### 3. Verify Connection Storage

**Check what's stored**:

The connections are stored in VS Code global state. After deleting, restart the extension:
- Press `Ctrl+Shift+F5` in Extension Development Host

If connection reappears after restart:
- Issue is with `saveConnections()` method
- Check `globalState.update()` is being called

### 4. Manual Test

Try this in the Developer Console:
```javascript
// Get connection manager instance
// (This won't work directly, but check the pattern)

// Check connections before delete
console.log('Before delete:', connectionManager.getConnections());

// After delete
console.log('After delete:', connectionManager.getConnections());
```

---

## Possible Issues

### Issue 1: Connection Not Passed Correctly

**Symptom**: Error message "Invalid connection"

**Cause**: Context menu not passing connection object

**Check**:
- Look at `package.json` context menu configuration
- Verify `viewItem == connection`
- Check tree item has `contextValue = 'connection'`

**Fix**: Already implemented in [src/providers/arcConnectionsProvider.ts:61](src/providers/arcConnectionsProvider.ts#L61)

### Issue 2: State Not Persisting

**Symptom**: Connection deleted but reappears on refresh

**Cause**: `globalState.update()` not saving properly

**Check**:
```typescript
// In connectionManager.ts
private async saveConnections(): Promise<void> {
  const connections = Array.from(this.connections.values());
  await this.context.globalState.update('arc.connections', connections);
  console.log('Saved connections:', connections); // Add this
}
```

**Test**: Add logging to verify save is called

### Issue 3: Map Not Updating

**Symptom**: Connection stays in memory map

**Cause**: `this.connections.delete()` not working

**Check**:
```typescript
// Before delete
console.log('Map size before:', this.connections.size);
this.connections.delete(connectionId);
// After delete
console.log('Map size after:', this.connections.size);
```

### Issue 4: View Not Refreshing

**Symptom**: Connection deleted but UI not updated

**Cause**: Tree view not refreshing

**Check**:
- Verify `connectionsProvider.refresh()` is called
- Check `_onDidChangeTreeData.fire()` is triggered

**Test**: Click refresh button manually to force update

---

## Testing Steps

### Test 1: Simple Delete

```
1. Create test connection
   - Cmd+Shift+P → Arc: Connect to Server
   - Name: "Test Delete"
   - Host: localhost, Port: 9999, Protocol: http
   - Skip token

2. Delete it
   - Right-click "Test Delete"
   - Delete Connection
   - Confirm

3. Verify
   - Should disappear immediately
   - Check console for errors
   - Restart extension (Ctrl+Shift+F5)
   - Should not reappear
```

### Test 2: Delete Active Connection

```
1. Connect to a server
2. While connected, delete it
3. Expected:
   - Disconnected automatically
   - Status bar shows "Not Connected"
   - Explorer view cleared
```

### Test 3: Delete Multiple

```
1. Create 3 test connections
2. Delete them one by one
3. All should disappear
4. Restart extension
5. None should reappear
```

---

## What Changed in v0.1.4

### Enhanced Delete Logic

- ✅ Added validation before delete
- ✅ Added verification after delete
- ✅ Improved error messages
- ✅ Added console logging
- ✅ Status bar updates on delete
- ✅ Better error handling

### Code Changes

**arcCommands.ts**:
- Lines 226-228: Validation
- Lines 245-250: Verification
- Line 261: Console error logging

**extension.ts**:
- Lines 91-95: activateConnection wrapper
- Lines 97-101: deleteConnection wrapper

---

## Quick Test

**Try this now**:

1. Press **F5** to launch extension
2. Create a test connection:
   - Name: DELETE_ME
   - Host: test.example.com
   - Port: 8000
3. Right-click → Delete Connection
4. Watch for:
   - Confirmation dialog
   - Success message
   - Connection disappears
   - Console errors (should be none)

**If it doesn't delete**:
1. Open Developer Console
2. Look for error message
3. Copy error and we can debug further

---

## Expected Console Output

**Successful Delete**:
```
(No errors)
```

**Failed Delete**:
```
Delete connection error: Connection was not deleted properly
```

or

```
Delete connection error: Invalid connection
```

---

## Next Steps

1. **Test the delete**: Try deleting a connection
2. **Check console**: Look for any errors
3. **Verify persistence**: Restart extension, connection should stay deleted
4. **Report back**: Let me know what you see!

---

**Status**: ✅ Compiled with enhanced debugging
**Version**: 0.1.4
**Ready to test**: Press F5!
