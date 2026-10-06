// Renders build/icon.svg to build/icon.png at 1024×1024, the size
// electron-builder wants as the source for .icns and .ico.
//   npm run icon
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
const out = path.join(root, 'build', 'icon.png');
const SIZE = 1024;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const page = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${svg}`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
  await new Promise((r) => setTimeout(r, 400));
  // On a high-density screen the capture comes back at the display scale, so it
  // is resized down to the exact pixel size the packager expects.
  const shot = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const img = shot.getSize().width === SIZE ? shot : shot.resize({ width: SIZE, height: SIZE, quality: 'best' });
  fs.writeFileSync(out, img.toPNG());
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${SIZE}×${SIZE})`);
  app.exit(0);
});
