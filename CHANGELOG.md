# Change Log

All notable changes to the "Arc Database Manager" extension will be documented in this file.

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
