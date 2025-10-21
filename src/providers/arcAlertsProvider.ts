import * as vscode from 'vscode';
import { AlertManager, Alert, AlertTrigger } from '../utils/alertManager';

export class AlertTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly type: 'category' | 'alert' | 'trigger',
    public readonly data?: Alert | AlertTrigger
  ) {
    super(label, collapsibleState);
    this.contextValue = type;

    if (type === 'alert' && data) {
      const alert = data as Alert;
      this.description = alert.enabled ? '✓ Enabled' : '○ Disabled';
      this.iconPath = new vscode.ThemeIcon(
        alert.enabled ? 'bell' : 'bell-slash',
        alert.enabled ? new vscode.ThemeColor('charts.green') : undefined
      );
      this.tooltip = `${alert.name}\nQuery: ${alert.query}\nInterval: ${alert.checkIntervalMs / 1000}s\nTriggered: ${alert.triggeredCount} times`;
    } else if (type === 'trigger' && data) {
      const trigger = data as AlertTrigger;
      const date = new Date(trigger.timestamp);
      this.description = date.toLocaleString();
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
      this.tooltip = trigger.message;
    }
  }
}

export class ArcAlertsProvider implements vscode.TreeDataProvider<AlertTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<AlertTreeItem | undefined | null | void> = new vscode.EventEmitter<AlertTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<AlertTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(private alertManager: AlertManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AlertTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AlertTreeItem): Promise<AlertTreeItem[]> {
    if (!element) {
      // Root level - show categories
      return [
        new AlertTreeItem('Active Alerts', vscode.TreeItemCollapsibleState.Expanded, 'category'),
        new AlertTreeItem('Recent Triggers', vscode.TreeItemCollapsibleState.Collapsed, 'category')
      ];
    }

    if (element.type === 'category') {
      if (element.label === 'Active Alerts') {
        const alerts = this.alertManager.getAlerts();
        return alerts.map(alert =>
          new AlertTreeItem(
            alert.name,
            vscode.TreeItemCollapsibleState.None,
            'alert',
            alert
          )
        );
      } else if (element.label === 'Recent Triggers') {
        const triggers = this.alertManager.getTriggers().slice(0, 50); // Last 50
        return triggers.map(trigger =>
          new AlertTreeItem(
            trigger.alertName,
            vscode.TreeItemCollapsibleState.None,
            'trigger',
            trigger
          )
        );
      }
    }

    return [];
  }
}
