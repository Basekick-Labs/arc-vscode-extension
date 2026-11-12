import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Module from 'node:module';
import { ArcQueryResult } from '../types';
const { JSDOM } = require('jsdom');

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

// One vscode test double for the file; each test resets its state.
let state: any;
function reset() {
  state = {
    config: {} as Record<string, unknown>,
    save: undefined as any,
    saveDialogs: 0,
    quickPicks: [] as any[],
    pick: undefined as ((items: any[]) => any) | undefined,
    input: undefined as ((options: any) => any) | undefined,
    info: [] as string[], warnings: [] as string[], errors: [] as string[],
    progress: [] as any[],
    cancelAfterReports: Infinity,
    fsWrites: [] as Array<{ uri: any; contents: Buffer }>,
    fsWriteGate: undefined as Promise<void> | undefined,
    clipboard: undefined as string | undefined,
    panel: undefined as any,
    receiver: undefined as ((message: any) => unknown) | undefined,
    executeQuery: undefined as ((request: any) => Promise<ArcQueryResult>) | undefined
  };
}
reset();
const fileUri = (p: string) => ({ scheme: 'file', fsPath: p, path: p });
const vscode = {
  // VS Code API names are intentionally preserved in this test double.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Uri: { file: fileUri, joinPath: () => ({}) },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  ViewColumn: { Two: 2 },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  ProgressLocation: { Notification: 15 },
  window: {
    get activeTextEditor() {
      return { viewColumn: 1, selection: { isEmpty: true }, document: { getText: () => 'SELECT 1' } };
    },
    createWebviewPanel: () => {
      const panel = { title: '', reveal() {}, dispose() {}, onDidDispose: () => ({ dispose() {} }),
        webview: { html: '', cspSource: 'csp', asWebviewUri: () => 'chart.js',
          onDidReceiveMessage: (fn: any) => { state.receiver = fn; return { dispose() {} }; } } };
      state.panel = panel;
      return panel;
    },
    showSaveDialog: async () => { state.saveDialogs++; return typeof state.save === 'function' ? state.save() : state.save; },
    showQuickPick: async (items: any[]) => { state.quickPicks.push(items); return state.pick?.(items); },
    showInputBox: async (options: any) => state.input?.(options),
    showInformationMessage: (message: string) => { state.info.push(message); },
    showWarningMessage: (message: string) => { state.warnings.push(message); },
    showErrorMessage: (message: string) => { state.errors.push(message); },
    withProgress: async (options: any, task: any) => {
      state.progress.push(options);
      let cancelled = false, reports = 0;
      const listeners: Array<() => void> = [];
      const token = { get isCancellationRequested() { return cancelled; },
        onCancellationRequested: (fn: () => void) => { listeners.push(fn); return { dispose() {} }; } };
      return task({ report: () => {
        if (++reports >= state.cancelAfterReports) { cancelled = true; listeners.forEach(fn => fn()); }
      } }, token);
    }
  },
  workspace: {
    getConfiguration: () => ({ get: (key: string, fallback: unknown) => key in state.config ? state.config[key] : fallback }),
    fs: { writeFile: async (uri: any, contents: Buffer) => { await state.fsWriteGate; state.fsWrites.push({ uri, contents }); } }
  },
  env: { clipboard: { writeText: async (text: string) => { state.clipboard = text; } } }
};

const loader = Module as unknown as { _load: (...args: any[]) => any };
const original = loader._load;
let resultsView: any, arcCommands: any;
try {
  loader._load = function (name: string, ...args: any[]) {
    return name === 'vscode' ? vscode : original.call(this, name, ...args);
  };
  resultsView = require('../views/queryResultsView').QueryResultsView;
  arcCommands = require('../commands/arcCommands').ArcCommands;
} finally { loader._load = original; }
resultsView.initialize({});

const current = () => resultsView.currentPanel;
beforeEach(() => { current()?.dispose(); reset(); });

const columns = ['time', 'host', 'value'];
function result(count: number, rowCount = count): ArcQueryResult {
  return { columns, rowCount, executionTime: 1.5,
    rows: Array.from({ length: count }, (_, i) => [1_700_000_000_000 + i, `host-${i},"x"`, i / 4]) };
}
const tmpDirs: string[] = [];
const tmpFile = (name: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-view-'));
  tmpDirs.push(dir);
  return path.join(dir, name);
};
after(() => tmpDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
const generation = () => Number(/const generation = (\d+);/.exec(state.panel.webview.html)![1]);

/** Let pending prompts and dialogs resolve, then wait for any write. */
async function settle() {
  for (let i = 0; i < 20; i++) { await tick(); }
  while (current()?.exporting) { await tick(); }
}

/** Send a message as the webview would and wait for the export to finish. */
async function send(message: any) {
  state.receiver!(copy(message));
  await settle();
}

/** Load the page in JSDOM and click a button; returns what the page posted. */
async function click(action: string): Promise<any> {
  const posted: any[] = [];
  const dom = new JSDOM(state.panel.webview.html, { runScripts: 'dangerously',
    beforeParse(window: any) { window.acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(copy(m)) }); } });
  dom.window.document.querySelector(`[data-action="${action}"]`).click();
  dom.window.close();
  assert.equal(posted.length, 1);
  return posted[0];
}

const csvRows = (file: string) => fs.readFileSync(file, 'utf-8').split('\n').length - 1;

for (const format of ['CSV', 'JSON'] as const) {
  test(`Export to ${format} from the page writes all 2,500 rows built on the host`, async () => {
    resultsView.show(result(2500), 'SELECT 1');
    const message = await click(`export${format}`);
    assert.deepEqual(message, { command: `export${format}`, generation: generation() });
    const file = tmpFile(`out.${format.toLowerCase()}`);
    state.save = fileUri(file);
    await send(message);
    const written = format === 'CSV' ? csvRows(file) : JSON.parse(fs.readFileSync(file, 'utf-8')).length;
    assert.equal(written, 2500);
    assert.deepEqual(state.info, [`Exported 2500 rows to ${file}`]);
    assert.equal(state.progress.length, 1, 'more than 1000 rows show progress');
    if (format === 'JSON') {
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8'))[2499], { time: 1_700_000_002_499, host: 'host-2499,"x"', value: 624.75 });
    }
  });
}

test('data posted with the click is ignored', async () => {
  resultsView.show(result(2500), 'SELECT 1');
  const file = tmpFile('out.csv');
  state.save = fileUri(file);
  await send({ command: 'exportCSV', generation: generation(), data: { columns: ['x'], rows: [[1]] } });
  assert.equal(csvRows(file), 2500);
  assert.equal(fs.readFileSync(file, 'utf-8').split('\n')[0], 'time,host,value');
});

test('the table, the warning and the chart/Markdown data still carry 1000 rows', async () => {
  resultsView.show(result(2500), 'SELECT 1');
  const html = state.panel.webview.html;
  assert.ok(html.includes('<p class="warning">Showing first 1000 rows of 2500 total rows</p>'));
  assert.equal((html.match(/<tr>/g) || []).length, 1001);
  const message = await click('copyMarkdown');
  assert.equal(message.data.rows.length, 1000);
  await send(message);
  assert.equal(state.clipboard!.split('\n').length, 1002);
  assert.deepEqual(state.info, ['Markdown table copied to clipboard!']);
});

test('small exports keep the old behaviour: no progress, legacy toast', async () => {
  resultsView.show(result(10), 'SELECT 1');
  const file = tmpFile('out.csv');
  state.save = fileUri(file);
  await send({ command: 'exportCSV', generation: generation() });
  assert.equal(state.progress.length, 0);
  assert.deepEqual(state.info, [`Exported 10 rows to ${file}`]);
});

test('arc.export.maxRows limits the export and the toast says written of total', async () => {
  resultsView.show(result(2500), 'SELECT 1');
  state.config['export.maxRows'] = 10;
  const file = tmpFile('out.json');
  state.save = fileUri(file);
  await send({ command: 'exportJSON', generation: generation() });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf-8')).length, 10);
  assert.deepEqual(state.info, [`Exported 10 of 2500 rows to ${file}`]);
});

for (const invalid of [-5, 'x', 2.5, null]) {
  test(`an invalid arc.export.maxRows (${JSON.stringify(invalid)}) exports every row`, async () => {
    resultsView.show(result(2500), 'SELECT 1');
    state.config['export.maxRows'] = invalid;
    const file = tmpFile('out.csv');
    state.save = fileUri(file);
    await send({ command: 'exportCSV', generation: generation() });
    assert.equal(csvRows(file), 2500);
    assert.deepEqual(state.info, [`Exported 2500 rows to ${file}`]);
  });
}

test('the prompt offers all, the setting and custom; Custom 7 writes 7 rows', async () => {
  resultsView.show(result(2500), 'SELECT 1');
  state.config['export.promptForRowCount'] = true;
  state.config['export.maxRows'] = 10;
  state.pick = (items: any[]) => items.find((item: any) => item.label === 'Custom…');
  let validation: any;
  state.input = (options: any) => { validation = options.validateInput; return '7'; };
  const file = tmpFile('out.csv');
  state.save = fileUri(file);
  await send({ command: 'exportCSV', generation: generation() });
  assert.deepEqual(state.quickPicks[0].map((item: any) => item.label), ['All 2500 rows', 'First 10 rows', 'Custom…']);
  assert.equal(csvRows(file), 7);
  assert.deepEqual(state.info, [`Exported 7 of 2500 rows to ${file}`]);
  assert.equal(validation('0'), 'Enter a whole number from 1 to 2500');
  assert.equal(validation('2501'), 'Enter a whole number from 1 to 2500');
  assert.equal(validation('1.5'), 'Enter a whole number from 1 to 2500');
  assert.equal(validation('2500'), undefined);
});

test('Custom equal to every row gives the legacy toast', async () => {
  resultsView.show(result(2500), 'SELECT 1');
  state.config['export.promptForRowCount'] = true;
  state.pick = (items: any[]) => items.at(-1);
  state.input = () => '2500';
  const file = tmpFile('out.csv');
  state.save = fileUri(file);
  await send({ command: 'exportCSV', generation: generation() });
  assert.deepEqual(state.info, [`Exported 2500 rows to ${file}`]);
});

test('escaping the prompt writes nothing and shows nothing', async () => {
  resultsView.show(result(2500), 'SELECT 1');
  state.config['export.promptForRowCount'] = true;
  state.pick = () => undefined;
  await send({ command: 'exportCSV', generation: generation() });
  assert.equal(state.saveDialogs, 0);
  assert.deepEqual([state.info, state.warnings, state.errors], [[], [], []]);
});

test('the prompt never appears when the setting is off', async () => {
  resultsView.show(result(2500), 'SELECT 1');
  state.save = undefined;
  await send({ command: 'exportCSV', generation: generation() });
  assert.equal(state.quickPicks.length, 0);
  assert.equal(state.saveDialogs, 1);
  assert.deepEqual([state.info, state.warnings, state.errors], [[], [], []]);
});

test('an Arrow result above the parser cap warns only when the cap cut the export', async () => {
  resultsView.show(result(2500, 250_000), 'SELECT 1');
  const file = tmpFile('out.csv');
  state.save = fileUri(file);
  await send({ command: 'exportCSV', generation: generation() });
  assert.deepEqual(state.warnings, [`Exported 2500 of 250000 rows to ${file}. Arrow results keep only the first 2500 rows; set arc.resultFormat to "json" to export them all.`]);
  state.warnings = [];
  // A user limit cut it, not the Arrow cap: information, against the server's total.
  state.config['export.maxRows'] = 10;
  await send({ command: 'exportCSV', generation: generation() });
  assert.deepEqual(state.warnings, []);
  assert.deepEqual(state.info, [`Exported 10 of 250000 rows to ${file}`]);
});

test('the prompt says when the Arrow format capped the rows held', async () => {
  resultsView.show(result(2500, 250_000), 'SELECT 1');
  state.config['export.promptForRowCount'] = true;
  state.pick = () => undefined;
  await send({ command: 'exportCSV', generation: generation() });
  assert.deepEqual(state.quickPicks[0][0], { label: 'All 2500 rows', count: 2500, description: 'Arrow keeps the first 2500 of 250000 rows' });
  resultsView.show(result(2500), 'SELECT 1');
  await send({ command: 'exportCSV', generation: generation() });
  assert.equal(state.quickPicks[1][0].description, undefined);
});

test('a click from an older page exports nothing', async () => {
  resultsView.show(result(5), 'SELECT 1');
  const old = generation();
  resultsView.show(result(6), 'SELECT 2');
  await send({ command: 'exportCSV', generation: old });
  assert.equal(state.saveDialogs, 0);
  assert.deepEqual(state.warnings, ['The results changed; export again.']);
});

const commandsWith = (client: any) => new arcCommands({ isConnected: () => true, getActiveClient: () => client }, {}, {});

for (const held of [5, 1000]) {
  test(`a ${held}-row table stays exportable after a failed query, as before`, async () => {
    resultsView.show(result(held), 'SELECT 1');
    let during: unknown;
    await commandsWith({ executeQuery: async () => { during = current().result; throw new Error('syntax error'); } }).executeQuery();
    assert.equal((during as any)?.rows.length, held, 'not released while the query runs');
    assert.deepEqual(state.errors, ['Query failed: syntax error']);
    const file = tmpFile('out.csv');
    state.save = fileUri(file);
    await send({ command: 'exportCSV', generation: generation() });
    assert.equal(csvRows(file), held);
  });
}

test('a table over 1000 rows is released when a query starts; a failed query asks to run it again', async () => {
  resultsView.show(result(1001), 'SELECT 1');
  const held: unknown[] = [];
  await commandsWith({ executeQuery: async () => { held.push(current().result); throw new Error('syntax error'); } }).executeQuery();
  assert.deepEqual(held, [undefined]);
  await send({ command: 'exportCSV', generation: generation() });
  assert.equal(state.saveDialogs, 0);
  assert.deepEqual(state.warnings, ['These results are no longer held; run the query again to export them.']);
});

test('a successful query over a large table holds only the new result', async () => {
  resultsView.show(result(2500), 'SELECT 1');
  const held: unknown[] = [];
  await commandsWith({ executeQuery: async () => { held.push(current().result); return result(3); } }).executeQuery();
  assert.deepEqual(held, [undefined]);
  assert.equal(current().result.rows.length, 3);
  assert.deepEqual(state.errors, []);
});

test('previewing a table releases a large held result before fetching', async () => {
  resultsView.show(result(2500), 'SELECT 1');
  const held: unknown[] = [];
  await commandsWith({ executeQuery: async () => { held.push(current().result); return result(10); } }).previewTableData({ label: 'cpu' });
  assert.deepEqual(held, [undefined]);
  assert.equal(current().result.rows.length, 10);
});

test('a page that fails to build after a query leaves a small previous table exportable', async () => {
  resultsView.show(result(5), 'SELECT 1');
  const before = generation(), html = state.panel.webview.html;
  // Nested BigInt cannot be embedded in the page; the view throws as on main.
  await commandsWith({ executeQuery: async () => ({ columns: ['v'], rows: [[{ x: 1n }]], rowCount: 1 }) }).executeQuery();
  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0], /^Query failed: .*BigInt/);
  assert.equal(state.panel.webview.html, html);
  const file = tmpFile('out.csv');
  state.save = fileUri(file);
  await send({ command: 'exportCSV', generation: before });
  assert.equal(csvRows(file), 5);
});

test('a click while an export is writing is refused', async () => {
  resultsView.show(result(5), 'SELECT 1');
  let release!: () => void;
  state.fsWriteGate = new Promise<void>(resolve => { release = resolve; });
  state.save = { scheme: 'vscode-remote', fsPath: '/remote/out.csv', path: '/remote/out.csv' };
  state.receiver!({ command: 'exportCSV', generation: generation() });
  while (!current().exporting) { await tick(); }
  state.receiver!({ command: 'exportJSON', generation: generation() });
  await tick();
  assert.deepEqual(state.info, ['An export is already running.']);
  assert.equal(state.saveDialogs, 1);
  release();
  await settle();
  assert.equal(state.fsWrites.length, 1);
  assert.deepEqual(state.info, ['An export is already running.', 'Exported 5 rows to /remote/out.csv']);
});

test('a click while the row-count prompt is open starts that export instead of being refused', async () => {
  resultsView.show(result(5), 'SELECT 1');
  state.config['export.promptForRowCount'] = true;
  let dismiss!: (value: any) => void;
  state.pick = () => new Promise(resolve => { dismiss = resolve; });
  state.receiver!({ command: 'exportCSV', generation: generation() });
  await tick();
  // The page click closes the first prompt (focus loss) and opens its own.
  const file = tmpFile('out.json');
  state.save = fileUri(file);
  state.pick = (items: any[]) => items[0];
  state.receiver!({ command: 'exportJSON', generation: generation() });
  dismiss(undefined);
  await settle();
  assert.equal(state.quickPicks.length, 2);
  assert.deepEqual(state.info, [`Exported 5 rows to ${file}`]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf-8')).length, 5);
});

test('cancelling the progress removes the partial file and shows nothing', async () => {
  resultsView.show(result(50_000), 'SELECT 1');
  state.cancelAfterReports = 2;
  const file = tmpFile('out.csv');
  state.save = fileUri(file);
  await send({ command: 'exportCSV', generation: generation() });
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual([state.info, state.warnings, state.errors], [[], [], []]);
});

test('a non-file destination receives the whole export in one write', async () => {
  resultsView.show(result(2500), 'SELECT 1');
  state.save = { scheme: 'vscode-remote', fsPath: '/remote/out.json', path: '/remote/out.json' };
  await send({ command: 'exportJSON', generation: generation() });
  assert.equal(state.fsWrites.length, 1);
  assert.equal(JSON.parse(state.fsWrites[0].contents.toString('utf-8')).length, 2500);
  assert.deepEqual(state.info, ['Exported 2500 rows to /remote/out.json']);
});

test('a write error is reported with the existing message', async () => {
  resultsView.show(result(5), 'SELECT 1');
  state.save = fileUri(path.join(os.tmpdir(), 'arc-missing-dir-' + process.pid, 'out.csv'));
  await send({ command: 'exportCSV', generation: generation() });
  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0], /^Export failed: ENOENT/);
});
