// hardware.js — what the phone is made of and what it is doing right now.
// Read-only: /proc and /sys files the shell user can read, plus dumpsys battery
// and the window-manager display query. Everything is best-effort — a value the
// build will not answer is left out rather than guessed at.
'use strict';
const { shell, failCount } = require('./adb');

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const firstLine = (s) => (s || '').trim().split('\n')[0] || '';

// One shell call reads every core's frequency table: id, min, max, current, governor.
const CPU_FREQ_CMD =
  'for c in /sys/devices/system/cpu/cpu[0-9]*; do ' +
  'n=${c##*/cpu}; f=$c/cpufreq; ' +
  'echo "$n|$(cat $f/cpuinfo_min_freq 2>/dev/null)|$(cat $f/cpuinfo_max_freq 2>/dev/null)|' +
  '$(cat $f/scaling_cur_freq 2>/dev/null)|$(cat $f/scaling_governor 2>/dev/null)|$(cat $c/online 2>/dev/null)"; done 2>/dev/null';
// …and one reads every thermal zone's name and temperature.
const THERMAL_CMD =
  'for z in /sys/class/thermal/thermal_zone*; do ' +
  'echo "$(cat $z/type 2>/dev/null)|$(cat $z/temp 2>/dev/null)"; done 2>/dev/null';

function parseCpuFreq(out) {
  const cores = [];
  for (const line of (out || '').split('\n')) {
    const p = line.trim().split('|');
    if (p.length < 5 || !/^\d+$/.test(p[0])) continue;
    const kHz = (v) => { const n = num(v); return n ? Math.round(n / 1000) : null; };
    cores.push({ id: +p[0], minMhz: kHz(p[1]), maxMhz: kHz(p[2]), curMhz: kHz(p[3]), governor: p[4] || null, online: p[5] === '' ? true : p[5] !== '0' });
  }
  return cores.sort((a, b) => a.id - b.id);
}
// Cores that share a maximum clock are one cluster — that is what makes a
// phone's big/little layout visible without any vendor-specific knowledge.
function clustersOf(cores) {
  const by = new Map();
  for (const c of cores) {
    const k = c.maxMhz || 0;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(c.id);
  }
  return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([maxMhz, ids]) => ({ maxMhz, count: ids.length, ids }));
}
function parseThermal(out) {
  const zones = [];
  for (const line of (out || '').split('\n')) {
    const [type, raw] = line.trim().split('|');
    const v = num(raw);
    if (!type || v == null) continue;
    // "…-hw-trip" zones report the shutdown threshold, and "…bcl…" zones report
    // current-limit levels rather than a temperature. Neither is a reading.
    if (/-hw-trip|bcl|trip-point/i.test(type) || v === 0) continue;
    // Zones report millidegrees on most builds and whole degrees on a few.
    const c = Math.abs(v) > 1000 ? v / 1000 : v;
    if (c < -40 || c > 200) continue;
    zones.push({ type, c: Math.round(c * 10) / 10 });
  }
  return zones;
}
function parseStat(out) {
  const cpus = {};
  for (const line of (out || '').split('\n')) {
    const m = line.match(/^(cpu\d*)\s+(.*)$/);
    if (!m) continue;
    const v = m[2].trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
    if (v.length < 4) continue;
    const total = v.reduce((a, b) => a + b, 0);
    const idle = v[3] + (v[4] || 0);
    cpus[m[1]] = { total, idle };
  }
  return Object.keys(cpus).length ? cpus : null;
}
// Two cumulative samples → the percentage of time the processor was busy between them.
function busyPercent(prev, now, key = 'cpu') {
  if (!prev || !now || !prev[key] || !now[key]) return null;
  const dt = now[key].total - prev[key].total;
  const di = now[key].idle - prev[key].idle;
  if (dt <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(((dt - di) / dt) * 1000) / 10));
}

function parseMeminfo(out) {
  const kv = {};
  for (const line of (out || '').split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+) kB/);
    if (m) kv[m[1]] = +m[2];
  }
  if (!kv.MemTotal) return null;
  const total = kv.MemTotal, avail = kv.MemAvailable != null ? kv.MemAvailable : kv.MemFree;
  return {
    totalKb: total, availableKb: avail, freeKb: kv.MemFree, cachedKb: kv.Cached, buffersKb: kv.Buffers,
    usedKb: avail != null ? total - avail : null,
    swapTotalKb: kv.SwapTotal, swapFreeKb: kv.SwapFree,
  };
}
function parseDf(out) {
  const rows = [];
  for (const line of (out || '').split('\n').slice(1)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 6) continue;
    rows.push({ mount: p[5], size: p[1], used: p[2], avail: p[3], pct: num(p[4]) });
  }
  return rows;
}
const BATT_STATUS = { 1: 'unknown', 2: 'charging', 3: 'discharging', 4: 'not charging', 5: 'full' };
const BATT_HEALTH = { 1: 'unknown', 2: 'good', 3: 'overheat', 4: 'dead', 5: 'over-voltage', 6: 'unspecified failure', 7: 'cold' };
function parseBattery(out, cycles, chargeFull, designCapacity) {
  const v = (k) => { const m = (out || '').match(new RegExp(`^\\s*${k}: (-?\\d+)`, 'im')); return m ? +m[1] : null; };
  const level = v('level'), temp = v('temperature'), volt = v('voltage'), curr = v('current now');
  const mah = (x) => x == null ? null : Math.round(x > 100000 ? x / 1000 : x);
  return {
    level, status: BATT_STATUS[v('status')] || null, health: BATT_HEALTH[v('health')] || null,
    tempC: temp != null ? Math.round(temp) / 10 : null,
    voltageV: volt != null ? (volt > 1000 ? volt / 1000 : volt) : null,
    // dumpsys prints the raw sysfs value, which is microamps: negative while the
    // phone runs on battery, positive while it charges. (Checked against this
    // build's own broadcast lines, where 1401562 is 1.4 A and 3906 a few mA.)
    currentMa: curr != null ? Math.round(curr / 100) / 10 : null,
    chargeCounterMah: mah(v('charge counter')),
    cycleCount: num(cycles) || null,
    fullChargeMah: mah(num(chargeFull)),
    designMah: mah(num(designCapacity)),
  };
}

async function readHardware() {
  const f0 = failCount();
  const [props, cpuinfo, freqOut, memOut, dfOut, battOut, thermOut, sizeOut, densOut, loadOut, upOut, cycles, chargeFull, designCap, glOut, fpsOut, statOut] = await Promise.all([
    shell('getprop'),
    shell('cat /proc/cpuinfo 2>/dev/null'),
    shell(CPU_FREQ_CMD),
    shell('cat /proc/meminfo 2>/dev/null'),
    shell('df -h /data 2>/dev/null'),
    shell('dumpsys battery 2>/dev/null'),
    shell(THERMAL_CMD),
    shell('wm size 2>/dev/null'),
    shell('wm density 2>/dev/null'),
    shell('cat /proc/loadavg 2>/dev/null'),
    shell('cat /proc/uptime 2>/dev/null'),
    shell('cat /sys/class/power_supply/battery/cycle_count 2>/dev/null || true'),
    shell('cat /sys/class/power_supply/battery/charge_full 2>/dev/null || true'),
    shell('cat /sys/class/power_supply/battery/charge_full_design 2>/dev/null || true'),
    shell('dumpsys SurfaceFlinger 2>/dev/null | grep -m1 -i "GLES:" || true'),
    shell('dumpsys display 2>/dev/null | grep -m12 -oE "fps=[0-9.]+" || true'),
    shell('cat /proc/stat 2>/dev/null'),
  ]);
  if (failCount() > f0 && !props) {
    return { error: 'Could not read the hardware details from the phone (an adb command failed) — nothing is shown rather than a half-empty page. Check the cable and try again.' };
  }
  const p = (k) => { const m = props.match(new RegExp(`\\[${k.replace(/\./g, '\\.')}\\]: \\[([^\\]]*)\\]`)); return m ? m[1] : ''; };
  const cores = parseCpuFreq(freqOut);
  const load = (loadOut || '').trim().split(/\s+/).slice(0, 3).map(num).filter(v => v != null);
  const screen = (sizeOut.match(/Physical size:\s*(\d+x\d+)/) || sizeOut.match(/(\d+x\d+)/) || [])[1] || null;
  const density = num((densOut.match(/(\d+)/) || [])[1]);
  const gl = firstLine(glOut).replace(/^\s*GLES:\s*/i, '') || null;
  return {
    soc: {
      'Chipset': [p('ro.soc.manufacturer'), p('ro.soc.model')].filter(Boolean).join(' ') || p('ro.board.platform') || null,
      'Board': p('ro.product.board') || p('ro.hardware') || null,
      'CPU architecture': p('ro.product.cpu.abi') || null,
      'Hardware (kernel)': (cpuinfo.match(/^Hardware\s*:\s*(.+)$/m) || [])[1] || null,
      'GPU': gl,
      'GPU driver': p('ro.hardware.egl') || null,
    },
    stat: parseStat(statOut),
    cpu: {
      cores, clusters: clustersOf(cores),
      count: cores.length || num(p('ro.vendor.cpu.count')),
      load1: load[0] != null ? load[0] : null, load5: load[1] != null ? load[1] : null, load15: load[2] != null ? load[2] : null,
      uptimeSec: num(firstLine(upOut).split(/\s+/)[0]),
    },
    memory: parseMeminfo(memOut),
    storage: parseDf(dfOut),
    battery: parseBattery(battOut, cycles, chargeFull, designCap),
    thermal: parseThermal(thermOut),
    display: {
      resolution: screen, densityDpi: density,
      maxRefreshHz: Math.max(0, ...[...(fpsOut || '').matchAll(/fps=([0-9.]+)/g)].map(m => Math.round(num(m[1]) || 0))) || null,
    },
  };
}

// The values a monitor re-reads: clocks, temperature, memory, load, battery.
async function readLive() {
  const f0 = failCount();
  const [freqOut, memOut, thermOut, battOut, loadOut, statOut] = await Promise.all([
    shell(CPU_FREQ_CMD), shell('cat /proc/meminfo 2>/dev/null'), shell(THERMAL_CMD),
    shell('dumpsys battery 2>/dev/null'), shell('cat /proc/loadavg 2>/dev/null'),
    shell('cat /proc/stat 2>/dev/null'),
  ]);
  if (failCount() > f0) return { error: 'The phone stopped answering — live readings paused.' };
  const load = (loadOut || '').trim().split(/\s+/).slice(0, 3).map(num).filter(v => v != null);
  return {
    cores: parseCpuFreq(freqOut), memory: parseMeminfo(memOut), thermal: parseThermal(thermOut),
    battery: parseBattery(battOut, null, null, null), stat: parseStat(statOut),
    load1: load[0] != null ? load[0] : null,
  };
}

module.exports = { readHardware, readLive, parseCpuFreq, parseThermal, parseMeminfo, parseDf, clustersOf, parseBattery, parseStat, busyPercent };
