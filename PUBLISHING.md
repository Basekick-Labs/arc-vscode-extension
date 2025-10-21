# Publishing Guide for Arc Database Manager

## Prerequisites

### 1. Install vsce (Visual Studio Code Extensions CLI)
```bash
npm install -g @vscode/vsce
```

### 2. Create a Personal Access Token (PAT)

1. Go to https://dev.azure.com
2. Sign in with your Microsoft account
3. Click on **User settings** (top right) → **Personal access tokens**
4. Click **+ New Token**
5. Configure:
   - **Name**: `vscode-marketplace`
   - **Organization**: All accessible organizations
   - **Expiration**: Custom defined (e.g., 90 days)
   - **Scopes**:
     - ✅ **Marketplace** → **Manage** (this gives publish permissions)
6. Click **Create**
7. **Copy the token** - you won't see it again!

### 3. Create a Publisher (if you haven't already)

1. Go to https://marketplace.visualstudio.com/manage
2. Click **Create publisher**
3. Enter:
   - **Publisher ID**: `basekick-labs` (must match package.json)
   - **Display name**: Basekick Labs
   - **Verified domain** (optional)

---

## Pre-Publishing Checklist

### ✅ Files Ready

- [x] **package.json** - Updated with all metadata
  - Version: 0.1.4
  - Icon path
  - Repository URL
  - License
  - Categories and keywords

- [x] **README.md** - Marketplace description with:
  - Feature highlights
  - Screenshots (add later)
  - Quick start guide
  - Examples
  - Links to documentation

- [x] **CHANGELOG.md** - Version history

- [x] **LICENSE** - MIT License

- [x] **.vscodeignore** - Files to exclude from package

- [x] **Icon** - Located at `resources/icon.png`

### ✅ Code Quality

Run these commands to verify:

```bash
# Compile TypeScript
npm run compile

# Run linter
npm run lint

# (Optional) Run tests
npm test
```

### ✅ Test the Extension Locally

1. Press `F5` in VS Code to launch Extension Development Host
2. Test all major features:
   - Connect to Arc server
   - Execute queries
   - Create a notebook
   - Import CSV
   - Generate test data
   - Create an alert
3. Check for console errors
4. Verify dark mode support

---

## Building the Package

### Create .vsix Package

```bash
# Navigate to extension directory
cd /Users/nacho/dev/basekick-labs/vscode-extension

# Build the package
vsce package
```

This creates: `arc-db-manager-0.1.4.vsix`

### Test the .vsix Locally

```bash
# Install from .vsix
code --install-extension arc-db-manager-0.1.4.vsix

# Or install via VS Code UI:
# Extensions → ⋯ (three dots) → Install from VSIX...
```

---

## Publishing to Marketplace

### Method 1: Using vsce CLI (Recommended)

```bash
# Login with your Personal Access Token
vsce login basekick-labs
# When prompted, paste your PAT

# Publish the extension
vsce publish
```

The version number will be read from `package.json` (0.1.4).

### Method 2: Manual Upload

1. Create the package:
   ```bash
   vsce package
   ```

2. Go to https://marketplace.visualstudio.com/manage/publishers/basekick-labs

3. Click **+ New extension** → **Visual Studio Code**

4. Upload `arc-db-manager-0.1.4.vsix`

5. Fill in marketplace details (auto-populated from README.md)

6. Click **Upload**

---

## Publishing Updates

### Patch Release (0.1.4 → 0.1.5)

```bash
# Update version and publish
vsce publish patch

# Or manually:
npm version patch
vsce publish
```

### Minor Release (0.1.4 → 0.2.0)

```bash
vsce publish minor
```

### Major Release (0.1.4 → 1.0.0)

```bash
vsce publish major
```

---

## Post-Publishing

### 1. Verify Publication

- Check https://marketplace.visualstudio.com/items?itemName=basekick-labs.arc-db-manager
- Install from marketplace: `code --install-extension basekick-labs.arc-db-manager`
- Verify in VS Code Extensions view

### 2. Tag the Release in Git

```bash
git tag v0.1.4
git push origin v0.1.4
```

### 3. Create GitHub Release

1. Go to https://github.com/basekick-labs/arc-vscode-extension/releases
2. Click **Draft a new release**
3. Tag: `v0.1.4`
4. Title: `Arc Database Manager v0.1.4`
5. Copy release notes from CHANGELOG.md
6. Attach `arc-db-manager-0.1.4.vsix` as asset
7. Click **Publish release**

### 4. Announce

- Tweet/post about the release
- Update Arc main repo README with link
- Share in Discord/Slack channels
- Update documentation website

---

## Troubleshooting

### Error: "Extension already published"

If version 0.1.4 already exists, increment the version:

```bash
npm version patch  # 0.1.4 → 0.1.5
vsce publish
```

### Error: "Publisher not found"

Make sure you've created the publisher at https://marketplace.visualstudio.com/manage

### Error: "PAT invalid"

1. Check token hasn't expired
2. Verify token has **Marketplace (Manage)** scope
3. Login again: `vsce login basekick-labs`

### Icon not showing

- Verify icon exists at `resources/icon.png`
- Icon must be 128x128 pixels (PNG)
- Rebuild package: `vsce package`

### README not formatting correctly

- Use standard Markdown
- Avoid HTML
- Test locally first
- Preview: https://marketplace.visualstudio.com/manage

---

## Adding Screenshots

### 1. Create Screenshots

Take screenshots of key features:
- `resources/screenshots/query-results.png`
- `resources/screenshots/notebook.png`
- `resources/screenshots/schema-explorer.png`
- `resources/screenshots/alerts.png`

### 2. Add to README

```markdown
![Query Results](resources/screenshots/query-results.png)
![Arc Notebook](resources/screenshots/notebook.png)
```

### 3. Republish

```bash
vsce publish patch
```

---

## Maintenance

### Update Dependencies

```bash
# Check for outdated packages
npm outdated

# Update dependencies
npm update

# Test
npm run compile
npm test
```

### Security Patches

```bash
# Check for vulnerabilities
npm audit

# Fix automatically
npm audit fix

# Republish
vsce publish patch
```

---

## Complete Publishing Workflow

```bash
# 1. Update version in package.json
# 2. Update CHANGELOG.md
# 3. Test locally
npm run compile
npm run lint

# 4. Commit changes
git add .
git commit -m "Release v0.1.4"
git push

# 5. Build and publish
vsce package
vsce publish

# 6. Tag release
git tag v0.1.4
git push origin v0.1.4

# 7. Create GitHub release
# (Manual step on GitHub)

# 8. Announce!
```

---

## Useful Commands

```bash
# Show package contents
vsce ls

# Show package statistics
vsce show basekick-labs.arc-db-manager

# Unpublish (careful!)
vsce unpublish basekick-labs.arc-db-manager

# List all versions
vsce show basekick-labs.arc-db-manager --json
```

---

## Resources

- **VS Code Publishing Guide**: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- **vsce Documentation**: https://github.com/microsoft/vscode-vsce
- **Marketplace Management**: https://marketplace.visualstudio.com/manage
- **Extension Guidelines**: https://code.visualstudio.com/api/references/extension-guidelines

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `vsce package` | Create .vsix package |
| `vsce publish` | Publish to marketplace |
| `vsce publish patch` | Increment patch version and publish |
| `vsce login <publisher>` | Login with PAT |
| `vsce ls` | List package contents |
| `code --install-extension file.vsix` | Install locally |

---

**Ready to publish!** 🚀

Once you have your PAT, run:
```bash
vsce login basekick-labs
vsce publish
```
