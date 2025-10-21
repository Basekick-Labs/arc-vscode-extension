import * as vscode from 'vscode';
import { ArcConnection } from '../types';
import { ArcClient } from '../api/arcClient';

export class ConnectionManager {
  private static instance: ConnectionManager;
  private activeConnection?: ArcConnection;
  private activeClient?: ArcClient;
  private connections: Map<string, ArcConnection> = new Map();
  private secrets: vscode.SecretStorage;
  private context: vscode.ExtensionContext;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.secrets = context.secrets;
    this.loadConnections();
  }

  static initialize(context: vscode.ExtensionContext): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager(context);
    }
    return ConnectionManager.instance;
  }

  static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      throw new Error('ConnectionManager not initialized');
    }
    return ConnectionManager.instance;
  }

  /**
   * Load saved connections from workspace state
   */
  private async loadConnections(): Promise<void> {
    const savedConnections = this.context.globalState.get<ArcConnection[]>('arc.connections', []);
    savedConnections.forEach(conn => {
      this.connections.set(conn.id, conn);
    });
  }

  /**
   * Save connections to workspace state
   */
  private async saveConnections(): Promise<void> {
    const connections = Array.from(this.connections.values());
    await this.context.globalState.update('arc.connections', connections);
  }

  /**
   * Add a new connection
   */
  async addConnection(connection: ArcConnection, token?: string): Promise<void> {
    this.connections.set(connection.id, connection);
    await this.saveConnections();

    if (token) {
      await this.saveToken(connection.id, token);
    }
  }

  /**
   * Remove a connection
   */
  async removeConnection(connectionId: string): Promise<void> {
    this.connections.delete(connectionId);
    await this.saveConnections();
    await this.deleteToken(connectionId);

    if (this.activeConnection?.id === connectionId) {
      this.activeConnection = undefined;
      this.activeClient = undefined;
    }
  }

  /**
   * Get all connections
   */
  getConnections(): ArcConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get a specific connection by ID
   */
  getConnection(connectionId: string): ArcConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Set the active connection
   */
  async setActiveConnection(connectionId: string): Promise<ArcClient> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    this.activeConnection = connection;

    const token = await this.getToken(connectionId);
    this.activeClient = new ArcClient(connection, token);

    // Verify connection works
    await this.activeClient.healthCheck();

    return this.activeClient;
  }

  /**
   * Get the active connection
   */
  getActiveConnection(): ArcConnection | undefined {
    return this.activeConnection;
  }

  /**
   * Get the active client
   */
  getActiveClient(): ArcClient | undefined {
    return this.activeClient;
  }

  /**
   * Disconnect (clear active connection)
   */
  disconnect(): void {
    this.activeConnection = undefined;
    this.activeClient = undefined;
  }

  /**
   * Check if there's an active connection
   */
  isConnected(): boolean {
    return this.activeConnection !== undefined && this.activeClient !== undefined;
  }

  /**
   * Save token securely
   */
  async saveToken(connectionId: string, token: string): Promise<void> {
    const key = `arc.token.${connectionId}`;
    await this.secrets.store(key, token);

    // Update active client if this is the active connection
    if (this.activeConnection?.id === connectionId && this.activeClient) {
      this.activeClient.setToken(token);
    }
  }

  /**
   * Get token from secure storage
   */
  async getToken(connectionId: string): Promise<string | undefined> {
    const key = `arc.token.${connectionId}`;
    return await this.secrets.get(key);
  }

  /**
   * Delete token from secure storage
   */
  async deleteToken(connectionId: string): Promise<void> {
    const key = `arc.token.${connectionId}`;
    await this.secrets.delete(key);
  }

  /**
   * Create a new connection with default settings
   */
  createDefaultConnection(name?: string): ArcConnection {
    const config = vscode.workspace.getConfiguration('arc');

    return {
      id: this.generateId(),
      name: name || 'Arc Server',
      host: config.get('defaultHost', 'localhost'),
      port: config.get('defaultPort', 8000),
      protocol: config.get('defaultProtocol', 'http')
    };
  }

  /**
   * Generate a unique connection ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
