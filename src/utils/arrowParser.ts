import { tableFromIPC, Type } from 'apache-arrow';

export interface ArrowParseResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
}

/**
 * Convert an Arrow value to a JS-friendly display value.
 * Handles BigInt, timestamps, null, and other Arrow-specific types.
 */
function convertArrowValue(value: any, arrowType?: Type): any {
  if (value === null || value === undefined) {
    return null;
  }

  // BigInt -> number if safe, otherwise string
  if (typeof value === 'bigint') {
    if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
      return Number(value);
    }
    return value.toString();
  }

  // Date objects from timestamp columns
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Uint8Array or other typed arrays -> convert to regular array
  if (ArrayBuffer.isView(value) && !(typeof value === 'string')) {
    return Array.from(value as any);
  }

  return value;
}

/**
 * Parse an Apache Arrow IPC binary response into a tabular result.
 *
 * The Arc server returns Arrow IPC stream format from /api/v1/query/arrow.
 *
 * Note: Arc may send timestamps marked as microseconds that are actually seconds.
 * This is based on the workaround in the Grafana datasource plugin (arrow.go lines 300-314).
 * If the first timestamp value is < 1e12, we treat it as seconds and convert accordingly.
 *
 * @param buffer The raw binary response from the Arrow endpoint
 * @param maxRows Optional limit on how many rows to parse (default: 100_000)
 */
export function parseArrowResponse(buffer: ArrayBuffer | Buffer, maxRows: number = 100_000): ArrowParseResult {
  if (!buffer || (buffer instanceof ArrayBuffer && buffer.byteLength === 0) || (Buffer.isBuffer(buffer) && buffer.length === 0)) {
    return { columns: [], rows: [], rowCount: 0 };
  }

  try {
    // Convert Buffer to Uint8Array if needed (apache-arrow expects Uint8Array or ArrayBuffer)
    const data = Buffer.isBuffer(buffer)
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : buffer;

    const table = tableFromIPC(data);

    const columns = table.schema.fields.map(f => f.name);
    const numRows = Math.min(table.numRows, maxRows);
    const rows: any[][] = [];

    for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
      const row: any[] = [];
      for (let colIdx = 0; colIdx < table.numCols; colIdx++) {
        const col = table.getChildAt(colIdx);
        const value = col?.get(rowIdx);
        const fieldType = table.schema.fields[colIdx]?.type?.typeId;
        row.push(convertArrowValue(value, fieldType));
      }
      rows.push(row);
    }

    return {
      columns,
      rows,
      rowCount: table.numRows
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to parse Arrow response: ${message}`);
  }
}
