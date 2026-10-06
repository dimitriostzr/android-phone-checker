// userdata.js — moving the app's store when the app's name changes.
//
// Electron derives getPath('userData') from the application name, and an
// unpackaged app is called "Electron", so naming this one moves everything it
// has saved: per-device baselines, the action log, the disabledByApp list that
// Undo disables reads, and saved snapshots. This carries them across instead of
// leaving them behind looking deleted.
//
// It lives outside main.js so it can be tested without Electron, because the one
// thing it must never do is take a directory that belongs to something else.
'use strict';
const path = require('path');

// Only these. "Electron" is the shared name for every unpackaged Electron app on
// the machine, so its application-support directory may hold other projects'
// data, and none of it is ours to move.
const OURS = ['devices', 'snapshots', 'logs'];

function planStoreMove(fs, from, to) {
  if (!from || !to || from === to) return [];
  // devices/ is the one directory this app always writes and no bare Electron
  // install creates, so it stands as proof the old location is really ours.
  if (!fs.existsSync(path.join(from, 'devices'))) return [];
  return OURS
    .map(sub => ({ sub, from: path.join(from, sub), to: path.join(to, sub) }))
    // Never over the top of something already saved under the new name.
    .filter(m => fs.existsSync(m.from) && !fs.existsSync(m.to));
}

function moveStore(fs, from, to) {
  const done = [];
  for (const m of planStoreMove(fs, from, to)) {
    try {
      fs.mkdirSync(to, { recursive: true });
      fs.renameSync(m.from, m.to);
      done.push(m.sub);
    } catch { /* the original stays where it is; nothing is ever deleted */ }
  }
  return done;
}

module.exports = { planStoreMove, moveStore, OURS };
