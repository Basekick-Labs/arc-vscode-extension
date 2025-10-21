import * as vscode from 'vscode';
import { QueryStorage, QueryHistoryItem, SavedQuery } from '../utils/queryStorage';

export class ArcQueriesProvider implements vscode.TreeDataProvider<QueryTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<QueryTreeItem | undefined | null | void> = new vscode.EventEmitter<QueryTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<QueryTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(private queryStorage: QueryStorage) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: QueryTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: QueryTreeItem): Promise<QueryTreeItem[]> {
    if (!element) {
      // Root level - show categories
      return [
        new QueryTreeItem(
          'Saved Queries',
          vscode.TreeItemCollapsibleState.Expanded,
          'category',
          undefined,
          'saved'
        ),
        new QueryTreeItem(
          'Query History',
          vscode.TreeItemCollapsibleState.Collapsed,
          'category',
          undefined,
          'history'
        )
      ];
    }

    if (element.contextValue === 'category') {
      if (element.categoryType === 'saved') {
        return this.getSavedQueriesItems();
      } else if (element.categoryType === 'history') {
        return this.getHistoryItems();
      }
    }

    return [];
  }

  private getSavedQueriesItems(): QueryTreeItem[] {
    const saved = this.queryStorage.getSavedQueries();

    if (saved.length === 0) {
      return [
        new QueryTreeItem(
          'No saved queries',
          vscode.TreeItemCollapsibleState.None,
          'empty',
          undefined
        )
      ];
    }

    return saved.map(query => {
      const item = new QueryTreeItem(
        query.name,
        vscode.TreeItemCollapsibleState.None,
        'savedQuery',
        query
      );

      item.description = query.description || this.truncateQuery(query.query);
      item.tooltip = this.buildSavedQueryTooltip(query);
      item.iconPath = new vscode.ThemeIcon('bookmark');
      item.command = {
        command: 'arc.openQuery',
        title: 'Open Query',
        arguments: [query.query]
      };

      return item;
    });
  }

  private getHistoryItems(): QueryTreeItem[] {
    const history = this.queryStorage.getHistory();

    if (history.length === 0) {
      return [
        new QueryTreeItem(
          'No query history',
          vscode.TreeItemCollapsibleState.None,
          'empty',
          undefined
        )
      ];
    }

    return history.slice(0, 50).map(item => { // Show only last 50
      const treeItem = new QueryTreeItem(
        this.truncateQuery(item.query),
        vscode.TreeItemCollapsibleState.None,
        'historyQuery',
        undefined,
        undefined,
        item
      );

      treeItem.description = this.formatTimestamp(item.timestamp);
      treeItem.tooltip = this.buildHistoryTooltip(item);
      treeItem.iconPath = new vscode.ThemeIcon(
        item.success ? 'pass' : 'error',
        item.success ? undefined : new vscode.ThemeColor('errorForeground')
      );
      treeItem.command = {
        command: 'arc.openQuery',
        title: 'Open Query',
        arguments: [item.query]
      };

      return treeItem;
    });
  }

  private truncateQuery(query: string): string {
    const cleaned = query.trim().replace(/\s+/g, ' ');
    return cleaned.length > 60 ? cleaned.substring(0, 60) + '...' : cleaned;
  }

  private formatTimestamp(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) { // Less than 1 minute
      return 'just now';
    } else if (diff < 3600000) { // Less than 1 hour
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    } else if (diff < 86400000) { // Less than 1 day
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    } else {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }
  }

  private buildSavedQueryTooltip(query: SavedQuery): string {
    const parts = [
      `Name: ${query.name}`,
      query.description ? `Description: ${query.description}` : '',
      `Created: ${new Date(query.createdAt).toLocaleString()}`,
      query.tags && query.tags.length > 0 ? `Tags: ${query.tags.join(', ')}` : '',
      '',
      'Query:',
      query.query
    ];

    return parts.filter(p => p).join('\n');
  }

  private buildHistoryTooltip(item: QueryHistoryItem): string {
    const parts = [
      `Executed: ${new Date(item.timestamp).toLocaleString()}`,
      item.database ? `Database: ${item.database}` : '',
      item.executionTime ? `Execution Time: ${item.executionTime}ms` : '',
      item.rowCount !== undefined ? `Rows: ${item.rowCount}` : '',
      `Status: ${item.success ? 'Success' : 'Error'}`,
      item.error ? `Error: ${item.error}` : '',
      '',
      'Query:',
      item.query
    ];

    return parts.filter(p => p).join('\n');
  }
}

export class QueryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly savedQuery?: SavedQuery,
    public readonly categoryType?: 'saved' | 'history',
    public readonly historyItem?: QueryHistoryItem
  ) {
    super(label, collapsibleState);
  }
}
