import * as vscode from 'vscode';
import { ConnectionManager } from '../utils/connectionManager';
import { ArcConnection } from '../types';

export class ArcConnectionsProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ConnectionTreeItem | undefined | null | void> = new vscode.EventEmitter<ConnectionTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ConnectionTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private connectionManager: ConnectionManager;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ConnectionTreeItem): Promise<ConnectionTreeItem[]> {
    if (element) {
      return [];
    }

    const connections = this.connectionManager.getConnections();
    const activeConnection = this.connectionManager.getActiveConnection();

    if (connections.length === 0) {
      return [new ConnectionTreeItem(
        'No connections',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        false
      )];
    }

    return connections.map(conn => new ConnectionTreeItem(
      conn.name,
      vscode.TreeItemCollapsibleState.None,
      conn,
      activeConnection?.id === conn.id
    ));
  }
}

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly connection?: ArcConnection,
    public readonly isActive: boolean = false
  ) {
    super(label, collapsibleState);

    if (connection) {
      this.tooltip = `${connection.protocol}://${connection.host}:${connection.port}\nClick to ${isActive ? 'disconnect' : 'connect'}`;
      this.description = isActive ? '(active)' : '';
      this.contextValue = 'connection';
      this.iconPath = new vscode.ThemeIcon(
        isActive ? 'debug-disconnect' : 'plug',
        isActive ? new vscode.ThemeColor('charts.green') : undefined
      );
      // Make connection items clickable
      this.command = {
        command: isActive ? 'arc.disconnect' : 'arc.activateConnection',
        title: isActive ? 'Disconnect' : 'Connect',
        arguments: [connection]
      };
    } else {
      this.contextValue = 'info';
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }
}
