import * as vscode from 'vscode';
import { encode } from '@msgpack/msgpack';

export interface GeneratorOptions {
  measurement: string;
  database?: string;
  rowCount: number;
  batchSize?: number;
  tags?: Record<string, string[]>;
  fields?: Record<string, { type: 'float' | 'int' | 'boolean' | 'string'; min?: number; max?: number; values?: string[] }>;
  startTime?: number;
  intervalMs?: number;
}

export interface GeneratorResult {
  success: boolean;
  rowsGenerated: number;
  duration: number;
  error?: string;
}

export class DataGenerator {
  private static getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private static getRandomFloat(min: number, max: number, decimals: number = 2): number {
    const value = Math.random() * (max - min) + min;
    return parseFloat(value.toFixed(decimals));
  }

  private static getRandomElement<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  private static generateValue(config: { type: string; min?: number; max?: number; values?: string[] }): any {
    switch (config.type) {
      case 'int':
        return this.getRandomInt(config.min || 0, config.max || 100);
      case 'float':
        return this.getRandomFloat(config.min || 0, config.max || 100);
      case 'boolean':
        return Math.random() > 0.5;
      case 'string':
        return config.values ? this.getRandomElement(config.values) : `value_${this.getRandomInt(1, 1000)}`;
      default:
        return 0;
    }
  }

  static async generate(
    options: GeneratorOptions,
    arcEndpoint: string,
    token: string,
    progressCallback?: (progress: number, message: string) => void
  ): Promise<GeneratorResult> {
    const startTime = Date.now();
    const batchSize = options.batchSize || 10000;

    try {
      let rowsGenerated = 0;
      const totalRows = options.rowCount;
      const timeStart = options.startTime || Date.now();
      const interval = options.intervalMs || 1000;

      // Default tags and fields if not provided
      const tags = options.tags || {
        host: ['server01', 'server02', 'server03'],
        region: ['us-east', 'us-west', 'eu-west']
      };

      const fields = options.fields || {
        value: { type: 'float', min: 0, max: 100 },
        count: { type: 'int', min: 0, max: 1000 },
        status: { type: 'boolean' }
      };

      // Generate data in batches
      while (rowsGenerated < totalRows) {
        const currentBatchSize = Math.min(batchSize, totalRows - rowsGenerated);

        // Prepare columnar data
        const columns: Record<string, any[]> = {
          time: []
        };

        // Initialize column arrays
        Object.keys(tags).forEach(tagName => {
          columns[tagName] = [];
        });

        Object.keys(fields).forEach(fieldName => {
          columns[fieldName] = [];
        });

        // Generate rows
        for (let i = 0; i < currentBatchSize; i++) {
          // Generate timestamp
          const timestamp = timeStart + (rowsGenerated + i) * interval;
          columns.time.push(timestamp);

          // Generate tag values
          Object.entries(tags).forEach(([tagName, possibleValues]) => {
            columns[tagName].push(this.getRandomElement(possibleValues));
          });

          // Generate field values
          Object.entries(fields).forEach(([fieldName, config]) => {
            columns[fieldName].push(this.generateValue(config));
          });
        }

        // Send batch to Arc
        await this.sendBatch(columns, options.measurement, arcEndpoint, token, options.database);

        rowsGenerated += currentBatchSize;

        if (progressCallback) {
          const progress = Math.round((rowsGenerated / totalRows) * 100);
          progressCallback(progress, `Generated ${rowsGenerated} / ${totalRows} rows...`);
        }
      }

      if (progressCallback) {
        progressCallback(100, 'Generation complete!');
      }

      return {
        success: true,
        rowsGenerated,
        duration: Date.now() - startTime
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        rowsGenerated: 0,
        duration: Date.now() - startTime,
        error: message
      };
    }
  }

  private static async sendBatch(
    columns: Record<string, any[]>,
    measurement: string,
    arcEndpoint: string,
    token: string,
    database?: string
  ): Promise<void> {
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

      const response = await fetch(`${arcEndpoint}/write/v1/msgpack`, {
        method: 'POST',
        headers,
        body: encoded
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Arc server returned ${response.status}: ${errorText}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to send batch to Arc: ${message}`);
    }
  }

  static async showGeneratorDialog(
    arcEndpoint: string,
    token: string
  ): Promise<GeneratorResult | undefined> {
    // Select preset or custom
    const preset = await vscode.window.showQuickPick(
      [
        {
          label: 'CPU Metrics',
          description: 'Simulated CPU usage data',
          value: 'cpu'
        },
        {
          label: 'Memory Metrics',
          description: 'Simulated memory usage data',
          value: 'memory'
        },
        {
          label: 'Network Metrics',
          description: 'Simulated network traffic data',
          value: 'network'
        },
        {
          label: 'IoT Sensor Data',
          description: 'Temperature, humidity, pressure sensors',
          value: 'iot'
        },
        {
          label: 'Custom',
          description: 'Define your own schema',
          value: 'custom'
        }
      ],
      {
        placeHolder: 'Select data type to generate'
      }
    );

    if (!preset) {
      return undefined;
    }

    // Get row count
    const rowCountStr = await vscode.window.showInputBox({
      prompt: 'How many rows to generate?',
      value: '10000',
      validateInput: (value) => {
        const num = parseInt(value);
        return !isNaN(num) && num > 0 && num <= 10000000 ? null : 'Enter a number between 1 and 10,000,000';
      }
    });

    if (!rowCountStr) {
      return undefined;
    }

    const rowCount = parseInt(rowCountStr);

    // Get database name (optional)
    const database = await vscode.window.showInputBox({
      prompt: 'Enter database name (optional)',
      placeHolder: 'Leave empty for default database'
    });

    // Prepare options based on preset
    let options: GeneratorOptions;

    switch (preset.value) {
      case 'cpu':
        options = {
          measurement: 'cpu',
          database: database || undefined,
          rowCount,
          batchSize: 10000,
          tags: {
            host: ['server01', 'server02', 'server03', 'server04', 'server05'],
            region: ['us-east-1', 'us-west-2', 'eu-west-1'],
            cpu: ['cpu0', 'cpu1', 'cpu2', 'cpu3']
          },
          fields: {
            usage_user: { type: 'float', min: 0, max: 50 },
            usage_system: { type: 'float', min: 0, max: 30 },
            usage_idle: { type: 'float', min: 50, max: 100 },
            usage_iowait: { type: 'float', min: 0, max: 10 }
          },
          startTime: Date.now() - (rowCount * 1000), // Back-fill data
          intervalMs: 1000
        };
        break;

      case 'memory':
        options = {
          measurement: 'mem',
          database: database || undefined,
          rowCount,
          batchSize: 10000,
          tags: {
            host: ['server01', 'server02', 'server03', 'server04', 'server05'],
            region: ['us-east-1', 'us-west-2', 'eu-west-1']
          },
          fields: {
            used: { type: 'int', min: 1000000000, max: 16000000000 },
            available: { type: 'int', min: 1000000000, max: 16000000000 },
            used_percent: { type: 'float', min: 30, max: 95 },
            cached: { type: 'int', min: 500000000, max: 4000000000 }
          },
          startTime: Date.now() - (rowCount * 1000),
          intervalMs: 1000
        };
        break;

      case 'network':
        options = {
          measurement: 'net',
          database: database || undefined,
          rowCount,
          batchSize: 10000,
          tags: {
            host: ['server01', 'server02', 'server03'],
            interface: ['eth0', 'eth1', 'wlan0']
          },
          fields: {
            bytes_sent: { type: 'int', min: 0, max: 1000000000 },
            bytes_recv: { type: 'int', min: 0, max: 1000000000 },
            packets_sent: { type: 'int', min: 0, max: 1000000 },
            packets_recv: { type: 'int', min: 0, max: 1000000 },
            err_in: { type: 'int', min: 0, max: 10 },
            err_out: { type: 'int', min: 0, max: 10 }
          },
          startTime: Date.now() - (rowCount * 1000),
          intervalMs: 1000
        };
        break;

      case 'iot':
        options = {
          measurement: 'sensors',
          database: database || undefined,
          rowCount,
          batchSize: 10000,
          tags: {
            device_id: ['sensor_001', 'sensor_002', 'sensor_003', 'sensor_004'],
            location: ['warehouse_a', 'warehouse_b', 'office_floor_1', 'office_floor_2'],
            sensor_type: ['DHT22', 'BME280', 'DS18B20']
          },
          fields: {
            temperature: { type: 'float', min: 15, max: 35 },
            humidity: { type: 'float', min: 30, max: 80 },
            pressure: { type: 'float', min: 980, max: 1020 },
            battery_level: { type: 'int', min: 0, max: 100 }
          },
          startTime: Date.now() - (rowCount * 60000), // 1 minute intervals
          intervalMs: 60000
        };
        break;

      case 'custom':
        const measurement = await vscode.window.showInputBox({
          prompt: 'Enter measurement name',
          value: 'custom_data'
        });

        if (!measurement) {
          return undefined;
        }

        options = {
          measurement,
          database: database || undefined,
          rowCount,
          batchSize: 10000,
          tags: {
            host: ['host1', 'host2', 'host3'],
            env: ['prod', 'staging', 'dev']
          },
          fields: {
            value: { type: 'float', min: 0, max: 100 },
            count: { type: 'int', min: 0, max: 1000 }
          },
          startTime: Date.now() - (rowCount * 1000),
          intervalMs: 1000
        };
        break;

      default:
        return undefined;
    }

    // Generate with progress
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Generating ${preset.label}`,
        cancellable: false
      },
      async (progress) => {
        return await this.generate(
          options,
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
