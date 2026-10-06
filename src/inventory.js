// inventory.js — the adb reads behind the Install origins view and Save state.
// Read-only, like the check engine: package records and install sessions come
// from `dumpsys package`, settings from `settings list`. Parsing and wording
// live in origin.js / snapshot.js so they stay testable without a phone.
'use strict';
const { shell, failCount } = require('./adb');
const { KB } = require('./profiles');
const { parsePackagesDump, parseInstallSessions, classify, describeSession, partitionOf } = require('./origin');
const { batterySets } = require('./checks');
const snapshot = require('./snapshot');

const DUMP_TIMEOUT = 90000;
const UNREADABLE = 'Could not read the package records from the phone (the dumpsys read failed or returned nothing) — no results. Check the connection and try again.';

// The install sessions the phone still remembers. `dumpsys package installs`
// is the direct route; a build that does not know the sub-command gets the
// section cut out of the full dump instead.
async function readSessions() {
  let out = await shell('dumpsys package installs 2>/dev/null', DUMP_TIMEOUT);
  if (!/install sessions:/.test(out)) {
    const full = await shell('dumpsys package 2>/dev/null', DUMP_TIMEOUT);
    const i = full.indexOf('Active install sessions:');
    out = i >= 0 ? full.slice(i) : '';
  }
  return parseInstallSessions(out);
}

function present(r, sessions) {
  const origin = classify(r);
  const own = sessions.filter(s => s.pkg === r.pkg).map(describeSession).sort((a, b) => (b.when || '').localeCompare(a.when || ''));
  const { granted, ...rest } = r;
  return { ...rest, known: KB[r.pkg] ? KB[r.pkg].name : null, partition: partitionOf(r.codePath), origin, sessions: own };
}

// Every package on the phone with its origin — one big dump, one session list.
async function readOrigins() {
  const f0 = failCount();
  const [dump, sessions] = await Promise.all([shell('dumpsys package packages 2>/dev/null', DUMP_TIMEOUT), readSessions()]);
  if (failCount() > f0 || !dump.includes('Package [')) return { error: UNREADABLE };
  const records = Object.values(parsePackagesDump(dump)).map(r => present(r, sessions));
  return { records, sessionsRemembered: sessions.length };
}

// One package, for the Origin button on the other views.
async function readOrigin(pkg) {
  const f0 = failCount();
  const [dump, sessions] = await Promise.all([shell(`dumpsys package ${pkg} 2>/dev/null`, DUMP_TIMEOUT), readSessions()]);
  if (failCount() > f0) return { error: UNREADABLE };
  const rec = parsePackagesDump(dump)[pkg];
  if (!rec) return { error: `No package record for ${pkg} on this phone.` };
  return { record: present(rec, sessions) };
}

// Everything a before/after comparison needs, read in one go. A failed read
// would make the comparison lie, so a partial snapshot is never returned.
async function captureSnapshot(device, label) {
  const f0 = failCount();
  const [props, kernel, dump, global, secure, system, accessibility, listeners, devicePolicy, battery] = await Promise.all([
    shell('getprop'),
    shell('uname -r 2>/dev/null'),
    shell('dumpsys package packages 2>/dev/null', DUMP_TIMEOUT),
    shell('settings list global 2>/dev/null'),
    shell('settings list secure 2>/dev/null'),
    shell('settings list system 2>/dev/null'),
    shell('settings get secure enabled_accessibility_services'),
    shell('settings get secure enabled_notification_listeners'),
    shell('dumpsys device_policy 2>/dev/null'),
    batterySets(),
  ]);
  if (failCount() > f0) return { error: 'Could not read everything from the phone (an adb command failed mid-way) — nothing was saved, because a partial snapshot would make the comparison wrong. Check the cable and try again.' };
  if (!dump.includes('Package [') || !props.includes('[ro.build')) return { error: UNREADABLE };
  return {
    snapshot: snapshot.build({
      ts: new Date().toISOString(), label,
      device: { serial: device.serial, model: device.model, manufacturer: device.manufacturer },
      props, kernel, packagesDump: dump,
      settings: { global, secure, system },
      accessibility, listeners, devicePolicy, battery,
    }),
  };
}

module.exports = { readOrigins, readOrigin, captureSnapshot, readSessions };
