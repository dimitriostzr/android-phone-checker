// dialogs.test.js — the promise that nothing changes on the phone without a
// native confirmation. The rules behind each dialog are tested in plan.test.js;
// this holds the other half, that every handler in main.js which sends a
// device-changing command opens a dialog at all. A handler that skips the
// dialog is exactly the kind of gap nothing else notices: the button works,
// the phone changes, and nobody was asked.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

// Every ipcMain.handle(...) block, from its first line to its closing `});`,
// with comment lines dropped so a command named in a remark does not count.
function handlers() {
  const out = [];
  const re = /^ipcMain\.handle\('([^']+)'/gm;
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf('\n});', m.index);
    const body = src.slice(m.index, end).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    out.push({ name: m[1], body });
  }
  return out;
}

// The commands the app can send that change the phone (see COMMANDS.md), plus
// the Terminal, which sends whatever was typed.
const WRITES = /pm disable-user|pm enable|settings put|settings delete|cmd appops set|pm grant|pm revoke|deviceidle whitelist|adb_enabled 0|termRun|classifyCommand/;

test('every handler that changes the phone opens a native dialog first', () => {
  const writers = handlers().filter(h => WRITES.test(h.body));
  assert.ok(writers.length >= 8, `found the writing handlers (${writers.length})`);
  for (const h of writers) {
    assert.ok(h.body.includes('dialog.showMessageBox'), `${h.name} asks before it writes`);
  }
});

test('in every dialog, Cancel is the default and the escape button', () => {
  const boxes = src.match(/dialog\.showMessageBox\(win, \{[\s\S]*?\}\);/g) || [];
  assert.ok(boxes.length >= 15, `found the dialogs (${boxes.length})`);
  for (const b of boxes) {
    assert.match(b, /buttons: \['Cancel'/, 'Cancel is the first button');
    assert.match(b, /defaultId: 0/, 'and the default');
    assert.match(b, /cancelId: 0/, 'and what Escape means');
  }
});

// The renderer side of the same promise: once a dialog can be cancelled, a
// cancel must not be reported as the phone refusing. Every place that turns a
// failed single-app enable into a message has to step aside for a cancel first.
test('a cancelled single-app enable is not reported as a failure', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const sites = [...app.matchAll(/enablePackage\(/g)].map(m => app.slice(m.index, m.index + 500));
  assert.ok(sites.length >= 3, `found the call sites (${sites.length})`);
  for (const s of sites) {
    const fail = s.indexOf('could not be switched on');
    if (fail < 0) continue;                       // a site that reports nothing has nothing to get wrong
    const cancel = s.indexOf('cancelled');
    assert.ok(cancel >= 0 && cancel < fail, 'a cancel is checked before a failure is reported');
  }
});
