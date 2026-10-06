// adb.js — locate and talk to the user's own adb installation.
// We deliberately do NOT bundle adb binaries (Android SDK license); we find the one
// the user has, or tell them where to get Google's official platform-tools.
'use strict';
const { execFile } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');
const os = require('os');

const CANDIDATES = () => {
  const home = os.homedir();
  const names = process.platform === 'win32' ? ['adb.exe'] : ['adb'];
  const dirs = [
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools'),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools'),
    path.join(home, 'Library/Android/sdk/platform-tools'),        // macOS default
    path.join(home, 'Android/Sdk/platform-tools'),                // Linux default
    path.join(home, 'AppData/Local/Android/Sdk/platform-tools'),  // Windows default
    '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin',
  ].filter(Boolean);
  const out = [];
  for (const d of dirs) for (const n of names) out.push(path.join(d, n));
  return out;
};

let adbPath = null;

function run(bin, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: (stdout || '').replace(/\r/g, ''), stderr: (stderr || '').toString(), err: err ? String(err) : null });
    });
  });
}

async function findAdb() {
  if (adbPath) return adbPath;
  // PATH first
  const probe = await run(process.platform === 'win32' ? 'where' : 'which', ['adb'], 4000);
  if (probe.ok && probe.stdout.trim()) { adbPath = probe.stdout.trim().split('\n')[0]; return adbPath; }
  for (const c of CANDIDATES()) if (existsSync(c)) { adbPath = c; return adbPath; }
  return null;
}

// Every adb invocation is reported here (in-app console + on-disk log file).
let logger = null;
function setLogger(fn) { logger = fn; }

// Monotonic count of failed adb invocations. Callers snapshot it around a group
// of reads to tell "the command really returned nothing" apart from "the command
// failed" — a failed read must never be presented as an all-clear result.
let failCounter = 0;
function failCount() { return failCounter; }

async function adb(args, timeoutMs) {
  const bin = await findAdb();
  if (!bin) { failCounter++; return { ok: false, stdout: '', stderr: 'adb not found', err: 'adb-not-found' }; }
  const t0 = Date.now();
  const r = await run(bin, args, timeoutMs);
  if (!r.ok) failCounter++;
  if (logger) {
    try {
      logger({
        ts: new Date().toISOString(), cmd: `adb ${args.join(' ')}`, ok: r.ok,
        ms: Date.now() - t0, outBytes: r.stdout.length,
        err: r.ok ? null : (r.stderr || r.err || '').trim().slice(0, 200) || null,
      });
    } catch {}
  }
  return r;
}

async function shell(cmd, timeoutMs) {
  const r = await adb(['shell', cmd], timeoutMs);
  return r.ok ? r.stdout : '';
}

async function deviceState() {
  const r = await adb(['get-state'], 6000);
  if (r.ok) return r.stdout.trim();
  if (r.stderr.includes('unauthorized')) return 'unauthorized';
  if (r.stderr.includes('more than one')) return 'multiple';
  return 'none';
}

async function deviceSummary() {
  const state = await deviceState();
  if (state !== 'device') return { state };
  const props = await shell('getprop');
  const p = (k) => { const m = props.match(new RegExp(`\\[${k.replace(/\./g, '\\.')}\\]: \\[([^\\]]*)\\]`)); return m ? m[1] : ''; };
  return {
    state,
    serial: (await adb(['get-serialno'], 6000)).stdout.trim(),
    manufacturer: p('ro.product.manufacturer'),
    model: p('ro.product.model'),
    android: p('ro.build.version.release'),
    patch: p('ro.build.version.security_patch'),
    build: p('ro.build.display.id') || p('ro.build.id'),
    verifiedBoot: p('ro.boot.verifiedbootstate'),
    bootloaderLocked: p('ro.boot.flash.locked'),
    knoxWarranty: p('ro.boot.warranty_bit'),
  };
}

// Everything the "My device" page shows — read-only probes only. Each field is
// independent and optional: whatever a build cannot answer is simply omitted.
async function deviceDetails() {
  const state = await deviceState();
  if (state !== 'device') return { state };
  const props = await shell('getprop');
  const p = (k) => { const m = props.match(new RegExp(`\\[${k.replace(/\./g, '\\.')}\\]: \\[([^\\]]*)\\]`)); return m ? m[1] : ''; };
  const pkgCount = async (flags) => (await shell(`pm list packages ${flags} --user 0 2>/dev/null`)).split('\n').filter(l => l.startsWith('package:')).length;
  const [total, user, disabled, batt, df, mem, up, wsize, wdens, kernel, cores, serialR] = await Promise.all([
    pkgCount(''), pkgCount('-3'), pkgCount('-d'),
    shell('dumpsys battery 2>/dev/null'),
    shell('df -h /data 2>/dev/null'),
    shell('cat /proc/meminfo 2>/dev/null'),
    shell('cat /proc/uptime 2>/dev/null'),
    shell('wm size 2>/dev/null'), shell('wm density 2>/dev/null'),
    shell('uname -r 2>/dev/null'),
    shell('cat /sys/devices/system/cpu/possible 2>/dev/null'),
    adb(['get-serialno'], 6000),
  ]);
  const bv = (k) => { const m = batt.match(new RegExp(`^\\s*${k}: (\\d+)`, 'm')); return m ? +m[1] : null; };
  const BATT_STATUS = { 2: 'charging', 3: 'discharging', 4: 'not charging', 5: 'full' };
  const BATT_HEALTH = { 2: 'good', 3: 'overheat', 4: 'dead', 5: 'over-voltage', 6: 'failure', 7: 'cold' };
  const dfCols = (df.trim().split('\n').pop() || '').split(/\s+/);
  const memKb = +(mem.match(/MemTotal:\s+(\d+) kB/) || [])[1] || null;
  const upSec = parseFloat(up) || null;
  const fmtUp = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`; };
  const oneui = +p('ro.build.version.oneui') || +p('ro.build.version.sep') || null;
  const coreM = cores.trim().match(/^0-(\d+)$/);
  const screenM = wsize.match(/(\d+x\d+)/);
  const temp = bv('temperature');
  return {
    state,
    identity: {
      'Manufacturer': p('ro.product.manufacturer'),
      'Model': p('ro.product.model'),
      'Marketing name': p('ro.product.vendor.marketname') || p('ro.product.marketname'),
      'Codename': p('ro.product.device'),
      'Serial': serialR.stdout.trim(),
    },
    software: {
      'Android': `${p('ro.build.version.release')} (SDK ${p('ro.build.version.sdk')})`,
      'One UI': oneui ? `${Math.floor(oneui / 10000)}.${Math.floor((oneui % 10000) / 100)}` : '',
      'Security patch': p('ro.build.version.security_patch'),
      'Build': p('ro.build.display.id') || p('ro.build.id'),
      'Build date': p('ro.build.date'),
      'First shipped with': p('ro.product.first_api_level') ? `API ${p('ro.product.first_api_level')}` : '',
      'Baseband': p('gsm.version.baseband'),
      'Bootloader': p('ro.bootloader'),
      'Kernel': kernel.trim(),
      'Sales code (CSC)': p('ro.csc.sales_code') || p('ro.csc.omcnw_code'),
      'Locale': p('persist.sys.locale'),
    },
    hardware: {
      'Chipset': [p('ro.soc.manufacturer'), p('ro.soc.model')].filter(Boolean).join(' ') || p('ro.board.platform'),
      'Hardware': p('ro.hardware'),
      'CPU cores': coreM ? String(+coreM[1] + 1) : '',
      'CPU ABI': p('ro.product.cpu.abi'),
      'RAM (visible to OS)': memKb ? `${(memKb / 1048576).toFixed(1)} GB` : '',
      'Screen': screenM ? `${screenM[1]} @ ${(wdens.match(/(\d+)/) || [])[1] || '?'}dpi` : '',
    },
    apps: {
      'Installed packages (total)': String(total),
      'User-installed (third-party)': String(user),
      'System / preloaded': String(total - user),
      'Disabled': String(disabled),
    },
    power: {
      'Battery': bv('level') != null ? `${bv('level')}% (${BATT_STATUS[bv('status')] || 'unknown'}, health ${BATT_HEALTH[bv('health')] || 'unknown'})` : '',
      'Battery temperature': temp != null ? `${(temp / 10).toFixed(1)} °C` : '',
      'Uptime': upSec ? fmtUp(upSec) : '',
      'Data storage': dfCols.length >= 5 ? `${dfCols[2]} used of ${dfCols[1]} (${dfCols[4]} full)` : '',
    },
  };
}

module.exports = { findAdb, adb, shell, deviceState, deviceSummary, deviceDetails, setLogger, failCount };
