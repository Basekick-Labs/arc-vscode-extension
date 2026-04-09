import * as vscode from 'vscode';
import { ConnectionManager } from '../utils/connectionManager';
import { ArcNotebook, ArcNotebookCell } from '../types/notebook';
import { escapeHtml } from '../utils/sqlUtils';

export class ArcNotebookEditorProvider implements vscode.CustomTextEditorProvider {
  public static register(context: vscode.ExtensionContext, connectionManager: ConnectionManager): vscode.Disposable {
    const provider = new ArcNotebookEditorProvider(context, connectionManager);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      'arc.notebook',
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    );
    return providerRegistration;
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connectionManager: ConnectionManager
  ) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true
    };

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'save':
          await this.saveNotebook(document, message.notebook);
          break;
        case 'executeCell':
          await this.executeCell(webviewPanel.webview, message.index, message.content);
          break;
        case 'exportMarkdown':
          await this.exportMarkdown(message.markdown);
          break;
      }
    });

    // Update webview when document changes
    const updateWebview = () => {
      webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, document);
    };

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    updateWebview();
  }

  private async saveNotebook(document: vscode.TextDocument, notebook: ArcNotebook): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const json = JSON.stringify(notebook, null, 2);
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      json
    );
    await vscode.workspace.applyEdit(edit);
  }

  private async executeCell(webview: vscode.Webview, cellIndex: number, query: string): Promise<void> {
    if (!this.connectionManager.isConnected()) {
      webview.postMessage({
        command: 'cellResult',
        index: cellIndex,
        error: 'Not connected to Arc server'
      });
      return;
    }

    const client = this.connectionManager.getActiveClient();
    if (!client) {
      return;
    }

    try {
      // Execute the SQL query
      // User-written queries may use database.table syntax, so don't send
      // x-arc-database header (Arc rejects cross-database syntax with header)
      const config = vscode.workspace.getConfiguration('arc');
      const format = config.get<'json' | 'arrow'>('resultFormat', 'json');
      const results = await client.executeQuery({ query, format });

      // Send results back to webview
      webview.postMessage({
        command: 'cellResult',
        index: cellIndex,
        output: {
          columns: results.columns,
          rows: results.rows,
          rowCount: results.rowCount,
          executionTime: results.executionTime
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      webview.postMessage({
        command: 'cellResult',
        index: cellIndex,
        error: message
      });
    }
  }

  private async exportMarkdown(markdown: string): Promise<void> {
    try {
      const uri = await vscode.window.showSaveDialog({
        filters: { 'Markdown': ['md'] },
        defaultUri: vscode.Uri.file('notebook_export.md')
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown, 'utf-8'));
        vscode.window.showInformationMessage(`Notebook exported to ${uri.fsPath}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Export failed: ${message}`);
    }
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  private getHtmlContent(webview: vscode.Webview, document: vscode.TextDocument): string {
    let notebook: ArcNotebook;

    try {
      const text = document.getText();
      notebook = text ? JSON.parse(text) : { version: '1.0', cells: [] };
    } catch {
      notebook = { version: '1.0', cells: [] };
    }

    const cellsHtml = notebook.cells.map((cell, i) => this.renderCell(cell, i)).join('');
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data:;">
    <title>Arc Notebook</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            max-width: 1200px;
            margin: 0 auto;
        }
        .cell {
            margin-bottom: 20px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
            overflow: hidden;
        }
        .cell-toolbar {
            background-color: var(--vscode-editor-lineHighlightBackground);
            padding: 8px 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .cell-type {
            font-size: 0.8em;
            text-transform: uppercase;
            color: var(--vscode-descriptionForeground);
        }
        .cell-actions button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 12px;
            margin-left: 5px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 0.85em;
        }
        .cell-actions button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .cell-content {
            padding: 15px;
        }
        .markdown-cell {
            line-height: 1.6;
        }
        .sql-cell {
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-textCodeBlock-background);
            white-space: pre-wrap;
            font-size: 0.95em;
        }
        .cell-output {
            border-top: 1px solid var(--vscode-panel-border);
            padding: 15px;
            background-color: var(--vscode-editor-background);
            max-height: 400px;
            overflow: auto;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9em;
        }
        th, td {
            padding: 8px;
            border: 1px solid var(--vscode-panel-border);
            text-align: left;
        }
        th {
            background-color: var(--vscode-editor-lineHighlightBackground);
            font-weight: 600;
        }
        .error {
            color: var(--vscode-errorForeground);
            padding: 10px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border-radius: 3px;
        }
        .add-cell-bar {
            text-align: center;
            padding: 10px;
            margin-bottom: 20px;
        }
        .add-cell-bar button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px 16px;
            margin: 0 5px;
            border-radius: 2px;
            cursor: pointer;
        }
        .stats {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }
        textarea {
            width: 100%;
            min-height: 100px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            padding: 10px;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.95em;
            resize: vertical;
            box-sizing: border-box;
        }
        textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .markdown-cell textarea {
            font-family: var(--vscode-font-family);
        }
        .sql-cell textarea {
            font-family: var(--vscode-editor-font-family);
        }
        .variables-section {
            background-color: var(--vscode-editor-lineHighlightBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 20px;
        }
        .variables-section h3 {
            margin-top: 0;
            margin-bottom: 10px;
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
        }
        .variable-row {
            display: flex;
            gap: 10px;
            margin-bottom: 8px;
            align-items: center;
        }
        .variable-row input {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            padding: 6px 10px;
            font-family: var(--vscode-font-family);
            font-size: 0.9em;
        }
        .variable-row input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .variable-row input[name="key"] {
            flex: 0 0 150px;
        }
        .variable-row input[name="value"] {
            flex: 1;
        }
        .variable-row button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 0.85em;
        }
        .variable-row button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .variables-help {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <h1>Arc Notebook</h1>

    <div class="variables-section">
        <h3>📌 Variables</h3>
        <div id="variables-list"></div>
        <button data-action="addVariable" style="margin-top: 10px;">+ Add Variable</button>
        <div class="variables-help">
            Use variables in SQL queries with <code>\${variableName}</code> syntax. Example: <code>SELECT * FROM table WHERE id = \${id}</code>
        </div>
    </div>

    <div class="add-cell-bar">
        <button data-action="addCell" data-type="markdown">+ Markdown Cell</button>
        <button data-action="addCell" data-type="sql">+ SQL Cell</button>
        <button data-action="runAll">▶️ Run All SQL Cells</button>
        <button data-action="exportMarkdown">📄 Export to Markdown</button>
    </div>

    <div id="cells">
        ${cellsHtml}
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let notebook = ${JSON.stringify(notebook)};

        // Initialize global variables if not present
        if (!notebook.globalVariables) {
            notebook.globalVariables = {};
        }

        // CSP-safe event delegation for buttons
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const index = parseInt(btn.dataset.index);
            switch (action) {
                case 'addVariable': addVariable(); break;
                case 'addCell': addCell(btn.dataset.type); break;
                case 'runAll': runAll(); break;
                case 'exportMarkdown': exportMarkdown(); break;
                case 'executeCell': executeCell(index); break;
                case 'deleteCell': deleteCell(index); break;
            }
        });

        // CSP-safe event delegation for textarea input
        document.addEventListener('input', (e) => {
            if (e.target.matches('textarea[data-cell-index]')) {
                onCellChange(parseInt(e.target.dataset.cellIndex));
            }
        });

        // Render variables on load
        window.addEventListener('load', () => {
            renderVariables();
        });

        function renderVariables() {
            const container = document.getElementById('variables-list');
            container.innerHTML = '';

            const vars = notebook.globalVariables || {};
            Object.entries(vars).forEach(([key, value]) => {
                addVariableRow(key, value);
            });
        }

        function addVariable() {
            addVariableRow('', '');
        }

        function addVariableRow(key, value) {
            const container = document.getElementById('variables-list');
            const row = document.createElement('div');
            row.className = 'variable-row';

            const keyInput = document.createElement('input');
            keyInput.name = 'key';
            keyInput.placeholder = 'Variable name';
            keyInput.value = key;
            keyInput.oninput = () => updateVariables();

            const valueInput = document.createElement('input');
            valueInput.name = 'value';
            valueInput.placeholder = 'Value';
            valueInput.value = value;
            valueInput.oninput = () => updateVariables();

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '🗑️';
            deleteBtn.onclick = () => {
                row.remove();
                updateVariables();
            };

            row.appendChild(keyInput);
            row.appendChild(valueInput);
            row.appendChild(deleteBtn);
            container.appendChild(row);
        }

        function updateVariables() {
            const rows = document.querySelectorAll('.variable-row');
            const newVars = {};

            rows.forEach(row => {
                const key = row.querySelector('input[name="key"]').value.trim();
                const value = row.querySelector('input[name="value"]').value;
                if (key) {
                    newVars[key] = value;
                }
            });

            notebook.globalVariables = newVars;
            saveNotebook();
        }

        function substituteVariables(query) {
            let result = query;
            const vars = notebook.globalVariables || {};

            // Replace \${varName} with actual values
            Object.entries(vars).forEach(([key, value]) => {
                // Match \${key} pattern
                const pattern = new RegExp(\`\\\\\\\$\\\\{\${key}\\\\}\`, 'g');
                // Quote string values, leave numbers as-is
                const quotedValue = isNaN(value) ? \`'\${value.replace(/'/g, "''") }'\` : value;
                result = result.replace(pattern, quotedValue);
            });

            return result;
        }

        function addCell(type) {
            notebook.cells.push({
                type: type,
                content: type === 'markdown' ? '# New Markdown Cell' : 'SELECT * FROM table LIMIT 10;'
            });
            refreshView();
        }

        function deleteCell(index) {
            if (confirm('Delete this cell?')) {
                notebook.cells.splice(index, 1);
                refreshView();
            }
        }

        function executeCell(index) {
            const cell = notebook.cells[index];
            if (cell.type !== 'sql') return;

            // Get current content from textarea
            const textarea = document.querySelector(\`#cell-\${index} textarea\`);
            if (textarea) {
                cell.content = textarea.value;
            }

            // Substitute variables
            const processedQuery = substituteVariables(cell.content);

            vscode.postMessage({
                command: 'executeCell',
                index: index,
                content: processedQuery
            });
        }

        function onCellChange(index) {
            const textarea = document.querySelector(\`#cell-\${index} textarea\`);
            if (textarea) {
                notebook.cells[index].content = textarea.value;
                // Auto-save after a short delay
                clearTimeout(window.saveTimeout);
                window.saveTimeout = setTimeout(() => {
                    saveNotebook();
                }, 500);
            }
        }

        function saveNotebook() {
            vscode.postMessage({
                command: 'save',
                notebook: notebook
            });
        }

        function refreshView() {
            saveNotebook();
            // The document change will trigger a refresh
        }

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'cellResult':
                    updateCellOutput(message.index, message.output, message.error);
                    break;
            }
        });

        function updateCellOutput(index, output, error) {
            if (error) {
                notebook.cells[index].output = { error };
            } else {
                notebook.cells[index].output = output;
            }
            saveNotebook();
        }

        async function runAll() {
            // Get all SQL cells
            const sqlCells = notebook.cells
                .map((cell, index) => ({ cell, index }))
                .filter(({ cell }) => cell.type === 'sql');

            if (sqlCells.length === 0) {
                alert('No SQL cells to run');
                return;
            }

            // Run sequentially
            for (const { index } of sqlCells) {
                await runCellAndWait(index);
                // Small delay between cells
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        function runCellAndWait(index) {
            return new Promise((resolve) => {
                // Store resolver for this cell
                if (!window.cellResolvers) {
                    window.cellResolvers = {};
                }
                window.cellResolvers[index] = resolve;

                // Execute cell
                executeCell(index);
            });
        }

        // Override updateCellOutput to resolve promises
        const originalUpdateCellOutput = updateCellOutput;
        updateCellOutput = function(index, output, error) {
            originalUpdateCellOutput(index, output, error);

            // Resolve promise if waiting
            if (window.cellResolvers && window.cellResolvers[index]) {
                window.cellResolvers[index]();
                delete window.cellResolvers[index];
            }
        };

        function exportMarkdown() {
            let markdown = '# Arc Notebook Export\\n\\n';

            notebook.cells.forEach((cell, index) => {
                if (cell.type === 'markdown') {
                    markdown += cell.content + '\\n\\n';
                } else if (cell.type === 'sql') {
                    markdown += '## SQL Query\\n\\n';
                    markdown += \`\\\`\\\`\\\`sql\\n\${cell.content}\\n\\\`\\\`\\\`\\n\\n\`;

                    if (cell.output) {
                        if (cell.output.error) {
                            markdown += '**Error:**\\n\`\`\`\\n' + cell.output.error + '\\n\`\`\`\\n\\n';
                        } else if (cell.output.rows && cell.output.columns) {
                            markdown += '**Results:**\\n\\n';
                            markdown += convertToMarkdownTable(cell.output.columns, cell.output.rows);
                            markdown += \`\\n\\n*\${cell.output.rowCount} rows in \${cell.output.executionTime?.toFixed(2)}ms*\\n\\n\`;
                        }
                    }
                }
            });

            // Send to extension to save
            vscode.postMessage({
                command: 'exportMarkdown',
                markdown: markdown
            });
        }

        function convertToMarkdownTable(columns, rows) {
            const maxRows = Math.min(rows.length, 50); // Limit to 50 rows for markdown
            const header = '| ' + columns.join(' | ') + ' |';
            const separator = '| ' + columns.map(() => '---').join(' | ') + ' |';
            const dataRows = rows.slice(0, maxRows).map(row =>
                '| ' + row.map(cell => String(cell || '')).join(' | ') + ' |'
            ).join('\\n');

            return header + '\\n' + separator + '\\n' + dataRows;
        }
    </script>
</body>
</html>`;
  }

  private renderCell(cell: ArcNotebookCell, index: number): string {
    const cellClass = cell.type === 'markdown' ? 'markdown-cell' : 'sql-cell';
    // Don't escape for textarea - we want raw content
    const content = cell.content;

    let outputHtml = '';
    if (cell.output) {
      if (cell.output.error) {
        outputHtml = `<div class="cell-output"><div class="error">${escapeHtml(cell.output.error)}</div></div>`;
      } else if (cell.output.rows && cell.output.columns) {
        const headers = cell.output.columns.map(col => `<th>${escapeHtml(col)}</th>`).join('');
        const rows = cell.output.rows.slice(0, 100).map(row =>
          '<tr>' + row.map(cell => `<td>${escapeHtml(String(cell || ''))}</td>`).join('') + '</tr>'
        ).join('');
        const stats = `<div class="stats">Rows: ${cell.output.rowCount || 0} | Execution Time: ${cell.output.executionTime?.toFixed(2) || 0}ms</div>`;
        outputHtml = `<div class="cell-output">${stats}<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
      }
    }

    return `
      <div class="cell" id="cell-${index}">
        <div class="cell-toolbar">
          <span class="cell-type">${cell.type}</span>
          <div class="cell-actions">
            ${cell.type === 'sql' ? `<button data-action="executeCell" data-index="${index}">▶️ Run</button>` : ''}
            <button data-action="deleteCell" data-index="${index}">🗑️ Delete</button>
          </div>
        </div>
        <div class="cell-content ${cellClass}">
          <textarea data-cell-index="${index}" rows="${Math.max(3, content.split('\n').length)}">${escapeHtml(content)}</textarea>
        </div>
        ${outputHtml}
      </div>
    `;
  }

}
