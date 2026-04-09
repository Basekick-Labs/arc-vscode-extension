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
 * Escape a string value for use in a SQL literal. Single quotes are doubled.
 *
 * Example: escapeSqlString("it's") => "it''s"
 */
export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
