// main.js — Electron main process. Windowing, IPC, per-device store (baselines, history,
// action log), and the only place that ever executes a device-modifying command
// (always behind an explicit native confirmation dialog).
'use strict';
const { app, BrowserWindow, ipcMain, shell: eshell, dialog, nativeTheme } = require('electron');

// Running the electron binary with ELECTRON_RUN_AS_NODE=1 (some editor terminals
// export it) starts plain Node instead of the app: no window, and every Electron
// object below is undefined. Say that clearly rather than dying on a TypeError.
if (!app || !BrowserWindow) {
  console.error(
    'Phone Checker cannot start: the Electron runtime is running in Node mode.\n' +
    'This happens when ELECTRON_RUN_AS_NODE=1 is set, which some editor terminals do automatically.\n' +
    'Start it with "npm start" (which clears that variable), or unset it first:\n' +
    '  unset ELECTRON_RUN_AS_NODE   # macOS / Linux\n' +
    '  set ELECTRON_RUN_AS_NODE=    # Windows'
  );
  process.exit(1);
}
const path = require('path');
const fs = require('fs');

// ---------- what the app calls itself ----------
// Run from source, Electron names the process after itself, so the dock tooltip
// and the menu bar both say "Electron". A packaged build already reads
// productName from package.json; this gives the same name to the source build.
//
// The name also decides where getPath('userData') points, so setting it moves
// the store: saved snapshots, the per-device baselines, and the disabledByApp
// list that Undo disables reads. Anything already written under the old name is
// carried across, once, rather than left behind looking deleted.
app.setName('Phone Checker');
require('./userdata').moveStore(fs, path.join(app.getPath('appData'), 'Electron'), app.getPath('userData'));
app.setAboutPanelOptions({
  applicationName: 'Phone Checker',
  applicationVersion: app.getVersion(),
  copyright: '© 2026 Dimitrios T. Free software under the MIT License.',
});
const crypto = require('crypto');
const adb = require('./adb');
const { runChecks, buildProposals, listAllApps, batterySets, permissionAudit, PERM_GROUPS, SPECIAL_OPS } = require('./checks');
const { forDevice, KB, commandLibrary } = require('./profiles');
const { parseCommand, classify: classifyCommand } = require('./terminal');
const { readOrigins, readOrigin, captureSnapshot } = require('./inventory');
const snapshot = require('./snapshot');
const plan = require('./plan');
const hardware = require('./hardware');
const report = require('./report');

let win;
const HISTORY_CAP = 40;

// ---------- adb command log (Console view + daily on-disk file) ----------
const LOG_CAP = 500;
const logBuffer = [];
function logDir() { const d = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(d, { recursive: true }); return d; }
function logFilePath() { return path.join(logDir(), `adb-${new Date().toISOString().slice(0, 10)}.log`); }
adb.setLogger((e) => {
  logBuffer.push(e);
  if (logBuffer.length > LOG_CAP) logBuffer.shift();
  const line = `${e.ts}  $ ${e.cmd}  [${e.ok ? 'ok' : 'FAILED'} ${e.ms}ms ${e.outBytes}B]${e.err ? `  ${e.err.replace(/\s+/g, ' ')}` : ''}\n`;
  try { fs.appendFileSync(logFilePath(), line); } catch {}
  if (win && !win.isDestroyed()) win.webContents.send('adb:log', e);
});

// ---------- per-device store ----------
function storePath(serial) {
  const dir = path.join(app.getPath('userData'), 'devices');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${(serial || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}
function loadStore(serial) {
  try { return JSON.parse(fs.readFileSync(storePath(serial), 'utf8')); } catch { return {}; }
}
function saveStore(serial, data) {
  fs.writeFileSync(storePath(serial), JSON.stringify(data, null, 2));
}
// Each per-serial store identifies its phone, so data shown from a store is
// always labeled — even when that phone is no longer the one connected.
function stampDevice(store, device) {
  store.device = { serial: device.serial, model: device.model, manufacturer: device.manufacturer };
}
function logAction(store, action, pkg, ok = true) {
  store.actions = store.actions || [];
  store.actions.unshift({ ts: new Date().toISOString(), action, pkg, ok });
  store.actions = store.actions.slice(0, 500);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 920, minHeight: 600,
    title: 'Phone Checker',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0e13' : '#eef1f6',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  watchWindow(win);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Closing goes through the renderer's safety checklist (USB debugging off,
  // paused protections re-enabled) unless the checklist already confirmed it.
  win.on('close', (e) => {
    if (closeConfirmed || win.webContents.isCrashed()) return;
    e.preventDefault();
    win.webContents.send('app:confirm-close');
  });
}
// Anything that kills the window or the app itself is written to the same daily
// log as the adb commands, so a crash leaves a trace to read afterwards instead
// of disappearing with the window.
function logProblem(what, detail) {
  const line = `${new Date().toISOString()}  !! ${what}${detail ? '  ' + String(detail).replace(/\s+/g, ' ').slice(0, 500) : ''}\n`;
  try { fs.appendFileSync(logFilePath(), line); } catch {}
  try { process.stderr.write(line); } catch {}
}
function watchWindow(w) {
  w.webContents.on('render-process-gone', (_e, d) => logProblem('the window process stopped', JSON.stringify(d)));
  w.webContents.on('unresponsive', () => logProblem('the window stopped responding'));
  w.webContents.on('preload-error', (_e, p, err) => logProblem('preload script failed', `${p}: ${err && err.message}`));
  w.webContents.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error') logProblem('error in the window', `${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
}
process.on('uncaughtException', (e) => logProblem('uncaught error in the main process', e && e.stack || e));
process.on('unhandledRejection', (e) => logProblem('unhandled rejection in the main process', e && e.stack || e));
app.on('child-process-gone', (_e, d) => logProblem('a helper process stopped', JSON.stringify(d)));

// ---------- turn USB debugging off (change; the one the app cannot undo) ----------
// "settings put global adb_enabled 0" works by cutting the connection this app
// talks over, so the device dropping out of `adb devices` is the proof it took.
// Some hardened builds refuse the write, so a phone that is still there after
// the grace period is read back rather than assumed to have worked.
ipcMain.handle('usb:disable', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'No phone is connected.' };

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Cancel', 'Turn USB debugging off'], defaultId: 0, cancelId: 0,
    message: `Turn USB debugging off on ${device.manufacturer} ${device.model}?`,
    detail: 'This is the one change Phone Checker cannot undo for you. Turning USB debugging '
      + 'off disconnects the phone, so the app loses the channel it would need to switch it '
      + 'back on — you would re-enable it by hand in Settings → Developer options.\n\n'
      + 'Uses Android\'s standard "settings put global adb_enabled 0".',
  });
  if (response !== 1) return { cancelled: true };

  const store = loadStore(device.serial);
  stampDevice(store, device);

  await adb.adb(['shell', 'settings put global adb_enabled 0']);

  // The write races the disconnect it causes, so its exit code says nothing.
  // Poll for the phone to actually leave instead.
  const deadline = Date.now() + 8000;
  let state = 'device';
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
    state = await adb.deviceState();
    if (state !== 'device') break;
  }

  if (state !== 'device') {
    logAction(store, 'usb-debugging-off', device.serial, true);
    saveStore(device.serial, store);
    return { ok: true, model: `${device.manufacturer} ${device.model}` };
  }

  // Still reachable: ask the phone what the setting actually says, so the
  // reason given back is the real one.
  const readBack = (await adb.shell('settings get global adb_enabled 2>/dev/null')).trim();
  logAction(store, 'usb-debugging-off', device.serial, false);
  saveStore(device.serial, store);
  return {
    ok: false,
    error: readBack === '0'
      ? 'The setting reads as off, but the phone is still connected. Unplug it and check Developer options.'
      : 'The phone refused the change — some builds block it. Turn it off by hand in Settings → Developer options.',
  };
});

let closeConfirmed = false;
ipcMain.handle('app:confirmQuit', () => { closeConfirmed = true; app.quit(); });

app.whenReady().then(() => {
  // Packaged builds get the bundle icon from electron-builder; this covers dev runs.
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png')); } catch {}
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- read-only IPC ----------
ipcMain.handle('adb:locate', async () => ({
  path: await adb.findAdb(),
  downloadUrl: 'https://developer.android.com/tools/releases/platform-tools',
}));

ipcMain.handle('device:summary', async () => adb.deviceSummary());

ipcMain.handle('checks:run', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: `Device not ready (${device.state}). Unlock the phone and accept the USB debugging prompt.` };
  const store = loadStore(device.serial);
  stampDevice(store, device);
  const { results } = await runChecks(device, store, (r) => win && win.webContents.send('checks:result', r));
  const counts = { flag: 0, note: 0, ok: 0, skip: 0 };
  for (const r of results) counts[r.status === 'flag' ? 'flag' : r.status === 'note' ? 'note' : r.status === 'skip' ? 'skip' : 'ok']++;
  store.history = store.history || [];
  store.history.unshift({ ts: new Date().toISOString(), counts, results });
  store.history = store.history.slice(0, HISTORY_CAP);
  store.lastRun = new Date().toISOString();
  saveStore(device.serial, store);
  return { device, results, counts };
});

ipcMain.handle('proposals:list', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: `Device not ready (${device.state}).` };
  const store = loadStore(device.serial);
  stampDevice(store, device);
  return { device, proposals: await buildProposals(device), disabledByApp: store.disabledByApp || [] };
});

ipcMain.handle('history:list', async () => {
  const device = await adb.deviceSummary();
  const connectedSerial = device.state === 'device' ? device.serial : null;
  const serial = connectedSerial || lastKnownSerial();
  if (!serial) return { history: [], actions: [], storeDevice: null, connectedSerial };
  const store = loadStore(serial);
  if (connectedSerial && !store.device) { stampDevice(store, device); saveStore(serial, store); }
  return {
    device, history: store.history || [], actions: store.actions || [], disabledByApp: store.disabledByApp || [],
    storeDevice: store.device || { serial, model: serial, manufacturer: '' },
    connectedSerial,
  };
});
function lastKnownSerial() {
  try {
    const dir = path.join(app.getPath('userData'), 'devices');
    const f = fs.readdirSync(dir).map(n => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    return f ? f.n.replace(/\.json$/, '') : null;
  } catch { return null; }
}

// ---------- modifying IPC (native confirmation, everything logged & reversible) ----------
// What runs, what is refused and what needs a second confirmation is decided in
// src/plan.js — a pure module with no device, store or dialog access, so those
// rules can be tested directly. The handlers here read the phone, show the
// dialogs the plan asks for, and write the undo records.
const { validPkg, BATTERY_LABEL } = plan;

// The third-party package list is what separates "system app" from "an app you
// installed" in every plan below, so it is read the same way everywhere.
async function thirdPartyPackages() {
  const out = await adb.shell('pm list packages -3 --user 0 2>/dev/null');
  return out.split('\n').filter(l => l.startsWith('package:')).map(l => l.slice(8).trim());
}

ipcMain.handle('proposals:disable', async (_e, pkgsIn) => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  const p0 = plan.planDisable({ pkgs: pkgsIn, kb: KB, thirdParty: await thirdPartyPackages() });
  if (p0.error) return { error: p0.error };
  let pkgs = p0.items;
  const { risky, why } = p0;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Cancel', `Disable ${pkgs.length} package(s)`], defaultId: 0, cancelId: 0,
    message: `Disable ${pkgs.length} package(s) for the main user?`,
    detail: 'Uses "pm disable-user --user 0" — Android\'s standard, reversible user-level disable. Undo any item (or everything) from History.\n\n'
      + pkgs.map(p => (risky.includes(p) ? '⚠ CAUTION — ' : '') + p).join('\n'),
  });
  if (response !== 1) return { cancelled: true };
  // Risky items get a second, separate consent spelling out each trade-off.
  if (p0.needsSecond) {
    const second = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Skip the caution items', `Yes, disable ${risky.length} caution item(s) too`],
      defaultId: 0, cancelId: 0,
      message: `${risky.length} of the selected package(s) need extra care.`,
      detail: 'Each one carries a real trade-off:\n\n'
        + risky.map(p => `⚠ ${p}\n${why[p]}`).join('\n\n'),
    });
    const kept = plan.resolveSecond(pkgs, risky, second.response);
    if (kept.cancelled) return { cancelled: true };
    pkgs = kept.items;
  }
  const store = loadStore(device.serial);
  stampDevice(store, device);
  const done = [], failed = [];
  for (const p of pkgs) {
    const r = await adb.adb(['shell', `pm disable-user --user 0 ${p}`]);
    const ok = r.ok && /disabled/i.test(r.stdout);
    // Android refuses a package it will not let the shell move with a
    // SecurityException in pm's own output; that reason travels back so the UI
    // can repeat it rather than reporting nothing at all.
    if (ok) done.push(p);
    else failed.push({ pkg: p, out: (r.stdout || r.stderr || '').trim() });
    logAction(store, 'disable', p, ok);
  }
  store.disabledByApp = [...new Set([...(store.disabledByApp || []), ...done])];
  saveStore(device.serial, store);
  return { done, failed };
});

ipcMain.handle('proposals:enable', async (_e, pkg) => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  if (!validPkg(pkg)) return { error: 'Invalid package name.' };
  // Switching an app back on restores whatever that app does, so it asks like
  // every other write: one package here, a list in enableMany.
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Cancel', 'Enable this package'], defaultId: 0, cancelId: 0,
    message: `Switch ${pkg} back on for the main user?`,
    detail: 'Uses "pm enable --user 0" — the exact reverse of the disable this app applies. '
      + 'An app the phone shipped disabled can be switched on this way too. To turn it off again, disable it from the advisor or the Apps view.',
  });
  if (response !== 1) return { cancelled: true };
  const r = await adb.adb(['shell', `pm enable --user 0 ${pkg}`]);
  const ok = r.ok && /enabled/i.test(r.stdout);
  const store = loadStore(device.serial);
  stampDevice(store, device);
  logAction(store, 'enable', pkg, ok);
  store.disabledByApp = (store.disabledByApp || []).filter(p => p !== pkg);
  saveStore(device.serial, store);
  return { ok, out: r.stdout || r.stderr };
});

// The counterpart to proposals:disable, for a selection rather than everything
// this app ever turned off. Switching an app back on is restorative, but still
// a write: there is no caution tier and no second dialog, and it asks first.
ipcMain.handle('proposals:enableMany', async (_e, pkgsIn) => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  if (!Array.isArray(pkgsIn) || !pkgsIn.length) return { error: 'Nothing selected.' };
  const invalid = pkgsIn.filter(p => !validPkg(p));
  if (invalid.length) return { error: `Invalid package name(s): ${invalid.map(String).join(', ')}` };
  const pkgs = [...new Set(pkgsIn)];
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Cancel', `Enable ${pkgs.length} package(s)`], defaultId: 0, cancelId: 0,
    message: `Switch ${pkgs.length} package(s) back on for the main user?`,
    detail: 'Uses "pm enable --user 0" — the exact reverse of the disable this app applies. '
      + 'An app the phone shipped disabled can be switched on this way too.\n\n' + pkgs.join('\n'),
  });
  if (response !== 1) return { cancelled: true };
  const store = loadStore(device.serial);
  stampDevice(store, device);
  const done = [], failed = [];
  for (const p of pkgs) {
    const r = await adb.adb(['shell', `pm enable --user 0 ${p}`]);
    const ok = r.ok && /enabled/i.test(r.stdout);
    // pm reports a refusal in its output rather than a non-zero exit, so the
    // reason travels back with the failure and the UI can say what Android said.
    if (ok) done.push(p);
    else failed.push({ pkg: p, out: (r.stdout || r.stderr || '').trim() });
    logAction(store, 'enable', p, ok);
  }
  // Only the ones that actually came back leave the undo list; anything that
  // refused is still disabled and must stay there.
  store.disabledByApp = (store.disabledByApp || []).filter(p => !done.includes(p));
  saveStore(device.serial, store);
  return { done, failed };
});

ipcMain.handle('actions:revertAll', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  const store = loadStore(device.serial);
  stampDevice(store, device);
  const pkgs = (store.disabledByApp || []).filter(validPkg);
  if (!pkgs.length) return { done: [], failed: [] };
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Cancel', `Re-enable all ${pkgs.length}`], defaultId: 0, cancelId: 0,
    message: `Re-enable every package this app disabled (${pkgs.length})?`,
    detail: pkgs.join('\n'),
  });
  if (response !== 1) return { cancelled: true };
  const done = [], failed = [];
  for (const p of pkgs) {
    const r = await adb.adb(['shell', `pm enable --user 0 ${p}`]);
    const ok = r.ok && /enabled/i.test(r.stdout);
    (ok ? done : failed).push(p);
    logAction(store, 'enable', p, ok);
  }
  store.disabledByApp = failed;
  saveStore(device.serial, store);
  return { done, failed };
});

ipcMain.handle('sideloads:trust', async (_e, pkgs) => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  if (!Array.isArray(pkgs) || pkgs.some(p => !validPkg(p))) return { error: 'Invalid package name(s).' };
  const store = loadStore(device.serial);
  stampDevice(store, device);
  store.trustedSideloads = [...new Set([...(store.trustedSideloads || []), ...pkgs])];
  for (const p of pkgs) logAction(store, 'trust', p, true);
  saveStore(device.serial, store);
  return { trusted: store.trustedSideloads };
});

ipcMain.handle('device:details', async () => adb.deviceDetails());

ipcMain.handle('perms:audit', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: `Device not ready (${device.state}).` };
  const store = loadStore(device.serial);
  return { device, changedCount: Object.keys(store.permsChangedByApp || {}).length, ...(await permissionAudit()) };
});

// Verify an app: copy its APK to this computer (read-only for the phone),
// hash it locally, and hand the facts to the renderer. No network involved —
// the user chooses whether to search the hash in their own browser. The copy
// exists only to be hashed and is deleted before this handler returns.
ipcMain.handle('apps:verify', async (_e, pkg) => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  if (!validPkg(pkg)) return { error: 'Bad package name.' };
  const paths = (await adb.shell(`pm path ${pkg} 2>/dev/null`)).split('\n')
    .filter(l => l.startsWith('package:')).map(l => l.slice(8).trim());
  if (!paths.length) return { error: 'No APK path found for this package.' };
  const apk = paths.find(p => p.endsWith('base.apk')) || paths[0];
  const dump = await adb.shell(`dumpsys package ${pkg} 2>/dev/null`);
  const version = (dump.match(/versionName=(\S+)/) || [])[1] || '';
  let installer = (dump.match(/installerPackageName=(\S+)/) || [])[1] || '';
  if (installer === 'null') installer = '';
  const dir = path.join(app.getPath('temp'), 'phone-checker-verify');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${pkg}.base.apk`);
  try {
    const r = await adb.adb(['pull', apk, dest], 180000);
    if (!r.ok || !fs.existsSync(dest)) return { error: `Could not copy the APK: ${(r.stderr || r.err || 'unknown error').trim()}` };
    const sha256 = await new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      fs.createReadStream(dest).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
    const size = fs.statSync(dest).size;
    return { pkg, version, installer, apk, size, sha256 };
  } finally {
    try { fs.rmSync(dest, { force: true }); fs.rmdirSync(dir); } catch {}
  }
});

ipcMain.handle('apps:list', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: `Device not ready (${device.state}).` };
  const store = loadStore(device.serial);
  const apps = await listAllApps();
  // Zero packages on a live device means the read failed, not an empty phone.
  if (!apps.length) return { error: 'Could not read the package list from the phone — no results. Check the connection and try again.' };
  return {
    device, apps,
    batteryChangedCount: Object.keys(store.batteryChangedByApp || {}).length,
    disabledCount: (store.disabledByApp || []).length,
  };
});

// ---------- per-app battery states (Apps tab; native confirmation, previous state saved) ----------
// The three modes and their labels are defined with the rules, in plan.js.
async function applyBattery(pkg, mode) {
  const op = await adb.adb(['shell', `cmd appops set ${pkg} RUN_ANY_IN_BACKGROUND ${mode === 'restricted' ? 'ignore' : 'default'}`]);
  const okOp = op.ok && !/error|exception/i.test(op.stdout + op.stderr);
  const wl = await adb.adb(['shell', `dumpsys deviceidle whitelist ${mode === 'unrestricted' ? '+' : '-'}${pkg}`]);
  const okWl = wl.ok && !/error|exception/i.test(wl.stdout + wl.stderr);
  return okOp && okWl;
}

ipcMain.handle('battery:set', async (_e, { pkgs: pkgsIn, mode }) => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  const p0 = plan.planBattery({ pkgs: pkgsIn, mode, thirdParty: await thirdPartyPackages() });
  if (p0.error) return { error: p0.error };
  let pkgs = p0.items;
  const sys = p0.system;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Cancel', `Set ${pkgs.length} app(s) to ${BATTERY_LABEL[mode]}`], defaultId: 0, cancelId: 0,
    message: `Set battery state "${BATTERY_LABEL[mode]}" for ${pkgs.length} app(s)?`,
    detail: 'Uses Android\'s standard background-usage controls ("cmd appops" and the battery-optimization whitelist). The previous state is saved first, so everything can be undone with "Undo battery changes" on the Apps tab.\n\n'
      + pkgs.map(p => (sys.includes(p) && mode === 'restricted' ? '⚠ SYSTEM — ' : '') + p).join('\n'),
  });
  if (response !== 1) return { cancelled: true };
  // Restricting SYSTEM apps gets a second, separate consent — it can break real functionality.
  if (p0.needsSecond) {
    const second = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Skip the system apps', `Yes, restrict ${sys.length} system app(s) too`],
      defaultId: 0, cancelId: 0,
      message: `${sys.length} of the selected app(s) are system apps.`,
      detail: 'Restricting a system app\'s background use can break sync, alarms, calls or notifications it delivers. Only proceed for system apps you have researched.\n\n' + sys.join('\n'),
    });
    const kept = plan.resolveSecond(pkgs, sys, second.response);
    if (kept.cancelled) return { cancelled: true };
    pkgs = kept.items;
  }
  const store = loadStore(device.serial);
  stampDevice(store, device);
  store.batteryChangedByApp = store.batteryChangedByApp || {};
  // If the current-state read fails, the undo record would be wrong — stop instead.
  const f0 = adb.failCount();
  const prev = await batterySets();
  if (adb.failCount() > f0) return { error: 'Could not read the current battery states from the phone — nothing was changed. Check the connection and try again.' };
  const done = [], failed = [];
  for (const p of pkgs) {
    const prevMode = plan.batteryPrevMode(prev, p);
    const ok = await applyBattery(p, mode);
    (ok ? done : failed).push(p);
    logAction(store, `battery-${mode}`, p, ok);
    if (ok) {
      if (!(p in store.batteryChangedByApp) && prevMode !== mode) store.batteryChangedByApp[p] = prevMode;
      else if (store.batteryChangedByApp[p] === mode) delete store.batteryChangedByApp[p];
    }
  }
  saveStore(device.serial, store);
  return { done, failed };
});

ipcMain.handle('battery:revert', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  const store = loadStore(device.serial);
  stampDevice(store, device);
  const changed = store.batteryChangedByApp || {};
  const keys = Object.keys(changed).filter(validPkg);
  if (!keys.length) return { done: [], failed: [] };
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Cancel', `Restore ${keys.length} app(s)`], defaultId: 0, cancelId: 0,
    message: `Restore the battery state of every app this app changed (${keys.length})?`,
    detail: keys.map(k => `${k} → ${BATTERY_LABEL[changed[k]] || changed[k]}`).join('\n'),
  });
  if (response !== 1) return { cancelled: true };
  const done = [], failed = [];
  for (const k of keys) {
    const ok = await applyBattery(k, changed[k]);
    if (ok) { delete store.batteryChangedByApp[k]; done.push(k); } else failed.push(k);
    logAction(store, `battery-${changed[k]}`, k, ok);
  }
  saveStore(device.serial, store);
  return { done, failed };
});

// ---------- phone settings (read; apply/revert behind native confirmation) ----------
ipcMain.handle('settings:list', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: `Device not ready (${device.state}).` };
  const store = loadStore(device.serial);
  stampDevice(store, device);
  const changed = store.settingsChangedByApp || {};
  const rows = await Promise.all(forDevice(device.manufacturer).settingsBaseline.map(async (s) => {
    const cur = (await adb.shell(`settings get ${s.ns} ${s.key}`)).trim();
    const unset = !cur || cur === 'null';
    return { ...s, cur: unset ? 'unset' : cur, matches: cur === s.want || (!!s.unsetOk && unset), changedByApp: !!changed[s.key] };
  }));
  return { device, rows, changedCount: Object.keys(changed).length };
});

ipcMain.handle('settings:apply', async (_e, keys) => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  const p0 = plan.planSettings({ keys, baseline: forDevice(device.manufacturer).settingsBaseline });
  if (!p0.items.length) return { done: [], failed: [] };
  let items = p0.items;
  const warns = p0.warns;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Cancel', `Apply ${items.length} setting(s)`], defaultId: 0, cancelId: 0,
    message: `Change ${items.length} phone setting(s) to the recommended value?`,
    detail: 'Uses Android\'s standard "settings put". The previous value is saved first, so everything can be undone from the Phone settings tab or History.\n\n'
      + items.map(s => `${s.key} → ${s.want}${s.warn ? '   ⚠ trade-off' : ''}`).join('\n'),
  });
  if (response !== 1) return { cancelled: true };
  // Trade-off settings get a second, separate consent spelling out each cost.
  if (p0.needsSecond) {
    const second = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Skip the trade-off items', `Yes, apply ${warns.length} trade-off setting(s) too`],
      defaultId: 0, cancelId: 0,
      message: `${warns.length} of the selected setting(s) carry a real trade-off.`,
      detail: warns.map(s => `⚠ ${s.key} → ${s.want}\n${s.desc} — trade-off: ${s.warn}`).join('\n\n'),
    });
    const kept = plan.resolveSecond(items, warns, second.response);
    if (kept.cancelled) return { cancelled: true };
    items = kept.items;
  }
  const store = loadStore(device.serial);
  stampDevice(store, device);
  store.settingsChangedByApp = store.settingsChangedByApp || {};
  const done = [], failed = [];
  for (const s of items) {
    // If the previous-value read fails, applying would save a wrong undo record
    // (revert would delete a value that was really set) — skip the item instead.
    const f0 = adb.failCount();
    const prev = (await adb.shell(`settings get ${s.ns} ${s.key}`)).trim();
    if (adb.failCount() > f0) { failed.push(s.key); logAction(store, 'set', `${s.key} (could not read previous value — not applied)`, false); continue; }
    const r = await adb.adb(['shell', `settings put ${s.ns} ${s.key} ${s.want}`]);
    const ok = r.ok && !/error|exception/i.test(r.stdout + r.stderr);
    (ok ? done : failed).push(s.key);
    if (ok && !store.settingsChangedByApp[s.key]) store.settingsChangedByApp[s.key] = { ns: s.ns, prev };
    logAction(store, 'set', `${s.key} → ${s.want}`, ok);
  }
  saveStore(device.serial, store);
  return { done, failed };
});

ipcMain.handle('settings:revert', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  const store = loadStore(device.serial);
  stampDevice(store, device);
  const changed = store.settingsChangedByApp || {};
  const keys = Object.keys(changed);
  if (!keys.length) return { done: [], failed: [] };
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Cancel', `Restore ${keys.length} setting(s)`], defaultId: 0, cancelId: 0,
    message: `Restore every setting this app changed (${keys.length}) to its previous value?`,
    detail: keys.map(k => `${k} → ${changed[k].prev && changed[k].prev !== 'null' ? changed[k].prev : 'unset'}`).join('\n'),
  });
  if (response !== 1) return { cancelled: true };
  const done = [], failed = [];
  for (const k of keys) {
    const { ns, prev } = changed[k];
    // Namespace, key and saved value all come back out of the store and get spliced
    // into a device shell command — plan.js validates each before anything executes.
    const { ok: restorable, unset } = plan.restorableSetting({ ns, key: k, prev });
    if (!restorable) {
      failed.push(k);
      logAction(store, 'revert', `${k} (stored value not restorable)`, false);
      continue;
    }
    const r = await adb.adb(['shell', unset ? `settings delete ${ns} ${k}` : `settings put ${ns} ${k} ${prev}`]);
    const ok = r.ok && !/error|exception/i.test(r.stdout + r.stderr);
    if (ok) { delete store.settingsChangedByApp[k]; done.push(k); } else failed.push(k);
    logAction(store, 'revert', `${k} → ${unset ? 'unset' : prev}`, ok);
  }
  saveStore(device.serial, store);
  return { done, failed };
});

// ---------- terminal (pre-built command library + free-typed commands) ----------
// The Terminal is the one place where a command this app did not write can reach
// the phone, so the same rule as everywhere else applies: read-only commands run
// straight away, anything else needs an explicit confirmation naming the exact
// command, and destructive ones are confirmed twice. Every run goes through the
// normal adb logger, so the Console view and the daily log file see it too.
const TERM_TIMEOUT_MS = 90000;
const TERM_MAX_OUTPUT = 400000;

ipcMain.handle('term:library', async () => {
  const device = await adb.deviceSummary();
  return { device, categories: commandLibrary(device.state === 'device' ? device.manufacturer : '') };
});

ipcMain.handle('term:classify', (_e, cmd) => classifyCommand(cmd));

ipcMain.handle('term:run', async (_e, input) => {
  const parsed = parseCommand(input);
  if (parsed.error) return { error: parsed.error };
  const { tier, reason } = classifyCommand(input);

  const confirmations = plan.confirmationsFor(tier);
  if (confirmations > 0) {
    const destructive = confirmations === 2;
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Cancel', 'Run this command'], defaultId: 0, cancelId: 0,
      message: destructive
        ? 'This command can change or erase things on your phone.'
        : 'This command is not on the read-only list.',
      detail: `${parsed.display}\n\nWhy you are being asked: ${reason}.\n\n`
        + 'Nothing here is undone by History — the Terminal runs exactly what you typed, and the undo records this app keeps only cover changes it made itself.',
    });
    if (response !== 1) return { cancelled: true };
    if (destructive) {
      const second = await dialog.showMessageBox(win, {
        type: 'warning', buttons: ['Cancel', 'Yes, run it'], defaultId: 0, cancelId: 0,
        message: '⚠ Last check before this runs.',
        detail: `${parsed.display}\n\nThis kind of command ${reason.replace(/^it /, '')}. It cannot be undone from this app, `
          + 'and data or apps removed this way are not recoverable here. Only continue if you know exactly what this command does.',
      });
      if (second.response !== 1) return { cancelled: true };
    }
  }

  const t0 = Date.now();
  const r = await adb.adb(parsed.argv, TERM_TIMEOUT_MS);
  const ms = Date.now() - t0;
  let out = r.stdout || '';
  const truncated = out.length > TERM_MAX_OUTPUT;
  if (truncated) out = out.slice(0, TERM_MAX_OUTPUT);

  // A command that can change the phone belongs in the same action log as every
  // other change this app makes, so History tells the whole story.
  if (tier !== 'read') {
    const device = await adb.deviceSummary();
    if (device.state === 'device') {
      const store = loadStore(device.serial);
      stampDevice(store, device);
      logAction(store, 'terminal', parsed.display, r.ok);
      saveStore(device.serial, store);
    }
  }

  return {
    display: parsed.display, tier, ok: r.ok, ms, truncated,
    stdout: out, stderr: (r.stderr || '').slice(0, 4000),
    err: r.ok ? null : (r.err || '').slice(0, 400),
  };
});

// ---------- permissions (change; native confirmation, previous state saved) ----------
// Runtime permissions go through Android's own "pm grant" / "pm revoke"; the
// special-access ones are app-ops, set with "cmd appops set". Both are the same
// mechanisms the phone's own Settings screens use, and both are reversible —
// the previous state is written to the per-device store before anything runs.
ipcMain.handle('perms:apply', async (_e, payload) => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  const { groupId, mode } = payload || {};
  const p0 = plan.planPerms({
    groupId, mode,
    items: Array.isArray(payload && payload.items) ? payload.items : [],
    permGroups: PERM_GROUPS, specialOps: SPECIAL_OPS,
    thirdParty: await thirdPartyPackages(),
  });
  if (p0.error) return { error: p0.error };
  const { group, isOp, revoking, verb } = p0;
  let items = p0.items;
  const systemApps = p0.systemApps;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Cancel', `${verb} ${group.label} for ${items.length} app(s)`], defaultId: 0, cancelId: 0,
    message: `${verb} the "${group.label}" permission for ${items.length} app(s)?`,
    detail: (revoking
      ? 'This can make an app misbehave, lose features or crash. Most apps assume a permission they were granted stays granted, and a system app losing one can take a feature of the phone down with it.\n\n'
        + (mode === 'ask' ? 'The app keeps the right to ask: the phone will prompt the next time it needs this.\n\n'
          : mode === 'deny' ? 'The phone will refuse it from now on without prompting.\n\n' : '')
      : '')
      + (isOp
        ? `Uses Android's standard "cmd appops set … ${group.op}".`
        : `Uses Android's standard "pm ${mode} --user 0".`)
      + ' The current state is saved first, so this can be undone from the Permissions tab or History.\n\n'
      + items.map(p => (systemApps.includes(p) ? '⚠ SYSTEM — ' : '') + p.pkg).join('\n'),
  });
  if (response !== 1) return { cancelled: true };

  // Taking a permission away from a system app can break something the phone
  // depends on, so that gets its own, separate confirmation.
  if (p0.needsSecond) {
    const second = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Skip the system apps', `Yes, change ${systemApps.length} system app(s) too`],
      defaultId: 0, cancelId: 0,
      message: `${systemApps.length} of the selected app(s) are system apps.`,
      detail: 'Taking a permission away from a system app can break calls, messaging, the camera, sync or notifications that the phone relies on. Only continue for system apps you have researched.\n\n'
        + systemApps.map(p => p.pkg).join('\n'),
    });
    const kept = plan.resolveSecond(items, systemApps, second.response);
    if (kept.cancelled) return { cancelled: true };
    items = kept.items;
  }

  const store = loadStore(device.serial);
  stampDevice(store, device);
  store.permsChangedByApp = store.permsChangedByApp || {};
  const done = [], failed = [];
  for (const p of items) {
    if (isOp) {
      const want = mode === 'grant' ? 'allow' : mode === 'ask' ? 'default' : 'deny';
      const before = (await adb.shell(`appops get ${p.pkg} ${group.op} 2>/dev/null`)).trim();
      const prev = /allow/i.test(before) ? 'allow' : /deny|ignore/i.test(before) ? 'deny' : 'default';
      const r = await adb.adb(['shell', `cmd appops set ${p.pkg} ${group.op} ${want}`]);
      const ok = r.ok && !/error|exception|failure/i.test(r.stdout + r.stderr);
      (ok ? done : failed).push({ pkg: p.pkg, perm: group.op, error: ok ? null : (r.stderr || r.stdout || '').trim().slice(0, 160) });
      if (ok) {
        const key = `${p.pkg}|${group.op}`;
        if (!(key in store.permsChangedByApp)) store.permsChangedByApp[key] = { kind: 'op', pkg: p.pkg, op: group.op, prev };
        logAction(store, mode === 'grant' ? 'perm-allow' : 'perm-deny', `${p.pkg} · ${group.op}`, true);
      } else logAction(store, mode === 'grant' ? 'perm-allow' : 'perm-deny', `${p.pkg} · ${group.op}`, false);
      continue;
    }
    for (const perm of p.perms) {
      const verbCmd = mode === 'grant' ? 'grant' : 'revoke';
      const r = await adb.adb(['shell', `pm ${verbCmd} --user 0 ${p.pkg} ${perm}`]);
      // Revoking alone leaves the prompt enabled. USER_FIXED is what silences
      // it, so the two revoke outcomes differ only in that flag.
      if (r.ok && mode === 'ask') await adb.adb(['shell', `pm clear-permission-flags --user 0 ${p.pkg} ${perm} user-fixed`]);
      if (r.ok && mode === 'deny') await adb.adb(['shell', `pm set-permission-flags --user 0 ${p.pkg} ${perm} user-fixed user-set`]);
      // pm prints nothing on success and an exception on refusal.
      const ok = r.ok && !/exception|error|not a changeable permission|unknown permission/i.test(r.stdout + r.stderr);
      (ok ? done : failed).push({ pkg: p.pkg, perm, error: ok ? null : (r.stderr || r.stdout || '').trim().split('\n')[0].slice(0, 160) });
      if (ok) {
        const key = `${p.pkg}|${perm}`;
        if (!(key in store.permsChangedByApp)) store.permsChangedByApp[key] = { kind: 'runtime', pkg: p.pkg, perm, prev: mode === 'revoke' ? 'granted' : 'denied' };
        else if (store.permsChangedByApp[key].prev === (mode === 'revoke' ? 'denied' : 'granted')) delete store.permsChangedByApp[key];
      }
      logAction(store, mode === 'grant' ? 'perm-grant' : mode === 'ask' ? 'perm-ask' : 'perm-revoke', `${p.pkg} · ${perm.replace(/^android\.permission\./, '')}`, ok);
    }
  }
  saveStore(device.serial, store);
  return { done, failed, changed: Object.keys(store.permsChangedByApp).length };
});

ipcMain.handle('perms:revert', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  const store = loadStore(device.serial);
  stampDevice(store, device);
  const changed = store.permsChangedByApp || {};
  const keys = Object.keys(changed);
  if (!keys.length) return { done: [], failed: [] };
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Cancel', `Restore ${keys.length} permission(s)`], defaultId: 0, cancelId: 0,
    message: `Put every permission this app changed (${keys.length}) back as it was?`,
    detail: keys.map(k => {
      const c = changed[k];
      return `${c.pkg} · ${(c.perm || c.op || '').replace(/^android\.permission\./, '')} → ${c.prev}`;
    }).join('\n'),
  });
  if (response !== 1) return { cancelled: true };
  const done = [], failed = [];
  for (const k of keys) {
    const c = changed[k];
    // Package, permission and op names all come back out of the store — a record
    // that no longer validates is reported as failed rather than executed.
    if (!plan.restorablePerm(c)) { failed.push(k); continue; }
    let ok = false;
    if (c.kind === 'op') {
      const r = await adb.adb(['shell', `cmd appops set ${c.pkg} ${c.op} ${c.prev === 'allow' ? 'allow' : c.prev === 'deny' ? 'deny' : 'default'}`]);
      ok = r.ok && !/error|exception/i.test(r.stdout + r.stderr);
    } else {
      const r = await adb.adb(['shell', `pm ${c.prev === 'granted' ? 'grant' : 'revoke'} --user 0 ${c.pkg} ${c.perm}`]);
      ok = r.ok && !/exception|error/i.test(r.stdout + r.stderr);
    }
    if (ok) { delete store.permsChangedByApp[k]; done.push(k); } else failed.push(k);
    logAction(store, 'perm-restore', `${c.pkg} · ${(c.perm || c.op || '').replace(/^android\.permission\./, '')} → ${c.prev}`, ok);
  }
  saveStore(device.serial, store);
  return { done, failed };
});

// ---------- install origins (read-only: the phone's own package records) ----------
ipcMain.handle('origin:all', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: `Device not ready (${device.state}).` };
  return { device, ...(await readOrigins()) };
});
ipcMain.handle('origin:one', async (_e, pkg) => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: 'Device not ready.' };
  if (!validPkg(pkg)) return { error: 'Bad package name.' };
  return { device, ...(await readOrigin(pkg)) };
});

// ---------- save state (snapshots on this computer; any two can be compared) ----------
// One folder per phone under userData/snapshots, one JSON file per saved state
// and a small index beside them so listing never has to parse every file.
// Reading a snapshot is read-only for the phone; saving only writes here.
const SNAP_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
function snapDir(serial) {
  const d = path.join(app.getPath('userData'), 'snapshots', (serial || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function snapIndex(serial) {
  const dir = snapDir(serial);
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch {}
  // No index (or a broken one): rebuild it from the files themselves.
  const rows = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    try { rows.push(snapshot.summary(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), f.replace(/\.json$/, ''))); } catch {}
  }
  rows.sort((a, b) => b.ts.localeCompare(a.ts));
  return rows;
}
function saveSnapIndex(serial, rows) { fs.writeFileSync(path.join(snapDir(serial), 'index.json'), JSON.stringify(rows, null, 2)); }
function loadSnap(serial, id) {
  if (!SNAP_ID_RE.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(snapDir(serial), `${id}.json`), 'utf8')); } catch { return null; }
}
const snapSerial = (device) => device.state === 'device' ? device.serial : lastKnownSerial();

ipcMain.handle('snapshots:list', async () => {
  const device = await adb.deviceSummary();
  const connectedSerial = device.state === 'device' ? device.serial : null;
  const serial = connectedSerial || lastKnownSerial();
  if (!serial) return { snapshots: [], storeDevice: null, connectedSerial };
  const store = loadStore(serial);
  return { device, snapshots: snapIndex(serial), storeDevice: store.device || { serial, model: serial, manufacturer: '' }, connectedSerial };
});
ipcMain.handle('snapshots:save', async (_e, labelIn) => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: `Device not ready (${device.state}). Connect the phone to save its state.` };
  const label = String(labelIn || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
  const r = await captureSnapshot(device, label);
  if (r.error) return r;
  const store = loadStore(device.serial); stampDevice(store, device); saveStore(device.serial, store);
  const id = r.snapshot.ts.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(snapDir(device.serial), `${id}.json`), JSON.stringify(r.snapshot));
  const rows = [snapshot.summary(r.snapshot, id), ...snapIndex(device.serial).filter(x => x.id !== id)];
  saveSnapIndex(device.serial, rows);
  return { saved: rows[0] };
});
ipcMain.handle('snapshots:delete', async (_e, id) => {
  const device = await adb.deviceSummary();
  const serial = snapSerial(device);
  if (!serial || !SNAP_ID_RE.test(String(id))) return { error: 'Unknown saved state.' };
  const row = snapIndex(serial).find(x => x.id === id);
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Cancel', 'Delete this saved state'], defaultId: 0, cancelId: 0,
    message: 'Delete this saved state?',
    detail: `${row ? `${new Date(row.ts).toLocaleString()}${row.label ? ` — ${row.label}` : ''}` : id}\n\nThis removes the file from this computer. The phone is not involved.`,
  });
  if (response !== 1) return { cancelled: true };
  try { fs.rmSync(path.join(snapDir(serial), `${id}.json`), { force: true }); } catch {}
  saveSnapIndex(serial, snapIndex(serial).filter(x => x.id !== id));
  return { deleted: id };
});
ipcMain.handle('snapshots:compare', async (_e, { a, b }) => {
  const device = await adb.deviceSummary();
  const serial = snapSerial(device);
  if (!serial) return { error: 'No saved states for any phone yet.' };
  const A = loadSnap(serial, String(a)), B = loadSnap(serial, String(b));
  if (!A || !B) return { error: 'One of the saved states could not be read.' };
  const [older, newer] = A.ts <= B.ts ? [A, B] : [B, A];
  const diff = snapshot.diff(older, newer);
  diff.packages.added = diff.packages.added.map(x => ({ ...x, origin: snapshot.originOfAdded(x) }));
  return { diff };
});
ipcMain.handle('snapshots:read', async (_e, id) => {
  const serial = snapSerial(await adb.deviceSummary());
  if (!serial) return { error: 'No saved states for any phone yet.' };
  if (!SNAP_ID_RE.test(String(id))) return { error: 'Unknown saved state.' };
  const snap = loadSnap(serial, String(id));
  if (!snap) return { error: 'That saved state could not be read.' };
  const file = path.join(snapDir(serial), `${id}.json`);
  let bytes = 0;
  try { bytes = fs.statSync(file).size; } catch {}
  return { snapshot: snap, file, bytes, summary: snapshot.summary(snap, String(id)) };
});
ipcMain.handle('snapshots:rename', async (_e, { id, label }) => {
  const serial = snapSerial(await adb.deviceSummary());
  if (!serial || !SNAP_ID_RE.test(String(id))) return { error: 'Unknown saved state.' };
  const snap = loadSnap(serial, String(id));
  if (!snap) return { error: 'That saved state could not be read.' };
  snap.label = String(label || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
  fs.writeFileSync(path.join(snapDir(serial), `${id}.json`), JSON.stringify(snap));
  saveSnapIndex(serial, snapIndex(serial).map(r => r.id === id ? { ...r, label: snap.label } : r));
  return { id, label: snap.label };
});
ipcMain.handle('snapshots:revealFile', async (_e, id) => {
  const serial = snapSerial(await adb.deviceSummary());
  if (!serial || !SNAP_ID_RE.test(String(id))) return { error: 'Unknown saved state.' };
  eshell.showItemInFolder(path.join(snapDir(serial), `${id}.json`));
});

// ---------- hardware (read-only: /proc, /sys, dumpsys battery, wm) ----------
ipcMain.handle('hw:read', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: `Device not ready (${device.state}).` };
  return { device, ...(await hardware.readHardware()) };
});
ipcMain.handle('hw:live', async () => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: `Device not ready (${device.state}).` };
  return { serial: device.serial, ...(await hardware.readLive()) };
});

ipcMain.handle('snapshots:openFolder', async () => {
  const serial = snapSerial(await adb.deviceSummary());
  if (serial) eshell.openPath(snapDir(serial));
});

// ---------- full report (a folder of everything the app can read) ----------
// The user picks where it goes; the app writes one report.json, the raw output
// behind it, its own adb logs, and a README explaining both. Read-only on the
// phone from start to finish.
ipcMain.handle('report:export', async (_e, opts) => {
  const device = await adb.deviceSummary();
  if (device.state !== 'device') return { error: `Device not ready (${device.state}). Connect the phone to collect a report.` };
  const includePersonal = !!(opts && opts.includePersonal);

  const picked = await dialog.showOpenDialog(win, {
    title: 'Where should the report folder go?',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Save report here',
  });
  if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) return { cancelled: true };

  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const folder = path.join(picked.filePaths[0], `phone-report-${safe(device.model) || 'phone'}-${stamp}`);
  const rawDir = path.join(folder, 'raw');
  try { fs.mkdirSync(rawDir, { recursive: true }); }
  catch (e) { return { error: `Could not create the report folder: ${e.message}` }; }

  const send = (label, done, total) => { if (win && !win.isDestroyed()) win.webContents.send('report:progress', { label, done, total }); };
  const store = loadStore(device.serial);
  let collected;
  try {
    collected = await report.collectReport(device, {
      onStep: send, includePersonal, store,
      snapshots: (() => { try { return snapIndex(device.serial); } catch { return []; } })(),
    });
  } catch (e) {
    return { error: `The collection stopped: ${e && e.message ? e.message : e}` };
  }

  const written = [];
  const write = (p, text) => { fs.writeFileSync(p, text); written.push({ file: path.relative(folder, p), bytes: Buffer.byteLength(text) }); };
  try {
    for (const r of collected.rawFiles) write(path.join(rawDir, r.file), r.text);
    write(path.join(folder, 'report.json'), JSON.stringify(collected.json, null, 2));
    write(path.join(folder, 'README.md'), report.readmeFor(collected.json, collected.rawFiles));
    // this app's own command log, so the collection itself can be audited
    const logs = fs.existsSync(logDir()) ? fs.readdirSync(logDir()).filter(f => f.endsWith('.log')) : [];
    if (logs.length) {
      const outLogs = path.join(folder, 'logs');
      fs.mkdirSync(outLogs, { recursive: true });
      for (const f of logs.slice(-7)) {
        fs.copyFileSync(path.join(logDir(), f), path.join(outLogs, f));
        written.push({ file: path.join('logs', f), bytes: fs.statSync(path.join(outLogs, f)).size });
      }
    }
  } catch (e) {
    return { error: `The report was collected but could not be written: ${e.message}`, folder };
  }

  logAction(store, 'report', `exported to ${folder}`, true);
  stampDevice(store, device);
  saveStore(device.serial, store);
  const bytes = written.reduce((n, w) => n + w.bytes, 0);
  return { folder, files: written.length, bytes, personalIncluded: includePersonal, failedReads: collected.json.report.failedReads };
});
ipcMain.handle('report:reveal', async (_e, folder) => {
  if (typeof folder === 'string' && fs.existsSync(folder)) eshell.openPath(folder);
});

ipcMain.handle('log:recent', () => ({ entries: logBuffer, file: logFilePath() }));
ipcMain.handle('log:openFile', () => { const f = logFilePath(); if (!fs.existsSync(f)) { try { fs.writeFileSync(f, ''); } catch {} } eshell.openPath(f); });
ipcMain.handle('log:openFolder', () => eshell.openPath(logDir()));

ipcMain.handle('export:save', async (_e, { name, md, txt }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: path.join(app.getPath('documents'), `${name}-${new Date().toISOString().slice(0, 10)}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Plain text', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return { cancelled: true };
  fs.writeFileSync(filePath, String(filePath.toLowerCase().endsWith('.txt') ? txt : md));
  return { saved: filePath };
});

// ---------- export a view as a PNG ----------
// `main` is the scroll container and `body` is overflow:hidden, so a plain
// capturePage() would only ever get the visible slice. The renderer unclips the
// shell first and hands over the element's page rect; captureBeyondViewport
// then renders the whole thing, including what was scrolled out.
ipcMain.handle('export:png', async (_e, rect) => {
  const dbg = win.webContents.debugger;
  let attached = false, buf = null;
  try {
    try { dbg.attach('1.3'); attached = true; } catch { /* already attached, e.g. devtools open */ }
    const clip = {
      x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)),
      width: Math.round(rect.width), height: Math.round(rect.height), scale: 2,
    };
    const shot = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, fromSurface: true, clip,
    });
    buf = Buffer.from(shot.data, 'base64');
  } catch (err) {
    // Any CDP trouble falls back to the visible area rather than failing.
    try { buf = (await win.webContents.capturePage()).toPNG(); }
    catch { return { error: 'The page could not be captured.' }; }
  } finally {
    if (attached) { try { dbg.detach(); } catch {} }
  }
  if (!buf || !buf.length) return { error: 'The capture came back empty.' };

  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
  let dir; try { dir = app.getPath('pictures'); } catch { dir = app.getPath('documents'); }
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export as PNG',
    defaultPath: path.join(dir, `${app.getName() || 'Phone Checker'} ${stamp}.png`),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (canceled || !filePath) return { cancelled: true };
  fs.writeFileSync(filePath, buf);
  return { saved: filePath };
});

// Editing main-side files does nothing until the process restarts, which is
// easy to lose an hour to. The renderer asks about this on load.
const PROCESS_STARTED = Date.now();
ipcMain.handle('app:stale', () => {
  try {
    const dir = __dirname;
    const newest = fs.readdirSync(dir)
      .filter(f => f.endsWith('.js'))
      .reduce((m, f) => Math.max(m, fs.statSync(path.join(dir, f)).mtimeMs), 0);
    return { stale: newest > PROCESS_STARTED };
  } catch { return { stale: false }; }
});

ipcMain.handle('credits:read', () => {
  try { return fs.readFileSync(path.join(app.getAppPath(), 'CREDITS.md'), 'utf8'); }
  catch { return 'CREDITS.md could not be found in this build. The project repository contains the full credits and attribution list.'; }
});

ipcMain.handle('open:search', async (_e, query) => {
  eshell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
});
ipcMain.handle('open:url', async (_e, url) => {
  if (/^https:\/\//.test(url)) eshell.openExternal(url);
});
