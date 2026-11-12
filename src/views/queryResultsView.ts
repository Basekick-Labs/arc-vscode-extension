import * as vscode from 'vscode';
import { ArcQueryResult } from '../types';
import { escapeHtml } from '../utils/sqlUtils';
import {
  collectChunks, encodeCsv, encodeJson, ExportChunk, ExportControl, NEVER_CANCELLED, writeChunksToFile
} from '../utils/resultExport';

/** Rows shown in the table, sent to the webview for the chart and Copy as Markdown. */
export const DISPLAY_ROW_CAP = 1000;
/** Exports above this many rows run with a cancellable progress notification. */
const PROGRESS_THRESHOLD = DISPLAY_ROW_CAP;

type ExportFormat = 'csv' | 'json';

export class QueryResultsView {
  private static currentPanel: QueryResultsView | undefined;
  private static extensionUri: vscode.Uri;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  /**
   * The result on screen. Exports read it, not the rows in the webview. One
   * panel holds at most one result; it is released when the next query
   * starts and when the panel closes.
   */
  private result?: ArcQueryResult;
  /** Identifies the page on screen; an export click from an older page is refused. */
  private generation = 0;
  private exporting = false;

  /**
   * Must be called once during extension activation to set the extension URI.
   */
  public static initialize(extensionUri: vscode.Uri): void {
    QueryResultsView.extensionUri = extensionUri;
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'exportCSV':
            this.exportResult('csv', message.generation);
            break;
          case 'exportJSON':
            this.exportResult('json', message.generation);
            break;
          case 'copyMarkdown':
            this.copyMarkdown(message.data);
            break;
        }
      },
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static show(results: ArcQueryResult, query: string): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (QueryResultsView.currentPanel) {
      QueryResultsView.currentPanel.panel.reveal(column);
      QueryResultsView.currentPanel.update(results, query);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'arcQueryResults',
        'Arc Query Results',
        column || vscode.ViewColumn.Two,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(QueryResultsView.extensionUri, 'resources')]
        }
      );

      QueryResultsView.currentPanel = new QueryResultsView(panel);
      QueryResultsView.currentPanel.update(results, query);
    }
  }

  /**
   * Drop the held result before a new query runs, so a large previous result
   * and the new response are never in memory together. The table stays on
   * screen; exporting it asks for the query to be run again.
   */
  public static releaseResult(): void {
    if (QueryResultsView.currentPanel) {
      QueryResultsView.currentPanel.result = undefined;
    }
  }

  private update(results: ArcQueryResult, query: string): void {
    // Build the page first: if that throws, the previous page, result and
    // generation stay consistent with each other.
    const generation = this.generation + 1;
    const html = this.getHtmlContent(results, query, generation);
    this.panel.title = 'Arc Query Results';
    this.panel.webview.html = html;
    this.result = results;
    this.generation = generation;
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  private getHtmlContent(results: ArcQueryResult, query: string, generation: number): string {
    const { columns, rows, rowCount, executionTime } = results;
    const webview = this.panel.webview;
    const nonce = this.getNonce();

    // Build URI for bundled Chart.js
    const chartJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(QueryResultsView.extensionUri, 'resources', 'chart.umd.min.js')
    );

    // Generate table headers
    const headerRow = columns.map(col => `<th>${escapeHtml(col)}</th>`).join('');

    // Generate table rows
    const dataRows = rows.slice(0, DISPLAY_ROW_CAP).map(row => {
      const cells = row.map(cell => {
        const value = cell === null ? '<i>null</i>' : String(cell);
        return `<td>${escapeHtml(value)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const truncated = rows.length > DISPLAY_ROW_CAP ? `<p class="warning">Showing first ${DISPLAY_ROW_CAP} rows of ${rowCount} total rows</p>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data:;">
    <title>Query Results</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
        }
        .query-info {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        .query-text {
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 3px;
            white-space: pre-wrap;
            font-size: 0.9em;
            margin: 10px 0;
        }
        .stats {
            display: flex;
            gap: 20px;
            margin-top: 10px;
            font-size: 0.9em;
        }
        .stat {
            color: var(--vscode-descriptionForeground);
        }
        .stat-value {
            color: var(--vscode-textLink-foreground);
            font-weight: bold;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            font-size: 0.9em;
        }
        th {
            background-color: var(--vscode-editor-lineHighlightBackground);
            color: var(--vscode-foreground);
            padding: 10px;
            text-align: left;
            border-bottom: 2px solid var(--vscode-panel-border);
            position: sticky;
            top: 0;
            font-weight: 600;
        }
        td {
            padding: 8px 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .warning {
            color: var(--vscode-notificationsWarningIcon-foreground);
            padding: 10px;
            background-color: var(--vscode-inputValidation-warningBackground);
            border-radius: 3px;
            margin: 10px 0;
        }
        .table-container {
            overflow: auto;
            max-height: calc(100vh - 250px);
        }
        .export-buttons {
            display: flex;
            gap: 10px;
            margin-top: 15px;
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
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        button:active {
            background-color: var(--vscode-button-hoverBackground);
            opacity: 0.8;
        }
        #chart-container {
            background-color: var(--vscode-editor-background);
            padding: 20px;
            border-radius: 5px;
            border: 1px solid var(--vscode-panel-border);
        }
        canvas {
            max-width: 100%;
        }
    </style>
</head>
<body>
    <div class="query-info">
        <h2>Query Results</h2>
        <div class="query-text">${escapeHtml(query)}</div>
        <div class="stats">
            <div class="stat">Rows: <span class="stat-value">${rowCount}</span></div>
            <div class="stat">Columns: <span class="stat-value">${columns.length}</span></div>
            ${executionTime ? `<div class="stat">Execution Time: <span class="stat-value">${executionTime.toFixed(2)}ms</span></div>` : ''}
        </div>
        <div class="export-buttons">
            <button data-action="exportCSV">📥 Export to CSV</button>
            <button data-action="exportJSON">📥 Export to JSON</button>
            <button data-action="copyMarkdown">📋 Copy as Markdown</button>
            <button data-action="toggleChart">📊 Toggle Chart</button>
        </div>
    </div>
    <div id="chart-container" style="display: none; margin: 20px 0;">
        <canvas id="chart"></canvas>
    </div>
    ${truncated}
    <div class="table-container">
        <table>
            <thead>
                <tr>${headerRow}</tr>
            </thead>
            <tbody>
                ${dataRows}
            </tbody>
        </table>
    </div>
    <script nonce="${nonce}" src="${chartJsUri}"></script>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const resultsData = {
            columns: ${JSON.stringify(columns)},
            rows: ${JSON.stringify(rows.slice(0, DISPLAY_ROW_CAP))}
        };
        // Exports are built by the extension from the full result; the page
        // only says which result it shows.
        const generation = ${generation};

        let chartInstance = null;

        // Event delegation for CSP-safe button handling
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            switch (btn.dataset.action) {
                case 'exportCSV': exportCSV(); break;
                case 'exportJSON': exportJSON(); break;
                case 'copyMarkdown': copyMarkdown(); break;
                case 'toggleChart': toggleChart(); break;
            }
        });

        function exportCSV() {
            vscode.postMessage({
                command: 'exportCSV',
                generation
            });
        }

        function exportJSON() {
            vscode.postMessage({
                command: 'exportJSON',
                generation
            });
        }

        function copyMarkdown() {
            vscode.postMessage({
                command: 'copyMarkdown',
                data: resultsData
            });
        }

        function toggleChart() {
            const container = document.getElementById('chart-container');
            if (container.style.display === 'none') {
                container.style.display = 'block';
                createChart();
            } else {
                container.style.display = 'none';
                if (chartInstance) {
                    chartInstance.destroy();
                    chartInstance = null;
                }
            }
        }

        function createChart() {
            if (chartInstance) {
                chartInstance.destroy();
            }

            const ctx = document.getElementById('chart').getContext('2d');
            const { columns, rows } = resultsData;

            // Get VS Code theme colors
            const computedStyle = getComputedStyle(document.body);
            const foregroundColor = computedStyle.getPropertyValue('--vscode-foreground').trim() || '#cccccc';
            const borderColor = computedStyle.getPropertyValue('--vscode-panel-border').trim() || '#454545';

            // Try to detect time-series data
            const timeColIndex = columns.findIndex(c =>
                c.toLowerCase().includes('time') ||
                c.toLowerCase().includes('date') ||
                c.toLowerCase() === 't'
            );

            // Find numeric columns
            const numericCols = columns.map((col, i) => {
                if (i === timeColIndex) return null;
                const isNumeric = rows.every(row => {
                    const val = row[i];
                    return val === null || val === undefined || !isNaN(Number(val));
                });
                return isNumeric ? i : null;
            }).filter(i => i !== null);

            if (timeColIndex >= 0 && numericCols.length > 0) {
                // Time-series line chart
                const labels = rows.slice(0, 100).map(row => {
                    const val = row[timeColIndex];
                    if (!val) return '';
                    const str = String(val);
                    // Truncate long timestamps
                    return str.length > 20 ? str.substring(0, 20) + '...' : str;
                });

                const datasets = numericCols.slice(0, 5).map((colIdx, i) => {
                    const colors = ['#4dc9f6', '#f67019', '#f53794', '#537bc4', '#acc236'];
                    return {
                        label: columns[colIdx],
                        data: rows.slice(0, 100).map(row => row[colIdx]),
                        borderColor: colors[i % colors.length],
                        backgroundColor: colors[i % colors.length] + '33',
                        tension: 0.1
                    };
                });

                chartInstance = new Chart(ctx, {
                    type: 'line',
                    data: { labels, datasets },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        aspectRatio: 2.5,
                        plugins: {
                            title: {
                                display: true,
                                text: 'Time Series Data (first 100 rows)',
                                color: foregroundColor
                            },
                            legend: {
                                labels: {
                                    color: foregroundColor
                                }
                            }
                        },
                        scales: {
                            x: {
                                ticks: { color: foregroundColor },
                                grid: { color: borderColor }
                            },
                            y: {
                                ticks: { color: foregroundColor },
                                grid: { color: borderColor }
                            }
                        }
                    }
                });
            } else if (numericCols.length > 0) {
                // Bar chart for first column vs numeric columns
                const labels = rows.slice(0, 20).map((row, i) =>
                    String(row[0] || \`Row \${i + 1}\`).substring(0, 20)
                );

                const datasets = numericCols.slice(0, 3).map((colIdx, i) => {
                    const colors = ['#4dc9f6', '#f67019', '#f53794'];
                    return {
                        label: columns[colIdx],
                        data: rows.slice(0, 20).map(row => row[colIdx]),
                        backgroundColor: colors[i % colors.length]
                    };
                });

                chartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: { labels, datasets },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        aspectRatio: 2.5,
                        plugins: {
                            title: {
                                display: true,
                                text: 'Data Visualization (first 20 rows)',
                                color: foregroundColor
                            },
                            legend: {
                                labels: {
                                    color: foregroundColor
                                }
                            }
                        },
                        scales: {
                            x: {
                                ticks: { color: foregroundColor },
                                grid: { color: borderColor }
                            },
                            y: {
                                ticks: { color: foregroundColor },
                                grid: { color: borderColor }
                            }
                        }
                    }
                });
            } else {
                alert('No numeric data found for charting');
            }
        }
    </script>
</body>
</html>`;
  }

  /**
   * Export the held result to CSV or JSON. The click names the page it came
   * from; the result held for that page is the one exported, even if another
   * query finishes while the prompt or the save dialog is open.
   */
  private async exportResult(format: ExportFormat, generation: unknown): Promise<void> {
    const snapshot = this.result;
    if (!snapshot || generation !== this.generation) {
      vscode.window.showWarningMessage(snapshot
        ? 'The results changed; export again.'
        : 'These results are no longer held; run the query again to export them.');
      return;
    }
    if (this.exporting) {
      vscode.window.showInformationMessage('An export is already running.');
      return;
    }
    this.exporting = true;
    try {
      const count = await this.chooseRowCount(snapshot.rows.length);
      if (count === undefined) {
        return;
      }

      const csv = format === 'csv';
      const uri = await vscode.window.showSaveDialog({
        filters: csv ? { 'CSV Files': ['csv'] } : { 'JSON Files': ['json'] },
        defaultUri: vscode.Uri.file(csv ? 'query_results.csv' : 'query_results.json')
      });
      if (!uri) {
        return;
      }

      const chunks = (): Iterable<ExportChunk> => csv
        ? encodeCsv(snapshot.columns, snapshot.rows, count)
        : encodeJson(snapshot.columns, snapshot.rows, count);
      const write = async (control: ExportControl): Promise<boolean> => {
        if (uri.scheme === 'file') {
          return writeChunksToFile(uri.fsPath, chunks(), control);
        }
        // Other file systems take the whole content at once.
        const buffer = await collectChunks(chunks(), control);
        if (!buffer) {
          return false;
        }
        await vscode.workspace.fs.writeFile(uri, buffer);
        return true;
      };

      const written = count > PROGRESS_THRESHOLD
        ? await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Exporting ${count} rows`, cancellable: true },
          (progress, token) => {
            let reported = 0;
            return write({
              isCancelled: () => token.isCancellationRequested,
              onCancel: listener => token.onCancellationRequested(listener),
              onProgress: rows => {
                progress.report({ message: `${rows} of ${count}`, increment: (rows - reported) * 100 / count });
                reported = rows;
              }
            });
          })
        : await write(NEVER_CANCELLED);
      if (written) {
        this.reportExport(snapshot, count, uri.fsPath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Export failed: ${message}`);
    } finally {
      this.exporting = false;
    }
  }

  /**
   * Rows to export: every held row, or `arc.export.maxRows` when set, or the
   * user's choice when `arc.export.promptForRowCount` is on. Undefined when
   * the prompt is dismissed.
   */
  private async chooseRowCount(held: number): Promise<number | undefined> {
    const config = vscode.workspace.getConfiguration('arc');
    const setting = config.get<unknown>('export.maxRows', 0);
    // Anything but a positive integer means "no limit"; the settings schema
    // already flags invalid values.
    const maxRows = typeof setting === 'number' && Number.isInteger(setting) && setting > 0 ? setting : 0;
    const fromSetting = maxRows > 0 ? Math.min(maxRows, held) : held;
    if (config.get<unknown>('export.promptForRowCount', false) !== true || held === 0) {
      return fromSetting;
    }

    const items: Array<vscode.QuickPickItem & { count?: number }> = [{ label: `All ${held} rows`, count: held }];
    if (maxRows > 0 && maxRows < held) {
      items.push({ label: `First ${maxRows} rows`, description: 'arc.export.maxRows', count: maxRows });
    }
    items.push({ label: 'Custom…' });
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'How many rows to export?' });
    if (!picked) {
      return undefined;
    }
    if (picked.count !== undefined) {
      return picked.count;
    }
    const value = await vscode.window.showInputBox({
      prompt: `Number of rows to export (1-${held})`,
      value: String(fromSetting),
      validateInput: text => parseRowCount(text, held) === undefined ? `Enter a whole number from 1 to ${held}` : undefined
    });
    return value === undefined ? undefined : parseRowCount(value, held);
  }

  private reportExport(result: ArcQueryResult, written: number, fsPath: string): void {
    const held = result.rows.length;
    if (result.rowCount > held) {
      // Only the Arrow parser holds fewer rows than the server returned.
      vscode.window.showWarningMessage(
        `Exported ${written} of ${result.rowCount} rows to ${fsPath}. Arrow results keep only the first ${held} rows; set arc.resultFormat to "json" to export them all.`
      );
    } else if (written < held) {
      vscode.window.showInformationMessage(`Exported ${written} of ${held} rows to ${fsPath}`);
    } else {
      vscode.window.showInformationMessage(`Exported ${written} rows to ${fsPath}`);
    }
  }

  private async copyMarkdown(data: { columns: string[], rows: any[][] }): Promise<void> {
    try {
      const markdown = this.convertToMarkdown(data.columns, data.rows);
      await vscode.env.clipboard.writeText(markdown);
      vscode.window.showInformationMessage('Markdown table copied to clipboard!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Copy failed: ${message}`);
    }
  }

  private convertToMarkdown(columns: string[], rows: any[][]): string {
    // Calculate column widths
    const colWidths = columns.map((col, i) => {
      const maxDataWidth = Math.max(...rows.map(row => String(row[i] || '').length));
      return Math.max(col.length, maxDataWidth);
    });

    // Create header
    const header = '| ' + columns.map((col, i) => col.padEnd(colWidths[i])).join(' | ') + ' |';
    const separator = '| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |';

    // Create rows
    const dataRows = rows.map(row =>
      '| ' + row.map((cell, i) => {
        const value = cell === null || cell === undefined ? '' : String(cell);
        return value.padEnd(colWidths[i]);
      }).join(' | ') + ' |'
    );

    return [header, separator, ...dataRows].join('\n');
  }

  public dispose(): void {
    QueryResultsView.currentPanel = undefined;
    this.result = undefined;

    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

function parseRowCount(text: string, max: number): number | undefined {
  if (!/^\s*\d+\s*$/.test(text)) {
    return undefined;
  }
  const count = Number(text);
  return count >= 1 && count <= max ? count : undefined;
}
