/**
 * Shared utilities for SQL and HTML operations
 */

/**
 * Escape HTML special characters to prevent XSS in webviews.
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Quote a SQL identifier (table name, database name, column name) using
 * double-quote syntax. Embedded double-quotes are escaped by doubling them.
 * This prevents SQL injection when interpolating user-controlled names.
 *
 * Example: quoteIdentifier('my"table') => '"my""table"'
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Names Arc itself accepts for measurements: a letter followed by letters,
 * digits, underscores or hyphens (internal/api/lineprotocol.go).
 */
const VALID_ARC_NAME = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Keep only well-formed identifiers from a server response.
 *
 * getDatabases()/getMeasurements() map raw rows into names that then flow into
 * generated SQL and tree items. A malformed or hostile response could yield
 * undefined, numbers or objects there. Identifiers are quoted before use, so
 * this is defence in depth rather than the only guard -- but dropping junk
 * early keeps it out of the UI and out of query text.
 */
export function filterValidNames(names: unknown[]): string[] {
  return names.filter((n): n is string => typeof n === 'string' && VALID_ARC_NAME.test(n));
}

/**
 * Escape a string value for use in a SQL literal. Single quotes are doubled.
 *
 * Example: escapeSqlString("it's") => "it''s"
 */
export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
