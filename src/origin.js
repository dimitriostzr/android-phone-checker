// origin.js — where an app came from, read from the phone's own package records.
// Pure: it parses text (`dumpsys package packages`, `dumpsys package installs`)
// and turns each record into a plain-language answer to "when was this
// installed, by whom, and through which channel?". No adb here, so
// test/origin.test.js can run it on saved dumps.
'use strict';
const { KB } = require('./profiles');

// Apps that perform installs, in plain words. Manufacturers' own stores are
// described generically; the package id is always shown beside the label.
const INSTALLERS = {
  'com.android.vending': { label: 'Google Play', kind: 'store' },
  'com.amazon.venezia': { label: 'Amazon Appstore', kind: 'store' },
  'org.fdroid.fdroid': { label: 'F-Droid', kind: 'store' },
  'org.fdroid.basic': { label: 'F-Droid Basic', kind: 'store' },
  'com.aurora.store': { label: 'Aurora Store', kind: 'store' },
  'com.sec.android.app.samsungapps': { label: "the manufacturer's preinstalled app store", kind: 'vendor-store' },
  'com.samsung.android.themestore': { label: "the manufacturer's theme store", kind: 'vendor-store' },
  'com.xiaomi.mipicks': { label: "the manufacturer's preinstalled app store", kind: 'vendor-store' },
  'com.xiaomi.market': { label: "the manufacturer's preinstalled app store", kind: 'vendor-store' },
  'com.heytap.market': { label: "the manufacturer's preinstalled app store", kind: 'vendor-store' },
  'com.oppo.market': { label: "the manufacturer's preinstalled app store", kind: 'vendor-store' },
  'com.bbk.appstore': { label: "the manufacturer's preinstalled app store", kind: 'vendor-store' },
  'com.huawei.appmarket': { label: "the manufacturer's preinstalled app store", kind: 'vendor-store' },
  'com.hihonor.appmarket': { label: "the manufacturer's preinstalled app store", kind: 'vendor-store' },
  'com.transsnet.store': { label: "the manufacturer's preinstalled app store", kind: 'vendor-store' },
  'com.google.android.packageinstaller': { label: 'the Android package installer (an APK file that was opened)', kind: 'apk' },
  'com.android.packageinstaller': { label: 'the Android package installer (an APK file that was opened)', kind: 'apk' },
  'com.samsung.android.packageinstaller': { label: "the manufacturer's package installer (an APK file that was opened)", kind: 'apk' },
  'com.android.shell': { label: 'adb over USB (the debugging shell)', kind: 'adb' },
  'com.sec.android.easyMover': { label: "the manufacturer's phone-transfer tool", kind: 'transfer' },
  'com.samsung.android.smartswitchassistant': { label: "the manufacturer's phone-transfer assistant", kind: 'transfer' },
  'com.google.android.apps.restore': { label: 'Android setup (restore from a backup)', kind: 'restore' },
  'com.google.android.setupwizard': { label: 'the Android setup wizard', kind: 'setup' },
  'com.google.android.gms': { label: 'Google Play services', kind: 'system' },
  'com.android.settings': { label: 'Android Settings', kind: 'system' },
  'com.android.managedprovisioning': { label: 'work-profile provisioning', kind: 'policy' },
  'com.google.android.apps.work.clouddpc': { label: 'a device-management (MDM) agent', kind: 'policy' },
  'com.samsung.android.goodlock': { label: "the manufacturer's customisation hub", kind: 'app' },
  'com.samsung.android.app.omcagent': { label: 'the region/carrier configuration agent', kind: 'preload-channel' },
  'android.autoinstalls.config.samsung': { label: 'the preinstall campaign configuration', kind: 'preload-channel' },
  'com.facebook.system': { label: 'the preinstalled Meta app installer', kind: 'preload-channel' },
  'com.facebook.appmanager': { label: 'the preinstalled Meta app manager', kind: 'preload-channel' },
  'com.aura.oobe': { label: 'a partner-app installer (AppCloud)', kind: 'preload-channel' },
  'com.aura.oobe.samsung': { label: 'a partner-app installer (AppCloud)', kind: 'preload-channel' },
  'com.ironsource.appcloud.oobe': { label: 'a partner-app installer (AppCloud)', kind: 'preload-channel' },
  'com.ironsource.appcloud.oobe.hutchison': { label: 'a partner-app installer (AppCloud)', kind: 'preload-channel' },
  'com.samsung.android.kidsinstaller': { label: 'the kids-mode installer', kind: 'preload-channel' },
  'com.samsung.android.app.parentalcare': { label: 'the parental-care helper', kind: 'preload-channel' },
  'com.samsung.android.appseparation': { label: 'the app-separation feature', kind: 'app' },
  'com.samsung.android.da.daagent': { label: 'the dual-messenger feature', kind: 'app' },
};

// PackageManager.INSTALL_REASON_*: set by the installing app itself.
const INSTALL_REASON = {
  1: 'a device policy (a management app or work profile) requested this install',
  2: 'restored from a backup',
  3: 'pushed during initial device setup',
  4: 'the installer tagged this as a user-requested install — that tag is set by the installing app itself, so it does not prove you asked for it',
  5: 'installed by a rollback',
};
// PackageInstaller.PACKAGE_SOURCE_* (Android 13+), also set by the installer.
const PACKAGE_SOURCE = {
  1: 'the installer classified the file source as "other"',
  2: 'the installer classified the file source as a store',
  3: 'the installer classified the file source as a local file',
  4: 'the installer classified the file source as a downloaded file',
};
const ENABLED_STATE = { 0: 'enabled (default)', 1: 'enabled', 2: 'disabled', 3: 'disabled by the user', 4: 'disabled until used' };
const FIRMWARE_PARTITIONS = /^\/(system|system_ext|product|vendor|odm|oem|apex|prism|optics)(\/|$)/;

const nul = (v) => (v == null || v === 'null' || v === '') ? null : v;
const num = (v) => (v == null || v === '' || isNaN(+v)) ? null : +v;

// One "  Package [x] (hash):" block of a dump → plain record.
function parseBlock(pkg, block) {
  // Per-user state lives under "User N:" lines; everything before the first one
  // is package-level. Older Android printed firstInstallTime at package level.
  const users = [...block.matchAll(/^\s{4}User (\d+): (.*)$/gm)];
  const firstUserIdx = users.length ? users[0].index : block.length;
  const head = block.slice(0, firstUserIdx);
  const u0 = users.find(u => u[1] === '0');
  let user0 = '';
  if (u0) {
    const i = users.indexOf(u0);
    const end = i + 1 < users.length ? users[i + 1].index : block.length;
    user0 = block.slice(u0.index, end);
  }
  const g = (text, k) => { const m = text.match(new RegExp(`^\\s+${k}=(.*)$`, 'm')); return m ? m[1].trim() : null; };
  const gh = (k) => g(head, k);
  const gu = (k) => g(user0, k);
  const flags = gh('flags') || gh('pkgFlags') || '';
  const privFlags = gh('privateFlags') || gh('privatePkgFlags') || '';
  const u0line = u0 ? u0[2] : '';
  const uflag = (k) => { const m = u0line.match(new RegExp(`\\b${k}=(\\w+)`)); return m ? m[1] : null; };
  const granted = new Set();
  for (const m of (head + user0).matchAll(/^\s+([A-Za-z][\w.]+): granted=true/gm)) granted.add(m[1]);
  const codePath = gh('codePath') || '';
  const sigM = head.match(/signatures:\[([0-9a-f]+)/);
  return {
    pkg,
    versionName: gh('versionName'),
    versionCode: num((gh('versionCode') || '').split(' ')[0]),
    codePath,
    system: /\bSYSTEM\b/.test(flags),
    updatedSystem: /\bUPDATED_SYSTEM_APP\b/.test(flags),
    privileged: /\bPRIVILEGED\b/.test(privFlags),
    installer: nul(gh('installerPackageName')),
    initiating: nul(gh('initiatingPackageName') != null ? gh('initiatingPackageName') : gh('installInitiatingPackageName')),
    originating: nul(gh('originatingPackageName') != null ? gh('originatingPackageName') : gh('installOriginatingPackageName')),
    updateOwner: nul(gh('updateOwnerPackageName')),
    packageSource: num(gh('packageSource')),
    timeStamp: gh('timeStamp'),
    lastUpdate: gh('lastUpdateTime'),
    firstInstall: gu('firstInstallTime') || gh('firstInstallTime'),
    installReason: num(gu('installReason') != null ? gu('installReason') : gh('installReason')),
    installed: u0 ? uflag('installed') !== 'false' : true,
    enabled: u0 ? num(uflag('enabled')) : null,
    hidden: uflag('hidden') === 'true',
    stopped: uflag('stopped') === 'true',
    notLaunched: uflag('notLaunched') === 'true',
    lastDisabledCaller: nul(((user0.match(/^\s+lastDisabledCaller[:=]\s*(\S+)/m) || [])[1])),
    signer: sigM ? sigM[1] : null,
    granted: [...granted].sort(),
  };
}

// The whole "Packages:" section → { pkg: record }. The "Hidden system packages:"
// section that follows holds the factory copies of updated system apps under the
// same names, so parsing stops there.
function parsePackagesDump(text) {
  const cut = text.indexOf('\nHidden system packages:');
  const body = cut >= 0 ? text.slice(0, cut) : text;
  const out = {};
  for (const chunk of body.split(/\n(?=  Package \[)/)) {
    const m = chunk.match(/^  Package \[([^\]]+)\]/);
    if (m && !out[m[1]]) out[m[1]] = parseBlock(m[1], chunk);
  }
  return out;
}

// ---------- install sessions (`dumpsys package installs`) ----------
// Each session is dumped as "key=value " pairs wrapped at a fixed width, with
// continuation lines that break mid-token ("appPackageName=com.an" / "droid…").
// Natural line ends carry a trailing space, wraps do not, so joining the
// stripped lines back-to-back restores the original text exactly.
function joinWrapped(lines) {
  let s = '';
  for (const raw of lines) s += raw.replace(/^\s+/, '');
  return s;
}

function parseInstallSessions(text) {
  const out = [];
  let section = 'active';
  const lines = text.split('\n');
  let cur = null;
  const flush = () => { if (cur) { out.push(sessionFrom(cur.id, cur.section, joinWrapped(cur.lines))); cur = null; } };
  for (const line of lines) {
    const sec = line.match(/^(Active|Finalized|Historical|Legacy) install sessions:/);
    if (sec) { flush(); section = sec[1].toLowerCase(); continue; }
    const head = line.match(/^\s*(?:Finalized )?(?:Child )?Session (\d+):\s*$/);
    if (head) { flush(); cur = { id: +head[1], section, lines: [] }; continue; }
    if (cur) { if (line.trim() === '') flush(); else cur.lines.push(line); }
  }
  flush();
  const byId = new Map(out.map(s => [s.id, s]));
  for (const s of out) {
    const parent = s.parent > 0 ? byId.get(s.parent) : null;
    if (parent) { s.applied = s.applied || parent.applied; s.failed = s.failed || parent.failed; }
  }
  return out.filter(s => s.pkg && s.pkg !== 'null' && !s.multi);
}

function sessionFrom(id, section, s) {
  const f = (k) => { const m = s.match(new RegExp(`(?:^|\\s)${k}=(\\S+)`)); return m ? nul(m[1]) : null; };
  const label = (s.match(/appLabel=(.*?) originatingUri=/) || [])[1];
  const message = (s.match(/mFinalMessage=(.*?) mParentSessionId=/) || [])[1];
  const flags = parseInt((f('installFlags') || '0x0').replace(/^0x/, ''), 16) || 0;
  return {
    id, section,
    pkg: f('appPackageName') || f('mAppPackageName'),
    label: nul(label),
    installer: f('installerPackageName'),
    initiating: f('installInitiatingPackageName'),
    originating: f('installOriginatingPackageName'),
    originalInstaller: f('mOriginalInstallerPackageName'),
    installerUid: num(f('mInstallerUid')),
    created: num(f('createdMillis')),
    committed: num(f('committedMillis')),
    reason: num(f('installReason')),
    packageSource: num(f('packageSource')),
    adb: !!(flags & 0x20),
    replace: !!(flags & 0x2),
    staged: f('isStaged') === 'true',
    multi: f('isMultiPackage') === 'true',
    parent: num(f('mParentSessionId')),
    status: num(f('mFinalStatus')),
    applied: f('mSessionApplied') === 'true',
    failed: f('mSessionFailed') === 'true',
    message: nul(message),
  };
}

// ---------- classification ----------
function labelFor(pkg) {
  if (!pkg) return null;
  if (INSTALLERS[pkg]) return INSTALLERS[pkg].label;
  if (KB[pkg]) return KB[pkg].name;
  return null;
}
function nameOf(pkg) { const l = labelFor(pkg); return l ? `${l} (${pkg})` : pkg; }
const isEpoch = (t) => !!t && /^19[0-9]{2}-/.test(t);
// Build systems often stamp every file with the same round date (e.g. 2022-01-01 02:00:00).
const isPlaceholderStamp = (t) => !!t && /-01-01 0[0-3]:00:00$/.test(t);
const whenText = (t) => isEpoch(t) ? 'at first boot (before the clock was set)' : t ? `on ${t}` : 'at an unknown time';
const partitionOf = (codePath) => { const m = (codePath || '').match(FIRMWARE_PARTITIONS); return m ? `/${m[1]}` : null; };

// Turn a parsed record into { channel, chip, tone, summary, who, via, notes }.
//   channel: firmware | firmware-updated | store | vendor-store | apk | adb |
//            none | transfer | restore | setup | policy | preload-channel | app | system
//   tone:    the colour family the UI uses for the chip
function classify(r) {
  const notes = [];
  const who = r.initiating || r.installer;
  const kind = who ? (INSTALLERS[who] ? INSTALLERS[who].kind : 'app') : null;
  let channel, chip, tone, summary;

  if (r.system && !r.updatedSystem) {
    channel = 'firmware'; chip = 'firmware preload'; tone = 'preload';
    summary = `Shipped with the phone's firmware (${partitionOf(r.codePath) || 'system image'}) — present ${isEpoch(r.firstInstall) ? 'since first boot' : `since ${r.firstInstall || 'the firmware was flashed'}`}, never replaced since.`;
    if (r.timeStamp && !isEpoch(r.timeStamp)) notes.push(isPlaceholderStamp(r.timeStamp)
      ? `Firmware file stamp ${r.timeStamp} — a fixed placeholder date that firmware builds commonly use, not an install date.`
      : `Firmware file dated ${r.timeStamp}.`);
  } else if (r.system && r.updatedSystem) {
    channel = 'firmware-updated'; chip = 'preload · updated'; tone = 'preload';
    summary = `Shipped with the phone's firmware; the version now installed is an update ${r.lastUpdate ? `from ${r.lastUpdate} ` : ''}by ${who ? nameOf(who) : 'an unrecorded installer'}.`;
  } else {
    const first = whenText(r.firstInstall);
    if (!who) {
      if (r.installReason === 3) { channel = 'setup'; chip = 'device setup'; tone = 'vendor'; summary = `Installed ${first} during initial device setup, with no installer app recorded.`; }
      else if (r.installReason === 2) { channel = 'restore'; chip = 'restored'; tone = 'store'; summary = `Restored from a backup ${first}, with no installer app recorded.`; }
      else { channel = 'none'; chip = 'no installer recorded'; tone = 'side'; summary = `Installed ${first} with no installer recorded — that is what adb over USB produces, and also older sideloads made before the phone kept this record.`; }
    } else if (kind === 'store') { channel = 'store'; chip = labelFor(who); tone = 'store'; summary = `Installed ${first} by ${nameOf(who)}.`; }
    else if (kind === 'vendor-store') { channel = 'vendor-store'; chip = "manufacturer's store"; tone = 'vendor'; summary = `Installed ${first} by ${nameOf(who)}.`; }
    else if (kind === 'apk') { channel = 'apk'; chip = 'APK file'; tone = 'side'; summary = `Installed by hand from an APK file ${first}${r.originating ? `, handed to the installer by ${nameOf(r.originating)}` : ''}.`; }
    else if (kind === 'adb') { channel = 'adb'; chip = 'adb / USB'; tone = 'side'; summary = `Installed over USB with adb ${first}.`; }
    else if (kind === 'transfer') { channel = 'transfer'; chip = 'phone transfer'; tone = 'store'; summary = `Brought over from another phone ${first} by ${nameOf(who)}.`; }
    else if (kind === 'restore') { channel = 'restore'; chip = 'restored'; tone = 'store'; summary = `Restored during setup ${first} by ${nameOf(who)}.`; }
    else if (kind === 'setup') { channel = 'setup'; chip = 'device setup'; tone = 'vendor'; summary = `Installed ${first} by ${nameOf(who)}.`; }
    else if (kind === 'policy') { channel = 'policy'; chip = 'device policy'; tone = 'warn'; summary = `Installed ${first} by ${nameOf(who)} — a management channel.`; }
    else if (kind === 'preload-channel') { channel = 'preload-channel'; chip = 'preload channel'; tone = 'vendor'; summary = `Installed ${first} by ${nameOf(who)} — a channel that delivers apps without a store visit.`; }
    else if (kind === 'system') { channel = 'system'; chip = 'system component'; tone = 'preload'; summary = `Installed ${first} by ${nameOf(who)}.`; }
    else { channel = 'app'; chip = 'another app'; tone = 'vendor'; summary = `Installed ${first} by ${nameOf(who)} — an app holding install rights, not a store.`; }
    if (r.lastUpdate && r.firstInstall && r.lastUpdate !== r.firstInstall && !isEpoch(r.firstInstall)) notes.push(`Last updated ${r.lastUpdate}.`);
    else if (r.lastUpdate && r.firstInstall && r.lastUpdate === r.firstInstall) notes.push('Never updated since it was installed.');
  }

  if (!r.installed) { chip = 'not installed'; tone = 'removed'; summary = `Record kept after removal for your user. ${summary}`; }
  if (!r.initiating && r.installer && !r.system) {
    notes.push(`The installer of record is ${nameOf(r.installer)}, but the phone did not see that app perform the install. "adb install -i" produces exactly this; so does an install made before this Android version started recording the initiator.`);
  } else if (r.initiating && r.installer && r.initiating !== r.installer) {
    notes.push(`Installer of record (${nameOf(r.installer)}) differs from the app that performed the install (${nameOf(r.initiating)}).`);
  }
  if (r.updateOwner) notes.push(`Future updates are owned by ${nameOf(r.updateOwner)}.`);
  if (INSTALL_REASON[r.installReason]) notes.push(`Install reason ${r.installReason}: ${INSTALL_REASON[r.installReason]}.`);
  if (PACKAGE_SOURCE[r.packageSource]) notes.push(`${PACKAGE_SOURCE[r.packageSource]} (packageSource=${r.packageSource}).`);
  if (r.installed && !r.system && r.notLaunched) notes.push('Never opened since it was installed (the phone\'s "not launched" flag is still set).');
  if (r.enabled != null && r.enabled >= 2) notes.push(`${ENABLED_STATE[r.enabled] || 'disabled'}${r.lastDisabledCaller ? ` — last disabled by ${nameOf(r.lastDisabledCaller)}` : ''}.`);
  if (r.hidden) notes.push('Hidden from the launcher (hidden flag set).');
  return { channel, chip, tone, summary, who: who || null, whoLabel: labelFor(who), via: r.originating || null, notes };
}

// One remembered install session, in a sentence.
function describeSession(s) {
  const when = s.committed > 0 ? new Date(s.committed) : s.created ? new Date(s.created) : null;
  const who = s.adb ? 'adb over USB' : s.initiating ? nameOf(s.initiating) : s.installer ? nameOf(s.installer) : 'an unrecorded installer';
  const verb = s.replace ? 'updated' : 'installed';
  const bits = [`${who} ${verb} it`];
  if (s.originalInstaller && s.originalInstaller !== s.installer && s.originalInstaller !== s.initiating) bits.push(`requested by ${nameOf(s.originalInstaller)}`);
  if (s.originating) bits.push(`file handed over by ${nameOf(s.originating)}`);
  if (s.staged) bits.push('part of a staged system update');
  if (s.reason === 4) bits.push('tagged user-requested by the installer');
  else if (INSTALL_REASON[s.reason]) bits.push(INSTALL_REASON[s.reason].split(' — ')[0]);
  const result = s.status === 1 ? 'installed'
    : s.failed || (s.status != null && s.status < 0) ? `failed${s.message ? ` (${s.message})` : ''}`
    : s.applied ? 'applied after a restart'
    : s.section === 'active' ? 'in progress'
    : s.staged ? 'staged, waiting for a restart'
    : s.message || '';
  return { when: when ? when.toISOString() : null, text: `${bits.join('; ')}${result ? ` — ${result}` : ''}`, id: s.id };
}

module.exports = { parsePackagesDump, parseBlock, parseInstallSessions, joinWrapped, classify, describeSession, labelFor, nameOf, partitionOf, isEpoch, isPlaceholderStamp, INSTALLERS, INSTALL_REASON, ENABLED_STATE };
