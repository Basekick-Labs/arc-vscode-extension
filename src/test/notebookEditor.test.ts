import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module from 'node:module';
import { runInNewContext } from 'node:vm';
import { createNotebookRecovery } from '../views/notebookRecovery';
const { JSDOM } = require('jsdom');
import { ArcNotebook } from '../types/notebook';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fixture = (): ArcNotebook => ({ version: '1', cells: [
  { type: 'sql', content: 'SELECT 0' }, { type: 'sql', content: 'SELECT 1' }
] });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

async function harness(initial = fixture(), connectionManager: any = { isConnected: () => false }) {
  let text = JSON.stringify(initial);
  const changes = new Set<(event: any) => void>();
  const errors: string[] = [];
  const writes: string[] = [];
  const fileWrites: Array<{ uri: string; contents: string }> = [];
  let saveDestination: string | undefined;
  const uri = (path: string): any => ({ path, fsPath: path, toString: () => 'file://' + path, with: (change: any) => uri(change.path) });
  const document = { uri: uri('/test.arcnb'), version: 1,
    lineCount: 10, getText: () => text };
  let apply: (edit: any) => Promise<boolean> = async edit => {
    text = edit.text;
    document.version++;
    changes.forEach(listener => listener({ document }));
    return true;
  };
  const vscode = {
    // VS Code API names are intentionally preserved in this test double.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    WorkspaceEdit: class { text = ''; replace(_uri: any, _range: any, value: string) { this.text = value; } },
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Range: class {},
    workspace: {
      fs: { writeFile: async (target: any, contents: Buffer) => { fileWrites.push({ uri: target.toString(), contents: contents.toString() }); } },
      getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback }),
      onDidChangeTextDocument(listener: (event: any) => void) {
        changes.add(listener); return { dispose: () => changes.delete(listener) };
      },
      applyEdit: async (edit: any) => { writes.push(edit.text); return apply(edit); }
    },
    window: { showErrorMessage: (message: string) => errors.push(message),
      showInformationMessage: () => undefined,
      showSaveDialog: async () => saveDestination === undefined ? undefined : uri(saveDestination) }
  };
  const loader = Module as unknown as { _load: (...args: any[]) => any };
  const original = loader._load;
  let providerClass: any;
  try {
    loader._load = function (name: string, ...args: any[]) {
      return name === 'vscode' ? vscode : original.call(this, name, ...args);
    };
    delete require.cache[require.resolve('../views/notebookEditor')];
    providerClass = require('../views/notebookEditor').ArcNotebookEditorProvider;
  } finally { loader._load = original; }
  const provider = new providerClass({ extensionUri: {} }, connectionManager);
  async function panel() {
    const messages: any[] = [];
    let receiver: (message: any) => Promise<void> = async () => {};
    let reloadHandler: ((message: any) => void) | undefined;
    let readyHandler: ((message: any) => void) | undefined;
    const pendingReloads: Promise<void>[] = [];
    let viewStateListener: ((event: any) => void) | undefined;
    const panel = { webview: { options: {}, html: '',
      onDidReceiveMessage: (fn: typeof receiver) => { receiver = fn; return { dispose() {} }; },
      postMessage: (message: any) => {
        messages.push(copy(message));
        if (message.command === 'notebookReady') { readyHandler?.(copy(message)); }
        if (message.command === 'prepareReload') {
          if (reloadHandler) { reloadHandler(copy(message)); }
          else { pendingReloads.push(receiver({ command: 'reloadReady', reloadId: message.reloadId,
            sessionId: message.sessionId, state: { recoveries: [] } })); }
        }
        return Promise.resolve(true);
      }
    }, visible: true,
      onDidChangeViewState: (listener: (event: any) => void) => { viewStateListener = listener; return { dispose() {} }; },
      onDidDispose: () => ({ dispose() {} }) };
    await provider.resolveCustomTextEditor(document, panel, {});
    const sessionId = /const sessionId = '([^']+)'/.exec(panel.webview.html)![1];
    return { panel, messages, sessionId,
      reveal: () => { panel.visible = true; viewStateListener?.({ webviewPanel: panel }); },
      setReadyHandler: (handler: (message: any) => void) => { readyHandler = handler; },
      setReloadHandler: (handler: (message: any) => void) => { reloadHandler = handler; },
      flushReloads: async () => { await Promise.all(pendingReloads.splice(0)); }, send: (message: any) => receiver({ sessionId, ...message }),
      save: (notebook: ArcNotebook, base = initial, saveId = 1) => receiver({
        command: 'save', notebook: copy(notebook), base: copy(base), saveId, sessionId
      }) };
  }
  return { panel, document, writes, errors, fileWrites,
    setSaveDestination: (value: string | undefined) => { saveDestination = value; }, read: () => JSON.parse(text) as ArcNotebook,
    setText: (value: string) => { text = value; },
    setApply: (fn: typeof apply) => { apply = fn; },
    commit: (edit: any) => { text = edit.text; document.version++; changes.forEach(fn => fn({ document })); }
  };
}

async function browser(initial = fixture()) {
  const host = await harness(initial), panel = await host.panel();
  const sent: any[] = [];
  let dom: any;
  const readiness: Promise<void>[] = [];
  panel.setReadyHandler(message => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: message })));
  dom = new JSDOM(panel.panel.webview.html, { runScripts: 'dangerously',
    beforeParse(window: any) { window.acquireVsCodeApi = () => ({
      postMessage: (m: any) => { if (m.command === 'webviewReady') { readiness.push(panel.send(m)); } else { sent.push(copy(m)); } },
      getState: () => undefined, setState: () => undefined }); }
  });
  await new Promise<void>(resolve => dom.window.addEventListener('load', () => resolve(), { once: true }));
  await Promise.all(readiness);
  const window = dom.window;
  return { host, panel, dom, window, sent,
    cell: (index: number) => window.document.querySelector(`#cell-${index} textarea`) as any,
    input: (element: any, value: string) => {
      element.value = value; element.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    flush: () => window.dispatchEvent(new window.Event('blur')),
    receive: (message: any) => window.dispatchEvent(new window.MessageEvent('message', { data: copy({ sessionId: panel.sessionId, ...message }) }))
  };
}

test('host serializes sibling saves and reads after previous write, acknowledging actual merged snapshot', async () => {
  const h = await harness(), a = await h.panel(), b = await h.panel();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  h.setApply(async edit => { if (++calls === 1) { await gate; } h.commit(edit); return true; });
  const typing = fixture(), output = fixture();
  typing.cells[0].content = 'typing'; output.cells[1].output = { rows: [[42]], rowCount: 1 };
  const first = a.save(typing), second = b.save(output);
  await tick(); assert.equal(h.writes.length, 1);
  release(); await Promise.all([first, second]);
  assert.equal(h.read().cells[0].content, 'typing');
  assert.deepEqual(h.read().cells[1].output, output.cells[1].output);
  assert.deepEqual(a.messages.at(-1).notebook, h.read());
  assert.deepEqual(b.messages.at(-1).notebook, h.read());
  assert.equal(b.messages.at(-1).saveId, 1);
  assert.equal(a.messages.at(-1).saveId, undefined);
});

test('host acknowledges no-op without edit or adding undefined variables', async () => {
  const h = await harness(), a = await h.panel();
  await a.save(fixture());
  assert.equal(h.writes.length, 0);
  assert.equal(a.messages[0].saveId, 1);
  assert.deepEqual(a.messages[0].notebook, fixture());
});

for (const failure of ['false', 'throw', 'unreadable', 'structure'] as const) {
  test(`host rejects ${failure} save and does not report success`, async () => {
    const h = await harness(), a = await h.panel();
    const changed = fixture(); changed.cells[0].content = 'edit';
    if (failure === 'false') { h.setApply(async () => false); }
    if (failure === 'throw') { h.setApply(async () => { throw new Error('denied'); }); }
    if (failure === 'unreadable') { h.setText('{broken'); }
    if (failure === 'structure') { h.setText(JSON.stringify({ ...fixture(), cells: [] })); }
    await a.save(changed);
    assert.deepEqual(a.messages, [{ command: 'saveFailed', saveId: 1, sessionId: a.sessionId }]);
    assert.equal(h.errors.length, 1);
    assert.equal(h.writes.length, failure === 'false' || failure === 'throw' ? 1 : 0);
    if (failure === 'false' || failure === 'throw') {
      h.setApply(async edit => { h.commit(edit); return true; });
      await a.save(changed, fixture(), 2);
      assert.equal(a.messages.at(-1)!.saveId, 2);
    }
  });
}

test('webview retains edits after send and allows only one unacknowledged save', async t => {
  const b = await browser(); t.after(() => b.dom.window.close());
  b.input(b.cell(0), 'first'); b.flush();
  b.input(b.cell(0), 'second'); b.flush();
  assert.equal(b.sent.length, 1);
  const written = copy(b.sent[0].notebook); written.cells[1].output = { rows: [[42]] };
  b.receive({ command: 'syncNotebook', notebook: written, version: 2, saveId: b.sent[0].saveId });
  assert.equal(b.cell(0).value, 'second');
  b.flush();
  assert.equal(b.sent.length, 2);
  assert.equal(b.sent[1].notebook.cells[0].content, 'second');
  assert.deepEqual(b.sent[1].base, written);
  assert.deepEqual(b.sent[1].notebook.cells[1].output, written.cells[1].output);
});

test('slow cell1 result and sibling sync retain cell0 typing through host saves', async t => {
  const b = await browser(); t.after(() => b.dom.window.close());
  const sibling = await b.host.panel();
  b.input(b.cell(0), 'unsaved typing');
  b.receive({ command: 'cellResult', index: 1, output: { rows: [[99]], rowCount: 1 } });
  b.flush();
  assert.equal(b.sent.length, 1);
  await b.panel.send(b.sent[0]);
  b.receive(b.panel.messages.at(-1));
  const other = fixture(); other.cells[1].content = 'sibling query';
  await sibling.save(other);
  b.receive(b.panel.messages.at(-1));
  assert.equal(b.cell(0).value, 'unsaved typing');
  assert.equal(b.host.read().cells[0].content, 'unsaved typing');
  assert.deepEqual(b.host.read().cells[1].output, { rows: [[99]], rowCount: 1 });
});

test('sync skips focused text, preserves caret, grows remote rows and does not save clean snapshots', async t => {
  const b = await browser(); t.after(() => b.dom.window.close());
  const focused = b.cell(0); focused.focus(); focused.setSelectionRange(2, 4);
  const remote = fixture(); remote.cells[0].content = 'remote'; remote.cells[1].content = '1\n2\n3\n4\n5';
  b.receive({ command: 'syncNotebook', notebook: remote, version: 2 });
  assert.equal(focused.value, 'SELECT 0'); assert.equal(focused.selectionStart, 2); assert.equal(focused.selectionEnd, 4);
  assert.equal(b.cell(1).rows, 5); assert.equal(b.cell(1).value, remote.cells[1].content);
  const clean = await browser(); t.after(() => clean.dom.window.close());
  clean.receive({ command: 'syncNotebook', notebook: fixture(), version: 2 }); clean.flush();
  assert.equal(clean.sent.length, 0);
});

test('variable sync preserves active node, selection, trailing spaces and blank draft rows', async t => {
  const initial = { ...fixture(), globalVariables: { account: 'old' } };
  const b = await browser(initial); t.after(() => b.dom.window.close());
  const doc = b.window.document;
  const key = doc.querySelector('input[name="key"]') as any;
  key.focus(); b.input(key, 'account '); key.setSelectionRange(8, 8);
  (doc.querySelector('[data-action="addVariable"]') as any).click();
  const remote = copy(initial); remote.globalVariables.account = 'remote';
  b.receive({ command: 'syncNotebook', notebook: remote, version: 2 });
  assert.equal(doc.activeElement, key); assert.equal(key.value, 'account '); assert.equal(key.selectionStart, 8);
  assert.equal(doc.querySelectorAll('.variable-row').length, 2);
  key.blur(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(key.value, 'account ');
  assert.equal(doc.querySelectorAll('.variable-row').length, 2);
});

test('save failure leaves local edits available and later user edit can retry', async t => {
  const b = await browser(); t.after(() => b.dom.window.close());
  b.input(b.cell(0), 'retained'); b.flush();
  b.receive({ command: 'saveFailed', saveId: b.sent[0].saveId });
  assert.equal(b.cell(0).value, 'retained');
  b.input(b.cell(0), 'retry'); b.flush();
  assert.equal(b.sent.length, 2); assert.equal(b.sent[1].notebook.cells[0].content, 'retry');
});

test('focused variable delta does not overwrite remote changes hidden during focus', async t => {
  const initial = { ...fixture(), globalVariables: { first: 'old', second: 'old' } };
  const b = await browser(initial); t.after(() => b.dom.window.close());
  const inputs = b.window.document.querySelectorAll('input[name="value"]');
  inputs[0].focus();
  const remote = copy(initial); remote.globalVariables.second = 'remote';
  b.receive({ command: 'syncNotebook', notebook: remote, version: 2 });
  assert.equal(inputs[1].value, 'old');
  b.input(inputs[0], 'local'); b.flush();
  assert.deepEqual(b.sent[0].notebook.globalVariables, { first: 'local', second: 'remote' });
});

test('stale-session messages cannot acknowledge an in-flight webview save', async t => {
  const b = await browser(); t.after(() => b.dom.window.close());
  b.input(b.cell(0), 'first'); b.flush();
  b.receive({ command: 'syncNotebook', sessionId: 'obsolete-session', notebook: b.sent[0].notebook,
    version: 99, saveId: b.sent[0].saveId });
  b.input(b.cell(0), 'second'); b.flush();
  assert.equal(b.sent.length, 1);
  b.receive({ command: 'syncNotebook', notebook: b.sent[0].notebook, version: 2, saveId: b.sent[0].saveId });
  b.flush(); assert.equal(b.sent.length, 2);
});

test('pristine focused text in both panels does not manufacture echo saves', async t => {
  for (const index of [0, 1]) {
    const b = await browser(); t.after(() => b.dom.window.close());
    b.cell(index).focus();
    const remote = fixture(); remote.cells[index].content = 'remote update';
    b.receive({ command: 'syncNotebook', notebook: remote, version: 2 });
    b.flush(); assert.equal(b.sent.length, 0);
    b.cell(index).blur(); await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(b.cell(index).value, 'remote update');
    b.flush(); assert.equal(b.sent.length, 0);
  }
});

test('pending structural followup cannot overwrite sibling changes in its acknowledgment', async t => {
  const b = await browser(); t.after(() => b.dom.window.close());
  b.input(b.cell(0), 'first'); b.flush();
  (b.window.document.querySelector('[data-action="addCell"][data-type="sql"]') as any).click();
  assert.equal(b.sent.length, 1);
  const written = copy(b.sent[0].notebook); written.cells[1].content = 'sibling changed';
  b.receive({ command: 'syncNotebook', notebook: written, version: 2, saveId: b.sent[0].saveId });
  assert.equal(b.sent.length, 2);
  assert.equal(b.sent[1].structural, true);
  assert.deepEqual(b.sent[1].base, b.sent[0].notebook);
  b.host.setText(JSON.stringify(written));
  await b.panel.send(b.sent[1]);
  assert.equal(b.panel.messages.at(-1).command, 'saveFailed');
  assert.deepEqual(b.host.read(), written);
});

test('no-op structural save receives a source acknowledgment', async () => {
  const h = await harness(), a = await h.panel();
  await a.send({ command: 'save', notebook: fixture(), base: fixture(), structural: true, saveId: 7 });
  assert.equal(h.writes.length, 0);
  assert.equal(a.messages.at(-1)?.command, 'syncNotebook');
  assert.equal(a.messages.at(-1)?.saveId, 7);
});

for (const action of ['addCell', 'executeCell'] as const) {
  test(`blur then synchronous ${action} uses canonical model rather than deferred stale textarea`, async t => {
    const b = await browser(); t.after(() => b.dom.window.close());
    const textarea = b.cell(0); textarea.focus();
    const remote = fixture(); remote.cells[0].content = 'SELECT canonical_remote';
    b.receive({ command: 'syncNotebook', notebook: remote, version: 2 });
    assert.equal(textarea.value, 'SELECT 0');
    textarea.blur();
    // Deliberately stay in this task: the deferred blur refresh has not run.
    const selector = action === 'addCell' ? '[data-action="addCell"][data-type="sql"]' :
      '[data-action="executeCell"][data-index="0"]';
    b.window.document.querySelector(selector).click();
    assert.equal(b.sent.length, 1);
    if (action === 'addCell') {
      assert.equal(b.sent[0].structural, true);
      assert.equal(b.sent[0].notebook.cells[0].content, 'SELECT canonical_remote');
      assert.equal(b.sent[0].notebook.cells.length, 3);
    } else {
      assert.equal(b.sent[0].command, 'executeCell');
      assert.equal(b.sent[0].content, 'SELECT canonical_remote');
      assert.equal(b.sent[0].sessionId, b.panel.sessionId);
    }
  });
}

test('host rejects old-session execution and tags not-connected errors with current session', async () => {
  const h = await harness(), p = await h.panel();
  await p.send({ command: 'executeCell', sessionId: 'old-session', index: 0, content: 'SELECT 0' });
  assert.equal(p.messages.length, 0);
  await p.send({ command: 'executeCell', index: 0, content: 'SELECT 0' });
  assert.deepEqual(p.messages, [{ command: 'cellResult', sessionId: p.sessionId, index: 0,
    error: 'Not connected to Arc server' }]);
});

for (const outcome of ['success', 'error'] as const) {
  test(`late query ${outcome} retains original session and cannot target a rebuilt cell index`, async t => {
    let finish!: (value: any) => void, reject!: (reason: Error) => void;
    const result = new Promise((resolve, rejectPromise) => { finish = resolve; reject = rejectPromise; });
    const h = await harness(fixture(), { isConnected: () => true,
      getActiveClient: () => ({ executeQuery: () => result }) });
    const p = await h.panel();
    const pending = p.send({ command: 'executeCell', index: 0, content: 'SELECT 0' });
    // External structure change rebuilds this panel and changes the session.
    const replacement = fixture(); replacement.cells.shift();
    h.commit({ text: JSON.stringify(replacement) });
    await p.flushReloads();
    const newSession = /const sessionId = '([^']+)'/.exec(p.panel.webview.html)![1];
    assert.notEqual(newSession, p.sessionId);
    const sent: any[] = [];
    const dom = new JSDOM(p.panel.webview.html, { runScripts: 'dangerously',
      beforeParse(window: any) { window.acquireVsCodeApi = () => ({ postMessage: (m: any) => { if (m.command !== 'webviewReady') { sent.push(copy(m)); } }, getState: () => undefined, setState: () => undefined }); }
    });
    t.after(() => dom.window.close());
    await new Promise<void>(resolve => dom.window.addEventListener('load', resolve, { once: true }));
    if (outcome === 'success') { finish({ columns: ['old'], rows: [[123]], rowCount: 1 }); }
    else { reject(new Error('old query failure')); }
    await pending;
    const reply = p.messages.at(-1);
    assert.equal(reply.command, 'cellResult');
    assert.equal(reply.sessionId, p.sessionId);
    assert.equal(reply.index, 0);
    if (outcome === 'success') { assert.deepEqual(reply.output.rows, [[123]]); }
    else { assert.equal(reply.error, 'old query failure'); }
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: reply }));
    dom.window.dispatchEvent(new dom.window.Event('blur'));
    assert.equal(sent.length, 0);
    assert.equal(dom.window.document.querySelector('#cell-0 textarea').value, 'SELECT 1');
    assert.equal(dom.window.document.body.textContent.includes('old query failure'), false);
    assert.equal(dom.window.document.body.textContent.includes('123'), false);
  });
}

test('existing webview ignores an old-session cell result without saving its output', async t => {
  const b = await browser(); t.after(() => b.dom.window.close());
  b.receive({ command: 'cellResult', sessionId: 'obsolete-session', index: 0,
    output: { columns: ['stale'], rows: [[987]], rowCount: 1 } });
  b.flush(); assert.equal(b.sent.length, 0);
  b.input(b.cell(1), 'real edit'); b.flush();
  assert.equal(b.sent[0].notebook.cells[0].output, undefined);
});

/** Real VS Code getState/setState survives webview.html replacing the entire DOM. */
async function recoveryBrowser(initial = fixture(), lagPersistedState = false) {
  const host = await harness(initial), panel = await host.panel();
  let state: any;
  let dom: any;
  let confirmResult = false;
  const sent: any[] = [];
  const confirmations: string[] = [];
  const pendingReloads: Promise<void>[] = [];
  let dropReloadRequests = false;
  let holdReadiness = false;
  const heldReadiness: any[] = [];
  const reloadRequests: any[] = [];
  panel.setReadyHandler(message => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: message })));
  panel.setReloadHandler(message => {
    reloadRequests.push(copy(message));
    if (dropReloadRequests) { return; }
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: message }));
  });
  async function mount() {
    await Promise.all(pendingReloads.splice(0));
    await panel.flushReloads();
    dom?.window.close();
    const mountedHtml = panel.panel.webview.html;
    dom = new JSDOM(mountedHtml, { runScripts: 'dangerously',
      beforeParse(window: any) {
        window.confirm = (message: string) => { confirmations.push(message); return confirmResult; };
        window.acquireVsCodeApi = () => ({
          postMessage: (message: any) => {
            if (message.command !== 'webviewReady') { sent.push(copy(message)); }
            if (message.command === 'webviewReady' && holdReadiness) { heldReadiness.push(copy(message)); }
            else if (message.command === 'reloadReady' || message.command === 'webviewReady') { pendingReloads.push(panel.send(message)); }
          },
          getState: () => lagPersistedState || state === undefined ? undefined : copy(state),
          setState: (value: any) => { state = copy(value); return value; }
        });
      }
    });
    await new Promise<void>(resolve => dom.window.addEventListener('load', resolve, { once: true }));
    await Promise.all(pendingReloads.splice(0));
    if (panel.panel.webview.html !== mountedHtml) { await mount(); }
  }
  await mount();
  return {
    host, panel, sent, confirmations, mount, reloadRequests,
    holdReadiness: () => { holdReadiness = true; },
    releaseReadiness: async () => {
      holdReadiness = false;
      await Promise.all(heldReadiness.splice(0).map(message => panel.send(message)));
    },
    setDropReloadRequests: (value: boolean) => { dropReloadRequests = value; },
    get window() { return dom.window; },
    get state() { return state === undefined ? undefined : copy(state); },
    get recoveryText() { return [...dom.window.document.querySelectorAll('.recovered-draft-json')].map((el: any) => el.value).join('\n'); },
    receive: (message: any) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: copy(message) })),
    setConfirmation: (value: boolean) => { confirmResult = value; },
    close: () => dom.window.close(),
    input: (selector: string, value: string) => {
      const element = dom.window.document.querySelector(selector);
      element.value = value;
      element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    },
    external: async (text: string) => { host.commit({ text }); await mount(); }
  };
}

for (const operation of ['add', 'delete'] as const) {
  test(`sibling ${operation} cell rebuild keeps unsent edits recoverable without applying them to new indices`, async t => {
    const b = await recoveryBrowser(); t.after(b.close);
    const sibling = await b.host.panel();
    b.input('#cell-1 textarea', 'unique unsent sibling draft');
    const changed = fixture();
    if (operation === 'add') { changed.cells.unshift({ type: 'sql', content: 'inserted' }); }
    else { changed.cells.shift(); }
    await sibling.send({ command: 'save', notebook: changed, base: fixture(), structural: true, saveId: 1 });
    await b.mount();
    assert.deepEqual(b.host.read(), changed);
    const canonical = [...b.window.document.querySelectorAll('textarea[data-cell-index]')].map((el: any) => el.value);
    assert.deepEqual(canonical, changed.cells.map(cell => cell.content));
    assert.ok((JSON.stringify(b.state) ?? '').includes('unique unsent sibling draft'));
    assert.ok(b.recoveryText.includes('unique unsent sibling draft'));
    b.window.dispatchEvent(new b.window.Event('blur'));
    assert.equal(b.sent.filter(message => message.command === 'save').length, 0);
  });
}

for (const valid of [true, false]) {
  test(`external ${valid ? 'valid' : 'unreadable'} edit preserves unsent draft through rebuild`, async t => {
    const b = await recoveryBrowser(); t.after(b.close);
    b.input('#cell-0 textarea', 'recover after external edit');
    const changed = fixture(); changed.cells.reverse();
    await b.external(valid ? JSON.stringify(changed) : '{unreadable');
    assert.ok((JSON.stringify(b.state) ?? '').includes('recover after external edit'));
    assert.ok(b.recoveryText.includes('recover after external edit'));
    assert.equal(b.host.writes.length, 0);
    if (!valid) { assert.equal(b.window.document.querySelector('textarea[data-cell-index]'), null); }
  });
}

test('multiple rebuilds retain every unsent snapshot and raw blank variable draft', async t => {
  const b = await recoveryBrowser(); t.after(b.close);
  b.input('#cell-0 textarea', 'first pending snapshot');
  b.window.document.querySelector('[data-action="addVariable"]').click();
  b.input('.variable-row input[name="key"]', '  ');
  b.input('.variable-row input[name="value"]', 'blank key value with trailing space ');
  const remote = fixture(); remote.cells[0].content = 'first canonical change';
  await b.external(JSON.stringify(remote));
  b.input('#cell-1 textarea', 'second pending snapshot');
  remote.cells[1].content = 'second canonical change';
  await b.external(JSON.stringify(remote));
  const stored = JSON.stringify(b.state) ?? '';
  assert.ok(stored.includes('first pending snapshot'));
  assert.ok(stored.includes('second pending snapshot'));
  assert.ok(stored.includes('blank key value with trailing space '));
  assert.ok(b.recoveryText.includes('first pending snapshot'));
  assert.ok(b.recoveryText.includes('second pending snapshot'));
  assert.equal(b.sent.filter(message => message.command === 'save').length, 0);
});

test('recovery renders malicious draft content as inert text', async t => {
  const b = await recoveryBrowser(); t.after(b.close);
  const malicious = '</script><img src="x" onerror="window.recoveryExecuted=true"><script>window.recoveryExecuted=true</script>';
  b.input('#cell-0 textarea', malicious);
  const remote = fixture(); remote.cells.reverse();
  await b.external(JSON.stringify(remote));
  assert.ok((JSON.stringify(b.state) ?? '').includes('recoveryExecuted'));
  assert.equal(b.window.recoveryExecuted, undefined);
  assert.equal(b.window.document.querySelector('img[onerror]'), null);
  assert.ok(b.recoveryText.includes(JSON.stringify(malicious).slice(1, -1)));
});

test('canonical snapshot equal to submitted structural save does not create a false recovery', async t => {
  const b = await recoveryBrowser(); t.after(b.close);
  b.input('#cell-0 textarea', 'submitted content');
  b.window.document.querySelector('[data-action="addCell"][data-type="sql"]').click();
  const save = b.sent.find(message => message.command === 'save');
  assert.equal(save.structural, true);
  await b.panel.send(save);
  await b.mount();
  assert.deepEqual(b.host.read(), save.notebook);
  assert.equal(b.state.recoveries.length, 0);
  assert.equal(b.window.document.querySelector('#recovered-drafts').hidden, true);
});

test('acknowledged nonstructural draft does not reappear as recovery after external rebuild', async t => {
  const b = await recoveryBrowser(); t.after(b.close);
  b.input('#cell-0 textarea', 'saved content');
  b.window.dispatchEvent(new b.window.Event('blur'));
  await b.panel.send(b.sent.find(message => message.command === 'save'));
  b.receive(b.panel.messages.at(-1));
  const changed = b.host.read(); changed.cells[1].content = 'later external change';
  await b.external(JSON.stringify(changed));
  assert.equal(b.state.recoveries.length, 0);
  assert.equal(b.window.document.querySelector('#recovered-drafts').hidden, true);
});

test('exact canonical model still recovers unfinished variable rows', async t => {
  const b = await recoveryBrowser(); t.after(b.close);
  b.window.document.querySelector('[data-action="addVariable"]').click();
  b.input('.variable-row input[name="value"]', 'unsubmitted blank-key value');
  // The notebook model is canonical, but the unfinished row is not in it.
  await b.external(JSON.stringify(fixture()));
  assert.equal(b.state.recoveries.length, 1);
  assert.deepEqual(b.state.recoveries[0].draft.variableRows, [{ key: '', value: 'unsubmitted blank-key value' }]);
});

test('recovery save cancellation and separate-file export retain snapshot; live notebook overwrite is rejected', async t => {
  const b = await recoveryBrowser(); t.after(b.close);
  b.input('#cell-0 textarea', 'recoverable export');
  const current = fixture(); current.cells.reverse();
  await b.external(JSON.stringify(current));
  const draft = copy(b.state.recoveries[0].draft);
  const save = () => b.window.document.querySelector('[data-recovery-action="save"]').click();
  save();
  assert.deepEqual(b.sent.at(-1), { command: 'saveRecovery', recovery: draft });
  // Canceling the dialog writes nothing and keeps recovery available.
  await b.panel.send(b.sent.at(-1));
  assert.equal(b.host.fileWrites.length, 0);
  assert.equal(b.state.recoveries.length, 1);
  b.host.setSaveDestination('/test.arcnb');
  save(); await b.panel.send(b.sent.at(-1));
  assert.equal(b.host.fileWrites.length, 0);
  assert.match(b.host.errors.at(-1)!, /separate recovery file/);
  b.host.setSaveDestination('/recovered.json');
  save(); await b.panel.send(b.sent.at(-1));
  assert.deepEqual(b.host.fileWrites, [{ uri: 'file:///recovered.json', contents: JSON.stringify(draft, null, 2) }]);
  assert.deepEqual(b.host.read(), current);
  assert.equal(b.state.recoveries.length, 1);
  await b.mount();
  assert.equal(b.state.recoveries.length, 1);
  assert.equal(b.window.document.querySelector('#recovered-drafts').hidden, false);
});

test('discard requires confirmation, removes only selected recovery and persists across rebuilds', async t => {
  const b = await recoveryBrowser(); t.after(b.close);
  b.input('#cell-0 textarea', 'first recovery');
  const current = fixture(); current.cells[0].content = 'canonical first';
  await b.external(JSON.stringify(current));
  b.input('#cell-1 textarea', 'second recovery');
  current.cells[1].content = 'canonical second';
  await b.external(JSON.stringify(current));
  const discard = () => b.window.document.querySelector('[data-recovery-action="discard"]').click();
  discard();
  assert.equal(b.confirmations.length, 1);
  assert.equal(b.state.recoveries.length, 2);
  b.setConfirmation(true); discard();
  assert.equal(b.state.recoveries.length, 1);
  assert.ok(b.recoveryText.includes('second recovery'));
  assert.equal(b.recoveryText.includes('first recovery'), false);
  await b.mount();
  assert.equal(b.state.recoveries.length, 1);
  discard();
  assert.equal(b.state.recoveries.length, 0);
  assert.equal(b.window.document.querySelector('#recovered-drafts').hidden, true);
  await b.mount(); assert.equal(b.state.recoveries.length, 0);
});

test('rejected structural save locks stale indices then rebuilds canonical view with full local recovery', async t => {
  const b = await recoveryBrowser(); t.after(b.close);
  b.input('#cell-0 textarea', 'pending before rejected add');
  b.host.setApply(async () => false);
  b.window.document.querySelector('[data-action="addCell"][data-type="sql"]').click();
  for (const element of b.window.document.querySelectorAll('textarea[data-cell-index], button[data-action]')) {
    assert.equal(element.matches('textarea') ? element.readOnly : element.disabled, true);
  }
  await b.panel.send(b.sent.find(message => message.command === 'save'));
  b.receive(b.panel.messages.at(-1));
  const reload = b.sent.find(message => message.command === 'reloadNotebook');
  assert.ok(reload);
  await b.panel.send(reload); await b.mount();
  assert.deepEqual(b.host.read(), fixture());
  assert.equal(b.window.document.querySelectorAll('textarea[data-cell-index]').length, 2);
  assert.equal(b.state.recoveries.length, 1);
  assert.equal(b.state.recoveries[0].draft.notebook.cells.length, 3);
  assert.equal(b.state.recoveries[0].draft.notebook.cells[0].content, 'pending before rejected add');
  assert.equal(b.window.document.querySelector('#cell-0 textarea').disabled, false);
});

test('late result during local structural deletion cannot corrupt shifted cell recovery', async t => {
  const b = await recoveryBrowser(); t.after(b.close);
  b.setConfirmation(true);
  b.window.document.querySelector('[data-action="deleteCell"][data-index="0"]').click();
  const save = b.sent.find(message => message.command === 'save');
  assert.equal(save.notebook.cells[0].content, 'SELECT 1');
  b.receive({ command: 'cellResult', sessionId: b.panel.sessionId, index: 0,
    output: { columns: ['old cell0'], rows: [[1234]], rowCount: 1 } });
  assert.equal(b.state.draft.notebook.cells[0].content, 'SELECT 1');
  assert.equal(b.state.draft.notebook.cells[0].output, undefined);
});

test('reload handshake carries exact draft even when asynchronous persisted state is unavailable', async t => {
  const b = await recoveryBrowser(fixture(), true); t.after(b.close);
  b.input('#cell-0 textarea', 'handshake must carry these bytes');
  const current = fixture(); current.cells.reverse();
  await b.external(JSON.stringify(current));
  const ready = b.sent.find(message => message.command === 'reloadReady');
  assert.ok(ready);
  assert.equal(ready.state.draft.notebook.cells[0].content, 'handshake must carry these bytes');
  assert.equal(b.state.recoveries.length, 1);
  assert.ok(b.recoveryText.includes('handshake must carry these bytes'));
  assert.deepEqual(b.host.read(), current);
});

test('host waits for matching recovery handoff, retains old view on timeout, then renders latest document', async t => {
  const h = await harness(), p = await h.panel();
  const originalHtml = p.panel.webview.html;
  let request: any;
  p.setReloadHandler(message => { request = message; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = fixture(); first.cells.reverse();
  h.commit({ text: JSON.stringify(first) });
  assert.equal(request.command, 'prepareReload');
  assert.equal(p.panel.webview.html, originalHtml);
  await p.send({ command: 'reloadReady', reloadId: 'incorrect', sessionId: request.sessionId, state: { recoveries: [] } });
  assert.equal(p.panel.webview.html, originalHtml);
  await p.send({ command: 'reloadReady', reloadId: request.reloadId, sessionId: 'old-session', state: { recoveries: [] } });
  assert.equal(p.panel.webview.html, originalHtml);
  t.mock.timers.tick(5001);
  assert.equal(p.panel.webview.html, originalHtml);
  assert.match(h.errors.at(-1)!, /not confirmed draft recovery/);
  const latest = fixture(); latest.cells[0].content = 'latest while handoff pending';
  h.commit({ text: JSON.stringify(latest) });
  await p.send({ command: 'reloadReady', reloadId: request.reloadId, sessionId: request.sessionId,
    state: { recoveries: [] } });
  assert.notEqual(p.panel.webview.html, originalHtml);
  assert.ok(p.panel.webview.html.includes('latest while handoff pending'));
});

test('unreadable view hands recovered drafts forward when valid document returns', async t => {
  const b = await recoveryBrowser(fixture(), true); t.after(b.close);
  b.input('#cell-0 textarea', 'draft across unreadable intermediate');
  await b.external('{invalid');
  assert.ok(b.recoveryText.includes('draft across unreadable intermediate'));
  const current = fixture(); current.cells.reverse();
  await b.external(JSON.stringify(current));
  assert.equal(b.state.recoveries.length, 1);
  assert.ok(b.recoveryText.includes('draft across unreadable intermediate'));
  assert.equal(b.window.document.querySelector('#cell-0 textarea').value, 'SELECT 1');
});

test('queued old-panel save cannot overwrite externally reordered same-type cells during handoff', async () => {
  const h = await harness(), first = await h.panel(), second = await h.panel();
  first.setReloadHandler(() => {}); second.setReloadHandler(() => {});
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  h.setApply(async edit => { h.commit(edit); await gate; return true; });
  const firstEdit = fixture(); firstEdit.cells[0].content = 'first save';
  const saving = first.save(firstEdit);
  await tick();
  const queuedEdit = fixture(); queuedEdit.cells[0].content = 'old index edit';
  const queued = second.save(queuedEdit);
  const reordered = h.read(); reordered.cells.reverse();
  h.commit({ text: JSON.stringify(reordered) });
  release(); await Promise.all([saving, queued]);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.read(), reordered);
  assert.ok(second.messages.some(message => message.command === 'prepareReload'));
  // Resolve requests so test leaves no outstanding host reload timers.
  for (const panel of [first, second]) {
    const request = panel.messages.find(message => message.command === 'prepareReload');
    await panel.send({ command: 'reloadReady', reloadId: request.reloadId, sessionId: request.sessionId,
      state: { draft: { notebook: queuedEdit, base: fixture(), variableRows: [] }, recoveries: [] } });
  }
});

test('compiled recovery function is closure-free and captures model/base/raw rows independently', t => {
  const dom = new JSDOM('<section id="recovered-drafts"><div id="recovered-drafts-list"></div></section>');
  t.after(() => dom.window.close());
  const isolated = runInNewContext(`(${createNotebookRecovery.toString()})`) as typeof createNotebookRecovery;
  let state: any;
  const recovery = isolated({ getState: () => undefined, setState: value => { state = copy(value); },
    postMessage: () => undefined }, dom.window.document, fixture());
  const local = fixture(); local.cells[0].content = 'captured';
  recovery.capture(local, fixture(), [{ key: ' ', value: 'unfinished ' }]);
  local.cells[0].content = 'mutated afterwards';
  assert.equal(state.draft.notebook.cells[0].content, 'captured');
  assert.equal(state.draft.base.cells[0].content, 'SELECT 0');
  assert.deepEqual(state.draft.variableRows, [{ key: ' ', value: 'unfinished ' }]);
  assert.deepEqual(copy(recovery.snapshot()), state);
});

for (const trigger of ['client focus', 'panel reveal', 'webview recreation'] as const) {
  test(`dropped reload request retries same handshake on ${trigger} and recovers exact pending edits`, async t => {
    const b = await recoveryBrowser(); t.after(b.close);
    b.input('#cell-0 textarea', 'draft survives dropped reload');
    b.setDropReloadRequests(true);
    const current = fixture(); current.cells.reverse();
    const originalHtml = b.panel.panel.webview.html;
    b.host.commit({ text: JSON.stringify(current) });
    assert.equal(b.reloadRequests.length, 1);
    assert.equal(b.panel.panel.webview.html, originalHtml);
    assert.equal(b.window.document.querySelector('#cell-0 textarea').value, 'draft survives dropped reload');
    b.setDropReloadRequests(false);
    if (trigger === 'client focus') { b.window.dispatchEvent(new b.window.Event('focus')); }
    else if (trigger === 'panel reveal') { b.panel.reveal(); }
    else { await b.mount(); }
    await b.mount();
    assert.ok(b.reloadRequests.length >= 2);
    assert.equal(b.reloadRequests[1].reloadId, b.reloadRequests[0].reloadId);
    assert.equal(b.reloadRequests[1].sessionId, b.reloadRequests[0].sessionId);
    assert.ok(b.recoveryText.includes('draft survives dropped reload'));
    assert.equal(b.window.document.querySelector('#cell-0 textarea').value, 'SELECT 1');
    assert.deepEqual(b.host.read(), current);
    assert.equal(b.host.writes.length, 0);
    // New-session editing works after recovery, not permanently blocked.
    b.input('#cell-0 textarea', 'new session edit');
    b.window.dispatchEvent(new b.window.Event('blur'));
    const save = b.sent.filter(message => message.command === 'save').at(-1);
    await b.panel.send(save);
    assert.equal(b.host.read().cells[0].content, 'new session edit');
  });
}

test('no-op structural acknowledgment unlocks read-only text and disabled actions', async t => {
  const b = await browser(); t.after(() => b.dom.window.close());
  b.window.refreshView();
  const sent = b.sent[0];
  assert.equal(b.cell(0).readOnly, true);
  // A host no-op acknowledgment keeps the DOM and must release its UI lock.
  await b.panel.send(sent);
  b.receive(b.panel.messages.at(-1));
  assert.equal(b.host.writes.length, 0);
  assert.equal(b.cell(0).readOnly, false);
  assert.equal(b.window.document.querySelector('[data-action="addCell"][data-type="sql"]').disabled, false);
});

test('unreadable view readiness retries dropped handoff without losing existing recovery', async t => {
  const b = await recoveryBrowser(); t.after(b.close);
  b.input('#cell-0 textarea', 'draft kept through unreadable retry');
  await b.external('{invalid');
  b.setDropReloadRequests(true);
  const valid = fixture(); valid.cells.reverse();
  b.host.commit({ text: JSON.stringify(valid) });
  const pending = b.reloadRequests.at(-1);
  assert.equal(b.window.document.querySelector('textarea[data-cell-index]'), null);
  b.setDropReloadRequests(false);
  b.window.dispatchEvent(new b.window.Event('focus'));
  await b.mount();
  assert.equal(b.reloadRequests.at(-1).reloadId, pending.reloadId);
  assert.ok(b.recoveryText.includes('draft kept through unreadable retry'));
  assert.equal(b.window.document.querySelector('#cell-0 textarea').value, 'SELECT 1');
  assert.equal(b.host.writes.length, 0);
});

test('same-HTML recreation after acknowledged save blocks stale execution then resumes canonical query', async t => {
  const b = await recoveryBrowser(); t.after(b.close);
  const originalHtml = b.panel.panel.webview.html;
  b.input('#cell-0 textarea', 'SELECT 99');
  b.window.dispatchEvent(new b.window.Event('blur'));
  await b.panel.send(b.sent.find(message => message.command === 'save'));
  b.receive(b.panel.messages.at(-1));
  assert.equal(b.host.read().cells[0].content, 'SELECT 99');
  assert.equal(b.panel.panel.webview.html, originalHtml);
  b.holdReadiness();
  await b.mount();
  const staleInput = b.window.document.querySelector('#cell-0 textarea');
  assert.equal(staleInput.value, 'SELECT 0');
  assert.equal(staleInput.readOnly, true);
  const run = b.window.document.querySelector('[data-action="executeCell"][data-index="0"]');
  assert.equal(run.disabled, true);
  run.click();
  b.window.executeCell(0);
  assert.equal(b.sent.filter(message => message.command === 'executeCell').length, 0);
  assert.equal(b.state.draft.notebook.cells[0].content, 'SELECT 99');
  await b.releaseReadiness(); await b.mount();
  assert.equal(b.window.document.querySelector('#cell-0 textarea').value, 'SELECT 99');
  assert.equal(b.window.document.querySelector('#cell-0 textarea').readOnly, false);
  assert.equal(b.state.recoveries.length, 0);
  b.window.document.querySelector('[data-action="executeCell"][data-index="0"]').click();
  assert.equal(b.sent.filter(message => message.command === 'executeCell').at(-1).content, 'SELECT 99');
  assert.equal(b.host.writes.length, 1);
});

const semanticInvalidCells: Array<[string, unknown]> = [
  ['null cell', null],
  ['unknown cell type', { type: 'unknown', content: 'SELECT 0' }],
  ['nonstring content', { type: 'sql', content: 123 }],
  ['nonarray output columns', { type: 'sql', content: '', output: { columns: 'bad' } }],
  ['nonstring column entry', { type: 'sql', content: '', output: { columns: [123] } }],
  ['nonarray output rows', { type: 'sql', content: '', output: { rows: 'bad' } }],
  ['nonarray row entry', { type: 'sql', content: '', output: { rows: [null] } }],
  ['nonnumeric execution time', { type: 'sql', content: '', output: { executionTime: '10' } }],
  ['HTML execution time', { type: 'sql', content: '', output: { executionTime: '<img src=x onerror="window.invalidOutputExecuted=true">' } }],
  ['nonnumeric row count', { type: 'sql', content: '', output: { rowCount: '10' } }],
  ['HTML row count', { type: 'sql', content: '', output: { rowCount: '<script>window.invalidOutputExecuted=true</script>' } }],
  ['array output', { type: 'sql', content: '', output: [] }],
  ['nonstring error', { type: 'sql', content: '', output: { error: { message: 'bad' } } }]
];

for (const [name, invalidCell] of semanticInvalidCells) {
  test(`semantic-invalid raw ${name} preserves pending draft in unreadable recovery without rewriting file`, async t => {
    const b = await recoveryBrowser(); t.after(b.close);
    b.input('#cell-0 textarea', 'pending draft before semantic-invalid raw edit');
    const invalidText = JSON.stringify({ version: '1', cells: [invalidCell] });
    await b.external(invalidText);
    assert.equal(b.window.document.querySelector('textarea[data-cell-index]'), null);
    assert.ok(b.window.document.body.textContent.includes('This notebook could not be opened'));
    assert.ok(b.recoveryText.includes('pending draft before semantic-invalid raw edit'));
    assert.equal(b.state.recoveries.length, 1);
    b.window.dispatchEvent(new b.window.Event('blur'));
    assert.equal(b.host.document.getText(), invalidText);
    assert.equal(b.host.writes.length, 0);
    assert.equal(b.sent.filter(message => message.command === 'save').length, 0);
    assert.equal(b.window.invalidOutputExecuted, undefined);
    assert.equal(b.window.document.querySelector('img[onerror]'), null);
  });

  for (const invalidField of ['base', 'notebook'] as const) {
    test(`host rejects ${name} in save ${invalidField} without applying edit`, async () => {
      const h = await harness(), panel = await h.panel();
      const message = { command: 'save', saveId: 9, base: fixture(), notebook: fixture() };
      message[invalidField] = { version: '1', cells: [invalidCell] } as ArcNotebook;
      await panel.send(message);
      assert.equal(h.writes.length, 0);
      assert.deepEqual(h.read(), fixture());
      assert.deepEqual(panel.messages, [{ command: 'saveFailed', saveId: 9, sessionId: panel.sessionId }]);
    });
  }
}

for (const output of [null, { columns: null, rows: null, rowCount: null, executionTime: null, error: null }]) {
  test(`nullable output ${output === null ? 'object' : 'fields'} remains valid without manufacturing recovery`, async t => {
    const initial = fixture(); initial.cells[0].output = output as any;
    const b = await recoveryBrowser(initial); t.after(b.close);
    assert.equal(b.window.document.querySelector('#cell-0 textarea').value, 'SELECT 0');
    assert.equal(b.window.document.querySelector('#recovered-drafts').hidden, true);
    assert.equal(b.state.recoveries.length, 0);
    b.input('#cell-1 textarea', 'SELECT updated');
    b.window.dispatchEvent(new b.window.Event('blur'));
    const save = b.sent.find(message => message.command === 'save');
    await b.panel.send(save);
    assert.equal(b.panel.messages.at(-1).command, 'syncNotebook');
    assert.deepEqual(b.host.read().cells[0].output, output);
  });
}

for (const target of ['global variable', 'output row'] as const) {
  test(`raw JSON ${target} with shadowed toString stays editable and retains pending recovery`, async t => {
    const b = await recoveryBrowser(); t.after(b.close);
    b.input('#cell-1 textarea', 'pending draft before shadowed conversion');
    const current = fixture();
    const value = { toString: null };
    if (target === 'global variable') {
      current.globalVariables = { x: value };
      current.cells[0].content = 'SELECT ${x}';
    } else {
      current.cells[0].output = { columns: ['value'], rows: [[value]], rowCount: 1 };
    }
    await b.external(JSON.stringify(current));
    assert.equal(b.window.document.querySelector('#cell-0 textarea').readOnly, false);
    assert.ok(b.recoveryText.includes('pending draft before shadowed conversion'));
    assert.deepEqual(b.host.read(), current);
    assert.equal(b.host.writes.length, 0);
    if (target === 'global variable') {
      assert.equal(b.window.document.querySelector('.variable-row input[name="value"]').value, '{"toString":null}');
      b.window.document.querySelector('[data-action="executeCell"][data-index="0"]').click();
      assert.equal(b.sent.filter(message => message.command === 'executeCell').at(-1).content,
        'SELECT \'{"toString":null}\'');
    } else {
      assert.equal(b.window.document.querySelector('#cell-0 .cell-output td').textContent, '{"toString":null}');
      const updated = copy(current);
      updated.cells[0].output!.rows = [[{ toString: null, valueOf: null }]];
      const sessionId = /const sessionId = '([^']+)'/.exec(b.panel.panel.webview.html)![1];
      b.receive({ command: 'syncNotebook', sessionId, notebook: updated, version: b.host.document.version + 1 });
      assert.equal(b.window.document.querySelector('#cell-0 .cell-output td').textContent, '{"toString":null,"valueOf":null}');
    }
  });
}
