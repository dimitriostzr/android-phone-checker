// Tests for the system-wide parsers behind the full report: properties, users,
// roles, the permission catalogue, feature flags, services, certificates and the
// security surfaces derived from the settings tables. All on saved text, the way
// the report reads it off a phone.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sys = require('../src/system');
const { RAW, personalFiles, readmeFor } = require('../src/report');

test('parseProps: every property becomes a key, including empty and multi-word values', () => {
  const p = sys.parseProps([
    '[ro.build.id]: [BUILD1]',
    '[ro.product.model]: [SM-A546B]',
    '[ro.csc.sales_code]: []',
    '[persist.sys.locale]: [en-GB]',
    'not a property line',
  ].join('\n'));
  assert.equal(p['ro.build.id'], 'BUILD1');
  assert.equal(p['ro.product.model'], 'SM-A546B');
  assert.equal(p['ro.csc.sales_code'], '', 'an empty value is still a recorded property');
  assert.equal(Object.keys(p).length, 4);
});

test('parseUsers: a work profile is told apart from the owner', () => {
  const u = sys.parseUsers('Users:\n\tUserInfo{0:Owner:c13} running\n\tUserInfo{10:Work profile:1030}\n');
  assert.equal(u.length, 2);
  assert.equal(u[0].id, 0);
  assert.equal(u[0].running, true);
  assert.equal(u[0].primary, true);
  assert.equal(u[1].name, 'Work profile');
  assert.equal(u[1].managedProfile, true);
  assert.equal(u[1].running, false);
});

test('parsePmList: prefixed lists are read, de-duplicated and sorted', () => {
  assert.deepEqual(
    sys.parsePmList('package:com.b\npackage:com.a\npackage:com.a\nnoise\n'),
    ['com.a', 'com.b']);
  assert.deepEqual(
    sys.parsePmList('feature:android.hardware.camera\nfeature:reqGlEsVersion=0x30002', 'feature'),
    ['android.hardware.camera', 'reqGlEsVersion=0x30002']);
});

test('parseInstrumentation: a test harness left on the phone is reported with its target', () => {
  const i = sys.parseInstrumentation('instrumentation:com.vendor.test/.Runner (target=com.vendor.app)\ninstrumentation:com.x/.R');
  assert.deepEqual(i, [
    { component: 'com.vendor.test/.Runner', target: 'com.vendor.app' },
    { component: 'com.x/.R', target: null },
  ]);
});

test('parsePermissionCatalog: permissions keep their group and protection level', () => {
  const cat = sys.parsePermissionCatalog([
    'All Permissions:',
    '',
    'group:android.permission-group.CONTACTS',
    '  permission:android.permission.READ_CONTACTS',
    '    package:android',
    '    label:null',
    '    protectionLevel:dangerous',
    'group:',
    '  permission:android.permission.WRITE_SECURE_SETTINGS',
    '    package:android',
    '    protectionLevel:signature|privileged|development',
  ].join('\n'));
  assert.equal(cat['android.permission-group.CONTACTS'][0].protection, 'dangerous');
  assert.equal(cat['android.permission-group.CONTACTS'][0].package, 'android');
  assert.equal(cat.ungrouped[0].name, 'android.permission.WRITE_SECURE_SETTINGS');
  assert.equal(cat.ungrouped[0].protection, 'signature|privileged|development');
});

test('parseRoles: both the one-line and the indented dump shapes are read', () => {
  const modern = sys.parseRoles('RoleState{mName=android.app.role.SMS, mHolders=[com.samsung.android.messaging]}\nRoleState{mName=android.app.role.HOME, mHolders=[com.sec.android.app.launcher, com.other.home]}');
  assert.deepEqual(modern['android.app.role.SMS'], ['com.samsung.android.messaging']);
  assert.deepEqual(modern['android.app.role.HOME'], ['com.other.home', 'com.sec.android.app.launcher']);

  const older = sys.parseRoles([
    '  user 0:', '    roles:',
    '      role: android.app.role.DIALER',
    '        holders:',
    '          com.samsung.android.dialer',
  ].join('\n'));
  assert.deepEqual(older['android.app.role.DIALER'], ['com.samsung.android.dialer']);
});

test('parseServices: registered binder services are listed with their interface', () => {
  const s = sys.parseServices('Found 3 services:\n0\tpackage: [android.content.pm.IPackageManager]\n1\tvendor.knox: []\nrubbish');
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { name: 'package', interface: 'android.content.pm.IPackageManager' });
  assert.equal(s[1].interface, null);
});

test('parseDeviceConfig: feature flags are grouped by namespace', () => {
  const d = sys.parseDeviceConfig('privacy/camera_toggle=true\nprivacy/mic_toggle=false\nruntime_native/enable=1\nbroken line');
  assert.deepEqual(d.privacy, { camera_toggle: 'true', mic_toggle: 'false' });
  assert.deepEqual(d.runtime_native, { enable: '1' });
});

test('parseProcesses: pid, parent, user and name are separated', () => {
  const p = sys.parseProcesses('PID PPID USER NAME\n1 0 root init\n4210 990 u0_a123 com.example.app\n');
  assert.deepEqual(p, [
    { pid: 1, ppid: 0, user: 'root', name: 'init' },
    { pid: 4210, ppid: 990, user: 'u0_a123', name: 'com.example.app' },
  ]);
});

test('parseWebView: the provider package and version are pulled out', () => {
  assert.deepEqual(
    sys.parseWebView('Current WebView package (name, version): (com.google.android.webview, 120.0.6099.43)'),
    { package: 'com.google.android.webview', version: '120.0.6099.43' });
  assert.equal(sys.parseWebView('nothing here'), null);
});

test('parseCertList: a CA added by hand is counted separately from the shipped store', () => {
  const c = sys.parseCertList([
    '== system ==', '00673b5b.0', '0d69c7e1.0', '00673b5b.0',
    '== user-added ==', 'aa11bb22.0',
    '== user-removed ==',
  ].join('\n'));
  assert.deepEqual(c.system, ['00673b5b.0', '0d69c7e1.0'], 'the two shipped directories are merged without duplicates');
  assert.equal(c.systemCount, 2);
  assert.deepEqual(c.userAdded, ['aa11bb22.0']);
  assert.equal(c.userAddedCount, 1);
  assert.equal(c.readable.userRemoved, false, 'an empty or unreadable directory is not read as "nothing added"');
});

test('surfacesFrom: the watching, typing and managing surfaces come out of the settings tables', () => {
  const s = sys.surfacesFrom({
    secure: {
      enabled_accessibility_services: 'com.reader/.S:com.other/.T',
      accessibility_enabled: '1',
      enabled_notification_listeners: 'com.notif/.L',
      enabled_input_methods: 'com.kb/.IME:com.kb2/.IME',
      default_input_method: 'com.kb/.IME',
      autofill_service: 'com.pw/.Auto',
      always_on_vpn_app: 'com.vpn',
      always_on_vpn_lockdown: '1',
      location_providers_allowed: 'gps,network',
      install_non_market_apps: '0',
    },
    global: {
      adb_enabled: '1',
      development_settings_enabled: '1',
      private_dns_mode: 'hostname',
      private_dns_specifier: 'dns.example',
      package_verifier_enabled: '0',
    },
  }, 'admin=ComponentInfo{com.mdm/.Admin}\n  Device Owner:\n    admin=ComponentInfo{com.mdm/.Admin}');

  assert.deepEqual(s.accessibilityServices, ['com.other/.T', 'com.reader/.S']);
  assert.deepEqual(s.inputMethods, ['com.kb/.IME', 'com.kb2/.IME']);
  assert.equal(s.defaultInputMethod, 'com.kb/.IME');
  assert.equal(s.autofillService, 'com.pw/.Auto');
  assert.equal(s.alwaysOnVpn, 'com.vpn');
  assert.equal(s.alwaysOnVpnLockdown, true);
  assert.deepEqual(s.privateDns, { mode: 'hostname', host: 'dns.example' });
  assert.deepEqual(s.locationProviders, ['gps', 'network']);
  assert.equal(s.adbEnabled, true);
  assert.equal(s.appVerification.packageVerifier, false);
  assert.deepEqual(s.deviceAdmins, ['com.mdm']);
  assert.equal(s.deviceOwner, 'com.mdm/.Admin');
});

test('surfacesFrom: an unreadable settings table gives null, never a false all-clear', () => {
  const s = sys.surfacesFrom({}, '');
  assert.deepEqual(s.accessibilityServices, []);
  assert.equal(s.adbEnabled, null, 'unknown is not the same as off');
  assert.equal(s.accessibilityEnabled, null);
  assert.equal(s.deviceOwner, null);
  assert.deepEqual(s.deviceAdmins, []);
});

test('the capture list is well formed: unique files, every one described and read-only', () => {
  const files = RAW.map(r => r.file);
  assert.equal(new Set(files).size, files.length, 'raw file names must be unique');
  for (const r of RAW) {
    assert.ok(r.what && r.what.length > 10, `${r.file} needs a description`);
    assert.ok(/^\d\d-[a-z0-9-]+\.txt$/.test(r.file), `${r.file} should be numbered and lowercase`);
    assert.ok(!/\b(pm (install|uninstall|disable|enable|clear|grant|revoke)|settings put|am (start|force-stop|broadcast)|svc |rm |reboot)\b/.test(r.cmd),
      `${r.file} must only read: ${r.cmd}`);
  }
  assert.deepEqual([...files].sort(), files, 'files are written in numbered order');
  assert.ok(personalFiles().length > 0);
  const firstPersonal = RAW.findIndex(r => r.personal);
  const lastPlain = RAW.map(r => !!r.personal).lastIndexOf(false);
  assert.ok(firstPersonal > lastPlain,
    'the personal captures come last, so a report without them still stops at the end');
});

test('the capture list covers the surfaces the report claims to cover', () => {
  const all = RAW.map(r => r.cmd).join('\n');
  for (const needle of [
    'getprop', 'dumpsys package packages', 'settings list global', 'settings list secure',
    'settings list system', 'cmd device_config list', 'pm list users', 'pm list features',
    'pm list libraries', 'pm list instrumentation', 'pm list permissions', 'pm list packages --apex-only',
    'dumpsys input_method', 'dumpsys accessibility', 'dumpsys autofill', 'dumpsys device_policy',
    'dumpsys role', 'dumpsys appops', 'dumpsys webviewupdate', 'cacerts', 'getenforce',
    'service list', 'dumpsys jobscheduler', 'dumpsys alarm', 'dumpsys backup',
  ]) assert.ok(all.includes(needle), `the report should capture "${needle}"`);
});

test('readmeFor: the README names every capture and warns about the personal ones', () => {
  const rawFiles = RAW.map(r => ({ file: r.file, cmd: r.cmd, what: r.what, personal: !!r.personal }));
  const json = {
    report: {
      generatedAt: '2026-09-01T10:00:00.000Z', collectedBy: 'Phone Checker for Android',
      includesPersonalCaptures: true, personalFiles: personalFiles(), failedReads: 0,
      counts: { properties: 1200, settings: 3400, users: 2 },
    },
    device: { manufacturer: 'Samsung', model: 'SM-A546B', serial: 'S1', android: '16', securityPatch: '2026-07-05', build: 'B1' },
    packages: [{}, {}],
    healthChecks: { counts: { flag: 1, note: 2, ok: 3, skip: 0 } },
  };
  const md = readmeFor(json, rawFiles);
  for (const r of rawFiles) assert.ok(md.includes(`raw/${r.file}`), `${r.file} should be listed in the README`);
  assert.ok(md.includes('User profiles: 2'));
  assert.ok(md.includes('Treat the whole folder as personal.'));

  const without = readmeFor({ ...json, report: { ...json.report, includesPersonalCaptures: false, personalFiles: [] } }, rawFiles);
  assert.ok(without.includes('were left out of this collection'));
  assert.ok(!without.includes('Treat the whole folder as personal.'));
});
