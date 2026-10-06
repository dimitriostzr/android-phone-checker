// states.test.js — reading how an app is switched off. Android has several
// "off" states and only some of them can be moved over adb, so getting this
// wrong in either direction shows up as a button that does nothing or a button
// that is missing. The phone is the one thing a test cannot have, so the parser
// is exercised against the shapes `dumpsys package packages` actually produces.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEnabledStates } = require('../src/checks');

// What the app greps down to: section headings, package headers, User 0 lines.
const dump = (...lines) => lines.join('\n');

test('it reads the state of each package in the live section', () => {
  const out = parseEnabledStates(dump(
    'Packages:',
    '  Package [com.whatsapp] (a1b2):',
    '    User 0: ceDataInode=1 installed=true hidden=false stopped=false enabled=0 instant=false',
    '  Package [com.temu.androidapp] (c3d4):',
    '    User 0: ceDataInode=2 installed=true hidden=false stopped=false enabled=3 instant=false',
    '  Package [com.example.podcasts] (e5f6):',
    '    User 0: ceDataInode=3 installed=true hidden=false stopped=false enabled=4 instant=false',
  ));
  assert.deepEqual(out, {
    'com.whatsapp': 0,
    'com.temu.androidapp': 3,
    'com.example.podcasts': 4,
  });
});

// The bug this test exists for: an updated system app appears twice, once live
// and once as the system entry it replaced, each with its own enabled=. Reading
// the second overwrites the first and the app wears a state it is not in.
test('a pre-update entry never overwrites the state in force', () => {
  const out = parseEnabledStates(dump(
    'Packages:',
    '  Package [com.sec.android.app.samsungapps] (new):',
    '    User 0: ceDataInode=2 installed=true enabled=1 instant=false',
    'Hidden system packages:',
    '  Package [com.sec.android.app.samsungapps] (old):',
    '    User 0: ceDataInode=9 installed=true enabled=2 instant=false',
  ));
  assert.equal(out['com.sec.android.app.samsungapps'], 1,
    'the hidden pre-update entry won, so an updated app reports the wrong state');
});

test('sections after the package list contribute nothing', () => {
  for (const section of ['Hidden system packages', 'Queries', 'Shared users', 'Package Changes']) {
    const out = parseEnabledStates(dump(
      'Packages:',
      '  Package [com.a] (x):',
      '    User 0: enabled=0',
      `${section}:`,
      '  Package [com.b] (y):',
      '    User 0: enabled=2',
    ));
    assert.deepEqual(out, { 'com.a': 0 }, `${section} leaked into the states`);
  }
});

test('only the phone owner is read, not a work profile or Secure Folder', () => {
  const out = parseEnabledStates(dump(
    'Packages:',
    '  Package [com.a] (x):',
    '    User 0: ceDataInode=1 installed=true enabled=0 instant=false',
    '    User 10: ceDataInode=2 installed=true enabled=3 instant=false',
    '    User 150: ceDataInode=3 installed=true enabled=2 instant=false',
  ));
  assert.equal(out['com.a'], 0, 'another user\'s state was read as the phone\'s');
});

test('a package with no User 0 line is left unknown rather than guessed', () => {
  const out = parseEnabledStates(dump(
    'Packages:',
    '  Package [com.a] (x):',
    '    User 10: enabled=3',
    '  Package [com.b] (y):',
    '    User 0: enabled=4',
  ));
  assert.equal('com.a' in out, false, 'a package was given a state it never reported');
  assert.equal(out['com.b'], 4);
});

// An empty or unrecognised dump must produce nothing rather than something
// wrong: the UI treats an unknown state as movable, which is how it behaved
// before any of this was read, so a bad read degrades instead of breaking.
test('an unreadable dump yields no states at all', () => {
  for (const bad of ['', null, undefined, 'error: device offline', 'Packages:']) {
    assert.deepEqual(parseEnabledStates(bad), {}, `parsed something out of ${JSON.stringify(bad)}`);
  }
});

test('it survives the indentation and field order varying', () => {
  const out = parseEnabledStates(dump(
    'Packages:',
    '    Package [com.a] (x):',
    '      User 0: enabled=2 ceDataInode=1 installed=true',
    '  Package [com.b] (y):',
    '        User 0: installed=true enabled=3',
  ));
  assert.deepEqual(out, { 'com.a': 2, 'com.b': 3 });
});
