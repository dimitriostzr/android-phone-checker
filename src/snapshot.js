// snapshot.js — "Save state": a compact, comparable picture of the phone, taken
// before and after a system update so the two can be diffed. Pure functions:
// build() turns raw command outputs into a snapshot, diff() compares two.
// No adb here, so test/snapshot.test.js can run it on saved text.
'use strict';
const { parsePackagesDump, classify } = require('./origin');

const SNAPSHOT_VERSION = 1;

// Identity lines an update is expected to change. Label → property.
const IDENTITY_PROPS = [
  ['Build', ['ro.build.display.id', 'ro.build.id']],
  ['Fingerprint', ['ro.build.fingerprint']],
  ['Incremental version', ['ro.build.version.incremental']],
  ['Android', ['ro.build.version.release']],
  ['SDK', ['ro.build.version.sdk']],
  ['Security patch', ['ro.build.version.security_patch']],
  ['Vendor UI version', ['ro.build.version.oneui', 'ro.build.version.sep']],
  ['Build date', ['ro.build.date']],
  ['Baseband', ['gsm.version.baseband']],
  ['Bootloader', ['ro.bootloader']],
  ['Vendor fingerprint', ['ro.vendor.build.fingerprint']],
  ['Verified boot', ['ro.boot.verifiedbootstate']],
  ['Bootloader locked', ['ro.boot.flash.locked']],
  ['Sales code', ['ro.csc.sales_code', 'ro.csc.omcnw_code']],
];

// Only permissions worth a line in a before/after comparison are stored.
const SENSITIVE_PERM_RE = /(CAMERA|RECORD_AUDIO|LOCATION|CONTACTS|_SMS|MMS|CALL_LOG|PHONE|CALENDAR|MEDIA|STORAGE|BODY_SENSORS|ACTIVITY_RECOGNITION|INSTALL_PACKAGES|DELETE_PACKAGES|SYSTEM_ALERT_WINDOW|PACKAGE_USAGE_STATS|BIND_ACCESSIBILITY_SERVICE|BIND_DEVICE_ADMIN|BIND_NOTIFICATION_LISTENER_SERVICE|READ_LOGS|\.DUMP$|WRITE_SECURE_SETTINGS|INTERACT_ACROSS_USERS|CAPTURE_AUDIO|READ_PRIVILEGED_PHONE_STATE|MANAGE_USERS|BLUETOOTH_CONNECT|NEARBY|POST_NOTIFICATIONS|QUERY_ALL_PACKAGES|CLIPBOARD|ACCESS_NOTIFICATIONS|MANAGE_DEVICE_ADMINS|BIND_VPN_SERVICE|CONTROL_VPN)/;

// Settings keys that churn on their own (counters, timestamps, tokens) are kept
// in the diff but tagged so the UI can fold them away.
const NOISE_KEY_RE = /(^|_)(time|timestamp|ts|count|counter|last|seq|nonce|token|uptime|id|ids|cache|stat|stats|bucket|hash|sync|epoch|date|millis|elapsed|attempts|retry|checksum|session|boot|clock|tz|fetch|pull)(_|$)/i;

function propReader(props) {
  return (k) => { const m = props.match(new RegExp(`\\[${k.replace(/\./g, '\\.')}\\]: \\[([^\\]]*)\\]`)); return m ? m[1] : ''; };
}
function parseSettingsList(text) {
  const out = {};
  for (const line of (text || '').split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
const splitList = (s) => (s || '').trim().split(':').map(x => x.split('/')[0]).filter(x => x && x !== 'null').sort();

// { ts, label, device, props, kernel, packagesDump, settings:{global,secure,system},
//   accessibility, listeners, devicePolicy, battery:{restricted,unrestricted} } → snapshot
function build(input) {
  const p = propReader(input.props || '');
  const identity = {};
  for (const [label, keys] of IDENTITY_PROPS) { const v = keys.map(p).find(Boolean); if (v) identity[label] = v; }
  if (input.kernel) identity['Kernel'] = input.kernel.trim();
  const packages = {};
  for (const r of Object.values(parsePackagesDump(input.packagesDump || ''))) {
    packages[r.pkg] = {
      v: r.versionName, vc: r.versionCode,
      sys: r.system ? 1 : 0, upd: r.updatedSystem ? 1 : 0,
      en: r.enabled == null ? 0 : r.enabled, inst: r.installed ? 1 : 0,
      by: r.installer, init: r.initiating,
      first: r.firstInstall, last: r.lastUpdate,
      perms: r.granted.filter(x => SENSITIVE_PERM_RE.test(x)),
    };
  }
  const dp = input.devicePolicy || '';
  return {
    v: SNAPSHOT_VERSION,
    ts: input.ts || new Date().toISOString(),
    label: input.label || '',
    device: input.device || {},
    identity,
    packages,
    settings: {
      global: parseSettingsList(input.settings && input.settings.global),
      secure: parseSettingsList(input.settings && input.settings.secure),
      system: parseSettingsList(input.settings && input.settings.system),
    },
    surfaces: {
      accessibility: splitList(input.accessibility),
      listeners: splitList(input.listeners),
      admins: [...new Set([...dp.matchAll(/admin=ComponentInfo\{([^}/]+)/g)].map(m => m[1]))].sort(),
    },
    battery: {
      restricted: [...(input.battery && input.battery.restricted || [])].sort(),
      unrestricted: [...(input.battery && input.battery.unrestricted || [])].sort(),
    },
  };
}

// The small row shown in the list of saved states.
function summary(snap, id) {
  const pk = Object.values(snap.packages || {});
  return {
    id, ts: snap.ts, label: snap.label || '',
    build: snap.identity['Build'] || '', patch: snap.identity['Security patch'] || '', android: snap.identity['Android'] || '',
    counts: { packages: pk.length, user: pk.filter(x => !x.sys && x.inst).length, disabled: pk.filter(x => x.en >= 2).length, settings: Object.keys(snap.settings.global).length + Object.keys(snap.settings.secure).length + Object.keys(snap.settings.system).length },
  };
}

const isDisabled = (en) => en != null && en >= 2;
const isNoisy = (key, a, b) => NOISE_KEY_RE.test(key) || (/^\d{9,}$/.test(a || '') && /^\d{9,}$/.test(b || ''));

function diffLists(a, b) {
  const A = new Set(a || []), B = new Set(b || []);
  return { added: [...B].filter(x => !A.has(x)), removed: [...A].filter(x => !B.has(x)) };
}
function diffSettings(a, b) {
  const out = { added: [], removed: [], changed: [], noisy: 0 };
  for (const k of Object.keys(b)) {
    if (!(k in a)) out.added.push({ key: k, b: b[k], noisy: isNoisy(k, null, b[k]) });
    else if (a[k] !== b[k]) out.changed.push({ key: k, a: a[k], b: b[k], noisy: isNoisy(k, a[k], b[k]) });
  }
  for (const k of Object.keys(a)) if (!(k in b)) out.removed.push({ key: k, a: a[k], noisy: isNoisy(k, a[k], null) });
  for (const arr of [out.added, out.removed, out.changed]) { arr.sort((x, y) => x.key.localeCompare(y.key)); out.noisy += arr.filter(x => x.noisy).length; }
  return out;
}

// older, newer → grouped changes. Every group is present (possibly empty) so the
// renderer can say "no change" per area rather than staying silent.
function diff(older, newer) {
  const identity = [];
  for (const k of new Set([...Object.keys(older.identity), ...Object.keys(newer.identity)])) {
    if (older.identity[k] !== newer.identity[k]) identity.push({ key: k, a: older.identity[k] || '', b: newer.identity[k] || '' });
  }
  const P = { added: [], removed: [], updated: [], reenabled: [], disabled: [], installerChanged: [], flagChanged: [], reinstalled: [], uninstalled: [] };
  const A = older.packages || {}, B = newer.packages || {};
  for (const pkg of Object.keys(B)) {
    const b = B[pkg], a = A[pkg];
    if (!a) { P.added.push({ pkg, ...b }); continue; }
    if (a.inst && !b.inst) P.uninstalled.push({ pkg, sys: b.sys });
    else if (!a.inst && b.inst) P.reinstalled.push({ pkg, sys: b.sys, by: b.init || b.by });
    if ((a.vc != null && b.vc != null && a.vc !== b.vc) || (a.v !== b.v)) P.updated.push({ pkg, sys: b.sys, a: a.v, b: b.v, avc: a.vc, bvc: b.vc, by: b.init || b.by, when: b.last });
    if (isDisabled(a.en) && !isDisabled(b.en) && b.inst) P.reenabled.push({ pkg, sys: b.sys, a: a.en, b: b.en });
    if (!isDisabled(a.en) && isDisabled(b.en)) P.disabled.push({ pkg, sys: b.sys, a: a.en, b: b.en });
    if ((a.by || null) !== (b.by || null) || (a.init || null) !== (b.init || null)) P.installerChanged.push({ pkg, sys: b.sys, a: { by: a.by, init: a.init }, b: { by: b.by, init: b.init } });
    if (a.sys !== b.sys || a.upd !== b.upd) P.flagChanged.push({ pkg, a: { sys: a.sys, upd: a.upd }, b: { sys: b.sys, upd: b.upd } });
  }
  for (const pkg of Object.keys(A)) if (!B[pkg]) P.removed.push({ pkg, ...A[pkg] });
  for (const k of Object.keys(P)) P[k].sort((x, y) => x.pkg.localeCompare(y.pkg));

  const perms = [];
  for (const pkg of Object.keys(B)) {
    if (!A[pkg]) continue;
    const d = diffLists(A[pkg].perms, B[pkg].perms);
    if (d.added.length || d.removed.length) perms.push({ pkg, sys: B[pkg].sys, granted: d.added, revoked: d.removed });
  }
  perms.sort((x, y) => x.pkg.localeCompare(y.pkg));

  const surfaces = {};
  for (const k of ['accessibility', 'listeners', 'admins']) surfaces[k] = diffLists(older.surfaces[k], newer.surfaces[k]);
  const battery = [];
  const bstate = (s, pkg) => s.battery.restricted.includes(pkg) ? 'restricted' : s.battery.unrestricted.includes(pkg) ? 'unrestricted' : 'optimized';
  for (const pkg of new Set([...older.battery.restricted, ...older.battery.unrestricted, ...newer.battery.restricted, ...newer.battery.unrestricted])) {
    const a = bstate(older, pkg), b = bstate(newer, pkg);
    if (a !== b) battery.push({ pkg, a, b });
  }
  battery.sort((x, y) => x.pkg.localeCompare(y.pkg));

  const settings = { global: diffSettings(older.settings.global, newer.settings.global), secure: diffSettings(older.settings.secure, newer.settings.secure), system: diffSettings(older.settings.system, newer.settings.system) };
  const settingsTotal = ['global', 'secure', 'system'].reduce((n, ns) => n + settings[ns].added.length + settings[ns].removed.length + settings[ns].changed.length, 0);
  const total = identity.length + Object.values(P).reduce((n, l) => n + l.length, 0) + perms.length
    + Object.values(surfaces).reduce((n, d) => n + d.added.length + d.removed.length, 0) + battery.length + settingsTotal;
  return {
    older: { ts: older.ts, label: older.label, build: older.identity['Build'] || '', patch: older.identity['Security patch'] || '' },
    newer: { ts: newer.ts, label: newer.label, build: newer.identity['Build'] || '', patch: newer.identity['Security patch'] || '' },
    identity, packages: P, perms, surfaces, battery, settings, total, settingsTotal,
  };
}

// Plain-language origin of a package added between two snapshots — classify()
// needs the full record shape, so the compact one is widened back.
function originOfAdded(rec) {
  return classify({
    pkg: rec.pkg, system: !!rec.sys, updatedSystem: !!rec.upd, codePath: rec.sys ? '/system' : '/data/app',
    installer: rec.by, initiating: rec.init, originating: null, updateOwner: null, packageSource: null,
    timeStamp: rec.last, lastUpdate: rec.last, firstInstall: rec.first, installReason: null,
    installed: !!rec.inst, enabled: rec.en, hidden: false, stopped: false, notLaunched: false, lastDisabledCaller: null,
  });
}

module.exports = { build, diff, summary, originOfAdded, parseSettingsList, isNoisy, SNAPSHOT_VERSION, SENSITIVE_PERM_RE };
