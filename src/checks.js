// checks.js — the read-only check engine. Every check returns
// { id, title, status: 'ok'|'flag'|'note'|'info'|'skip', lines: [] }.
// Baselines are learned per-device on first run and diffed afterwards.
'use strict';
const { shell, failCount } = require('./adb');
const { forDevice, KB } = require('./profiles');

async function listPackages(flags = '') {
  const out = await shell(`pm list packages ${flags} --user 0 2>/dev/null`);
  return out.split('\n').filter(l => l.startsWith('package:')).map(l => l.slice(8).trim());
}
async function listPackagesWithInstaller() {
  const out = await shell('pm list packages -3 -i --user 0 2>/dev/null');
  const map = {};
  for (const l of out.split('\n')) {
    const m = l.match(/^package:(\S+)\s+installer=(\S+)/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}
const setting = (ns, key) => shell(`settings get ${ns} ${key}`).then(s => s.trim());

// Scope of each check, shown as a chip in the UI. (The debloat scope lives in
// the advisor view rather than in these checks.)
const SCOPES = {
  integrity: 'security', tripwires: 'security', surfaces: 'security', packages: 'security',
  installers: 'security', masquerade: 'security', network: 'security', store: 'security',
  keyboards: 'privacy', privacy: 'privacy',
};

async function runChecks(device, baseline, emit) {
  const profile = forDevice(device.manufacturer);
  const results = [];
  const add = (r) => { r.scope = SCOPES[r.id] || 'security'; results.push(r); emit && emit(r); };
  // A failed adb read comes back as an empty string, which every parser here
  // would happily read as "nothing found" — a false all-clear. Each check
  // snapshots the adb failure counter first; if any of its reads failed, the
  // whole check reports 'skip' instead of a result, and baselines stay untouched.
  const UNREADABLE = 'Could not read this from the phone (an adb command failed mid-run) — no result recorded, and this is NOT counted as passed. Check the cable and the phone, then run the checks again.';
  const guard = (r, f0) => failCount() > f0 ? { id: r.id, title: r.title, status: 'skip', lines: [UNREADABLE] } : r;

  // 1. Boot & OS integrity
  {
    const f0 = failCount();
    const lines = [];
    let status = 'ok';
    if (device.verifiedBoot === 'green') lines.push('Verified boot: green');
    else if (device.verifiedBoot) { status = 'flag'; lines.push(`Verified boot: ${device.verifiedBoot} (expected green)`); }
    else lines.push('Verified boot: not reported by this device — could not confirm');
    if (device.bootloaderLocked === '1') lines.push('Bootloader: locked'); else { status = 'flag'; lines.push(`Bootloader locked: ${device.bootloaderLocked || 'unknown'}`); }
    if (profile.samsung && device.knoxWarranty === '0') lines.push('Knox warranty bit: 0 (never tripped)');
    // `|| true` because `which` exits non-zero when su is absent — the good case.
    const su = await shell('which su 2>/dev/null || true');
    if (su.trim()) { status = 'flag'; lines.push(`su binary present: ${su.trim()} (device may be rooted)`); } else lines.push('No su binary (not rooted)');
    lines.push(`Security patch: ${device.patch}`);
    add(guard({ id: 'integrity', title: 'Boot & OS integrity', status, lines }, f0));
  }

  // 2. Stalkerware & preload tripwires. Two very different things, kept clearly apart:
  // matches against public stalkerware indicator lists (verify before acting), and
  // ordinary legitimate apps documented to ARRIVE via preload/partner campaigns —
  // flagging those says nothing about the app itself, only that its presence is worth
  // confirming if the user does not remember installing it.
  {
    const f0 = failCount();
    const all = await listPackages('-u');
    const spy = profile.stalkerware.filter(p => all.includes(p));
    const pre = profile.tripwires.filter(p => all.includes(p));
    const lines = []; let status = 'ok';
    if (spy.length) {
      status = 'flag';
      for (const p of spy) lines.push(`${p} matches a publicly documented stalkerware indicator — verify this finding yourself before acting on it`);
      lines.push('Safety note: if someone else may have put a monitoring app on this phone, disabling it can be noticed by that person. Consider your situation first — stopstalkerware.org has guidance.');
    }
    if (pre.length) {
      status = 'flag';
      lines.push('Present here, and documented — in public security research or in the case records behind this project — to arrive via preload/partner campaigns on some devices. These are ordinary apps — this is about how they can arrive, not what they are:');
      for (const p of pre) lines.push(`  ${p} — fine if you chose to install it; if it appeared on its own, check its install source in the Apps tab`);
    }
    if (!lines.length) lines.push('No stalkerware indicators and no preload-campaign packages present');
    // An empty package list on a live device means the read failed, not a bare phone.
    add(guard({ id: 'tripwires', title: 'Stalkerware & preload tripwires', status, lines }, all.length ? f0 : -1));
  }

  // 3. Spyware capability surfaces (learned baseline)
  {
    const f0 = failCount();
    const acc = (await setting('secure', 'enabled_accessibility_services')).split(':').map(s => s.split('/')[0]).filter(s => s && s !== 'null');
    const lis = (await setting('secure', 'enabled_notification_listeners')).split(':').map(s => s.split('/')[0]).filter(s => s && s !== 'null');
    const dp = await shell('dumpsys device_policy 2>/dev/null');
    const admins = [...new Set([...dp.matchAll(/admin=ComponentInfo\{([^}/]+)/g)].map(m => m[1]))];
    const owner = /Device owner/.test(dp) && !/Device owner user: N\/A/.test(dp) && /Device owner.*ComponentInfo/.test(dp);
    const cur = { accessibility: acc.sort(), listeners: lis.sort(), admins: admins.sort() };
    const lines = []; let status = 'ok';
    if (owner) { status = 'flag'; lines.push('A DEVICE OWNER is set — this phone is remotely managed (MDM). Expected only on corporate devices.'); }
    if (!baseline.surfaces) {
      status = 'note';
      lines.push('First run — recording your current setup as trusted. REVIEW these:');
      lines.push(`Accessibility services: ${acc.join(', ') || '(none)'}`);
      lines.push(`Notification listeners: ${lis.join(', ') || '(none)'}`);
      lines.push(`Device admins: ${admins.join(', ') || '(none)'}`);
    } else {
      for (const [k, label] of [['accessibility', 'accessibility service'], ['listeners', 'notification listener'], ['admins', 'device admin']]) {
        const added = cur[k].filter(x => !baseline.surfaces[k].includes(x));
        if (added.length) { status = 'flag'; lines.push(`NEW ${label}(s) since baseline: ${added.join(', ')}`); }
      }
      if (status === 'ok') lines.push('Accessibility, notification listeners and device admins unchanged since baseline');
    }
    if (failCount() === f0) baseline.surfaces = cur;
    add(guard({ id: 'surfaces', title: 'Spyware capability surfaces', status, lines }, f0));
  }

  // 4. New packages since baseline (system + user)
  {
    const f0 = failCount();
    const all = (await listPackages()).sort();
    const installers = await listPackagesWithInstaller();
    // An empty full-package list means the read failed — never diff or baseline it.
    const readOk = failCount() === f0 && all.length > 0;
    const lines = []; let status = 'ok';
    if (!baseline.packages) {
      status = 'note';
      lines.push(`First run on this phone — nothing to compare against yet, so no package is new. The ${all.length} installed right now are recorded as the baseline, and the next run lists whatever appeared in between.`);
      lines.push('→ To see when each app already on this phone arrived and which app installed it, open the Install origins tab.');
    } else {
      const added = all.filter(p => !baseline.packages.includes(p));
      const removed = baseline.packages.filter(p => !all.includes(p));
      if (added.length) {
        status = 'flag';
        lines.push(`${added.length} package(s) appeared since the last run (fine if you installed them; a new SYSTEM package means a firmware or preload push):`);
        for (const p of added) lines.push(`  ${p}  ${installers[p] ? `via ${installers[p]}` : '(system/preload)'}`);
        lines.push('→ Open Install origins for the install date, the app that installed it and the install session behind any package listed here.');
      } else lines.push('No new packages of any kind since last run');
      if (removed.length) lines.push(`Removed since last run: ${removed.join(', ')}`);
    }
    if (readOk) baseline.packages = all;
    add(guard({ id: 'packages', title: 'New packages since last run', status, lines }, readOk ? f0 : -1));
  }

  // 5. Install sources (sideloads you have marked as known are not re-flagged)
  {
    const f0 = failCount();
    const installers = await listPackagesWithInstaller();
    const trustedSide = baseline.trustedSideloads || [];
    const bad = Object.entries(installers).filter(([, inst]) => inst !== 'null' && !forDevice(device.manufacturer).trustedInstallers.includes(inst));
    const sideloaded = Object.entries(installers).filter(([p, inst]) => inst === 'null' && !trustedSide.includes(p));
    const lines = []; let status = 'ok'; let action = null;
    if (bad.length) { status = 'flag'; lines.push('Apps from untrusted installers:'); bad.forEach(([p, i]) => lines.push(`  ${p} via ${i}`)); }
    else lines.push('Every store-installed app came from a trusted store');
    if (sideloaded.length) {
      if (status === 'ok') status = 'note';
      lines.push('Sideloaded (no installer of record) — confirm you know each:');
      sideloaded.forEach(([p]) => lines.push(`  ${p}`));
      action = { ipc: 'trustSideloads', label: 'These are mine — stop asking', payload: sideloaded.map(([p]) => p) };
    }
    if (trustedSide.length) lines.push(`${trustedSide.length} sideload(s) previously marked as yours (tracked, not re-flagged)`);
    add(guard({ id: 'installers', title: 'Install sources', status, lines, action }, f0));
  }

  // 6. System-namespace masquerade: a SIDELOADED app posing as a system component.
  // (Store-updated system apps and OEM modules also appear "user-installed" on One UI,
  //  so only flag system-namespace packages with no trusted installer of record.)
  {
    const f0 = failCount();
    const tp = await listPackages('-3');
    const installers = await listPackagesWithInstaller();
    const trusted = profile.trustedInstallers;
    const masq = tp.filter(p =>
      /^(com\.android\.|com\.samsung\.|com\.sec\.|com\.google\.android\.)/.test(p) &&
      !trusted.includes(installers[p]));
    add(guard(masq.length
      ? { id: 'masquerade', title: 'Masquerading package names', status: 'flag', lines: masq.map(p => `${p} — sideloaded app using a system namespace (installer: ${installers[p] || 'none'}) — verify it`) }
      : { id: 'masquerade', title: 'Masquerading package names', status: 'ok', lines: ['No sideloaded app hides in system namespaces'] }, f0));
  }

  // 7. Network & debug surfaces
  {
    const f0 = failCount();
    const lines = []; let status = 'ok';
    const wadb = await setting('global', 'adb_wifi_enabled');
    if (wadb === '1') { status = 'flag'; lines.push('WIRELESS debugging is ON — turn it off unless you enabled it right now'); } else lines.push('Wireless debugging off');
    const usb = await setting('global', 'adb_enabled');
    lines.push(usb === '1'
      ? 'USB debugging: ON — it has to be for this app to talk to the phone. Turn it off in Developer options when you finish checking.'
      : 'USB debugging: off');
    if (profile.samsung) {
      let ab = await setting('global', 'auto_blocker_enabled');
      if (ab !== '0' && ab !== '1') ab = await setting('secure', 'auto_blocker_enabled');
      if (ab === '1') lines.push('Auto Blocker: on');
      else if (ab === '0') {
        if (status === 'ok') status = 'note';
        lines.push('Auto Blocker is OFF — fine while you use adb tools like this one, but turn it back ON in Settings > Security and privacy when you are done.');
      } else lines.push('Auto Blocker: not readable over adb on this build — verify it is ON in Settings > Security and privacy (off only while using adb tools).');
    }
    const proxy = await setting('global', 'http_proxy');
    if (proxy && proxy !== 'null' && proxy !== ':0') { status = 'flag'; lines.push(`Global HTTP proxy set: ${proxy}`); } else lines.push('No global proxy');
    const aov = await setting('secure', 'always_on_vpn_app');
    if (aov && aov !== 'null') lines.push(`Always-on VPN: ${aov} (verify this is your own VPN app)`); else lines.push('No always-on VPN');
    const pdns = await setting('global', 'private_dns_mode');
    lines.push(`Private DNS mode: ${pdns}${pdns === 'hostname' ? ` (${await setting('global', 'private_dns_specifier')})` : ''}`);
    add(guard({ id: 'network', title: 'Network & debug surfaces', status, lines }, f0));
  }

  // 8. Keyboards (keylogger check). Google/Samsung/SwiftKey namespaces are stock
  // (Google Speech Services registers a voice-typing IME as com.google.android.tts).
  {
    const f0 = failCount();
    const imes = (await setting('secure', 'enabled_input_methods')).split(':').map(s => s.split('/')[0]).filter(Boolean);
    const odd = imes.filter(i => !/^(com\.google\.android\.|com\.google\.|com\.samsung\.|com\.sec\.|com\.touchtype\.)/.test(i));
    // Zero enabled keyboards is impossible on a working phone — treat as a failed read.
    add(guard(odd.length
      ? { id: 'keyboards', title: 'Enabled keyboards', status: 'flag', lines: odd.map(i => `Third-party keyboard ENABLED: ${i} — a keyboard sees everything you type; make sure you chose it`) }
      : { id: 'keyboards', title: 'Enabled keyboards', status: 'ok', lines: [`Enabled keyboards: ${imes.join(', ')} (all stock vendors)`] }, imes.length ? f0 : -1));
  }

  // 9. Privacy-hardening settings (baseline shared with the Phone settings tab).
  // Leanness entries are pure preferences and warn entries carry trade-offs the
  // user must opt into — the health check audits neither.
  {
    const f0 = failCount();
    const table = profile.settingsBaseline.filter(s => s.cat !== 'leanness' && !s.warn);
    const lines = []; let off = 0;
    for (const s of table) {
      const cur = await setting(s.ns, s.key);
      const unset = !cur || cur === 'null';
      const shown = unset ? 'unset' : cur;
      if (cur === s.want || (s.unsetOk && unset)) lines.push(`✓ ${s.key} = ${shown} — ${s.desc}`);
      else { off++; lines.push(`✗ ${s.key} = ${shown} — recommended ${s.want} (${s.desc})`); }
    }
    lines.sort((a, b) => (a.startsWith('✓') ? 1 : 0) - (b.startsWith('✓') ? 1 : 0));
    lines.unshift(off
      ? `${off} of ${table.length} audited settings differ (✗) from the hardened privacy baseline — all ${table.length} are listed below. Each is a preference, not a sign of compromise:`
      : `All ${table.length} audited settings match the hardened privacy baseline:`);
    if (off) lines.push('→ You can apply the recommended values from the Phone settings tab — each change asks for confirmation and can be undone there.');
    add(guard({ id: 'privacy', title: 'Privacy-hardening settings', status: off ? 'note' : 'ok', lines }, f0));
  }

  // 10. Manufacturer store background activity (only on devices whose maker
  // preloads its own privileged store — the package comes from the vendor table).
  if (profile.storePkg) {
    const f0 = failCount();
    const ops = await shell(`appops get ${profile.storePkg} START_FOREGROUND 2>/dev/null`);
    const lines = ops.split('\n').filter(l => /top-s|fgsvc-s|bg-s/.test(l)).map(l => l.trim());
    if (lines.length) {
      lines.push('How to read this: each line is the last time the preinstalled store ran, tagged with what it was doing at that moment.');
      lines.push('"top" — the store was open on your screen. That activity was you using it; normal.');
      lines.push('"fgsvc" or "bg" — the store was running with nothing on screen (a background service).');
      lines.push('Background times are expected if auto-update is on. If auto-update is OFF and a fresh fgsvc/bg time still appears, the store installed or updated something on its own — worth investigating.');
    } else {
      lines.push('No recorded store service activity — nothing to explain.');
    }
    add(guard({ id: 'store', title: 'Preinstalled store background activity', status: 'info', lines }, f0));
  }

  return { results, baseline };
}

// Proposals: cross the knowledge base with what is installed & enabled right now.
async function buildProposals(device) {
  const profile = forDevice(device.manufacturer);
  const installed = await listPackages();
  const disabled = await listPackages('-d');
  // Same reason the Apps view reads these: "disabled" covers several Android
  // states and only one of them can be switched back on over adb. Without the
  // number, a preload the system switched off looks identical to one this app
  // disabled, and gets an Enable button that Android refuses.
  const states = await enabledStates();
  const out = [];
  for (const [pkg, info] of Object.entries(profile.kb)) {
    if (!installed.includes(pkg) && !disabled.includes(pkg)) continue;
    out.push({ pkg, ...info, state: disabled.includes(pkg) ? 'disabled' : 'enabled', enabled: states[pkg] });
  }
  const order = { recommended: 0, optional: 1, caution: 2, keep: 3 };
  out.sort((a, b) => (order[a.tier] - order[b.tier]) || a.pkg.localeCompare(b.pkg));
  return out;
}

// Battery state per app, read from Android's own mechanisms: RUN_ANY_IN_BACKGROUND
// in mode "ignore" is what the Settings "Restricted" state sets; the deviceidle
// user whitelist is "Unrestricted"; everything else is the default "Optimized".
async function batterySets() {
  const wl = await shell('dumpsys deviceidle whitelist 2>/dev/null');
  const unrestricted = new Set([...wl.matchAll(/^user,([^,]+),/gm)].map(m => m[1]));
  const q = await shell('cmd appops query-op RUN_ANY_IN_BACKGROUND ignore 2>/dev/null');
  const restricted = new Set(q.split('\n')
    .map(l => (l.trim().match(/^([A-Za-z][\w]*(?:\.[\w]+)+)$/) || [])[1]).filter(Boolean));
  return { restricted, unrestricted };
}

// ---------- permission audit (read-only) ----------
// Which installed apps hold each sensitive permission, read from the phone's own
// package records in one dump; special-access grants come from the app-ops table.
const PERM_GROUPS = [
  { id: 'camera', label: 'Camera', perms: ['android.permission.CAMERA'], op: 'CAMERA' },
  { id: 'mic', label: 'Microphone', perms: ['android.permission.RECORD_AUDIO'], op: 'RECORD_AUDIO' },
  { id: 'location', label: 'Location', perms: ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_BACKGROUND_LOCATION'], op: 'FINE_LOCATION' },
  { id: 'contacts', label: 'Contacts', perms: ['android.permission.READ_CONTACTS', 'android.permission.WRITE_CONTACTS'] },
  { id: 'sms', label: 'SMS', perms: ['android.permission.READ_SMS', 'android.permission.RECEIVE_SMS', 'android.permission.SEND_SMS'] },
  { id: 'phone', label: 'Phone & call log', perms: ['android.permission.READ_CALL_LOG', 'android.permission.WRITE_CALL_LOG', 'android.permission.CALL_PHONE', 'android.permission.READ_PHONE_NUMBERS'] },
  { id: 'calendar', label: 'Calendar', perms: ['android.permission.READ_CALENDAR', 'android.permission.WRITE_CALENDAR'] },
  { id: 'storage', label: 'Photos & files', perms: ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO', 'android.permission.READ_MEDIA_AUDIO', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.MANAGE_EXTERNAL_STORAGE'] },
  { id: 'body', label: 'Body & activity', perms: ['android.permission.BODY_SENSORS', 'android.permission.ACTIVITY_RECOGNITION'] },
];
// Special access is app-op gated, but privileged/system apps often hold it via
// the underlying permission with the op left at "default" — so each group is the
// union of explicit op grants and holders of that permission.
const SPECIAL_OPS = [
  { id: 'install', label: 'Install unknown apps', op: 'REQUEST_INSTALL_PACKAGES', perm: 'android.permission.REQUEST_INSTALL_PACKAGES' },
  { id: 'overlay', label: 'Display over other apps', op: 'SYSTEM_ALERT_WINDOW', perm: 'android.permission.SYSTEM_ALERT_WINDOW' },
  { id: 'usage', label: 'Usage access', op: 'GET_USAGE_STATS', perm: 'android.permission.PACKAGE_USAGE_STATS' },
  { id: 'allfiles', label: 'All-files access', op: 'MANAGE_EXTERNAL_STORAGE', perm: 'android.permission.MANAGE_EXTERNAL_STORAGE' },
];

async function queryOp(op) {
  const out = await shell(`cmd appops query-op ${op} allow 2>/dev/null`);
  return out.split('\n')
    .map(l => (l.trim().match(/^([A-Za-z][\w]*(?:\.[\w]+)+)$/) || [])[1]).filter(Boolean);
}

// Android prints how long ago an app-op was used as a packed duration, e.g.
// "+173d17h56m16s625ms". Read as-is that is unusable, so it is turned into a
// number of milliseconds and said in words.
const DURATION_UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, y: 31557600000 };
function parseDuration(str) {
  if (!str) return null;
  let total = 0, seen = false;
  for (const m of String(str).matchAll(/(\d+)(ms|[dhmsy])/g)) {
    const unit = DURATION_UNITS[m[2]];
    if (!unit) continue;
    total += +m[1] * unit;
    seen = true;
  }
  return seen ? total : null;
}
function humanizeAgo(ms) {
  if (ms == null) return null;
  const sec = ms / 1000, min = sec / 60, hr = min / 60, day = hr / 24;
  const n = (v, unit) => { const r = Math.max(1, Math.round(v)); return `${r} ${unit}${r === 1 ? '' : 's'} ago`; };
  if (sec < 45) return 'just now';
  if (min < 60) return n(min, 'minute');
  if (hr < 24) return n(hr, 'hour');
  if (day < 31) return n(day, 'day');
  if (day < 365) return n(day / 30.44, 'month');
  return n(day / 365.25, 'year');
}
// Best-effort last-use record for one app-op; formats differ across builds, so an
// unreadable answer is simply omitted rather than guessed at. Returns the phrase
// to show plus the moment it points at, for the exact date on hover.
async function opLastUsed(pkg, op) {
  const out = await shell(`appops get ${pkg} ${op} 2>/dev/null`);
  const rel = out.match(/time=(\+?[\dydhms]+)\s+ago/);
  if (rel) {
    const ms = parseDuration(rel[1]);
    if (ms != null) return { text: humanizeAgo(ms), at: new Date(Date.now() - ms).toISOString() };
  }
  const abs = out.match(/Access:\s*\[[^\]]*\]\s*([0-9-]{10} [0-9:.]{8,12})/);
  return abs ? { text: abs[1], at: null } : null;
}

async function permissionAudit() {
  const [dump, third] = await Promise.all([
    shell('dumpsys package packages 2>/dev/null'),
    listPackages('-3'),
  ]);
  // An empty dump means the read failed — showing zero holders for every
  // permission would be a false all-clear.
  if (!dump.trim()) return { error: 'Could not read the phone\'s permission records (the dumpsys read failed or returned nothing) — no results. Check the connection and scan again.' };
  const thirdSet = new Set(third);
  const grants = {}, enabled = {}, bySystem = {}, asksEach = {}, refused = {}, chosenByUser = {};
  let cur = null, user = null;
  for (const raw of dump.split('\n')) {
    // An unindented heading ends the package list. "Hidden system packages:",
    // "Shared users:" and the rest carry granted= lines of their own, and
    // without this they all land on whichever package happened to come last.
    if (/^\S.*:\s*$/.test(raw)) { cur = null; user = null; continue; }
    const ph = raw.match(/^\s{0,4}Package \[([\w.]+)\]/);
    if (ph) { cur = ph[1]; user = null; continue; }
    if (!cur) continue;
    const uh = raw.match(/^\s+User (\d+):/);
    if (uh) {
      user = Number(uh[1]);
      // enabled=4 is DISABLED_UNTIL_USED: the phone has put an unused app to
      // sleep. Settings then presents it as having no permissions, while the
      // grant itself is still on the books and comes back the moment it runs.
      if (user === 0) { const en = raw.match(/\benabled=(\d+)/); if (en) enabled[cur] = Number(en[1]); }
      continue;
    }
    // Only this user's grants count. A permission held inside Secure Folder or
    // a work profile is not one the phone in front of you has given away.
    if (user !== null && user !== 0) continue;
    const g = raw.match(/^\s+([A-Za-z][\w.]+): granted=(true|false)(?:, flags=\[([^\]]*)\])?/);
    if (g) {
      const [, perm, yes, rawFlags] = g;
      const f = rawFlags || '';
      if (yes === 'true') {
        (grants[cur] = grants[cur] || new Set()).add(perm);
        // A grant the system made — a default or a role — is not one the owner
        // chose, which is worth saying out loud on a privacy screen.
        if (/GRANTED_BY_DEFAULT|GRANTED_BY_ROLE/.test(f)) (bySystem[cur] = bySystem[cur] || new Set()).add(perm);
      } else if (/USER_FIXED/.test(f)) {
        // USER_FIXED is the flag that suppresses the prompt. This is the only
        // state in which the phone refuses the app outright.
        (refused[cur] = refused[cur] || new Set()).add(perm);
      } else {
        // Not held and not fixed: Android prompts the next time the app asks,
        // which is exactly what its own settings call "Ask every time" —
        // whether the owner chose it or the question has simply never come up.
        (asksEach[cur] = asksEach[cur] || new Set()).add(perm);
        if (/ONE_TIME|USER_SET/.test(f)) (chosenByUser[cur] = chosenByUser[cur] || new Set()).add(perm);
      }
    }
  }
  const short = (p) => p.replace(/^android\.permission\./, '');
  const groups = [];
  for (const gr of PERM_GROUPS) {
    const holders = [];
    for (const [pkg, set] of Object.entries(grants)) {
      const held = gr.perms.filter(p => set.has(p));
      // `held` keeps the full permission names, which is what pm grant/revoke
      // needs; `perms` is the short form the interface shows.
      if (held.length) holders.push({ pkg, user: thirdSet.has(pkg), perms: held.map(short), held, known: KB[pkg] ? KB[pkg].name : null, lastUsed: null, lastUsedAt: null, asleep: enabled[pkg] === 4, bySystem: held.some(p => (bySystem[pkg] || new Set()).has(p)) });
    }
    holders.sort((a, b) => (b.user - a.user) || a.pkg.localeCompare(b.pkg));
    // Apps set to "ask every time" hold nothing right now, so they are not
    // holders — but they are not refused either, and an empty line about them
    // is what makes the phone's own screen and this one disagree.
    const asks = [];
    for (const [pkg, set] of Object.entries(asksEach)) {
      const which = gr.perms.filter(p => set.has(p));
      if (which.length) asks.push({ pkg, user: thirdSet.has(pkg), perms: which.map(short), held: which, known: KB[pkg] ? KB[pkg].name : null, asleep: enabled[pkg] === 4, chosen: which.some(p => (chosenByUser[pkg] || new Set()).has(p)) });
    }
    asks.sort((a, b) => (b.user - a.user) || a.pkg.localeCompare(b.pkg));
    // Apps that asked for it and do not have it. Worth being able to see, but
    // not by default — on this phone they outnumber the holders seven to one.
    const denied = [];
    for (const [pkg, set] of Object.entries(refused)) {
      const which = gr.perms.filter(p => set.has(p));
      if (!which.length) continue;
      if ((grants[pkg] && which.some(p => grants[pkg].has(p))) || (asksEach[pkg] && which.some(p => asksEach[pkg].has(p)))) continue;
      denied.push({ pkg, user: thirdSet.has(pkg), perms: which.map(short), held: which, known: KB[pkg] ? KB[pkg].name : null,
        asleep: enabled[pkg] === 4, byUser: true });
    }
    denied.sort((a, b) => (b.user - a.user) || a.pkg.localeCompare(b.pkg));
    if (gr.op) {
      const targets = holders.filter(h => h.user).slice(0, 25);
      await Promise.all(targets.map(async (h) => {
        const used = await opLastUsed(h.pkg, gr.op);
        h.lastUsed = used ? used.text : null;
        h.lastUsedAt = used ? used.at : null;
      }));
    }
    groups.push({ id: gr.id, label: gr.label, holders, asks, denied, kind: 'runtime', perms: gr.perms });
  }
  const special = [];
  for (const so of SPECIAL_OPS) {
    const set = new Set(await queryOp(so.op));
    if (so.perm) for (const [pkg, g] of Object.entries(grants)) if (g.has(so.perm)) set.add(pkg);
    special.push({
      id: so.id, label: so.label, kind: 'appop', op: so.op,
      holders: [...set].sort().map(pkg => ({ pkg, user: thirdSet.has(pkg), perms: [], held: [], known: KB[pkg] ? KB[pkg].name : null, lastUsed: null, lastUsedAt: null })),
    });
  }
  return { groups, special };
}

// The enabled state of every package as a number, straight from the phone's own
// records. "pm list packages -d" answers a yes/no question, but Android has
// several ways for an app to be switched off and they are not interchangeable:
//   0 default · 1 enabled · 2 disabled · 3 disabled by the user · 4 until used
// Only 3 — what "pm disable-user" sets, and so what this app sets — can be
// undone over adb. Ask the shell to enable an app sitting in 2 or 4 and Android
// answers "Shell cannot change component state", which is why the difference has
// to reach the UI rather than being flattened into a chip that says "disabled".
// The grep runs on the phone, so this stays one round trip and a few KB of the
// several MB `dumpsys package packages` would otherwise return.
// Split from the read so it can be tested against real dump shapes: the phone is
// the one thing a test cannot have.
function parseEnabledStates(text) {
  const states = {};
  let inPackages = false, cur = null;
  for (const raw of String(text || '').split('\n')) {
    // Unindented headings delimit the dump's sections, and only "Packages:"
    // holds the records in force. "Hidden system packages:" repeats a package's
    // pre-update system entry with a state of its own — read it and an updated
    // system app ends up wearing the wrong one, because it appears in both.
    const head = raw.match(/^([A-Za-z][^:]*):\s*$/);
    if (head) { inPackages = head[1] === 'Packages'; cur = null; continue; }
    if (!inPackages) continue;
    const ph = raw.match(/^\s*Package \[([\w.]+)\]/);
    if (ph) { cur = ph[1]; continue; }
    if (!cur) continue;
    if (/^\s*User 0:/.test(raw)) {
      const en = raw.match(/\benabled=(\d+)/);
      if (en) states[cur] = Number(en[1]);
      cur = null;                       // only this user's line counts
    }
  }
  return states;
}
async function enabledStates() {
  const out = await shell(
    'dumpsys package packages 2>/dev/null | grep -E "^[A-Za-z].*:$|Package \\[|User 0:" 2>/dev/null');
  return parseEnabledStates(out);
}

// Every installed package with its origin, state and battery mode, for the Apps tab.
async function listAllApps() {
  const parse = (out) => out.split('\n').filter(l => l.startsWith('package:')).map(l => l.slice(8).trim());
  const [all, third, disabled, instOut, battery, states] = await Promise.all([
    shell('pm list packages --user 0 2>/dev/null').then(parse),
    shell('pm list packages -3 --user 0 2>/dev/null').then(parse),
    shell('pm list packages -d --user 0 2>/dev/null').then(parse),
    shell('pm list packages -i --user 0 2>/dev/null'),
    batterySets(),
    enabledStates(),
  ]);
  const inst = {};
  for (const l of instOut.split('\n')) {
    const m = l.match(/^package:(\S+)\s+installer=(\S+)/);
    if (m && m[2] !== 'null') inst[m[1]] = m[2];
  }
  const thirdSet = new Set(third), disSet = new Set(disabled);
  return all.sort().map(pkg => ({
    pkg, user: thirdSet.has(pkg), disabled: disSet.has(pkg),
    // Undefined when the read did not cover this package; the UI then falls back
    // to the yes/no answer rather than inventing a state.
    enabled: states[pkg],
    installer: inst[pkg] || null, known: KB[pkg] ? KB[pkg].name : null,
    battery: battery.restricted.has(pkg) ? 'restricted' : battery.unrestricted.has(pkg) ? 'unrestricted' : 'optimized',
  }));
}

module.exports = { runChecks, buildProposals, listAllApps, enabledStates, parseEnabledStates, batterySets, permissionAudit, parseDuration, humanizeAgo, PERM_GROUPS, SPECIAL_OPS };
