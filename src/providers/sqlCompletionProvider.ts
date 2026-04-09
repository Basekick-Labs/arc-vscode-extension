import * as vscode from 'vscode';
import { ConnectionManager } from '../utils/connectionManager';

export class SqlCompletionProvider implements vscode.CompletionItemProvider {
  private databaseCache: vscode.CompletionItem[] | null = null;
  private tableCache: vscode.CompletionItem[] | null = null;
  private cacheTimestamp: number = 0;
  private refreshPromise: Promise<void> | null = null;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(private connectionManager: ConnectionManager) {}

  /**
   * Clear cached completions (call when connection changes or explorer refreshes)
   */
  clearCache(): void {
    this.databaseCache = null;
    this.tableCache = null;
    this.cacheTimestamp = 0;
    this.refreshPromise = null;
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {
    const items: vscode.CompletionItem[] = [];

    // Add SQL keywords
    items.push(...this.getSqlKeywords());

    // Add DuckDB/Arc specific functions
    items.push(...this.getDuckDbFunctions());

    // Add table/database completions if connected (with caching)
    if (this.connectionManager.isConnected()) {
      if (token.isCancellationRequested) { return items; }

      try {
        await this.ensureCachePopulated();
        if (this.databaseCache) {
          items.push(...this.databaseCache);
        }
        if (this.tableCache) {
          items.push(...this.tableCache);
        }
      } catch (error) {
        // Silently fail if can't get completions
      }
    }

    // Add snippets
    items.push(...this.getSnippets());

    return items;
  }

  private async ensureCachePopulated(): Promise<void> {
    const now = Date.now();
    if (this.databaseCache && this.tableCache && (now - this.cacheTimestamp) < SqlCompletionProvider.CACHE_TTL_MS) {
      return; // Cache is fresh
    }

    // Deduplicate concurrent refreshes
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshCache();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async refreshCache(): Promise<void> {
    const client = this.connectionManager.getActiveClient();
    if (!client) { return; }

    // Fetch databases
    try {
      const result = await client.executeQuery({
        query: 'SHOW DATABASES',
        format: 'json'
      });

      this.databaseCache = result.rows.map((row: any) => {
        const dbName = row[0];
        const item = new vscode.CompletionItem(dbName, vscode.CompletionItemKind.Module);
        item.detail = 'Database';
        item.insertText = dbName;
        return item;
      });
    } catch {
      this.databaseCache = [];
    }

    // Fetch tables from all databases
    const activeDatabase = this.connectionManager.getActiveDatabase();
    const tableItems: vscode.CompletionItem[] = [];

    if (this.databaseCache) {
      for (const dbItem of this.databaseCache) {
        const dbName = dbItem.label as string;
        try {
          const tables = await client.executeQuery({
            query: `SHOW TABLES FROM ${dbName}`,
            format: 'json'
          });

          for (const tableRow of tables.rows) {
            const tableName = tableRow[1]; // table_name is column index 1
            const fullName = `${dbName}.${tableName}`;

            const item = new vscode.CompletionItem(fullName, vscode.CompletionItemKind.Class);
            item.detail = `Table in ${dbName}`;
            item.insertText = fullName;
            item.sortText = `1_${fullName}`;
            tableItems.push(item);

            // Short form - higher priority when active database matches
            const shortItem = new vscode.CompletionItem(tableName, vscode.CompletionItemKind.Class);
            shortItem.detail = `Table (${dbName})`;
            shortItem.insertText = tableName;
            shortItem.sortText = activeDatabase === dbName ? `0_${tableName}` : `1_${tableName}`;
            tableItems.push(shortItem);
          }
        } catch {
          // Skip if can't get tables for this database
        }
      }
    }

    this.tableCache = tableItems;
    this.cacheTimestamp = Date.now();
  }

  private getSqlKeywords(): vscode.CompletionItem[] {
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT',
      'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP',
      'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN',
      'ON', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL',
      'DISTINCT', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
      'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
      'NOW', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
      'INTERVAL', 'DESC', 'ASC'
    ];

    return keywords.map(keyword => {
      const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
      item.insertText = keyword;
      return item;
    });
  }

  private getDuckDbFunctions(): vscode.CompletionItem[] {
    const functions = [
      {
        name: 'time_bucket',
        detail: 'time_bucket(interval, timestamp)',
        documentation: 'Bucket timestamps into intervals (e.g., 5 minutes, 1 hour)',
        snippet: 'time_bucket(INTERVAL \'${1:5 minutes}\', ${2:time})'
      },
      {
        name: 'epoch_ms',
        detail: 'epoch_ms(timestamp)',
        documentation: 'Convert timestamp to milliseconds since epoch',
        snippet: 'epoch_ms(${1:time})'
      },
      {
        name: 'strftime',
        detail: 'strftime(timestamp, format)',
        documentation: 'Format timestamp as string',
        snippet: 'strftime(${1:time}, \'${2:%Y-%m-%d %H:%M:%S}\')'
      },
      {
        name: 'date_trunc',
        detail: 'date_trunc(part, timestamp)',
        documentation: 'Truncate timestamp to specified part',
        snippet: 'date_trunc(\'${1|second,minute,hour,day,month,year|}\', ${2:time})'
      },
      {
        name: 'array_agg',
        detail: 'array_agg(column)',
        documentation: 'Aggregate values into an array',
        snippet: 'array_agg(${1:column})'
      }
    ];

    return functions.map(func => {
      const item = new vscode.CompletionItem(func.name, vscode.CompletionItemKind.Function);
      item.detail = func.detail;
      item.documentation = new vscode.MarkdownString(func.documentation);
      item.insertText = new vscode.SnippetString(func.snippet);
      return item;
    });
  }

  private getSnippets(): vscode.CompletionItem[] {
    const snippets = [
      {
        label: 'select-limit',
        detail: 'SELECT with LIMIT',
        snippet: 'SELECT ${1:*}\nFROM ${2:table}\nLIMIT ${3:100};'
      },
      {
        label: 'select-where-time',
        detail: 'SELECT with time filter',
        snippet: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE time > NOW() - INTERVAL \'${3:1 hour}\'\nLIMIT ${4:100};'
      },
      {
        label: 'select-timebucket',
        detail: 'Time-bucketed aggregation',
        snippet: 'SELECT\n  time_bucket(INTERVAL \'${1:5 minutes}\', time) as bucket,\n  ${2:host},\n  AVG(${3:value}) as avg_value\nFROM ${4:table}\nWHERE time > NOW() - INTERVAL \'${5:1 hour}\'\nGROUP BY bucket, ${2:host}\nORDER BY bucket DESC\nLIMIT ${6:1000};'
      },
      {
        label: 'select-window',
        detail: 'Window function (moving average)',
        snippet: 'SELECT\n  time,\n  ${1:value},\n  AVG(${1:value}) OVER (\n    ORDER BY time\n    ROWS BETWEEN 5 PRECEDING AND CURRENT ROW\n  ) as moving_avg\nFROM ${2:table}\nORDER BY time DESC\nLIMIT ${3:100};'
      },
      {
        label: 'select-join',
        detail: 'JOIN two tables',
        snippet: 'SELECT\n  a.${1:column},\n  b.${2:column}\nFROM ${3:table1} a\nJOIN ${4:table2} b ON a.${5:id} = b.${5:id}\nWHERE ${6:condition}\nLIMIT ${7:100};'
      },
      {
        label: 'select-count-group',
        detail: 'COUNT with GROUP BY',
        snippet: 'SELECT\n  ${1:column},\n  COUNT(*) as count\nFROM ${2:table}\nGROUP BY ${1:column}\nORDER BY count DESC\nLIMIT ${3:20};'
      },
      {
        label: 'select-today',
        detail: 'Query today\'s data',
        snippet: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE time >= CURRENT_DATE\nORDER BY time DESC\nLIMIT ${3:100};'
      },
      {
        label: 'select-daterange',
        detail: 'Query date range',
        snippet: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE time BETWEEN \'${3:2025-01-01}\' AND \'${4:2025-01-31}\'\nORDER BY time DESC\nLIMIT ${5:100};'
      }
    ];

    return snippets.map(snip => {
      const item = new vscode.CompletionItem(snip.label, vscode.CompletionItemKind.Snippet);
      item.detail = snip.detail;
      item.insertText = new vscode.SnippetString(snip.snippet);
      item.documentation = new vscode.MarkdownString('```sql\n' + snip.snippet.replace(/\$\{[^}]+\}/g, '...') + '\n```');
      item.sortText = `2_${snip.label}`; // Snippets appear after tables
      return item;
    });
  }
}
