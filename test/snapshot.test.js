// Tests for Save state: building a snapshot from raw command output and
// comparing two of them, the way a before/after-update check does.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build, diff, summary, parseSettingsList, isNoisy, originOfAdded } = require('../src/snapshot');

const props = (patch, build) => `[ro.build.display.id]: [${build}]\n[ro.build.version.release]: [16]\n[ro.build.version.security_patch]: [${patch}]\n[ro.build.fingerprint]: [brand/dev:16/${build}:user/release-keys]\n[ro.boot.verifiedbootstate]: [green]\n`;
const pkg = (name, { sys = false, upd = false, v = '1.0', vc = 1, en = 0, inst = true, by = 'com.android.vending', perms = [] } = {}) =>
  `  Package [${name}] (x):\n    codePath=${sys ? '/system/app/X' : '/data/app/~~x==/y=='}\n    versionCode=${vc} minSdk=26 targetSdk=35\n    versionName=${v}\n    flags=[ ${sys ? 'SYSTEM ' : ''}HAS_CODE${upd ? ' UPDATED_SYSTEM_APP' : ''} ]\n    lastUpdateTime=2026-06-01 09:00:00\n${by ? `    installerPackageName=${by}\n    initiatingPackageName=${by}\n` : ''}${perms.map(p => `      ${p}: granted=true`).join('\n')}\n    User 0: ceDataInode=1 installed=${inst} hidden=false stopped=false notLaunched=false enabled=${en} instant=false\n      installReason=4\n      firstInstallTime=2026-05-01 10:00:00\n`;

function snap(label, opts = {}) {
  const dump = 'Packages:\n' + (opts.packages || []).join('') + '\nHidden system packages:\n';
  return build({
    ts: opts.ts || '2026-09-01T10:00:00.000Z', label,
    device: { serial: 'S1', model: 'M', manufacturer: 'Brand' },
    props: props(opts.patch || '2026-07-05', opts.build || 'BUILD1'), kernel: '6.6.0\n',
    packagesDump: dump,
    settings: { global: opts.global || 'a=1\nboot_count=5\nadb_enabled=1', secure: opts.secure || 'x=y', system: 'volume=3' },
    accessibility: opts.accessibility || 'com.reader/.S:', listeners: '', devicePolicy: opts.dp || '',
    battery: { restricted: opts.restricted || [], unrestricted: [] },
  });
}

test('build: identity, packages, settings, surfaces and battery are captured compactly', () => {
  const s = snap('before', { packages: [pkg('com.a', { perms: ['android.permission.CAMERA', 'android.permission.INTERNET'] }), pkg('com.sys', { sys: true, by: null })] });
  assert.equal(s.identity['Build'], 'BUILD1');
  assert.equal(s.identity['Security patch'], '2026-07-05');
  assert.equal(s.identity['Kernel'], '6.6.0');
  assert.deepEqual(s.packages['com.a'].perms, ['android.permission.CAMERA'], 'only sensitive grants are kept');
  assert.equal(s.packages['com.sys'].sys, 1);
  assert.equal(s.packages['com.sys'].by, null);
  assert.equal(s.settings.global.boot_count, '5');
  assert.deepEqual(s.surfaces.accessibility, ['com.reader']);
  const sum = summary(s, 'id1');
  assert.equal(sum.counts.packages, 2);
  assert.equal(sum.counts.user, 1);
  assert.equal(sum.build, 'BUILD1');
});

test('settings list lines split at the first "=" only', () => {
  assert.deepEqual(parseSettingsList('k=a=b\nempty=\nnoeq\n'), { k: 'a=b', empty: '' });
});

test('noise: counters, timestamps and long numeric values are tagged, real settings are not', () => {
  assert.equal(isNoisy('boot_count', '5', '6'), true);
  assert.equal(isNoisy('wifi_last_scan_time', '1', '2'), true);
  assert.equal(isNoisy('foo', '1783026412778', '1783026499999'), true);
  assert.equal(isNoisy('adb_enabled', '1', '0'), false);
  assert.equal(isNoisy('private_dns_mode', 'off', 'hostname'), false);
});

test('diff: what a system update typically changes is grouped and counted', () => {
  const before = snap('before', {
    packages: [
      pkg('com.keep'), pkg('com.gone'),
      pkg('com.upd', { v: '1.0', vc: 10 }),
      pkg('com.bloat', { sys: true, en: 3, by: null }),
      pkg('com.perm', { perms: ['android.permission.CAMERA'] }),
      pkg('com.rein', { inst: false }),
    ],
    restricted: ['com.upd'],
  });
  const after = snap('after', {
    ts: '2026-09-02T10:00:00.000Z', patch: '2026-09-01', build: 'BUILD2',
    packages: [
      pkg('com.keep'), pkg('com.new', { by: 'com.sec.android.app.samsungapps' }),
      pkg('com.upd', { v: '2.0', vc: 20 }),
      pkg('com.bloat', { sys: true, en: 0, by: null }),
      pkg('com.perm', { perms: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'] }),
      pkg('com.rein', { inst: true }),
    ],
    global: 'a=2\nboot_count=6\nadb_enabled=1\nnew_key=1', accessibility: 'com.reader/.S:com.other/.T',
    restricted: [],
  });
  const d = diff(before, after);
  assert.deepEqual(d.identity.map(x => x.key).sort(), ['Build', 'Fingerprint', 'Security patch']);
  assert.deepEqual(d.packages.added.map(x => x.pkg), ['com.new']);
  assert.deepEqual(d.packages.removed.map(x => x.pkg), ['com.gone']);
  assert.deepEqual(d.packages.updated.map(x => [x.pkg, x.a, x.b]), [['com.upd', '1.0', '2.0']]);
  assert.deepEqual(d.packages.reenabled.map(x => x.pkg), ['com.bloat'], 'a disabled preload switched back on by the update');
  assert.deepEqual(d.packages.disabled, []);
  assert.deepEqual(d.packages.reinstalled.map(x => x.pkg), ['com.rein']);
  assert.deepEqual(d.perms, [{ pkg: 'com.perm', sys: 0, granted: ['android.permission.RECORD_AUDIO'], revoked: [] }]);
  assert.deepEqual(d.surfaces.accessibility, { added: ['com.other'], removed: [] });
  assert.deepEqual(d.battery, [{ pkg: 'com.upd', a: 'restricted', b: 'optimized' }]);
  const g = d.settings.global;
  assert.deepEqual(g.changed.map(x => [x.key, x.a, x.b, x.noisy]), [['a', '1', '2', false], ['boot_count', '5', '6', true]]);
  assert.deepEqual(g.added.map(x => x.key), ['new_key']);
  assert.equal(g.removed.length, 0);
  assert.equal(d.settingsTotal, 3);
  assert.equal(d.total, 3 + 5 + 1 + 1 + 1 + 3, 'identity 3 + packages 5 + perms 1 + surfaces 1 + battery 1 + settings 3');
  assert.equal(d.older.label, 'before');
  assert.equal(d.newer.build, 'BUILD2');
  const o = originOfAdded(d.packages.added[0]);
  assert.equal(o.channel, 'vendor-store', 'an added package carries its origin');
});

test('diff of identical snapshots is empty in every group', () => {
  const a = snap('x', { packages: [pkg('com.a')] });
  const d = diff(a, a);
  assert.equal(d.total, 0);
  assert.equal(d.identity.length, 0);
  for (const l of Object.values(d.packages)) assert.equal(l.length, 0);
});

test('processor utilisation is the difference between two /proc/stat readings', () => {
  const { parseStat, busyPercent } = require('../src/hardware');
  const a = parseStat('cpu  100 0 100 800 0 0 0 0\ncpu0 50 0 50 400 0 0 0 0\nintr 1 2 3');
  const b = parseStat('cpu  150 0 150 900 0 0 0 0\ncpu0 75 0 75 450 0 0 0 0');
  assert.equal(busyPercent(a, b), 50, '100 busy ticks of 200 elapsed');
  assert.equal(busyPercent(a, b, 'cpu0'), 50);
  assert.equal(busyPercent(null, b), null, 'one reading alone says nothing');
  assert.equal(busyPercent(a, a), null, 'no time passed, no answer');
  assert.equal(parseStat('nothing here'), null);
});

test('thermal readings drop thresholds and level flags, keeping real sensors', () => {
  const { parseThermal } = require('../src/hardware');
  const zones = parseThermal([
    'cpu-0-0|38700', 'battery|29900', 'cpu-hw-trip-0|105000', 'pmh0101-bcl-lvl0|0', 'gpuss-1|35200', 'broken|', '|123',
  ].join('\n'));
  assert.deepEqual(zones, [
    { type: 'cpu-0-0', c: 38.7 }, { type: 'battery', c: 29.9 }, { type: 'gpuss-1', c: 35.2 },
  ]);
});
