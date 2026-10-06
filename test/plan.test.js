// plan.test.js — the confirmation rules. These are the decisions that stand between
// a click and a command running on someone's phone: what is refused outright, what
// runs, what has to be confirmed a second time, and what a "skip the risky ones"
// answer actually leaves behind. main.js shows the dialogs; every rule they enforce
// is here.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const plan = require('../src/plan');
const { PERM_GROUPS, SPECIAL_OPS } = require('../src/checks');

const KB = {
  'com.ok.one': { name: 'Safe one', tier: 'recommended', desc: 'Ads.' },
  'com.ok.two': { name: 'Safe two', tier: 'optional', desc: 'A feature some people use.' },
  'com.care.one': { name: 'Careful', tier: 'caution', desc: 'Breaks a thing you may want.' },
  'com.keep.one': { name: 'Keep me', tier: 'keep', desc: 'Known to break the phone.' },
};

// ---------- disabling packages ----------

test('keep-tier packages are refused, never queued for a dialog', () => {
  const r = plan.planDisable({ pkgs: ['com.ok.one', 'com.keep.one'], kb: KB, thirdParty: [] });
  assert.match(r.error, /keep-tier/);
  assert.match(r.error, /com\.keep\.one/);
  assert.equal(r.items, undefined, 'a refusal must not also produce a runnable plan');
});

test('an invalid package name is refused before anything reaches a shell command', () => {
  for (const bad of ['com.ok.one; rm -rf /', '$(id)', '../etc/passwd', '', '1com.digit.start', 'a'.repeat(300)]) {
    const r = plan.planDisable({ pkgs: [bad], kb: KB, thirdParty: [] });
    assert.match(r.error, /Invalid package name/, `accepted ${JSON.stringify(bad)}`);
  }
});

test('a valid package name is accepted whether or not the knowledge base knows it', () => {
  const r = plan.planDisable({ pkgs: ['com.ok.one', 'com.unknown.app'], kb: KB, thirdParty: ['com.unknown.app'] });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.items, ['com.ok.one', 'com.unknown.app']);
});

test('nothing selected is refused rather than shown as a "disable 0 packages" dialog', () => {
  assert.match(plan.planDisable({ pkgs: [], kb: KB }).error, /Nothing selected/);
  assert.match(plan.planDisable({ pkgs: null, kb: KB }).error, /Nothing selected/);
});

test('recommended and optional tiers need one confirmation, not two', () => {
  const r = plan.planDisable({ pkgs: ['com.ok.one', 'com.ok.two'], kb: KB, thirdParty: [] });
  assert.deepEqual(r.risky, []);
  assert.equal(r.needsSecond, false);
});

test('a caution-tier package triggers the second confirmation and explains itself', () => {
  const r = plan.planDisable({ pkgs: ['com.ok.one', 'com.care.one'], kb: KB, thirdParty: [] });
  assert.deepEqual(r.risky, ['com.care.one']);
  assert.equal(r.needsSecond, true);
  assert.match(r.why['com.care.one'], /Careful: Breaks a thing you may want\./);
});

test('an unknown system package is risky; the same name installed by the user is not', () => {
  const asSystem = plan.planDisable({ pkgs: ['com.mystery.app'], kb: KB, thirdParty: [] });
  assert.deepEqual(asSystem.risky, ['com.mystery.app']);
  assert.match(asSystem.why['com.mystery.app'], /not in the knowledge base/);

  const asUserApp = plan.planDisable({ pkgs: ['com.mystery.app'], kb: KB, thirdParty: ['com.mystery.app'] });
  assert.deepEqual(asUserApp.risky, []);
  assert.equal(asUserApp.needsSecond, false);
});

// ---------- the second confirmation, for every view that shows one ----------

test('cancelling the second confirmation runs nothing at all', () => {
  const items = ['a', 'b', 'c'];
  const r = plan.resolveSecond(items, ['c'], plan.SECOND.CANCEL);
  assert.equal(r.cancelled, true);
  assert.equal(r.items, undefined);
});

test('an unrecognised answer is treated as a cancel, never as consent', () => {
  for (const answer of [-1, 3, undefined, null, NaN]) {
    assert.equal(plan.resolveSecond(['a'], ['a'], answer).cancelled, true, `answer ${answer} ran something`);
  }
});

test('"skip the risky ones" keeps the safe items and drops exactly the flagged ones', () => {
  const r = plan.resolveSecond(['a', 'b', 'c'], ['b'], plan.SECOND.SKIP);
  assert.deepEqual(r.items, ['a', 'c']);
});

test('"skip" when everything was risky cancels instead of running an empty batch', () => {
  const r = plan.resolveSecond(['a', 'b'], ['a', 'b'], plan.SECOND.SKIP);
  assert.equal(r.cancelled, true);
});

test('"do them too" keeps every item, risky ones included', () => {
  const r = plan.resolveSecond(['a', 'b', 'c'], ['b'], plan.SECOND.ALL);
  assert.deepEqual(r.items, ['a', 'b', 'c']);
});

// ---------- battery states ----------

test('an unknown battery mode is refused', () => {
  assert.match(plan.planBattery({ pkgs: ['com.ok.one'], mode: 'turbo' }).error, /Unknown battery mode/);
});

test('restricting a system app asks twice; restricting a user app asks once', () => {
  const sys = plan.planBattery({ pkgs: ['com.sys.app'], mode: 'restricted', thirdParty: [] });
  assert.deepEqual(sys.system, ['com.sys.app']);
  assert.equal(sys.needsSecond, true);

  const user = plan.planBattery({ pkgs: ['com.user.app'], mode: 'restricted', thirdParty: ['com.user.app'] });
  assert.deepEqual(user.system, []);
  assert.equal(user.needsSecond, false);
});

test('the loosening modes never ask twice, even for system apps', () => {
  for (const mode of ['optimized', 'unrestricted']) {
    const r = plan.planBattery({ pkgs: ['com.sys.app'], mode, thirdParty: [] });
    assert.equal(r.needsSecond, false, `${mode} asked twice`);
    assert.deepEqual(r.system, ['com.sys.app'], 'the app is still labelled SYSTEM in the first dialog');
  }
});

test('battery plans validate package names too', () => {
  assert.match(plan.planBattery({ pkgs: ['com.ok; reboot'], mode: 'restricted' }).error, /Invalid package name/);
});

test('the undo record is the state the app was in before, not the one being applied', () => {
  const prev = { restricted: new Set(['com.r']), unrestricted: new Set(['com.u']) };
  assert.equal(plan.batteryPrevMode(prev, 'com.r'), 'restricted');
  assert.equal(plan.batteryPrevMode(prev, 'com.u'), 'unrestricted');
  assert.equal(plan.batteryPrevMode(prev, 'com.neither'), 'optimized');
});

// ---------- phone settings ----------

const BASELINE = [
  { key: 'plain_one', ns: 'global', want: '0', desc: 'A plain one.' },
  { key: 'plain_two', ns: 'secure', want: '1', desc: 'Another plain one.' },
  { key: 'tradeoff_one', ns: 'global', want: '0', desc: 'Has a cost.', warn: 'Breaks a feature you may use.' },
];

test('only the selected settings are planned, and unknown keys are ignored', () => {
  const r = plan.planSettings({ keys: ['plain_one', 'not_a_setting'], baseline: BASELINE });
  assert.deepEqual(r.items.map(s => s.key), ['plain_one']);
});

test('a trade-off setting triggers the second confirmation; plain ones do not', () => {
  assert.equal(plan.planSettings({ keys: ['plain_one', 'plain_two'], baseline: BASELINE }).needsSecond, false);
  const r = plan.planSettings({ keys: ['plain_one', 'tradeoff_one'], baseline: BASELINE });
  assert.equal(r.needsSecond, true);
  assert.deepEqual(r.warns.map(s => s.key), ['tradeoff_one']);
});

test('skipping the trade-off settings leaves the plain ones to apply', () => {
  const r = plan.planSettings({ keys: ['plain_one', 'tradeoff_one'], baseline: BASELINE });
  const kept = plan.resolveSecond(r.items, r.warns, plan.SECOND.SKIP);
  assert.deepEqual(kept.items.map(s => s.key), ['plain_one']);
});

test('a settings undo record is only restored when all three parts are still safe to splice', () => {
  assert.deepEqual(plan.restorableSetting({ ns: 'global', key: 'a_key', prev: '1' }), { ok: true, unset: false });
  assert.deepEqual(plan.restorableSetting({ ns: 'secure', key: 'a_key', prev: 'null' }), { ok: true, unset: true });
  assert.deepEqual(plan.restorableSetting({ ns: 'secure', key: 'a_key', prev: '' }), { ok: true, unset: true });
  assert.equal(plan.restorableSetting({ ns: 'evil; id', key: 'a_key', prev: '1' }).ok, false);
  assert.equal(plan.restorableSetting({ ns: 'global', key: 'a key', prev: '1' }).ok, false);
  assert.equal(plan.restorableSetting({ ns: 'global', key: 'a_key', prev: '1; reboot' }).ok, false);
  assert.equal(plan.restorableSetting({ ns: undefined, key: undefined, prev: undefined }).ok, false);
});

// ---------- permissions ----------

const camera = { pkgs: [{ pkg: 'com.user.app', perms: ['android.permission.CAMERA'] }] };

test('an unknown permission group or action is refused', () => {
  assert.match(plan.planPerms({ groupId: 'nope', mode: 'revoke', items: camera.pkgs, permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS }).error, /Unknown permission group/);
  assert.match(plan.planPerms({ groupId: 'camera', mode: 'nuke', items: camera.pkgs, permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS }).error, /Unknown action/);
});

test('a permission outside the selected group is dropped, not passed through to pm', () => {
  const r = plan.planPerms({
    groupId: 'camera', mode: 'revoke',
    items: [{ pkg: 'com.user.app', perms: ['android.permission.CAMERA', 'android.permission.READ_SMS'] }],
    permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS, thirdParty: ['com.user.app'],
  });
  assert.deepEqual(r.items, [{ pkg: 'com.user.app', perms: ['android.permission.CAMERA'] }]);
});

test('a package left with no in-group permission is dropped, and an empty plan is refused', () => {
  const r = plan.planPerms({
    groupId: 'camera', mode: 'revoke',
    items: [{ pkg: 'com.user.app', perms: ['android.permission.READ_SMS'] }],
    permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS, thirdParty: ['com.user.app'],
  });
  assert.match(r.error, /Nothing to change/);
});

test('an item with no perms listed takes the whole group', () => {
  const r = plan.planPerms({
    groupId: 'sms', mode: 'revoke', items: [{ pkg: 'com.user.app' }],
    permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS, thirdParty: ['com.user.app'],
  });
  assert.deepEqual(r.items[0].perms, PERM_GROUPS.find(g => g.id === 'sms').perms);
});

test('revoking from a system app asks twice; revoking from a user app asks once', () => {
  const sys = plan.planPerms({
    groupId: 'camera', mode: 'revoke', items: [{ pkg: 'com.sys.app', perms: ['android.permission.CAMERA'] }],
    permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS, thirdParty: [],
  });
  assert.equal(sys.needsSecond, true);
  assert.deepEqual(sys.systemApps.map(p => p.pkg), ['com.sys.app']);

  const user = plan.planPerms({
    groupId: 'camera', mode: 'revoke', items: camera.pkgs,
    permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS, thirdParty: ['com.user.app'],
  });
  assert.equal(user.needsSecond, false);
});

test('giving a permission back never asks twice, even for a system app', () => {
  const r = plan.planPerms({
    groupId: 'camera', mode: 'grant', items: [{ pkg: 'com.sys.app', perms: ['android.permission.CAMERA'] }],
    permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS, thirdParty: [],
  });
  assert.equal(r.revoking, false);
  assert.equal(r.needsSecond, false);
});

test('"ask each time" and "don\'t allow" are both revokes and both ask twice for system apps', () => {
  for (const mode of ['ask', 'deny', 'revoke']) {
    const r = plan.planPerms({
      groupId: 'camera', mode, items: [{ pkg: 'com.sys.app', perms: ['android.permission.CAMERA'] }],
      permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS, thirdParty: [],
    });
    assert.equal(r.revoking, true, `${mode} was not treated as a revoke`);
    assert.equal(r.needsSecond, true, `${mode} did not ask twice`);
  }
});

test('skipping the system apps leaves the user apps to change', () => {
  const r = plan.planPerms({
    groupId: 'camera', mode: 'revoke',
    items: [{ pkg: 'com.sys.app', perms: ['android.permission.CAMERA'] }, { pkg: 'com.user.app', perms: ['android.permission.CAMERA'] }],
    permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS, thirdParty: ['com.user.app'],
  });
  const kept = plan.resolveSecond(r.items, r.systemApps, plan.SECOND.SKIP);
  assert.deepEqual(kept.items.map(p => p.pkg), ['com.user.app']);
});

test('a special-access group is planned as an app-op, with no runtime permissions', () => {
  const r = plan.planPerms({
    groupId: 'install', mode: 'deny', items: [{ pkg: 'com.user.app' }],
    permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS, thirdParty: ['com.user.app'],
  });
  assert.equal(r.isOp, true);
  assert.equal(r.group.op, 'REQUEST_INSTALL_PACKAGES');
  assert.deepEqual(r.items, [{ pkg: 'com.user.app', perms: [] }]);
});

test('every shipped permission group and special op produces a usable plan', () => {
  for (const g of [...PERM_GROUPS, ...SPECIAL_OPS]) {
    const r = plan.planPerms({
      groupId: g.id, mode: 'revoke', items: [{ pkg: 'com.user.app' }],
      permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS, thirdParty: ['com.user.app'],
    });
    assert.equal(r.error, undefined, `${g.id}: ${r.error}`);
    assert.ok(r.items.length, `${g.id} produced nothing to do`);
  }
});

test('a permission undo record is only restored when its names are still well-formed', () => {
  assert.equal(plan.restorablePerm({ kind: 'runtime', pkg: 'com.a.b', perm: 'android.permission.CAMERA' }), true);
  assert.equal(plan.restorablePerm({ kind: 'op', pkg: 'com.a.b', op: 'REQUEST_INSTALL_PACKAGES' }), true);
  assert.equal(plan.restorablePerm({ kind: 'op', pkg: 'com.a.b', op: 'evil; id' }), false);
  assert.equal(plan.restorablePerm({ kind: 'runtime', pkg: 'com.a.b; id', perm: 'android.permission.CAMERA' }), false);
  assert.equal(plan.restorablePerm({ kind: 'runtime', pkg: 'com.a.b', perm: 'CAM ERA' }), false);
  assert.equal(plan.restorablePerm({ kind: 'mystery', pkg: 'com.a.b' }), false);
  assert.equal(plan.restorablePerm(null), false);
});

// ---------- terminal ----------

test('read-only commands run straight away, writes ask once, destructive ask twice', () => {
  assert.equal(plan.confirmationsFor('read'), 0);
  assert.equal(plan.confirmationsFor('write'), 1);
  assert.equal(plan.confirmationsFor('destructive'), 2);
});

test('an unrecognised tier is treated as a write, never as read-only', () => {
  for (const tier of ['unknown', undefined, null, '']) {
    assert.equal(plan.confirmationsFor(tier), 1, `tier ${tier} skipped the confirmation`);
  }
});
