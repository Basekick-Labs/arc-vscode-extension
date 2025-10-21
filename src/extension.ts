import * as vscode from 'vscode';
import { ConnectionManager } from './utils/connectionManager';
import { ArcExplorerProvider } from './providers/arcExplorerProvider';
import { ArcConnectionsProvider } from './providers/arcConnectionsProvider';
import { ArcTokensProvider } from './providers/arcTokensProvider';
import { ArcQueriesProvider } from './providers/arcQueriesProvider';
import { ArcAlertsProvider } from './providers/arcAlertsProvider';
import { SqlCompletionProvider } from './providers/sqlCompletionProvider';
import { ArcNotebookEditorProvider } from './views/notebookEditor';
import { QueryStorage } from './utils/queryStorage';
import { AlertManager } from './utils/alertManager';
import { ArcCommands } from './commands/arcCommands';

export function activate(context: vscode.ExtensionContext) {
  console.log('Arc Database Manager extension is now active');

  try {
  // Initialize connection manager
  const connectionManager = ConnectionManager.initialize(context);

  // Initialize query storage
  const queryStorage = new QueryStorage(context);

  // Initialize alert manager
  const alertManager = new AlertManager(context, () => connectionManager.getActiveClient());

  // Initialize providers
  const explorerProvider = new ArcExplorerProvider(connectionManager);
  const connectionsProvider = new ArcConnectionsProvider(connectionManager);
  const tokensProvider = new ArcTokensProvider(connectionManager);
  const queriesProvider = new ArcQueriesProvider(queryStorage);
  const alertsProvider = new ArcAlertsProvider(alertManager);
  const sqlCompletionProvider = new SqlCompletionProvider(connectionManager);

  // Register tree views
  const explorerView = vscode.window.createTreeView('arcExplorer', {
    treeDataProvider: explorerProvider,
    showCollapseAll: true
  });

  const connectionsView = vscode.window.createTreeView('arcConnections', {
    treeDataProvider: connectionsProvider
  });

  const tokensView = vscode.window.createTreeView('arcTokens', {
    treeDataProvider: tokensProvider
  });

  const queriesView = vscode.window.createTreeView('arcQueries', {
    treeDataProvider: queriesProvider,
    showCollapseAll: true
  });

  const alertsView = vscode.window.createTreeView('arcAlerts', {
    treeDataProvider: alertsProvider,
    showCollapseAll: true
  });

  // Initialize commands
  const commands = new ArcCommands(connectionManager, explorerProvider, connectionsProvider);
  commands.setTokensProvider(tokensProvider);
  commands.setQueriesProvider(queriesProvider, queryStorage);
  commands.setAlertsProvider(alertsProvider, alertManager);

  // Register status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'arc.connect';

  const updateStatusBar = () => {
    if (connectionManager.isConnected()) {
      const connection = connectionManager.getActiveConnection();
      statusBarItem.text = `$(database) Arc: ${connection?.name}`;
      statusBarItem.tooltip = `Connected to ${connection?.protocol}://${connection?.host}:${connection?.port}`;
      statusBarItem.backgroundColor = undefined;
    } else {
      statusBarItem.text = '$(debug-disconnect) Arc: Not Connected';
      statusBarItem.tooltip = 'Click to connect to Arc server';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    statusBarItem.show();
  };

  updateStatusBar();

  // Create wrappers that update status bar
  const connectWithUpdate = async () => {
    try {
      await commands.connect();
      updateStatusBar();
    } catch (error) {
      console.error('Connection wrapper error:', error);
      // Error is already shown by commands.connect(), just update status bar
      updateStatusBar();
    }
  };

  const disconnectWithUpdate = async () => {
    await commands.disconnect();
    updateStatusBar();
  };

  const activateConnectionWithUpdate = async (connection: any) => {
    await commands.activateConnection(connection);
    updateStatusBar();
  };

  const deleteConnectionWithUpdate = async (connection: any) => {
    await commands.deleteConnection(connection);
    updateStatusBar();
  };

  // Register commands
  const commandRegistrations = [
    vscode.commands.registerCommand('arc.connect', () => connectWithUpdate()),
    vscode.commands.registerCommand('arc.disconnect', () => disconnectWithUpdate()),
    vscode.commands.registerCommand('arc.activateConnection', (treeItem) => {
      // Extract connection from tree item
      const connection = treeItem?.connection || treeItem;
      activateConnectionWithUpdate(connection);
    }),
    vscode.commands.registerCommand('arc.editConnection', (treeItem) => {
      const connection = treeItem?.connection || treeItem;
      commands.editConnection(connection);
    }),
    vscode.commands.registerCommand('arc.deleteConnection', (treeItem) => {
      const connection = treeItem?.connection || treeItem;
      deleteConnectionWithUpdate(connection);
    }),
    vscode.commands.registerCommand('arc.createToken', () => commands.createToken()),
    vscode.commands.registerCommand('arc.verifyToken', () => commands.verifyToken()),
    vscode.commands.registerCommand('arc.updateToken', (treeItem) => {
      const connection = treeItem?.connection || treeItem;
      commands.updateToken(connection);
    }),
    vscode.commands.registerCommand('arc.deleteToken', (treeItem) => {
      const connection = treeItem?.connection || treeItem;
      commands.deleteToken(connection);
    }),
    vscode.commands.registerCommand('arc.newQuery', () => commands.newQuery()),
    vscode.commands.registerCommand('arc.executeQuery', () => commands.executeQuery()),
    vscode.commands.registerCommand('arc.refreshExplorer', () => commands.refreshExplorer()),
    vscode.commands.registerCommand('arc.showMeasurements', () => commands.showMeasurements()),
    vscode.commands.registerCommand('arc.insertTestData', () => commands.insertTestData()),
    vscode.commands.registerCommand('arc.showHealth', () => commands.showHealth()),
    vscode.commands.registerCommand('arc.showMetrics', () => commands.showMetrics()),
    vscode.commands.registerCommand('arc.createServerToken', () => commands.createServerToken()),
    vscode.commands.registerCommand('arc.deleteServerToken', (treeItem) => {
      commands.deleteServerToken(treeItem);
    }),
    vscode.commands.registerCommand('arc.rotateServerToken', (treeItem) => {
      commands.rotateServerToken(treeItem);
    }),
    vscode.commands.registerCommand('arc.refreshTokens', () => commands.refreshTokens()),
    vscode.commands.registerCommand('arc.openQuery', (queryText) => commands.openQuery(queryText)),
    vscode.commands.registerCommand('arc.saveCurrentQuery', () => commands.saveCurrentQuery()),
    vscode.commands.registerCommand('arc.deleteSavedQuery', (treeItem) => {
      commands.deleteSavedQuery(treeItem);
    }),
    vscode.commands.registerCommand('arc.renameSavedQuery', (treeItem) => {
      commands.renameSavedQuery(treeItem);
    }),
    vscode.commands.registerCommand('arc.deleteHistoryItem', (treeItem) => {
      commands.deleteHistoryItem(treeItem);
    }),
    vscode.commands.registerCommand('arc.clearQueryHistory', () => commands.clearQueryHistory()),
    vscode.commands.registerCommand('arc.refreshQueries', () => commands.refreshQueries()),
    vscode.commands.registerCommand('arc.showTableSchema', (treeItem) => {
      commands.showTableSchema(treeItem);
    }),
    vscode.commands.registerCommand('arc.previewTableData', (treeItem) => {
      commands.previewTableData(treeItem);
    }),
    vscode.commands.registerCommand('arc.showTableStats', (treeItem) => {
      commands.showTableStats(treeItem);
    }),
    vscode.commands.registerCommand('arc.generateSelectQuery', (treeItem) => {
      commands.generateSelectQuery(treeItem);
    }),
    vscode.commands.registerCommand('arc.queryLastHour', (treeItem) => {
      commands.queryLastHour(treeItem);
    }),
    vscode.commands.registerCommand('arc.queryToday', (treeItem) => {
      commands.queryToday(treeItem);
    }),
    vscode.commands.registerCommand('arc.importCSV', () => commands.importCSV()),
    vscode.commands.registerCommand('arc.generateTestData', () => commands.generateTestData()),
    vscode.commands.registerCommand('arc.createAlert', () => commands.createAlert()),
    vscode.commands.registerCommand('arc.toggleAlert', (treeItem) => commands.toggleAlert(treeItem)),
    vscode.commands.registerCommand('arc.deleteAlert', (treeItem) => commands.deleteAlert(treeItem)),
    vscode.commands.registerCommand('arc.showAlertDetails', (treeItem) => commands.showAlertDetails(treeItem)),
    vscode.commands.registerCommand('arc.clearAlertTriggers', () => commands.clearAlertTriggers()),
    vscode.commands.registerCommand('arc.refreshAlerts', () => commands.refreshAlerts())
  ];

  // Add keybinding for executing queries
  const executeQueryKeybinding = vscode.commands.registerCommand('arc.executeQueryKeybinding', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor && (editor.document.languageId === 'sql' || editor.document.fileName.endsWith('.arcsql'))) {
      commands.executeQuery();
    }
  });

  // Register SQL completion provider
  const sqlCompletion = vscode.languages.registerCompletionItemProvider(
    ['sql', { pattern: '**/*.arcsql' }],
    sqlCompletionProvider,
    '.', // Trigger on dot for table.column
    ' '  // Trigger on space for keywords
  );

  // Register notebook editor
  const notebookEditor = ArcNotebookEditorProvider.register(context, connectionManager);

  // Add notebook command
  vscode.commands.registerCommand('arc.newNotebook', () => commands.newNotebook());

  // Add all disposables to context
  context.subscriptions.push(
    explorerView,
    connectionsView,
    tokensView,
    queriesView,
    alertsView,
    statusBarItem,
    executeQueryKeybinding,
    sqlCompletion,
    notebookEditor,
    ...commandRegistrations
  );

  // Stop all alerts on deactivation
  context.subscriptions.push({
    dispose: () => {
      alertManager.stopAll();
    }
  });

  // Show welcome message on first activation
  const hasShownWelcome = context.globalState.get('arc.hasShownWelcome', false);
  if (!hasShownWelcome) {
    vscode.window.showInformationMessage(
      'Welcome to Arc Database Manager! Click "Connect" in the status bar to get started.',
      'Connect Now'
    ).then(action => {
      if (action === 'Connect Now') {
        connectWithUpdate();
      }
    });
    context.globalState.update('arc.hasShownWelcome', true);
  }
  } catch (error) {
    console.error('FATAL ERROR activating Arc extension:', error);
    vscode.window.showErrorMessage(
      `Arc Database Manager failed to activate: ${error instanceof Error ? error.message : String(error)}. Check Developer Console (Help > Toggle Developer Tools) for details.`
    );
    throw error; // Re-throw to ensure VS Code knows the extension failed
  }
}

export function deactivate() {
  console.log('Arc Database Manager extension is now deactivated');
}
