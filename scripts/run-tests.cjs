const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

// Explicit files work on Node 20 and 24, including Windows shells. Limit
// discovery to *.test.js so stale output from the old runTest.ts is ignored.
function testsIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? testsIn(path) : entry.name.endsWith('.test.js') ? [path] : [];
  });
}
const files = testsIn(join(__dirname, '..', 'out', 'test')).sort();
if (files.length === 0) {
  throw new Error('No compiled test files found. Run npm run compile first.');
}
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) { throw result.error; }
process.exitCode = result.status ?? 1;
