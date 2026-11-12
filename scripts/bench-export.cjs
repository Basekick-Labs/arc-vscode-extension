#!/usr/bin/env node
// Benchmark for exporting query results (development only, not packaged).
//
//   npm run compile
//   node --expose-gc scripts/bench-export.cjs [runs] [outDir]
//
// Every measurement runs in a fresh child process so peak RSS is its own.
// Prints Markdown tables with the median of `runs` (default 3).
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');

const exportModule = path.join(__dirname, '..', 'out', 'utils', 'resultExport.js');
const columns = ['time', 'host', 'region', 'cpu', 'mem', 'ok'];

// Rows shaped like Arc's JSON response: numbers, strings, a boolean.
function makeRows(count, nested) {
  const rows = new Array(count);
  for (let i = 0; i < count; i++) {
    rows[i] = [1_700_000_000_000 + i, `host-${i % 500}`, i % 3 ? 'eu-west' : 'us-east, "b"',
      (i % 1000) / 10, nested ? { used: i, tags: ['a', i % 7] } : i * 1.5, i % 2 === 0];
  }
  return rows;
}

const mb = bytes => Math.round(bytes / 1024 / 1024);
const maxRssMb = () => Math.round(process.resourceUsage().maxRSS / 1024);

// Old webview converters (main before this change), used as a reference.
function oldCsv(cols, rows) {
  const esc = value => {
    if (value === null || value === undefined) { return ''; }
    const str = String(value);
    return str.includes(',') || str.includes('"') || str.includes('\n') ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  return [cols.map(esc).join(','), ...rows.map(row => row.map(esc).join(','))].join('\n');
}
function oldJson(cols, rows) {
  return JSON.stringify(rows.map(row => { const o = {}; cols.forEach((c, i) => { o[c] = row[i]; }); return o; }), null, 2);
}

async function child(task) {
  const { encodeCsv, encodeJson, writeChunksToFile, normalizeCell } = require(exportModule);
  const out = {};
  if (task.kind === 'export' || task.kind === 'reference') {
    const rows = makeRows(task.rows, false);
    global.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    let peakHeap = heapBefore;
    const sampler = setInterval(() => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); }, 5);
    const loop = monitorEventLoopDelay({ resolution: 5 });
    loop.enable();
    // The monitor records from its second tick on; give it one first.
    await new Promise(resolve => setTimeout(resolve, 20));
    const file = path.join(task.dir, `bench-${process.pid}.${task.format}`);
    const start = performance.now();
    if (task.kind === 'export') {
      const encode = task.format === 'csv' ? encodeCsv : encodeJson;
      await writeChunksToFile(file, encode(columns, rows, Infinity));
    } else {
      // One synchronous convert and one write, as the old code did.
      const text = task.format === 'csv' ? oldCsv(columns, rows) : oldJson(columns, rows);
      await fs.promises.writeFile(file, Buffer.from(text, 'utf-8'));
    }
    out.ms = performance.now() - start;
    // Let the sampler and the loop monitor see the end of the run.
    await new Promise(resolve => setTimeout(resolve, 20));
    loop.disable(); clearInterval(sampler);
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    out.peakRss = maxRssMb();
    out.heapDelta = mb(peakHeap - heapBefore);
    out.sizeMb = mb(fs.statSync(file).size);
    out.p99 = loop.percentile(99) / 1e6;
    out.max = loop.max / 1e6;
    fs.unlinkSync(file);
  } else if (task.kind === 'hold') {
    // Two consecutive queries reading the same 1M-row JSON response, parsed
    // like axios does (string, then JSON.parse). "main": nothing is kept
    // after rendering (before this change). "held": the view keeps the
    // result. "released": the view keeps it but drops it when the next
    // query starts (this change).
    global.gc();
    const base = process.memoryUsage().heapUsed;
    const view = { held: undefined };
    // A function per query so nothing but `view` can keep a result alive.
    let q = 0;
    const query = () => {
      let text = fs.readFileSync(task.response, 'utf-8');
      const parsed = JSON.parse(text);
      text = undefined;
      if (q === 1) {
        // Live heap while the second result is being rendered.
        global.gc();
        out.liveSecond = mb(process.memoryUsage().heapUsed - base);
      }
      const page = JSON.stringify(parsed.data.slice(0, 1000));
      if (page.length === 0) { throw new Error('unreachable'); }
      if (task.variant !== 'main') { view.held = parsed; }
    };
    for (; q < 2; q++) {
      if (task.variant === 'released') { view.held = undefined; }
      query();
    }
    global.gc();
    out.retained = mb(process.memoryUsage().heapUsed - base);
    out.peakRss = maxRssMb();
    if (view.held && view.held.data.length !== 1_000_000) { throw new Error('bad'); }
  } else if (task.kind === 'normalize') {
    const rows = makeRows(task.rows, task.nested);
    const start = performance.now();
    let sink = 0;
    for (const row of rows) { for (const cell of row) { if (normalizeCell(cell) === sink) { sink++; } } }
    out.normalizeMs = performance.now() - start;
    const t2 = performance.now();
    for (const chunk of encodeCsv(columns, rows, Infinity)) { sink += chunk.text.length; }
    out.encodeMs = performance.now() - t2;
  }
  process.stdout.write(JSON.stringify(out));
}

function run(task) {
  const result = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=8192', __filename, '--child', JSON.stringify(task)],
    { encoding: 'utf-8', maxBuffer: 1 << 20 });
  if (result.status !== 0) {
    const err = (result.stderr || '').split('\n').find(line => /Error/.test(line)) || `exit ${result.status}`;
    return { error: err.trim() };
  }
  return JSON.parse(result.stdout);
}
function median(results, key) {
  const values = results.map(r => r[key]).filter(v => typeof v === 'number').sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : NaN;
}
const fmt = (value, digits = 0) => Number.isNaN(value) ? 'n/a' : value.toFixed(digits);

function main() {
  const runs = Number(process.argv[2] || 3);
  const dir = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'arc-bench-'));
  const repeat = task => Array.from({ length: runs }, () => run(task));
  console.log(`Node ${process.version}, ${os.cpus()[0].model}, median of ${runs}\n`);

  console.log('| Export | Rows | Wall ms | Peak RSS MB | Heap +MB | File MB | Loop p99 ms | Loop max ms |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const kind of ['export', 'reference']) {
    for (const rows of [10_000, 100_000, 1_000_000]) {
      for (const format of ['csv', 'json']) {
        const results = repeat({ kind, rows, format, dir });
        const failed = results.find(r => r.error);
        const label = `${kind === 'export' ? 'streamed' : 'old convert + writeFile'} ${format.toUpperCase()}`;
        if (failed) { console.log(`| ${label} | ${rows} | ${failed.error} ||||||`); continue; }
        console.log(`| ${label} | ${rows} | ${fmt(median(results, 'ms'))} | ${fmt(median(results, 'peakRss'))} | ${fmt(median(results, 'heapDelta'))} | ${fmt(median(results, 'sizeMb'))} | ${fmt(median(results, 'p99'), 1)} | ${fmt(median(results, 'max'), 1)} |`);
      }
    }
  }

  console.log('\n| Two consecutive 1M-row JSON queries | Live heap during 2nd query MB | Retained heap after GC MB | Peak RSS MB |');
  console.log('|---|---:|---:|---:|');
  const response = path.join(dir, 'response.json');
  fs.writeFileSync(response, JSON.stringify({ columns, data: makeRows(1_000_000, false), row_count: 1_000_000 }));
  for (const variant of ['main', 'held', 'released']) {
    const results = repeat({ kind: 'hold', variant, response });
    console.log(`| ${variant} | ${fmt(median(results, 'liveSecond'))} | ${fmt(median(results, 'retained'))} | ${fmt(median(results, 'peakRss'))} |`);
  }

  fs.unlinkSync(response);

  console.log('\n| normalizeCell, 1M rows x 6 columns | normalizeCell ms | CSV encode ms | Share |');
  console.log('|---|---:|---:|---:|');
  for (const nested of [false, true]) {
    const results = repeat({ kind: 'normalize', rows: 1_000_000, nested });
    const n = median(results, 'normalizeMs'), e = median(results, 'encodeMs');
    console.log(`| ${nested ? 'one nested object column' : 'flat'} | ${fmt(n)} | ${fmt(e)} | ${fmt(100 * n / e)}% |`);
  }
}

if (process.argv[2] === '--child') {
  child(JSON.parse(process.argv[3])).catch(error => { console.error(error); process.exit(1); });
} else {
  main();
}
