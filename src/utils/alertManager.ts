import * as vscode from 'vscode';
import { ArcClient } from '../api/arcClient';

export interface Alert {
  id: string;
  name: string;
  query: string;
  condition: 'greater_than' | 'less_than' | 'equals' | 'not_equals' | 'contains';
  threshold: number | string;
  checkIntervalMs: number;
  enabled: boolean;
  lastCheck?: number;
  lastResult?: any;
  triggeredCount: number;
  createdAt: number;
}

export interface AlertTrigger {
  alertId: string;
  alertName: string;
  timestamp: number;
  value: any;
  message: string;
}

export class AlertManager {
  private alerts: Alert[] = [];
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private triggers: AlertTrigger[] = [];
  private maxTriggerHistory = 100;
  private static readonly MIN_CHECK_INTERVAL_MS = 10_000;

  constructor(
    private context: vscode.ExtensionContext,
    private getClient: () => ArcClient | undefined
  ) {
    this.loadAlerts();
  }

  private loadAlerts(): void {
    const stored = this.context.globalState.get<Alert[]>('arc.alerts', []);
    this.alerts = stored;

    // Start enabled alerts
    this.alerts.filter(a => a.enabled).forEach(alert => {
      this.startAlert(alert);
    });
  }

  private async saveAlerts(): Promise<void> {
    await this.context.globalState.update('arc.alerts', this.alerts);
  }

  async createAlert(alert: Omit<Alert, 'id' | 'triggeredCount' | 'createdAt'>): Promise<Alert> {
    const newAlert: Alert = {
      ...alert,
      id: this.generateId(),
      checkIntervalMs: Math.max(alert.checkIntervalMs, AlertManager.MIN_CHECK_INTERVAL_MS),
      triggeredCount: 0,
      createdAt: Date.now()
    };

    this.alerts.push(newAlert);
    await this.saveAlerts();

    if (newAlert.enabled) {
      this.startAlert(newAlert);
    }

    return newAlert;
  }

  async updateAlert(id: string, updates: Partial<Alert>): Promise<void> {
    const alert = this.alerts.find(a => a.id === id);
    if (!alert) {
      throw new Error(`Alert ${id} not found`);
    }

    // Stop if running
    this.stopAlert(id);

    // Update alert with minimum interval enforcement
    Object.assign(alert, updates);
    if (alert.checkIntervalMs < AlertManager.MIN_CHECK_INTERVAL_MS) {
      alert.checkIntervalMs = AlertManager.MIN_CHECK_INTERVAL_MS;
    }
    await this.saveAlerts();

    // Restart if enabled
    if (alert.enabled) {
      this.startAlert(alert);
    }
  }

  async deleteAlert(id: string): Promise<void> {
    this.stopAlert(id);
    this.alerts = this.alerts.filter(a => a.id !== id);
    await this.saveAlerts();
  }

  getAlerts(): Alert[] {
    return [...this.alerts];
  }

  getAlert(id: string): Alert | undefined {
    return this.alerts.find(a => a.id === id);
  }

  getTriggers(): AlertTrigger[] {
    return [...this.triggers].reverse(); // Most recent first
  }

  clearTriggers(): void {
    this.triggers = [];
  }

  private startAlert(alert: Alert): void {
    // Stop existing timer if any
    this.stopAlert(alert.id);

    // Create new timer with self-cleanup guard
    const timer = setInterval(async () => {
      if (!this.alerts.find(a => a.id === alert.id)) {
        this.stopAlert(alert.id);
        return;
      }
      await this.checkAlert(alert);
    }, alert.checkIntervalMs);

    this.timers.set(alert.id, timer);

    // Run immediately
    this.checkAlert(alert);
  }

  private stopAlert(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  private async checkAlert(alert: Alert): Promise<void> {
    try {
      const client = this.getClient();
      if (!client) {
        return;
      }

      // Execute query
      const result = await client.executeQuery({ query: alert.query, format: 'json' });

      if (!result.rows || result.rows.length === 0) {
        return;
      }

      // Get first row, first column value
      const value = result.rows[0][0];

      // Update last check
      const alertRef = this.alerts.find(a => a.id === alert.id);
      if (alertRef) {
        alertRef.lastCheck = Date.now();
        alertRef.lastResult = value;
      }

      // Check condition
      const triggered = this.evaluateCondition(value, alert.condition, alert.threshold);

      if (triggered) {
        const trigger: AlertTrigger = {
          alertId: alert.id,
          alertName: alert.name,
          timestamp: Date.now(),
          value,
          message: `Alert "${alert.name}" triggered: ${value} ${alert.condition.replace('_', ' ')} ${alert.threshold}`
        };

        this.triggers.push(trigger);

        // Trim history
        if (this.triggers.length > this.maxTriggerHistory) {
          this.triggers = this.triggers.slice(-this.maxTriggerHistory);
        }

        // Increment trigger count
        if (alertRef) {
          alertRef.triggeredCount++;
          await this.saveAlerts();
        }

        // Show notification
        vscode.window.showWarningMessage(
          `🔔 ${trigger.message}`,
          'View Alerts',
          'Dismiss'
        ).then(action => {
          if (action === 'View Alerts') {
            vscode.commands.executeCommand('arc.showAlerts');
          }
        });
      }
    } catch (error) {
      console.error(`Error checking alert ${alert.name}:`, error);
    }
  }

  private evaluateCondition(value: any, condition: string, threshold: number | string): boolean {
    switch (condition) {
      case 'greater_than':
        return Number(value) > Number(threshold);
      case 'less_than':
        return Number(value) < Number(threshold);
      case 'equals':
        return String(value) === String(threshold);
      case 'not_equals':
        return String(value) !== String(threshold);
      case 'contains':
        return String(value).includes(String(threshold));
      default:
        return false;
    }
  }

  private generateId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  stopAll(): void {
    this.timers.forEach((timer, id) => {
      clearInterval(timer);
    });
    this.timers.clear();
  }
}
