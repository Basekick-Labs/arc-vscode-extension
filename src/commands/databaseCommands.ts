import * as vscode from 'vscode';
import { ArcExplorerProvider } from '../providers/arcExplorerProvider';
import type { ArcTreeItem } from '../providers/arcExplorerProvider';
import { ConnectionManager } from '../utils/connectionManager';
import { validateDatabaseName } from '../utils/databaseNames';
import type { SqlCompletionProvider } from '../providers/sqlCompletionProvider';

/** Database lifecycle commands for the Arc Explorer. */
export class DatabaseCommands {
  constructor(
    private connectionManager: ConnectionManager,
    private explorerProvider: ArcExplorerProvider,
    private completionProvider: SqlCompletionProvider
  ) {}

  async createDatabase(): Promise<void> {
    const client = this.connectionManager.getActiveClient();
    if (!client) {
      vscode.window.showWarningMessage('Connect to an Arc server before creating a database.');
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Create an Arc database',
      placeHolder: 'metrics',
      validateInput: validateDatabaseName
    });
    if (name === undefined) {
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating database "${name}"...`,
          cancellable: false
        },
        async () => client.createDatabase(name)
      );
      vscode.window.showInformationMessage(`Database "${name}" created.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to create database "${name}": ${message}`);
    } finally {
      this.completionProvider.clearCache();
      this.explorerProvider.refresh();
    }
  }

  async deleteDatabase(treeItem?: ArcTreeItem): Promise<void> {
    const client = this.connectionManager.getActiveClient();
    if (!client) {
      vscode.window.showWarningMessage('Connect to an Arc server before deleting a database.');
      return;
    }

    if (!treeItem || treeItem.contextValue !== 'database') {
      vscode.window.showWarningMessage('Select a database in the Arc Explorer, then choose Delete Database.');
      return;
    }

    const database = treeItem.metadata?.database;
    const validation = typeof database === 'string' ? validateDatabaseName(database) : 'Select a valid database.';
    if (validation) {
      vscode.window.showErrorMessage(validation);
      return;
    }

    const connection = this.connectionManager.getActiveConnection();
    const server = connection ? `${connection.protocol}://${connection.host}:${connection.port}` : 'unknown server';
    const confirmation = await vscode.window.showWarningMessage(
      `Delete database "${database}" from connection "${connection?.name ?? 'unknown'}" (${server})?`,
      {
        modal: true,
        detail: 'This permanently removes the database and its stored data. Large databases may take longer than the client timeout; if the request times out, Arc may still be processing it. This action cannot be undone.'
      },
      'Delete Database'
    );
    if (confirmation !== 'Delete Database') {
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Deleting database "${database}"...`,
          cancellable: false
        },
        async () => client.deleteDatabase(database)
      );
      if (connection && this.connectionManager.getActiveDatabase() === database) {
        await this.connectionManager.setConnectionDatabase(connection.id, undefined);
        vscode.window.showWarningMessage(
          `Database "${database}" was deleted from "${connection.name}". Its active database selection has been cleared.`
        );
      } else {
        vscode.window.showInformationMessage(`Database "${database}" deleted from "${connection?.name ?? 'the active connection'}".`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const timeoutNote = /timeout|timed out|ECONNABORTED/i.test(message)
        ? ' Arc may still be processing the deletion; check the server before retrying.'
        : '';
      const detail = /[.!?]$/.test(message) ? message : `${message}.`;
      vscode.window.showErrorMessage(`Failed to delete database "${database}": ${detail}${timeoutNote}`);
    } finally {
      this.completionProvider.clearCache();
      this.explorerProvider.refresh();
    }
  }
}
