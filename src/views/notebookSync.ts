import { ArcNotebook, ArcNotebookCell } from '../types/notebook';

/**
 * Merge a sibling panel's saved notebook into this panel without discarding
 * edits that have not yet been sent to the host.
 */
export function mergeSyncedNotebook(
  base: ArcNotebook,
  local: ArcNotebook,
  incoming: ArcNotebook
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
    const keys = new Set([...Object.keys(saved), ...Object.keys(localRecord), ...Object.keys(incomingRecord)]);

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

    const output = mergeValue(savedCell.output, localCell.output, incomingCell.output);
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
