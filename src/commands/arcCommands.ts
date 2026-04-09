import * as vscode from 'vscode';
import { ConnectionManager } from '../utils/connectionManager';
import { ArcExplorerProvider } from '../providers/arcExplorerProvider';
import { ArcConnectionsProvider } from '../providers/arcConnectionsProvider';
import { ArcTokensProvider } from '../providers/arcTokensProvider';
import { ArcQueriesProvider } from '../providers/arcQueriesProvider';
import { QueryResultsView } from '../views/queryResultsView';
import { QueryStorage } from '../utils/queryStorage';
import { ArcConnection } from '../types';
import { ArcClient } from '../api/arcClient';
import { CSVImporter } from '../utils/csvImporter';
import { DataGenerator } from '../utils/dataGenerator';
import { AlertManager } from '../utils/alertManager';
import { ArcAlertsProvider } from '../providers/arcAlertsProvider';
import { quoteIdentifier } from '../utils/sqlUtils';

export class ArcCommands {
  private tokensProvider?: ArcTokensProvider;
  private queriesProvider?: ArcQueriesProvider;
  private queryStorage?: QueryStorage;
  private alertsProvider?: ArcAlertsProvider;
  private alertManager?: AlertManager;

  constructor(
    private connectionManager: ConnectionManager,
    private explorerProvider: ArcExplorerProvider,
    private connectionsProvider: ArcConnectionsProvider
  ) {}

  setTokensProvider(provider: ArcTokensProvider) {
    this.tokensProvider = provider;
  }

  setQueriesProvider(provider: ArcQueriesProvider, storage: QueryStorage) {
    this.queriesProvider = provider;
    this.queryStorage = storage;
  }

  setAlertsProvider(provider: ArcAlertsProvider, manager: AlertManager) {
    this.alertsProvider = provider;
    this.alertManager = manager;
  }

  /**
   * Check that we have an active connection and return the client, or show a warning.
   */
  private requireConnectedClient(): ArcClient | undefined {
    if (!this.connectionManager.isConnected()) {
      vscode.window.showWarningMessage('Please connect to an Arc server first');
      return undefined;
    }
    return this.connectionManager.getActiveClient();
  }

  /**
   * Connect to Arc server
   */
  async connect(): Promise<void> {
    try {
      // Get connection details from user
      const name = await vscode.window.showInputBox({
        prompt: 'Connection name',
        value: 'Arc Server',
        placeHolder: 'My Arc Server'
      });

      if (!name) {
        return;
      }

      const host = await vscode.window.showInputBox({
        prompt: 'Arc server host',
        value: 'localhost',
        placeHolder: 'localhost or IP address'
      });

      if (!host) {
        return;
      }

      const portStr = await vscode.window.showInputBox({
        prompt: 'Arc server port',
        value: '8000',
        placeHolder: '8000'
      });

      if (!portStr) {
        return;
      }

      const port = parseInt(portStr, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        vscode.window.showErrorMessage('Invalid port number');
        return;
      }

      const protocol = await vscode.window.showQuickPick(['http', 'https'], {
        placeHolder: 'Select protocol'
      });

      if (!protocol) {
        return;
      }

      // Ask for token
      const token = await vscode.window.showInputBox({
        prompt: 'Authentication token (optional - press Enter to skip)',
        password: true,
        placeHolder: 'Leave empty to create a new token'
      });

      const connection: ArcConnection = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name,
        host,
        port,
        protocol: protocol as 'http' | 'https'
      };

      // Save connection
      await this.connectionManager.addConnection(connection, token);

      // Set as active and test connection
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Connecting to Arc server...',
          cancellable: false
        },
        async () => {
          await this.connectionManager.setActiveConnection(connection.id);
        }
      );

      vscode.window.showInformationMessage(`Connected to ${name}`);

      // Refresh views
      this.explorerProvider.refresh();
      this.connectionsProvider.refresh();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Connection error details:', error);
      vscode.window.showErrorMessage(`Failed to connect: ${message}`);
    }
  }

  /**
   * Disconnect from Arc server
   */
  async disconnect(): Promise<void> {
    this.connectionManager.disconnect();
    this.explorerProvider.refresh();
    this.connectionsProvider.refresh();
    vscode.window.showInformationMessage('Disconnected from Arc server');
  }

  /**
   * Activate an existing connection
   */
  async activateConnection(connection: ArcConnection): Promise<void> {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Connecting to ${connection.name}...`,
          cancellable: false
        },
        async () => {
          await this.connectionManager.setActiveConnection(connection.id);
        }
      );

      vscode.window.showInformationMessage(`Connected to ${connection.name}`);

      // Refresh views
      this.explorerProvider.refresh();
      this.connectionsProvider.refresh();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Connection activation error details:', error);
      vscode.window.showErrorMessage(`Failed to connect to ${connection.name}: ${message}`);
    }
  }

  /**
   * Edit an existing connection
   */
  async editConnection(connection: ArcConnection): Promise<void> {
    try {
      // Get new connection details
      const name = await vscode.window.showInputBox({
        prompt: 'Connection name',
        value: connection.name,
        placeHolder: 'My Arc Server'
      });

      if (!name) {
        return;
      }

      const host = await vscode.window.showInputBox({
        prompt: 'Arc server host',
        value: connection.host,
        placeHolder: 'localhost or IP address'
      });

      if (!host) {
        return;
      }

      const portStr = await vscode.window.showInputBox({
        prompt: 'Arc server port',
        value: connection.port.toString(),
        placeHolder: '8000'
      });

      if (!portStr) {
        return;
      }

      const port = parseInt(portStr, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        vscode.window.showErrorMessage('Invalid port number');
        return;
      }

      const protocol = await vscode.window.showQuickPick(['http', 'https'], {
        placeHolder: 'Select protocol'
      });

      if (!protocol) {
        return;
      }

      // Update connection
      const updatedConnection: ArcConnection = {
        ...connection,
        name,
        host,
        port,
        protocol: protocol as 'http' | 'https'
      };

      await this.connectionManager.addConnection(updatedConnection);

      vscode.window.showInformationMessage(`Updated connection: ${name}`);

      // Refresh views
      this.connectionsProvider.refresh();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to edit connection: ${message}`);
    }
  }

  /**
   * Delete a connection
   */
  async deleteConnection(connection: ArcConnection): Promise<void> {
    try {
      if (!connection || !connection.id) {
        vscode.window.showErrorMessage('Invalid connection');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete connection "${connection.name}"?`,
        { modal: true },
        'Delete'
      );

      if (confirm !== 'Delete') {
        return;
      }

      // Remove the connection
      await this.connectionManager.removeConnection(connection.id);

      // Verify it was removed
      const connections = this.connectionManager.getConnections();
      const stillExists = connections.find(c => c.id === connection.id);

      if (stillExists) {
        throw new Error('Connection was not deleted properly');
      }

      vscode.window.showInformationMessage(`Deleted connection: ${connection.name}`);

      // Refresh views
      this.explorerProvider.refresh();
      this.connectionsProvider.refresh();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to delete connection: ${message}`);
      console.error('Delete connection error:', error);
    }
  }

  /**
   * Update token for a connection
   */
  async updateToken(connection?: ArcConnection): Promise<void> {
    try {
      let targetConnection = connection;

      if (!targetConnection) {
        // If no connection provided, use active connection
        targetConnection = this.connectionManager.getActiveConnection();
        if (!targetConnection) {
          vscode.window.showWarningMessage('No active connection. Please connect first.');
          return;
        }
      }

      const token = await vscode.window.showInputBox({
        prompt: `Enter token for ${targetConnection.name}`,
        password: true,
        placeHolder: 'Paste your authentication token'
      });

      if (!token) {
        return;
      }

      await this.connectionManager.saveToken(targetConnection.id, token);

      vscode.window.showInformationMessage(`Token updated for ${targetConnection.name}`);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to update token: ${message}`);
    }
  }

  /**
   * Delete token for a connection
   */
  async deleteToken(connection?: ArcConnection): Promise<void> {
    try {
      let targetConnection = connection;

      if (!targetConnection) {
        targetConnection = this.connectionManager.getActiveConnection();
        if (!targetConnection) {
          vscode.window.showWarningMessage('No active connection');
          return;
        }
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete token for "${targetConnection.name}"?`,
        { modal: true },
        'Delete'
      );

      if (confirm !== 'Delete') {
        return;
      }

      await this.connectionManager.deleteToken(targetConnection.id);

      vscode.window.showInformationMessage(`Token deleted for ${targetConnection.name}`);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to delete token: ${message}`);
    }
  }

  /**
   * Create a new authentication token
   */
  async createToken(): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const name = await vscode.window.showInputBox({
        prompt: 'Token name',
        placeHolder: 'vscode-token'
      });

      if (!name) {
        return;
      }

      const description = await vscode.window.showInputBox({
        prompt: 'Token description (optional)',
        placeHolder: 'VS Code Extension Token'
      });

      const response = await client.createToken({ name, description });

      // Save token
      const activeConnection = this.connectionManager.getActiveConnection();
      if (activeConnection) {
        await this.connectionManager.saveToken(activeConnection.id, response.token);
      }

      // Show token to user (one time only)
      const action = await vscode.window.showInformationMessage(
        'Token created successfully. Copy it now - it won\'t be shown again.',
        'Copy Token'
      );

      if (action === 'Copy Token') {
        await vscode.env.clipboard.writeText(response.token);
        vscode.window.showInformationMessage('Token copied to clipboard');
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to create token: ${message}`);
    }
  }

  /**
   * Verify current token
   */
  async verifyToken(): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const response = await client.verifyToken();

      if (response.valid) {
        vscode.window.showInformationMessage('Token is valid');
      } else {
        vscode.window.showWarningMessage(`Token is invalid: ${response.message}`);
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to verify token: ${message}`);
    }
  }

  /**
   * Create a new query file
   */
  async newQuery(): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({
      language: 'sql',
      content: '-- Arc SQL Query\n-- Press Ctrl+Enter (Cmd+Enter on Mac) to execute\n\nSELECT * FROM measurement LIMIT 10;'
    });

    await vscode.window.showTextDocument(doc);
  }

  /**
   * Execute query from active editor
   */
  async executeQuery(): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      // Get query text (selection or entire document)
      let query: string;
      if (!editor.selection.isEmpty) {
        query = editor.document.getText(editor.selection);
      } else {
        query = editor.document.getText();
      }

      query = query.trim();
      if (!query) {
        vscode.window.showWarningMessage('No query to execute');
        return;
      }

      // Execute query with progress
      const startTime = Date.now();
      let results;
      let success = true;
      let errorMessage;

      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Executing query...',
            cancellable: false
          },
          async () => {
            const config = vscode.workspace.getConfiguration('arc');
            const format = config.get<'json' | 'arrow'>('resultFormat', 'json');
            const database = this.connectionManager.getActiveDatabase();
            return await client.executeQuery({ query, format, database });
          }
        );

        // Show results
        QueryResultsView.show(results, query);

        vscode.window.showInformationMessage(
          `Query executed: ${results.rowCount} rows in ${results.executionTime?.toFixed(2)}ms`
        );

      } catch (error) {
        success = false;
        errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Query failed: ${errorMessage}`);
      } finally {
        // Add to query history
        if (this.queryStorage) {
          await this.queryStorage.addToHistory({
            query,
            timestamp: startTime,
            executionTime: results?.executionTime || (Date.now() - startTime),
            rowCount: results?.rowCount,
            success,
            error: errorMessage
          });

          // Refresh queries view
          if (this.queriesProvider) {
            this.queriesProvider.refresh();
          }
        }
      }

    } catch (error) {
      // This outer catch is for any unexpected errors in the try block
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Unexpected error: ${message}`);
    }
  }

  /**
   * Refresh explorer view
   */
  async refreshExplorer(): Promise<void> {
    this.explorerProvider.refresh();
    this.connectionsProvider.refresh();
  }

  /**
   * Show measurements in active database
   */
  async showMeasurements(): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const measurements = await client.getMeasurements();
      const names = measurements.map(m => m.name).join('\n');

      const doc = await vscode.workspace.openTextDocument({
        content: `Arc Measurements (${measurements.length}):\n\n${names}`,
        language: 'plaintext'
      });

      await vscode.window.showTextDocument(doc);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to load measurements: ${message}`);
    }
  }

  /**
   * Insert test data
   */
  async insertTestData(): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const measurement = await vscode.window.showInputBox({
        prompt: 'Measurement name',
        placeHolder: 'test_data'
      });

      if (!measurement) {
        return;
      }

      // Generate test data
      const testData: Array<{
        tags: Record<string, string>;
        fields: Record<string, number>;
        timestamp: number;
      }> = [];
      const now = Date.now();

      for (let i = 0; i < 10; i++) {
        testData.push({
          tags: {
            host: 'localhost',
            region: 'us-east'
          },
          fields: {
            value: Math.random() * 100,
            count: i
          },
          timestamp: (now - i * 60000) * 1000000 // 1 minute intervals in nanoseconds
        });
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Inserting test data...',
          cancellable: false
        },
        async () => {
          await client.writeData(measurement, testData);
        }
      );

      vscode.window.showInformationMessage(`Inserted ${testData.length} test records into ${measurement}`);
      this.explorerProvider.refresh();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to insert test data: ${message}`);
    }
  }

  /**
   * Show health status
   */
  async showHealth(): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const health = await client.healthCheck();
      const healthText = JSON.stringify(health, null, 2);

      const doc = await vscode.workspace.openTextDocument({
        content: `Arc Health Status:\n\n${healthText}`,
        language: 'json'
      });

      await vscode.window.showTextDocument(doc);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to get health status: ${message}`);
    }
  }

  /**
   * Show metrics
   */
  async showMetrics(): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const metrics = await client.getMetrics();
      const metricsText = JSON.stringify(metrics, null, 2);

      const doc = await vscode.workspace.openTextDocument({
        content: `Arc Metrics:\n\n${metricsText}`,
        language: 'json'
      });

      await vscode.window.showTextDocument(doc);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to get metrics: ${message}`);
    }
  }

  /**
   * Create a new server token (separate from connection tokens)
   */
  async createServerToken(): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const name = await vscode.window.showInputBox({
        prompt: 'Token name',
        placeHolder: 'my-token'
      });

      if (!name) {
        return;
      }

      const description = await vscode.window.showInputBox({
        prompt: 'Token description (optional)',
        placeHolder: 'Token for API access'
      });

      const response = await client.createToken({ name, description });

      // Show token to user (one time only)
      const action = await vscode.window.showInformationMessage(
        `Token "${name}" created successfully. Copy it now - it won\'t be shown again.`,
        'Copy Token'
      );

      if (action === 'Copy Token') {
        await vscode.env.clipboard.writeText(response.token);
        vscode.window.showInformationMessage('Token copied to clipboard');
      }

      // Refresh tokens view
      if (this.tokensProvider) {
        this.tokensProvider.refresh();
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to create server token: ${message}`);
    }
  }

  /**
   * Delete a token from the Arc server
   */
  async deleteServerToken(tokenItem: any): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const tokenData = tokenItem?.tokenData || tokenItem;

      if (!tokenData || !tokenData.id) {
        vscode.window.showErrorMessage('Invalid token');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete token "${tokenData.name}" (ID: ${tokenData.id})?`,
        { modal: true },
        'Delete'
      );

      if (confirm !== 'Delete') {
        return;
      }

      await client.deleteServerToken(tokenData.id);

      vscode.window.showInformationMessage(`Deleted token: ${tokenData.name}`);

      // Refresh tokens view
      if (this.tokensProvider) {
        this.tokensProvider.refresh();
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to delete server token: ${message}`);
    }
  }

  /**
   * Rotate a server token - generates new token value
   */
  async rotateServerToken(tokenItem: any): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const tokenData = tokenItem?.tokenData || tokenItem;

      if (!tokenData || !tokenData.id) {
        vscode.window.showErrorMessage('Invalid token');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Rotate token "${tokenData.name}" (ID: ${tokenData.id})? The old token will stop working immediately.`,
        { modal: true },
        'Rotate'
      );

      if (confirm !== 'Rotate') {
        return;
      }

      const response = await client.rotateServerToken(tokenData.id);

      // Show new token to user (one time only)
      const action = await vscode.window.showInformationMessage(
        `Token "${tokenData.name}" rotated successfully. Copy the new token now - it won't be shown again.`,
        'Copy Token'
      );

      if (action === 'Copy Token' && response.new_token) {
        await vscode.env.clipboard.writeText(response.new_token);
        vscode.window.showInformationMessage('New token copied to clipboard');
      }

      // Refresh tokens view
      if (this.tokensProvider) {
        this.tokensProvider.refresh();
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to rotate server token: ${message}`);
    }
  }

  /**
   * Refresh tokens view
   */
  async refreshTokens(): Promise<void> {
    if (this.tokensProvider) {
      this.tokensProvider.refresh();
    }
  }

  // ========== Query Management Commands ==========

  /**
   * Open a query in a new editor
   */
  async openQuery(queryText: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({
      content: queryText,
      language: 'sql'
    });
    await vscode.window.showTextDocument(doc);
  }

  /**
   * Save current query to saved queries
   */
  async saveCurrentQuery(): Promise<void> {
    if (!this.queryStorage) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || (editor.document.languageId !== 'sql' && !editor.document.fileName.endsWith('.arcsql'))) {
      vscode.window.showWarningMessage('Please open a SQL query to save');
      return;
    }

    const queryText = editor.document.getText();
    if (!queryText.trim()) {
      vscode.window.showWarningMessage('Query is empty');
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Query name',
      placeHolder: 'My Query'
    });

    if (!name) {
      return;
    }

    const description = await vscode.window.showInputBox({
      prompt: 'Description (optional)',
      placeHolder: 'Query description'
    });

    const tagsInput = await vscode.window.showInputBox({
      prompt: 'Tags (optional, comma-separated)',
      placeHolder: 'analytics, daily, monitoring'
    });

    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];

    await this.queryStorage.saveQuery({
      name,
      query: queryText,
      description,
      tags
    });

    vscode.window.showInformationMessage(`Query "${name}" saved`);

    if (this.queriesProvider) {
      this.queriesProvider.refresh();
    }
  }

  /**
   * Delete a saved query
   */
  async deleteSavedQuery(treeItem: any): Promise<void> {
    if (!this.queryStorage) {
      return;
    }

    const savedQuery = treeItem?.savedQuery;
    if (!savedQuery) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete saved query "${savedQuery.name}"?`,
      { modal: true },
      'Delete'
    );

    if (confirm === 'Delete') {
      await this.queryStorage.deleteSavedQuery(savedQuery.id);
      vscode.window.showInformationMessage(`Deleted query: ${savedQuery.name}`);

      if (this.queriesProvider) {
        this.queriesProvider.refresh();
      }
    }
  }

  /**
   * Delete a history item
   */
  async deleteHistoryItem(treeItem: any): Promise<void> {
    if (!this.queryStorage) {
      return;
    }

    const historyItem = treeItem?.historyItem;
    if (!historyItem) {
      return;
    }

    await this.queryStorage.deleteHistoryItem(historyItem.id);

    if (this.queriesProvider) {
      this.queriesProvider.refresh();
    }
  }

  /**
   * Clear all query history
   */
  async clearQueryHistory(): Promise<void> {
    if (!this.queryStorage) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      'Clear all query history?',
      { modal: true },
      'Clear'
    );

    if (confirm === 'Clear') {
      await this.queryStorage.clearHistory();
      vscode.window.showInformationMessage('Query history cleared');

      if (this.queriesProvider) {
        this.queriesProvider.refresh();
      }
    }
  }

  /**
   * Rename a saved query
   */
  async renameSavedQuery(treeItem: any): Promise<void> {
    if (!this.queryStorage) {
      return;
    }

    const savedQuery = treeItem?.savedQuery;
    if (!savedQuery) {
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: 'New name',
      value: savedQuery.name
    });

    if (newName && newName !== savedQuery.name) {
      await this.queryStorage.updateSavedQuery(savedQuery.id, { name: newName });
      vscode.window.showInformationMessage(`Renamed to: ${newName}`);

      if (this.queriesProvider) {
        this.queriesProvider.refresh();
      }
    }
  }

  /**
   * Refresh queries view
   */
  async refreshQueries(): Promise<void> {
    if (this.queriesProvider) {
      this.queriesProvider.refresh();
    }
  }

  // ========== Schema Explorer Commands ==========

  /**
   * Show table schema (columns and types)
   */
  async showTableSchema(treeItem: any): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const tableName = treeItem?.metadata?.measurement || treeItem?.table || treeItem?.label;
      const database = treeItem?.metadata?.database || treeItem?.database;

      if (!tableName) {
        vscode.window.showWarningMessage('No table selected');
        return;
      }

      // Use DESCRIBE SELECT to get schema (DuckDB compatible)
      const schemaQuery = `DESCRIBE SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 1`;

      const results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Getting schema for ${tableName}...`,
          cancellable: false
        },
        async () => {
          return await client.executeQuery({ query: schemaQuery, format: 'json', database });
        }
      );

      // Show schema in a nice format
      const schemaText = this.formatSchemaResults(tableName, results);

      const doc = await vscode.workspace.openTextDocument({
        content: schemaText,
        language: 'plaintext'
      });
      await vscode.window.showTextDocument(doc);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to get schema: ${message}`);
    }
  }

  /**
   * Preview table data (LIMIT 10)
   */
  async previewTableData(treeItem: any): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const tableName = treeItem?.metadata?.measurement || treeItem?.table || treeItem?.label;
      const database = treeItem?.metadata?.database || treeItem?.database;

      if (!tableName) {
        vscode.window.showWarningMessage('No table selected');
        return;
      }

      const query = `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 10`;

      const results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Previewing ${tableName}...`,
          cancellable: false
        },
        async () => {
          return await client.executeQuery({ query, format: 'json', database });
        }
      );

      QueryResultsView.show(results, query);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to preview table: ${message}`);
    }
  }

  /**
   * Show table statistics
   */
  async showTableStats(treeItem: any): Promise<void> {
    try {
      const client = this.requireConnectedClient();
      if (!client) { return; }

      const tableName = treeItem?.metadata?.measurement || treeItem?.table || treeItem?.label;
      const database = treeItem?.metadata?.database || treeItem?.database;

      if (!tableName) {
        vscode.window.showWarningMessage('No table selected');
        return;
      }

      // Get row count and other stats
      const statsQuery = `
        SELECT
          COUNT(*) as row_count,
          MIN(time) as earliest_timestamp,
          MAX(time) as latest_timestamp
        FROM ${quoteIdentifier(tableName)}
      `;

      const results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Getting stats for ${tableName}...`,
          cancellable: false
        },
        async () => {
          return await client.executeQuery({ query: statsQuery, format: 'json', database });
        }
      );

      if (results.rows && results.rows.length > 0) {
        const stats = results.rows[0];
        const statsText = this.formatTableStats(tableName, stats);

        vscode.window.showInformationMessage(statsText, { modal: false });
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to get table stats: ${message}`);
    }
  }

  /**
   * Generate SELECT query for table
   */
  async generateSelectQuery(treeItem: any): Promise<void> {
    // Get measurement (table) name and database from metadata
    const tableName = treeItem?.metadata?.measurement || treeItem?.table || treeItem?.label;
    const database = treeItem?.metadata?.database || treeItem?.database;

    if (!tableName) {
      vscode.window.showWarningMessage('No table selected');
      return;
    }

    // Include database prefix with proper quoting for editor-opened queries
    const fullTableName = database
      ? `${quoteIdentifier(database)}.${quoteIdentifier(tableName)}`
      : quoteIdentifier(tableName);
    const query = `SELECT * FROM ${fullTableName} LIMIT 100;`;

    await this.openQuery(query);
  }

  /**
   * Query last hour of data
   */
  async queryLastHour(treeItem: any): Promise<void> {
    const tableName = treeItem?.metadata?.measurement || treeItem?.table || treeItem?.label;
    const database = treeItem?.metadata?.database || treeItem?.database;

    if (!tableName) {
      return;
    }

    const fullTableName = database
      ? `${quoteIdentifier(database)}.${quoteIdentifier(tableName)}`
      : quoteIdentifier(tableName);
    const query = `SELECT * FROM ${fullTableName}
WHERE time > NOW() - INTERVAL '1 hour'
ORDER BY time DESC
LIMIT 1000;`;

    await this.openQuery(query);
  }

  /**
   * Query today's data
   */
  async queryToday(treeItem: any): Promise<void> {
    const tableName = treeItem?.metadata?.measurement || treeItem?.table || treeItem?.label;
    const database = treeItem?.metadata?.database || treeItem?.database;

    if (!tableName) {
      return;
    }

    const fullTableName = database
      ? `${quoteIdentifier(database)}.${quoteIdentifier(tableName)}`
      : quoteIdentifier(tableName);
    const query = `SELECT * FROM ${fullTableName}
WHERE time >= CURRENT_DATE
ORDER BY time DESC
LIMIT 1000;`;

    await this.openQuery(query);
  }

  /**
   * Format schema results for display
   */
  private formatSchemaResults(tableName: string, results: any): string {
    const lines = [
      `Table Schema: ${tableName}`,
      '='.repeat(60),
      ''
    ];

    if (results.rows && results.rows.length > 0) {
      // Get column names from results
      const colWidth = Math.max(...results.rows.map((r: any) => (r.column_name || r[0] || '').length), 15);
      const typeWidth = Math.max(...results.rows.map((r: any) => (r.column_type || r[1] || '').length), 15);

      lines.push(`${'Column'.padEnd(colWidth)}  ${'Type'.padEnd(typeWidth)}  Null?`);
      lines.push('-'.repeat(60));

      results.rows.forEach((row: any) => {
        const colName = row.column_name || row[0] || '';
        const colType = row.column_type || row[1] || '';
        const nullable = row.null || row[2] || 'YES';

        lines.push(`${colName.padEnd(colWidth)}  ${colType.padEnd(typeWidth)}  ${nullable}`);
      });

      lines.push('');
      lines.push(`Total columns: ${results.rows.length}`);
    } else {
      lines.push('No schema information available');
    }

    return lines.join('\n');
  }

  /**
   * Format table statistics
   */
  private formatTableStats(tableName: string, stats: any): string {
    const rowCount = stats.row_count || stats[0] || 0;
    const earliest = stats.earliest_timestamp || stats[1] || 'N/A';
    const latest = stats.latest_timestamp || stats[2] || 'N/A';

    return `Table: ${tableName}\n` +
           `Rows: ${rowCount.toLocaleString()}\n` +
           `Earliest: ${earliest}\n` +
           `Latest: ${latest}`;
  }

  // ========== Notebook Commands ==========

  /**
   * Create a new Arc Notebook
   */
  async newNotebook(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      filters: { 'Arc Notebook': ['arcnb'] },
      defaultUri: vscode.Uri.file('untitled.arcnb')
    });

    if (uri) {
      const initialNotebook = {
        version: '1.0',
        cells: [
          {
            type: 'markdown',
            content: '# Arc Notebook\n\nMix markdown documentation with SQL queries!'
          },
          {
            type: 'sql',
            content: 'SELECT * FROM telegraf.cpu LIMIT 10;'
          }
        ]
      };

      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(initialNotebook, null, 2), 'utf-8'));
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  }

  /**
   * Import CSV file to Arc
   */
  async importCSV(): Promise<void> {
    try {
      if (!this.requireConnectedClient()) { return; }

      const activeConnection = this.connectionManager.getActiveConnection();
      if (!activeConnection) {
        return;
      }

      const token = await this.connectionManager.getToken(activeConnection.id);
      if (!token) {
        vscode.window.showErrorMessage('No authentication token found');
        return;
      }

      const endpoint = `${activeConnection.protocol}://${activeConnection.host}:${activeConnection.port}`;

      const result = await CSVImporter.showImportDialog(endpoint, token);

      if (result) {
        if (result.success) {
          vscode.window.showInformationMessage(
            `Successfully imported ${result.rowsIngested} rows in ${(result.duration / 1000).toFixed(2)}s`
          );
          // Refresh explorer
          this.explorerProvider.refresh();
        } else {
          vscode.window.showErrorMessage(
            `Import completed with errors: ${result.errors.join(', ')}`
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to import CSV: ${message}`);
    }
  }

  /**
   * Generate bulk test data
   */
  async generateTestData(): Promise<void> {
    try {
      if (!this.requireConnectedClient()) { return; }

      const activeConnection = this.connectionManager.getActiveConnection();
      if (!activeConnection) {
        return;
      }

      const token = await this.connectionManager.getToken(activeConnection.id);
      if (!token) {
        vscode.window.showErrorMessage('No authentication token found');
        return;
      }

      const endpoint = `${activeConnection.protocol}://${activeConnection.host}:${activeConnection.port}`;

      const result = await DataGenerator.showGeneratorDialog(endpoint, token);

      if (result) {
        if (result.success) {
          vscode.window.showInformationMessage(
            `Successfully generated ${result.rowsGenerated} rows in ${(result.duration / 1000).toFixed(2)}s`
          );
          // Refresh explorer
          this.explorerProvider.refresh();
        } else {
          vscode.window.showErrorMessage(`Generation failed: ${result.error}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to generate data: ${message}`);
    }
  }

  /**
   * Create a new alert
   */
  async createAlert(): Promise<void> {
    try {
      if (!this.alertManager) {
        vscode.window.showErrorMessage('Alert manager not initialized');
        return;
      }

      // Get alert name
      const name = await vscode.window.showInputBox({
        prompt: 'Enter alert name',
        placeHolder: 'High CPU Usage'
      });

      if (!name) {
        return;
      }

      // Get query
      const query = await vscode.window.showInputBox({
        prompt: 'Enter query (must return a single value)',
        placeHolder: 'SELECT AVG(usage_user) FROM telegraf.cpu WHERE time > now() - INTERVAL 5 MINUTE',
        value: 'SELECT '
      });

      if (!query) {
        return;
      }

      // Get condition
      const condition = await vscode.window.showQuickPick(
        [
          { label: 'Greater than', value: 'greater_than' },
          { label: 'Less than', value: 'less_than' },
          { label: 'Equals', value: 'equals' },
          { label: 'Not equals', value: 'not_equals' },
          { label: 'Contains', value: 'contains' }
        ],
        { placeHolder: 'Select condition' }
      );

      if (!condition) {
        return;
      }

      // Get threshold
      const thresholdStr = await vscode.window.showInputBox({
        prompt: 'Enter threshold value',
        placeHolder: '80'
      });

      if (!thresholdStr) {
        return;
      }

      const threshold = isNaN(Number(thresholdStr)) ? thresholdStr : Number(thresholdStr);

      // Get check interval
      const intervalStr = await vscode.window.showInputBox({
        prompt: 'Check interval in seconds',
        value: '60',
        validateInput: (value) => {
          const num = parseInt(value);
          return !isNaN(num) && num >= 10 ? null : 'Minimum 10 seconds';
        }
      });

      if (!intervalStr) {
        return;
      }

      const intervalMs = parseInt(intervalStr) * 1000;

      // Create alert
      await this.alertManager.createAlert({
        name,
        query,
        condition: condition.value as any,
        threshold,
        checkIntervalMs: intervalMs,
        enabled: true
      });

      vscode.window.showInformationMessage(`Alert "${name}" created successfully`);
      this.alertsProvider?.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to create alert: ${message}`);
    }
  }

  /**
   * Toggle alert enabled/disabled
   */
  async toggleAlert(treeItem: any): Promise<void> {
    try {
      if (!this.alertManager) {
        vscode.window.showErrorMessage('Alert manager not initialized');
        return;
      }

      // Handle the treeItem - it might have data property or be the data itself
      const alert = treeItem?.data || treeItem;

      if (!alert || !alert.id) {
        vscode.window.showErrorMessage('Invalid alert selected');
        return;
      }

      await this.alertManager.updateAlert(alert.id, { enabled: !alert.enabled });

      vscode.window.showInformationMessage(`Alert "${alert.name}" ${alert.enabled ? 'disabled' : 'enabled'}`);
      this.alertsProvider?.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to toggle alert: ${message}`);
    }
  }

  /**
   * Delete an alert
   */
  async deleteAlert(treeItem: any): Promise<void> {
    try {
      if (!this.alertManager) {
        vscode.window.showErrorMessage('Alert manager not initialized');
        return;
      }

      // Handle the treeItem - it might have data property or be the data itself
      const alert = treeItem?.data || treeItem;

      if (!alert || !alert.id) {
        vscode.window.showErrorMessage('Invalid alert selected');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete alert "${alert.name}"?`,
        { modal: true },
        'Delete'
      );

      if (confirm !== 'Delete') {
        return;
      }

      await this.alertManager.deleteAlert(alert.id);
      vscode.window.showInformationMessage(`Alert "${alert.name}" deleted`);
      this.alertsProvider?.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to delete alert: ${message}`);
    }
  }

  /**
   * Show alert details
   */
  async showAlertDetails(treeItem: any): Promise<void> {
    try {
      // Handle the treeItem - it might have data property or be the data itself
      const alert = treeItem?.data || treeItem;

      if (!alert || !alert.id) {
        vscode.window.showErrorMessage('Invalid alert selected');
        return;
      }
      const lastCheckStr = alert.lastCheck
        ? new Date(alert.lastCheck).toLocaleString()
        : 'Never';

      const message = `
**${alert.name}**

**Query:** ${alert.query}

**Condition:** ${alert.condition.replace('_', ' ')} ${alert.threshold}

**Check Interval:** ${alert.checkIntervalMs / 1000}s

**Status:** ${alert.enabled ? 'Enabled' : 'Disabled'}

**Last Check:** ${lastCheckStr}

**Last Result:** ${alert.lastResult !== undefined ? alert.lastResult : 'N/A'}

**Triggered:** ${alert.triggeredCount} times
      `.trim();

      const panel = vscode.window.createWebviewPanel(
        'alertDetails',
        `Alert: ${alert.name}`,
        vscode.ViewColumn.One,
        {}
      );

      panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: var(--vscode-font-family);
              color: var(--vscode-foreground);
              background-color: var(--vscode-editor-background);
              padding: 20px;
              line-height: 1.6;
            }
            pre {
              background-color: var(--vscode-textCodeBlock-background);
              color: var(--vscode-foreground);
              padding: 15px;
              border-radius: 5px;
              border: 1px solid var(--vscode-panel-border);
              white-space: pre-wrap;
              word-wrap: break-word;
            }
            strong {
              color: var(--vscode-textLink-foreground);
            }
          </style>
        </head>
        <body>
          <pre>${message}</pre>
        </body>
        </html>
      `;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to show alert details: ${message}`);
    }
  }

  /**
   * Clear alert triggers history
   */
  async clearAlertTriggers(): Promise<void> {
    try {
      if (!this.alertManager) {
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        'Clear all alert trigger history?',
        { modal: true },
        'Clear'
      );

      if (confirm !== 'Clear') {
        return;
      }

      this.alertManager.clearTriggers();
      vscode.window.showInformationMessage('Alert triggers cleared');
      this.alertsProvider?.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to clear triggers: ${message}`);
    }
  }

  /**
   * Refresh alerts view
   */
  refreshAlerts(): void {
    this.alertsProvider?.refresh();
  }
}
