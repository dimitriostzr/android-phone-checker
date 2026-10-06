// Tests for the knowledge base and device profiles — the data every check and
// proposal is built on. Runs with Node's built-in runner: npm test.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { forDevice, KB, COMMANDS, commandLibrary } = require('../src/profiles');

const TIERS = new Set(['recommended', 'optional', 'caution', 'keep']);

test('every knowledge-base entry is complete and well-formed', () => {
  for (const [pkg, info] of Object.entries(KB)) {
    assert.match(pkg, /^[a-z][\w.]+$/i, `${pkg} looks like a package id`);
    assert.ok(info.name && typeof info.name === 'string', `${pkg} has a name`);
    assert.ok(info.desc && info.desc.length > 10, `${pkg} has a real description`);
    assert.ok(TIERS.has(info.tier), `${pkg} tier "${info.tier}" is valid`);
  }
});

test('samsung devices get the samsung-gated profile', () => {
  const p = forDevice('samsung');
  assert.equal(p.samsung, true);
  assert.ok(p.tripwires.length > 0, 'preload tripwires present');
  assert.ok(p.settingsBaseline.some(s => s.samsung), 'samsung-gated settings included');
});

test('unmatched vendors get a neutral profile with only global tripwires', () => {
  const p = forDevice('Google');
  assert.equal(p.samsung, false);
  assert.equal(p.storePkg, null, 'no vendor store package');
  assert.ok(!p.tripwires.includes('com.einnovation.temu'), 'no vendor-specific tripwires');
  assert.ok(p.tripwires.some(t => t.includes('appcloud') || t.includes('aura')),
    'cross-manufacturer partner-installer tripwires still checked');
  assert.ok(!p.settingsBaseline.some(s => s.samsung), 'gated settings excluded');
  assert.ok(p.settingsBaseline.length > 0, 'baseline still present');
});

test('every vendor profile has a store package that is a trusted installer', () => {
  for (const mfr of ['samsung', 'Xiaomi', 'OPPO', 'vivo', 'TECNO', 'HUAWEI', 'OnePlus', 'realme', 'POCO']) {
    const p = forDevice(mfr);
    assert.ok(p.storePkg, `${mfr} resolves to a vendor profile`);
    assert.ok(p.trustedInstallers.includes(p.storePkg), `${mfr} store is a trusted installer`);
    assert.equal(p.samsung, /samsung/i.test(mfr), `${mfr}: samsung flag correct`);
  }
});

test('settings baseline entries are well-formed', () => {
  const NS = new Set(['global', 'secure', 'system']);
  const CATS = new Set(['privacy', 'security', 'leanness']);
  for (const s of forDevice('samsung').settingsBaseline) {
    assert.ok(NS.has(s.ns), `${s.key}: namespace "${s.ns}"`);
    assert.ok(CATS.has(s.cat), `${s.key}: category "${s.cat}"`);
    assert.ok(typeof s.want === 'string' && s.want.length, `${s.key}: target value`);
    assert.ok(s.desc && s.desc.length > 5, `${s.key}: description`);
  }
});

test('no duplicate keys in the settings baseline', () => {
  const keys = forDevice('samsung').settingsBaseline.map(s => `${s.ns}/${s.key}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('stalkerware set and trusted installers are sane', () => {
  const p = forDevice('');
  assert.ok(p.stalkerware.length >= 5, 'embedded stalkerware set present');
  assert.ok(p.trustedInstallers.includes('com.android.vending'), 'Play Store trusted');
  for (const list of [p.stalkerware, p.trustedInstallers]) {
    assert.equal(new Set(list).size, list.length, 'no duplicates');
  }
});

test('keep-tier packages are never listed as tripwires', () => {
  for (const t of forDevice('samsung').tripwires) {
    assert.notEqual(KB[t] && KB[t].tier, 'keep', `${t} must not be keep-tier`);
  }
});

test('device-facing modules load without Electron', () => {
  assert.equal(typeof require('../src/adb').deviceSummary, 'function');
  assert.equal(typeof require('../src/checks').runChecks, 'function');
});

test('every pre-built terminal command is complete and well-formed', () => {
  const seen = new Set();
  for (const cat of COMMANDS) {
    assert.match(cat.id, /^[a-z]+$/, `category id ${cat.id}`);
    assert.ok(cat.title && cat.hint && cat.hint.length > 20, `${cat.id} has a title and a real hint`);
    assert.ok(cat.items.length, `${cat.id} has commands`);
    for (const it of cat.items) {
      assert.ok(it.label && it.label.length > 3, `${it.cmd} has a label`);
      assert.ok(it.desc && it.desc.length > 20, `${it.cmd} explains itself`);
      assert.ok(!seen.has(it.cmd), `${it.cmd} appears only once`);
      seen.add(it.cmd);
      // A command with a blank in it must say what the blank is, or the prompt
      // cannot tell the user what to fill in.
      const ph = it.cmd.match(/\{[a-z_]+\}/gi) || [];
      if (ph.some(p => p !== '{store}')) assert.ok(it.arg, `${it.cmd} names its placeholder`);
      if (it.cmd.includes('{store}')) assert.equal(it.needsStore, true, `${it.cmd} is gated on a vendor store`);
    }
  }
});

test('vendor gating drops terminal commands that cannot apply to this phone', () => {
  const samsung = commandLibrary('samsung').flatMap(c => c.items);
  const pixel = commandLibrary('Google').flatMap(c => c.items);
  assert.ok(samsung.some(i => /warranty_bit/.test(i.cmd)), 'vendor-gated entry present on that vendor');
  assert.ok(!pixel.some(i => /warranty_bit/.test(i.cmd)), 'vendor-gated entry absent elsewhere');
  assert.ok(samsung.some(i => i.cmd.includes('com.sec.android.app.samsungapps')), '{store} resolved');
  for (const it of [...samsung, ...pixel]) assert.ok(!it.cmd.includes('{store}'), `no unresolved placeholder: ${it.cmd}`);
});
