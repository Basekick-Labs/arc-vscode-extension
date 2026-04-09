# Change Log

All notable changes to the "Arc Database Manager" extension will be documented in this file.

## [0.3.0] - 2026-04-09

### Added
- **x-arc-database Header Support**: Queries now send the database context via the `x-arc-database` HTTP header instead of embedding `database.table` in SQL, improving query performance. Both forms remain supported.
- **Apache Arrow Query Format**: Full support for the `/api/v1/query/arrow` endpoint using the `apache-arrow` library. Configure via the `arc.resultFormat` setting (default: `json`). Arrow format is significantly faster for large result sets.
- **Active Database in Status Bar**: The status bar now shows the active database alongside the connection name.

### Fixed
- **SQL Injection in Generated Queries**: Table and database names in generated SQL (schema, preview, stats, etc.) are now properly quoted using `quoteIdentifier()` to prevent injection via specially-crafted measurement names.
- **Notebook Variable Injection**: Variable substitution in Arc Notebooks now escapes single quotes in string values, preventing SQL injection through notebook variables.
- **Completion Provider Performance**: Database/table completions are now cached for 30 seconds with request deduplication, eliminating redundant network requests on every keystroke.
- **Webview Content Security Policy**: All webviews (query results, notebooks) now include a strict CSP with nonce-based script authorization. Chart.js is bundled locally instead of loaded from a CDN, improving security and offline reliability.
- **Query Timeout Setting**: The `arc.queryTimeout` configuration setting is now actually read and applied (was previously hardcoded to 30s).
- **Double Health Check**: Removed duplicate `healthCheck()` call when connecting to a server.
- **Alert Condition Equality**: Alert `equals`/`not_equals` conditions now use strict string comparison instead of loose `==` which caused false positives (e.g., `0 == ""`).
- **Alert Timer Memory Leak**: Alert timer callbacks now self-cleanup if the alert was deleted while a check was in-flight. Minimum check interval of 10 seconds is enforced to prevent server overload.
- **TypeScript Deprecation**: Updated `moduleResolution` from deprecated `node` to `Node16` for TypeScript 7.0 compatibility.

### Changed
- Extracted shared `escapeHtml`, `quoteIdentifier`, and `escapeSqlString` utilities to reduce code duplication.
- Extracted `requireConnectedClient()` helper to replace ~15 duplicate connection-check patterns.
- Removed redundant error detail blocks that duplicated messages already produced by the error handler.

## [0.2.1] - 2025-11-28

### Fixed
- **Token Rotation Copy Bug**: Fixed issue where clicking "Copy Token" after rotating a token did not copy the new token to clipboard. The extension was looking for `response.token` but the Arc API returns the new token in `response.new_token`.

## [0.1.9] - 2024-10-21

### ⚠️ BREAKING CHANGES
- **API Endpoint Standardization**: All Arc API endpoints migrated to `/api/v1/...` pattern
- **Requires Arc v1.0.0+**: This version requires Arc Core v1.0.0 or later
- **Backwards Incompatible**: Will not work with pre-v1.0 Arc servers

### Changed
- Updated all API client calls to standardized `/api/v1/...` endpoints
- Query endpoints: `/query` → `/api/v1/query`
- Write endpoints: `/write/v1/msgpack` → `/api/v1/write/msgpack`
- Auth endpoints: `/auth/*` → `/api/v1/auth/*`
- Measurements: `/measurements` → `/api/v1/measurements`
- Metrics: `/metrics` → `/api/v1/metrics`
- Updated CSV import to use `/api/v1/write/msgpack`
- Updated data generator to use `/api/v1/write/msgpack`

### Migration
If upgrading from pre-v1.0 Arc server:
1. Upgrade Arc Core to v1.0.0 or later
2. Update extension to v0.1.9
3. Reconnect to Arc server
4. Existing saved connections and queries work automatically

## [0.1.8] - 2024-10-21

### Fixed
- Commands not registered - runtime dependencies now included in VSIX
- Extension activation with `onStartupFinished` event
- Activity bar icon format (PNG)

## [0.1.7] - 2024-10-21

### Fixed
- Data provider registration error
- Activity bar icon display

## [0.1.6] - 2024-10-21

### Improved
- Connection error handling with detailed messages
- Extension icon sizing (128x128)
- Logging for debugging

## [0.1.5] - 2024-10-21

### Improved
- Error handling infrastructure

## [0.1.4] - 2024-10-21

### Added
- **Parameterized Queries**: Variables section in notebooks for dynamic query substitution
- **CSV Import**: High-performance CSV import with MessagePack columnar format
- **Bulk Data Generator**: Generate realistic test data with 5 built-in presets
- **Alerting & Monitoring**: Create real-time alerts based on query results
- **Notebook Enhancements**: Run all cells, export to Markdown
- **Dark Mode Support**: Complete theme adaptation

### Improved
- Data ingestion performance: 25-35% faster
- Enhanced notebook UI and cell editing
- Chart visualization with auto-detection

### Fixed
- Schema queries for Arc compatibility
- Notebook cell editing and deletion
- Alert deletion error handling

## [0.1.3] - 2024-10-19

### Added
- Query History and Saved Queries
- Schema Explorer enhancements
- Export results (CSV, JSON, Markdown)
- Chart visualization
- SQL auto-completion
- Arc Notebooks support

## [0.1.2] - 2024-10-15

### Added
- Connection and token management
- Arc Explorer tree view
- Server token operations

## [0.1.1] - 2024-10-14

### Added
- Query execution
- Health check and metrics

## [0.1.0] - 2024-10-13

### Added
- Initial release
