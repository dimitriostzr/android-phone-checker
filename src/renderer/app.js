'use strict';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// ---------- what an action costs, said before the dialog opens ----------
// Every view that changes the phone says the same three things in the same words:
// whether it can be undone, where from, and whether anything in the selection will
// ask a second time. The native dialog repeats it — this is so nobody has to open
// the dialog to find out.
const RISK = {
  undoHistory: 'Reversible from History',
  undoSaved: 'The previous state is saved first, so this can be undone',
  askTwice: 'asks a second time',
};
function setRiskHint(id, parts) {
  const box = $(id);
  box.innerHTML = '';
  if (!parts || !parts.length) { box.classList.add('hidden'); return; }
  parts.forEach((part, i) => {
    if (i) box.append(el('span', 'sep-dot', '·'));
    box.append(typeof part === 'string' ? el('span', null, part) : el('span', 'rh-warn', part.warn));
  });
  box.classList.remove('hidden');
}

// ---------- anchored action menu ----------
// Views that change one thing about a selection carry one button for that
// decision, not one button per outcome. The alternative — Allow / Ask / Don't
// allow side by side — reflowed the header every time the list filter changed
// and left the current state to be inferred from which button was missing.
// Here every state is listed, the one in force is ticked and unclickable, and
// picking a row acts at once; the native confirmation is still what guards it.
//
// items: { label, note, tone: 'mi-danger' | 'mi-caution', current, disabled, onPick }
let menuOpen = null;
function closeMenu() {
  if (!menuOpen) return;
  const m = menuOpen;
  menuOpen = null;                       // cleared first: removing the popover re-enters here
  m.off();
  m.pop.remove();
  m.anchor.setAttribute('aria-expanded', 'false');
}
function openMenu(anchor, items) {
  const reopen = menuOpen && menuOpen.anchor === anchor;
  closeMenu();
  if (reopen) return;                    // a second click on the same button just closes it
  const pop = el('div', 'menu-pop');
  pop.setAttribute('role', 'menu');
  const rows = [];
  for (const it of items) {
    const b = el('button', `menu-item${it.tone ? ` ${it.tone}` : ''}${it.current ? ' current' : ''}`);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(el('span', 'mi-tick', it.current ? '✓' : ''));
    const label = el('span', 'mi-label', it.label);
    if (it.note) label.append(el('span', 'mi-note', it.note));
    b.append(label);
    // The state a selection is already in is not an action, so it reads as a
    // label rather than a choice — as does a state Android has no version of.
    if (it.disabled || it.current) b.disabled = true;
    else { b.addEventListener('click', () => { closeMenu(); it.onPick(); }); rows.push(b); }
    pop.appendChild(b);
  }
  document.body.appendChild(pop);
  // Hangs under its button, pulled back inside the window rather than off it,
  // and flipped above when there is more room there. It also grows away from the
  // nearer window edge: these buttons sit in a right-aligned header, so a menu
  // that always grew rightward would hang out past its own button and across
  // whatever sits beside it. Edges line up with the button on that side.
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const toLeft = r.left + r.width / 2 > window.innerWidth / 2;
  const x = toLeft ? r.right - w : r.left;
  pop.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
  pop.style.top = r.bottom + 6 + h > window.innerHeight - 8 && r.top - 6 - h > 8
    ? `${r.top - 6 - h}px`
    : `${r.bottom + 6}px`;
  anchor.setAttribute('aria-expanded', 'true');

  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); anchor.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' || !rows.length) return;
    e.preventDefault();
    const i = rows.indexOf(document.activeElement);
    rows[e.key === 'ArrowDown' ? (i + 1) % rows.length : (i <= 0 ? rows.length : i) - 1].focus();
  };
  // Positioned against the window, so anything that moves the button underneath
  // it would leave it stranded.
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', closeMenu, true);
  window.addEventListener('resize', closeMenu);
  menuOpen = {
    pop, anchor,
    off() {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    },
  };
  if (rows.length) rows[0].focus();
}
// A menu button's label changes with the selection; its caret must survive that.
function setMenuLabel(id, text) { $(id).querySelector('.mb-label').textContent = text; }

// Package-name tails that say nothing about the app.
const GENERIC_TAIL = new Set(['application', 'app', 'apps', 'android', 'androidapp', 'mobile', 'client', 'main', 'ui', 'free', 'pro', 'release']);
function appLabel(pkg, known) {
  if (known) return known;
  const parts = String(pkg || '').split('.').filter(Boolean);
  if (!parts.length) return pkg;
  let name = parts[parts.length - 1];
  if (parts.length > 2 && GENERIC_TAIL.has(name.toLowerCase())) {
    const prev = parts[parts.length - 2];
    if (!GENERIC_TAIL.has(prev.toLowerCase())) name = prev;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}
// Where an app came from, in the same colours in every list and dialog: an
// ordinary app store green, the phone's own preloads grey, anything that
// arrived another way amber.
const INSTALLER_CHIPS = {
  'com.android.vending': ['Google Play', 'origin-store'],
  'com.amazon.venezia': ['Amazon Appstore', 'origin-store'],
  'org.fdroid.fdroid': ['F-Droid', 'origin-store'],
  'org.fdroid.basic': ['F-Droid', 'origin-store'],
  'com.aurora.store': ['Aurora Store', 'origin-store'],
  'com.sec.android.app.samsungapps': ["manufacturer's store", 'origin-vendor'],
  'com.samsung.android.themestore': ["manufacturer's store", 'origin-vendor'],
  'com.xiaomi.mipicks': ["manufacturer's store", 'origin-vendor'],
  'com.xiaomi.market': ["manufacturer's store", 'origin-vendor'],
  'com.heytap.market': ["manufacturer's store", 'origin-vendor'],
  'com.oppo.market': ["manufacturer's store", 'origin-vendor'],
  'com.bbk.appstore': ["manufacturer's store", 'origin-vendor'],
  'com.huawei.appmarket': ["manufacturer's store", 'origin-vendor'],
  'com.hihonor.appmarket': ["manufacturer's store", 'origin-vendor'],
  'com.transsnet.store': ["manufacturer's store", 'origin-vendor'],
  'com.google.android.packageinstaller': ['APK file', 'origin-side'],
  'com.android.packageinstaller': ['APK file', 'origin-side'],
  'com.samsung.android.packageinstaller': ['APK file', 'origin-side'],
  'com.android.shell': ['adb / USB', 'origin-side'],
  'com.sec.android.easyMover': ['phone transfer', 'origin-store'],
  'com.samsung.android.smartswitchassistant': ['phone transfer', 'origin-store'],
  'com.google.android.apps.restore': ['restored in setup', 'origin-store'],
  'com.google.android.setupwizard': ['device setup', 'origin-vendor'],
  'com.google.android.gms': ['Google Play services', 'origin-vendor'],
};
function installerChip(installer, isUserApp) {
  if (installer && INSTALLER_CHIPS[installer]) {
    const [label, cls] = INSTALLER_CHIPS[installer];
    const c = el('span', `chip ${cls}`, label);
    c.title = installer;
    return c;
  }
  if (installer) { const c = el('span', 'chip origin-vendor', 'another app'); c.title = installer; return c; }
  if (isUserApp) return el('span', 'chip origin-side', 'no installer recorded');
  return null;
}
const nsOf = (pkg) => { const p = String(pkg || '').split('.'); return p.length >= 2 ? `${p[0]}.${p[1]}` : (p[0] || ''); };
function fillNamespaceSelect(sel, packages) {
  const counts = new Map();
  for (const p of packages) { const ns = nsOf(p); if (ns) counts.set(ns, (counts.get(ns) || 0) + 1); }
  const rows = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const keep = sel.value;
  sel.innerHTML = '';
  const all = el('option', null, `All namespaces (${rows.length})`);
  all.value = '';
  sel.appendChild(all);
  for (const [ns, n] of rows) { const o = el('option', null, `${ns}  (${n})`); o.value = ns; sel.appendChild(o); }
  if (keep && counts.has(keep)) sel.value = keep;
}
const busy = (id, text) => { const s = $(id); s.textContent = ''; s.append(el('span', 'spinner'), document.createTextNode(' ' + text)); };
// While a list is read off the phone, its rows become placeholders shaped like
// the rows that are coming. Without this the view holds the previous list — or
// an empty state inviting you to connect a phone that is already connected —
// while a spinner the size of a full stop turns in the toolbar, which is why it
// reads as stuck rather than busy.
function skeletonRows(id, emptyId, n = 7) {
  const box = $(id);
  if (!box) return;
  if (emptyId && $(emptyId)) $(emptyId).classList.add('hidden');
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const row = el('div', 'prow sk-row');
    const body = el('div', 'body');
    // Two ragged widths per row, so the block reads as text rather than a bar chart.
    body.append(el('div', `sk-bar ${['w25', 'w40', 'w25'][i % 3]}`), el('div', `sk-bar ${['w70', 'w55', 'w40'][i % 3]}`));
    row.append(el('div', 'sk-dot'), body, el('div', 'sk-bar sk-btn'), el('div', 'sk-bar sk-btn'));
    box.appendChild(row);
  }
}
// Every load has an early return for an error or a swapped phone; the
// placeholders have to come down on those paths too, or they sit there for good.
function clearSkeleton(id, emptyId) {
  const box = $(id);
  if (!box) return;
  box.removeAttribute('aria-busy');
  if (box.querySelector('.sk-row')) box.innerHTML = '';
  // Nothing rendered, so the view goes back to how it looked before the read —
  // its empty state — with the status line carrying the reason.
  if (emptyId && $(emptyId)) $(emptyId).classList.remove('hidden');
}

// ---------- navigation ----------
function showView(name) {
  try { sessionStorage.setItem('view', name); } catch {}
  for (const b of document.querySelectorAll('.navitem')) b.classList.toggle('active', b.dataset.view === name);
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('hidden', v.id !== `view-${name}`);
  if (name === 'history') loadHistory();
  if (name === 'device') loadDevice();
  if (name === 'apps') loadApps();
  if (name === 'settings') loadSettings();
  if (name === 'console') { const c = $('console'); c.scrollTop = c.scrollHeight; }
  if (name === 'terminal') loadTerminal();
  if (name === 'origins') loadOrigins();
  // Permissions and the advisor used to sit empty behind a Scan button while
  // every other view read the phone the moment it opened. They are the two
  // heaviest reads, so like Install origins they load once and leave repeat
  // scanning to their own button, rather than re-reading on every visit.
  if (name === 'perms' && !permsData) loadPerms();
  if (name === 'advisor' && !allProposals.length) loadProposals();
  if (name === 'hardware') loadHardware();
  if (name !== 'hardware') stopHwLive();
  if (name === 'snapshots') loadSnapshots();
}
for (const btn of document.querySelectorAll('.navitem')) {
  btn.addEventListener('click', () => showView(btn.dataset.view));
}

// ---------- modal keyboard behaviour ----------
// Eight modals, all plain divs opened by toggling a class. One delegated handler
// gives every one of them the two things a dialog owes a keyboard: Escape closes
// it, and Tab cannot walk out of it into the page underneath. Which modals may be
// dismissed with Escape is a per-modal decision — the startup disclaimer and the
// quit checklist have to be answered, not escaped.
const ESCAPABLE = new Set(['modal-appearance', 'modal-verify', 'modal-snap', 'modal-origin', 'modal-credits', 'modal-disconnect']);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function openModal() {
  const open = [...document.querySelectorAll('.modal-backdrop')].filter(m => !m.classList.contains('hidden'));
  return open[open.length - 1] || null;   // the last one in the DOM wins if two are up
}
const lastFocusBefore = new WeakMap();
function closeModal(m) {
  m.classList.add('hidden');
  const back = lastFocusBefore.get(m);
  lastFocusBefore.delete(m);
  if (back && document.contains(back)) back.focus();
}

// Modals are opened all over this file by removing .hidden, so watch for that
// rather than wrapping thirty call sites: opening moves focus into the dialog and
// remembers where it came from, closing forgets it again — including the closes
// that go through a modal's own button and never reach closeModal().
new MutationObserver((records) => {
  for (const rec of records) {
    const m = rec.target;
    if (!m.classList || !m.classList.contains('modal-backdrop')) continue;
    if (m.classList.contains('hidden')) { lastFocusBefore.delete(m); continue; }
    if (lastFocusBefore.has(m)) continue;
    lastFocusBefore.set(m, document.activeElement);
    const box = m.querySelector('.modal');
    const first = box && box.querySelector(FOCUSABLE);
    if (first) first.focus();
  }
}).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });

document.addEventListener('keydown', (e) => {
  const m = openModal();
  if (!m) return;
  if (e.key === 'Escape' && ESCAPABLE.has(m.id)) { e.preventDefault(); closeModal(m); return; }
  if (e.key !== 'Tab') return;
  const items = [...m.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  // Wrap at both ends, and pull focus back in if it has already escaped.
  if (!m.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}, true);

$('credits-link').addEventListener('click', async (e) => {
  e.preventDefault();
  const body = $('credits-body');
  body.textContent = await window.sentinel.readCredits();
  body.style.cssText = 'white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:50vh;overflow:auto;user-select:text';
  $('modal-credits').classList.remove('hidden');
});
$('credits-close').addEventListener('click', () => $('modal-credits').classList.add('hidden'));
const REPO = 'https://github.com/dimitriostzr/android-phone-checker';
const openExternal = (url) => (e) => { e.preventDefault(); window.sentinel.openUrl(url); };
$('repo-link').addEventListener('click', openExternal(REPO));
$('oss-link').addEventListener('click', openExternal(REPO));
$('repo-fork-link').addEventListener('click', openExternal(REPO + '/fork'));
$('adb-docs-link').addEventListener('click', openExternal('https://developer.android.com/tools/adb'));
$('credits-link-2').addEventListener('click', (e) => { e.preventDefault(); $('credits-link').click(); });

// ---------- theme (light / dark / system) ----------
// The stored preference is 'light' | 'dark' | 'system'; 'system' is resolved
// here so the stylesheet only ever sees data-theme="light" or "dark".
const sysDark = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  let pref = 'system';
  try { pref = localStorage.getItem('theme') || 'system'; } catch {}
  document.documentElement.dataset.theme = pref === 'system' ? (sysDark.matches ? 'dark' : 'light') : pref;
  for (const b of document.querySelectorAll('[data-theme]')) b.classList.toggle('active', b.dataset.theme === pref);
  if (typeof applyAccent === 'function') applyAccent();
}
sysDark.addEventListener('change', applyTheme);
for (const b of document.querySelectorAll('[data-theme]')) {
  b.addEventListener('click', () => { try { localStorage.setItem('theme', b.dataset.theme); } catch {} applyTheme(); });
}
// Appearance lives in a dialog so the sidebar stays about navigation.
$('open-appearance').addEventListener('click', () => $('modal-appearance').classList.remove('hidden'));
$('appearance-close').addEventListener('click', () => $('modal-appearance').classList.add('hidden'));

// ---------- accent colour ----------
// Every highlight in the app (buttons, focus rings, links, chart lines, the
// logo) comes from --accent / --accent-2, so one pair of values re-colours the
// whole interface. Each preset carries a light and a dark variant, because a
// tone that reads well on the dark panels is too pale on the light ones.
const ACCENTS = {
  blue:  { dark: ['#4c8dff', '#7c5cff'], light: ['#2e6de0', '#6a4de0'] },
  teal:  { dark: ['#2ec4b6', '#3aa0d8'], light: ['#0e8a7e', '#2a7fae'] },
  green: { dark: ['#46b86a', '#8cc152'], light: ['#1f8a4c', '#5a952c'] },
  amber: { dark: ['#e2a33c', '#e0783c'], light: ['#a16d15', '#a3551c'] },
  rose:  { dark: ['#ec6a8c', '#c76ae0'], light: ['#c2416a', '#9646c0'] },
  slate: { dark: ['#8aa0b8', '#6f8095'], light: ['#4d5f75', '#5f6f85'] },
};
// A custom colour only gives one value; the second is the same tone rotated a
// little, which keeps the two-colour gradients from turning flat.
function shiftHue(hex, deg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, sat = 0;
  if (d) {
    sat = l > .5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  h = (h + deg + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), mm = l - c / 2;
  const [rr, gg, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hx = (v) => Math.round((v + mm) * 255).toString(16).padStart(2, '0');
  return `#${hx(rr)}${hx(gg)}${hx(bb)}`;
}
function applyAccent() {
  let pref = 'blue';
  try { pref = localStorage.getItem('accent') || 'blue'; } catch {}
  const dark = document.documentElement.dataset.theme === 'dark';
  const custom = /^#[0-9a-f]{6}$/i.test(pref);
  const pair = custom ? [pref, shiftHue(pref, 28)] : (ACCENTS[pref] || ACCENTS.blue)[dark ? 'dark' : 'light'];
  document.documentElement.style.setProperty('--accent', pair[0]);
  document.documentElement.style.setProperty('--accent-2', pair[1]);
  for (const b of document.querySelectorAll('.accent-btn[data-accent]')) b.classList.toggle('active', b.dataset.accent === pref);
  const cust = document.querySelector('.accent-custom');
  if (cust) cust.classList.toggle('active', custom);
  $('accent-custom').value = custom ? pref : pair[0];
}
for (const b of document.querySelectorAll('.accent-btn[data-accent]')) {
  b.addEventListener('click', () => { try { localStorage.setItem('accent', b.dataset.accent); } catch {} applyAccent(); });
}
$('accent-custom').addEventListener('input', (e) => {
  try { localStorage.setItem('accent', e.target.value); } catch {}
  applyAccent();
});
applyTheme();

// ---------- device / connection ----------
// Every store is per-serial; the UI must follow. When the connected serial
// changes, all cached per-phone views are dropped and reloaded.
let currentSerial;
function trackSerial(serial) {
  if (serial === currentSerial) return;
  const first = currentSerial === undefined;
  currentSerial = serial;
  if (!first) onDeviceSwitched();
}

async function refreshDevice() {
  const d = await window.sentinel.deviceSummary();
  const conn = $('conn');
  if (d.state !== 'device') {
    trackSerial(null);
    conn.classList.remove('on');
    conn.classList.toggle('warn', d.state === 'unauthorized' || d.state === 'multiple');
    $('conn-eject').classList.add('hidden');
    // If the dialog is open and the phone has gone, say so rather than leave it waiting.
    const dm = $('modal-disconnect');
    if (!dm.classList.contains('hidden') && $('disc-done').classList.contains('hidden')) {
      showDisconnected('The phone is no longer connected. You can unplug the cable if it is still attached.');
    }
    $('conn-text').textContent = d.state === 'unauthorized' ? 'Unauthorized — check phone'
      : d.state === 'multiple' ? 'Multiple phones attached' : 'No device';
    $('device-info').innerHTML = d.state === 'unauthorized'
      ? 'Device found but unauthorized.<br>Accept the USB debugging prompt on the phone.'
      : d.state === 'multiple'
        ? 'More than one phone is attached.<br>Phone Checker talks to one at a time — unplug the other.'
        : 'No device connected.<br>Enable USB debugging and plug in.';
    $('device-chips').innerHTML = '';
    renderFirstRun(false);
    return null;
  }
  trackSerial(d.serial);
  renderFirstRun(true);
  conn.classList.add('on');
  conn.classList.remove('warn');
  $('conn-eject').classList.remove('hidden');
  $('conn-text').textContent = d.model;
  const kv = $('device-info');
  kv.innerHTML = '';
  for (const [k, v] of [
    ['Model', `${d.manufacturer} ${d.model}`],
    ['Android', `${d.android}`],
    ['Security patch', d.patch],
  ]) { const line = el('div'); line.append(el('b', null, k + '  '), document.createTextNode(v)); kv.appendChild(line); }

  const chips = $('device-chips');
  chips.innerHTML = '';
  const pill = (cls, text) => chips.appendChild(el('span', `pill ${cls}`, text));
  pill(d.verifiedBoot === 'green' ? 'good' : 'bad', d.verifiedBoot === 'green' ? 'verified boot' : `boot: ${d.verifiedBoot}`);
  pill(d.bootloaderLocked === '1' ? 'good' : 'bad', d.bootloaderLocked === '1' ? 'bootloader locked' : 'bootloader unlocked');
  if (d.knoxWarranty === '0') pill('good', 'knox intact');
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.patch)) {
    const age = Math.floor((Date.now() - new Date(d.patch).getTime()) / 86400000);
    pill(age > 120 ? 'bad' : age > 60 ? 'warn' : 'good', `patch ${age}d old`);
  }
  return d;
}
refreshDevice();
setInterval(refreshDevice, 5000);

// Editing checks.js or main.js changes nothing until the process restarts, and
// the symptom is silent: counts read zero, buttons do nothing. Say so instead.
(async () => {
  try {
    const r = await window.sentinel.isStale();
    if (r && r.stale) $('stale-banner').classList.remove('hidden');
  } catch {
    // The handler itself is missing, which is proof enough that main is old.
    $('stale-banner').classList.remove('hidden');
  }
})();

async function checkAdb() {
  const { path, downloadUrl } = await window.sentinel.locateAdb();
  const banner = $('adb-missing');
  if (!path) {
    banner.classList.remove('hidden');
    banner.textContent = "adb was not found on this computer. Install Google's official platform-tools and restart the app. ";
    const a = el('a', null, 'Open download page'); a.href = '#';
    a.addEventListener('click', (e) => { e.preventDefault(); window.sentinel.openUrl(downloadUrl); });
    banner.appendChild(a);
    return false;
  }
  banner.classList.add('hidden');
  return true;
}
checkAdb();

// ---------- donut & trend charts ----------
const SVGNS = 'http://www.w3.org/2000/svg';
function drawDonut(counts) {
  const skipped = counts.skip || 0;
  const total = Math.max(1, counts.ok + counts.note + counts.flag + skipped);
  const size = 136, r = 53, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  // A viewBox so the stylesheet can shrink it on a narrow window without the
  // ring going oval.
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const base = document.createElementNS(SVGNS, 'circle');
  base.setAttribute('cx', cx); base.setAttribute('cy', cy); base.setAttribute('r', r);
  base.setAttribute('fill', 'none'); base.style.stroke = 'var(--donut-track)'; base.setAttribute('stroke-width', 13);
  svg.appendChild(base);
  let off = 0;
  for (const [key, color] of [['ok', 'var(--ok)'], ['note', 'var(--note)'], ['flag', 'var(--flag)'], ['skip', 'var(--muted)']]) {
    const frac = (counts[key] || 0) / total;
    if ((counts[key] || 0) > 0) {
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
      c.setAttribute('fill', 'none'); c.style.stroke = color; c.setAttribute('stroke-width', 13);
      c.setAttribute('stroke-dasharray', `${Math.max(0.001, frac * C - 2)} ${C}`);
      c.setAttribute('stroke-dashoffset', -off * C);
      c.setAttribute('stroke-linecap', 'round');
      c.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
      svg.appendChild(c);
    }
    off += frac;
  }
  const issues = counts.flag + counts.note;
  const num = document.createElementNS(SVGNS, 'text');
  num.setAttribute('x', cx); num.setAttribute('y', cy + 3); num.setAttribute('text-anchor', 'middle');
  num.style.fill = counts.flag ? 'var(--flag)' : counts.note ? 'var(--note)' : skipped ? 'var(--muted)' : 'var(--ok)';
  num.setAttribute('font-size', '32'); num.setAttribute('font-weight', '700'); num.setAttribute('font-family', 'inherit');
  num.textContent = issues === 0 && skipped > 0 ? String(skipped) : issues === 0 && counts.ok > 0 ? '✓' : String(issues);
  const lab = document.createElementNS(SVGNS, 'text');
  lab.setAttribute('x', cx); lab.setAttribute('y', cy + 24); lab.setAttribute('text-anchor', 'middle');
  lab.style.fill = 'var(--muted)'; lab.setAttribute('font-size', '10.5'); lab.setAttribute('font-family', 'inherit');
  lab.textContent = issues === 0 && skipped > 0 ? 'unreadable' : issues === 0 && counts.ok > 0 ? 'all clear' : 'to look at';
  svg.append(num, lab);
  $('donut').innerHTML = '';
  $('donut').appendChild(svg);
}
drawDonut({ ok: 0, note: 0, flag: 0 });

const SLOTS = 14;
function drawTrend(history) {
  const box = $('trend');
  box.innerHTML = '';
  const runs = [...history].reverse().slice(-SLOTS);
  const max = Math.max(1, ...runs.map(r => r.counts.flag + r.counts.note));
  for (let i = 0; i < SLOTS - runs.length; i++) box.appendChild(el('div', 'tbar ghost'));
  for (const r of runs) {
    const bar = el('div', 'tbar');
    bar.title = `${new Date(r.ts).toLocaleString()}\n${r.counts.flag} flagged · ${r.counts.note} to review · ${r.counts.ok} clear`;
    const issues = r.counts.flag + r.counts.note;
    if (r.counts.flag) { const s = el('div', 'tseg flag'); s.style.height = `${(r.counts.flag / max) * 62}px`; bar.appendChild(s); }
    if (r.counts.note) { const s = el('div', 'tseg note'); s.style.height = `${(r.counts.note / max) * 62}px`; bar.appendChild(s); }
    const okb = el('div', 'tseg okbase'); okb.style.height = issues ? '5px' : '24px'; bar.appendChild(okb);
    box.appendChild(bar);
  }
}

// ---------- health checks ----------
// Web-search query for a finding line: prefer a package name, then a settings
// key, then the line text itself.
function searchQueryFor(line) {
  const t = line.trim();
  // Summary, explainer and pointer lines get no link.
  if (t.length < 4 || t.endsWith(':') || t.startsWith('→')) return null;
  const pkg = t.match(/\b[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){2,}\b/i);
  if (pkg) return `${pkg[0]} android package what is it`;
  const key = t.match(/^[✓✗]?\s*([a-z0-9_]{6,}) =/);
  if (key) return `android setting ${key[1]} what does it do`;
  return `${t.replace(/\s+/g, ' ').slice(0, 90)} android`;
}

// Checks whose lines name packages worth tracing back to their installer.
const ORIGIN_CARDS = new Set(['tripwires', 'packages', 'installers', 'masquerade']);

// The dot alone carries the status by colour, which is invisible to anyone who
// cannot separate the hues. The same glyph set History already uses goes inside
// it, and the status word itself goes to a screen reader.
const STATUS_GLYPH = { flag: '\u2691', note: '\u25d0', skip: '\u2298', info: 'i', ok: '\u2713' };
const STATUS_WORD = { flag: 'flagged', note: 'worth a look', skip: 'could not be read', info: 'information', ok: 'clear' };
function statusDot(status) {
  const d = el('span', `dot ${status}`, STATUS_GLYPH[status] || '');
  d.setAttribute('aria-hidden', 'true');
  return d;
}

function cardFor(r, collapsed = false) {
  const card = el('details', `card ${r.status}`);
  card.open = !collapsed && (r.status === 'flag' || r.status === 'note' || r.status === 'skip');
  const sum = el('summary');
  const verdict = el('span', 'card-verdict', (r.lines[0] || '').slice(0, 90));
  sum.append(statusDot(r.status), el('span', 'sr-only', `${STATUS_WORD[r.status] || r.status}: `), el('span', 'card-title', r.title));
  if (r.scope) sum.append(el('span', `chip scope-${r.scope}`, r.scope));
  sum.append(verdict, el('span', 'chev', '▶'));
  const body = el('div', 'body');
  const ul = el('ul');
  for (const line of r.lines) {
    const li = el('li', null, line);
    if (line.includes('.') && /[a-z0-9_]\.[a-z0-9_]/i.test(line)) li.classList.add('mono');
    const q = searchQueryFor(line);
    if (q) {
      const a = el('a', 'li-search', 'search online');
      a.href = '#';
      a.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); window.sentinel.searchWeb(q); });
      li.append(' ', a);
    }
    if (ORIGIN_CARDS.has(r.id)) {
      const pm = line.match(/\b[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){2,}\b/i);
      if (pm && !line.trim().endsWith(':')) {
        const go = el('a', 'li-search', 'install origin');
        go.href = '#';
        go.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); openOrigin(pm[0]); });
        li.append(' ', go);
      }
    }
    // Setting lines in the privacy check link straight to their row in Phone settings.
    if (r.id === 'privacy') {
      const m = line.match(/^[✓✗]\s*([a-z0-9_]{4,}) =/);
      if (m) {
        const go = el('a', 'li-search', 'open in Phone settings');
        go.href = '#';
        go.addEventListener('click', (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          highlightSettingKey = m[1];
          settingsFilter = 'all';
          showView('settings');
        });
        li.append(' ', go);
      }
    }
    ul.appendChild(li);
  }
  body.appendChild(ul);
  if (r.action) {
    const b = el('button', 'small card-action', r.action.label);
    b.addEventListener('click', async () => {
      b.disabled = true;
      if (r.action.ipc === 'trustSideloads') await window.sentinel.trustSideloads(r.action.payload);
      b.textContent = 'Saved — reflected on next run';
    });
    body.appendChild(b);
  }
  card.append(sum, body);
  const syncV = () => { verdict.style.visibility = card.open ? 'hidden' : 'visible'; };
  card.addEventListener('toggle', syncV); syncV();
  return card;
}

function showCards(has) {
  $('cards-empty').classList.toggle('hidden', has);
  $('cards-panel').classList.toggle('hidden', !has);
}
showCards(false);

// One report panel, worst first. During a run cards stream in check order;
// when the run completes (and on launch restore) the list is re-rendered sorted.
const STATUS_ORDER = { flag: 0, note: 1, info: 2, ok: 3, skip: 4 };
let lastResults = null, lastRunTs = null, lastDevice = null, lastDeviceLabel = '';

// Tag a view with the phone its data belongs to; grayed out when that phone
// is not the one currently connected.
function setDeviceTag(id, dev, connected) {
  const t = $(id);
  if (!dev || !(dev.model || dev.serial)) { t.classList.add('hidden'); t.textContent = ''; return ''; }
  const label = `${dev.model || dev.serial}${connected ? '' : ' · not connected'}`;
  t.textContent = label;
  t.classList.remove('hidden');
  t.classList.toggle('off', !connected);
  return label;
}
function renderCards(results, collapsed = false, restored = false) {
  lastResults = results;
  $('cards-restored').classList.toggle('hidden', !restored);
  const box = $('cards');
  box.innerHTML = '';
  const sorted = [...results].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
  for (const r of sorted) box.appendChild(cardFor(r, collapsed));
  const issues = results.filter(r => r.status === 'flag' || r.status === 'note').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  $('cards-count').textContent = issues ? `${issues} of ${results.length} worth a look`
    : skipped ? `${results.length} checks — ${skipped} could not read the phone, the rest clear`
    : `${results.length} checks, all clear`;
}

window.sentinel.onCheckResult((r) => { showCards(true); $('cards').appendChild(cardFor(r)); });

function setHero(counts, device, ts, restored = false) {
  drawDonut(counts);
  const skipped = counts.skip || 0;
  const from = restored ? ' (from your last run — run the checks again for a fresh look)' : '';
  $('hero-title').textContent = counts.flag ? 'Attention needed' : counts.note ? 'Mostly clear' : skipped ? 'Partly unreadable' : 'All clear';
  $('hero-sub').textContent = counts.flag
    ? `${counts.flag} check(s) flagged — open the red cards below.`
    : counts.note ? `${counts.note} item(s) worth a look; nothing alarming.`
    : skipped ? `${skipped} check(s) could not read the phone and are not counted as passed — reconnect and run again.`
    : `${counts.ok} checks passed${device ? ` on ${device.model}` : ''} — within what these checks can see; not proof the phone is clean.`;
  $('hero-sub').textContent += from;
  $('checks-status').textContent = `Last run: ${new Date(ts || Date.now()).toLocaleString()}`;
  $('cards-restored').title = `These results were recorded on ${new Date(ts || Date.now()).toLocaleString()}. Run the checks again for a fresh look at the phone.`;
}

// ---------- the first-run path: connect to disconnect, once ----------
// New people get no walkthrough anywhere in the app: the accept-gated notice
// appears every launch and says nothing about what to do, and the quit checklist
// only covers the end. This is the whole path as five chips, each one the link
// that does that step, shown until the first run has happened and then gone for
// good. No explanatory paragraph — that is what the info-tips are for.
const FIRSTRUN_KEY = 'firstRunDone';
let firstRunReviewed = false;
let firstRunDisconnected = false;
let firstRunDrawn = null;

function firstRunDone() {
  try { return localStorage.getItem(FIRSTRUN_KEY) === '1'; } catch { return true; }
}
function markFirstRunDone() {
  try { localStorage.setItem(FIRSTRUN_KEY, '1'); } catch {}
}

function renderFirstRun(connected) {
  const bar = $('firstrun');
  if (firstRunDone()) { bar.classList.add('hidden'); return; }
  const steps = [
    { label: 'Connect', done: connected, go: null },
    { label: 'Run the checks', done: heroRunCount > 0, go: () => $('run-checks').click() },
    { label: 'Review what it found', done: firstRunReviewed, go: () => {
        const card = $('cards').querySelector('.card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } },
    { label: 'Save a state (optional)', done: heroSnapCount > 0, go: () => { showView('snapshots'); $('snap-label').focus(); } },
    { label: 'Disconnect safely', done: firstRunDisconnected, go: () => $('conn-eject').click() },
  ];
  // The path is finished once the last step is ticked; after that it never returns.
  if (steps.every(st => st.done)) { markFirstRunDone(); bar.classList.add('hidden'); return; }
  // refreshDevice re-runs every few seconds; only redraw when something changed.
  const signature = steps.map(st => st.done ? '1' : '0').join('');
  if (signature === firstRunDrawn) { bar.classList.remove('hidden'); return; }
  firstRunDrawn = signature;
  const next = steps.findIndex(st => !st.done);
  const box = $('firstrun-steps');
  box.innerHTML = '';
  steps.forEach((st, i) => {
    if (i) box.append(el('span', 'fr-arrow', '\u203a'));
    const chip = el('button', `fr-step${st.done ? ' done' : i === next ? ' now' : ''}`);
    chip.type = 'button';
    chip.append(el('span', 'fr-tick', st.done ? '\u2713' : String(i + 1)), el('span', null, st.label));
    if (st.go) chip.addEventListener('click', st.go);
    else chip.disabled = true;
    box.append(chip);
  });
  bar.classList.remove('hidden');
}

$('firstrun-dismiss').addEventListener('click', () => {
  markFirstRunDone();
  $('firstrun').classList.add('hidden');
});
// Opening a check card is what "review" means; nothing else in the app can tell.
$('cards').addEventListener('click', () => { firstRunReviewed = true; renderFirstRun(!!currentSerial); });

// ---------- one clear next action, keyed on what the run actually found ----------
// After a run the hero says what was found and stops. This says what to do about
// it: open the flagged cards, save a first baseline so the next update can be
// compared, look at what changed since last time, and — always — finish safely.
// Each item is a link straight to the screen that does it, never an explanation.
let heroRunCount = 0;
let heroSnapCount = null;

function setHeroNext(counts) {
  const box = $('hero-next');
  box.innerHTML = '';
  if (!counts) { box.classList.add('hidden'); return; }
  const acts = [];
  if (counts.flag) {
    acts.push(['Open the flagged checks', () => {
      const first = $('cards').querySelector('.card.flag');
      if (first) { first.open = true; first.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }]);
  }
  if (!counts.flag && heroSnapCount === 0) {
    acts.push(['Save a baseline now', () => { showView('snapshots'); $('snap-label').focus(); }]);
  }
  if (heroRunCount >= 2) {
    acts.push(['See what changed since the last run', () => {
      showView('history');
      const panel = $('diff-panel');
      if (!panel.classList.contains('hidden')) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }]);
  }
  acts.push(['Done? Disconnect safely', () => $('conn-eject').click()]);

  box.append(el('span', 'hero-next-lead', 'Next:'));
  acts.forEach(([label, go], i) => {
    if (i) box.append(el('span', 'sep-dot', '·'));
    const a = el('button', 'linkish', label);
    a.type = 'button';
    a.addEventListener('click', go);
    box.append(a);
  });
  box.classList.remove('hidden');
}

// Both counts come from disk, so the line can be right on the very first run.
async function refreshHeroCounts() {
  try {
    const [h, s] = await Promise.all([window.sentinel.listHistory(), window.sentinel.snapshotsList()]);
    heroRunCount = (h.history || []).length;
    heroSnapCount = (s.snapshots || []).length;
  } catch { heroSnapCount = null; }
}

$('run-checks').addEventListener('click', async () => {
  if (!(await checkAdb())) return;
  $('cards').innerHTML = '';
  showCards(true);
  busy('checks-status', 'Running checks on the phone…');
  $('run-checks').disabled = true;
  const res = await window.sentinel.runChecks();
  $('run-checks').disabled = false;
  if (res.error) { $('checks-status').textContent = res.error; return; }
  setHero(res.counts, res.device);
  lastRunTs = Date.now(); lastDevice = res.device;
  lastDeviceLabel = setDeviceTag('cards-device', res.device, true);
  renderCards(res.results);
  const h = await window.sentinel.listHistory();
  drawTrend(h.history || []);
  await refreshHeroCounts();
  setHeroNext(res.counts);
  renderFirstRun(true);
});

// ---------- debloat advisor ----------
const TIER_LABELS = {
  recommended: 'Recommended — safe for nearly everyone',
  optional: 'Optional — disables a feature some people use',
  caution: 'Caution — disable only if you understand the trade-off',
  keep: 'Keep — known to break things (shown for education)',
};
let selected = new Set();
let allProposals = [];

function syncApplyButton() {
  $('apply-disable').classList.toggle('hidden', selected.size === 0);
  $('apply-disable').textContent = `Disable ${selected.size} selected…`;
  // The advisor already shows a tier chip per row; this says what the tiers mean
  // for the batch as a whole, in the same words the Apps and Permissions views use.
  const chosen = allProposals.filter(p => selected.has(p.pkg));
  const caution = chosen.filter(p => p.tier === 'caution').length;
  $('apply-disable').classList.toggle('danger', caution > 0);
  $('apply-disable').classList.toggle('small', caution === 0);
  if (!selected.size) { setRiskHint('advisor-risk', null); return; }
  const parts = [`${RISK.undoHistory}, item by item or all at once.`];
  parts.push(caution
    ? { warn: `${caution} caution item(s) selected — each one ${RISK.askTwice} and spells out what it breaks.` }
    : 'Nothing in this selection is caution-tier, so it asks once.');
  setRiskHint('advisor-risk', parts);
}

// A proposal and an app row carry the same two facts under different names.
const asApp = (p) => ({ disabled: p.state === 'disabled', enabled: p.enabled });

function proposalRow(p) {
  const row = el('div', 'prow');
  if (p.tier !== 'keep' && p.state === 'enabled') {
    const cb = el('input');
    cb.type = 'checkbox'; cb.checked = selected.has(p.pkg);
    cb.addEventListener('change', () => { cb.checked ? selected.add(p.pkg) : selected.delete(p.pkg); syncApplyButton(); });
    row.appendChild(cb);
  } else {
    row.appendChild(el('span', 'donemark', p.state === 'disabled' ? '✓' : ''));
  }
  const body = el('div', 'body');
  const nameLine = el('div');
  // The advisor and the Apps view describe an off package the same way, out of
  // the same table, so the two screens cannot tell different stories about it.
  const off = offState(asApp(p));
  nameLine.append(el('span', 'name', p.name), el('span', `chip ${p.tier}`, p.tier));
  if (off && off.chip !== 'disabled') {
    const c = el('span', 'chip optional', off.chip);
    c.title = off.why;
    nameLine.append(c);
  } else {
    nameLine.append(el('span', `chip state-${p.state}`, p.state));
  }
  body.append(nameLine, el('div', 'pkg', p.pkg), el('div', 'desc', p.desc));
  const search = el('button', 'small', 'Search web');
  search.addEventListener('click', () => window.sentinel.searchWeb(`${p.pkg} android what is safe to disable`));
  row.append(body, search, originButton(p.pkg));
  if (canEnable(asApp(p))) {
    const en = el('button', 'small', 'Enable');
    en.addEventListener('click', async () => {
      en.disabled = true;
      const res = await window.sentinel.enablePackage(p.pkg);
      if (res && res.cancelled) { en.disabled = false; return; }
      // pm refuses inside its own output rather than by failing the call, so the
      // reply is checked instead of assumed. This used to reload the list and
      // leave the row exactly as it was, with nothing said.
      if (!res || !res.ok) {
        $('advisor-status').textContent = `${p.name} could not be switched on — ${androidWhy(res)}`;
        en.disabled = false;
        return;
      }
      loadProposals();
    });
    row.appendChild(en);
  }
  return row;
}

// A package is "handled" when there is nothing left to decide: it is already
// disabled, or it is keep-tier (never selectable, listed for education only).
let advisorTab = 'unhandled';
const isHandled = (p) => p.state === 'disabled' || p.tier === 'keep';

function setAdvisorTab(tab) {
  advisorTab = tab;
  $('tab-unhandled').classList.toggle('active', tab === 'unhandled');
  $('tab-handled').classList.toggle('active', tab === 'handled');
  renderProposals();
}
$('tab-unhandled').addEventListener('click', () => setAdvisorTab('unhandled'));
$('tab-handled').addEventListener('click', () => setAdvisorTab('handled'));

function renderProposals() {
  const q = $('advisor-search').value.trim().toLowerCase();
  const matched = allProposals.filter(p => !q || `${p.pkg} ${p.name} ${p.desc}`.toLowerCase().includes(q));
  const unhandled = matched.filter(p => !isHandled(p));
  const handled = matched.filter(isHandled);
  $('count-unhandled').textContent = String(unhandled.length);
  $('count-handled').textContent = String(handled.length);
  const box = $('proposals');
  box.innerHTML = '';
  const items = advisorTab === 'handled' ? handled : unhandled;
  if (!items.length) {
    box.appendChild(el('div', 'tab-empty', advisorTab === 'handled'
      ? (q ? 'No handled packages match the filter.' : 'Nothing handled yet — packages you disable (plus keep-tier ones, which need no action) collect here.')
      : (q ? 'No unhandled packages match the filter.' : 'All handled ✓ — every actionable package is already disabled.')));
    return;
  }
  const byTier = {};
  for (const p of items) (byTier[p.tier] = byTier[p.tier] || []).push(p);
  for (const tier of ['recommended', 'optional', 'caution', 'keep']) {
    const rows = byTier[tier];
    if (!rows || !rows.length) continue;
    const h = el('div', 'tier-head', TIER_LABELS[tier] + ' ');
    h.appendChild(el('span', 'count', String(rows.length)));
    box.appendChild(h);
    for (const p of rows) box.appendChild(proposalRow(p));
  }
}

async function loadProposals() {
  if (!(await checkAdb())) return;
  selected = new Set();
  syncApplyButton();
  busy('advisor-status', 'Scanning installed packages…');
  skeletonRows('proposals', 'advisor-empty');
  const res = await window.sentinel.listProposals();
  if (res.error) { $('advisor-status').textContent = res.error; clearSkeleton('proposals', 'advisor-empty'); return; }
  clearSkeleton('proposals');
  $('advisor-empty').classList.add('hidden');
  $('advisor-tabs').classList.remove('hidden');
  allProposals = res.proposals;
  const enabledRec = allProposals.filter(p => p.tier === 'recommended' && p.state === 'enabled').length;
  $('advisor-status').textContent = `${allProposals.length} known packages · ${enabledRec} recommended still enabled · ${res.disabledByApp.length} disabled by this app`;
  $('select-recommended').classList.toggle('hidden', enabledRec === 0);
  $('revert-all').classList.toggle('hidden', res.disabledByApp.length === 0);
  $('revert-all').textContent = `Undo all app changes (${res.disabledByApp.length})`;
  renderProposals();
}

$('load-proposals').addEventListener('click', loadProposals);
$('advisor-search').addEventListener('input', renderProposals);
$('select-recommended').addEventListener('click', () => {
  for (const p of allProposals) if (p.tier === 'recommended' && p.state === 'enabled') selected.add(p.pkg);
  syncApplyButton(); renderProposals();
});
$('apply-disable').addEventListener('click', async () => {
  const res = await window.sentinel.disablePackages([...selected]);
  if (res.cancelled || res.error) return;
  selected = new Set();
  loadProposals();
});
$('revert-all').addEventListener('click', async () => {
  const res = await window.sentinel.revertAll();
  if (res.cancelled || res.error) return;
  loadProposals();
});

// ---------- apps (every installed package; bulk disable & battery states) ----------
let appsList = [];
let appsFilter = 'all';
let selectedApps = new Set();
let batteryChangedCount = 0;
let disabledCount = 0;          // packages this app has disabled and can switch back

function syncAppsActions() {
  const n = selectedApps.size;
  const vis = appsList.length ? visibleApps() : [];
  const chosen = vis.filter(a => selectedApps.has(a.pkg)).length;
  const box = $('apps-selall');
  box.checked = vis.length > 0 && chosen === vis.length;
  box.indeterminate = chosen > 0 && chosen < vis.length;
  $('apps-selall-label').textContent = n
    ? `${n} selected${chosen < n ? ` (${chosen} of ${vis.length} listed)` : ''}`
    : `select all listed (${vis.length})`;
  $('apps-clear-sel').classList.toggle('hidden', n === 0);
  $('apps-battery-set').classList.toggle('hidden', n === 0);
  if (n) setMenuLabel('apps-battery-set', `Set battery for ${n}`);
  $('apps-battery-revert').classList.toggle('hidden', batteryChangedCount === 0);
  $('apps-battery-revert').textContent = `Undo battery changes (${batteryChangedCount})`;
  $('apps-enable-all').classList.toggle('hidden', disabledCount === 0);
  $('apps-enable-all').textContent = `Undo disables (${disabledCount})`;

  // A bulk disable is only a caution-tier action when the selection reaches into
  // system packages; a folder of apps you installed yourself is not.
  const chosenApps = appsList.filter(a => selectedApps.has(a.pkg));
  const onCount = chosenApps.filter(canDisable).length;
  $('apps-disable').classList.toggle('hidden', onCount === 0);
  $('apps-disable').textContent = `Disable ${onCount} selected…`;
  // Counted over the apps that will actually be disabled, so the second-consent
  // warning cannot be triggered by a system app the command will never reach.
  const sysCount = chosenApps.filter(a => canDisable(a) && !a.user).length;
  // Counts only the disabled ones: a mixed selection enables what is off and
  // leaves the rest alone, and the label says how many that is.
  const offCount = chosenApps.filter(canEnable).length;
  $('apps-enable').classList.toggle('hidden', offCount === 0);
  $('apps-enable').textContent = `Enable ${offCount} selected…`;
  // Selecting apps the phone put to sleep is easy to do by accident, since they
  // look switched off like any other. Say so rather than leaving a button that
  // quietly covers fewer apps than are selected.
  setRiskHint('apps-stuck', stuckHint(chosenApps.filter(a => !shellCanSwitch(a))));
  $('apps-disable').classList.toggle('danger', sysCount > 0);
  $('apps-disable').classList.toggle('small', sysCount === 0);
  if (!n) { setRiskHint('apps-risk', null); return; }
  const parts = ['Disable: reversible here with Enable, and from History.', `Battery: ${RISK.undoSaved} with "Undo battery changes".`];
  if (sysCount) {
    parts.push({ warn: `${sysCount} system app(s) selected — disabling, or restricting their battery, ${RISK.askTwice}.` });
  }
  setRiskHint('apps-risk', parts);
}

// Android's enabled states, and which of them adb can undo. Only DISABLED_USER
// is reversible from here: it is what "pm disable-user" sets, so it is what this
// app sets. An app the phone put to sleep, or the system switched off, refuses
// "pm enable" with a SecurityException however it is asked, so the UI says what
// happened instead of offering a button that cannot work.
function androidWhy(res) {
  const raw = String((res && (res.out || res.error)) || '').trim();
  if (!raw) return 'Android refused it without saying why';
  if (/SecurityException/.test(raw)) return 'Android does not allow adb to change this one\'s state';
  return raw.split('\n')[0].slice(0, 160);
}
const OFF_STATE = {
  2: { chip: 'disabled by the system',
       why: 'The phone or its manufacturer switched this off, not you. Nothing here can move it, '
          + "on or off — only the phone's own Settings can." },
  3: { chip: 'disabled',
       why: 'Switched off the ordinary, reversible way — Enable puts it straight back.' },
  4: { chip: 'asleep — unused',
       why: 'The phone put this app to sleep because it went a long time without being opened, and will not let '
          + 'anything else wake it. Open it on the phone under Settings › Apps to bring it back, then turn off '
          + '"Pause app activity if unused" so it stays back.' },
};
// The whole rule, in one place. Android lets the shell move a package only
// between DEFAULT, ENABLED and DISABLED_USER, and only when it already sits in
// one of those three. From DISABLED (2) or DISABLED_UNTIL_USED (4) every write
// is refused — "Shell cannot change component state" — and refused in BOTH
// directions, which is the part that is easy to miss: an app the phone put to
// sleep can no more be disabled than it can be switched on.
const SHELL_STATES = new Set([0, 1, 3]);
// A package whose state could not be read falls back to the old yes/no answer
// and is assumed movable — the behaviour from before the state was read at all,
// so a parse that comes back empty loses nothing.
const shellCanSwitch = (a) => a.enabled === undefined || SHELL_STATES.has(a.enabled);
const offState = (a) => (a.disabled ? (OFF_STATE[a.enabled] || OFF_STATE[3]) : null);
const canEnable = (a) => !!a.disabled && shellCanSwitch(a);
const canDisable = (a) => !a.disabled && shellCanSwitch(a);

// Says which apps, why the phone is holding them, and where to go instead. The
// two states have different causes and different cures, so they get a sentence
// each — joined into one line, because a middle dot between two full sentences
// reads as a typo.
function stuckHint(apps) {
  if (!apps.length) return null;
  const say = (xs) => {
    const one = xs.length === 1;
    const who = xs.length <= 3
      ? xs.map(a => appLabel(a.pkg, a.known)).join(xs.length === 2 ? ' and ' : ', ')
      : `${xs.length} of the selected apps`;
    return { one, who, it: one ? 'it' : 'them' };
  };
  const out = [];
  const asleep = apps.filter(a => a.enabled === 4);
  const bySystem = apps.filter(a => a.enabled !== 4);
  if (asleep.length) {
    const { one, who, it } = say(asleep);
    out.push(`${who} ${one ? 'is' : 'are'} asleep. The phone does this to apps left unopened for a long `
      + `time, and will not let anything else wake ${it}. Open ${it} on the phone, under Settings › Apps.`);
  }
  if (bySystem.length) {
    const { one, who, it } = say(bySystem);
    out.push(`${who} ${one ? 'was' : 'were'} switched off by the phone itself, not by you. `
      + `Only the phone's own Settings can switch ${it} back on.`);
  }
  return [{ warn: out.join(' ') }];
}

function appRow(a) {
  const row = el('div', 'prow');
  const cb = el('input');
  cb.type = 'checkbox'; cb.checked = selectedApps.has(a.pkg);
  cb.addEventListener('change', () => { cb.checked ? selectedApps.add(a.pkg) : selectedApps.delete(a.pkg); syncAppsActions(); });
  row.appendChild(cb);
  const body = el('div', 'body');
  const nameLine = el('div');
  nameLine.append(el('span', 'name', appLabel(a.pkg, a.known)));
  nameLine.append(el('span', `chip ${a.user ? 'origin-user' : 'origin-preload'}`, a.user ? 'user' : 'system'));
  const src = installerChip(a.installer, a.user);
  if (src) nameLine.append(src);
  const off = offState(a);
  if (off) {
    const c = el('span', `chip ${shellCanSwitch(a) ? 'caution' : 'optional'}`, off.chip);
    c.title = off.why;
    nameLine.append(c);
  }
  if (a.battery === 'restricted') nameLine.append(el('span', 'chip caution', 'battery: restricted'));
  else if (a.battery === 'unrestricted') nameLine.append(el('span', 'chip state-enabled', 'battery: unrestricted'));
  body.append(nameLine, el('div', 'pkg', a.pkg + (a.installer ? `  ·  via ${a.installer}` : '')));
  row.appendChild(body);
  const search = el('button', 'small', 'Search web');
  search.addEventListener('click', () => window.sentinel.searchWeb(`${a.pkg} android what is it`));
  row.appendChild(search);
  const verify = el('button', 'small', 'Verify');
  verify.title = 'Copy this app\'s APK to the computer and compute its SHA-256 locally';
  verify.addEventListener('click', () => openVerify(a.pkg));
  row.append(verify, originButton(a.pkg));
  // A row that says "disabled" carries the way out of it. Without this the only
  // routes back were History and the advisor, neither of them the screen the app
  // was disabled from.
  if (canEnable(a)) {
    const en = el('button', 'small', 'Enable');
    en.title = 'Switch this app back on with Android\'s pm enable';
    en.addEventListener('click', async () => {
      en.disabled = true;
      const res = await window.sentinel.enablePackage(a.pkg);
      if (res && res.cancelled) { en.disabled = false; return; }
      // pm can answer without failing the adb call, so the reply is checked
      // rather than assumed: reporting a change that did not happen is worse
      // than reporting nothing.
      if (!res || !res.ok) {
        $('apps-status').textContent = `${appLabel(a.pkg, a.known)} could not be switched on — ${androidWhy(res)}`;
        en.disabled = false;
        return;
      }
      await loadApps();
      $('apps-status').textContent = `${appLabel(a.pkg, a.known)} switched back on`;
    });
    row.append(en);
  }
  return row;
}

function visibleApps() {
  const q = $('apps-search').value.trim().toLowerCase();
  const ns = $('apps-ns').value;
  return appsList
    .filter(a => !q || a.pkg.toLowerCase().includes(q) || (a.known || '').toLowerCase().includes(q))
    .filter(a => !ns || nsOf(a.pkg) === ns)
    .filter(a => appsFilter === 'all' ? true : appsFilter === 'user' ? a.user : appsFilter === 'system' ? !a.user : a.disabled);
}

function renderApps() {
  const q = $('apps-search').value.trim().toLowerCase();
  const ns = $('apps-ns').value;
  const matched = appsList
    .filter(a => !q || a.pkg.toLowerCase().includes(q) || (a.known || '').toLowerCase().includes(q))
    .filter(a => !ns || nsOf(a.pkg) === ns);
  $('ac-all').textContent = String(matched.length);
  $('ac-user').textContent = String(matched.filter(a => a.user).length);
  $('ac-system').textContent = String(matched.filter(a => !a.user).length);
  $('ac-disabled').textContent = String(matched.filter(a => a.disabled).length);
  syncAppsActions();
  const rows = visibleApps();
  const box = $('apps-rows');
  box.innerHTML = '';
  if (!rows.length) { box.appendChild(el('div', 'tab-empty', 'No packages match.')); return; }
  for (const a of rows) box.appendChild(appRow(a));
}

async function loadApps() {
  if (!(await checkAdb())) return;
  selectedApps = new Set();
  busy('apps-status', 'Reading installed packages…');
  skeletonRows('apps-rows', 'apps-empty');
  const res = await window.sentinel.listApps();
  if (res.error) { $('apps-status').textContent = res.error; clearSkeleton('apps-rows', 'apps-empty'); return; }
  clearSkeleton('apps-rows');
  appsList = res.apps;
  batteryChangedCount = res.batteryChangedCount || 0;
  disabledCount = res.disabledCount || 0;
  $('apps-empty').classList.add('hidden');
  $('export-apps').classList.remove('hidden');
  $('apps-selall-wrap').classList.remove('hidden');
  fillNamespaceSelect($('apps-ns'), appsList.map(x => x.pkg));
  // With no states read, every app falls back to being treated as changeable —
  // correct as a fallback, but indistinguishable from everything being fine, and
  // it is the exact behaviour that offered buttons Android refuses. Say it out
  // loud instead of letting a failed read look like a healthy one.
  const known = appsList.filter(a => a.enabled !== undefined).length;
  $('apps-status').textContent = `${appsList.length} packages on ${res.device.model}`
    + (known ? '' : ' · could not read how apps are switched off on this phone, so Enable and Disable are offered for all of them');
  syncAppsActions();
  renderApps();
}
$('apps-refresh').addEventListener('click', loadApps);
$('apps-search').addEventListener('input', renderApps);
$('apps-ns').addEventListener('change', renderApps);
// Checking it takes everything the filters currently show; unchecking releases
// exactly those again, leaving any selection made under another filter alone.
$('apps-selall').addEventListener('change', (e) => {
  const vis = visibleApps();
  for (const a of vis) { if (e.target.checked) selectedApps.add(a.pkg); else selectedApps.delete(a.pkg); }
  syncAppsActions(); renderApps();
});
$('apps-clear-sel').addEventListener('click', () => {
  selectedApps = new Set();
  syncAppsActions(); renderApps();
});
$('apps-disable').addEventListener('click', async () => {
  const pkgs = appsList.filter(a => selectedApps.has(a.pkg) && canDisable(a)).map(a => a.pkg);
  if (!pkgs.length) return;
  const res = await window.sentinel.disablePackages(pkgs);
  if (res.error) { $('apps-status').textContent = res.error; return; }
  if (res.cancelled) return;
  await loadApps();
  // pm refuses inside its own output rather than by failing the call, so a
  // disable that did not happen has to say so instead of passing in silence.
  const failed = res.failed || [];
  $('apps-status').textContent = failed.length
    ? `${(res.done || []).length} disabled, ${failed.length} refused — ${androidWhy(failed[0])}`
    : `${(res.done || []).length} app(s) disabled`;
});
// Android's three background-usage states, the same ones its own battery screen
// offers. A selection can straddle two of them, so a state is only ticked when
// every app in the selection is already in it.
$('apps-battery-set').addEventListener('click', () => {
  if (!selectedApps.size) return;
  const states = new Set(appsList.filter(a => selectedApps.has(a.pkg)).map(a => a.battery));
  const now = states.size === 1 ? [...states][0] : null;
  const setTo = (mode) => async () => {
    const res = await window.sentinel.setBattery([...selectedApps], mode);
    if (res.error) { $('apps-status').textContent = res.error; return; }
    if (res.cancelled) return;
    loadApps();
  };
  openMenu($('apps-battery-set'), [
    {
      label: 'Restricted',
      note: 'No background work at all. Notifications, syncing and alarms may stop. Asks a second time for system apps.',
      tone: 'mi-caution',
      current: now === 'restricted',
      onPick: setTo('restricted'),
    },
    {
      label: 'Optimized',
      note: "Android's default: background work allowed, but the phone limits it.",
      current: now === 'optimized',
      onPick: setTo('optimized'),
    },
    {
      label: 'Unrestricted',
      note: 'Free to run in the background whenever it likes. Uses more battery.',
      current: now === 'unrestricted',
      onPick: setTo('unrestricted'),
    },
  ]);
});
$('apps-battery-revert').addEventListener('click', async () => {
  const res = await window.sentinel.revertBattery();
  if (res.cancelled || res.error) return;
  loadApps();
});
$('apps-enable').addEventListener('click', async () => {
  const pkgs = appsList.filter(a => selectedApps.has(a.pkg) && canEnable(a)).map(a => a.pkg);
  if (!pkgs.length) return;
  const res = await window.sentinel.enablePackages(pkgs);
  if (res.cancelled) return;
  if (res.error) { $('apps-status').textContent = res.error; return; }
  await loadApps();
  const failed = res.failed || [];
  $('apps-status').textContent = failed.length
    ? `${(res.done || []).length} switched back on, ${failed.length} refused — ${androidWhy(failed[0])}`
    : `${(res.done || []).length} app(s) switched back on`;
});
$('apps-enable-all').addEventListener('click', async () => {
  const res = await window.sentinel.revertAll();
  if (res.cancelled || res.error) { if (res.error) $('apps-status').textContent = res.error; return; }
  await loadApps();
  $('apps-status').textContent = `${(res.done || []).length} app(s) switched back on`;
});
for (const t of document.querySelectorAll('#view-apps .atab')) {
  t.addEventListener('click', () => {
    appsFilter = t.dataset.f;
    for (const b of document.querySelectorAll('#view-apps .atab')) b.classList.toggle('active', b === t);
    renderApps();
  });
}

// ---------- phone settings (the baseline, with controls to act on it) ----------
let settingsRows = [];
let selectedSettings = new Set();

function syncSettingsApply() {
  $('settings-apply').classList.toggle('hidden', selectedSettings.size === 0);
  $('settings-apply').textContent = `Apply ${selectedSettings.size} selected…`;
}

let settingsFilter = 'all';
let highlightSettingKey = null;
const CAT_LABELS = { privacy: 'Privacy', security: 'Security', leanness: 'Leanness & annoyances' };

function settingRow(s) {
  const row = el('div', 'prow');
  row.dataset.key = s.key;
  if (!s.matches) {
    const cb = el('input');
    cb.type = 'checkbox'; cb.checked = selectedSettings.has(s.key);
    cb.addEventListener('change', () => { cb.checked ? selectedSettings.add(s.key) : selectedSettings.delete(s.key); syncSettingsApply(); });
    row.appendChild(cb);
  } else row.appendChild(el('span', 'donemark', '✓'));
  const body = el('div', 'body');
  const nameLine = el('div');
  nameLine.append(el('span', 'name', s.desc), el('span', `chip ${s.matches ? 'recommended' : 'caution'}`, s.matches ? 'matches baseline' : 'differs'));
  if (s.warn) nameLine.append(el('span', 'chip keep', 'trade-off'));
  if (s.changedByApp) nameLine.append(el('span', 'chip state-enabled', 'set by this app'));
  body.append(nameLine, el('div', 'pkg', `${s.ns} ${s.key} = ${s.cur}${s.matches ? '' : `  →  recommended ${s.want}`}`));
  if (s.warn) body.append(el('div', 'desc', `Trade-off: ${s.warn}.`));
  row.appendChild(body);
  const search = el('button', 'small', 'Search web');
  search.addEventListener('click', () => window.sentinel.searchWeb(`android setting ${s.key} what does it do`));
  row.appendChild(search);
  return row;
}

function renderSettings() {
  const box = $('settings-rows');
  box.innerHTML = '';
  for (const b of document.querySelectorAll('#view-settings .atab')) b.classList.toggle('active', b.dataset.c === settingsFilter);
  $('sc-all').textContent = String(settingsRows.length);
  for (const c of ['privacy', 'security', 'leanness']) $(`sc-${c}`).textContent = String(settingsRows.filter(s => s.cat === c).length);
  const cats = settingsFilter === 'all' ? ['privacy', 'security', 'leanness'] : [settingsFilter];
  for (const c of cats) {
    const items = [...settingsRows.filter(s => s.cat === c)].sort((a, b) => (a.matches ? 1 : 0) - (b.matches ? 1 : 0));
    if (!items.length) continue;
    const diff = items.filter(i => !i.matches).length;
    const h = el('div', 'tier-head', CAT_LABELS[c] + ' ');
    h.appendChild(el('span', 'count', String(items.length)));
    h.appendChild(el('span', diff ? 'pending' : 'done', diff ? `· ${diff} differ` : '· all match ✓'));
    box.appendChild(h);
    for (const s of items) box.appendChild(settingRow(s));
  }
}
for (const t of document.querySelectorAll('#view-settings .atab')) {
  t.addEventListener('click', () => {
    settingsFilter = t.dataset.c;
    for (const b of document.querySelectorAll('#view-settings .atab')) b.classList.toggle('active', b === t);
    renderSettings();
  });
}
$('settings-select-diff').addEventListener('click', () => {
  for (const s of settingsRows) if (!s.matches && !s.warn) selectedSettings.add(s.key);
  syncSettingsApply();
  renderSettings();
});

async function loadSettings() {
  if (!(await checkAdb())) return;
  selectedSettings = new Set();
  syncSettingsApply();
  busy('settings-status', 'Reading settings from the phone…');
  skeletonRows('settings-rows', 'settings-empty');
  const res = await window.sentinel.listSettings();
  if (res.error) { $('settings-status').textContent = res.error; clearSkeleton('settings-rows', 'settings-empty'); return; }
  clearSkeleton('settings-rows');
  $('settings-empty').classList.add('hidden');
  $('export-settings').classList.remove('hidden');
  settingsRows = res.rows;
  const diff = res.rows.filter(r => !r.matches).length;
  $('settings-status').textContent = diff
    ? `${res.rows.length} audited settings · ${diff} differ from the baseline`
    : `${res.rows.length} audited settings · all match the baseline ✓`;
  $('settings-revert').classList.toggle('hidden', !res.changedCount);
  $('settings-revert').textContent = `Undo all app changes (${res.changedCount})`;
  $('settings-select-diff').classList.toggle('hidden', !res.rows.some(r => !r.matches && !r.warn));
  renderSettings();
  if (highlightSettingKey) {
    const row = $('settings-rows').querySelector(`[data-key="${highlightSettingKey}"]`);
    highlightSettingKey = null;
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 5000);
    }
  }
}
$('settings-refresh').addEventListener('click', loadSettings);
$('settings-apply').addEventListener('click', async () => {
  const res = await window.sentinel.applySettings([...selectedSettings]);
  if (res.cancelled || res.error) return;
  selectedSettings = new Set();
  loadSettings();
});
$('settings-revert').addEventListener('click', async () => {
  const res = await window.sentinel.revertSettings();
  if (res.cancelled || res.error) return;
  loadSettings();
});

// ---------- history ----------
async function loadHistory() {
  const res = await window.sentinel.listHistory();
  setDeviceTag('history-device', res.storeDevice, !!(res.storeDevice && res.connectedSerial === res.storeDevice.serial));
  const runs = $('hist-runs'); runs.innerHTML = '';
  if (!res.history.length) runs.appendChild(el('div', 'hist-empty', 'No runs yet — run the health checks first.'));
  for (const r of res.history) {
    const row = el('div', 'runrow');
    row.append(el('span', 'when', new Date(r.ts).toLocaleString()));
    const mini = el('span', 'mini');
    mini.append(el('span', 'f', `${r.counts.flag} ⚑`), el('span', 'n', `${r.counts.note} ◐`), el('span', 'o', `${r.counts.ok} ✓`));
    if (r.counts.skip) mini.append(el('span', null, `${r.counts.skip} ⊘`));
    row.appendChild(mini);
    const view = el('button', 'small', 'Details');
    let open = null;
    view.addEventListener('click', () => {
      if (open) { open.remove(); open = null; view.textContent = 'Details'; return; }
      open = el('div', 'rundetail');
      for (const c of r.results) {
        const line = el('div', null, `${c.status === 'flag' ? '⚑' : c.status === 'note' ? '◐' : c.status === 'skip' ? '⊘' : '✓'}  ${c.title} — ${(c.lines[0] || '')}`);
        line.style.cssText = `font-size:12px;padding:2px 0;color:var(${c.status === 'flag' ? '--flag' : c.status === 'note' ? '--note' : '--muted'})`;
        open.appendChild(line);
      }
      row.after(open);
      view.textContent = 'Hide';
    });
    row.appendChild(view);
    runs.appendChild(row);
  }
  const acts = $('hist-actions'); acts.innerHTML = '';
  if (!res.actions.length) acts.appendChild(el('div', 'hist-empty', 'No changes made yet — every change this app makes, and every terminal command that was not read-only, is recorded here.'));
  for (const a of res.actions.slice(0, 80)) {
    const row = el('div', 'actrow');
    row.append(
      el('span', 'when', new Date(a.ts).toLocaleString()),
      el('span', `badge ${a.action}`, a.action + (a.ok ? '' : ' ✗')),
      Object.assign(el('span', 'pkg', a.pkg), { title: a.pkg }),
    );
    if (a.action === 'disable' && a.ok && (res.disabledByApp || []).includes(a.pkg)) {
      const undo = el('button', 'small', 'Re-enable');
      undo.addEventListener('click', async () => { undo.disabled = true; await window.sentinel.enablePackage(a.pkg); loadHistory(); });
      row.appendChild(undo);
    }
    acts.appendChild(row);
  }
  // The list is capped at the 80 most recent. With the count now on the tab, a
  // silent cap would have the badge promising rows that are not there.
  if (res.actions.length > 80) {
    acts.appendChild(el('div', 'hist-empty',
      `Showing the 80 most recent of ${res.actions.length} changes. Export for the full record.`));
  }
  $('hc-runs').textContent = String(res.history.length);
  $('hc-actions').textContent = String(res.actions.length);
  populateDiff(res);
}

// The two lists grow at completely different rates — a handful of runs against
// every change ever made — so they take turns rather than sitting side by side
// where the taller one decides how far the page scrolls.
const HIST_TIP = {
  runs: 'Every health-check run recorded for this phone, newest first, with what each one found. '
      + 'Open Details for the checks behind a run, and use the comparison above to see what changed between any two.',
  actions: 'Every change this app made, newest first — all reversible. Package disables can be re-enabled '
      + 'right here; settings and battery states are restored with the Undo buttons on their own tabs.',
};
function showHistTab(which) {
  for (const b of document.querySelectorAll('#hist-tabs .atab')) b.classList.toggle('active', b.dataset.hist === which);
  $('hist-runs').classList.toggle('hidden', which !== 'runs');
  $('hist-actions').classList.toggle('hidden', which !== 'actions');
  $('hist-tip').dataset.tip = HIST_TIP[which];
}
for (const b of document.querySelectorAll('#hist-tabs .atab')) {
  b.addEventListener('click', () => showHistTab(b.dataset.hist));
}
showHistTab('runs');
$('history-refresh').addEventListener('click', loadHistory);

// ---------- my device ----------
const DEV_SECTIONS = [['Identity', 'identity'], ['Software', 'software'], ['Hardware', 'hardware'], ['Apps', 'apps'], ['Power & storage', 'power']];
let deviceDetailsCache = null;

// Fields worth researching get a hover "search online" link with a tailored query.
const DEV_SEARCHABLE = {
  'Model': (v, d) => `${d.identity['Manufacturer'] || ''} ${v} specifications`.trim(),
  'Marketing name': (v) => `${v} specifications`,
  'Codename': (v, d) => `${d.identity['Manufacturer'] || 'android'} codename ${v}`,
  'Android': (v) => `android ${v.split(' ')[0]} what's new`,
  'One UI': (v) => `One UI ${v} features`,
  'Security patch': (v) => `android security bulletin ${v}`,
  'Build': (v) => `${v} firmware`,
  'Baseband': (v) => `${v.split(',')[0]} baseband firmware`,
  'Bootloader': (v) => `${v} bootloader firmware`,
  'Kernel': (v) => `android kernel ${v.slice(0, 40)}`,
  'Chipset': (v) => `${v} chipset specs`,
  'Sales code (CSC)': (v) => `samsung CSC ${v} region`,
};

function kvLine(k, v, d) {
  const line = el('div');
  line.append(el('b', null, k + '  '), document.createTextNode(v));
  const q = DEV_SEARCHABLE[k];
  if (q) {
    const a = el('a', 'kv-search', 'search online');
    a.href = '#';
    a.addEventListener('click', (ev) => { ev.preventDefault(); window.sentinel.searchWeb(q(v, d)); });
    line.append(' ', a);
  }
  return line;
}

async function loadDevice() {
  if (!(await checkAdb())) return;
  const grid = $('device-grid');
  let d;
  try { d = await window.sentinel.deviceDetails(); }
  catch { d = { state: 'error' }; }
  if (!d || d.state !== 'device') {
    $('device-empty').classList.remove('hidden');
    grid.classList.add('hidden');
    $('export-device').classList.add('hidden');
    $('device-empty-title').textContent = d && d.state === 'error' ? 'Could not read device details.' : 'No device connected.';
    $('device-empty-sub').textContent =
      d && d.state === 'unauthorized' ? 'Device found but unauthorized — accept the USB debugging prompt on the phone.'
      : d && d.state === 'error' ? 'If the app was just updated, quit it fully and start it again (a window reload does not restart the app itself).'
      : 'Enable USB debugging and plug in your phone.';
    return;
  }
  deviceDetailsCache = d;
  $('device-empty').classList.add('hidden');
  $('export-device').classList.remove('hidden');
  grid.classList.remove('hidden');
  grid.innerHTML = '';

  // hero: who this phone is
  const hero = el('div', 'panel dev-hero');
  const glyph = el('div', 'dev-glyph');
  glyph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2.5"/><line x1="10.5" y1="18.5" x2="13.5" y2="18.5"/></svg>';
  const idBox = el('div', 'dev-id');
  const name = d.identity['Marketing name'] || d.identity['Model'] || 'Android device';
  const subBits = [
    d.identity['Manufacturer'],
    d.identity['Model'] && d.identity['Model'] !== name ? d.identity['Model'] : null,
    d.identity['Codename'] ? `codename ${d.identity['Codename']}` : null,
    d.identity['Serial'] ? `s/n ${d.identity['Serial']}` : null,
  ].filter(Boolean);
  idBox.append(el('div', 'dev-name', name), el('div', 'dev-sub', subBits.join(' · ')));
  const chips = el('div', 'chips-row');
  const androidV = (d.software['Android'] || '').split(' ')[0];
  for (const c of [
    androidV ? `Android ${androidV}` : null,
    d.software['One UI'] ? `One UI ${d.software['One UI']}` : null,
    d.software['Security patch'] ? `patch ${d.software['Security patch']}` : null,
  ].filter(Boolean)) chips.appendChild(el('span', 'pill', c));
  idBox.appendChild(chips);
  hero.append(glyph, idBox);
  grid.appendChild(hero);

  // stat tiles: the app counts at a glance
  const stats = el('div', 'dev-stats');
  for (const [label, key] of [
    ['installed packages', 'Installed packages (total)'],
    ['user-installed', 'User-installed (third-party)'],
    ['system / preloaded', 'System / preloaded'],
    ['disabled', 'Disabled'],
  ]) {
    const t = el('div', 'panel stat');
    t.append(el('div', 'stat-num', d.apps[key] || '—'), el('div', 'stat-label', label));
    stats.appendChild(t);
  }
  grid.appendChild(stats);

  // detail panels, with usage bars for battery & storage
  const panels = el('div', 'dev-panels');
  for (const [title, key] of [['Software', 'software'], ['Hardware', 'hardware'], ['Power & storage', 'power']]) {
    const panel = el('div', 'panel');
    panel.appendChild(el('h3', null, title));
    const kv = el('div', 'kv');
    for (const [k, v] of Object.entries(d[key] || {})) {
      if (!v) continue;
      kv.appendChild(kvLine(k, v, d));
      const pct = k === 'Battery' ? parseInt(v) : k === 'Data storage' ? +(v.match(/\((\d+)% full\)/) || [])[1] : NaN;
      if (!isNaN(pct)) {
        const bar = el('div', 'bar');
        const fill = el('i');
        fill.style.width = `${Math.min(100, pct)}%`;
        fill.style.background = k === 'Battery' ? (pct <= 20 ? 'var(--flag)' : 'var(--ok)') : (pct >= 85 ? 'var(--note)' : 'var(--accent)');
        bar.appendChild(fill);
        kv.appendChild(bar);
      }
    }
    panel.appendChild(kv);
    panels.appendChild(panel);
  }
  grid.appendChild(panels);
}
$('device-refresh').addEventListener('click', loadDevice);

// ---------- console (live adb command log) ----------
const clog = [];
const isPoll = (cmd) => cmd === 'adb get-state' || cmd === 'adb get-serialno' || cmd === 'adb shell getprop';
const fmtBytes = (b) => b >= 1024 ? `${(b / 1024).toFixed(1)}KB` : `${b}B`;

function clineFor(e) {
  const row = el('div', `cline${e.ok ? '' : ' fail'}`);
  row.append(
    el('span', 'ct', new Date(e.ts).toLocaleTimeString()),
    el('span', 'cc', `$ ${e.cmd}`),
    el('span', 'cr', e.ok ? `${e.ms}ms · ${fmtBytes(e.outBytes)}` : `FAILED ${e.ms}ms${e.err ? ' · ' + e.err : ''}`),
  );
  return row;
}
function renderConsole() {
  const box = $('console');
  box.innerHTML = '';
  const showPolls = $('console-polls').checked;
  for (const e of clog) if (showPolls || !isPoll(e.cmd)) box.appendChild(clineFor(e));
  if (!box.children.length) box.appendChild(el('div', 'cline muted', 'No commands yet — plug in a device or run the health checks.'));
  box.scrollTop = box.scrollHeight;
}
function onAdbLogEntry(e) {
  clog.push(e);
  if (clog.length > 500) clog.shift();
  if (!$('console-polls').checked && isPoll(e.cmd)) return;
  const box = $('console');
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.appendChild(clineFor(e));
  while (box.children.length > 500) box.firstChild.remove();
  if (stick) box.scrollTop = box.scrollHeight;
}
window.sentinel.recentLog().then((r) => { for (const e of r.entries || []) clog.push(e); renderConsole(); }).catch(() => {});
window.sentinel.onAdbLog(onAdbLogEntry);
$('console-polls').addEventListener('change', renderConsole);
$('log-open-file').addEventListener('click', () => window.sentinel.openLogFile());
$('log-open-folder').addEventListener('click', () => window.sentinel.openLogFolder());

// ---------- terminal (command library + free-typed adb commands) ----------
// The library on the left is read-only by construction, so its entries run on a
// click. Anything typed in the prompt is classified by the main process before
// it runs; the chip in the header says, live, what the current line would do.
const PLACEHOLDER_RE = /\{[a-z_]+\}/i;
const TIER_CHIP = {
  read: ['read', 'read-only'],
  write: ['write', 'asks before running'],
  destructive: ['destructive', '⚠ asks twice'],
};
let termCats = null, termSerial, termBusy = false, termBlocks = [];
let termHist = [];
try { termHist = JSON.parse(localStorage.getItem('termHistory') || '[]').slice(-100); } catch {}
let termHistIdx = termHist.length;

function termHint() {
  const box = $('term-out');
  box.innerHTML = '';
  const b = el('div', 'tblock');
  const l1 = el('div', 'term-hint');
  l1.append(document.createTextNode('Pick a command on the left, or type your own. Commands run on the phone through '), el('b', null, 'adb shell'), document.createTextNode(' — write "adb …" yourself for commands that run on this computer, like '), el('b', null, 'adb devices'), document.createTextNode('.'));
  const l2 = el('div', 'term-hint');
  l2.append(document.createTextNode('Read-only commands run straight away. Anything that could change the phone asks first, and destructive commands ask twice. '), el('b', null, '↑'), document.createTextNode(' and '), el('b', null, '↓'), document.createTextNode(' walk through what you ran before.'));
  b.append(l1, l2);
  box.appendChild(b);
}

async function loadTerminal() {
  $('term-input').focus();
  if (termCats && termSerial === currentSerial) return;
  const r = await window.sentinel.termLibrary();
  termCats = r.categories || [];
  termSerial = currentSerial;
  renderTermLib();
}

function renderTermLib() {
  const q = $('term-search').value.trim().toLowerCase();
  const box = $('term-cats');
  box.innerHTML = '';
  let shown = 0;
  for (const cat of termCats || []) {
    const items = cat.items.filter(it => !q
      || it.label.toLowerCase().includes(q) || it.cmd.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q));
    if (!items.length) continue;
    shown += items.length;
    const wrap = el('div', 'term-cat');
    const h = el('div', 'term-cat-h');
    h.append(document.createTextNode(cat.title));
    const tip = el('button', 'info-tip', 'i');
    tip.type = 'button';
    tip.setAttribute('aria-label', `About ${cat.title}`);
    tip.dataset.tip = cat.hint;
    h.appendChild(tip);
    wrap.appendChild(h);
    for (const it of items) {
      const b = el('button', 'term-item');
      b.type = 'button';
      b.title = `${it.desc}\n\n${it.cmd}`;
      b.appendChild(el('span', 'ti-label', it.label));
      const c = el('span', 'ti-cmd');
      // The fill-in-the-blank part of a command is highlighted, not hidden.
      const m = it.cmd.match(PLACEHOLDER_RE);
      if (m) {
        const i = it.cmd.indexOf(m[0]);
        c.append(document.createTextNode(it.cmd.slice(0, i)), el('span', 'ti-arg', m[0]), document.createTextNode(it.cmd.slice(i + m[0].length)));
      } else c.textContent = it.cmd;
      b.appendChild(c);
      b.addEventListener('click', () => pickTermCmd(it));
      wrap.appendChild(b);
    }
    box.appendChild(wrap);
  }
  if (!shown) box.appendChild(el('div', 'term-lib-empty', termCats && termCats.length ? 'No command matches that search.' : 'Command library unavailable.'));
}

// A command with a blank in it is handed to the prompt with the blank selected,
// so nothing runs until the user has filled it in and looked at the line.
function pickTermCmd(it) {
  const input = $('term-input');
  input.value = it.cmd;
  input.focus();
  const m = it.cmd.match(PLACEHOLDER_RE);
  if (m) {
    const i = it.cmd.indexOf(m[0]);
    input.setSelectionRange(i, i + m[0].length);
    setTermTier({ hintArg: it.arg || 'value' });
    return;
  }
  setTermTier({ tier: 'read' });
  runTerminal(it.cmd);
}

function setTermTier(state) {
  const chip = $('term-tier');
  if (!state) { chip.classList.add('hidden'); return; }
  if (state.hintArg) {
    chip.className = 'tier-chip write';
    chip.textContent = `fill in the ${state.hintArg}`;
    return;
  }
  const [cls, label] = TIER_CHIP[state.tier] || TIER_CHIP.write;
  chip.className = `tier-chip ${cls}`;
  chip.textContent = label;
}

let tierTimer = null;
$('term-input').addEventListener('input', () => {
  clearTimeout(tierTimer);
  const v = $('term-input').value.trim();
  if (!v) { setTermTier(null); return; }
  if (PLACEHOLDER_RE.test(v)) { setTermTier({ hintArg: v.match(PLACEHOLDER_RE)[0].replace(/[{}]/g, '') }); return; }
  tierTimer = setTimeout(async () => {
    const r = await window.sentinel.termClassify(v);
    if ($('term-input').value.trim() === v) setTermTier(r);
  }, 180);
});

$('term-input').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  if (!termHist.length) return;
  e.preventDefault();
  termHistIdx += e.key === 'ArrowUp' ? -1 : 1;
  termHistIdx = Math.max(0, Math.min(termHist.length, termHistIdx));
  $('term-input').value = termHist[termHistIdx] || '';
  $('term-input').dispatchEvent(new Event('input'));
});

$('term-form').addEventListener('submit', (e) => {
  e.preventDefault();
  runTerminal($('term-input').value.trim());
});
$('term-search').addEventListener('input', renderTermLib);
$('term-clear').addEventListener('click', () => { termBlocks = []; termHint(); $('term-input').focus(); });

function termBlock(r) {
  const box = $('term-out');
  const b = el('div', `tblock${r.ok ? '' : ' fail'}`);
  const head = el('div', 'thead');
  head.append(el('span', 'tcmd', `$ ${r.display}`), el('span', 'tms', r.ms != null ? `${r.ms}ms` : ''));
  b.appendChild(head);
  const body = (r.stdout || '').replace(/\s+$/, '');
  const errText = (r.stderr || r.err || '').trim();
  const out = el('pre', 'tout');
  if (body) out.textContent = body;
  else if (errText) out.textContent = errText;
  else { out.classList.add('empty-out'); out.textContent = r.ok ? '(no output — the command returned nothing)' : '(no output)'; }
  if (body && errText) out.textContent += `\n${errText}`;
  b.appendChild(out);
  if (r.truncated) b.appendChild(el('div', 'tnote', 'Output was longer than 400,000 characters and is shown cut off. Narrow it with a filter, for example by adding "| head -100".'));
  if (r.tier && r.tier !== 'read') b.appendChild(el('div', 'tnote', 'This command was not read-only. It is recorded in History under "changes made", but this app cannot undo it.'));
  const acts = el('div', 'tacts');
  const copy = el('button', null, 'Copy output');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(out.textContent); copy.textContent = 'Copied ✓'; }
    catch { copy.textContent = 'Select the text and copy manually'; }
    setTimeout(() => { copy.textContent = 'Copy output'; }, 2000);
  });
  const again = el('button', null, 'Run again');
  again.type = 'button';
  again.addEventListener('click', () => runTerminal(r.input));
  acts.append(copy, again);
  b.appendChild(acts);
  box.appendChild(b);
  box.scrollTop = box.scrollHeight;
}

function termNote(text) {
  const box = $('term-out');
  const b = el('div', 'tblock');
  b.appendChild(el('div', 'term-hint', text));
  box.appendChild(b);
  box.scrollTop = box.scrollHeight;
}

async function runTerminal(cmd) {
  if (termBusy || !cmd) return;
  if (PLACEHOLDER_RE.test(cmd)) {
    termNote(`Replace ${cmd.match(PLACEHOLDER_RE)[0]} in the command with a real value before running it.`);
    return;
  }
  termBusy = true;
  $('term-run').disabled = true;
  $('term-input').disabled = true;
  if (termHist[termHist.length - 1] !== cmd) termHist.push(cmd);
  termHist = termHist.slice(-100);
  termHistIdx = termHist.length;
  try { localStorage.setItem('termHistory', JSON.stringify(termHist)); } catch {}
  const box = $('term-out');
  if (!termBlocks.length) box.innerHTML = '';
  const pending = el('div', 'tblock');
  const head = el('div', 'thead');
  head.append(el('span', 'tcmd', `$ ${cmd}`));
  const wait = el('span', 'tms');
  wait.append(el('span', 'spinner'), document.createTextNode(' running'));
  head.appendChild(wait);
  pending.appendChild(head);
  box.appendChild(pending);
  box.scrollTop = box.scrollHeight;

  let res;
  try { res = await window.sentinel.termRun(cmd); }
  catch (e) { res = { error: String(e) }; }
  pending.remove();

  if (res && res.cancelled) { termNote(`Cancelled — "${cmd}" was not run.`); }
  else if (res && res.error) { termBlock({ display: cmd, ok: false, stderr: res.error, input: cmd }); termBlocks.push({ display: cmd, ok: false, stdout: '', stderr: res.error }); }
  else { const b = { ...res, input: cmd }; termBlock(b); termBlocks.push(b); }
  if (termBlocks.length > 200) termBlocks = termBlocks.slice(-200);

  termBusy = false;
  $('term-run').disabled = false;
  $('term-input').disabled = false;
  // Like any terminal: the prompt empties after a run. The line is one press of
  // the up arrow away if it needs editing and running again.
  if ($('term-input').value.trim() === cmd) { $('term-input').value = ''; setTermTier(null); }
  $('term-input').focus();
}

function terminalMd() {
  const L = ['# Phone Checker — terminal session', '', `- Exported: ${new Date().toLocaleString()}`,
    `- ${termBlocks.length} command(s) in this session`, ''];
  for (const b of termBlocks) {
    L.push(`## ${b.display}`, '', `- ${b.ok ? 'ok' : 'FAILED'}${b.ms != null ? ` · ${b.ms}ms` : ''}${b.tier && b.tier !== 'read' ? ` · ${b.tier} — confirmed before running` : ''}`, '', '```');
    L.push((b.stdout || '').replace(/\s+$/, '') || (b.stderr || '(no output)'));
    L.push('```', '');
  }
  return L.join('\n');
}
$('term-export').addEventListener('click', () => {
  if (!termBlocks.length) { termNote('Nothing to export yet — run a command first.'); return; }
  exportIt('phone-checker-terminal', terminalMd());
});
termHint();

// ---------- exports (markdown / plain text via a native save dialog) ----------
const mdToTxt = (md) => md.replace(/^### /gm, '').replace(/^## /gm, '').replace(/^# /gm, '').replace(/`/g, '');
const exportIt = (name, md) => window.sentinel.exportSave({ name, md, txt: mdToTxt(md) });
const STATUS_LABEL = { flag: 'FLAGGED', note: 'REVIEW', info: 'INFO', ok: 'OK', skip: 'SKIPPED' };

function checksMd() {
  const L = ['# Phone Checker — health check results', ''];
  if (lastRunTs) L.push(`- Run: ${new Date(lastRunTs).toLocaleString()}`);
  if (lastDevice) L.push(`- Device: ${lastDevice.manufacturer} ${lastDevice.model} (Android ${lastDevice.android}, security patch ${lastDevice.patch})`);
  else if (lastDeviceLabel) L.push(`- Device: ${lastDeviceLabel}`);
  L.push(`- Exported: ${new Date().toLocaleString()}`, '');
  for (const r of lastResults) {
    L.push(`## ${r.title} — ${STATUS_LABEL[r.status] || r.status}${r.scope ? ` (${r.scope})` : ''}`, '');
    for (const line of r.lines) L.push(`- ${line}`);
    L.push('');
  }
  return L.join('\n');
}
function advisorMd() {
  const L = ['# Phone Checker — debloat advisor', '', `- Exported: ${new Date().toLocaleString()}`, `- ${allProposals.length} known packages present on this device`, ''];
  for (const tier of ['recommended', 'optional', 'caution', 'keep']) {
    const items = allProposals.filter(p => p.tier === tier);
    if (!items.length) continue;
    L.push(`## ${TIER_LABELS[tier]}`, '');
    for (const p of items) L.push(`- ${p.name} (\`${p.pkg}\`) — ${p.state} — ${p.desc}`);
    L.push('');
  }
  return L.join('\n');
}
function historyMd(h) {
  const L = ['# Phone Checker — history', '', `- Exported: ${new Date().toLocaleString()}`, '', '## Check runs', ''];
  if (!h.history.length) L.push('No runs recorded.', '');
  for (const r of h.history) {
    L.push(`### ${new Date(r.ts).toLocaleString()} — ${r.counts.flag} flagged · ${r.counts.note} to review · ${r.counts.ok} clear${r.counts.skip ? ` · ${r.counts.skip} unreadable` : ''}`, '');
    for (const c of r.results) L.push(`- ${c.status === 'flag' ? '⚑' : c.status === 'note' ? '◐' : c.status === 'skip' ? '⊘' : '✓'} ${c.title} — ${c.lines[0] || ''}`);
    L.push('');
  }
  L.push('## Changes made', '');
  if (!h.actions.length) L.push('No changes recorded.');
  for (const a of h.actions) L.push(`- ${new Date(a.ts).toLocaleString()} — ${a.action.toUpperCase()}${a.ok ? '' : ' (FAILED)'} — ${a.pkg}`);
  return L.join('\n');
}
function deviceMd() {
  const L = ['# Phone Checker — device info', '', `- Exported: ${new Date().toLocaleString()}`, ''];
  for (const [title, key] of DEV_SECTIONS) {
    L.push(`## ${title}`, '');
    for (const [k, v] of Object.entries(deviceDetailsCache[key] || {})) if (v) L.push(`- ${k}: ${v}`);
    L.push('');
  }
  return L.join('\n');
}
function consoleMd() {
  const L = ['# Phone Checker — adb command log (this session)', '',
    `- Exported: ${new Date().toLocaleString()}`,
    `- Last ${clog.length} command(s) of this session; the complete daily files live in the app's logs folder`, ''];
  for (const e of clog) L.push(`- ${e.ts} — \`${e.cmd}\` — ${e.ok ? 'ok' : 'FAILED'} · ${e.ms}ms · ${e.outBytes}B${e.err ? ' · ' + e.err : ''}`);
  return L.join('\n');
}
function appsMd() {
  const L = ['# Phone Checker — installed apps', '', `- Exported: ${new Date().toLocaleString()}`, `- ${appsList.length} packages`, ''];
  for (const a of appsList) L.push(`- ${a.pkg} — ${a.user ? 'user' : 'system'}${a.disabled ? ' · disabled' : ''}${a.battery && a.battery !== 'optimized' ? ` · battery ${a.battery}` : ''}${a.installer ? ` · via ${a.installer}` : ''}${a.known ? ` · ${a.known}` : ''}`);
  return L.join('\n');
}
function settingsMd() {
  const L = ['# Phone Checker — phone settings audit', '', `- Exported: ${new Date().toLocaleString()}`, ''];
  for (const s of settingsRows) L.push(`- [${s.cat}] ${s.matches ? '✓' : '✗'} ${s.ns} ${s.key} = ${s.cur} — recommended ${s.want} (${s.desc})${s.warn ? ` [trade-off: ${s.warn}]` : ''}${s.changedByApp ? ' [set by this app]' : ''}`);
  return L.join('\n');
}
$('export-apps').addEventListener('click', () => { if (appsList.length) exportIt('phone-checker-apps', appsMd()); });
$('export-settings').addEventListener('click', () => { if (settingsRows.length) exportIt('phone-checker-settings', settingsMd()); });
$('export-console').addEventListener('click', () => { if (clog.length) exportIt('phone-checker-adb-log', consoleMd()); });
$('export-checks').addEventListener('click', () => { if (lastResults) exportIt('phone-checker-results', checksMd()); });
$('export-advisor').addEventListener('click', () => { if (allProposals.length) exportIt('phone-checker-debloat', advisorMd()); });
$('export-history').addEventListener('click', async () => { exportIt('phone-checker-history', historyMd(await window.sentinel.listHistory())); });
$('export-device').addEventListener('click', () => { if (deviceDetailsCache) exportIt('phone-checker-device', deviceMd()); });

// ---------- permission audit ----------
let permsData = null;
let permsTab = null;
let selectedPerms = new Set();     // "pkg" keys within the tab on screen
let permsChangedCount = 0;

const permGroupOnScreen = () => permsAllTabs().find(t => t.id === permsTab) || null;
function syncPermsActions() {
  const g = permGroupOnScreen();
  const vis = g ? permList(permsTab, permsView) : [];
  const chosen = vis.filter(h => selectedPerms.has(h.pkg)).length;
  const n = selectedPerms.size;
  const box = $('perms-selall');
  box.checked = vis.length > 0 && chosen === vis.length;
  box.indeterminate = chosen > 0 && chosen < vis.length;
  $('perms-selall-label').textContent = n ? `${n} selected` : `select all listed (${vis.length})`;
  $('perms-selall-wrap').classList.toggle('hidden', !permsData);
  $('perms-clear-sel').classList.toggle('hidden', n === 0);
  const label = g ? g.label.toLowerCase() : 'this permission';
  // All three states live in the button's menu, so the header keeps one control
  // whichever list is on screen.
  $('perms-set').classList.toggle('hidden', n === 0);
  if (n) setMenuLabel('perms-set', `Set ${label} for ${n}`);
  $('perms-warning').classList.toggle('hidden', n === 0);
  $('perms-revert').classList.toggle('hidden', !permsChangedCount);
  $('perms-revert').textContent = `Undo permission changes (${permsChangedCount})`;
}
async function applyPerms(mode) {
  const g = permGroupOnScreen();
  if (!g || !selectedPerms.size) return;
  const items = permList(permsTab, permsView).filter(h => selectedPerms.has(h.pkg)).map(h => ({ pkg: h.pkg, perms: h.held || [] }));
  const res = await window.sentinel.permsApply(g.id, mode, items);
  if (res.cancelled) return;
  if (res.error) { $('perms-status').textContent = res.error; return; }
  selectedPerms = new Set();
  const failed = (res.failed || []).length;
  const note = failed
    ? `${(res.done || []).length} changed, ${failed} refused by Android (${(res.failed[0] || {}).error || 'not a changeable permission'})`
    : `${(res.done || []).length} permission change(s) applied`;
  await loadPerms();
  $('perms-status').textContent = note;
}

function permsAllTabs() {
  return permsData ? [...permsData.groups, ...permsData.special] : [];
}
// Which of the three states the list is showing. Only "allowed" can be acted
// on: the other two hold nothing, so there is nothing to take away.
let permsView = 'allowed';
const PERM_VIEWS = [
  { id: 'allowed', label: 'Have it', key: 'holders' },
  { id: 'ask', label: 'Ask first', key: 'asks' },
  { id: 'denied', label: 'Refused', key: 'denied' },
];
function permList(tab, view) {
  const q = $('perms-search').value.trim().toLowerCase();
  const g = permsAllTabs().find(t => t.id === tab);
  if (!g) return [];
  const key = (PERM_VIEWS.find(v => v.id === view) || PERM_VIEWS[0]).key;
  const rows = g[key] || [];
  return rows.filter(h => !q || h.pkg.toLowerCase().includes(q) || (h.known || '').toLowerCase().includes(q));
}
// Selection and the take-away action always mean the allowed list, whatever is
// currently on screen.
function permHolders(tab) { return permList(tab, 'allowed'); }
// One icon per permission group, drawn in the app's stroke style.
const PERM_ICONS = {
  camera: '<rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="4"/><path d="M8 6l1.5-2.5h5L16 6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/>',
  location: '<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  contacts: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.3-3.2 4-4.8 7-4.8s5.7 1.6 7 4.8"/>',
  sms: '<path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12z"/><line x1="9" y1="11" x2="15" y2="11"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
  storage: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M3 17l5-5 4 4 3-3 6 6"/>',
  body: '<polyline points="3 12 7 12 10 5 14 19 17 12 21 12"/>',
  install: '<path d="M12 3v10"/><polyline points="8 9 12 13 16 9"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  overlay: '<rect x="3" y="3" width="13" height="13" rx="2"/><path d="M8 21h11a2 2 0 0 0 2-2V8"/>',
  usage: '<line x1="5" y1="20" x2="5" y2="12"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="19" y1="20" x2="19" y2="9"/>',
  allfiles: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};
function renderPermsTabs() {
  const box = $('perms-tabs');
  box.innerHTML = '';
  for (const t of permsAllTabs()) {
    const b = el('button', `ptile${t.id === permsTab ? ' active' : ''}`);
    const ic = el('span', 'ptile-icon');
    ic.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PERM_ICONS[t.id] || ''}</svg>`;
    b.append(ic, el('span', 'ptile-label', t.label), el('span', 'ptile-count', String(permHolders(t.id).length)));
    b.addEventListener('click', () => { permsTab = t.id; selectedPerms = new Set(); renderPerms(); });
    box.appendChild(b);
  }
}
function renderPermsViews() {
  const box = $('perms-views');
  box.innerHTML = '';
  const g = permsAllTabs().find(t => t.id === permsTab);
  box.classList.toggle('hidden', !g || g.kind !== 'runtime');
  if (!g || g.kind !== 'runtime') return;
  // Named as a filter, so the row is not read as a second set of action buttons.
  box.appendChild(el('span', 'perm-views-label', 'Showing'));
  for (const v of PERM_VIEWS) {
    const b = el('button', `perm-view${v.id === permsView ? ' active' : ''}`);
    b.append(document.createTextNode(v.label), el('span', 'n', String(permList(permsTab, v.id).length)));
    b.addEventListener('click', () => { permsView = v.id; selectedPerms = new Set(); renderPerms(); });
    box.appendChild(b);
  }
}
const VIEW_NOTE = {
  ask: 'These hold nothing right now; the phone prompts if they ask. Some you chose, most have never come up.',
  denied: 'Refused outright — the phone will not prompt for these again.',
};
function renderPerms() {
  if (!permsData) return;
  renderPermsTabs();
  const g0 = permsAllTabs().find(t => t.id === permsTab);
  if (g0 && g0.kind !== 'runtime') permsView = 'allowed';
  renderPermsViews();
  syncPermsActions();
  const rows = permList(permsTab, permsView);
  const box = $('perms-rows');
  box.innerHTML = '';
  if (VIEW_NOTE[permsView]) box.appendChild(el('div', 'perm-note', VIEW_NOTE[permsView]));
  if (!rows.length) {
    const empty = permsView === 'ask' ? 'No app is set to ask each time for this one.'
      : permsView === 'denied' ? 'No app asked for this permission and went without it.'
        : 'No apps hold this permission.';
    box.appendChild(el('div', 'tab-empty', empty + ($('perms-search').value.trim() ? ' Nothing matches the filter either.' : '')));
    return;
  }
  for (const h of rows) {
    const row = el('div', 'prow');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = selectedPerms.has(h.pkg);
    cb.addEventListener('change', () => { cb.checked ? selectedPerms.add(h.pkg) : selectedPerms.delete(h.pkg); syncPermsActions(); });
    row.appendChild(cb);
    const body = el('div', 'body');
    const nameLine = el('div');
    nameLine.append(el('span', 'name', appLabel(h.pkg, h.known)));
    nameLine.append(el('span', `chip ${h.user ? 'origin-user' : 'origin-preload'}`, h.user ? 'user' : 'system'));
    if (h.lastUsed) {
      const c = el('span', 'chip optional', `last used ${h.lastUsed}`);
      if (h.lastUsedAt) c.title = new Date(h.lastUsedAt).toLocaleString();
      nameLine.append(c);
    }
    if (h.byUser) {
      const c = el('span', 'chip optional', 'will not be asked');
      c.title = 'USER_FIXED is set: the phone refuses this app outright and stops prompting for it.';
      nameLine.append(c);
    }
    if (h.chosen) {
      const c = el('span', 'chip optional', 'your choice');
      c.title = 'You picked this state yourself — the permission carries ONE_TIME or USER_SET. '
        + 'The others in this list have simply never been asked for, and would prompt if they were.';
      nameLine.append(c);
    }
    if (h.bySystem) {
      const c = el('span', 'chip optional', 'granted by the system');
      c.title = 'Granted by a platform default or by a role the app holds, not by a choice '
        + 'you made. Android does not show these the way it shows permissions you granted.';
      nameLine.append(c);
    }
    if (h.asleep) {
      const c = el('span', 'chip optional', 'asleep');
      c.title = 'The phone has put this unused app to sleep (DISABLED_UNTIL_USED). '
        + 'Settings shows a sleeping app as having no permissions, but the grant is still '
        + 'recorded and applies again the moment the app runs.';
      nameLine.append(c);
    }
    body.append(nameLine, el('div', 'pkg', h.pkg + (h.perms.length ? `  ·  ${h.perms.join(', ')}` : '')));
    row.appendChild(body);
    const search = el('button', 'small', 'Search web');
    search.addEventListener('click', () => window.sentinel.searchWeb(`${h.pkg} android app what is it`));
    row.append(search, originButton(h.pkg));
    box.appendChild(row);
  }
}
async function loadPerms() {
  if (!(await checkAdb())) return;
  busy('perms-status', 'Reading permission records from the phone…');
  skeletonRows('perms-rows', 'perms-empty');
  const res = await window.sentinel.permsAudit();
  if (res.error) { $('perms-status').textContent = res.error; clearSkeleton('perms-rows', 'perms-empty'); return; }
  clearSkeleton('perms-rows');
  permsData = res;
  permsChangedCount = res.changedCount || 0;
  permsTab = permsTab || 'camera';
  $('perms-empty').classList.add('hidden');
  $('perms-tabs').classList.remove('hidden');
  $('export-perms').classList.remove('hidden');
  const total = new Set(permsAllTabs().flatMap(t => t.holders.map(h => h.pkg))).size;
  $('perms-status').textContent = `${total} apps hold at least one audited permission on ${res.device.model}`;
  renderPerms();
}
$('perms-scan').addEventListener('click', loadPerms);
$('perms-search').addEventListener('input', renderPerms);
$('perms-selall').addEventListener('change', (e) => {
  for (const h of permList(permsTab, permsView)) { if (e.target.checked) selectedPerms.add(h.pkg); else selectedPerms.delete(h.pkg); }
  renderPerms();
});
$('perms-clear-sel').addEventListener('click', () => { selectedPerms = new Set(); renderPerms(); });
// Switching list or permission clears the selection, so everything selected is
// in the state the list on screen shows — that state is the one ticked. Android
// has no ask-each-time for the special-access permissions, so that row says so
// instead of vanishing and leaving the menu a different shape.
$('perms-set').addEventListener('click', () => {
  const g = permGroupOnScreen();
  if (!g || !selectedPerms.size) return;
  const label = g.label.toLowerCase();
  const runtime = g.kind === 'runtime';
  openMenu($('perms-set'), [
    {
      label: 'Allow',
      note: 'Held for good. The app is never prompted about it again.',
      current: permsView === 'allowed',
      onPick: () => applyPerms('grant'),
    },
    {
      label: 'Ask each time',
      note: runtime
        ? 'The app holds nothing until it asks; the phone prompts when it does.'
        : 'Android has no ask-each-time state for this one — it is on or off.',
      current: runtime && permsView === 'ask',
      disabled: !runtime,
      onPick: () => applyPerms('ask'),
    },
    {
      label: "Don't allow",
      note: 'Refused outright, with no prompt. Apps that expect it may lose features or crash.',
      tone: 'mi-danger',
      current: permsView === 'denied',
      onPick: () => applyPerms('deny'),
    },
  ]);
});
$('perms-revert').addEventListener('click', async () => {
  const res = await window.sentinel.permsRevert();
  if (res.cancelled || res.error) { if (res.error) $('perms-status').textContent = res.error; return; }
  await loadPerms();
  $('perms-status').textContent = `${(res.done || []).length} permission(s) restored`;
});
function permsMd() {
  const L = ['# Phone Checker — permission audit', '', `- Exported: ${new Date().toLocaleString()}`, ''];
  for (const t of permsAllTabs()) {
    L.push(`## ${t.label} (${t.holders.length})`, '');
    for (const h of t.holders) L.push(`- ${h.pkg} — ${h.user ? 'user' : 'system'}${h.perms.length ? ` — ${h.perms.join(', ')}` : ''}${h.lastUsed ? ` — last used ${h.lastUsed}` : ''}${h.asleep ? ' — asleep (unused)' : ''}${h.bySystem ? ' — granted by the system' : ''}${h.known ? ` — ${h.known}` : ''}`);
    if ((t.asks || []).length) {
      L.push('', `### Ask each time (${t.asks.length})`, '');
      for (const h of t.asks) L.push(`- ${h.pkg} — ${h.user ? 'user' : 'system'}${h.perms.length ? ` — ${h.perms.join(', ')}` : ''}`);
    }
    if ((t.denied || []).length) {
      L.push('', `### Not allowed (${t.denied.length})`, '');
      for (const h of t.denied) L.push(`- ${h.pkg} — ${h.user ? 'user' : 'system'}${h.perms.length ? ` — ${h.perms.join(', ')}` : ''}${h.byUser ? ' — refused by you' : ''}`);
    }
    L.push('');
  }
  return L.join('\n');
}
$('export-perms').addEventListener('click', () => { if (permsData) exportIt('phone-checker-permissions', permsMd()); });

// ---------- history: "what changed?" run comparison ----------
let diffHistory = [];
let lastDiffMd = null;
function populateDiff(res) {
  diffHistory = res.history || [];
  const panel = $('diff-panel');
  if (diffHistory.length < 2) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const opt = (r, i) => {
    const o = el('option', null, `${new Date(r.ts).toLocaleString()} — ${r.counts.flag} ⚑ ${r.counts.note} ◐`);
    o.value = String(i);
    return o;
  };
  const a = $('diff-a'), b = $('diff-b');
  a.innerHTML = ''; b.innerHTML = '';
  diffHistory.forEach((r, i) => { a.appendChild(opt(r, i)); b.appendChild(opt(r, i)); });
  a.value = '1'; b.value = '0'; // history is stored newest-first
}
function diffRuns(older, newer) {
  const byId = (r) => { const m = {}; for (const c of r.results) m[c.id || c.title] = c; return m; };
  const A = byId(older), B = byId(newer);
  const out = [];
  for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const ca = A[id], cb = B[id];
    if (!ca || !cb) { out.push({ title: (cb || ca).title, only: cb ? 'newer' : 'older' }); continue; }
    const la = new Set(ca.lines), lb = new Set(cb.lines);
    const added = cb.lines.filter(l => !la.has(l));
    const removed = ca.lines.filter(l => !lb.has(l));
    if (ca.status !== cb.status || added.length || removed.length)
      out.push({ title: cb.title, statusA: ca.status, statusB: cb.status, added, removed });
  }
  return out;
}
$('diff-run').addEventListener('click', () => {
  const ia = +$('diff-a').value, ib = +$('diff-b').value;
  if (ia === ib) { $('diff-status').textContent = 'Pick two different runs.'; return; }
  const older = diffHistory[Math.max(ia, ib)], newer = diffHistory[Math.min(ia, ib)];
  const out = $('diff-out');
  out.innerHTML = '';
  const changes = diffRuns(older, newer);
  const L = ['# Phone Checker — run comparison', '',
    `- Older run: ${new Date(older.ts).toLocaleString()}`,
    `- Newer run: ${new Date(newer.ts).toLocaleString()}`, ''];
  $('diff-status').textContent = changes.length ? `${changes.length} check(s) changed` : '';
  if (!changes.length) {
    out.appendChild(el('div', 'tab-empty', 'No differences — the two runs found exactly the same things.'));
    L.push('No differences.');
  }
  for (const c of changes) {
    const head = el('div', 'tier-head', c.title + '  ');
    if (c.only) head.append(el('span', 'chip caution', `only in the ${c.only} run`));
    else if (c.statusA !== c.statusB) head.append(el('span', 'chip caution', `${c.statusA} → ${c.statusB}`));
    out.appendChild(head);
    L.push(`## ${c.title}${c.only ? ` (only in the ${c.only} run)` : c.statusA !== c.statusB ? ` (${c.statusA} → ${c.statusB})` : ''}`, '');
    for (const l of c.added || []) { out.appendChild(el('div', 'dline add', `+ ${l}`)); L.push(`- + ${l}`); }
    for (const l of c.removed || []) { out.appendChild(el('div', 'dline del', `− ${l}`)); L.push(`- − ${l}`); }
    L.push('');
  }
  lastDiffMd = L.join('\n');
  $('export-diff').classList.remove('hidden');
});
$('export-diff').addEventListener('click', () => { if (lastDiffMd) exportIt('phone-checker-run-diff', lastDiffMd); });

// ---------- verify app (APK copy + local checksum) ----------
async function openVerify(pkg) {
  const modal = $('modal-verify'), body = $('verify-body');
  modal.classList.remove('hidden');
  $('verify-search').classList.add('hidden');
  $('verify-copy').classList.add('hidden');
  body.textContent = '';
  const wait = el('div');
  wait.append(el('span', 'spinner'), document.createTextNode(` Copying ${pkg} from the phone and computing its checksum…`));
  body.appendChild(wait);
  const res = await window.sentinel.verifyApp(pkg);
  body.textContent = '';
  if (res.error) { body.appendChild(el('div', null, res.error)); return; }
  const line = (k, v, mono) => {
    const d = el('div');
    d.append(el('b', null, k + '  '), el('span', mono ? 'mono-select' : null, v));
    return d;
  };
  body.append(
    line('Package', res.pkg, true),
    line('Version', res.version || 'unknown'),
    line('Installer of record', res.installer || 'none recorded (preload or sideload)', !!res.installer),
    line('APK on phone', res.apk, true),
    line('Size', `${(res.size / 1048576).toFixed(1)} MB`),
    line('SHA-256', res.sha256, true),
    line('Local copy', 'hashed, then deleted — nothing is kept on this computer'),
  );
  $('verify-search').classList.remove('hidden');
  $('verify-copy').classList.remove('hidden');
  $('verify-search').onclick = () => window.sentinel.searchWeb(res.sha256);
  $('verify-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(res.sha256); $('verify-copy').textContent = 'Copied ✓'; }
    catch { $('verify-copy').textContent = 'Select the hash & copy manually'; }
  };
}
$('verify-close').addEventListener('click', () => {
  $('modal-verify').classList.add('hidden');
  $('verify-copy').textContent = 'Copy SHA-256';
});

// ---------- install origins (when, by whom, through which channel) ----------
// Every line here is read from the connected phone's own package-manager
// records; the wording comes from src/origin.js. The Origin button on the Apps,
// Advisor and Permissions rows opens the same record for one app.
let originsList = [], originsFilter = 'all', originsSerial, originsSessions = 0, lastOriginText = null;
const ENABLED_TEXT = { 0: 'enabled', 1: 'enabled', 2: 'disabled', 3: 'disabled by the user', 4: 'disabled until used' };
const isEpochTime = (t) => !!t && /^19\d\d-/.test(t);
function relTime(str) {
  if (!str || isEpochTime(str)) return null;
  const t = new Date(String(str).replace(' ', 'T')).getTime();
  if (isNaN(t)) return null;
  const ms = Date.now() - t;
  if (ms < 0) return null;
  const min = ms / 60000, hr = min / 60, day = hr / 24;
  const n = (v, unit) => { const r = Math.max(1, Math.round(v)); return `${r} ${unit}${r === 1 ? '' : 's'} ago`; };
  if (min < 2) return 'just now';
  if (min < 60) return n(min, 'minute');
  if (hr < 24) return n(hr, 'hour');
  if (day < 31) return n(day, 'day');
  if (day < 365) return n(day / 30.44, 'month');
  return n(day / 365.25, 'year');
}
const withRel = (str) => { const r = relTime(str); return r ? `${str}  ·  ${r}` : str; };

function originButton(pkg) {
  const b = el('button', 'small', 'Origin');
  b.title = 'When this app was installed on the phone, by which app, and through which channel';
  b.addEventListener('click', () => openOrigin(pkg));
  return b;
}

function originRow(r) {
  const row = el('div', 'prow');
  row.appendChild(el('span', 'donemark', ''));
  const body = el('div', 'body');
  const nameLine = el('div');
  nameLine.append(el('span', 'name', appLabel(r.pkg, r.known)));
  if (!r.system && r.installed) nameLine.append(el('span', 'chip origin-user', 'user'));
  nameLine.append(el('span', `chip origin-${r.origin.tone}`, r.origin.chip));
  if (r.installed && r.enabled >= 2) nameLine.append(el('span', 'chip caution', 'disabled'));
  if (r.installed && !r.system && r.notLaunched) nameLine.append(el('span', 'chip optional', 'never opened'));
  const meta = [
    r.pkg,
    r.versionName ? `v${r.versionName}` : null,
    r.firstInstall && !isEpochTime(r.firstInstall) ? `installed ${r.firstInstall}${relTime(r.firstInstall) ? ` (${relTime(r.firstInstall)})` : ''}` : null,
    r.lastUpdate && !isEpochTime(r.lastUpdate) && r.lastUpdate !== r.firstInstall ? `updated ${r.lastUpdate}` : null,
  ].filter(Boolean).join('  ·  ');
  body.append(nameLine, el('div', 'pkg', meta), el('div', 'desc', r.origin.summary));
  row.appendChild(body);
  const details = el('button', 'small', 'Details');
  details.addEventListener('click', () => openOrigin(r.pkg, r));
  const search = el('button', 'small', 'Search web');
  search.addEventListener('click', () => window.sentinel.searchWeb(`${r.pkg} android app what is it`));
  row.append(details, search);
  return row;
}

const originBucket = (r) => !r.installed ? 'removed'
  : r.system ? 'preload'
  : ['store', 'vendor-store'].includes(r.origin.channel) ? 'stores'
  : ['apk', 'adb', 'none'].includes(r.origin.channel) ? 'side'
  : 'user';
const originMatches = (r, q) => !q || r.pkg.toLowerCase().includes(q) || (r.known || '').toLowerCase().includes(q) || (r.origin.who || '').toLowerCase().includes(q) || r.origin.chip.toLowerCase().includes(q);

// A record whose install date is the 1970 placeholder has no real date, so it
// falls outside any range the user picks rather than pretending to be ancient.
function withinDates(r, from, to) {
  if (!from && !to) return true;
  const d = (r.firstInstall || '').slice(0, 10);
  if (!d || isEpochTime(r.firstInstall)) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
function visibleOrigins() {
  const q = $('origins-search').value.trim().toLowerCase();
  const ns = $('origins-ns').value;
  const [field, dir] = $('origins-sort').value.split('-');
  const from = $('origins-from').value, to = $('origins-to').value;
  const key = (r) => field === 'name' ? appLabel(r.pkg, r.known).toLowerCase() : field === 'last' ? (r.lastUpdate || '') : (r.firstInstall || '');
  const sign = dir === 'asc' ? 1 : -1;
  return originsList
    .filter(r => originMatches(r, q))
    .filter(r => !ns || nsOf(r.pkg) === ns)
    .filter(r => withinDates(r, from, to))
    .filter(r => originsFilter === 'all' ? true : originsFilter === 'user' ? (!r.system && r.installed) : originBucket(r) === originsFilter)
    .sort((a, b) => sign * key(a).localeCompare(key(b)) || a.pkg.localeCompare(b.pkg));
}

function renderOrigins() {
  const q = $('origins-search').value.trim().toLowerCase();
  const from = $('origins-from').value, to = $('origins-to').value, ns = $('origins-ns').value;
  $('origins-clear-dates').classList.toggle('hidden', !from && !to && !ns && !$('origins-range').value);
  const matched = originsList.filter(r => originMatches(r, q)).filter(r => !ns || nsOf(r.pkg) === ns).filter(r => withinDates(r, from, to));
  $('oc-all').textContent = String(matched.length);
  $('oc-user').textContent = String(matched.filter(r => !r.system && r.installed).length);
  for (const k of ['stores', 'side', 'preload', 'removed']) $(`oc-${k}`).textContent = String(matched.filter(r => originBucket(r) === k).length);
  const rows = visibleOrigins();
  const box = $('origins-rows');
  box.innerHTML = '';
  if (!rows.length) { box.appendChild(el('div', 'tab-empty', originsList.length ? 'No packages match.' : '')); return; }
  for (const r of rows) box.appendChild(originRow(r));
}

async function loadOrigins(force = false) {
  if (!(await checkAdb())) return;
  if (originsList.length && originsSerial === currentSerial && !force) return;
  busy('origins-status', 'Reading install records from the phone…');
  skeletonRows('origins-rows', 'origins-empty');
  const res = await window.sentinel.originAll();
  // The phone can be unplugged or swapped while this read is in flight. The
  // answer names the phone it came from, so a late answer is dropped rather
  // than painted under another phone's name. (On the very first load the poll
  // may not have reported a serial yet, which is not a mismatch.)
  const fromSerial = res.device && res.device.serial;
  if (fromSerial && currentSerial !== undefined && currentSerial !== fromSerial) {
    $('origins-status').textContent = 'The phone changed while this was loading, so nothing is shown. Press Refresh to read the phone that is connected now.';
    clearSkeleton('origins-rows', 'origins-empty');
    return;
  }
  if (res.error) { $('origins-status').textContent = res.error; clearSkeleton('origins-rows', 'origins-empty'); return; }
  clearSkeleton('origins-rows');
  originsList = res.records;
  originsSerial = fromSerial || currentSerial;
  originsSessions = res.sessionsRemembered || 0;
  $('origins-empty').classList.add('hidden');
  $('export-origins').classList.remove('hidden');
  const user = originsList.filter(r => !r.system && r.installed).length;
  fillNamespaceSelect($('origins-ns'), originsList.map(r => r.pkg));
  $('origins-status').textContent = `${originsList.length} package records on ${res.device.model} · ${user} user-installed · ${originsSessions} install session(s) remembered since the last restart`;
  renderOrigins();
}
$('origins-refresh').addEventListener('click', () => loadOrigins(true));
$('origins-search').addEventListener('input', renderOrigins);
$('origins-sort').addEventListener('change', renderOrigins);
$('origins-from').addEventListener('change', () => { $('origins-range').value = ''; renderOrigins(); });
$('origins-to').addEventListener('change', () => { $('origins-range').value = ''; renderOrigins(); });
$('origins-ns').addEventListener('change', renderOrigins);
// The quick ranges just fill in the two date boxes, so what is being filtered
// stays visible rather than hidden behind a menu.
$('origins-range').addEventListener('change', (e) => {
  const days = +e.target.value;
  if (!days) { $('origins-from').value = ''; $('origins-to').value = ''; }
  else {
    const d = new Date(Date.now() - days * 86400000);
    $('origins-from').value = d.toISOString().slice(0, 10);
    $('origins-to').value = new Date().toISOString().slice(0, 10);
  }
  renderOrigins();
});
$('origins-clear-dates').addEventListener('click', () => {
  $('origins-from').value = ''; $('origins-to').value = ''; $('origins-range').value = ''; $('origins-ns').value = '';
  renderOrigins();
});
for (const t of document.querySelectorAll('#view-origins .atab')) {
  t.addEventListener('click', () => {
    originsFilter = t.dataset.o;
    for (const b of document.querySelectorAll('#view-origins .atab')) b.classList.toggle('active', b === t);
    renderOrigins();
  });
}

// The per-app modal: full record, notes, and the sessions the phone remembers.
async function openOrigin(pkg, rec) {
  const modal = $('modal-origin'), body = $('origin-body');
  $('origin-title').textContent = `Install origin — ${pkg}`;
  modal.classList.remove('hidden');
  body.textContent = '';
  lastOriginText = null;
  let r = rec;
  if (!r) {
    const wait = el('div');
    wait.append(el('span', 'spinner'), document.createTextNode(` Reading the install record for ${pkg} from the phone…`));
    body.appendChild(wait);
    const res = await window.sentinel.originOne(pkg);
    body.textContent = '';
    if (res.error) { body.appendChild(el('div', null, res.error)); return; }
    r = res.record;
  }
  renderOriginBody(r);
}

function renderOriginBody(r) {
  const body = $('origin-body');
  const L = [`# Install origin — ${r.pkg}`, ''];
  const hero = el('div', `o-hero tone-${r.origin.tone}`);
  const chipRow = el('div', 'o-hero-chips');
  chipRow.append(el('span', `chip big origin-${r.origin.tone}`, r.origin.chip));
  if (!r.system && r.installed) chipRow.append(el('span', 'chip origin-user', 'user app'));
  if (r.installed && r.enabled >= 2) chipRow.append(el('span', 'chip caution', 'disabled'));
  hero.appendChild(chipRow);
  const when = r.firstInstall && !isEpochTime(r.firstInstall) ? r.firstInstall : null;
  const rel = relTime(r.firstInstall);
  const dateLine = el('div', 'o-hero-date');
  if (when) {
    dateLine.append(el('span', 'o-date', when));
    if (rel) dateLine.append(el('span', 'o-rel', rel));
  } else {
    dateLine.append(el('span', 'o-date', 'Arrived with the firmware'), el('span', 'o-rel', 'no install date exists'));
  }
  hero.appendChild(dateLine);
  if (r.origin.who) hero.appendChild(el('div', 'o-hero-by', `by ${r.origin.whoLabel ? `${r.origin.whoLabel} — ${r.origin.who}` : r.origin.who}`));
  body.appendChild(hero);
  L.push(`- Origin: ${r.origin.chip}${r.origin.who ? ` (${r.origin.who})` : ''}`, `- Installed: ${when || 'with the firmware'}${rel ? ` (${rel})` : ''}`, '');
  body.appendChild(el('div', 'o-summary', r.origin.summary));
  L.push(r.origin.summary, '');
  const line = (k, v, mono) => {
    if (v == null || v === '') return;
    const d = el('div');
    d.append(el('b', null, k + '  '), el('span', mono ? 'mono-select' : null, String(v)));
    body.appendChild(d);
    L.push(`- ${k}: ${v}`);
  };
  line('App', appLabel(r.pkg, r.known));
  line('Version', r.versionName ? `${r.versionName}${r.versionCode != null ? ` (code ${r.versionCode})` : ''}` : null);
  line('First installed', !r.firstInstall ? 'not recorded'
    : isEpochTime(r.firstInstall) ? 'with the firmware, at first boot — the phone\'s clock was not set yet, so no real date exists for this'
    : withRel(r.firstInstall));
  line('Last updated', r.system && !r.updatedSystem ? `never replaced — still the firmware copy${r.lastUpdate && !isEpochTime(r.lastUpdate) ? ` (file stamp ${r.lastUpdate})` : ''}`
    : !r.lastUpdate || isEpochTime(r.lastUpdate) ? 'not recorded'
    : r.lastUpdate === r.firstInstall ? `${withRel(r.lastUpdate)} — same as the install, never updated since`
    : withRel(r.lastUpdate));
  line('Installed by', r.initiating ? `${r.initiating}${r.origin.whoLabel && r.initiating === r.origin.who ? ` — ${r.origin.whoLabel}` : ''}` : 'no app recorded as performing the install', true);
  line('Installer of record', r.installer || 'none', !!r.installer);
  line('File handed over by', r.originating, true);
  line('Updates owned by', r.updateOwner, true);
  line('Location on the phone', r.partition ? `${r.partition} (firmware partition)` : r.codePath ? `${r.codePath.split('/').slice(0, 3).join('/')} (installed after the firmware)` : null, true);
  line('State', [
    r.installed ? (ENABLED_TEXT[r.enabled] || 'enabled') : 'not installed for your user (record kept)',
    r.hidden ? 'hidden' : null, r.stopped ? 'stopped' : null, r.privileged ? 'privileged' : null,
  ].filter(Boolean).join(', '));
  line('Signing certificate id', r.signer, true);
  if (r.origin.notes.length) {
    body.appendChild(el('div', 'o-head', 'Notes'));
    L.push('', '## Notes', '');
    for (const n of r.origin.notes) { body.appendChild(el('div', 'o-note', `• ${n}`)); L.push(`- ${n}`); }
  }
  body.appendChild(el('div', 'o-head', 'Install sessions the phone still remembers'));
  L.push('', '## Install sessions the phone still remembers', '');
  if (!r.sessions || !r.sessions.length) {
    body.appendChild(el('div', 'o-note', 'None — the phone keeps this list in memory only, so it is empty for installs made before its last restart.'));
    L.push('- none since the last restart');
  }
  for (const sess of r.sessions || []) {
    const t = `${sess.when ? new Date(sess.when).toLocaleString() : 'unknown time'} — ${sess.text}`;
    body.appendChild(el('div', 'o-sess', t));
    L.push(`- ${t}`);
  }
  lastOriginText = L.join('\n');
  $('origin-search').onclick = () => window.sentinel.searchWeb(`${r.pkg} android app${r.origin.who ? ` installed by ${r.origin.who}` : ''}`);
}
$('origin-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(lastOriginText || ''); $('origin-copy').textContent = 'Copied ✓'; }
  catch { $('origin-copy').textContent = 'Select the text and copy manually'; }
  setTimeout(() => { $('origin-copy').textContent = 'Copy details'; }, 2000);
});
$('origin-close').addEventListener('click', () => $('modal-origin').classList.add('hidden'));

function originsMd() {
  const L = ['# Phone Checker — install origins', '', `- Exported: ${new Date().toLocaleString()}`,
    `- ${originsList.length} package records; ${originsSessions} install session(s) remembered since the last restart`, ''];
  for (const [title, f] of [
    ['User-installed', r => !r.system && r.installed],
    ['Preloaded (firmware)', r => r.system && r.installed],
    ['Not installed for your user (record kept)', r => !r.installed],
  ]) {
    const items = originsList.filter(f).sort((a, b) => (b.firstInstall || '').localeCompare(a.firstInstall || '') || a.pkg.localeCompare(b.pkg));
    if (!items.length) continue;
    L.push(`## ${title} (${items.length})`, '');
    for (const r of items) L.push(`- ${r.pkg}${r.versionName ? ` v${r.versionName}` : ''} — ${r.origin.chip} — ${r.origin.summary}${r.origin.notes.length ? ' ' + r.origin.notes.join(' ') : ''}`);
    L.push('');
  }
  return L.join('\n');
}
$('export-origins').addEventListener('click', () => { if (originsList.length) exportIt('phone-checker-install-origins', originsMd()); });

// ---------- hardware (what the phone is made of, and what it is doing now) ----------
// Everything here is read from the phone's own /proc and /sys files. "Live
// readings" re-reads only the moving numbers, on a timer that stops the moment
// the view is left, so an idle app never keeps the phone busy.
let hwData = null, hwSerial, hwTimer = null;
// A rolling window of samples. Utilisation is a difference between two readings
// of /proc/stat, so the first chart point appears one tick after the first read.
const HW_SAMPLES = 60;
let hwHist = { cpu: [], mem: [] }, hwPrevStat = null;
function busyPct(prev, now, key = 'cpu') {
  if (!prev || !now || !prev[key] || !now[key]) return null;
  const dt = now[key].total - prev[key].total, di = now[key].idle - prev[key].idle;
  if (dt <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(((dt - di) / dt) * 1000) / 10));
}
function pushHwSample(res) {
  if (res.stat) {
    const pct = busyPct(hwPrevStat, res.stat);
    if (pct != null) hwHist.cpu.push(pct);
    hwPrevStat = res.stat;
  }
  const m = res.memory;
  if (m && m.totalKb && m.usedKb != null) hwHist.mem.push(Math.round((m.usedKb / m.totalKb) * 1000) / 10);
  for (const k of ['cpu', 'mem']) if (hwHist[k].length > HW_SAMPLES) hwHist[k] = hwHist[k].slice(-HW_SAMPLES);
}
function resetHwHistory() { hwHist = { cpu: [], mem: [] }; hwPrevStat = null; }

// One filled line, newest sample on the right, fixed 0–100% scale.
function lineChart(points, colorVar) {
  const W = 300, H = 100;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  for (const p of [25, 50, 75]) {
    const g = document.createElementNS(SVGNS, 'line');
    g.setAttribute('x1', 0); g.setAttribute('x2', W);
    g.setAttribute('y1', H - (p / 100) * H); g.setAttribute('y2', H - (p / 100) * H);
    g.style.stroke = 'var(--border)'; g.setAttribute('stroke-width', 1); g.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(g);
  }
  if (points.length >= 2) {
    const step = W / (HW_SAMPLES - 1);
    const pts = points.map((v, i) => [W - (points.length - 1 - i) * step, H - (v / 100) * H]);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = document.createElementNS(SVGNS, 'path');
    area.setAttribute('d', `${d} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`);
    area.style.fill = `color-mix(in srgb, var(${colorVar}) 18%, transparent)`;
    const line = document.createElementNS(SVGNS, 'path');
    line.setAttribute('d', d);
    line.style.fill = 'none'; line.style.stroke = `var(${colorVar})`;
    line.setAttribute('stroke-width', 2); line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.setAttribute('stroke-linejoin', 'round'); line.setAttribute('stroke-linecap', 'round');
    svg.append(area, line);
  }
  return svg;
}
function chartPanel(title, sub, points, colorVar, unit) {
  const p = el('div', 'panel chart');
  const head = el('div', 'chart-head');
  head.append(el('h3', null, title));
  const now = points.length ? points[points.length - 1] : null;
  head.append(el('span', 'chart-now', now == null ? '—' : `${now}${unit}`));
  p.append(head, el('div', 'chart-sub', sub));
  p.appendChild(lineChart(points, colorVar));
  p.appendChild(el('div', 'chart-hint', points.length >= 2
    ? `last ${points.length} readings, newest on the right`
    : 'collecting the first readings…'));
  return p;
}
const GB = (kb) => kb == null ? null : (kb / 1048576).toFixed(kb > 1048576 * 10 ? 1 : 2) + ' GB';
const fmtUptime = (sec) => {
  if (!sec) return null;
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
};
const tempClass = (c) => c >= 60 ? 'flag' : c >= 45 ? 'note' : 'ok';

function tile(num, label, sub) {
  const t = el('div', 'panel stat');
  t.append(el('div', 'stat-num', num), el('div', 'stat-label', label));
  if (sub) t.append(el('div', 'stat-sub', sub));
  return t;
}
// One reading as a ring: the arc is the share of whatever ceiling that reading
// has, the number inside is the reading itself. Same construction as the
// dashboard donut so the two read as one family.
function gauge(frac, big, unit, label, sub, color, size = 108, cls = 'gauge') {
  const r = size * 0.407, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r, sw = Math.max(5, size * 0.083);
  const g = el('div', cls);
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  const ring = (stroke, dash) => {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
    c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', sw);
    c.style.stroke = stroke;
    if (dash != null) {
      c.setAttribute('stroke-dasharray', `${Math.max(0.001, dash * C)} ${C}`);
      c.setAttribute('stroke-linecap', 'round');
      c.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    }
    return c;
  };
  svg.appendChild(ring('var(--donut-track)', null));
  if (frac != null) svg.appendChild(ring(`var(--${color})`, Math.max(0, Math.min(1, frac))));
  const num = document.createElementNS(SVGNS, 'text');
  num.setAttribute('x', cx); num.setAttribute('y', cy + (unit ? size * 0.018 : size * 0.055)); num.setAttribute('text-anchor', 'middle');
  num.setAttribute('font-size', String(size * (big.length > 4 ? 0.194 : 0.231))); num.setAttribute('font-weight', '700');
  num.setAttribute('font-family', 'inherit'); num.style.fill = 'var(--text)';
  num.textContent = big;
  svg.appendChild(num);
  if (unit) {
    const u = document.createElementNS(SVGNS, 'text');
    u.setAttribute('x', cx); u.setAttribute('y', cy + size * 0.176); u.setAttribute('text-anchor', 'middle');
    u.setAttribute('font-size', String(Math.max(8, size * 0.097))); u.setAttribute('font-family', 'inherit');
    u.style.fill = 'var(--muted)'; u.textContent = unit;
    svg.appendChild(u);
  }
  g.append(svg, el('div', 'gauge-label', label));
  if (sub) g.append(el('div', 'gauge-sub', sub));
  return g;
}

// Vendor GPU strings carry a build hash and a date nobody reads. Keep the part
// that identifies the chip.
function shortGpu(s) {
  const chip = /(Adreno|Mali|PowerVR|Xclipse|Immortalis)[^,]*/i.exec(s);
  const gl = /OpenGL ES [\d.]+/i.exec(s);
  const name = chip ? chip[0].replace(/\s*\(TM\)\s*/i, ' ').replace(/\s+/g, ' ').trim() : null;
  return [name, gl && gl[0]].filter(Boolean).join(' · ') || s;
}

const THERM_TOP = 12;
let thermExpanded = true;

function meter(pct, cls) {
  const bar = el('div', 'bar');
  const fill = el('i');
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (cls) fill.style.background = `var(--${cls})`;
  bar.appendChild(fill);
  return bar;
}
// A battery drawn to its actual charge: outline and fill in the level's colour,
// the number inside, and a bolt when it is taking power in. Fill is a tint
// rather than a solid so the reading stays legible over it in either theme.
function batteryFigure(level, status) {
  const tone = level < 20 ? 'flag' : level < 50 ? 'note' : 'ok';
  const W = 92, H = 152, nubW = 30, nubH = 7;
  const bx = 9, by = nubH + 3, bw = W - bx * 2, bh = H - by - 5, br = 13;
  const pad = 6, iw = bw - pad * 2, ih = bh - pad * 2;
  const fillH = Math.max(level > 0 ? 4 : 0, Math.round((Math.max(0, Math.min(100, level)) / 100) * ih));

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const rect = (x, y, w, h, r, fill, stroke, sw) => {
    const n = document.createElementNS(SVGNS, 'rect');
    n.setAttribute('x', x); n.setAttribute('y', y); n.setAttribute('width', w); n.setAttribute('height', h);
    n.setAttribute('rx', r);
    n.style.fill = fill; if (stroke) { n.style.stroke = stroke; n.setAttribute('stroke-width', sw); }
    return n;
  };
  svg.appendChild(rect((W - nubW) / 2, 0, nubW, nubH + 4, 3, `var(--${tone})`));
  svg.appendChild(rect(bx + pad, by + pad + (ih - fillH), iw, fillH, Math.min(7, fillH / 2),
    `color-mix(in srgb, var(--${tone}) 30%, transparent)`));
  svg.appendChild(rect(bx, by, bw, bh, br, 'none', `var(--${tone})`, 2.5));

  const num = document.createElementNS(SVGNS, 'text');
  num.setAttribute('x', W / 2); num.setAttribute('y', by + bh / 2 + 5); num.setAttribute('text-anchor', 'middle');
  num.setAttribute('font-size', '15'); num.setAttribute('font-weight', '700'); num.setAttribute('font-family', 'inherit');
  num.style.fill = 'var(--text)';
  num.textContent = `${level}%`;
  svg.appendChild(num);

  if (/charging/i.test(status || '') && !/not charging/i.test(status || '')) {
    const bolt = document.createElementNS(SVGNS, 'path');
    bolt.setAttribute('d', 'M0 9 L6 0 L4.4 6.6 L9 6 L3 15 L4.6 8.4 Z');
    bolt.setAttribute('transform', `translate(${W / 2 - 4.5} ${by + bh / 2 + 11})`);
    bolt.style.fill = `var(--${tone})`;
    svg.appendChild(bolt);
  }

  const fig = el('div', 'batt-fig');
  fig.appendChild(svg);
  return fig;
}

function kvPanel(title, rows) {
  const p = el('div', 'panel');
  p.appendChild(el('h3', null, title));
  const kv = el('div', 'kv');
  for (const [k, v] of rows) {
    if (v == null || v === '') continue;
    const line = el('div');
    line.append(el('b', null, k + '  '), document.createTextNode(String(v)));
    kv.appendChild(line);
  }
  p.appendChild(kv);
  return p;
}

function renderHardware() {
  const h = hwData;
  const grid = $('hw-grid');
  grid.innerHTML = '';
  if (!h) return;
  const mem = h.memory, batt = h.battery, disk = (h.storage || [])[0];
  const hottest = [...(h.thermal || [])].sort((a, b) => b.c - a.c)[0];
  const busiest = [...(h.cpu.cores || [])].sort((a, b) => (b.curMhz || 0) - (a.curMhz || 0))[0];

  // ---- right now: one ring per live reading ----
  const rings = el('div', 'panel gauge-row');
  const liveCpu = hwHist.cpu.length ? hwHist.cpu[hwHist.cpu.length - 1] : null;
  rings.appendChild(liveCpu != null
    ? gauge(liveCpu / 100, `${Math.round(liveCpu)}`, '%', 'Processor',
        [h.cpu.count ? `${h.cpu.count} cores` : null, h.cpu.load1 != null ? `load ${h.cpu.load1.toFixed(2)}` : null].filter(Boolean).join(' · '),
        liveCpu > 85 ? 'note' : 'accent')
    : gauge(busiest && busiest.maxMhz && busiest.curMhz ? busiest.curMhz / busiest.maxMhz : null,
        busiest && busiest.curMhz ? (busiest.curMhz / 1000).toFixed(2) : '—', 'GHz', 'Peak core clock',
        [busiest && busiest.maxMhz ? `of ${(busiest.maxMhz / 1000).toFixed(2)} GHz` : null,
         h.cpu.load1 != null ? `load ${h.cpu.load1.toFixed(2)}` : null].filter(Boolean).join(' · '), 'accent'));
  if (mem && mem.usedKb != null) {
    const f = mem.usedKb / mem.totalKb;
    rings.appendChild(gauge(f, `${Math.round(f * 100)}`, '%', 'Memory',
      `${GB(mem.usedKb)} of ${GB(mem.totalKb)}`, f > 0.9 ? 'note' : 'accent-2'));
  }
  if (disk) {
    rings.appendChild(gauge((disk.pct || 0) / 100, `${disk.pct}`, '%', 'Storage',
      `${disk.used} of ${disk.size}`, disk.pct > 90 ? 'flag' : disk.pct > 75 ? 'note' : 'accent'));
  }
  if (batt && batt.level != null) {
    rings.appendChild(gauge(batt.level / 100, `${batt.level}`, '%', 'Battery',
      [batt.status, batt.tempC != null ? `${batt.tempC} °C` : null].filter(Boolean).join(' · '),
      batt.level < 20 ? 'flag' : batt.level < 50 ? 'note' : 'ok'));
  }
  if (hottest) {
    // 20 °C is idle-cool and 60 °C is where throttling territory begins, so the
    // ring reads against that span rather than against 0–100.
    rings.appendChild(gauge((hottest.c - 20) / 40, `${hottest.c}`, '°C', 'Hottest sensor',
      hottest.type, hottest.c >= 50 ? 'flag' : hottest.c >= 40 ? 'note' : 'ok'));
  }
  grid.appendChild(rings);

  // The charts are what live readings are for, so they appear with it and go
  // away with it rather than sitting there empty.
  if ($('hw-live').checked) {
    const charts = el('div', 'charts');
    charts.append(
      chartPanel('Processor use', h.cpu.count ? `across all ${h.cpu.count} cores` : 'across all cores', hwHist.cpu, '--accent', '%'),
      chartPanel('Memory use', mem ? `${GB(mem.usedKb)} of ${GB(mem.totalKb)} in use` : 'memory in use', hwHist.mem, '--accent-2', '%'),
    );
    grid.appendChild(charts);
  }

  // ---- processor: every core in one grid, side by side ----
  const cpu = el('div', 'panel');
  cpu.appendChild(el('h3', null, 'Processor'));
  const cores = h.cpu.cores || [];
  // Listing cores by index alone hides which cluster each belongs to, so the
  // clusters are named once above the grid and each core carries its tag.
  const byMax = new Map();
  for (const c of cores) {
    const k = c.maxMhz || 0;
    if (!byMax.has(k)) byMax.set(k, []);
    byMax.get(k).push(c);
  }
  const groups = [...byMax.entries()].sort((a, b) => b[0] - a[0]);
  const NAMES = groups.length >= 3 ? ['Prime', 'Performance', 'Efficiency'] : ['Performance', 'Efficiency'];
  const clusterName = new Map();
  groups.forEach(([maxMhz], i) => clusterName.set(maxMhz, groups.length > 1 ? (NAMES[i] || `Cluster ${i + 1}`) : 'Cores'));
  // Name the chip here too: the Processor panel is where you look for it, and
  // the spec sheet further down is not in view when you are reading the cores.
  const chipName = (h.soc && h.soc['Chipset']) || null;
  const clusterBits = groups.length > 1
    ? groups.map(([maxMhz, list]) => `${clusterName.get(maxMhz)} ${list.length} × ${(maxMhz / 1000).toFixed(2)} GHz`)
    : [];
  if (chipName || clusterBits.length) {
    const line = el('div', 'cluster-summary');
    if (chipName) line.appendChild(el('b', null, chipName));
    if (chipName && clusterBits.length) line.appendChild(document.createTextNode('   ·   '));
    if (clusterBits.length) line.appendChild(document.createTextNode(clusterBits.join('   ·   ')));
    cpu.appendChild(line);
  }
  const cg = el('div', 'core-rings');
  for (const c of [...cores].sort((a, b) => a.id - b.id)) {
    const offline = c.online === false;
    const frac = !offline && c.maxMhz && c.curMhz ? c.curMhz / c.maxMhz : null;
    const pct = (frac || 0) * 100;
    cg.appendChild(gauge(
      offline ? null : frac,
      offline ? '—' : c.curMhz ? (c.curMhz / 1000).toFixed(2) : '—',
      offline ? null : 'GHz',
      `core ${c.id}`,
      offline ? 'offline' : (groups.length > 1 ? (clusterName.get(c.maxMhz || 0) || '').toLowerCase() : null),
      pct > 85 ? 'note' : 'accent',
      78, 'core-ring'));
  }
  cpu.appendChild(cg);
  const gov = cores.map(c => c.governor).filter(Boolean)[0];
  const cpuFoot = el('div', 'kv-inline');
  for (const [k, v] of [
    ['Load (1 / 5 / 15 min)', [h.cpu.load1, h.cpu.load5, h.cpu.load15].filter(v => v != null).map(v => v.toFixed(2)).join('  ·  ') || null],
    ['Scheduler governor', gov],
    ['Up since last restart', fmtUptime(h.cpu.uptimeSec)],
  ]) { if (v) { const d = el('div'); d.append(el('b', null, k + '  '), document.createTextNode(v)); cpuFoot.appendChild(d); } }
  cpu.appendChild(cpuFoot);
  grid.appendChild(cpu);

  // ---- memory & storage: its own row, meters side by side ----
  const memPanel = el('div', 'panel');
  memPanel.appendChild(el('h3', null, 'Memory & storage'));
  const mg = el('div', 'mem-grid');
  if (mem) {
    const usedPct = mem.usedKb != null ? (mem.usedKb / mem.totalKb) * 100 : 0;
    const ram = el('div');
    ram.append(
      el('div', 'meter-label', `RAM — ${GB(mem.usedKb)} used of ${GB(mem.totalKb)}`),
      meter(usedPct, usedPct > 90 ? 'note' : 'accent'),
      el('div', 'meter-label muted', `${GB(mem.availableKb)} available${mem.cachedKb ? ` · cached ${GB(mem.cachedKb)}` : ''}`));
    mg.appendChild(ram);
    if (mem.swapTotalKb) {
      const swUsed = mem.swapTotalKb - (mem.swapFreeKb || 0);
      const sw = el('div');
      sw.append(
        el('div', 'meter-label', `Swap (RAM Plus) — ${GB(swUsed)} of ${GB(mem.swapTotalKb)}`),
        meter((swUsed / mem.swapTotalKb) * 100, 'accent-2'),
        el('div', 'meter-label muted', mem.freeKb != null ? `${GB(mem.freeKb)} of RAM completely free` : ''));
      mg.appendChild(sw);
    }
  }
  for (const d of h.storage || []) {
    const block = el('div');
    block.append(
      el('div', 'meter-label', `${d.mount} — ${d.used} used of ${d.size}`),
      meter(d.pct || 0, (d.pct || 0) > 90 ? 'flag' : (d.pct || 0) > 75 ? 'note' : 'accent'),
      el('div', 'meter-label muted', `${d.avail} free`));
    mg.appendChild(block);
  }
  memPanel.appendChild(mg);
  grid.appendChild(memPanel);

  // ---- battery and chip share a row ----
  const pair = el('div', 'hw-pair');
  if (batt) {
    const draw = batt.currentMa == null ? null
      : `${batt.currentMa > 0 ? '+' : ''}${batt.currentMa} mA ${batt.currentMa > 0 ? '(charging)' : batt.currentMa < 0 ? '(from the battery)' : ''}`;
    const bpanel = kvPanel('Battery', [
      ['Charge', batt.level != null ? `${batt.level}%` : null],
      ['State', batt.status],
      ['Health', batt.health],
      ['Temperature', batt.tempC != null ? `${batt.tempC} °C` : null],
      ['Voltage', batt.voltageV != null ? `${batt.voltageV.toFixed(2)} V` : null],
      ['Current', draw],
      ['Charge counter', batt.chargeCounterMah ? `${batt.chargeCounterMah} mAh` : null],
      ['Full-charge capacity', batt.fullChargeMah ? `${batt.fullChargeMah} mAh` : null],
      ['Design capacity', batt.designMah ? `${batt.designMah} mAh` : null],
      ['Charge cycles', batt.cycleCount],
    ]);
    if (batt.level != null) {
      // Wrap the readings and the figure into one row inside the panel.
      const kv = bpanel.querySelector('.kv');
      const row = el('div', 'batt-row');
      bpanel.insertBefore(row, kv);
      row.append(kv, batteryFigure(batt.level, batt.status));
    }
    pair.appendChild(bpanel);
  }
  pair.appendChild(kvPanel('Chip & display', [
    ...Object.entries(h.soc || {}).map(([k, v]) => [k, /gpu/i.test(k) && typeof v === 'string' ? shortGpu(v) : v]),
    ['Screen', h.display && h.display.resolution ? `${h.display.resolution}${h.display.densityDpi ? ` at ${h.display.densityDpi} dpi` : ''}` : null],
    ['Refresh rate', h.display && h.display.maxRefreshHz ? `up to ${h.display.maxRefreshHz} Hz` : null],
  ]));
  grid.appendChild(pair);

  // ---- sensors last: the hottest handful, the rest behind a disclosure ----
  const zones = [...(h.thermal || [])].sort((a, b) => b.c - a.c);
  if (zones.length) {
    const tp = el('div', 'panel wide');
    tp.appendChild(el('h3', null, `Temperatures — ${zones.length} sensors`));
    const wrap = el('div', 'therm-grid');
    zones.forEach((z, i) => {
      const chip = el('div', `therm ${tempClass(z.c)}`);
      if (i >= THERM_TOP && !thermExpanded) chip.classList.add('hidden');
      chip.append(el('span', 'therm-c', `${z.c}°`), el('span', 'therm-t', z.type));
      wrap.appendChild(chip);
    });
    tp.appendChild(wrap);
    if (zones.length > THERM_TOP) {
      const more = el('button', 'small therm-toggle');
      more.textContent = thermExpanded ? 'Show fewer' : `Show all ${zones.length} sensors`;
      more.addEventListener('click', () => { thermExpanded = !thermExpanded; renderHardware(); });
      tp.appendChild(more);
    }
    grid.appendChild(tp);
  }
}

async function loadHardware(force = false) {
  if (!(await checkAdb())) return;
  if (hwData && hwSerial === currentSerial && !force) { renderHardware(); return; }
  busy('hw-status', 'Reading the hardware details from the phone…');
  // Placeholders in the shape of the real grid, so the view does not sit empty
  // and then jump. Only on a first or forced read — the live tick must not flash.
  $('hw-empty').classList.add('hidden');
  $('hw-grid').classList.add('hidden');
  $('hw-skeleton').classList.remove('hidden');
  const res = await window.sentinel.hardware();
  const from = res.device && res.device.serial;
  if (from && currentSerial !== undefined && currentSerial !== from) { $('hw-skeleton').classList.add('hidden'); return; }
  if (res.error) { $('hw-skeleton').classList.add('hidden'); $('hw-status').textContent = res.error; return; }
  hwData = res; hwSerial = from || currentSerial;
  resetHwHistory();
  pushHwSample(res);
  $('hw-skeleton').classList.add('hidden');
  $('hw-empty').classList.add('hidden');
  $('hw-grid').classList.remove('hidden');
  $('export-hardware').classList.remove('hidden');
  $('export-hardware-png').classList.remove('hidden');
  $('hw-status').textContent = `${res.soc['Chipset'] || 'Processor'} · read ${new Date().toLocaleTimeString()}`;
  renderHardware();
  if ($('hw-live').checked) startHwLive();
}
function startHwLive() {
  stopHwLive();
  hwTimer = setInterval(async () => {
    if (!hwData) return;
    const r = await window.sentinel.hardwareLive();
    if (!r || r.error || (r.serial && hwSerial && r.serial !== hwSerial)) { $('hw-status').textContent = (r && r.error) || ''; return; }
    pushHwSample(r);
    hwData.cpu.cores = r.cores.length ? r.cores : hwData.cpu.cores;
    if (r.memory) hwData.memory = r.memory;
    if (r.thermal && r.thermal.length) hwData.thermal = r.thermal;
    if (r.battery) hwData.battery = { ...hwData.battery, ...r.battery };
    if (r.load1 != null) hwData.cpu.load1 = r.load1;
    renderHardware();
    $('hw-status').textContent = `${hwData.soc['Chipset'] || 'Processor'} · live, updated ${new Date().toLocaleTimeString()}`;
  }, 3000);
}
function stopHwLive() { if (hwTimer) { clearInterval(hwTimer); hwTimer = null; } }
$('hw-refresh').addEventListener('click', () => loadHardware(true));
$('hw-live').addEventListener('change', (e) => {
  if (e.target.checked && hwData) startHwLive(); else stopHwLive();
  renderHardware();
});

function hardwareMd() {
  const h = hwData;
  const L = ['# Phone Checker — hardware', '', `- Exported: ${new Date().toLocaleString()}`, ''];
  L.push('## Chip', '');
  for (const [k, v] of Object.entries(h.soc || {})) if (v) L.push(`- ${k}: ${v}`);
  L.push('', '## Processor', '');
  for (const c of h.cpu.cores || []) L.push(`- core ${c.id}: ${c.curMhz || '?'} MHz now, ${c.minMhz || '?'}–${c.maxMhz || '?'} MHz, governor ${c.governor || 'unknown'}`);
  if (h.cpu.load1 != null) L.push(`- load: ${[h.cpu.load1, h.cpu.load5, h.cpu.load15].filter(v => v != null).join(' / ')}`);
  if (h.memory) L.push('', '## Memory', '', `- RAM: ${GB(h.memory.usedKb)} used of ${GB(h.memory.totalKb)}, ${GB(h.memory.availableKb)} available`,
    h.memory.swapTotalKb ? `- Swap: ${GB(h.memory.swapTotalKb - (h.memory.swapFreeKb || 0))} of ${GB(h.memory.swapTotalKb)}` : '');
  L.push('', '## Storage', '');
  for (const d of h.storage || []) L.push(`- ${d.mount}: ${d.used} used of ${d.size} (${d.pct}%), ${d.avail} free`);
  if (h.battery) {
    L.push('', '## Battery', '');
    for (const [k, v] of Object.entries(h.battery)) if (v != null) L.push(`- ${k}: ${v}`);
  }
  L.push('', '## Temperatures', '');
  for (const z of [...(h.thermal || [])].sort((a, b) => b.c - a.c)) L.push(`- ${z.type}: ${z.c} °C`);
  return L.join('\n');
}
$('export-hardware').addEventListener('click', () => { if (hwData) exportIt('phone-checker-hardware', hardwareMd()); });

// Capturing the whole view means letting the page grow past the window for one
// frame, taking the shot, then putting the layout back exactly as it was.
$('export-hardware-png').addEventListener('click', async () => {
  if (!hwData) return;
  if (!window.sentinel.exportPng) {
    $('hw-status').textContent = 'This running copy of the app predates the PNG export — quit Phone Checker and start it again.';
    return;
  }
  const btn = $('export-hardware-png'), was = btn.textContent;
  btn.disabled = true; btn.textContent = 'Capturing…';
  const view = $('view-hardware');
  const live = $('hw-live').checked;
  if (live) stopHwLive();                       // no repaint mid-capture
  document.body.classList.add('capturing');
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let res = null;
  try {
    const r = view.getBoundingClientRect();
    res = await window.sentinel.exportPng({
      x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height,
    });
  } catch (err) {
    // main.js is only read when the process starts, so reloading the window
    // leaves an older main process behind and the channel is not there yet.
    const msg = String((err && err.message) || err);
    res = { error: /No handler registered/.test(msg)
      ? 'The PNG exporter is not in the running app — quit Phone Checker and start it again.'
      : `Export failed: ${msg.slice(0, 200)}` };
  } finally {
    document.body.classList.remove('capturing');
    if (live) startHwLive();
    btn.disabled = false; btn.textContent = was;
  }
  if (res && res.error) $('hw-status').textContent = res.error;
  else if (res && res.saved) $('hw-status').textContent = `Saved ${res.saved}`;
});

// ---------- save state (a snapshot before and after an update, compared here) ----------
let snapRows = [], lastSnapDiffMd = null;

function snapOption(r) {
  const o = el('option', null, `${new Date(r.ts).toLocaleString()}${r.label ? ` — ${r.label}` : ''}${r.build ? ` · ${r.build}` : ''}`);
  o.value = r.id;
  return o;
}

async function loadSnapshots() {
  const res = await window.sentinel.snapshotsList();
  snapRows = res.snapshots || [];
  setDeviceTag('snap-device', res.storeDevice, !!(res.storeDevice && res.connectedSerial === res.storeDevice.serial));
  $('snap-empty').classList.toggle('hidden', snapRows.length > 0);
  $('snap-grid').classList.toggle('hidden', snapRows.length === 0);
  $('snap-compare-panel').classList.toggle('hidden', snapRows.length < 2);
  const list = $('snap-list');
  list.innerHTML = '';
  for (const r of snapRows) {
    const row = el('div', 'runrow');
    row.append(el('span', 'when', new Date(r.ts).toLocaleString()));
    const mini = el('span', 'mini');
    mini.append(el('span', r.label ? 'chip state-enabled snap-label' : 'chip state-disabled snap-label', r.label || 'untitled'));
    mini.append(el('span', 'snap-meta', [r.build, r.patch ? `patch ${r.patch}` : null, `${r.counts.packages} packages`, `${r.counts.settings} settings`].filter(Boolean).join(' · ')));
    row.appendChild(mini);
    const view = el('button', 'small', 'View');
    view.addEventListener('click', () => openSnapshot(r.id));
    const rename = el('button', 'small', 'Rename');
    rename.addEventListener('click', () => startRename(row, r));
    const del = el('button', 'small', 'Delete');
    del.addEventListener('click', async () => { const d = await window.sentinel.snapshotDelete(r.id); if (!d.cancelled && !d.error) loadSnapshots(); });
    row.append(view, rename, del);
    list.appendChild(row);
  }
  const a = $('snap-a'), b = $('snap-b');
  a.innerHTML = ''; b.innerHTML = '';
  for (const r of snapRows) { a.appendChild(snapOption(r)); b.appendChild(snapOption(r)); }
  if (snapRows.length >= 2) { a.value = snapRows[1].id; b.value = snapRows[0].id; } // newest-first list: older → newer
}

$('snap-save').addEventListener('click', async () => {
  if (!(await checkAdb())) return;
  $('snap-save').disabled = true;
  busy('snap-status', "Reading the phone's state — this takes a few seconds…");
  const res = await window.sentinel.snapshotSave($('snap-label').value);
  $('snap-save').disabled = false;
  if (res.error) { $('snap-status').textContent = res.error; return; }
  const sv = res.saved;
  $('snap-status').textContent = `Saved${sv.label ? ` "${sv.label}"` : ''} — ${sv.build || 'build unknown'}, ${sv.counts.packages} packages, ${sv.counts.settings} settings`;
  $('snap-label').value = '';
  loadSnapshots();
});
$('snap-folder').addEventListener('click', () => window.sentinel.snapshotsFolder());

// Renaming happens in the row itself: the title becomes an input, Enter saves.
function startRename(row, r) {
  if (row.querySelector('.rename-box')) return;
  const box = el('input', 'search rename-box');
  box.type = 'text';
  box.maxLength = 60;
  box.value = r.label || '';
  box.placeholder = 'Title for this saved state';
  const done = async (save) => {
    if (box.dataset.closed) return;
    box.dataset.closed = '1';
    if (save) {
      const res = await window.sentinel.snapshotRename(r.id, box.value);
      if (res && res.error) { $('snap-status').textContent = res.error; }
    }
    loadSnapshots();
  };
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  box.addEventListener('blur', () => done(true));
  row.querySelector('.mini').replaceChildren(box);
  box.focus();
  box.select();
}

// The viewer: a readable summary of what the file holds, and the file itself.
let snapViewData = null, snapViewTab = 'summary';
async function openSnapshot(id) {
  const modal = $('modal-snap');
  modal.classList.remove('hidden');
  $('snap-view-meta').textContent = '';
  const body = $('snap-view-body');
  body.textContent = '';
  const wait = el('div');
  wait.append(el('span', 'spinner'), document.createTextNode(' Reading the saved state from this computer…'));
  body.appendChild(wait);
  const res = await window.sentinel.snapshotRead(id);
  if (res.error) { body.textContent = ''; body.appendChild(el('div', null, res.error)); return; }
  snapViewData = res;
  const sn = res.snapshot;
  $('snap-view-title').textContent = sn.label ? `Saved state — ${sn.label}` : 'Saved state';
  const meta = $('snap-view-meta');
  meta.textContent = '';
  for (const [k, v] of [
    ['Taken', new Date(sn.ts).toLocaleString()],
    ['Phone', [sn.device && sn.device.manufacturer, sn.device && sn.device.model, sn.device && sn.device.serial].filter(Boolean).join(' · ')],
    ['File', `${res.file}  (${(res.bytes / 1024).toFixed(0)} KB of JSON)`],
  ]) { const d = el('div'); d.append(el('b', null, k + '  '), el('span', 'mono-select', String(v))); meta.appendChild(d); }
  renderSnapView();
}
function renderSnapView() {
  const body = $('snap-view-body');
  body.textContent = '';
  for (const b of document.querySelectorAll('#snap-view-tabs .seg-btn')) b.classList.toggle('active', b.dataset.snaptab === snapViewTab);
  if (!snapViewData) return;
  const sn = snapViewData.snapshot;
  if (snapViewTab === 'raw') {
    const pre = el('pre', 'snap-raw');
    pre.textContent = JSON.stringify(sn, null, 2);
    body.appendChild(pre);
    return;
  }
  const pk = Object.values(sn.packages || {});
  const wrap = el('div', 'snap-summary');
  const section = (title, rows) => {
    if (!rows.length) return;
    wrap.appendChild(el('div', 'o-head', title));
    const kv = el('div', 'kv');
    for (const [k, v] of rows) { if (v == null || v === '') continue; const d = el('div'); d.append(el('b', null, k + '  '), document.createTextNode(String(v))); kv.appendChild(d); }
    wrap.appendChild(kv);
  };
  section('Software', Object.entries(sn.identity || {}));
  section('Packages', [
    ['Recorded', pk.length],
    ['Installed for you', pk.filter(x => x.inst).length],
    ['User-installed', pk.filter(x => !x.sys && x.inst).length],
    ['Preloaded', pk.filter(x => x.sys).length],
    ['Disabled', pk.filter(x => x.en >= 2).length],
    ['With a sensitive permission', pk.filter(x => x.perms && x.perms.length).length],
  ]);
  section('Settings', [
    ['global', Object.keys(sn.settings.global || {}).length],
    ['secure', Object.keys(sn.settings.secure || {}).length],
    ['system', Object.keys(sn.settings.system || {}).length],
  ]);
  section('Surfaces', [
    ['Accessibility services', (sn.surfaces.accessibility || []).join(', ') || 'none'],
    ['Notification listeners', (sn.surfaces.listeners || []).join(', ') || 'none'],
    ['Device admins', (sn.surfaces.admins || []).join(', ') || 'none'],
  ]);
  section('Battery states', [
    ['Restricted', (sn.battery.restricted || []).length],
    ['Unrestricted', (sn.battery.unrestricted || []).length],
  ]);
  wrap.appendChild(el('div', 'field-hint', 'This is a picture of the phone at that moment, kept as one JSON file on this computer. Compare two of them on this tab to see what changed.'));
  body.appendChild(wrap);
}
for (const b of document.querySelectorAll('#snap-view-tabs .seg-btn')) {
  b.addEventListener('click', () => { snapViewTab = b.dataset.snaptab; renderSnapView(); });
}
$('snap-view-close').addEventListener('click', () => $('modal-snap').classList.add('hidden'));
$('snap-view-reveal').addEventListener('click', () => { if (snapViewData) window.sentinel.snapshotReveal(snapViewData.summary.id); });
$('snap-view-copy').addEventListener('click', async () => {
  if (!snapViewData) return;
  try { await navigator.clipboard.writeText(JSON.stringify(snapViewData.snapshot, null, 2)); $('snap-view-copy').textContent = 'Copied ✓'; }
  catch { $('snap-view-copy').textContent = 'Could not copy'; }
  setTimeout(() => { $('snap-view-copy').textContent = 'Copy JSON'; }, 2000);
});
$('hero-save-state').addEventListener('click', () => { showView('snapshots'); $('snap-label').focus(); });

$('snap-run').addEventListener('click', async () => {
  const a = $('snap-a').value, b = $('snap-b').value;
  if (a === b) { $('snap-diff-status').textContent = 'Pick two different saved states.'; return; }
  busy('snap-diff-status', 'Comparing…');
  const res = await window.sentinel.snapshotsCompare(a, b);
  if (res.error) { $('snap-diff-status').textContent = res.error; return; }
  renderSnapDiff(res.diff);
});

function renderSnapDiff(d) {
  const out = $('snap-diff-out');
  out.innerHTML = '';
  const stamp = (x) => `${new Date(x.ts).toLocaleString()}${x.label ? ` — ${x.label}` : ''} (${x.build || 'build unknown'}, patch ${x.patch || 'unknown'})`;
  const L = ['# Phone Checker — saved-state comparison', '', `- Older: ${stamp(d.older)}`, `- Newer: ${stamp(d.newer)}`, `- ${d.total} difference(s)`, ''];
  $('snap-diff-status').textContent = d.total ? `${d.total} difference(s) between the two states` : 'No differences at all between the two states.';
  const head = (title, n, note) => {
    const h = el('div', 'tier-head', title + ' ');
    h.appendChild(el('span', 'count', String(n)));
    h.appendChild(el('span', n ? 'pending' : 'done', n ? `· ${note}` : '· no change'));
    out.appendChild(h);
    L.push(`## ${title} (${n})`, '');
  };
  const line = (cls, text, into = out) => { into.appendChild(el('div', `dline ${cls}`, text)); L.push(`- ${text}`); };
  const sysTag = (x) => x.sys ? ' [system]' : '';
  const short = (p) => p.replace(/^android\.permission\./, '');

  head('Software build', d.identity.length, 'changed');
  for (const x of d.identity) line('chg', `${x.key}: ${x.a || '(none)'} → ${x.b || '(none)'}`);

  const P = d.packages;
  head('Packages added', P.added.length, 'new on the phone');
  for (const x of P.added) line('add', `+ ${x.pkg}${x.v ? ` v${x.v}` : ''}${sysTag(x)} — ${x.origin ? x.origin.summary : ''}`);
  head('Packages removed', P.removed.length, 'gone from the phone');
  for (const x of P.removed) line('del', `− ${x.pkg}${x.v ? ` v${x.v}` : ''}${sysTag(x)}`);
  head('Packages updated', P.updated.length, 'new versions');
  for (const x of P.updated) line('chg', `${x.pkg}${sysTag(x)}: ${x.a || '?'} → ${x.b || '?'}${x.by ? ` (by ${x.by})` : ''}${x.when ? ` on ${x.when}` : ''}`);
  head('Re-enabled (were disabled before)', P.reenabled.length, 'switched back on');
  for (const x of P.reenabled) line('chg', `${x.pkg}${sysTag(x)}: disabled → enabled — if you had disabled it, the update turned it back on`);
  head('Newly disabled', P.disabled.length, 'switched off');
  for (const x of P.disabled) line('chg', `${x.pkg}${sysTag(x)}: enabled → disabled`);
  head('Reinstalled for your user', P.reinstalled.length, 'back');
  for (const x of P.reinstalled) line('add', `+ ${x.pkg}${sysTag(x)}${x.by ? ` (by ${x.by})` : ''}`);
  head('Uninstalled for your user (record kept)', P.uninstalled.length, 'removed');
  for (const x of P.uninstalled) line('del', `− ${x.pkg}${sysTag(x)}`);
  head('Installer changed', P.installerChanged.length, 'different installer');
  for (const x of P.installerChanged) line('chg', `${x.pkg}: ${x.a.init || x.a.by || 'none'} → ${x.b.init || x.b.by || 'none'}`);
  const flagText = (fl) => fl.sys ? (fl.upd ? 'preload, updated' : 'preload, factory version') : 'user app';
  head('System-app status changed', P.flagChanged.length, 'flag flipped');
  for (const x of P.flagChanged) line('chg', `${x.pkg}: ${flagText(x.a)} → ${flagText(x.b)}`);

  head('Sensitive permission grants', d.perms.length, 'apps changed');
  for (const x of d.perms) {
    for (const p of x.granted) line('add', `+ ${x.pkg}${sysTag(x)}: ${short(p)}`);
    for (const p of x.revoked) line('del', `− ${x.pkg}${sysTag(x)}: ${short(p)}`);
  }
  const SURF = { accessibility: 'accessibility service', listeners: 'notification listener', admins: 'device admin' };
  const surfN = Object.values(d.surfaces).reduce((n, x) => n + x.added.length + x.removed.length, 0);
  head('Accessibility · notification listeners · device admins', surfN, 'changed');
  for (const [k, label] of Object.entries(SURF)) {
    for (const p of d.surfaces[k].added) line('add', `+ ${label}: ${p}`);
    for (const p of d.surfaces[k].removed) line('del', `− ${label}: ${p}`);
  }
  head('Battery states', d.battery.length, 'changed');
  for (const x of d.battery) line('chg', `${x.pkg}: ${x.a} → ${x.b}`);

  for (const ns of ['global', 'secure', 'system']) {
    const S = d.settings[ns];
    const n = S.added.length + S.removed.length + S.changed.length;
    head(`Settings — ${ns}`, n, `changed${S.noisy ? `, ${S.noisy} look like counters or timestamps` : ''}`);
    const emit = (x, kind, into) => kind === 'changed' ? line('chg', `${x.key}: ${x.a} → ${x.b}`, into)
      : kind === 'added' ? line('add', `+ ${x.key} = ${x.b}`, into) : line('del', `− ${x.key} (was ${x.a})`, into);
    const all = [...S.changed.map(x => [x, 'changed']), ...S.added.map(x => [x, 'added']), ...S.removed.map(x => [x, 'removed'])];
    for (const [x, kind] of all) if (!x.noisy) emit(x, kind);
    const noisy = all.filter(([x]) => x.noisy);
    if (noisy.length) {
      const det = el('details', 'snap-noise');
      det.appendChild(el('summary', null, `${noisy.length} that look like counters or timestamps`));
      out.appendChild(det);
      L.push('', `(${noisy.length} that look like counters or timestamps)`);
      for (const [x, kind] of noisy) emit(x, kind, det);
    }
  }
  lastSnapDiffMd = L.join('\n');
  $('export-snapdiff').classList.remove('hidden');
}
$('export-snapdiff').addEventListener('click', () => { if (lastSnapDiffMd) exportIt('phone-checker-state-comparison', lastSnapDiffMd); });

// ---------- full report (a folder of everything, for keeping or for analysis) ----------
let lastReportFolder = null;
window.sentinel.onReportProgress((p) => {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  $('report-status').textContent = `${p.label}…  ${pct}%`;
});
$('report-export').addEventListener('click', async () => {
  if (!(await checkAdb())) return;
  const btn = $('report-export');
  btn.disabled = true;
  $('report-result').classList.add('hidden');
  busy('report-status', 'Asking where to put the report…');
  const res = await window.sentinel.exportReport($('report-personal').checked);
  btn.disabled = false;
  if (res.cancelled) { $('report-status').textContent = ''; return; }
  if (res.error) { $('report-status').textContent = res.error; return; }
  lastReportFolder = res.folder;
  $('report-status').textContent = `${res.files} files, ${(res.bytes / 1048576).toFixed(1)} MB${res.failedReads ? ` · ${res.failedReads} command(s) the phone would not answer` : ''}`;
  const box = $('report-result');
  box.textContent = '';
  box.classList.remove('hidden');
  box.appendChild(el('div', 'mono-select', res.folder));
  const note = el('div', 'field-hint', res.personalIncluded
    ? 'This folder describes one phone and its owner, and includes the accounts, saved Wi-Fi, paired devices, notifications, app-usage, log and network captures. Read its README before sharing it.'
    : 'The personal captures were left out. What remains still identifies the device, so treat it as personal.');
  box.appendChild(note);
  const open = el('button', 'small', 'Show the folder');
  open.addEventListener('click', () => window.sentinel.revealReport(lastReportFolder));
  box.appendChild(open);
});

// ---------- startup disclaimer (every launch) + environment check ----------
document.documentElement.dataset.platform = window.sentinel.platform || '';

async function envCheck() {
  const adbRow = $('env-adb'), phoneRow = $('env-phone');
  try {
    const { path } = await window.sentinel.locateAdb();
    adbRow.className = `env-row ${path ? 'ok' : 'bad'}`;
    adbRow.textContent = path
      ? `Android platform-tools found (${path})`
      : "adb not found — install Google's official platform-tools; the dashboard banner links to the download";
    const d = await window.sentinel.deviceSummary();
    phoneRow.className = `env-row ${d.state === 'device' ? 'ok' : d.state === 'unauthorized' || d.state === 'multiple' ? 'bad' : 'warn'}`;
    phoneRow.textContent = d.state === 'device'
      ? `Phone connected: ${d.manufacturer} ${d.model} (Android ${d.android})`
      : d.state === 'unauthorized'
        ? 'Phone found but unauthorized — accept the USB debugging prompt on its screen'
        : d.state === 'multiple'
          ? 'More than one phone attached — unplug one; Phone Checker talks to a single phone at a time'
          : 'No phone connected yet — you can continue and plug one in later';
  } catch {}
}
{
  const dModal = $('modal-disclaimer');
  // Shown once per app run: a window reload within the same run skips it,
  // a fresh launch asks again (sessionStorage dies with the app).
  let accepted = false;
  try { accepted = sessionStorage.getItem('disclaimerAccepted') === '1'; } catch {}
  if (accepted) dModal.classList.add('hidden');
  else {
    envCheck();
    const envTimer = setInterval(() => { dModal.classList.contains('hidden') ? clearInterval(envTimer) : envCheck(); }, 3000);
  }
  $('disclaimer-check').addEventListener('change', (e) => { $('disclaimer-accept').disabled = !e.target.checked; });
  $('disclaimer-accept').addEventListener('click', () => {
    try { sessionStorage.setItem('disclaimerAccepted', '1'); } catch {}
    dModal.classList.add('hidden');
  });
  $('disclaimer-quit').addEventListener('click', () => window.sentinel.confirmQuit());
}

// Shared by the quit checklist and the disconnect dialog: ask the main process
// to turn USB debugging off, then report what actually happened.
async function runUsbOff(btn, status, onDone) {
  if (!window.sentinel.disableUsbDebugging) {
    status.textContent = 'This running copy of the app predates the button — quit Phone Checker and start it again.';
    status.className = 'usb-bad';
    return;
  }
  btn.disabled = true;
  status.textContent = 'Waiting for the phone to disconnect…';
  status.className = 'muted';
  let r;
  try {
    r = await window.sentinel.disableUsbDebugging();
  } catch (err) {
    btn.disabled = false;
    status.textContent = `Could not turn it off: ${String((err && err.message) || err).slice(0, 160)}`;
    status.className = 'usb-bad';
    return;
  }
  if (r.cancelled) { btn.disabled = false; status.textContent = ''; return; }
  if (r.ok) { onDone(r.model); return; }
  btn.disabled = false;
  status.textContent = r.error || 'Could not turn it off.';
  status.className = 'usb-bad';
}

// ---------- disconnect ----------
function showDisconnected(text) {
  $('disc-main').classList.add('hidden');
  $('disc-done-text').textContent = text;
  $('disc-done').classList.remove('hidden');
}
{
  const dModal = $('modal-disconnect');
  const close = () => dModal.classList.add('hidden');
  $('conn-eject').addEventListener('click', async () => {
    firstRunDisconnected = true;
    const d = await window.sentinel.deviceSummary();
    const name = (d && d.state === 'device' && d.model) ? d.model : 'this phone';
    $('disc-model').textContent = name;
    $('disc-usb-model').textContent = name;
    $('disc-usb-off').disabled = false;
    $('disc-usb-status').textContent = '';
    $('disc-usb-status').className = 'muted';
    $('disc-done').classList.add('hidden');
    $('disc-main').classList.remove('hidden');
    dModal.classList.remove('hidden');
    if (!d || d.state !== 'device') {
      showDisconnected('No phone is connected any more. You can unplug the cable if it is still attached.');
    }
  });
  $('disc-usb-off').addEventListener('click', () => runUsbOff($('disc-usb-off'), $('disc-usb-status'),
    (model) => showDisconnected(`USB debugging is off and ${model} has dropped off the connection. You can unplug the cable now.`)));
  $('disc-close').addEventListener('click', close);
  $('disc-done-close').addEventListener('click', close);
  dModal.addEventListener('click', (e) => { if (e.target === dModal) close(); });
}

// ---------- quit checklist ----------
{
  const qModal = $('modal-quit');
  window.sentinel.onConfirmClose(async () => {
    $('quit-check').checked = false;
    $('quit-confirm').disabled = true;
    qModal.classList.remove('hidden');

    // Only offer the button for a phone that is actually here to act on.
    const row = $('usb-off-row'), status = $('usb-off-status');
    status.textContent = '';
    status.className = 'muted';
    const d = await window.sentinel.deviceSummary();
    if (d.state === 'device' && $('usb-off')) {
      $('usb-off-model').textContent = d.model || 'this phone';
      $('usb-off').disabled = false;
      row.classList.remove('hidden');
    } else if (!$('usb-off')) {
      row.classList.remove('hidden');        // already done — keep the confirmation visible
    } else {
      row.classList.add('hidden');
    }
  });
  $('quit-check').addEventListener('change', (e) => { $('quit-confirm').disabled = !e.target.checked; });

  // Turning USB debugging off is offered only while a phone is attached, and
  // only until it works — after that there is nothing left to press.
  $('usb-off').addEventListener('click', () => runUsbOff($('usb-off'), $('usb-off-status'), (model) => {
    $('usb-off').remove();
    const s = $('usb-off-status');
    s.textContent = `USB debugging is off — ${model} disconnected.`;
    s.className = 'usb-ok';
    const box = $('quit-check');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
  }));
  $('quit-cancel').addEventListener('click', () => qModal.classList.add('hidden'));
  $('quit-confirm').addEventListener('click', () => window.sentinel.confirmQuit());
}

// ---------- per-phone restore (launch + device switches) ----------
async function restoreLast() {
  let h = null;
  try { h = await window.sentinel.listHistory(); } catch {}
  drawTrend((h && h.history) || []);
  const connected = !!(h && h.storeDevice && h.connectedSerial === h.storeDevice.serial);
  lastDeviceLabel = setDeviceTag('cards-device', h && h.storeDevice, connected);
  const last = h && h.history && h.history[0];
  if (last) {
    setHero(last.counts, null, last.ts, true);
    showCards(true);
    lastRunTs = last.ts; lastDevice = null;
    renderCards(last.results, true, true);
    await refreshHeroCounts();
    setHeroNext(last.counts);
  } else {
    showCards(false);
    $('cards').innerHTML = '';
    drawDonut({ ok: 0, note: 0, flag: 0 });
    $('hero-title').textContent = 'Ready to check';
    $('hero-sub').textContent = 'Connect your phone and run the health checks.';
    $('checks-status').textContent = '';
    setHeroNext(null);
    await refreshHeroCounts();
    lastResults = null; lastRunTs = null; lastDevice = null;
  }
  renderFirstRun(!!(h && h.connectedSerial));
}

function onDeviceSwitched() {
  // A different phone (or none) is in front of us. Drop every cached per-phone
  // list so one phone's data is never shown under another's name, then reload
  // from the store that belongs to the phone actually connected.
  allProposals = []; selected = new Set(); syncApplyButton();
  $('proposals').innerHTML = '';
  $('advisor-tabs').classList.add('hidden');
  $('advisor-empty').classList.remove('hidden');
  $('advisor-status').textContent = '';
  $('select-recommended').classList.add('hidden');
  $('revert-all').classList.add('hidden');
  settingsRows = []; selectedSettings = new Set(); syncSettingsApply();
  $('settings-rows').innerHTML = '';
  $('settings-empty').classList.remove('hidden');
  $('settings-status').textContent = '';
  $('settings-revert').classList.add('hidden');
  $('settings-select-diff').classList.add('hidden');
  $('export-settings').classList.add('hidden');
  appsList = []; selectedApps = new Set(); batteryChangedCount = 0; disabledCount = 0; syncAppsActions();
  $('apps-rows').innerHTML = '';
  $('apps-empty').classList.remove('hidden');
  $('apps-status').textContent = '';
  $('export-apps').classList.add('hidden');
  $('apps-selall-wrap').classList.add('hidden');
  deviceDetailsCache = null;
  $('device-grid').classList.add('hidden');
  $('device-grid').innerHTML = '';
  $('export-device').classList.add('hidden');
  $('device-empty').classList.remove('hidden');
  permsData = null; permsTab = null; selectedPerms = new Set(); permsChangedCount = 0;
  $('perms-rows').innerHTML = '';
  $('perms-tabs').classList.add('hidden');
  $('perms-tabs').innerHTML = '';
  $('perms-empty').classList.remove('hidden');
  $('perms-status').textContent = '';
  $('export-perms').classList.add('hidden');
  termCats = null; termSerial = undefined;
  hwData = null; hwSerial = undefined; stopHwLive(); resetHwHistory();
  $('hw-grid').innerHTML = ''; $('hw-grid').classList.add('hidden');
  $('hw-skeleton').classList.add('hidden');
  $('hw-empty').classList.remove('hidden');
  $('hw-status').textContent = '';
  $('export-hardware').classList.add('hidden');
  $('export-hardware-png').classList.add('hidden');
  originsList = []; originsSerial = undefined; originsSessions = 0;
  $('origins-rows').innerHTML = '';
  $('origins-empty').classList.remove('hidden');
  $('origins-status').textContent = '';
  $('export-origins').classList.add('hidden');
  snapRows = []; lastSnapDiffMd = null;
  $('snap-diff-out').innerHTML = '';
  $('snap-diff-status').textContent = '';
  $('export-snapdiff').classList.add('hidden');
  diffHistory = []; lastDiffMd = null;
  $('diff-out').innerHTML = '';
  $('diff-panel').classList.add('hidden');
  $('export-diff').classList.add('hidden');
  restoreLast();
  const active = document.querySelector('.navitem.active');
  const view = active && active.dataset.view;
  if (view === 'history') loadHistory();
  else if (currentSerial && view === 'settings') loadSettings();
  else if (currentSerial && view === 'apps') loadApps();
  else if (currentSerial && view === 'device') loadDevice();
  else if (view === 'terminal') loadTerminal();
  else if (currentSerial && view === 'origins') loadOrigins(true);
  else if (currentSerial && view === 'hardware') loadHardware(true);
  else if (view === 'snapshots') loadSnapshots();
}

restoreLast();

// Reloading the window (Cmd/Ctrl+R) rebuilds the page from scratch, which would
// otherwise drop you back on the Dashboard. The open view is remembered for the
// life of the app run, so a reload comes back where you were; a fresh launch
// still starts on the Dashboard, because sessionStorage dies with the app.
{
  let last = null;
  try { last = sessionStorage.getItem('view'); } catch {}
  if (last && last !== 'dashboard' && document.querySelector(`.navitem[data-view="${last}"]`)) showView(last);
}
