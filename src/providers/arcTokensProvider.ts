import * as vscode from 'vscode';
import { ConnectionManager } from '../utils/connectionManager';

export class ArcTokensProvider implements vscode.TreeDataProvider<TokenTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TokenTreeItem | undefined | null | void> = new vscode.EventEmitter<TokenTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TokenTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private connectionManager: ConnectionManager;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TokenTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TokenTreeItem): Promise<TokenTreeItem[]> {
    if (!this.connectionManager.isConnected()) {
      return [new TokenTreeItem('Not connected', vscode.TreeItemCollapsibleState.None, 'info')];
    }

    const client = this.connectionManager.getActiveClient();
    if (!client) {
      return [];
    }

    try {
      const tokens = await client.listTokens();

      if (tokens.length === 0) {
        return [new TokenTreeItem('No tokens found', vscode.TreeItemCollapsibleState.None, 'info')];
      }

      return tokens.map(token => new TokenTreeItem(
        token.name || `Token ${token.id}`,
        vscode.TreeItemCollapsibleState.None,
        'token',
        token
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to load tokens: ${message}`);
      return [new TokenTreeItem(`Error: ${message}`, vscode.TreeItemCollapsibleState.None, 'error')];
    }
  }
}

export class TokenTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly tokenData?: any
  ) {
    super(label, collapsibleState);

    if (tokenData) {
      this.tooltip = this.buildTooltip();
      this.description = this.buildDescription();
      this.iconPath = new vscode.ThemeIcon('key');
    } else if (contextValue === 'error') {
      this.iconPath = new vscode.ThemeIcon('error');
    } else {
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }

  private buildTooltip(): string {
    if (!this.tokenData) {
      return this.label;
    }

    const parts = [
      `ID: ${this.tokenData.id}`,
      `Name: ${this.tokenData.name}`,
    ];

    if (this.tokenData.description) {
      parts.push(`Description: ${this.tokenData.description}`);
    }

    if (this.tokenData.created_at) {
      parts.push(`Created: ${this.tokenData.created_at}`);
    }

    if (this.tokenData.last_used_at) {
      parts.push(`Last Used: ${this.tokenData.last_used_at}`);
    }

    parts.push(`Enabled: ${this.tokenData.enabled ? 'Yes' : 'No'}`);

    return parts.join('\n');
  }

  private buildDescription(): string {
    if (!this.tokenData) {
      return '';
    }

    const parts = [];

    if (this.tokenData.id) {
      parts.push(`#${this.tokenData.id}`);
    }

    if (!this.tokenData.enabled) {
      parts.push('(disabled)');
    }

    return parts.join(' ');
  }
}
