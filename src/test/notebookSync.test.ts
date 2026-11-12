import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { ArcNotebook } from '../types/notebook';
import { mergeSyncedNotebook as merge, notebookValueText } from '../views/notebookSync';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fixture = (): ArcNotebook => ({ version: '1', cells: [
  { type: 'sql', content: 'SELECT 0' }, { type: 'sql', content: 'SELECT 1' }
] });

test('merge preserves unrelated typing and slow cell results, with local conflict precedence', () => {
  const base = fixture(), local = copy(base), remote = copy(base);
  local.cells[0].content = 'SELECT typing';
  remote.cells[0].content = 'SELECT sibling';
  remote.cells[1].output = { rows: [[42]], rowCount: 1 };
  const result = merge(base, local, remote);
  assert.equal(result.cells[0].content, local.cells[0].content);
  assert.deepEqual(result.cells[1].output, remote.cells[1].output);
  assert.deepEqual(merge(base, base, remote), remote);
});

for (const scope of ['globalVariables', 'variables'] as const) {
  for (const side of ['local', 'incoming'] as const) {
    test(`${scope}: deletion from ${side} survives unrelated edits`, () => {
      const base = fixture();
      const record = (n: ArcNotebook): any => scope === 'globalVariables' ? n : n.cells[0];
      record(base)[scope] = { deleted: 'old', kept: 'old' };
      const local = copy(base), incoming = copy(base);
      delete record(side === 'local' ? local : incoming)[scope]!.deleted;
      record(side === 'local' ? incoming : local)[scope]!.kept = 'new';
      assert.deepEqual(record(merge(base, local, incoming))[scope], { kept: 'new' });
    });
  }
}

test('variable rename and sibling value edit preserve local key order', () => {
  const base = { ...fixture(), globalVariables: { first: '1', old: '2', last: '3' } };
  const local = { ...copy(base), globalVariables: { first: '1', renamed: '2', last: '3' } };
  const remote = copy(base);
  remote.globalVariables.first = 'updated';
  const vars = merge(base, local, remote).globalVariables!;
  assert.deepEqual(vars, { first: 'updated', renamed: '2', last: '3' });
  assert.deepEqual(Object.keys(vars), ['first', 'renamed', 'last']);
});

test('object key order is semantic equality and absent optional variables stay absent', () => {
  const base = fixture(), local = copy(base), remote = copy(base);
  base.cells[0].variables = { item: { a: 1, b: 2 } };
  local.cells[0].variables = { item: { b: 2, a: 1 } };
  remote.cells[0].variables = { item: { a: 3, b: 2 } };
  assert.deepEqual(merge(base, local, remote).cells[0].variables, remote.cells[0].variables);
  assert.equal(JSON.stringify(merge(fixture(), fixture(), fixture())), JSON.stringify(fixture()));
});

test('compiled merge is closure-free and supports own __proto__ keys', () => {
  const browserMerge = runInNewContext(`(${merge.toString()})`) as typeof merge;
  const base = { ...fixture(), globalVariables: JSON.parse('{"__proto__":"old"}') };
  const remote = { ...copy(base), globalVariables: JSON.parse('{"__proto__":"new"}') };
  const result = copy(browserMerge(base, base, remote));
  assert.deepEqual(result, merge(base, base, remote));
  assert.equal(Object.hasOwn(result.globalVariables!, '__proto__'), true);
  assert.equal(result.globalVariables!['__proto__'], 'new');
});

test('structural mismatches use incoming snapshot', () => {
  const base = fixture(), remote = copy(base);
  remote.cells.pop();
  assert.deepEqual(merge(base, base, remote), remote);
  remote.cells[0].type = 'markdown';
  assert.deepEqual(merge(base, base, remote), remote);
});


test('compiled value display converter is closure-free and safe for shadowed conversion methods', () => {
  const isolated = runInNewContext(`(${notebookValueText.toString()})`) as typeof notebookValueText;
  const values: Array<[unknown, string]> = [
    [0, '0'], [false, 'false'], [null, ''], [undefined, ''],
    [{ toString: null }, '{"toString":null}'],
    [{ toString: 0, valueOf: false }, '{"toString":0,"valueOf":false}']
  ];
  for (const [value, expected] of values) {
    assert.equal(notebookValueText(value), expected);
    assert.equal(isolated(value), expected);
  }
});
