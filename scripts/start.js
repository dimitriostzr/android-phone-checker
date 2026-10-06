// npm start — launch the app.
//
// Some editors' integrated terminals (VS Code and anything embedding it) export
// ELECTRON_RUN_AS_NODE=1. With that set, the electron binary behaves like plain
// Node: no window is created, `require('electron').app` is undefined, and the
// app dies immediately with a confusing TypeError that looks like a crash.
// Clearing the variable here means `npm start` behaves the same in every
// terminal. Nothing else about the launch changes.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// macOS takes the Dock tile's name from the bundle it launched, and run from
// source that bundle is Electron's own: it is called Electron.app, its plist
// says Electron, and so the Dock says Electron however the app names itself at
// runtime. app.setName() cannot reach any of it, because the window server reads
// the bundle rather than the process.
//
// So the development copy is renamed: the directory, which is what the Finder
// and the Dock fall back to, and the two plist keys. The electron package
// resolves its binary from path.txt, which is rewritten to match, and this has
// to run before require('electron') reads it.
//
// Only node_modules is touched, npm install undoes all of it, and this puts it
// back on the next start. The bundle is ad-hoc linker-signed with no sealed
// resources, so rewriting the plist does not stop it launching. If any step
// fails the rename is undone, because an app that starts under the wrong name
// is fine and one that cannot start at all is not.
const APP_NAME = 'Phone Checker';
function nameDevBundle() {
  if (process.platform !== 'darwin') return;
  const pkgDir = path.join(__dirname, '..', 'node_modules', 'electron');
  const dist = path.join(pkgDir, 'dist');
  const pathFile = path.join(pkgDir, 'path.txt');
  const from = path.join(dist, 'Electron.app');
  const to = path.join(dist, `${APP_NAME}.app`);
  let renamed = false;
  try {
    if (!fs.existsSync(from) || fs.existsSync(to)) {
      // Already done, or there is nothing here to rename.
      if (fs.existsSync(to)) patchPlist(to);
      return;
    }
    fs.renameSync(from, to);
    renamed = true;
    fs.writeFileSync(pathFile, `${APP_NAME}.app/Contents/MacOS/Electron`);
    patchPlist(to);
    const bin = path.join(to, 'Contents', 'MacOS', 'Electron');
    if (!fs.existsSync(bin)) throw new Error('binary missing after rename');
    const now = new Date();
    fs.utimesSync(to, now, now);
  } catch {
    if (renamed) {
      try {
        fs.renameSync(to, from);
        fs.writeFileSync(pathFile, 'Electron.app/Contents/MacOS/Electron');
      } catch { /* nothing further to try */ }
    }
  }
}
function patchPlist(appDir) {
  const plist = path.join(appDir, 'Contents', 'Info.plist');
  try {
    const before = fs.readFileSync(plist, 'utf8');
    const after = before.replace(
      /(<key>CFBundle(?:Name|DisplayName)<\/key>\s*<string>)Electron(<\/string>)/g,
      `$1${APP_NAME}$2`);
    if (after !== before) fs.writeFileSync(plist, after);
  } catch { /* the plist keys are the least of it if this fails */ }
}

nameDevBundle();

let electron;
try { electron = require('electron'); } catch { electron = null; }
if (typeof electron !== 'string') {
  console.error('Could not find the Electron binary. Run "npm install" first, then "npm start" again.');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  cwd: path.join(__dirname, '..'),
});
child.on('error', (e) => { console.error('Could not start the app:', e.message); process.exit(1); });
child.on('close', (code, signal) => process.exit(signal ? 1 : (code == null ? 0 : code)));
