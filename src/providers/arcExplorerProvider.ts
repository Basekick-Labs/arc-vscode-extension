import * as vscode from 'vscode';
import { ConnectionManager } from '../utils/connectionManager';
import { ArcDatabase, ArcMeasurement } from '../types';
import { ArcAccessError, isScopedRefusal } from '../utils/arcErrors';

export class ArcExplorerProvider implements vscode.TreeDataProvider<ArcTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ArcTreeItem | undefined | null | void> = new vscode.EventEmitter<ArcTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ArcTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private connectionManager: ConnectionManager;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ArcTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ArcTreeItem): Promise<ArcTreeItem[]> {
    if (!this.connectionManager.isConnected()) {
      return [new ArcTreeItem('Not connected', vscode.TreeItemCollapsibleState.None, 'info')];
    }

    const client = this.connectionManager.getActiveClient();
    if (!client) {
      return [];
    }

    try {
      if (!element) {
        // Root level - show databases.
        //
        // Arc restricts reads per database, and refuses to list them all for
        // a token scoped to particular ones rather than returning a filtered
        // list — the same bar SHOW DATABASES applies. That is a normal state
        // for a tenant token, not a connection failure, and the tree can
        // still be useful: if the connection names a database, show that one
        // and let the user browse it.
        let databases: string[];
        try {
          databases = await client.getDatabases();
        } catch (error) {
          if (!isScopedRefusal(error)) {
            throw error;
          }
          const active = this.connectionManager.getActiveDatabase();
          if (!active) {
            // Nothing to fall back to: say what is wrong and what fixes it,
            // rather than an empty tree or a raw 403.
            return [new ArcTreeItem(
              'Token is scoped — set a database on this connection',
              vscode.TreeItemCollapsibleState.None,
              'scoped',
              { message: error.message }
            )];
          }
          databases = [active];
        }
        return databases.map(db => new ArcTreeItem(
          db,
          vscode.TreeItemCollapsibleState.Collapsed,
          'database',
          { database: db }
        ));
      } else if (element.contextValue === 'database') {
        // Database level - show measurements
        const database = element.metadata?.database;
        let measurements: ArcMeasurement[] | { name: string }[];
        try {
          measurements = await client.getMeasurements(database);
        } catch (error) {
          if (!isScopedRefusal(error)) {
            throw error;
          }
          // The token reads some databases but not this one. Say so on the
          // node the user expanded, so the rest of the tree stays usable.
          return [new ArcTreeItem(
            `No read access to '${database}' with this token`,
            vscode.TreeItemCollapsibleState.None,
            'scoped',
            { message: error.message }
          )];
        }

        if (measurements.length === 0) {
          return [new ArcTreeItem('No measurements', vscode.TreeItemCollapsibleState.None, 'info')];
        }

        return measurements.map(m => new ArcTreeItem(
          m.name,
          vscode.TreeItemCollapsibleState.None,
          'measurement',
          { database, measurement: m.name }
        ));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // An ArcAccessError already carries a sentence naming the fix; wrapping
      // it in "Failed to load Arc data" only buries that.
      if (error instanceof ArcAccessError) {
        vscode.window.showErrorMessage(message);
      } else {
        vscode.window.showErrorMessage(`Failed to load Arc data: ${message}`);
      }
      return [new ArcTreeItem(`Error: ${message}`, vscode.TreeItemCollapsibleState.None, 'error')];
    }

    return [];
  }
}

export class ArcTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly metadata?: any
  ) {
    super(label, collapsibleState);

    this.tooltip = this.getTooltip();
    this.iconPath = this.getIcon();
  }

  private getTooltip(): string {
    switch (this.contextValue) {
      case 'database':
        return `Database: ${this.label}`;
      case 'measurement':
        return `Measurement: ${this.label}`;
      case 'scoped':
        // The full explanation, so hovering the node says what to change
        // without needing the toast that is no longer shown for this case.
        return this.metadata?.message ?? this.label;
      default:
        return this.label;
    }
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.contextValue) {
      case 'database':
        return new vscode.ThemeIcon('database');
      case 'measurement':
        return new vscode.ThemeIcon('table');
      case 'error':
        return new vscode.ThemeIcon('error');
      case 'scoped':
        // A lock, not an error: the token is working as configured.
        return new vscode.ThemeIcon('lock');
      case 'info':
        return new vscode.ThemeIcon('info');
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }
}
