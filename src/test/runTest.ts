import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ArcNotebook } from '../types/notebook';
import { mergeSyncedNotebook } from '../views/notebookSync';

const base: ArcNotebook = {
  version: '1',
  cells: [{ type: 'sql', content: 'SELECT 1' }],
  globalVariables: { account: 'local' }
};

const local = JSON.parse(JSON.stringify(base)) as ArcNotebook;
local.cells[0].content = 'SELECT 2 -- unsaved in this panel';
local.globalVariables!.account = 'pending value';

const incoming = JSON.parse(JSON.stringify(base)) as ArcNotebook;
incoming.cells[0].output = { columns: ['value'], rows: [[1]], rowCount: 1 };
incoming.globalVariables!.region = 'eu';

const merged = mergeSyncedNotebook(base, local, incoming);
assert.equal(merged.cells[0].content, 'SELECT 2 -- unsaved in this panel');
assert.deepEqual(merged.cells[0].output, incoming.cells[0].output);
assert.deepEqual(merged.globalVariables, { account: 'pending value', region: 'eu' });

const cleanLocal = JSON.parse(JSON.stringify(base)) as ArcNotebook;
const remoteContent = JSON.parse(JSON.stringify(base)) as ArcNotebook;
remoteContent.cells[0].content = 'SELECT 3';
assert.equal(mergeSyncedNotebook(base, cleanLocal, remoteContent).cells[0].content, 'SELECT 3');

const sameFieldConflict = JSON.parse(JSON.stringify(base)) as ArcNotebook;
sameFieldConflict.cells[0].content = 'SELECT 4 -- sibling edit';
assert.equal(
  mergeSyncedNotebook(base, local, sameFieldConflict).cells[0].content,
  'SELECT 2 -- unsaved in this panel'
);

const prototypeKeyBase: ArcNotebook = {
  version: '1',
  cells: [],
  globalVariables: JSON.parse('{"__proto__":"old"}') as Record<string, string>
};
const prototypeKeyIncoming: ArcNotebook = {
  ...prototypeKeyBase,
  globalVariables: JSON.parse('{"__proto__":"new"}') as Record<string, string>
};
const prototypeKeyResult = mergeSyncedNotebook(prototypeKeyBase, prototypeKeyBase, prototypeKeyIncoming);
assert.equal(Object.prototype.hasOwnProperty.call(prototypeKeyResult.globalVariables, '__proto__'), true);
assert.equal(prototypeKeyResult.globalVariables?.['__proto__'], 'new');

const editorSource = readFileSync(`${__dirname}/../../src/views/notebookEditor.ts`, 'utf8');
const syncStart = editorSource.indexOf('        function syncNotebook(nextNotebook) {');
const syncEnd = editorSource.indexOf('\n\n        // Listen for messages from extension', syncStart);
assert.notEqual(syncStart, -1, 'webview sync function should exist');
assert.notEqual(syncEnd, -1, 'webview sync function should have a stable boundary');
const syncFunction = editorSource.slice(syncStart, syncEnd)
  .replaceAll('\\`', '`')
  .replaceAll('\\${', '${');
const browserMerge = runInNewContext(`(${mergeSyncedNotebook.toString()})`) as typeof mergeSyncedNotebook;
const textarea = {
  value: local.cells[0].content,
  selectionStart: 10,
  selectionEnd: 10,
  selectionDirection: 'none',
  scrollTop: 0,
  scrollLeft: 0,
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
};
const webviewContext = {
  notebook: local,
  lastSavedJson: JSON.stringify(base),
  nextNotebook: incoming,
  mergeSyncedNotebook: browserMerge,
  document: { querySelector: () => textarea },
  renderCellOutput: () => undefined,
  renderVariablesPreservingState: () => undefined
};
runInNewContext(`${syncFunction}; syncNotebook(nextNotebook);`, webviewContext);
assert.equal(textarea.value, 'SELECT 2 -- unsaved in this panel');
assert.equal(webviewContext.notebook.cells[0].content, 'SELECT 2 -- unsaved in this panel');
assert.deepEqual(JSON.parse(webviewContext.lastSavedJson), incoming);

console.log('notebook sync: regression assertions passed');
