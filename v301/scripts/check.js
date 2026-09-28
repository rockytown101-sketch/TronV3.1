const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
const required = [
  'package.json',
  'src/main.js',
  'src/preload.js',
  'src/index.html',
  'src/app.js',
  'src/styles.css',
  '.github/workflows/build.yml'
];

for (const file of required) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) throw new Error(`Missing required file: ${file}`);
}

const pkg = require(path.join(root, 'package.json'));
if (pkg.version !== '3.0.1') throw new Error(`Unexpected version: ${pkg.version}`);
if (!pkg.scripts['dist:win'] || !pkg.scripts['dist:mac']) throw new Error('Missing build scripts');

for (const file of ['src/main.js','src/preload.js','src/app.js','scripts/check.js']) {
  cp.execFileSync(process.execPath, ['--check', path.join(root, file)], {stdio:'inherit'});
}

console.log('TRON Permission Control v3.0.1 checks passed.');
