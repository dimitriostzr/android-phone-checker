// Tests for the install-origin parser and classifier. The dump fragments mirror
// what `dumpsys package packages` / `dumpsys package installs` print on a
// current build (fields such as initiatingPackageName, per-user firstInstallTime,
// wrapped session lines) and on older ones (installInitiatingPackageName,
// package-level firstInstallTime). Runs with Node's built-in runner: npm test.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePackagesDump, parseInstallSessions, joinWrapped, classify, describeSession } = require('../src/origin');

const block = (pkg, lines) => `  Package [${pkg}] (abc123):\n    appId=10123\n${lines.map(l => '    ' + l).join('\n')}\n`;
const USER0 = (extra = '', flags = 'installed=true hidden=false suspended=false distractionFlags=0 stopped=false notLaunched=false enabled=0 instant=false virtual=false') =>
  `User 0: ceDataInode=1 deDataInode=2 ${flags}\n      installReason=4\n      dataDir=/data/user/0/x\n      firstInstallTime=2026-05-01 10:00:00\n      uninstallReason=0${extra}`;

const PLAY = block('com.example.play', [
  'codePath=/data/app/~~abc==/com.example.play-def==', 'versionCode=42 minSdk=26 targetSdk=35', 'versionName=4.2.0',
  'flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]', 'timeStamp=2026-06-01 09:00:00', 'lastUpdateTime=2026-06-01 09:00:00',
  'installerPackageName=com.android.vending', 'initiatingPackageName=com.android.vending', 'originatingPackageName=null', 'packageSource=0',
  'signatures=PackageSignatures{1 version:3, signatures:[deadbeef], past signatures:[]}',
  '      android.permission.CAMERA: granted=true, flags=[ USER_SET ]',
  USER0('\n      android.permission.RECORD_AUDIO: granted=true, flags=[ USER_SET ]\n      android.permission.CAMERA: granted=false, flags=[ USER_SET ]'),
  'User 150: ceDataInode=3 deDataInode=4 installed=false hidden=false enabled=0\n      installReason=0\n      firstInstallTime=2026-07-07 07:07:07',
]);
const APK = block('com.example.apk', [
  'codePath=/data/app/~~x==/com.example.apk-y==', 'versionCode=7 minSdk=26 targetSdk=34', 'versionName=1.7',
  'pkgFlags=[ HAS_CODE ]', 'lastUpdateTime=2026-05-01 10:00:00',
  'installerPackageName=com.google.android.packageinstaller', 'initiatingPackageName=com.google.android.packageinstaller',
  'originatingPackageName=org.mozilla.firefox', 'packageSource=4',
  USER0('', 'installed=true hidden=false suspended=false stopped=true notLaunched=true enabled=0 instant=false'),
]);
const ADB = block('com.example.adb', [
  'codePath=/data/app/~~q==/com.example.adb-r==', 'versionCode=1 minSdk=26 targetSdk=34', 'versionName=0.1',
  'flags=[ HAS_CODE ]', 'lastUpdateTime=2026-05-01 10:00:00', 'packageSource=0',
  USER0(),
]);
const CLAIMED = block('com.example.claimed', [
  'codePath=/data/app/~~c==/com.example.claimed-d==', 'versionCode=3 minSdk=26 targetSdk=34', 'versionName=3.0',
  'flags=[ HAS_CODE ]', 'lastUpdateTime=2026-05-01 10:00:00', 'installerPackageName=com.android.vending', 'initiatingPackageName=null',
  USER0(),
]);
const VENDOR = block('com.example.vendor', [
  'codePath=/data/app/~~v==/com.example.vendor-w==', 'versionCode=5 minSdk=26 targetSdk=35', 'versionName=5.0',
  'flags=[ HAS_CODE ]', 'lastUpdateTime=2026-07-12 17:39:52',
  'installerPackageName=com.sec.android.app.samsungapps', 'initiatingPackageName=com.sec.android.app.samsungapps', 'originatingPackageName=null',
  `User 0: ceDataInode=1 deDataInode=2 installed=true hidden=false suspended=false stopped=true notLaunched=true enabled=0 instant=false virtual=false\n      installReason=4\n      firstInstallTime=2026-07-12 17:39:52\n      uninstallReason=0`,
]);
// A preloaded, later-updated system app (shape taken from a real dump).
const SYSUPD = block('com.example.sysupd', [
  'codePath=/data/app/~~s==/com.example.sysupd-t==', 'versionCode=130103198 minSdk=35 targetSdk=35', 'versionName=1.3.01.3198',
  'flags=[ SYSTEM HAS_CODE ALLOW_CLEAR_USER_DATA UPDATED_SYSTEM_APP ]', 'privateFlags=[ PRIVILEGED ]',
  'timeStamp=2026-04-09 06:34:26', 'lastUpdateTime=2026-04-09 06:34:27',
  'installerPackageName=com.sec.android.app.samsungapps', 'initiatingPackageName=com.sec.android.app.samsungapps', 'originatingPackageName=null', 'packageSource=0',
  'User 0: ceDataInode=5 deDataInode=6 installed=true hidden=false suspended=false stopped=false notLaunched=false enabled=3 instant=false virtual=false\n      installReason=0\n      firstInstallTime=1970-01-01 02:07:21\n      uninstallReason=0\n      lastDisabledCaller: com.android.shell',
]);
const SYS = block('com.example.sys', [
  'codePath=/system/priv-app/Sys', 'versionCode=1 minSdk=35 targetSdk=35', 'versionName=1.0',
  'pkgFlags=[ SYSTEM HAS_CODE ]', 'timeStamp=2026-04-09 06:34:26', 'lastUpdateTime=2026-04-09 06:34:26',
  'User 0: ceDataInode=5 deDataInode=6 installed=false hidden=false suspended=false stopped=false notLaunched=false enabled=0 instant=false virtual=false\n      installReason=0\n      firstInstallTime=1970-01-01 02:07:21\n      uninstallReason=0',
]);
// Older Android: installInitiatingPackageName, firstInstallTime at package level.
const OLD = block('com.example.old', [
  'codePath=/data/app/com.example.old-1', 'versionCode=9 minSdk=21 targetSdk=29', 'versionName=9',
  'pkgFlags=[ HAS_CODE ]', 'timeStamp=2021-01-01 00:00:00', 'firstInstallTime=2020-12-24 18:00:00', 'lastUpdateTime=2021-01-01 00:00:00',
  'installerPackageName=com.android.vending', 'installInitiatingPackageName=com.android.vending', 'installOriginatingPackageName=null',
  'User 0: ceDataInode=1 installed=true hidden=false suspended=false stopped=false notLaunched=false enabled=0 instant=false virtual=false',
]);
const DUMP = `Packages:\n${PLAY}${APK}${ADB}${CLAIMED}${VENDOR}${SYSUPD}${SYS}${OLD}\nHidden system packages:\n${block('com.example.sysupd', ['codePath=/system/app/Old', 'versionName=0.9', 'flags=[ SYSTEM ]'])}`;

test('every package block is parsed once and the hidden-system copies are ignored', () => {
  const recs = parsePackagesDump(DUMP);
  assert.deepEqual(Object.keys(recs).sort(), ['com.example.adb', 'com.example.apk', 'com.example.claimed', 'com.example.old', 'com.example.play', 'com.example.sys', 'com.example.sysupd', 'com.example.vendor']);
  assert.equal(recs['com.example.sysupd'].versionName, '1.3.01.3198', 'the installed (updated) copy wins over the hidden factory copy');
});

test('a Play-installed app: dates, installer, per-user state and permissions', () => {
  const r = parsePackagesDump(DUMP)['com.example.play'];
  assert.equal(r.firstInstall, '2026-05-01 10:00:00', 'user 0 install time, not user 150');
  assert.equal(r.lastUpdate, '2026-06-01 09:00:00');
  assert.equal(r.installer, 'com.android.vending');
  assert.equal(r.initiating, 'com.android.vending');
  assert.equal(r.originating, null);
  assert.equal(r.installReason, 4);
  assert.equal(r.system, false);
  assert.equal(r.installed, true);
  assert.equal(r.versionCode, 42);
  assert.equal(r.signer, 'deadbeef');
  assert.deepEqual(r.granted, ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'], 'install + user-0 runtime grants; granted=false ignored');
  const o = classify(r);
  assert.equal(o.channel, 'store');
  assert.match(o.summary, /Installed on 2026-05-01 10:00:00 by Google Play/);
  assert.ok(o.notes.some(n => /Last updated 2026-06-01/.test(n)));
});

test('an APK opened by hand names the installer and the app that handed the file over', () => {
  const o = classify(parsePackagesDump(DUMP)['com.example.apk']);
  assert.equal(o.channel, 'apk');
  assert.match(o.summary, /APK file/);
  assert.match(o.summary, /org\.mozilla\.firefox/);
  assert.ok(o.notes.some(n => /downloaded file/.test(n)), 'packageSource=4 explained');
  assert.ok(o.notes.some(n => /Never opened/.test(n)), 'notLaunched surfaces');
});

test('no installer at all reads as adb/USB or an old sideload', () => {
  const o = classify(parsePackagesDump(DUMP)['com.example.adb']);
  assert.equal(o.channel, 'none');
  assert.match(o.summary, /adb over USB/);
  assert.equal(o.who, null);
});

test('an installer of record that never performed the install is called out (adb install -i)', () => {
  const o = classify(parsePackagesDump(DUMP)['com.example.claimed']);
  assert.equal(o.channel, 'store', 'the claimed installer still decides the chip');
  assert.ok(o.notes.some(n => /did not see that app perform the install/.test(n)));
});

test("the manufacturer's store is described generically, with the package id beside it", () => {
  const o = classify(parsePackagesDump(DUMP)['com.example.vendor']);
  assert.equal(o.channel, 'vendor-store');
  assert.match(o.summary, /manufacturer's preinstalled app store \(com\.sec\.android\.app\.samsungapps\)/);
  assert.ok(o.notes.some(n => /does not prove you asked for it/.test(n)), 'installReason=4 caveat');
  assert.ok(o.notes.some(n => /Never opened/.test(n)));
});

test('preloads: shipped with firmware vs. updated since, and disabled-by state', () => {
  const recs = parsePackagesDump(DUMP);
  const upd = classify(recs['com.example.sysupd']);
  assert.equal(upd.channel, 'firmware-updated');
  assert.match(upd.summary, /update from 2026-04-09 06:34:27 by the manufacturer's preinstalled app store/);
  assert.ok(upd.notes.some(n => /disabled by the user — last disabled by adb over USB/.test(n)));
  assert.equal(recs['com.example.sysupd'].privileged, true);
  const sys = classify(recs['com.example.sys']);
  assert.equal(sys.channel, 'firmware');
  assert.equal(sys.tone, 'removed', 'installed=false for user 0 → not installed');
  assert.match(sys.summary, /^Record kept after removal/);
  assert.match(sys.summary, /\/system/);
});

test('older dump format: install* field names and package-level firstInstallTime', () => {
  const r = parsePackagesDump(DUMP)['com.example.old'];
  assert.equal(r.initiating, 'com.android.vending');
  assert.equal(r.firstInstall, '2020-12-24 18:00:00');
  assert.equal(classify(r).channel, 'store');
});

// Session dump as printed on a real device: wrapped mid-token, trailing spaces
// on natural line ends, one child of a staged batch, one adb install.
const SESSIONS = `Active install sessions:
  
Finalized install sessions:
  Finalized Session 1674577637:
    userId=0 mOriginalInstallerUid=10286 mOriginalInstallerPackageName=com.android.vending 
    installerPackageName=com.android.vending installInitiatingPackageName=com.android.vending 
    installOriginatingPackageName=null mInstallerUid=10286 createdMillis=1783026412778 updatedMillis=1783026412778 
    committedMillis=1783026413014 stageDir=null stageCid=null 
    mode=1 installFlags=0x640002 installLocation=1 installReason=0 installScenario=0 sizeBytes=-1 
    appPackageName=null appIcon=false appLabel=null originatingUri=null originatingUid=-1 
    isMultiPackage=true isStaged=true mFinalStatus=0 mFinalMessage=null mParentSessionId=-1 mSessionApplied=true 
  
    Finalized Child Session 2096104399:
      userId=0 mOriginalInstallerUid=10286 mOriginalInstallerPackageName=com.android.vending 
      installerPackageName=com.android.vending installInitiatingPackageName=com.android.vending 
      installOriginatingPackageName=null mInstallerUid=10286 createdMillis=1783026401657 updatedMillis=1783026401657 
      committedMillis=1783026413014 stageDir=/data/app-staging/session_2096104399 stageCid=null 
      mode=1 installFlags=0x464012 installLocation=1 installReason=4 installScenario=0 sizeBytes=-1 
      appPackageName=com.google.android.resolv appIcon=false appLabel=Google Play system update originatingUri=null 
      originatingUid=-1 isMultiPackage=false isStaged=true mFinalStatus=0 mFinalMessage=null mParentSessionId=1674577637 
    
Historical install sessions:
  Session 773212977:
    userId=0 mOriginalInstallerUid=10286 mOriginalInstallerPackageName=com.android.vending 
    installerPackageName=com.android.vending installInitiatingPackageName=com.android.vending 
    installOriginatingPackageName=null mInstallerUid=10286 createdMillis=1784804592105 updatedMillis=1784804602503 
    committedMillis=1784804597272 stageDir=/data/app/vmdl773212977.tmp stageCid=null 
    mode=1 installFlags=0x240c012 installLocation=1 installReason=4 installScenario=0 sizeBytes=-1 appPackageName=com.an
    droid.vending appIcon=false appLabel=Google Play Store originatingUri=null originatingUid=-1 referrerUri=null abiOve
    rride=null volumeUuid=null mPermissionStates={} packageSource=0 whitelistedRestrictedPermissions=null autoRevokePerm
    issions=3 installerPackageName=null isMultiPackage=false isStaged=false forceQueryable=false 
    mFinalStatus=1 mFinalMessage=Session installed mParentSessionId=-1 mChildSessionIds=[] mSessionApplied=true 
  
  Session 55:
    userId=0 mOriginalInstallerUid=2000 mOriginalInstallerPackageName=null 
    installerPackageName=null installInitiatingPackageName=null installOriginatingPackageName=null mInstallerUid=2000 
    createdMillis=1784900000000 updatedMillis=1784900001000 committedMillis=1784900000500 stageDir=/data/app/vmdl55.tmp 
    mode=1 installFlags=0x20 installLocation=1 installReason=0 appPackageName=com.example.adb appIcon=false appLabel=null originatingUri=null 
    mFinalStatus=1 mFinalMessage=Session installed mParentSessionId=-1 
  
Legacy install sessions:
  {}
`;

test('wrapped session lines are joined back exactly', () => {
  assert.equal(joinWrapped(['    appPackageName=com.an', '    droid.vending appIcon=false ', '    x=1 ']), 'appPackageName=com.android.vending appIcon=false x=1 ');
});

test('install sessions: package, installer, timing, adb flag and staged children', () => {
  const s = parseInstallSessions(SESSIONS);
  assert.deepEqual(s.map(x => x.pkg), ['com.google.android.resolv', 'com.android.vending', 'com.example.adb'], 'the multi-package parent (no app) is dropped');
  const play = s.find(x => x.id === 773212977);
  assert.equal(play.section, 'historical');
  assert.equal(play.installer, 'com.android.vending', 'first installerPackageName wins, not the later params one');
  assert.equal(play.label, 'Google Play Store');
  assert.equal(play.committed, 1784804597272);
  assert.equal(play.replace, true, 'installFlags 0x2 → an update');
  assert.equal(play.adb, false);
  assert.equal(play.message, 'Session installed');
  assert.equal(play.status, 1);
  const child = s.find(x => x.id === 2096104399);
  assert.equal(child.staged, true);
  assert.equal(child.parent, 1674577637);
  const adb = s.find(x => x.id === 55);
  assert.equal(adb.adb, true, 'installFlags 0x20 = INSTALL_FROM_ADB');
  assert.equal(adb.installer, null);
  const d = describeSession(adb);
  assert.match(d.text, /^adb over USB installed it/);
  assert.match(describeSession(play).text, /Google Play \(com\.android\.vending\) updated it/);
  assert.match(describeSession(child).text, /staged system update/);
  assert.match(describeSession(child).text, /applied after a restart/, 'child inherits the applied flag of its batch parent');
});

test('epoch and placeholder file stamps are never presented as real dates', () => {
  const { isEpoch, isPlaceholderStamp } = require('../src/origin');
  assert.equal(isEpoch('1970-01-01 02:07:21'), true);
  assert.equal(isEpoch('2026-07-12 17:39:52'), false);
  assert.equal(isPlaceholderStamp('2022-01-01 02:00:00'), true);
  assert.equal(isPlaceholderStamp('2026-04-09 06:34:26'), false);
  const placeholder = block('com.example.sysui', [
    'codePath=/system_ext/priv-app/SystemUI', 'versionCode=36 minSdk=35 targetSdk=35', 'versionName=16',
    'flags=[ SYSTEM HAS_CODE ]', 'timeStamp=2022-01-01 02:00:00', 'lastUpdateTime=1970-01-01 02:07:21',
    'User 0: ceDataInode=5 deDataInode=6 installed=true hidden=false suspended=false stopped=false notLaunched=false enabled=0 instant=false virtual=false\n      installReason=0\n      firstInstallTime=1970-01-01 02:07:21\n      uninstallReason=0',
  ]);
  const o = classify(parsePackagesDump(`Packages:\n${placeholder}`)['com.example.sysui']);
  assert.match(o.summary, /present since first boot/);
  assert.doesNotMatch(o.summary, /1970/);
  assert.ok(o.notes.some(n => /placeholder date/.test(n)), 'the 2022-01-01 02:00:00 stamp is explained');
  assert.ok(!o.notes.some(n => /1970/.test(n)), 'no raw epoch value in the notes');
});

test('app-op durations from the phone are said in words, not printed raw', () => {
  const { parseDuration, humanizeAgo } = require('../src/checks');
  // the exact string this project's own device produced for a microphone grant
  assert.equal(parseDuration('+173d17h56m16s625ms'), 15011776625);
  assert.equal(humanizeAgo(parseDuration('+173d17h56m16s625ms')), '6 months ago');
  assert.equal(humanizeAgo(parseDuration('+2h5m1s')), '2 hours ago');
  assert.equal(humanizeAgo(parseDuration('+45m')), '45 minutes ago');
  assert.equal(humanizeAgo(parseDuration('+1d0h0m')), '1 day ago');
  assert.equal(humanizeAgo(parseDuration('+37s855ms')), 'just now');
  assert.equal(parseDuration('nonsense'), null, 'an unreadable duration is not invented');
});
