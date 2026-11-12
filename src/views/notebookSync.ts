import { ArcNotebook, ArcNotebookCell } from '../types/notebook';

/**
 * Merge a sibling panel's saved notebook into this panel without discarding
 * edits relative to the base that actually produced them. On conflicts local wins.
 *
 * localOutputChanges, when given, lists the cells whose output the local side
 * replaced since base. Outputs are then taken from local for those cells and
 * from incoming for the rest, with no content comparison: outputs are the
 * large part of a notebook (a 50k-row result is megabytes) and are only ever
 * replaced whole, so the sender knows exactly which ones it changed.
 *
 * Must stay closure-free: this compiled function is also embedded in the
 * webview. Keep helpers inside it; do not add runtime imports or captures.
 */
export function mergeSyncedNotebook(
  base: ArcNotebook,
  local: ArcNotebook,
  incoming: ArcNotebook,
  localOutputChanges?: number[]
): ArcNotebook {
  const sameValue = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) { return true; }
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
      return false;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
        left.every((value, index) => sameValue(value, right[index]));
    }

    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
      key === rightKeys[index] && sameValue(leftRecord[key], rightRecord[key])
    );
  };

  const mergeValue = (saved: unknown, localValue: unknown, incomingValue: unknown): unknown => {
    if (sameValue(localValue, saved)) { return incomingValue; }
    if (sameValue(incomingValue, saved) || sameValue(localValue, incomingValue)) { return localValue; }
    return localValue;
  };

  const mergeRecord = (
    saved: Record<string, unknown>,
    localRecord: Record<string, unknown>,
    incomingRecord: Record<string, unknown>
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    const setOwn = (key: string, value: unknown) => Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    });
    // Preserve local row order (especially renames); append incoming-only keys.
    const keys = new Set([...Object.keys(localRecord), ...Object.keys(incomingRecord), ...Object.keys(saved)]);

    for (const key of keys) {
      const savedHas = Object.prototype.hasOwnProperty.call(saved, key);
      const localHas = Object.prototype.hasOwnProperty.call(localRecord, key);
      const incomingHas = Object.prototype.hasOwnProperty.call(incomingRecord, key);
      const localChanged = savedHas !== localHas || (localHas && !sameValue(localRecord[key], saved[key]));

      if (!localChanged) {
        if (incomingHas) { setOwn(key, incomingRecord[key]); }
        continue;
      }

      // Local edits are still pending in this panel. Keep them on conflicts;
      // the next autosave writes the merged state back to the shared document.
      if (localHas) { setOwn(key, localRecord[key]); }
    }

    return result;
  };

  if (base.cells.length !== local.cells.length || base.cells.length !== incoming.cells.length ||
    base.cells.some((cell, index) =>
      cell.type !== local.cells[index].type || cell.type !== incoming.cells[index].type
    )) {
    return incoming;
  }

  const cells: ArcNotebookCell[] = incoming.cells.map((incomingCell, index) => {
    const savedCell = base.cells[index];
    const localCell = local.cells[index];
    const cell: ArcNotebookCell = {
      ...incomingCell,
      content: mergeValue(savedCell.content, localCell.content, incomingCell.content) as string
    };

    const output = localOutputChanges
      ? (localOutputChanges.includes(index) ? localCell.output : incomingCell.output)
      : mergeValue(savedCell.output, localCell.output, incomingCell.output);
    if (output === undefined) { delete cell.output; }
    else { cell.output = output as ArcNotebookCell['output']; }

    const variables = mergeRecord(
      savedCell.variables ?? {},
      localCell.variables ?? {},
      incomingCell.variables ?? {}
    );
    if (Object.keys(variables).length === 0 && savedCell.variables === undefined &&
      localCell.variables === undefined && incomingCell.variables === undefined) {
      delete cell.variables;
    } else {
      cell.variables = variables;
    }

    return cell;
  });

  const merged: ArcNotebook = { ...incoming, cells };
  if (base.globalVariables === undefined && local.globalVariables === undefined &&
    incoming.globalVariables === undefined) {
    delete merged.globalVariables;
  } else {
    merged.globalVariables = mergeRecord(
      base.globalVariables ?? {},
      local.globalVariables ?? {},
      incoming.globalVariables ?? {}
    );
  }

  return merged;
}

/**
 * Deep equality for notebook JSON. Closure-free (embedded in the webview).
 * Shared references compare in O(1), which is what keeps the webview's
 * "anything unsaved?" checks cheap: unchanged outputs are the same objects
 * in the model and in its last acknowledged snapshot.
 */
export function sameNotebookValue(left: unknown, right: unknown): boolean {
  const sameValue = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) { return true; }
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { return false; }
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
        a.every((value, index) => sameValue(value, b[index]));
    }
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord).filter(key => aRecord[key] !== undefined).sort();
    const bKeys = Object.keys(bRecord).filter(key => bRecord[key] !== undefined).sort();
    return aKeys.length === bKeys.length && aKeys.every((key, index) =>
      key === bKeys[index] && sameValue(aRecord[key], bRecord[key])
    );
  };
  return sameValue(left, right);
}

/** Closure-free display conversion for arbitrary JSON values from a notebook. */
export function notebookValueText(value: unknown): string {
  if (value === null || value === undefined) { return ''; }
  try { return String(value); }
  catch {
    // A JSON object can shadow toString/valueOf with non-callable values.
    try { return JSON.stringify(value) ?? ''; }
    catch { return '[Unsupported value]'; }
  }
}
