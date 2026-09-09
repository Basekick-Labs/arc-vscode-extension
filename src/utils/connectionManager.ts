import * as vscode from 'vscode';
import { ArcConnection, ArcHealthStatus } from '../types';
import { ArcClient } from '../api/arcClient';

export class ConnectionManager {
  private static instance: ConnectionManager;
  private activeConnection?: ArcConnection;
  private activeClient?: ArcClient;
  private activeDatabase?: string;
  private activeHealth?: ArcHealthStatus;
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
    this.activeDatabase = connection.database;

    const token = await this.getToken(connectionId);

    // A bearer token over plain http crosses the network in cleartext. Local
    // connections are the normal development case and not worth nagging about,
    // so warn only when the token actually leaves the machine.
    if (token && connection.protocol === 'http' && !ConnectionManager.isLoopback(connection.host)) {
      vscode.window.showWarningMessage(
        `Connection "${connection.name}" sends its token unencrypted over http to ${connection.host}. Use https if the server supports it.`
      );
    }

    const config = vscode.workspace.getConfiguration('arc');
    const timeout = config.get<number>('queryTimeout', 30000);
    this.activeClient = new ArcClient(connection, token, timeout);

    // Verify connection works. The response also carries the server's edition,
    // so keep it rather than discarding it -- this is the only place the
    // extension learns the tier, and it costs no extra request.
    this.activeHealth = await this.activeClient.healthCheck();

    return this.activeClient;
  }

  /**
   * True for hosts that never leave the machine, where plain http is fine.
   * Covers IPv6 loopback and ::ffff:127.0.0.1-style mapped addresses.
   */
  private static isLoopback(host: string): boolean {
    const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
    return (
      h === 'localhost' ||
      h === '::1' ||
      h.endsWith('.localhost') ||
      /^127\./.test(h) ||
      /^::ffff:127\./.test(h)
    );
  }

  /**
   * Health payload from the last successful connect, if any.
   */
  getActiveHealth(): ArcHealthStatus | undefined {
    return this.activeHealth;
  }

  /**
   * Short edition label for display, e.g. "OSS" or "Enterprise".
   *
   * Returns undefined when the server sent no license block at all, which is
   * the case for builds without the license client wired -- unknown, not OSS.
   */
  getEditionLabel(): string | undefined {
    const tier = this.activeHealth?.license?.tier;
    if (!tier) {
      return undefined;
    }
    return tier === 'oss' ? 'OSS' : tier.charAt(0).toUpperCase() + tier.slice(1);
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
   * Get the active database
   */
  getActiveDatabase(): string | undefined {
    return this.activeDatabase;
  }

  /**
   * Set the active database
   */
  setActiveDatabase(database: string): void {
    this.activeDatabase = database;
  }

  /**
   * Disconnect (clear active connection)
   */
  disconnect(): void {
    this.activeConnection = undefined;
    this.activeClient = undefined;
    this.activeDatabase = undefined;
    this.activeHealth = undefined;
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
