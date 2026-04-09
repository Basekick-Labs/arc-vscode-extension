import * as vscode from 'vscode';
import { ArcQueryResult } from '../types';
import { escapeHtml } from '../utils/sqlUtils';

export class QueryResultsView {
  private static currentPanel: QueryResultsView | undefined;
  private static extensionUri: vscode.Uri;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

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
            this.exportToCSV(message.data);
            break;
          case 'exportJSON':
            this.exportToJSON(message.data);
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

  private update(results: ArcQueryResult, query: string): void {
    this.panel.title = 'Arc Query Results';
    this.panel.webview.html = this.getHtmlContent(results, query);
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  private getHtmlContent(results: ArcQueryResult, query: string): string {
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
    const dataRows = rows.slice(0, 1000).map(row => {
      const cells = row.map(cell => {
        const value = cell === null ? '<i>null</i>' : String(cell);
        return `<td>${escapeHtml(value)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const truncated = rows.length > 1000 ? `<p class="warning">Showing first 1000 rows of ${rowCount} total rows</p>` : '';

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
            rows: ${JSON.stringify(rows.slice(0, 1000))}
        };

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
                data: resultsData
            });
        }

        function exportJSON() {
            vscode.postMessage({
                command: 'exportJSON',
                data: resultsData
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

  private async exportToCSV(data: { columns: string[], rows: any[][] }): Promise<void> {
    try {
      // Convert to CSV format
      const csv = this.convertToCSV(data.columns, data.rows);

      // Save to file
      const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        defaultUri: vscode.Uri.file('query_results.csv')
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf-8'));
        vscode.window.showInformationMessage(`Exported ${data.rows.length} rows to ${uri.fsPath}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Export failed: ${message}`);
    }
  }

  private async exportToJSON(data: { columns: string[], rows: any[][] }): Promise<void> {
    try {
      // Convert to JSON format
      const json = this.convertToJSON(data.columns, data.rows);

      // Save to file
      const uri = await vscode.window.showSaveDialog({
        filters: { 'JSON Files': ['json'] },
        defaultUri: vscode.Uri.file('query_results.json')
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
        vscode.window.showInformationMessage(`Exported ${data.rows.length} rows to ${uri.fsPath}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Export failed: ${message}`);
    }
  }

  private convertToCSV(columns: string[], rows: any[][]): string {
    const escapeCsvValue = (value: any): string => {
      if (value === null || value === undefined) {
        return '';
      }
      const str = String(value);
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const lines = [
      columns.map(escapeCsvValue).join(','),
      ...rows.map(row => row.map(escapeCsvValue).join(','))
    ];

    return lines.join('\n');
  }

  private convertToJSON(columns: string[], rows: any[][]): string {
    const objects = rows.map(row => {
      const obj: Record<string, any> = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });

    return JSON.stringify(objects, null, 2);
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

    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
