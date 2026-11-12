import * as fs from 'node:fs';

/**
 * Encoders and writers for exporting a query result held by the extension
 * host. Nothing here imports `vscode`, so the code runs under plain Node.
 *
 * Output format: before the export moved to the host, the webview posted the
 * rows back. They had been embedded in the page as a JSON literal (evaluated
 * as JavaScript) and then serialized again by postMessage. `normalizeCell`
 * reproduces that round trip so CSV and JSON files stay byte-for-byte the
 * same as before; only the number of rows changes.
 */

/** A piece of encoded output that ends on a row boundary. */
export interface ExportChunk {
  text: string;
  /** Rows encoded so far, including the ones in this chunk. */
  rows: number;
}

/** Flush once a chunk reaches this many UTF-16 code units. */
export const CHUNK_SIZE = 64 * 1024;

// Returning undefined from a JSON.parse reviver deletes the key. A nested
// "__proto__" key was lost when the webview evaluated the rows as a JS
// literal (it set the prototype instead), so drop it the same way.
const dropProto = (key: string, value: unknown): unknown => key === '__proto__' ? undefined : value;

/**
 * Normalize one cell the way the old webview round trip did: undefined and
 * non-finite numbers become null; objects (including Arrow vectors and
 * struct rows) become their JSON value; values JSON cannot represent become
 * null. Strings, booleans and finite numbers pass through.
 */
export function normalizeCell(value: unknown): unknown {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      // JSON.stringify(-0) is "0"; String(-0) is "0" too, so -0 needs nothing.
      return Number.isFinite(value) ? value : null;
    case 'object': {
      if (value === null) { return null; }
      const json = JSON.stringify(value);
      if (json === undefined) { return null; }
      // The reviver is slow; only use it when the key can be there.
      return json.includes('"__proto__"') ? JSON.parse(json, dropProto) : JSON.parse(json);
    }
    case 'bigint':
      // Not produced by the parsers (top-level Int64 is converted); behave
      // like the old JSON embed, which threw.
      return JSON.parse(JSON.stringify(value));
    default:
      // undefined, function, symbol: JSON writes null inside an array.
      return null;
  }
}

/** Cells of a row as the webview saw them: in-range cells normalized, nothing past the end. */
function normalizeRow(row: any[]): any[] {
  const out = new Array(row.length);
  for (let i = 0; i < row.length; i++) {
    out[i] = normalizeCell(row[i]);
  }
  return out;
}

function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * CSV of the first `limit` rows: a header line, one line per row, joined by
 * "\n" with no trailing newline. Rows are written as they are (a short row
 * writes fewer fields).
 */
export function* encodeCsv(columns: string[], rows: any[][], limit: number): Generator<ExportChunk> {
  const count = Math.min(limit, rows.length);
  let parts: string[] = [columns.map(escapeCsvValue).join(',')];
  let size = parts[0].length;
  for (let r = 0; r < count; r++) {
    const line = '\n' + normalizeRow(rows[r]).map(escapeCsvValue).join(',');
    parts.push(line);
    size += line.length;
    if (size >= CHUNK_SIZE) {
      yield { text: parts.join(''), rows: r + 1 };
      parts = [];
      size = 0;
    }
  }
  if (parts.length > 0) {
    yield { text: parts.join(''), rows: count };
  }
}

/**
 * JSON of the first `limit` rows, identical to
 * `JSON.stringify(objects, null, 2)` where each object maps column names to
 * cells (a later duplicate column wins, a missing cell is omitted).
 */
export function* encodeJson(columns: string[], rows: any[][], limit: number): Generator<ExportChunk> {
  const count = Math.min(limit, rows.length);
  if (count === 0) {
    yield { text: '[]', rows: 0 };
    return;
  }
  let parts: string[] = ['[\n  '];
  let size = parts[0].length;
  for (let r = 0; r < count; r++) {
    const row = normalizeRow(rows[r]);
    const obj: Record<string, any> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    // Indenting a nested JSON value is additive: JSON never emits a raw
    // newline inside a string, so every "\n" is structural.
    const element = (r === 0 ? '' : ',\n  ') + JSON.stringify(obj, null, 2).replace(/\n/g, '\n  ');
    parts.push(element);
    size += element.length;
    if (size >= CHUNK_SIZE) {
      yield { text: parts.join(''), rows: r + 1 };
      parts = [];
      size = 0;
    }
  }
  parts.push('\n]');
  yield { text: parts.join(''), rows: count };
}

/** Cancellation and progress hooks for a write. */
export interface ExportControl {
  isCancelled(): boolean;
  /** Called when cancellation is requested; returns a disposer. */
  onCancel(listener: () => void): { dispose(): void };
  onProgress?(rows: number): void;
}

export const NEVER_CANCELLED: ExportControl = {
  isCancelled: () => false,
  onCancel: () => ({ dispose() {} })
};

const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

/**
 * Stream the chunks to a local file, opened with truncate like
 * `workspace.fs.writeFile` (a symlink is followed, the file keeps its mode).
 * Between chunks the event loop gets a turn, and a full stream buffer waits
 * for 'drain'. On cancel or error the partial file is removed, which also
 * removes a file the export was overwriting. Returns false when cancelled.
 */
export async function writeChunksToFile(
  path: string, chunks: Iterable<ExportChunk>, control: ExportControl = NEVER_CANCELLED
): Promise<boolean> {
  // Unlink the file the data went to, not a symlink pointing at it.
  let target = path;
  try { target = await fs.promises.realpath(path); } catch { /* new file */ }

  // Open first: a file that cannot be opened (for example a read-only one)
  // fails here, before anything was written or could be removed.
  const handle = await fs.promises.open(path, 'w');
  const stream = handle.createWriteStream();
  let failure: Error | undefined;
  let closed = false;
  stream.on('error', error => { failure ??= error; });
  stream.on('close', () => { closed = true; });
  const whenClosed = () => new Promise<void>(resolve => closed ? resolve() : stream.once('close', () => resolve()));

  // Wait until the buffer drains, the stream fails or the export is cancelled.
  const drained = () => new Promise<void>(resolve => {
    const done = () => {
      stream.off('drain', done); stream.off('error', done); stream.off('close', done);
      cancel.dispose();
      resolve();
    };
    const cancel = control.onCancel(done);
    stream.on('drain', done); stream.on('error', done); stream.on('close', done);
  });

  const abandon = async (): Promise<string | undefined> => {
    stream.destroy();
    await whenClosed();
    try {
      await fs.promises.unlink(target);
      return undefined;
    } catch (error: any) {
      return error?.code === 'ENOENT' ? undefined : String(error?.message ?? error);
    }
  };

  let cancelled = false;
  try {
    for (const chunk of chunks) {
      if (failure) { throw failure; }
      if (control.isCancelled()) { cancelled = true; break; }
      if (chunk.text.length > 0 && !stream.write(chunk.text, 'utf-8')) {
        await drained();
      }
      if (failure) { throw failure; }
      control.onProgress?.(chunk.rows);
      await yieldToEventLoop();
    }
    if (!cancelled && control.isCancelled()) { cancelled = true; }
    if (!cancelled) {
      stream.end();
      await whenClosed();
      if (failure) { throw failure; }
      return true;
    }
  } catch (error) {
    const original = error instanceof Error ? error : new Error(String(error));
    const unlinkError = await abandon();
    if (unlinkError) {
      original.message += ` (the partial file could not be removed: ${unlinkError})`;
    }
    throw original;
  }
  const unlinkError = await abandon();
  if (unlinkError) {
    throw new Error(`Export cancelled, but the partial file could not be removed: ${unlinkError}`);
  }
  return false;
}

/**
 * Collect the chunks into one Buffer for a file system that is not local
 * (`workspace.fs.writeFile` takes the whole content). Memory-bound: the
 * output is held once. Returns undefined when cancelled.
 */
export async function collectChunks(
  chunks: Iterable<ExportChunk>, control: ExportControl = NEVER_CANCELLED
): Promise<Buffer | undefined> {
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    if (control.isCancelled()) { return undefined; }
    buffers.push(Buffer.from(chunk.text, 'utf-8'));
    control.onProgress?.(chunk.rows);
    await yieldToEventLoop();
  }
  return control.isCancelled() ? undefined : Buffer.concat(buffers);
}
