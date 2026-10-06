// system.js — pure parsers for the system-wide dumps the full report collects:
// properties, users, roles, the permission catalogue, feature flags, registered
// services, certificates and the security surfaces derived from the settings
// tables. No adb here, so test/system.test.js can run all of it on saved text.
//
// Every parser is deliberately forgiving: Android changes these dump formats
// between releases and vendors reshape them further, so an unrecognised line is
// skipped rather than throwing, and a shape a build does not produce comes back
// empty instead of wrong.
'use strict';

// getprop: "[ro.build.id]: [ABC123]". Values may span lines, so the closing
// bracket is matched at end-of-line rather than at the first "]".
function parseProps(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/^\[([^\]]+)\]:\s*\[([\s\S]*?)\]\s*$/gm)) out[m[1]] = m[2];
  return out;
}

// pm list users: "UserInfo{0:Owner:c13} running". The flags word is the same
// bitfield UserInfo uses, so a work profile can be told from a guest.
const USER_FLAGS = [
  ['primary', 0x1], ['admin', 0x2], ['guest', 0x4], ['restricted', 0x8],
  ['initialized', 0x10], ['managedProfile', 0x20], ['disabled', 0x40],
  ['quietMode', 0x80], ['ephemeral', 0x100], ['demo', 0x200], ['full', 0x400],
  ['system', 0x800], ['profile', 0x1000],
];
function parseUsers(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/UserInfo\{(\d+):([^:}]*):([0-9a-fA-F]+)\}([^\n]*)/g)) {
    const bits = parseInt(m[3], 16) || 0;
    const u = { id: +m[1], name: m[2], flags: `0x${m[3]}`, running: /\brunning\b/.test(m[4]) };
    for (const [name, bit] of USER_FLAGS) if (bits & bit) u[name] = true;
    out.push(u);
  }
  return out.sort((a, b) => a.id - b.id);
}

// The "<kind>:<value>" lists pm prints — packages, features, libraries.
function parsePmList(text, prefix = 'package') {
  const head = `${prefix}:`;
  const out = String(text || '').split('\n')
    .map(l => l.trim()).filter(l => l.startsWith(head))
    .map(l => l.slice(head.length).trim().split(/\s+/)[0]).filter(Boolean);
  return [...new Set(out)].sort();
}

// pm list instrumentation: "instrumentation:com.x/.Runner (target=com.y)".
// Test harnesses left on a shipping phone show up here.
function parseInstrumentation(text) {
  const out = [];
  for (const l of String(text || '').split('\n')) {
    const m = l.trim().match(/^instrumentation:(\S+)(?:\s+\(target=(\S+)\))?/);
    if (m) out.push({ component: m[1], target: m[2] || null });
  }
  return out.sort((a, b) => a.component.localeCompare(b.component));
}

// pm list permissions -g -f: groups, the permissions in each, and how strongly
// each one is protected (normal / dangerous / signature / privileged…).
function parsePermissionCatalog(text) {
  const out = {};
  let group = 'ungrouped', perm = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^\+?group:(\S*)$/))) { group = m[1] || 'ungrouped'; out[group] = out[group] || []; perm = null; }
    else if ((m = line.match(/^\+?permission:(\S+)$/))) { perm = { name: m[1], package: null, protection: null }; (out[group] = out[group] || []).push(perm); }
    else if (perm && (m = line.match(/^package:(\S+)$/))) perm.package = m[1];
    else if (perm && (m = line.match(/^protectionLevel:(.+)$/))) perm.protection = m[1].trim();
  }
  for (const g of Object.keys(out)) out[g].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// dumpsys role — which app holds each system role (home, dialer, SMS, browser,
// assistant). Two shapes are in the wild: a one-line RoleState on newer builds,
// an indented "role:" / "holders:" block on older ones.
function parseRoles(text) {
  const t = String(text || '');
  const out = {};
  for (const m of t.matchAll(/mName=([\w.]+)[\s\S]{0,400}?mHolders=\[([^\]]*)\]/g)) {
    out[m[1]] = m[2].split(',').map(s => s.trim()).filter(Boolean).sort();
  }
  if (Object.keys(out).length) return out;
  let role = null, inHolders = false;
  for (const raw of t.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^role:\s*([\w.]+)/);
    if (m) { role = m[1]; out[role] = out[role] || []; inHolders = false; continue; }
    if (/^holders:/i.test(line)) { inHolders = true; continue; }
    if (role && inHolders && /^[A-Za-z][\w]*(?:\.[\w]+)+$/.test(line)) out[role].push(line);
    else if (line && !/^[a-z]/i.test(line)) inHolders = false;
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].sort();
  return out;
}

// service list: "12  package: [android.content.pm.IPackageManager]" — every
// system service registered with the binder service manager.
function parseServices(text) {
  const out = [];
  for (const l of String(text || '').split('\n')) {
    const m = l.match(/^\s*\d+\s+([\w.\-@$]+):\s*\[(.*)\]\s*$/);
    if (m) out.push({ name: m[1], interface: m[2] || null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// cmd device_config list: "namespace/key=value". These are the server-pushed
// feature flags, so they say which behaviours are switched on for this phone.
function parseDeviceConfig(text) {
  const out = {};
  for (const l of String(text || '').split('\n')) {
    const m = l.match(/^([A-Za-z0-9_.\-]+)\/([^=\s]+)=([\s\S]*)$/);
    if (!m) continue;
    (out[m[1]] = out[m[1]] || {})[m[2]] = m[3];
  }
  return out;
}

// ps -A -o PID,PPID,USER,NAME
function parseProcesses(text) {
  const out = [];
  for (const l of String(text || '').split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (m) out.push({ pid: +m[1], ppid: +m[2], user: m[3], name: m[4].trim() });
  }
  return out.sort((a, b) => a.pid - b.pid);
}

// dumpsys webviewupdate: "Current WebView package (name, version): (com.x, 1.2)".
// The label carries its own "(name, version)", so the pair is taken from after
// the colon rather than from the first bracket on the line.
function parseWebView(text) {
  const line = String(text || '').match(/^.*Current WebView package.*$/im);
  if (!line) return null;
  const pair = line[0].match(/:\s*\(([^,)]+),\s*([^)]+)\)/);
  if (pair) return { package: pair[1].trim(), version: pair[2].trim() };
  const bare = line[0].match(/:\s*([A-Za-z][\w]*(?:\.[\w]+)+)/);
  return bare ? { package: bare[1], version: null } : null;
}

// The certificate listing is two `ls` runs joined under "== label ==" headers,
// because the store an app trusts is the system one plus anything added by hand.
// A user-added CA is what lets traffic be decrypted in the middle, so the count
// matters even when the directory itself cannot be read without root.
function parseCertList(text) {
  const out = { system: [], userAdded: [], userRemoved: [], readable: {} };
  let bucket = null;
  const KEY = { 'system': 'system', 'user-added': 'userAdded', 'user-removed': 'userRemoved' };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const h = line.match(/^==\s*(\S+)\s*==$/);
    if (h) { bucket = KEY[h[1]] || null; if (bucket) out.readable[bucket] = false; continue; }
    if (!bucket || !line) continue;
    if (/^\S+\.\d+$/.test(line)) { out[bucket].push(line); out.readable[bucket] = true; }
  }
  for (const k of ['system', 'userAdded', 'userRemoved']) out[k] = [...new Set(out[k])].sort();
  return { ...out, systemCount: out.system.length, userAddedCount: out.userAdded.length };
}

// A colon-separated component list as the settings tables store them.
const componentList = (s) => String(s || '').trim().split(':').map(x => x.trim()).filter(x => x && x !== 'null').sort();
const flag = (v) => (v == null ? null : v === '1');

// The security-relevant surfaces, read out of the settings tables the report
// already captures plus the device-policy dump. Everything here is a place
// something can watch, type for, redirect or manage the phone from.
function surfacesFrom(settings = {}, devicePolicy = '') {
  const sec = settings.secure || {}, glob = settings.global || {};
  const dp = String(devicePolicy || '');
  const owner = dp.match(/Device Owner:[\s\S]{0,300}?ComponentInfo\{([^}]+)\}/);
  const profileOwner = dp.match(/Profile Owner[\s\S]{0,300}?ComponentInfo\{([^}]+)\}/);
  return {
    accessibilityServices: componentList(sec.enabled_accessibility_services),
    accessibilityEnabled: flag(sec.accessibility_enabled),
    notificationListeners: componentList(sec.enabled_notification_listeners),
    notificationAssistant: sec.enabled_notification_assistant || null,
    inputMethods: componentList(sec.enabled_input_methods),
    defaultInputMethod: sec.default_input_method || null,
    autofillService: sec.autofill_service || null,
    assistant: sec.assistant || sec.voice_interaction_service || null,
    alwaysOnVpn: sec.always_on_vpn_app || null,
    alwaysOnVpnLockdown: flag(sec.always_on_vpn_lockdown),
    privateDns: { mode: glob.private_dns_mode || null, host: glob.private_dns_specifier || null },
    locationMode: sec.location_mode ?? null,
    locationProviders: componentList(String(sec.location_providers_allowed || '').replace(/,/g, ':')),
    adbEnabled: flag(glob.adb_enabled),
    adbOverWifi: flag(glob.adb_wifi_enabled),
    developerOptions: flag(glob.development_settings_enabled),
    installUnknownApps: sec.install_non_market_apps ?? glob.install_non_market_apps ?? null,
    appVerification: {
      packageVerifier: flag(glob.package_verifier_enabled),
      verifyAdbInstalls: flag(glob.verifier_verify_adb_installs),
      uploadApks: flag(glob.upload_apk_enable),
    },
    deviceAdmins: [...new Set([...dp.matchAll(/admin=ComponentInfo\{([^}/]+)/g)].map(m => m[1]))].sort(),
    deviceOwner: owner ? owner[1] : null,
    profileOwner: profileOwner ? profileOwner[1] : null,
  };
}

module.exports = {
  parseProps, parseUsers, parsePmList, parseInstrumentation, parsePermissionCatalog,
  parseRoles, parseServices, parseDeviceConfig, parseProcesses, parseWebView,
  parseCertList, surfacesFrom, USER_FLAGS,
};
