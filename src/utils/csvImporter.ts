import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { encode } from '@msgpack/msgpack';

export interface CSVImportOptions {
  measurement: string;
  database?: string;
  timestampColumn?: string;
  timestampFormat?: 'iso' | 'unix' | 'unix_ms';
  tagColumns?: string[];
  fieldColumns?: string[];
  hasHeader?: boolean;
  delimiter?: string;
  skipRows?: number;
}

export interface ImportResult {
  success: boolean;
  rowsProcessed: number;
  rowsIngested: number;
  errors: string[];
  duration: number;
}

export class CSVImporter {
  private static parseCSVLine(line: string, delimiter: string = ','): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  private static parseTimestamp(value: string, format: string): number {
    switch (format) {
      case 'unix':
        return parseInt(value) * 1000; // Convert to milliseconds
      case 'unix_ms':
        return parseInt(value);
      case 'iso':
      default:
        return new Date(value).getTime();
    }
  }

  private static inferColumnType(value: string): 'number' | 'boolean' | 'string' {
    // Try boolean
    if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
      return 'boolean';
    }

    // Try number
    if (!isNaN(Number(value)) && value.trim() !== '') {
      return 'number';
    }

    return 'string';
  }

  private static convertValue(value: string, type: 'number' | 'boolean' | 'string'): any {
    switch (type) {
      case 'number':
        return Number(value);
      case 'boolean':
        return value.toLowerCase() === 'true';
      case 'string':
      default:
        return value;
    }
  }

  static async importFromFile(
    filePath: string,
    options: CSVImportOptions,
    arcEndpoint: string,
    token: string,
    progressCallback?: (progress: number, message: string) => void
  ): Promise<ImportResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let rowsProcessed = 0;
    let rowsIngested = 0;

    try {
      // Read file
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      if (lines.length === 0) {
        return {
          success: false,
          rowsProcessed: 0,
          rowsIngested: 0,
          errors: ['File is empty'],
          duration: Date.now() - startTime
        };
      }

      // Parse header
      const delimiter = options.delimiter || ',';
      const skipRows = options.skipRows || 0;
      let headerLine = options.hasHeader !== false ? 0 : -1;

      if (headerLine >= 0) {
        headerLine += skipRows;
      }

      const headers = headerLine >= 0
        ? this.parseCSVLine(lines[headerLine], delimiter)
        : Array.from({ length: this.parseCSVLine(lines[skipRows], delimiter).length }, (_, i) => `column${i + 1}`);

      // Determine column types from first data row
      const firstDataRow = this.parseCSVLine(lines[headerLine + 1 || skipRows], delimiter);
      const columnTypes: Record<string, 'number' | 'boolean' | 'string'> = {};

      headers.forEach((header, i) => {
        if (header !== options.timestampColumn) {
          columnTypes[header] = this.inferColumnType(firstDataRow[i]);
        }
      });

      // Determine which columns are tags vs fields
      const timestampColIndex = options.timestampColumn
        ? headers.indexOf(options.timestampColumn)
        : -1;

      let tagCols = options.tagColumns || [];
      let fieldCols = options.fieldColumns || [];

      // Auto-detect if not specified
      if (tagCols.length === 0 && fieldCols.length === 0) {
        headers.forEach((header, i) => {
          if (i === timestampColIndex) return;

          if (columnTypes[header] === 'string') {
            tagCols.push(header);
          } else {
            fieldCols.push(header);
          }
        });
      }

      // Prepare columnar data structure
      const columns: Record<string, any[]> = {
        time: []
      };

      // Initialize column arrays
      [...tagCols, ...fieldCols].forEach(col => {
        columns[col] = [];
      });

      // Process data rows
      const dataStartLine = (headerLine >= 0 ? headerLine + 1 : skipRows);
      const batchSize = 10000; // Process in batches

      for (let i = dataStartLine; i < lines.length; i++) {
        try {
          const values = this.parseCSVLine(lines[i], delimiter);
          if (values.length !== headers.length) {
            errors.push(`Row ${i + 1}: Column count mismatch`);
            continue;
          }

          // Extract timestamp
          const timestamp = timestampColIndex >= 0
            ? this.parseTimestamp(values[timestampColIndex], options.timestampFormat || 'iso')
            : Date.now();

          columns.time.push(timestamp);

          // Extract tags and fields
          headers.forEach((header, idx) => {
            if (idx === timestampColIndex) return;

            if (tagCols.includes(header) || fieldCols.includes(header)) {
              const value = this.convertValue(values[idx], columnTypes[header]);
              columns[header].push(value);
            }
          });

          rowsProcessed++;

          // Flush batch
          if (rowsProcessed % batchSize === 0) {
            const ingested = await this.sendBatch(
              columns,
              options.measurement,
              arcEndpoint,
              token,
              options.database
            );

            rowsIngested += ingested;

            // Clear columns for next batch
            Object.keys(columns).forEach(key => {
              columns[key] = [];
            });

            if (progressCallback) {
              const progress = Math.round((i / lines.length) * 100);
              progressCallback(progress, `Processed ${rowsProcessed} rows...`);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Row ${i + 1}: ${message}`);
        }
      }

      // Flush remaining data
      if (columns.time.length > 0) {
        const ingested = await this.sendBatch(
          columns,
          options.measurement,
          arcEndpoint,
          token,
          options.database
        );
        rowsIngested += ingested;
      }

      if (progressCallback) {
        progressCallback(100, 'Import complete!');
      }

      return {
        success: errors.length === 0,
        rowsProcessed,
        rowsIngested,
        errors,
        duration: Date.now() - startTime
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        rowsProcessed,
        rowsIngested,
        errors: [message],
        duration: Date.now() - startTime
      };
    }
  }

  private static async sendBatch(
    columns: Record<string, any[]>,
    measurement: string,
    arcEndpoint: string,
    token: string,
    database?: string
  ): Promise<number> {
    try {
      // Prepare MessagePack payload in columnar format
      const payload = {
        m: measurement,
        columns: columns
      };

      // Encode to MessagePack
      const encoded = encode(payload);

      // Send to Arc
      const headers: Record<string, string> = {
        'Content-Type': 'application/msgpack',
        'Authorization': `Bearer ${token}`
      };

      if (database) {
        headers['x-arc-database'] = database;
      }

      const response = await fetch(`${arcEndpoint}/api/v1/write/msgpack`, {
        method: 'POST',
        headers,
        body: encoded
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Arc server returned ${response.status}: ${errorText}`);
      }

      return columns.time.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to send batch to Arc: ${message}`);
    }
  }

  static async showImportDialog(
    arcEndpoint: string,
    token: string
  ): Promise<ImportResult | undefined> {
    // Select CSV file
    const fileUris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {
        'CSV Files': ['csv', 'tsv', 'txt']
      },
      openLabel: 'Import CSV'
    });

    if (!fileUris || fileUris.length === 0) {
      return undefined;
    }

    const filePath = fileUris[0].fsPath;
    const fileName = path.basename(filePath, path.extname(filePath));

    // Get measurement name
    const measurement = await vscode.window.showInputBox({
      prompt: 'Enter measurement name',
      value: fileName,
      validateInput: (value) => {
        return value.trim() ? null : 'Measurement name is required';
      }
    });

    if (!measurement) {
      return undefined;
    }

    // Get database name (optional)
    const database = await vscode.window.showInputBox({
      prompt: 'Enter database name (optional)',
      placeHolder: 'Leave empty for default database'
    });

    // Read first few lines to detect structure
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 5);
    const preview = lines.join('\n');

    // Ask about header
    const hasHeader = await vscode.window.showQuickPick(
      ['Yes', 'No'],
      {
        placeHolder: `Does the file have a header row?\n\nPreview:\n${preview.substring(0, 200)}...`
      }
    );

    if (!hasHeader) {
      return undefined;
    }

    // Detect delimiter
    const delimiter = await vscode.window.showQuickPick(
      [
        { label: 'Comma (,)', value: ',' },
        { label: 'Tab', value: '\t' },
        { label: 'Semicolon (;)', value: ';' },
        { label: 'Pipe (|)', value: '|' }
      ],
      { placeHolder: 'Select delimiter' }
    );

    if (!delimiter) {
      return undefined;
    }

    // Parse headers to let user select timestamp column
    const headers = this.parseCSVLine(lines[0], delimiter.value);
    const timestampColumn = await vscode.window.showQuickPick(
      [{ label: '(Auto-generate timestamp)', value: '' }, ...headers.map(h => ({ label: h, value: h }))],
      { placeHolder: 'Select timestamp column' }
    );

    if (!timestampColumn) {
      return undefined;
    }

    // Import with progress
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Importing CSV to Arc',
        cancellable: false
      },
      async (progress) => {
        return await this.importFromFile(
          filePath,
          {
            measurement,
            database: database || undefined,
            timestampColumn: timestampColumn.value || undefined,
            hasHeader: hasHeader === 'Yes',
            delimiter: delimiter.value
          },
          arcEndpoint,
          token,
          (percent, message) => {
            progress.report({ increment: percent, message });
          }
        );
      }
    );
  }
}
