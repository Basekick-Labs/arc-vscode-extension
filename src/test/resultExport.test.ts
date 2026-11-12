import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import { tableFromIPC, tableToIPC, Table, vectorFromArray, List, Struct, Field, Int32, Utf8 } from 'apache-arrow';
import {
  CHUNK_SIZE, collectChunks, encodeCsv, encodeJson, ExportChunk, ExportControl, normalizeCell, writeChunksToFile
} from '../utils/resultExport';

// The converters as they were on main before the export moved to the host
// (src/views/queryResultsView.ts convertToCSV/convertToJSON), verbatim.
function oldCsv(columns: string[], rows: any[][]): string {
  const escapeCsvValue = (value: any): string => {
    if (value === null || value === undefined) {
      return '';
    }
    const str = String(value);
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
function oldJson(columns: string[], rows: any[][]): string {
  const objects = rows.map(row => {
    const obj: Record<string, any> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}
// What the old export received: the rows embedded in the page as a JSON
// literal, evaluated as JavaScript, then posted back (a JSON round trip).
const viaWebview = (rows: any[][]): any[][] =>
  JSON.parse(JSON.stringify(runInNewContext('(' + JSON.stringify(rows) + ')')));

// Bytes as the file sink writes them: each chunk encoded on its own.
const bytes = (chunks: Iterable<ExportChunk>): Buffer =>
  Buffer.concat([...chunks].map(chunk => Buffer.from(chunk.text, 'utf-8')));

function arrowCells(): { list: unknown; struct: unknown } {
  const list = vectorFromArray([[1, 2], [3]], new List(new Field('item', new Int32())));
  const struct = vectorFromArray([{ x: 1, y: 's,"q"' }, { x: 2, y: 't' }],
    new Struct([new Field('x', new Int32()), new Field('y', new Utf8())]));
  const table = tableFromIPC(tableToIPC(new Table({ l: list, s: struct }), 'stream'));
  return { list: table.getChildAt(0)!.get(0), struct: table.getChildAt(1)!.get(0) };
}

const columns = ['b', '1', 'a', 'a', '__proto__', 'u', '10', '-1', 'café, "x"'];
function fixtureRows(): any[][] {
  const { list, struct } = arrowCells();
  return [
    ['plain', 1, 'comma,here', 'quote"here', 'line\nbreak', 'crlf\r\nend', 'cr\ronly', '', 'ünïcødé 日本 🎉'],
    [null, undefined, NaN, Infinity, -Infinity, -0, 0, true, false],
    [{ n: { m: [1, {}, []], s: 'x\ny' } }, [1, 'x,y'], [], {}, { k: 1 }, list, struct, 'lone\ud800', 'pair😀'],
    [{ toJSON: () => undefined }, { toJSON: () => 5 }, { toJSON: () => ({ a: ' ' }) }, () => 1, Symbol('s'),
      JSON.parse('{"__proto__":{"evil":1},"k":1}'), 'end', 1.5e300, -42],
    ['short'],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    // eslint-disable-next-line no-sparse-arrays
    [1, , 3],
    ['</script>', '<b>', '\\', '\t', ' lead', 'trail ', '"', ',', '\n']
  ];
}
const rowsOf = (count: number): any[][] => {
  const base = fixtureRows();
  return Array.from({ length: count }, (_, i) => i < base.length ? base[i] : [i, `r${i}`, i % 3 === 0 ? null : 'v,"' + i, i * 0.5]);
};

for (const count of [0, 1, 2, 8, 999, 1000, 2500]) {
  test(`CSV and JSON match the old export byte for byte (${count} rows)`, () => {
    const rows = rowsOf(count);
    const webviewRows = viaWebview(rows);
    assert.deepEqual(bytes(encodeCsv(columns, rows, Infinity)), Buffer.from(oldCsv(columns, webviewRows), 'utf-8'));
    assert.deepEqual(bytes(encodeJson(columns, rows, Infinity)), Buffer.from(oldJson(columns, webviewRows), 'utf-8'));
  });
}

test('zero columns match the old export', () => {
  for (const rows of [[], [[]], [[], []]] as any[][][]) {
    assert.equal(bytes(encodeCsv([], rows, Infinity)).toString(), oldCsv([], viaWebview(rows)));
    assert.equal(bytes(encodeJson([], rows, Infinity)).toString(), oldJson([], viaWebview(rows)));
  }
});

test('a nested "__proto__" key is dropped, as the old webview literal dropped it', () => {
  const rows = [[JSON.parse('{"__proto__":{"evil":1},"k":1}')]];
  assert.equal(bytes(encodeJson(['v'], rows, Infinity)).toString(), '[\n  {\n    "v": {\n      "k": 1\n    }\n  }\n]');
});

test('normalizeCell follows JSON and never throws on toJSON returning undefined', () => {
  assert.equal(normalizeCell({ toJSON: () => undefined }), null);
  assert.equal(normalizeCell(undefined), null);
  assert.equal(normalizeCell(NaN), null);
  assert.equal(normalizeCell(() => 1), null);
  assert.equal(normalizeCell('s'), 's');
  assert.deepEqual(normalizeCell(arrowCells().list), [1, 2]);
  assert.deepEqual(normalizeCell(arrowCells().struct), { x: 1, y: 's,"q"' });
});

test('chunks end on row boundaries, so a surrogate pair is never split', () => {
  // Rows of emoji make most chunk-size offsets fall inside a surrogate pair.
  const rows = Array.from({ length: 30_000 }, (_, i) => ['🎉'.repeat(i % 17 + 1) + 'x'.repeat(i % 2), i]);
  const csv = [...encodeCsv(['e', 'n'], rows, Infinity)];
  const json = [...encodeJson(['e', 'n'], rows, Infinity)];
  assert.ok(csv.length > 3 && json.length > 3, 'several chunks');
  csv.slice(1).forEach(chunk => assert.ok(chunk.text.startsWith('\n'), 'CSV chunk starts a row'));
  json.slice(1).forEach(chunk => assert.ok(/^(,\n {2}\{|\n\])/.test(chunk.text), 'JSON chunk starts an element'));
  csv.slice(0, -1).forEach(chunk => assert.ok(chunk.text.length >= CHUNK_SIZE));
  assert.deepEqual(bytes(csv), Buffer.from(oldCsv(['e', 'n'], viaWebview(rows)), 'utf-8'));
  assert.deepEqual(bytes(json), Buffer.from(oldJson(['e', 'n'], viaWebview(rows)), 'utf-8'));
  assert.equal(csv.at(-1)!.rows, 30_000);
});

test('a limit writes the first N rows; a limit above the row count writes all; 0 writes none', () => {
  const rows = rowsOf(50);
  const web = viaWebview(rows);
  assert.deepEqual(bytes(encodeCsv(columns, rows, 10)), Buffer.from(oldCsv(columns, web.slice(0, 10))));
  assert.deepEqual(bytes(encodeJson(columns, rows, 10)), Buffer.from(oldJson(columns, web.slice(0, 10))));
  assert.deepEqual(bytes(encodeCsv(columns, rows, 500)), Buffer.from(oldCsv(columns, web)));
  assert.equal(bytes(encodeCsv(columns, rows, 0)).toString(), oldCsv(columns, []));
  assert.equal(bytes(encodeJson(columns, rows, 0)).toString(), '[]');
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arc-export-'));
const control = (cancelAfter = Infinity): ExportControl & { cancel(): void } => {
  let cancelled = false, chunks = 0;
  const listeners = new Set<() => void>();
  const cancel = () => { cancelled = true; listeners.forEach(fn => fn()); };
  return {
    cancel,
    isCancelled: () => cancelled,
    onCancel: fn => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
    onProgress: () => { if (++chunks >= cancelAfter) { cancel(); } }
  };
};

test('100,000 rows are written to a file in full', async () => {
  const dir = tmp();
  const rows = Array.from({ length: 100_000 }, (_, i) => [i, `name ${i}`, i % 7 === 0 ? null : i / 3, 'a,"b"\nc']);
  const cols = ['id', 'name', 'value', 'text'];
  const csvFile = path.join(dir, 'out.csv'), jsonFile = path.join(dir, 'out.json');
  assert.equal(await writeChunksToFile(csvFile, encodeCsv(cols, rows, Infinity)), true);
  assert.equal(await writeChunksToFile(jsonFile, encodeJson(cols, rows, Infinity)), true);
  assert.equal(fs.readFileSync(csvFile, 'utf-8'), oldCsv(cols, rows));
  const parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  assert.equal(parsed.length, 100_000);
  assert.deepEqual(parsed[99_999], { id: 99_999, name: 'name 99999', value: 33_333, text: 'a,"b"\nc' });
  fs.rmSync(dir, { recursive: true });
});

test('writing through a symlink keeps the link and the file mode, like workspace.fs.writeFile', async () => {
  const dir = tmp();
  const real = path.join(dir, 'real.csv'), link = path.join(dir, 'link.csv');
  fs.writeFileSync(real, 'old contents that are longer than the new ones', { mode: 0o600 });
  fs.chmodSync(real, 0o600);
  fs.symlinkSync(real, link);
  assert.equal(await writeChunksToFile(link, encodeCsv(['a'], [[1]], Infinity)), true);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readFileSync(real, 'utf-8'), 'a\n1');
  assert.equal(fs.statSync(real).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true });
});

test('cancel removes the partial file and reports false', async () => {
  const dir = tmp(), file = path.join(dir, 'out.csv');
  const rows = Array.from({ length: 50_000 }, (_, i) => [i, 'x'.repeat(20)]);
  const ctl = control(2);
  assert.equal(await writeChunksToFile(file, encodeCsv(['i', 's'], rows, Infinity), ctl), false);
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true });
});

test('cancel before the first write leaves no file', async () => {
  const dir = tmp(), file = path.join(dir, 'out.csv');
  const ctl = control();
  function* chunks(): Generator<ExportChunk> {
    yield { text: 'x'.repeat(8 * 1024 * 1024), rows: 1 };
    yield { text: 'y', rows: 2 };
  }
  const writing = writeChunksToFile(file, chunks(), ctl);
  ctl.cancel();
  assert.equal(await writing, false);
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true });
});

test('an error while encoding removes the partial file and keeps the error', async () => {
  const dir = tmp(), file = path.join(dir, 'out.csv');
  function* chunks(): Generator<ExportChunk> {
    yield { text: 'a'.repeat(100_000), rows: 1 };
    throw new Error('encode failed');
  }
  await assert.rejects(writeChunksToFile(file, chunks()), /^Error: encode failed$/);
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true });
});

test('a file that cannot be opened is left untouched', { skip: process.getuid?.() === 0 }, async () => {
  const dir = tmp(), file = path.join(dir, 'readonly.csv');
  fs.writeFileSync(file, 'keep me');
  fs.chmodSync(file, 0o444);
  await assert.rejects(writeChunksToFile(file, encodeCsv(['a'], [[1]], Infinity)), /EACCES/);
  assert.equal(fs.readFileSync(file, 'utf-8'), 'keep me');
  fs.chmodSync(file, 0o644);
  fs.rmSync(dir, { recursive: true });
});

test('collectChunks returns one buffer, or undefined when cancelled', async () => {
  const rows = rowsOf(3000);
  const buffer = await collectChunks(encodeJson(columns, rows, Infinity));
  assert.deepEqual(buffer, Buffer.from(oldJson(columns, viaWebview(rows)), 'utf-8'));
  assert.equal(await collectChunks(encodeCsv(columns, rowsOf(20_000), Infinity), control(1)), undefined);
});
