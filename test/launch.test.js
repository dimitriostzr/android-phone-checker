// Guards the launch path. Some editor terminals (VS Code and anything built on
// it) export ELECTRON_RUN_AS_NODE=1; with that set the electron binary runs as
// plain Node, so no window opens and the app exits at once with a TypeError
// that reads like a crash. `npm start` must clear it, and running the app as
// Node anyway must explain itself instead of throwing.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('npm start goes through the launcher, not the electron binary directly', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.start, 'node scripts/start.js');
  assert.ok(pkg.build.files.includes('scripts/**/*'), 'the launcher ships with the build');
});

test('the launcher clears ELECTRON_RUN_AS_NODE before spawning the app', () => {
  const src = read('scripts/start.js');
  assert.match(src, /delete env\.ELECTRON_RUN_AS_NODE/);
  assert.match(src, /spawn\(electron, \['\.'/, 'it launches this project');
  assert.match(src, /stdio: 'inherit'/, 'output still reaches the terminal');
});

test('run as plain Node, the app explains itself instead of throwing', () => {
  const src = read('src/main.js');
  const guard = src.indexOf('if (!app || !BrowserWindow)');
  assert.ok(guard > 0, 'the guard exists');
  assert.ok(guard < src.indexOf('app.on('), 'it runs before the first use of the Electron app object');
  assert.match(src.slice(guard, guard + 700), /ELECTRON_RUN_AS_NODE/);
});

test('crashes and window errors are written to the daily log', () => {
  const src = read('src/main.js');
  for (const hook of ['render-process-gone', 'unresponsive', 'uncaughtException', 'unhandledRejection', 'child-process-gone']) {
    assert.ok(src.includes(hook), `${hook} is recorded`);
  }
});
