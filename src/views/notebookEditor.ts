import * as vscode from 'vscode';
import { ConnectionManager } from '../utils/connectionManager';
import { ArcNotebook, ArcNotebookCell } from '../types/notebook';
import { escapeHtml } from '../utils/sqlUtils';
import { mergeSyncedNotebook, notebookValueText, sameNotebookValue } from './notebookSync';
import { createNotebookRecovery, NotebookDraft } from './notebookRecovery';

/**
 * JSON text with object keys sorted, after a JSON round trip (so NaN/-0/
 * undefined read the same as they do once written to disk). Used where two
 * notebooks must be equal as documents: a file's own key order (for example
 * output before content, or extra fields after output) must not make a
 * snapshot "differ" from the document it was taken from.
 */
function canonicalJson(value: unknown): string {
  const sortKeys = (node: unknown): unknown => {
    if (Array.isArray(node)) { return node.map(sortKeys); }
    if (node !== null && typeof node === 'object') {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(node as Record<string, unknown>).sort()) {
        Object.defineProperty(sorted, key, { value: sortKeys((node as Record<string, unknown>)[key]), enumerable: true, writable: true, configurable: true });
      }
      return sorted;
    }
    return node;
  };
  return JSON.stringify(sortKeys(JSON.parse(JSON.stringify(value) ?? 'null')));
}

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

  /** Panels currently rendering each notebook document. */
  private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();

  /** Serialize read/merge/applyEdit per document, not per panel. */
  private readonly saves = new Map<string, Promise<void>>();
  /** Reject saves queued by a webview that has since been rebuilt. */
  private readonly panelSessions = new Map<vscode.WebviewPanel, string>();
  private readonly reloadingPanels = new Set<vscode.WebviewPanel>();

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
    let pendingReload: { id: string; sessionId: string; timer: ReturnType<typeof setTimeout> } | undefined;
    const documentKey = document.uri.toString();
    const documentPanels = this.panels.get(documentKey) ?? new Set<vscode.WebviewPanel>();
    documentPanels.add(webviewPanel);
    this.panels.set(documentKey, documentPanels);

    const renderWebview = (recoveryState?: unknown) => {
      if (disposed) { return; }
      const sessionId = this.getNonce();
      const html = this.getHtmlContent(webviewPanel.webview, document, sessionId, recoveryState);
      this.panelSessions.set(webviewPanel, sessionId);
      this.reloadingPanels.delete(webviewPanel);
      webviewPanel.webview.html = html;
    };
    const updateWebview = () => {
      if (disposed || pendingReload) { return; }
      const sessionId = this.panelSessions.get(webviewPanel);
      if (!sessionId) { renderWebview(); return; }
      const id = this.getNonce();
      const timer = setTimeout(() => {
        if (!disposed && pendingReload?.id === id) {
          // Never force a replacement before the old view hands over its
          // draft. A stuck or hidden webview must not become silent data loss.
          vscode.window.showErrorMessage('The notebook changed, but this view has not confirmed draft recovery. Its contents have been kept. Copy any edits before closing it.');
        }
      }, 5000);
      timer.unref();
      pendingReload = { id, sessionId, timer };
      this.reloadingPanels.add(webviewPanel);
      webviewPanel.webview.postMessage({ command: 'prepareReload', reloadId: id, sessionId });
    };

    const retryReload = () => {
      if (!disposed && pendingReload) {
        webviewPanel.webview.postMessage({ command: 'prepareReload', reloadId: pendingReload.id, sessionId: pendingReload.sessionId });
      }
    };
    const viewStateSubscription = webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.visible) { retryReload(); }
    });

    // Handle messages from the webview
    const messageSubscription = webviewPanel.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'save':
          await this.saveNotebook(
            document,
            message.notebook,
            message.base,
            message.structural === true,
            webviewPanel,
            message.saveId,
            message.sessionId,
            message.outputChanges
          );
          break;
        case 'executeCell':
          if (disposed || this.panelSessions.get(webviewPanel) !== message.sessionId) { return; }
          await this.executeCell(webviewPanel.webview, message.index, message.content, message.sessionId);
          break;
        case 'webviewReady':
          if (disposed || this.panelSessions.get(webviewPanel) !== message.sessionId) { break; }
          if (pendingReload) { retryReload(); }
          else if (message.resuming || (message.initial === true && document.version !== message.version)) { updateWebview(); }
          else {
            // Focus/visibility readiness only retries a dropped handshake. A
            // version gap here is a syncNotebook still in flight (a sibling
            // saved as the user clicked into this panel), not a stale view:
            // re-send the current document instead of rebuilding the panel.
            if (document.version !== message.version) {
              const current = this.parseNotebook(document.getText());
              if (!current) { updateWebview(); break; }
              webviewPanel.webview.postMessage({ command: 'syncNotebook', notebook: current, version: document.version, sessionId: message.sessionId });
            }
            webviewPanel.webview.postMessage({ command: 'notebookReady', sessionId: message.sessionId });
          }
          break;
        case 'reloadReady':
          if (pendingReload && message.reloadId === pendingReload.id && message.sessionId === pendingReload.sessionId) {
            clearTimeout(pendingReload.timer);
            pendingReload = undefined;
            renderWebview(message.state);
          }
          break;
        case 'saveRecovery':
          await this.saveRecovery(document, message.recovery);
          break;
        case 'reloadNotebook':
          if (!disposed && this.panelSessions.get(webviewPanel) === message.sessionId) { updateWebview(); }
          break;
        case 'exportMarkdown':
          await this.exportMarkdown(message.markdown);
          break;
        case 'openRaw':
          // Escape hatch from the unreadable-file view: show the raw text so
          // the user can repair or copy out whatever survived.
          await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
          break;
      }
    });

    // Structural and external changes wait for a frozen draft handoff before
    // replacing HTML. The rendered content is read at handoff completion, so
    // multiple changes during the handshake coalesce to the latest document.
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() !== document.uri.toString()) { return; }

      const structural = this.verdictFor(e.document);

      // Our own typing/result save: the webview DOM is already up to date, and
      // rebuilding here is what used to destroy focus, scroll and in-progress
      // edits. Everything else -- our own structural save (add/delete cell) and
      // any external edit -- still rebuilds.
      //
      if (structural === false) { return; }

      updateWebview();
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      if (pendingReload) { clearTimeout(pendingReload.timer); }
      changeDocumentSubscription.dispose();
      viewStateSubscription.dispose();
      messageSubscription.dispose();
      documentPanels.delete(webviewPanel);
      this.panelSessions.delete(webviewPanel);
      this.reloadingPanels.delete(webviewPanel);
      if (documentPanels.size === 0) {
        this.panels.delete(documentKey);
      }
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
    base: ArcNotebook,
    structural: boolean,
    sourcePanel: vscode.WebviewPanel,
    saveId: number,
    sessionId: string,
    outputChanges?: unknown
  ): Promise<void> {
    const key = document.uri.toString();
    const previous = this.saves.get(key) ?? Promise.resolve();
    const save = previous.catch(() => undefined).then(async () => {
      // A structural/external edit can reorder same-type cells. Do not let
      // old-session queued writes run while the frozen draft is handed off.
      if (this.panelSessions.get(sourcePanel) !== sessionId || this.reloadingPanels.has(sourcePanel)) { return; }
      await this.applyNotebookSave(document, notebook, base, structural, sourcePanel, saveId, sessionId, outputChanges);
    });
    this.saves.set(key, save);
    try {
      await save;
    } finally {
      if (this.saves.get(key) === save) { this.saves.delete(key); }
    }
  }

  private async applyNotebookSave(
    document: vscode.TextDocument,
    notebook: ArcNotebook,
    base: ArcNotebook,
    structural: boolean,
    sourcePanel: vscode.WebviewPanel,
    saveId: number,
    sessionId: string,
    outputChanges?: unknown
  ): Promise<void> {
    const fail = (reason: string) => {
      sourcePanel.webview.postMessage({ command: 'saveFailed', saveId, sessionId });
      vscode.window.showErrorMessage(reason + ' Your edits remain in this panel or its recovered drafts. Save a recovery file before dismissing them.');
    };
    // Read at the front of the queue, never before awaiting an earlier save.
    // Malformed files must remain untouched (the #13 recovery guarantee).
    const current = this.parseNotebook(document.getText());
    const baseVersion = document.version;
    if (!current || !this.isNotebook(base) || !this.isNotebook(notebook)) {
      fail('The notebook could not be read, so this save was not applied.');
      return;
    }

    const sameStructure = (left: ArcNotebook, right: ArcNotebook) =>
      left.cells.length === right.cells.length && left.cells.every((cell, index) =>
        cell.type === right.cells[index].type
      );
    if (structural ? canonicalJson(current) !== canonicalJson(base) :
      !sameStructure(base, current) || !sameStructure(base, notebook)) {
      fail('The notebook structure or contents changed before this save could be applied.');
      return;
    }

    // Each sender supplies its own base. On a same-field conflict its local
    // edit wins; unrelated changes already in the document are preserved.
    // Non-structural saves list the cells whose output the sender replaced
    // (base then carries no outputs): outputs are merged by that list rather
    // than by comparing megabytes of query results on every autosave.
    const changes = !structural && Array.isArray(outputChanges) &&
      outputChanges.every(index => Number.isInteger(index) && index >= 0 && index < notebook.cells.length)
      ? outputChanges as number[] : undefined;
    if (!structural && !changes) {
      // Without the list, outputs would be merged against a base that carries
      // none, and every stale local result would overwrite a newer one.
      fail('The notebook save was malformed (missing output changes), so it was not applied.');
      return;
    }
    const merged = structural ? notebook : mergeSyncedNotebook(base, notebook, current, changes);
    const json = JSON.stringify(merged, null, 2);
    const normalized = this.normalize(json)!;
    const key = document.uri.toString();

    const changed = this.normalize(document.getText()) !== normalized;
    if (changed) {
      const queue = this.pendingWrites.get(key) ?? [];
      const entry = { content: normalized, structural };
      queue.push(entry);
      while (queue.length > 8) { queue.shift(); }
      this.pendingWrites.set(key, queue);

      const removePending = () => {
        const q = this.pendingWrites.get(key);
        if (q) {
          const i = q.indexOf(entry);
          if (i !== -1) { q.splice(i, 1); }
          if (q.length === 0) { this.pendingWrites.delete(key); }
        }
      };
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), json);
      try {
        // The change event may fire before applyEdit returns, so register the
        // pending write first. A refused/throwing edit must not poison it.
        if (!await vscode.workspace.applyEdit(edit)) {
          removePending();
          fail('VS Code did not apply the notebook save.');
          return;
        }
      } catch {
        removePending();
        fail('VS Code could not apply the notebook save.');
        return;
      }
    }

    // A no-op also needs an acknowledgment, or the sender stays in flight.
    // Broadcast what was written (merged, or the unchanged document), not the
    // sender's copy. Outputs travel only for the cells this write changed:
    // every panel has applied every earlier broadcast in order (a panel that
    // could not is rebuilt), so the rest are already in its last snapshot.
    // The sender gets none: the changed outputs are the ones it just sent.
    if (!structural || !changed) {
      const written = changed ? merged : current;
      const delta = changed ? changes : [];
      const strippedCells = written.cells.map(cell => {
        const copy = { ...cell };
        delete copy.output;
        return copy;
      });
      for (const panel of this.panels.get(key) ?? []) {
        const isSource = panel === sourcePanel && this.panelSessions.get(panel) === sessionId;
        const outputs: Record<number, { output?: ArcNotebookCell['output'] }> = {};
        if (delta && !isSource) {
          for (const index of delta) {
            const output = written.cells[index].output;
            outputs[index] = output === undefined ? {} : { output };
          }
        }
        panel.webview.postMessage({
          command: 'syncNotebook',
          notebook: delta ? { ...written, cells: strippedCells } : written,
          delta: delta ? { baseVersion, changed: delta, outputs } : undefined,
          version: document.version,
          sessionId: this.panelSessions.get(panel),
          saveId: isSource ? saveId : undefined
        });
      }
    }
  }

  private async executeCell(webview: vscode.Webview, cellIndex: number, query: string, sessionId: string): Promise<void> {
    if (!this.connectionManager.isConnected()) {
      webview.postMessage({
        command: 'cellResult',
        sessionId,
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
        sessionId,
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
        sessionId,
        index: cellIndex,
        error: message
      });
    }
  }

  private async saveRecovery(document: vscode.TextDocument, recovery: NotebookDraft): Promise<void> {
    // Recovery never writes into the live notebook or restores cells by index.
    // The user chooses a separate JSON file and can reconcile it explicitly.
    try {
      const uri = await vscode.window.showSaveDialog({
        filters: { json: ['json'] },
        defaultUri: document.uri.with({ path: document.uri.path + '.recovery.json' }),
        title: 'Save recovered notebook edits'
      });
      if (!uri) { return; }
      if (uri.toString() === document.uri.toString()) {
        vscode.window.showErrorMessage('Choose a separate recovery file; the live notebook was not overwritten.');
        return;
      }
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(recovery, null, 2), 'utf-8'));
      vscode.window.showInformationMessage('Recovered notebook edits saved.');
    } catch (error) {
      vscode.window.showErrorMessage(`Could not save recovery file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private recoveryMarkup(): string {
    return `<section id="recovered-drafts" hidden role="region" aria-label="Recovered unsaved edits" style="border: 1px solid var(--vscode-inputValidation-warningBorder); padding: 16px; margin-bottom: 20px;">
      <h2>Recovered unsaved edits</h2>
      <p>The notebook changed while this view had pending edits. They are kept below, including unfinished variable rows. They have not been applied to the current cells. Save a recovery file or copy the text before discarding a draft.</p>
      <div id="recovered-drafts-list"></div>
    </section>`;
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

  /**
   * View shown when a non-empty file cannot be read as a notebook.
   *
   * Deliberately inert: it defines no notebook state, no autosave and no save
   * message, so opening a damaged file cannot overwrite it. The only action
   * offered is opening the raw file so the user can repair or recover it.
   */
  private getUnreadableContent(webview: vscode.Webview, document: vscode.TextDocument, sessionId: string, recoveryState?: unknown): string {
    const nonce = this.getNonce();
    const recoverySource = createNotebookRecovery.toString();
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
    <title>Arc Notebook</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 30px;
            max-width: 760px;
            margin: 0 auto;
        }
        h2 { margin-top: 0; }
        .notice {
            border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-panel-border));
            background-color: var(--vscode-inputValidation-errorBackground, transparent);
            border-radius: 5px;
            padding: 16px 20px;
        }
        p { line-height: 1.5; }
        code {
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 5px;
            border-radius: 3px;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 0.9em;
            font-family: var(--vscode-font-family);
            margin-top: 6px;
        }
        button:hover { background-color: var(--vscode-button-hoverBackground); }
        .path {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            word-break: break-all;
        }
    </style>
</head>
<body>
    <div class="notice">
        <h2>This notebook could not be opened</h2>
        <p>
            <code>${escapeHtml(document.uri.path.split('/').pop() || 'notebook')}</code>
            is not empty, but its contents are not a valid Arc notebook — the
            file may be truncated, partially written, or in another format.
        </p>
        <p>
            It has <strong>not</strong> been modified. Editing is disabled here
            so that nothing overwrites whatever is still in the file.
        </p>
        <p>Open the raw file to inspect or repair it:</p>
        <button id="open-raw">Open File in Text Editor</button>
        <p class="path">${escapeHtml(document.uri.fsPath)}</p>
    </div>
    ${this.recoveryMarkup()}
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const sessionId = '${sessionId}';
        const recovery = (${recoverySource})(vscode, document, undefined, ${JSON.stringify(recoveryState)?.replace(/</g, '\\u003c') ?? 'undefined'}, sessionId);
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'prepareReload' && message.sessionId === sessionId) {
                vscode.postMessage({ command: 'reloadReady', reloadId: message.reloadId, sessionId, state: recovery.snapshot() });
            }
        });
        const ready = (initial = false) => vscode.postMessage({ command: 'webviewReady', sessionId, version: ${document.version}, resuming: recovery.resuming, initial });
        window.addEventListener('load', () => ready(true));
        window.addEventListener('focus', () => ready());
        document.addEventListener('visibilitychange', () => { if (!document.hidden) { ready(); } });
        document.getElementById('open-raw').addEventListener('click', () => {
            vscode.postMessage({ command: 'openRaw' });
        });
    </script>
</body>
</html>`;
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  /**
   * Interpret a document's text as a notebook.
   *
   * Distinguishes three cases that must NOT be conflated:
   *  - empty document: a legitimately new notebook, safe to start editing;
   *  - valid notebook: use it;
   *  - non-empty but unusable (bad JSON, or JSON that is not a notebook):
   *    return undefined so the caller can refuse to render an editable view.
   *
   * Previously anything unparseable silently became `{cells: []}`, and the
   * autosave then wrote that empty notebook back over the user's file. A
   * truncated or half-synced file was destroyed simply by being opened and
   * typed in. Separately, JSON that parsed but was not a notebook (an array,
   * a bare string) threw on `.cells.map` and broke rendering entirely.
   */
  private parseNotebook(text: string): ArcNotebook | undefined {
    if (text.trim() === '') {
      return { version: '1.0', cells: [] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return undefined;
    }

    return this.isNotebook(parsed) ? parsed : undefined;
  }

  private isNotebook(value: unknown): value is ArcNotebook {
    if (typeof value !== 'object' || value === null || !Array.isArray((value as ArcNotebook).cells)) { return false; }
    // Invalid raw edits must open the recovery view rather than throw halfway
    // through rebuilding it. Validate every field used as HTML or array data.
    return (value as ArcNotebook).cells.every(cell => {
      if (!cell || (cell.type !== 'sql' && cell.type !== 'markdown') || typeof cell.content !== 'string') { return false; }
      const output = cell.output;
      if (output === undefined || output === null) { return true; }
      if (typeof output !== 'object' || Array.isArray(output)) { return false; }
      return ((output.error === undefined || output.error === null) || typeof output.error === 'string') &&
        ((output.columns === undefined || output.columns === null) || (Array.isArray(output.columns) && output.columns.every(column => typeof column === 'string'))) &&
        ((output.rows === undefined || output.rows === null) || (Array.isArray(output.rows) && output.rows.every(row => Array.isArray(row)))) &&
        ((output.rowCount === undefined || output.rowCount === null) || typeof output.rowCount === 'number') &&
        ((output.executionTime === undefined || output.executionTime === null) || typeof output.executionTime === 'number');
    });
  }

  private getHtmlContent(webview: vscode.Webview, document: vscode.TextDocument, sessionId: string, recoveryState?: unknown): string {
    const notebook = this.parseNotebook(document.getText());

    if (!notebook) {
      // Render a read-only explanation instead of an empty, editable notebook.
      // Nothing here can autosave, so the file on disk stays intact.
      return this.getUnreadableContent(webview, document, sessionId, recoveryState);
    }

    const cellsHtml = notebook.cells.map((cell, i) => this.renderCell(cell, i)).join('');
    const nonce = this.getNonce();
    const mergeSyncedNotebookSource = mergeSyncedNotebook.toString();
    const recoverySource = createNotebookRecovery.toString();

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
    ${this.recoveryMarkup()}

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
        const mergeSyncedNotebook = ${mergeSyncedNotebookSource};
        const sameNotebookValue = ${sameNotebookValue.toString()};
        const notebookValueText = ${notebookValueText.toString()};
        let notebook = ${JSON.stringify(notebook).replace(/</g, '\\u003c')};
        const sessionId = '${sessionId}';
        // Shallow copy: cells are copied, outputs are shared. Outputs are only
        // ever replaced whole (updateCellOutput, merges), never mutated, so an
        // unchanged output is the same object here and in the model, and the
        // per-autosave checks below compare it in O(1).
        function snapshotNotebook(source) {
            const copy = { ...source, cells: source.cells.map(cell => ({ ...cell })) };
            if (source.globalVariables) { copy.globalVariables = { ...source.globalVariables }; }
            return copy;
        }
        function withoutOutputs(source) {
            return { ...source, cells: source.cells.map(cell => { const copy = { ...cell }; delete copy.output; return copy; }) };
        }
        // Last document the host acknowledged to this panel (never mutated).
        let lastSaved = snapshotNotebook(notebook);
        let lastVersion = ${document.version};
        let nextSaveId = 0;
        let inFlight = null;
        let structuralPending = false;
        let preparingReload = false;
        let viewReady = false;
        let variablesDomBase = {};
        let variablesReady = false;
        const recovery = (${recoverySource})(vscode, document, notebook, ${JSON.stringify(recoveryState)?.replace(/</g, '\\u003c') ?? 'undefined'}, sessionId);

        let recoveryCaptureTimer = null;
        function captureRecoveryState() {
            clearTimeout(recoveryCaptureTimer);
            if (recovery.resuming) { return; }
            const variableRows = variablesReady
                ? Array.from(document.querySelectorAll('.variable-row')).map(row => ({
                    key: row.querySelector('input[name="key"]').value,
                    value: row.querySelector('input[name="value"]').value
                }))
                : Object.entries(notebook.globalVariables || {}).map(([key, value]) => ({ key, value: notebookValueText(value) }));
            recovery.capture(notebook, lastSaved, variableRows);
        }

        function setStructuralBusy(busy = true) {
            // Cell indexes in the DOM are obsolete after a local add/delete.
            // Freeze editing until the host rebuilds or opens recovery.
            document.querySelectorAll('textarea[data-cell-index], .variable-row input')
                .forEach(element => { element.readOnly = busy; });
            document.querySelectorAll('.variable-row button, button[data-action]')
                .forEach(element => { element.disabled = busy; });
        }

        // Do not expose a stale embedded snapshot while a recreated frame
        // asks the host for the current document and preserves its old draft.
        setStructuralBusy();
        const ready = (initial = false) => vscode.postMessage({ command: 'webviewReady', sessionId, version: lastVersion, resuming: recovery.resuming, initial });
        window.addEventListener('focus', () => ready());
        document.addEventListener('visibilitychange', () => { if (!document.hidden) { ready(); } });

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
            variablesReady = true;
            setStructuralBusy(!viewReady || preparingReload);
            captureRecoveryState();
            ready(true);
        });

        function renderVariables() {
            const container = document.getElementById('variables-list');
            container.innerHTML = '';

            const vars = notebook.globalVariables || {};
            Object.entries(vars).forEach(([key, value]) => {
                addVariableRow(key, value);
            });
            variablesDomBase = readVariablesFromDom();
        }

        function renderVariablesPreservingState() {
            const container = document.getElementById('variables-list');
            // While an input in this list is focused, keep the row set and key
            // inputs as they are (incomplete keys, trailing spaces, rows whose
            // name is still empty). Values are still patched in place: a stale
            // value in a focused input would become the next keystroke's base
            // and overwrite a sibling's edit of the same variable.
            const focusedInside = container.contains(document.activeElement);
            const rows = Array.from(container.querySelectorAll('.variable-row'));
            const vars = notebook.globalVariables || {};
            const byKey = new Map(rows.map(row => [row.dataset.variableKey, row]));
            const kept = new Set();
            Object.entries(vars).forEach(([key, value]) => {
                const row = byKey.get(key);
                if (row) {
                    const keyInput = row.querySelector('input[name="key"]');
                    const valueInput = row.querySelector('input[name="value"]');
                    // <input>.value drops line breaks, so compare what the
                    // input can actually hold.
                    const text = notebookValueText(value).replace(/[\\r\\n]/g, '');
                    if (!focusedInside && keyInput.value.trim() !== key) { keyInput.value = key; }
                    // Input events keep the model equal to the DOM, and the
                    // merge keeps a pending local value, so a differing merged
                    // value means the sibling won this key: patch it, focused
                    // or not.
                    if (valueInput.value !== text) {
                        const { selectionStart, selectionEnd, selectionDirection } = valueInput;
                        valueInput.value = text;
                        if (valueInput === document.activeElement) {
                            valueInput.setSelectionRange(Math.min(selectionStart, text.length),
                                Math.min(selectionEnd, text.length), selectionDirection);
                        }
                    }
                    kept.add(row);
                } else if (!focusedInside) {
                    addVariableRow(key, value);
                }
            });
            rows.forEach(row => {
                // Empty rows are drafts, not missing persisted variables.
                if (!focusedInside && !kept.has(row) && row.querySelector('input[name="key"]').value.trim()) {
                    row.remove();
                }
            });
            variablesDomBase = readVariablesFromDom();
        }

        function addVariable() {
            addVariableRow('', '');
            captureRecoveryState();
        }

        function addVariableRow(key, value) {
            const container = document.getElementById('variables-list');
            const row = document.createElement('div');
            row.className = 'variable-row';
            row.dataset.variableKey = key;

            const keyInput = document.createElement('input');
            keyInput.name = 'key';
            keyInput.placeholder = 'Variable name';
            keyInput.value = key;
            keyInput.oninput = () => updateVariables();

            const valueInput = document.createElement('input');
            valueInput.name = 'value';
            valueInput.placeholder = 'Value';
            valueInput.value = notebookValueText(value);
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

        function readVariablesFromDom() {
            const rows = document.querySelectorAll('.variable-row');
            const newVars = Object.create(null);

            rows.forEach(row => {
                const key = row.querySelector('input[name="key"]').value.trim();
                const value = row.querySelector('input[name="value"]').value;
                row.dataset.variableKey = key;
                if (key) {
                    newVars[key] = value;
                }
            });

            return newVars;
        }

        function updateVariables() {
            const newVars = readVariablesFromDom();
            // The focused DOM may intentionally lag a sibling save. Apply
            // only this input's delta, not a stale copy of every visible row.
            notebook.globalVariables = mergeSyncedNotebook(
                { cells: [], globalVariables: variablesDomBase },
                { cells: [], globalVariables: newVars },
                { cells: [], globalVariables: notebook.globalVariables || {} }
            ).globalVariables;
            variablesDomBase = newVars;
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
                const text = notebookValueText(value);
                const quotedValue = isNaN(text) ? \`'\${text.replace(/'/g, "''") }'\` : text;
                result = result.replace(pattern, quotedValue);
            });

            return result;
        }

        function addCell(type) {
            // Input events already update the model. A focused textarea can
            // intentionally lag a remote save until blur; never copy it back.
            cancelAutosave();
            notebook.cells.push({
                type: type,
                content: type === 'markdown' ? '# New Markdown Cell' : 'SELECT * FROM table LIMIT 10;'
            });
            refreshView();
        }

        function deleteCell(index) {
            if (confirm('Delete this cell?')) {
                cancelAutosave();
                notebook.cells.splice(index, 1);
                refreshView();
            }
        }

        function executeCell(index) {
            if (!viewReady || preparingReload || structuralPending || inFlight?.structural) { return; }
            const cell = notebook.cells[index];
            if (cell.type !== 'sql') return;

            // The model contains all input events and remote updates. Reading
            // a focused textarea here could resurrect deferred stale content.
            // Substitute variables
            const processedQuery = substituteVariables(cell.content);

            vscode.postMessage({
                command: 'executeCell',
                sessionId,
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

        // captureRecoveryState() serialises the whole notebook, outputs
        // included, several times; run per keystroke it cost ~90 ms on a
        // 10k-row result. Capture once typing pauses instead. saveNotebook()
        // and prepareReload still capture synchronously before they act.
        const RECOVERY_CAPTURE_IDLE_MS = 250;
        function scheduleRecoveryCapture() {
            clearTimeout(recoveryCaptureTimer);
            recoveryCaptureTimer = setTimeout(captureRecoveryState, RECOVERY_CAPTURE_IDLE_MS);
        }

        function scheduleAutosave() {
            scheduleRecoveryCapture();
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

        function onCellChange(index) {
            const textarea = document.querySelector(\`#cell-\${index} textarea\`);
            if (textarea) {
                notebook.cells[index].content = textarea.value;
                scheduleAutosave();
            }
        }

        // Don't lose buffered edits if the panel closes or focus leaves.
        document.addEventListener('focusout', (e) => {
            if (e.target.matches && e.target.matches('textarea[data-cell-index], .variable-row input')) {
                if (autosaveTimer !== null) { flushAutosave(); }
                setTimeout(() => syncNotebook(lastSaved, lastVersion), 0);
            }
        });
        window.addEventListener('blur', () => {
            if (autosaveTimer !== null) { flushAutosave(); }
        });

        function saveNotebook(structural) {
            if (!viewReady || preparingReload) { return; }
            structuralPending = structuralPending || structural;
            captureRecoveryState();
            if (structuralPending) { setStructuralBusy(); }
            // Only one save per panel can be unacknowledged. Further typing
            // stays local until the host returns the actual written snapshot.
            if (inFlight) { return; }
            if (!structuralPending && sameNotebookValue(notebook, lastSaved)) { return; }
            inFlight = { saveId: ++nextSaveId, notebook: snapshotNotebook(notebook), structural: structuralPending };
            // A structural save is checked against the exact document, so it
            // carries the full base. Otherwise outputs merge by the list of
            // cells this panel replaced, and the base needs none.
            const outputChanges = structuralPending ? undefined : inFlight.notebook.cells
                .map((cell, index) => (lastSaved.cells[index] && cell.output === lastSaved.cells[index].output) ? -1 : index)
                .filter(index => index !== -1);
            vscode.postMessage({
                command: 'save',
                notebook: inFlight.notebook,
                base: structuralPending ? lastSaved : withoutOutputs(lastSaved),
                outputChanges,
                structural: structuralPending,
                saveId: inFlight.saveId,
                sessionId
            });
            structuralPending = false;
        }

        function refreshView() {
            saveNotebook(true);
        }

        // A delta sync carries outputs only for the cells its write changed;
        // the rest are taken (by reference) from lastSaved, which is exactly
        // the document that write started from (delta.baseVersion).
        function hydrate(nextNotebook, delta, acknowledged) {
            if (!delta) { return nextNotebook; }
            if (delta.baseVersion !== lastVersion || nextNotebook.cells.length !== lastSaved.cells.length) { return null; }
            const changed = new Set(delta.changed);
            for (let index = 0; index < nextNotebook.cells.length; index++) {
                const cell = nextNotebook.cells[index];
                let entry;
                if (!changed.has(index)) {
                    entry = { output: lastSaved.cells[index].output };
                } else if (Object.prototype.hasOwnProperty.call(delta.outputs, index)) {
                    entry = delta.outputs[index];
                } else if (acknowledged) {
                    entry = { output: inFlight.notebook.cells[index].output };
                } else {
                    return null;
                }
                if (entry.output === undefined) { delete cell.output; }
                else { cell.output = entry.output; }
            }
            return nextNotebook;
        }

        function syncNotebook(nextNotebook, version, saveId, delta) {
            if (recovery.resuming) { return; }
            if (version < lastVersion) { return; }
            const acknowledged = inFlight && saveId === inFlight.saveId;
            if (nextNotebook.cells.length !== notebook.cells.length ||
                nextNotebook.cells.some((cell, index) => cell.type !== notebook.cells[index].type)) {
                // A local structural edit may be waiting for a non-structural
                // acknowledgment. Keep it intact; the host validates its base.
                if (acknowledged) {
                    // The structural model still contains the submitted cell
                    // snapshot. Do not bless it with a newer base: the host
                    // must reject it if a sibling changed that snapshot.
                    lastSaved = inFlight.notebook;
                    lastVersion = version;
                    inFlight = null;
                    saveNotebook(structuralPending);
                }
                return;
            }

            // A delta for a write this panel already has (it rendered, or got a
            // full re-send, after the write applied) needs no rebuild.
            if (delta && !acknowledged && version === lastVersion && delta.baseVersion !== lastVersion) { return; }
            nextNotebook = hydrate(nextNotebook, delta, acknowledged);
            if (!nextNotebook) {
                // A delta that does not start from this panel's snapshot
                // cannot be applied; rebuild from the document (the reload
                // handshake keeps any unsent draft).
                vscode.postMessage({ command: 'reloadNotebook', sessionId });
                return;
            }
            const previousNotebook = notebook;
            const savedNotebook = acknowledged ? inFlight.notebook : lastSaved;
            // Snapshot: the model is mutated by typing, lastSaved never is, so
            // the two must not be the same object even if the merge returns
            // its incoming argument.
            notebook = snapshotNotebook(mergeSyncedNotebook(savedNotebook, previousNotebook, nextNotebook));
            lastSaved = nextNotebook;
            lastVersion = version;
            if (acknowledged) { inFlight = null; }
            notebook.cells.forEach((cell, index) => {
                const previousCell = previousNotebook.cells[index];
                const textarea = document.querySelector(
                    \`#cell-\${index} textarea[data-cell-index]\`
                );
                // Input events keep the model equal to the textarea, so a
                // differing merged value means the sibling's edit won this
                // field (no local edit was pending). Apply it even when the
                // textarea is focused: an iframe keeps its activeElement while
                // the user types in another panel, and a deferred stale value
                // would become the next keystroke's base and overwrite the
                // sibling's edit on disk. Setting .value fires no input event,
                // so nothing is echoed back.
                // <textarea>.value normalises CRLF/CR to LF, so compare in
                // that form (a CRLF cell would otherwise never match).
                // The merge keeps a pending local edit in cell.content, so a
                // difference here means the sibling's value won this cell.
                // Caret and selection are kept by offset; the textarea's own
                // undo history is reset by the programmatic update.
                const focused = document.activeElement === textarea;
                if (textarea && textarea.value !== cell.content.replace(/\\r\\n?/g, '\\n')) {
                    const scrollTop = textarea.scrollTop;
                    const scrollLeft = textarea.scrollLeft;
                    const { selectionStart, selectionEnd, selectionDirection } = textarea;
                    textarea.value = cell.content;
                    textarea.rows = Math.max(3, cell.content.split('\\n').length);
                    if (focused) {
                        textarea.setSelectionRange(
                            Math.min(selectionStart, cell.content.length),
                            Math.min(selectionEnd, cell.content.length),
                            selectionDirection
                        );
                    }
                    textarea.scrollTop = scrollTop;
                    textarea.scrollLeft = scrollLeft;
                }
                if (previousCell.output !== cell.output && !sameNotebookValue(previousCell.output, cell.output)) {
                    renderCellOutput(index);
                }
            });
            renderVariablesPreservingState();
            setStructuralBusy(!viewReady || preparingReload || structuralPending || !!inFlight?.structural);
            captureRecoveryState();
            if (structuralPending) { saveNotebook(true); }
            else if (!sameNotebookValue(notebook, lastSaved)) { scheduleAutosave(); }
        }

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.sessionId && message.sessionId !== sessionId) { return; }
            switch (message.command) {
                case 'notebookReady':
                    if (!recovery.resuming && !preparingReload) {
                        viewReady = true;
                        if (!structuralPending && !inFlight?.structural) { setStructuralBusy(false); }
                    }
                    break;
                case 'prepareReload':
                    if (message.sessionId !== sessionId) { break; }
                    preparingReload = true;
                    viewReady = false;
                    captureRecoveryState();
                    setStructuralBusy();
                    cancelAutosave();
                    vscode.postMessage({ command: 'reloadReady', reloadId: message.reloadId, sessionId, state: recovery.snapshot() });
                    break;
                case 'syncNotebook':
                    syncNotebook(message.notebook, message.version, message.saveId, message.delta);
                    break;
                case 'saveFailed':
                    if (inFlight && message.saveId === inFlight.saveId) {
                        const needsRecovery = inFlight.structural || structuralPending;
                        inFlight = null;
                        cancelAutosave();
                        if (needsRecovery) {
                            vscode.postMessage({ command: 'reloadNotebook', sessionId });
                        }
                    }
                    break;
                case 'cellResult':
                    if (!viewReady || preparingReload || structuralPending || inFlight?.structural) { break; }
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
                    th.textContent = notebookValueText(col);
                    headRow.appendChild(th);
                });
                thead.appendChild(headRow);
                table.appendChild(thead);

                const tbody = document.createElement('tbody');
                out.rows.slice(0, 100).forEach(row => {
                    const tr = document.createElement('tr');
                    row.forEach(value => {
                        const td = document.createElement('td');
                        td.textContent = notebookValueText(value);
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
                if (!viewReady || preparingReload || structuralPending || inFlight?.structural) { return; }
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
                '| ' + row.map(cell => notebookValueText(cell)).join(' | ') + ' |'
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
          '<tr>' + row.map(cell => `<td>${escapeHtml(notebookValueText(cell))}</td>`).join('') + '</tr>'
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
