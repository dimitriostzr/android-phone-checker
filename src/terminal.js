// terminal.js — parsing and safety classification for the Terminal view.
//
// The Terminal lets you type any adb command yourself. That freedom must not
// quietly break the promise the rest of the app makes ("nothing changes on your
// phone without an explicit confirmation"), so every command is classified
// before it runs:
//
//   read        — a query. Runs straight away; changes nothing on the phone.
//   write       — not recognised as read-only. Runs only after a confirmation.
//   destructive — can remove data or apps, or reboot the phone. Confirmed twice.
//
// Unknown always falls back to "write": a command this file does not recognise
// is treated as if it could change something. No electron imports here — this
// module is pure so it can be unit-tested (see test/terminal.test.js).
'use strict';

// ---------- quote-aware splitting ----------
// A phone-side shell command may legitimately contain pipes, quotes and
// redirections (`logcat -d | grep -E 'a|b' 2>/dev/null`). Splitting naively on
// "|" would tear that grep pattern in half and misclassify a harmless read, so
// both splitters below track quote state as they walk the string.

function splitSegments(cmd) {
  const segs = [];
  let cur = '', q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < cmd.length) { cur += c + cmd[++i]; continue; }
    if (c === '\n' || c === ';') { segs.push(cur); cur = ''; continue; }
    if (c === '|') { if (cmd[i + 1] === '|') i++; segs.push(cur); cur = ''; continue; }
    if (c === '&') {
      // "&&" separates commands; "2>&1" does not.
      if (cmd[i + 1] === '&') { i++; segs.push(cur); cur = ''; continue; }
      if (cur.endsWith('>') || /\d/.test(cmd[i + 1] || '')) { cur += c; continue; }
      segs.push(cur); cur = ''; continue;
    }
    cur += c;
  }
  segs.push(cur);
  return segs.map(s => s.trim()).filter(Boolean);
}

// Words of one segment. `quoted` records whether a word came out of quotes, so
// that a quoted ">" inside a search pattern is not mistaken for a redirection.
function tokenize(seg) {
  const out = [];
  let cur = '', q = null, open = false, quoted = false;
  const push = () => { if (open) out.push({ v: cur, quoted }); cur = ''; open = false; quoted = false; };
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) { if (c === q) q = null; else cur += c; open = true; continue; }
    if (c === '"' || c === "'") { q = c; open = true; quoted = true; continue; }
    if (c === '\\' && i + 1 < seg.length) { cur += seg[++i]; open = true; quoted = true; continue; }
    if (/\s/.test(c)) { push(); continue; }
    cur += c; open = true;
  }
  push();
  return out;
}

// ---------- what a command actually is ----------
// Input is either a device-side shell command ("pm list packages") or a full
// adb invocation ("adb devices -l"). Everything else is normalised to the first
// form, so a line pasted from a tutorial works in either shape.
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f]/;
const PLACEHOLDER = /\{[a-z_]+\}/i;

function parseCommand(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return { error: 'Type a command first.' };
  if (raw.length > 4000) return { error: 'That command is too long.' };
  if (CONTROL_CHARS.test(raw)) return { error: 'That command contains control characters.' };
  if (PLACEHOLDER.test(raw)) return { error: `Replace ${raw.match(PLACEHOLDER)[0]} with a real value first.` };

  const shellCmd = (body) => {
    // "adb shell 'pm list packages'" — a desktop shell would strip those quotes
    // before adb ever saw them, so do the same for a pasted line.
    const b = /^(['"])[\s\S]*\1$/.test(body) ? body.slice(1, -1) : body;
    return { kind: 'shell', shellCmd: b, argv: ['shell', b], display: `adb shell ${b}` };
  };

  if (!/^adb(\s|$)/i.test(raw)) return shellCmd(raw);

  const rest = raw.replace(/^adb\s*/i, '').trim();
  if (!rest) return { error: 'Type an adb subcommand, for example "adb devices".' };
  const m = rest.match(/^shell\s+([\s\S]+)$/i);
  if (m) return shellCmd(m[1].trim());
  const argv = tokenize(rest).map(t => t.v);
  if (!argv.length) return { error: 'Type an adb subcommand, for example "adb devices".' };
  return { kind: 'adb', argv, display: `adb ${argv.join(' ')}` };
}

// ---------- classification ----------

// Plain read-only utilities: they print, they do not change the device.
const READ_TOOLS = new Set([
  'getprop', 'getenforce', 'ps', 'top', 'df', 'du', 'cat', 'ls', 'uptime', 'uname', 'date',
  'id', 'whoami', 'stat', 'free', 'pwd', 'echo', 'printf', 'env', 'printenv', 'basename',
  'dirname', 'readlink', 'file', 'strings', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut',
  'tr', 'grep', 'egrep', 'fgrep', 'awk', 'nl', 'rev', 'expr', 'seq', 'md5sum', 'sha1sum',
  'sha256sum', 'ip', 'netstat', 'ifconfig', 'route', 'ss', 'lsof', 'vmstat', 'which', 'whereis',
]);

// Tools that are read-only or not depending on the sub-command they are given.
// Each predicate receives the tool's arguments (the tool name removed).
const READ_IF = {
  pm: (a) => ['list', 'path', 'dump', 'get-install-location', 'has-feature', 'resolve-activity',
    'query-activities', 'query-services', 'query-receivers', 'get-max-users'].includes(a[0]),
  settings: (a) => ['get', 'list'].includes(a[0]),
  appops: (a) => ['get', 'query-op'].includes(a[0]),
  cmd: (a) => a.length >= 2 && ['get', 'list', 'query-op', 'dump', 'check', 'status', 'print',
    'get-role-holders', 'list-holders', 'get-user-restriction'].includes(a[1]),
  service: (a) => ['list', 'check'].includes(a[0]),
  // dumpsys prints by default, but a few services take mutating sub-commands
  // ("dumpsys battery set …", "dumpsys deviceidle whitelist +pkg").
  dumpsys: (a) => !a.some(x => /^(set|reset|unplug|enable|disable|start|stop|send|clear|remove|add)$/i.test(x)
    || /^[+-][A-Za-z]/.test(x)),
  // "wm size" reports; "wm size 1080x2400" overrides the display.
  wm: (a) => a.length === 1 && ['size', 'density'].includes(a[0]),
  // -c clears the buffers, -f writes a file on the phone, -G resizes buffers.
  logcat: (a) => !a.some(x => /^-(c|f|G)$/.test(x)),
  find: (a) => !a.some(x => /^-(delete|exec|execdir|ok|okdir)$/.test(x)),
  sed: (a) => !a.some(x => /^-[a-z]*i/.test(x)),
  content: (a) => a[0] === 'query',
  ime: (a) => a[0] === 'list',
  locksettings: (a) => ['get-disabled', 'verify'].includes(a[0]),
};

// Commands that can cost data, apps or an unexpected reboot. These are still
// allowed — it is the user's own phone — but they are confirmed twice.
const DESTRUCTIVE = [
  [/(^|[\s;|&])pm\s+(uninstall|install|install-create|install-write|clear)\b/i, 'installs, removes or erases app data'],
  [/(^|[\s;|&])(rm|rmdir|shred|truncate|dd|mkfs\S*)\b/i, 'deletes or overwrites files on the phone'],
  [/(^|[\s;|&])(reboot|fastboot|bootloader)\b/i, 'reboots the phone'],
  [/(^|[\s;|&])svc\s+power\b/i, 'powers the phone down or reboots it'],
  [/MASTER_CLEAR|FACTORY_RESET|(^|[\s;|&])(wipe|format)\b/i, 'can factory-reset or wipe storage'],
  [/(^|[\s;|&])settings\s+(delete|reset)\b/i, 'removes system settings'],
  [/(^|[\s;|&])content\s+(delete|insert|update|call)\b/i, 'writes into system content providers'],
  [/(^|[\s;|&])sqlite3\b/i, 'edits system databases directly'],
  [/(^|[\s;|&])(chmod|chown|chgrp|mv|ln)\b/i, 'changes files or their permissions'],
  [/(^|[\s;|&])(killall|pkill)\b|(^|[\s;|&])kill\s+-9\b/i, 'force-kills running processes'],
  [/(^|[\s;|&])pm\s+(grant|revoke)\b/i, 'grants or revokes app permissions'],
];

const ADB_DESTRUCTIVE = {
  install: 'installs an app on the phone', 'install-multiple': 'installs an app on the phone',
  uninstall: 'removes an app from the phone', push: 'writes a file onto the phone',
  root: 'restarts adb with root rights', unroot: 'restarts the adb daemon',
  remount: 'remounts system partitions writable', 'disable-verity': 'disables verified boot checks',
  'enable-verity': 'changes verified boot checks', sideload: 'flashes a package onto the phone',
  restore: 'restores a backup over your data', reboot: 'reboots the phone', emu: 'sends emulator commands',
};
const ADB_READ = new Set(['devices', 'get-state', 'get-serialno', 'get-devpath', 'version', 'shell', 'logcat', 'features']);

function redirectionRisk(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.quoted) continue;
    const m = t.v.match(/^(\d*)(>>?)(.*)$/);
    if (!m) continue;
    const target = m[3] || (tokens[i + 1] && !tokens[i + 1].quoted ? tokens[i + 1].v : '');
    if (/^&\d+$/.test(target) || target === '/dev/null') continue;
    return true;
  }
  return false;
}

// Returns { tier, reason }. `reason` is user-facing: it is what the confirmation
// dialog shows as the explanation for asking.
function classify(input) {
  const p = parseCommand(input);
  if (p.error) return { tier: 'write', reason: p.error };

  if (p.kind === 'adb') {
    const sub = (p.argv.find(a => !a.startsWith('-') && a !== 'wait-for-device') || '').toLowerCase();
    if (ADB_DESTRUCTIVE[sub]) return { tier: 'destructive', reason: `"adb ${sub}" ${ADB_DESTRUCTIVE[sub]}` };
    if (ADB_READ.has(sub)) return { tier: 'read', reason: 'reads from the phone only' };
    if (sub === 'pull' || sub === 'bugreport') return { tier: 'write', reason: `"adb ${sub}" reads the phone but writes a file onto this computer` };
    return { tier: 'write', reason: `"adb ${sub}" is not on the read-only list` };
  }

  const cmd = p.shellCmd;
  if (/\$\(|`/.test(cmd)) return { tier: 'write', reason: 'it contains a nested sub-command, whose effect cannot be checked in advance' };
  for (const [re, why] of DESTRUCTIVE) if (re.test(cmd)) return { tier: 'destructive', reason: `it ${why}` };

  const segs = splitSegments(cmd);
  if (!segs.length) return { tier: 'write', reason: 'the command could not be read' };
  for (const seg of segs) {
    const tokens = tokenize(seg);
    if (redirectionRisk(tokens)) return { tier: 'write', reason: 'it redirects output into a file on the phone' };
    // Skip redirections and leading VAR=value assignments to find the tool itself.
    const words = tokens.filter(t => t.quoted || !/^\d*>>?/.test(t.v)).map(t => t.v);
    let i = 0;
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
    const tool = (words[i] || '').replace(/^.*\//, '').toLowerCase();
    const args = words.slice(i + 1);
    if (!tool) return { tier: 'write', reason: 'the command could not be read' };
    if (READ_TOOLS.has(tool)) continue;
    if (READ_IF[tool]) {
      if (READ_IF[tool](args)) continue;
      return { tier: 'write', reason: `"${[tool, ...args].join(' ').slice(0, 60)}" is a form of ${tool} that can change the phone` };
    }
    return { tier: 'write', reason: `"${tool}" is not on the read-only list, so it may change something` };
  }
  return { tier: 'read', reason: 'reads from the phone only' };
}

module.exports = { parseCommand, classify, splitSegments, tokenize };
