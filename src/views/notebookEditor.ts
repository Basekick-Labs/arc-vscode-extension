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

  /**
   * Content this provider has written via saveNotebook() but has not yet seen
   * come back through onDidChangeTextDocument, keyed by document URI.
   *
   * Keyed by document (not panel) because several panels can share one
   * document, and it is the document that changes.
   *
   * Values are normalized JSON (see normalize) rather than raw text: the stored
   * text can legitimately differ from what we handed to applyEdit -- a
   * document's EndOfLine rewrites \n to \r\n on Windows, and final-newline
   * settings can append a byte. A raw comparison would then never match, and
   * this whole mechanism would silently do nothing while looking correct on
   * macOS.
   */
  private readonly pendingWrites = new Map<string, Array<{ content: string; structural: boolean }>>();

  /**
   * One verdict per document version, so that every panel's listener reaches
   * the same conclusion for a single change event. Without this the first
   * listener to run would consume the pending write and the others would treat
   * the change as external and rebuild anyway.
   */
  private readonly verdicts = new Map<string, { version: number; structural: boolean | null }>();

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
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    let disposed = false;

    // Handle messages from the webview
    const messageSubscription = webviewPanel.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'save':
          await this.saveNotebook(document, message.notebook, message.structural === true);
          break;
        case 'executeCell':
          if (disposed) { return; }
          await this.executeCell(webviewPanel.webview, message.index, message.content);
          break;
        case 'exportMarkdown':
          await this.exportMarkdown(message.markdown);
          break;
      }
    });

    // Update webview when document changes
    const updateWebview = () => {
      if (disposed) { return; }
      webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, document);
    };

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() !== document.uri.toString()) { return; }

      const structural = this.verdictFor(e.document);

      // Our own typing/result save: the webview DOM is already up to date, and
      // rebuilding here is what used to destroy focus, scroll and in-progress
      // edits. Everything else -- our own structural save (add/delete cell) and
      // any external edit -- still rebuilds.
      //
      // Known limitation: with two panels on one document, a non-structural
      // save in one no longer refreshes the other until a structural change.
      // Tracked separately; the previous behaviour (constantly destroying both)
      // was worse.
      if (structural === false) { return; }

      updateWebview();
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      changeDocumentSubscription.dispose();
      messageSubscription.dispose();
      // pendingWrites is intentionally left alone: another panel may still be
      // open on this document. It drains via change events and the length cap.
    });

    updateWebview();
  }

  /**
   * Stable representation for comparing document content, immune to EOL and
   * whitespace normalization. Returns undefined when the text does not parse.
   */
  private normalize(text: string): string | undefined {
    try {
      return JSON.stringify(JSON.parse(text));
    } catch {
      return undefined;
    }
  }

  /**
   * Decide whether a change originated here, and if so whether it was
   * structural. Returns true (ours, needs a rebuild), false (ours, webview
   * already current) or null (external edit).
   *
   * The result is memoized per document version so all panels agree.
   */
  private verdictFor(document: vscode.TextDocument): boolean | null {
    const key = document.uri.toString();
    const cached = this.verdicts.get(key);
    if (cached && cached.version === document.version) {
      return cached.structural;
    }

    let structural: boolean | null = null;
    const queue = this.pendingWrites.get(key);
    const current = this.normalize(document.getText());

    if (queue && current !== undefined) {
      const idx = queue.findIndex(entry => entry.content === current);
      if (idx !== -1) {
        structural = queue[idx].structural;
        // Drop the match and anything older -- those writes were superseded by
        // this one, and leaving them could mis-claim a later external edit.
        queue.splice(0, idx + 1);
        if (queue.length === 0) { this.pendingWrites.delete(key); }
      }
    }

    this.verdicts.set(key, { version: document.version, structural });
    return structural;
  }

  private async saveNotebook(
    document: vscode.TextDocument,
    notebook: ArcNotebook,
    structural: boolean
  ): Promise<void> {
    const json = JSON.stringify(notebook, null, 2);

    // Identical content produces no change event at all, which would strand
    // this entry in the queue and let it mis-claim a later edit.
    const normalized = this.normalize(json);
    if (normalized !== undefined && this.normalize(document.getText()) === normalized) {
      return;
    }

    const key = document.uri.toString();
    const queue = this.pendingWrites.get(key) ?? [];
    const entry = { content: normalized ?? json, structural };
    queue.push(entry);
    // Backstop against entries that never match (rejected edits, races).
    while (queue.length > 8) { queue.shift(); }
    this.pendingWrites.set(key, queue);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      json
    );

    // Recorded before the await, never in a .then(): applyEdit fires the change
    // event synchronously, so the queue must already be populated.
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      const q = this.pendingWrites.get(key);
      if (q) {
        const i = q.indexOf(entry);
        if (i !== -1) { q.splice(i, 1); }
        if (q.length === 0) { this.pendingWrites.delete(key); }
      }
    }
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

        // Last payload handed to the host, used to skip redundant saves.
        // Snapshotted AFTER the initializer above so an untouched notebook
        // compares equal and does not autosave on first keystroke.
        let lastSavedJson = JSON.stringify(notebook);

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
            // Debounced like cell edits: this fires on every keystroke in a
            // variable field.
            scheduleAutosave();
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
            // Capture in-progress edits first: this save triggers a rebuild,
            // which would otherwise discard anything typed since the last flush.
            syncCellsFromDom();
            cancelAutosave();
            notebook.cells.push({
                type: type,
                content: type === 'markdown' ? '# New Markdown Cell' : 'SELECT * FROM table LIMIT 10;'
            });
            refreshView();
        }

        function deleteCell(index) {
            if (confirm('Delete this cell?')) {
                syncCellsFromDom();
                cancelAutosave();
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

        // Idle period after the last keystroke before autosaving, plus a
        // ceiling so continuous typing still checkpoints periodically.
        const AUTOSAVE_IDLE_MS = 1000;
        const AUTOSAVE_MAX_MS = 5000;
        let autosaveTimer = null;
        let autosaveDeadline = 0;

        function scheduleAutosave() {
            const now = Date.now();
            if (autosaveTimer === null) {
                autosaveDeadline = now + AUTOSAVE_MAX_MS;
            }
            clearTimeout(autosaveTimer);
            const delay = Math.max(0, Math.min(AUTOSAVE_IDLE_MS, autosaveDeadline - now));
            autosaveTimer = setTimeout(flushAutosave, delay);
        }

        function flushAutosave() {
            clearTimeout(autosaveTimer);
            autosaveTimer = null;
            saveNotebook(false);
        }

        function cancelAutosave() {
            clearTimeout(autosaveTimer);
            autosaveTimer = null;
        }

        /** Pull live textarea values into the model before a structural change. */
        function syncCellsFromDom() {
            document.querySelectorAll('textarea[data-cell-index]').forEach(ta => {
                const i = parseInt(ta.dataset.cellIndex);
                if (notebook.cells[i]) {
                    notebook.cells[i].content = ta.value;
                }
            });
        }

        function onCellChange(index) {
            const textarea = document.querySelector(\`#cell-\${index} textarea\`);
            if (textarea) {
                notebook.cells[index].content = textarea.value;
                scheduleAutosave();
            }
        }

        // Don't lose buffered edits if the panel closes or focus leaves.
        document.addEventListener('focusout', (e) => {
            if (e.target.matches && e.target.matches('textarea[data-cell-index]')) {
                if (autosaveTimer !== null) { flushAutosave(); }
            }
        });
        window.addEventListener('blur', () => {
            if (autosaveTimer !== null) { flushAutosave(); }
        });

        function saveNotebook(structural) {
            const json = JSON.stringify(notebook);
            // Skip no-op saves; the host would ignore them anyway, and this
            // avoids waking the extension on every keystroke that changes nothing.
            if (!structural && json === lastSavedJson) { return; }
            lastSavedJson = json;
            vscode.postMessage({
                command: 'save',
                notebook: notebook,
                structural: structural === true
            });
        }

        function refreshView() {
            // Structural change: the host rebuilds the webview from the document,
            // which is how the added/removed cell actually gets rendered.
            saveNotebook(true);
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

        /**
         * Draw a cell's output in place.
         *
         * Necessary because results no longer arrive via a full webview
         * rebuild. Built with createElement/textContent rather than an HTML
         * string, so values are inert by construction and need no escaping.
         */
        function renderCellOutput(index) {
            const cellEl = document.getElementById('cell-' + index);
            if (!cellEl) { return; }

            const existing = cellEl.querySelector('.cell-output');
            if (existing) { existing.remove(); }

            const out = notebook.cells[index] && notebook.cells[index].output;
            if (!out) { return; }

            const container = document.createElement('div');
            container.className = 'cell-output';

            if (out.error) {
                const err = document.createElement('div');
                err.className = 'error';
                err.textContent = out.error;
                container.appendChild(err);
            } else if (out.columns && out.rows) {
                const stats = document.createElement('div');
                stats.className = 'stats';   // same class renderCell() uses, so live and rebuilt output match
                const ms = typeof out.executionTime === 'number'
                    ? ' | Execution Time: ' + out.executionTime.toFixed(2) + 'ms'
                    : '';
                stats.textContent = 'Rows: ' + (out.rowCount || 0) + ms;
                container.appendChild(stats);

                const table = document.createElement('table');

                const thead = document.createElement('thead');
                const headRow = document.createElement('tr');
                out.columns.forEach(col => {
                    const th = document.createElement('th');
                    th.textContent = String(col);
                    headRow.appendChild(th);
                });
                thead.appendChild(headRow);
                table.appendChild(thead);

                const tbody = document.createElement('tbody');
                out.rows.slice(0, 100).forEach(row => {
                    const tr = document.createElement('tr');
                    row.forEach(value => {
                        const td = document.createElement('td');
                        td.textContent = String(value === null || value === undefined ? '' : value);
                        tr.appendChild(td);
                    });
                    tbody.appendChild(tr);
                });
                table.appendChild(tbody);
                container.appendChild(table);
            }

            cellEl.appendChild(container);
        }

        function updateCellOutput(index, output, error) {
            if (!notebook.cells[index]) { return; }
            if (error) {
                notebook.cells[index].output = { error };
            } else {
                notebook.cells[index].output = output;
            }
            renderCellOutput(index);
            saveNotebook(false);
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
