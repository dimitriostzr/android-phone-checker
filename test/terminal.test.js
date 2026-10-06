// Tests for the terminal's command parser and safety classifier — the gate that
// decides whether a command runs straight away or has to be confirmed first.
// Getting this wrong in the "read" direction would let a device-changing command
// through without asking, so the read-only cases are pinned down here.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand, classify } = require('../src/terminal');
const { commandLibrary } = require('../src/profiles');

const tier = (cmd) => classify(cmd).tier;

test('a bare command is sent to the phone shell; "adb ..." is not', () => {
  assert.deepEqual(parseCommand('pm list packages').argv, ['shell', 'pm list packages']);
  assert.deepEqual(parseCommand('adb devices -l').argv, ['devices', '-l']);
  // "adb shell x" and plain "x" are the same thing, and a pasted line may be quoted.
  assert.deepEqual(parseCommand('adb shell pm list packages').argv, ['shell', 'pm list packages']);
  assert.deepEqual(parseCommand('adb shell "pm list packages"').argv, ['shell', 'pm list packages']);
});

test('empty, oversized, unfilled and control-character input is refused', () => {
  assert.ok(parseCommand('   ').error);
  assert.ok(parseCommand('a'.repeat(4001)).error);
  assert.ok(parseCommand('adb').error);
  assert.match(parseCommand('dumpsys package {pkg}').error, /\{pkg\}/);
  assert.ok(parseCommand(`getprop${String.fromCharCode(7)}`).error);
});

test('queries are read-only, including piped and quoted ones', () => {
  for (const c of [
    'getprop',
    'pm list packages -3',
    'settings get global adb_enabled',
    'dumpsys package packages',
    'dumpsys deviceidle whitelist',
    'cmd appops query-op CAMERA allow',
    'wm size; wm density',
    'du -sh /sdcard/* 2>/dev/null | sort -h | tail -20',
    "logcat -d -t 500 | grep -iE 'packagemanager|installer'",
    'ps -A -o PID,USER,NAME | head -40',
    'adb devices -l',
    'adb get-state',
  ]) assert.equal(tier(c), 'read', c);
});

test('a pipe or semicolon inside quotes does not split the command', () => {
  // Naive splitting would leave a fragment starting with "installer'" and
  // misclassify this harmless read as something that needs confirming.
  assert.equal(tier("logcat -d | grep -E 'a|b;c'"), 'read');
});

test('commands that change the phone are not read-only', () => {
  for (const c of [
    'settings put global adb_enabled 0',
    'pm disable-user --user 0 com.foo',
    'cmd appops set com.foo RUN_ANY_IN_BACKGROUND ignore',
    'dumpsys deviceidle whitelist +com.foo',
    'dumpsys battery set level 5',
    'am start -a android.intent.action.VIEW',
    'logcat -c',
    'wm size 1080x2400',
    'input tap 100 100',
    'cat /proc/meminfo > /sdcard/out.txt',
    'sed -i s/a/b/ /sdcard/f',
    'find /sdcard -name x -delete',
    'adb pull /sdcard/a .',
    'adb bugreport',
  ]) assert.notEqual(tier(c), 'read', c);
});

test('an unknown command falls back to needing confirmation', () => {
  assert.equal(tier('totally-unknown-binary --go'), 'write');
  assert.equal(tier('getprop | totally-unknown-binary'), 'write');
  // A nested sub-command hides what actually runs, so it can never be "read".
  assert.equal(tier('echo $(rm -rf /sdcard)'), 'write');
  assert.equal(tier('echo `id`'), 'write');
});

test('destructive commands are flagged as destructive, not merely as writes', () => {
  for (const c of [
    'pm uninstall com.foo',
    'pm clear com.foo',
    'rm -rf /sdcard/DCIM',
    'adb reboot',
    'adb uninstall com.foo',
    'adb install app.apk',
    'settings delete global http_proxy',
    'pm grant com.foo android.permission.CAMERA',
    'am broadcast -a android.intent.action.MASTER_CLEAR',
  ]) assert.equal(tier(c), 'destructive', c);
});

test('every pre-built library command is read-only on every vendor profile', () => {
  for (const mfr of ['samsung', 'Google', 'Xiaomi', 'OPPO', 'HUAWEI', '']) {
    for (const cat of commandLibrary(mfr)) {
      for (const it of cat.items) {
        const probe = it.cmd.replace(/\{[a-z_]+\}/gi, 'com.example.app');
        assert.equal(tier(probe), 'read', `${mfr || 'unknown vendor'}: ${it.cmd}`);
      }
    }
  }
});

test('classification always yields a user-facing reason', () => {
  for (const c of ['getprop', 'pm uninstall com.foo', 'nonsense', '']) {
    const r = classify(c);
    assert.ok(['read', 'write', 'destructive'].includes(r.tier), c);
    assert.ok(r.reason && r.reason.length > 5, c);
  }
});
