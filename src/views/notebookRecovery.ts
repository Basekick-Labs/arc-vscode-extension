import { ArcNotebook } from '../types/notebook';

export interface NotebookDraft {
  notebook: ArcNotebook;
  base: ArcNotebook;
  variableRows: Array<{ key: string; value: string }>;
}

interface RecoveryState {
  revision?: number;
  sessionId?: string;
  draft?: NotebookDraft;
  recoveries: Array<{ id: string; draft: NotebookDraft }>;
}

interface RecoveryApi {
  getState(): RecoveryState | undefined;
  setState(state: RecoveryState): unknown;
  postMessage(message: unknown): unknown;
}

/**
 * Preserve unsent drafts when VS Code replaces a webview's HTML. A changed
 * structure has no stable cell IDs, so show recovery copies instead of
 * guessing which current cell should receive old text.
 *
 * Must stay closure-free: the compiled function is embedded in both the
 * editable and unreadable-file webviews. DOM types are intentionally local
 * to the browser boundary rather than adding lib.dom to the extension host.
 */
export function createNotebookRecovery(api: RecoveryApi, document: any, current?: ArcNotebook, transferredState?: RecoveryState, sessionId?: string) {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  // Drafts keep what the user typed plus any result that is not saved yet.
  // A result already in the base is left out: it is on disk, and copying it
  // made every capture cost megabytes for a large result. keep lists the
  // cells whose output the draft carries.
  const project = (notebook: ArcNotebook, keep: number[]): ArcNotebook => ({
    ...notebook,
    cells: notebook.cells.map((cell, index) => {
      const rest = { ...cell };
      if (!keep.includes(index)) { delete rest.output; }
      return rest;
    })
  });
  const carried = (notebook: ArcNotebook) => notebook.cells
    .map((cell, index) => Object.prototype.hasOwnProperty.call(cell, 'output') ? index : -1)
    .filter(index => index !== -1);
  const textValue = (value: unknown): string => {
    if (value === null || value === undefined) { return ''; }
    try { return String(value); }
    catch {
      try { return JSON.stringify(value) ?? ''; }
      catch { return '[Unsupported value]'; }
    }
  };
  const rowsFor = (notebook: ArcNotebook) => Object.entries(notebook.globalVariables ?? {})
    .map(([key, value]) => ({ key, value: textValue(value) }));
  // Equal as JSON documents: key order is not significant (a notebook file
  // may order a cell's keys differently from the extension), so compare with
  // object keys sorted. Kept local because this function must stay closure-free.
  const canonical = (value: unknown): string => {
    const sortKeys = (node: unknown): unknown => {
      if (Array.isArray(node)) { return node.map(sortKeys); }
      if (node !== null && typeof node === 'object') {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(node as Record<string, unknown>).sort()) {
          Object.defineProperty(sorted, key, { value: sortKeys((node as Record<string, unknown>)[key]), enumerable: true, writable: true, configurable: true });
        }
        return sorted;
      }
      return node;
    };
    return JSON.stringify(sortKeys(value)) ?? 'undefined';
  };
  const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
  const persisted = api.getState();
  // HTML can be recreated later with its original transfer embedded. Prefer
  // a newer persisted state so dismissed recoveries do not reappear and later
  // edits are not replaced. A delayed setState still loses to a fresh handoff.
  const previous = (persisted?.revision ?? 0) > (transferredState?.revision ?? 0)
    ? persisted : transferredState ?? persisted;
  let revision = previous?.revision ?? 0;
  const recoveries: RecoveryState['recoveries'] = copy(previous?.recoveries ?? []);
  let active: NotebookDraft | undefined;

  // A recreated frame still embeds the HTML's original document. Keep its
  // newer state untouched until the host hands over fresh canonical HTML.
  const resuming = !!sessionId && previous?.sessionId === sessionId;
  const oldDraft = previous?.draft;
  if (oldDraft && !resuming) {
    // Compare the draft with the base and with the current document as the
    // draft carries them: outputs only for the cells whose result was unsaved.
    const keep = carried(oldDraft.notebook);
    const unsavedModel = !same(oldDraft.notebook, project(oldDraft.base, keep)) &&
      !(current && same(oldDraft.notebook, project(current, keep)));
    const incompleteRows = !same(oldDraft.variableRows, rowsFor(oldDraft.notebook));
    if ((unsavedModel || incompleteRows) && !recoveries.some(item => same(item.draft, oldDraft))) {
      recoveries.push({ id: `${Date.now()}-${recoveries.length}`, draft: copy(oldDraft) });
    }
  }
  if (resuming) {
    active = oldDraft ? copy(oldDraft) : undefined;
  } else if (current) {
    active = { notebook: copy(project(current, [])), base: copy(project(current, [])), variableRows: rowsFor(current) };
  }

  const persist = () => api.setState(copy({ revision: ++revision, sessionId, draft: active, recoveries }));
  const render = () => {
    const container = document.getElementById('recovered-drafts');
    if (!container) { return; }
    container.hidden = recoveries.length === 0;
    const list = document.getElementById('recovered-drafts-list');
    list.replaceChildren();
    recoveries.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'recovered-draft';
      card.dataset.recoveryId = item.id;
      const title = document.createElement('h3');
      title.textContent = `Recovered draft ${index + 1}`;
      const text = document.createElement('textarea');
      text.className = 'recovered-draft-json';
      text.setAttribute('aria-label', `Recovered draft ${index + 1} JSON`);
      text.readOnly = true;
      text.rows = 10;
      // The JSON includes raw unfinished variable rows as well as the model
      // and its base. Assign values, never parse notebook content as HTML.
      text.value = JSON.stringify(item.draft, null, 2);
      const save = document.createElement('button');
      save.dataset.recoveryAction = 'save';
      save.textContent = 'Save recovery file';
      save.addEventListener('click', () => api.postMessage({ command: 'saveRecovery', recovery: copy(item.draft) }));
      const discard = document.createElement('button');
      discard.dataset.recoveryAction = 'discard';
      discard.textContent = 'Discard recovered draft';
      discard.addEventListener('click', () => {
        if (!document.defaultView.confirm('Discard this recovered draft? Save a recovery file or copy its text first. This cannot be undone.')) { return; }
        recoveries.splice(recoveries.indexOf(item), 1);
        persist();
        render();
      });
      card.append(title, text, save, discard);
      list.appendChild(card);
    });
  };

  persist();
  render();
  return {
    resuming,
    snapshot(): RecoveryState { return copy({ revision, sessionId, draft: active, recoveries }); },
    capture(notebook: ArcNotebook, base: ArcNotebook, variableRows: NotebookDraft['variableRows']) {
      // Outputs are replaced whole, never mutated, so a reference check finds
      // the results that are not in the base yet without reading them. Match
      // by object, not by position: while a local add/delete is pending the
      // indexes shift, and a saved result must not be copied as unsaved.
      const saved = new Set(base.cells.map(cell => cell.output));
      const unsaved = notebook.cells
        .map((cell, index) => cell.output !== undefined && !saved.has(cell.output) ? index : -1)
        .filter(index => index !== -1);
      active = copy({ notebook: project(notebook, unsaved), base: project(base, []), variableRows });
      persist();
    }
  };
}
