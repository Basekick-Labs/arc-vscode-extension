import * as vscode from 'vscode';
import { ConnectionManager } from '../utils/connectionManager';
import { ArcDatabase, ArcMeasurement } from '../types';

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
        // Root level - show databases
        const databases = await client.getDatabases();
        return databases.map(db => new ArcTreeItem(
          db,
          vscode.TreeItemCollapsibleState.Collapsed,
          'database',
          { database: db }
        ));
      } else if (element.contextValue === 'database') {
        // Database level - show measurements
        const database = element.metadata?.database;
        const measurements = await client.getMeasurements(database);

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
      vscode.window.showErrorMessage(`Failed to load Arc data: ${message}`);
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
      case 'info':
        return new vscode.ThemeIcon('info');
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }
}
