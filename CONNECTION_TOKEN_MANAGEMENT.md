# Connection & Token Management Guide

## New Features Added

### Connection Management
- ✅ **Edit Connection** - Update host, port, protocol, or name
- ✅ **Delete Connection** - Remove saved connections
- ✅ **Right-Click Context Menu** - Quick access to all connection actions

### Token Management
- ✅ **Update Token** - Change token for any connection
- ✅ **Delete Token** - Remove stored token
- ✅ **Per-Connection Tokens** - Each connection has its own secure token

---

## How to Use

### Managing Connections

#### View All Connections

Open the **Arc Database** sidebar → **Connections** panel

Your connections are listed with:
- Connection name
- Status indicator (active = green icon)
- Click to connect/disconnect

#### Edit a Connection

**Method 1: Right-Click Menu**
1. Right-click a connection in the Connections panel
2. Select **"Edit Connection"**
3. Update any fields:
   - Name
   - Host
   - Port
   - Protocol (http/https)
4. Changes saved automatically

**Method 2: Command Palette**
1. `Cmd+Shift+P` → `Arc: Edit Connection`
2. Follow prompts

**Example Use Cases**:
- Change from localhost to production server
- Switch from http to https
- Rename connection for clarity
- Update port number

#### Delete a Connection

**Method 1: Right-Click Menu**
1. Right-click a connection
2. Select **"Delete Connection"**
3. Confirm deletion

**Method 2: Command Palette**
1. `Cmd+Shift+P` → `Arc: Delete Connection`

**What Gets Deleted**:
- ✅ Connection settings
- ✅ Stored token
- ✅ If active, you'll be disconnected

---

### Managing Tokens

#### Update Token for a Connection

**Method 1: Right-Click Menu**
1. Right-click a connection
2. Select **"Update Token"**
3. Paste your token (input is hidden)
4. Token saved securely

**Method 2: Command Palette (Active Connection)**
1. `Cmd+Shift+P` → `Arc: Update Token`
2. Updates token for currently active connection

**Method 3: During Connection Edit**
When you edit a connection, you can also update its token

**When to Update Token**:
- Token expired
- Token revoked
- Security rotation policy
- Switching to a new token with different permissions

#### Delete Token

**Method 1: Right-Click Menu**
1. Right-click a connection
2. Select **"Delete Token"**
3. Confirm deletion

**Method 2: Command Palette**
1. `Cmd+Shift+P` → `Arc: Delete Token`

**Result**:
- Token removed from secure storage
- Connection remains saved
- You'll need to provide token on next connect

#### Create New Token (Arc Server)

If you need to generate a new token on the Arc server:

1. Connect to an Arc server (with existing valid token)
2. `Cmd+Shift+P` → `Arc: Create Token`
3. Enter optional description
4. Token generated and automatically saved
5. Copy token (shown once)

---

## Context Menu Actions

Right-click any connection in the **Connections** panel to see:

```
Connection Name
├── Connect/Disconnect       (if inactive/active)
├── Edit Connection          (update settings)
├── Update Token             (change token)
├── Delete Token             (remove token)
└── Delete Connection        (remove completely)
```

---

## Security Features

### Secure Token Storage

Tokens are stored using **VS Code SecretStorage API**:
- ✅ Encrypted in system keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- ✅ Never stored in plain text
- ✅ Per-connection isolation
- ✅ Automatically cleared on connection delete

### Token Visibility

- Input fields are **masked** (password mode)
- Tokens never displayed in UI
- Only shown once when created on server
- Copy to clipboard for backup

---

## Common Workflows

### Workflow 1: Add New Server

1. **Connect to new server**:
   - `Cmd+Shift+P` → `Arc: Connect to Server`
   - Enter details + token

2. **Connection saved automatically**

3. **Switch between servers**:
   - Click connections in Connections panel

### Workflow 2: Rotate Tokens

1. **Generate new token** (on Arc server dashboard or via extension)
2. **Update in extension**:
   - Right-click connection → Update Token
   - Paste new token
3. **Test connection**:
   - Click connection to connect
   - Should connect without errors

### Workflow 3: Clean Up Old Connections

1. **Review connections** in Connections panel
2. **Delete unused ones**:
   - Right-click → Delete Connection
   - Confirm
3. **Connections removed** with their tokens

### Workflow 4: Multiple Environments

**Setup**:
```
Connections
├── Local Dev (localhost:8000)
├── Staging (staging.arc.company.com)
└── Production (arc.company.com)
```

**Usage**:
- Click connection to switch environments
- Each has its own token
- Active connection highlighted
- Explorer updates automatically

### Workflow 5: Update Server Details

**Scenario**: Server moved from localhost to cloud

1. Right-click "Local Arc" → Edit Connection
2. Update:
   - Name: "Local Arc" → "Cloud Arc"
   - Host: "localhost" → "arc.basekick.net"
   - Port: 8000 → 443
   - Protocol: http → https
3. Token remains intact
4. Click to connect to new location

---

## Command Reference

### Connection Commands

| Command | Description | Shortcut |
|---------|-------------|----------|
| `Arc: Connect to Server` | Add new connection | - |
| `Arc: Disconnect` | Disconnect from active server | - |
| `Arc: Edit Connection` | Update connection settings | Right-click |
| `Arc: Delete Connection` | Remove connection | Right-click |

### Token Commands

| Command | Description | Shortcut |
|---------|-------------|----------|
| `Arc: Create Token` | Generate token on server | - |
| `Arc: Update Token` | Change saved token | Right-click |
| `Arc: Delete Token` | Remove stored token | Right-click |
| `Arc: Verify Token` | Test token validity | - |

---

## Examples

### Example 1: Add Second Server

**Current**: Connected to localhost
**Goal**: Add production server

```
1. Current active: "Local Arc" (localhost:8000)
2. Cmd+Shift+P → Arc: Connect to Server
3. Enter:
   Name: Production Arc
   Host: arc.basekick.net
   Port: 443
   Protocol: https
   Token: SUrawdObUZ4ocyvFd46Y0hAeIIdr6KrikK7TEX-tXyE
4. Connection saved
5. Now have 2 connections, can click to switch
```

### Example 2: Fix Expired Token

**Current**: Connection failing with 401 Unauthorized
**Goal**: Update token

```
1. Get new token from Arc server admin
2. Right-click "Production Arc" → Update Token
3. Paste new token
4. Click "Production Arc" to reconnect
5. Connection works!
```

### Example 3: Rename Connection

**Current**: "Arc Server" (generic name)
**Goal**: Better naming

```
1. Right-click "Arc Server" → Edit Connection
2. Name: "Arc Server" → "Telegraf Metrics - Production"
3. Press Enter through other fields (no changes)
4. Connection renamed
```

### Example 4: Delete Test Connection

**Current**: Old test connection no longer needed
**Goal**: Clean up

```
1. Right-click "Test Connection" → Delete Connection
2. Confirm deletion
3. Connection + token removed
4. If was active, automatically disconnected
```

---

## Token Best Practices

### Security

- ✅ **Rotate regularly** - Update tokens every 90 days
- ✅ **Use unique tokens** - Different token per environment
- ✅ **Revoke unused** - Delete tokens for deleted connections
- ✅ **Minimum permissions** - Create tokens with only needed access
- ✅ **Never share** - Each developer should have their own token

### Organization

- ✅ **Descriptive names** - "Production Analytics", "Dev Local", "Staging Telegraf"
- ✅ **Environment prefixes** - [PROD], [STAGING], [DEV]
- ✅ **Purpose suffixes** - "Analytics", "Testing", "Monitoring"

### Troubleshooting

**Token Invalid**:
1. Verify token: `Cmd+Shift+P` → `Arc: Verify Token`
2. Check expiration date (if Arc has token expiry)
3. Update with new token

**Can't Connect**:
1. Test manually: `curl https://arc.basekick.net/health`
2. Check firewall/VPN
3. Verify host/port in connection settings
4. Try Edit Connection to update details

**Token Deleted By Mistake**:
1. Get token from secure backup or Arc admin
2. Right-click connection → Update Token
3. Paste token

---

## UI Components

### Connections Panel

```
Connections
├── 🔌 Local Dev              ← Inactive (click to connect)
├── ⚡ Production (active)     ← Active (click to disconnect)
└── 🔌 Staging                ← Inactive
```

**Icons**:
- 🔌 Gray plug = Inactive
- ⚡ Green plug = Active

**Actions**:
- Click item = Connect/Disconnect
- Right-click = Show context menu

### Context Menu Structure

```
Edit Connection
──────────────
Update Token
Delete Token
──────────────
Delete Connection  (Red/danger)
```

---

## Files Modified

1. **[src/commands/arcCommands.ts](src/commands/arcCommands.ts:149-319)** - Added 4 new commands
   - `editConnection()` - lines 152-219
   - `deleteConnection()` - lines 224-248
   - `updateToken()` - lines 253-284
   - `deleteToken()` - lines 289-319

2. **[package.json](package.json:83-102)** - Added command definitions
   - 4 new commands with icons
   - Context menu items for connections
   - Grouped by function (connection, token, danger)

3. **[src/extension.ts](src/extension.ts:35-40)** - Registered commands
   - All 4 commands registered with handlers
   - Connection parameter passed from tree view

---

## Testing Checklist

- [ ] Create new connection
- [ ] Edit connection details
- [ ] Update token for connection
- [ ] Delete token
- [ ] Delete connection
- [ ] Switch between multiple connections
- [ ] Right-click context menu appears
- [ ] All menu items work
- [ ] Tokens stored securely
- [ ] Connections persist across VS Code restart

---

## Next Steps

1. **Try it out**: Press F5 to test
2. **Add multiple connections**: Try local + production
3. **Test editing**: Change a connection name
4. **Token rotation**: Update a token
5. **Clean up**: Delete an old connection

---

**Status**: ✅ Compiled successfully, ready to test!
