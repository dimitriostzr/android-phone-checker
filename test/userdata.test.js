// userdata.test.js — moving the store when the app is renamed. This code runs
// once, on somebody's machine, over directories holding the only record of what
// the app has changed on their phone. The failure that matters is not losing
// data but taking someone else's: every unpackaged Electron app shares the name
// "Electron", so the directory it moves from can belong to another project.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planStoreMove, moveStore, OURS } = require('../src/userdata');

function tmp(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-userdata-'));
  for (const [rel, body] of Object.entries(layout)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return root;
}
const has = (root, rel) => fs.existsSync(path.join(root, rel));

test('it carries the store across to the new name', () => {
  const from = tmp({ 'devices/R5.json': '{"disabledByApp":["com.a"]}', 'snapshots/R5/x.json': '{}', 'logs/adb.log': 'x' });
  const to = path.join(os.tmpdir(), 'pc-to-' + Date.now());
  const moved = moveStore(fs, from, to);
  assert.deepEqual(moved.sort(), [...OURS].sort());
  assert.equal(fs.readFileSync(path.join(to, 'devices/R5.json'), 'utf8'), '{"disabledByApp":["com.a"]}');
  assert.ok(has(to, 'snapshots/R5/x.json') && has(to, 'logs/adb.log'));
});

// The important one. ~/Library/Application Support/Electron is shared by every
// unpackaged Electron app, so without proof the directory is ours we would be
// helping ourselves to another project's data.
test('it leaves a stranger\'s Electron directory alone', () => {
  const from = tmp({ 'logs/other.log': 'not ours', 'Cookies': 'x', 'Local Storage/leveldb/1.log': 'x' });
  const to = path.join(os.tmpdir(), 'pc-to2-' + Date.now());
  assert.deepEqual(planStoreMove(fs, from, to), [], 'it claimed a directory with no devices/ in it');
  assert.deepEqual(moveStore(fs, from, to), []);
  assert.ok(has(from, 'logs/other.log'), 'it took the other project\'s logs');
  assert.equal(fs.existsSync(to), false, 'it created a store out of nothing');
});

test('it never overwrites what the new name has already saved', () => {
  const from = tmp({ 'devices/R5.json': 'old', 'logs/adb.log': 'old' });
  const to = tmp({ 'devices/R5.json': 'new' });
  const moved = moveStore(fs, from, to);
  assert.equal(fs.readFileSync(path.join(to, 'devices/R5.json'), 'utf8'), 'new', 'the newer store was overwritten');
  assert.deepEqual(moved, ['logs'], 'it should still bring across what the new location lacks');
  assert.ok(has(from, 'devices/R5.json'), 'the original was removed despite not being moved');
});

test('it moves nothing when there is nothing to move', () => {
  const to = path.join(os.tmpdir(), 'pc-to3-' + Date.now());
  assert.deepEqual(planStoreMove(fs, path.join(os.tmpdir(), 'pc-missing-' + Date.now()), to), []);
  const same = tmp({ 'devices/R5.json': '{}' });
  assert.deepEqual(planStoreMove(fs, same, same), [], 'it tried to move a directory onto itself');
  assert.deepEqual(planStoreMove(fs, '', to), []);
});

test('it only ever touches the three directories this app writes', () => {
  assert.deepEqual(OURS, ['devices', 'snapshots', 'logs']);
  const from = tmp({ 'devices/R5.json': '{}', 'Cookies': 'x', 'GPUCache/data': 'x', 'Preferences': 'x' });
  const to = path.join(os.tmpdir(), 'pc-to4-' + Date.now());
  moveStore(fs, from, to);
  for (const stray of ['Cookies', 'GPUCache/data', 'Preferences']) {
    assert.ok(has(from, stray), `${stray} was moved and it is not ours`);
    assert.equal(has(to, stray), false, `${stray} turned up in the new store`);
  }
});
