// menu.test.js — the wiring between markup and renderer. app.js reaches for
// elements by id and by class, and nothing in a plain HTML page complains when
// one of those goes missing: the button simply stops working. These read both
// files and hold them to each other.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', p), 'utf8');
const html = read('index.html');
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
const js = read('app.js');
const css = read('style.css');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));

test('every element app.js asks for by id exists in the markup', () => {
  const missing = [...new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]))].filter(id => !ids.has(id));
  assert.deepEqual(missing, [], `app.js reaches for ${missing.join(', ')}, which the page does not contain`);
});

test('each action menu is one button holding the label span its code rewrites', () => {
  for (const id of ['perms-set', 'apps-battery-set']) {
    const tag = html.match(new RegExp(`<button id="${id}"[^>]*>.*?</button>`, 's'));
    assert.ok(tag, `${id} is missing from the page`);
    assert.match(tag[0], /class="[^"]*\bmenu-btn\b/, `${id} is not styled as a menu button`);
    // setMenuLabel() writes into .mb-label so the caret survives a relabel.
    assert.match(tag[0], /<span class="mb-label">/, `${id} has no label span to write into`);
    assert.match(tag[0], /<span class="mb-caret">/, `${id} has no caret`);
    assert.match(tag[0], /aria-haspopup="menu"/, `${id} does not announce its menu`);
  }
});

// The states an app can be in for one permission, and the three battery states,
// are offered together in a menu rather than as one header button each. A state
// that quietly stopped being offered would be invisible in the UI, so the rows
// are counted here.
test('the permission menu offers all three states, whichever list is on screen', () => {
  const body = js.slice(js.indexOf("$('perms-set').addEventListener"));
  const menu = body.slice(0, body.indexOf('\n});'));
  for (const label of ['Allow', 'Ask each time', "Don't allow"]) {
    assert.ok(menu.includes(`label: '${label}'`) || menu.includes(`label: "${label}"`), `${label} is not offered`);
  }
  // Android has no ask-each-time for the special-access permissions; the row has
  // to say so rather than disappear and change the menu's shape.
  assert.match(menu, /disabled: !runtime/);
});

test('the battery menu offers the same three states Android does', () => {
  const body = js.slice(js.indexOf("$('apps-battery-set').addEventListener"));
  const menu = body.slice(0, body.indexOf('\n});'));
  for (const label of ['Restricted', 'Optimized', 'Unrestricted']) {
    assert.ok(menu.includes(`label: '${label}'`), `${label} is not offered`);
  }
  // A selection can straddle two states; nothing is ticked unless they agree.
  assert.match(menu, /states\.size === 1/);
});

// "danger" and "primary" are filled buttons everywhere else in the app. A menu
// row that borrowed one of those names would come out as a solid block of
// colour with its own text unreadable on top, which is how this test came to be.
test('menu rows tint themselves and never borrow a filled-button class', () => {
  const tones = [...js.matchAll(/tone: '([^']+)'/g)].map(m => m[1]);
  assert.ok(tones.length, 'no menu row carries a tone any more');
  for (const t of tones) {
    assert.match(t, /^mi-/, `tone "${t}" collides with a global button style`);
    assert.ok(css.includes(`.menu-item.${t}`), `tone "${t}" has no rule in style.css`);
  }
});

// The pills above the list filter it; the menu in the header changes state. They
// once used the same three words, which put "Ask each time" on screen twice
// meaning two different things. The pills describe the apps they list now, and
// nothing in one vocabulary may reappear in the other.
test('the list filter and the state menu do not share wording', () => {
  const views = js.slice(js.indexOf('const PERM_VIEWS = ['));
  const pills = [...views.slice(0, views.indexOf(']')).matchAll(/label: '([^']+)'/g)].map(m => m[1]);
  assert.equal(pills.length, 3, 'expected three filter pills');

  const body = js.slice(js.indexOf("$('perms-set').addEventListener"));
  const menu = body.slice(0, body.indexOf('\n});'));
  const actions = [...menu.matchAll(/label: ['"]([^'"]+)['"]/g)].map(m => m[1]);

  const norm = (t) => t.toLowerCase().replace(/[^a-z ]/g, '');
  const clash = pills.filter(p => actions.some(a => norm(a) === norm(p)));
  assert.deepEqual(clash, [], `${clash.join(', ')} names both a filter and an action`);
});

test('the filter row says it is a filter', () => {
  assert.match(js, /perm-views-label/, 'the pill row has no label marking it as a filter');
  assert.match(css, /\.perm-views-label\s*\{/, 'the filter label has no style');
});

// A screen that changes something must offer the way back on the same screen.
// Disabling an app used to be reversible only from History or the advisor, while
// the button next to "Disable selected…" said "Undo battery changes" and covered
// battery states alone — so the undo that was there looked like the undo for
// everything, and was not.
test('the apps screen can reverse both of the changes it makes', () => {
  for (const id of ['apps-enable-all', 'apps-battery-revert']) {
    assert.ok(ids.has(id), `${id} is missing from the page`);
  }
  assert.match(js, /\$\('apps-enable-all'\)\.addEventListener/, 'the disables undo is not wired up');
  assert.match(js, /revertAll\(\)/, 'the disables undo does not go through the confirmed revert');
  // Each disabled row carries its own way back, so a single app needs no bulk undo.
  const row = js.slice(js.indexOf('function appRow('));
  assert.match(row.slice(0, row.indexOf('\nfunction ')), /if \(canEnable\(a\)\) \{[\s\S]*?enablePackage/,
    'a disabled row has no Enable button, or offers one it cannot honour');
});

test('the apps view tip does not send people elsewhere to undo a disable', () => {
  const tip = html.slice(html.indexOf('id="view-apps"'));
  assert.doesNotMatch(tip.slice(0, tip.indexOf('</div>')), /disables are reversible from History/);
});

// Turning apps back on in bulk writes to the phone, so it goes through the same
// confirm-first path every other write uses, and is reachable from the renderer.
test('the bulk enable asks before it writes, and is exposed to the renderer', () => {
  const i = main.indexOf("ipcMain.handle('proposals:enableMany'");
  assert.ok(i > 0, 'there is no bulk enable handler');
  const body = main.slice(i, main.indexOf('\n});', i));
  assert.match(body, /validPkg/, 'package names are not validated');
  assert.ok(body.indexOf('showMessageBox') < body.indexOf('pm enable'),
    'it runs pm enable before asking');
  assert.match(body, /if \(response !== 1\) return \{ cancelled: true \}/, 'Cancel does not stop it');
  assert.match(preload, /enablePackages:.*proposals:enableMany/, 'the renderer cannot reach it');
});

// Whole-list revert can assign the failures straight back, because it tried
// everything. A selective enable must not: packages it never touched are still
// disabled and must stay on the undo list.
test('a selective enable only drops what actually came back on', () => {
  const i = main.indexOf("ipcMain.handle('proposals:enableMany'");
  const body = main.slice(i, main.indexOf('\n});', i));
  assert.match(body, /store\.disabledByApp = \(store\.disabledByApp \|\| \[\]\)\.filter\(p => !done\.includes\(p\)\)/,
    'it overwrites the undo list instead of pruning it');
});

test('the apps screen pairs enable with disable on the same selection', () => {
  assert.ok(ids.has('apps-enable'), 'there is no bulk enable button');
  // It counts the disabled apps in the selection, not the selection itself, so a
  // mixed selection says how many it would actually switch on.
  assert.match(js, /const offCount = chosenApps\.filter\(canEnable\)\.length/);
  assert.match(js, /Enable \$\{offCount\} selected/);
  const h = js.slice(js.indexOf("$('apps-enable').addEventListener"));
  assert.match(h.slice(0, h.indexOf('\n});')), /selectedApps\.has\(a\.pkg\) && canEnable\(a\)/,
    'it sends apps it cannot actually switch on');
});

// Android has several ways to switch an app off and only one of them is
// reversible over adb. Flattening them into a boolean is what put an Enable
// button on hibernating apps, which answered every press with a SecurityException
// while the UI reported success.
test('the apps list carries the real enabled state, not just off-or-not', () => {
  const checks = fs.readFileSync(path.join(__dirname, '..', 'src', 'checks.js'), 'utf8');
  assert.match(checks, /async function enabledStates\(/, 'nothing reads the per-package state');
  assert.match(checks, /enabled=\(\\d\+\)/, 'the state is not parsed out of the package records');
  const list = checks.slice(checks.indexOf('async function listAllApps('));
  assert.match(list.slice(0, list.indexOf('\n}')), /enabledStates\(\)/,
    'the apps list does not read the state');
  assert.match(list.slice(0, list.indexOf('\n}')), /enabled: states\[pkg\]/,
    'the state never reaches the renderer');
});

// Android lets the shell move a package only between DEFAULT (0), ENABLED (1)
// and DISABLED_USER (3), and only when it already sits in one of those. From
// DISABLED (2) or DISABLED_UNTIL_USED (4) it refuses BOTH directions — an app
// the phone put to sleep can no more be disabled than switched on. Gating only
// the enable side is the bug this pins down.
test('the shell-movable states are the three Android actually allows', () => {
  assert.match(js, /const SHELL_STATES = new Set\(\[0, 1, 3\]\)/,
    'the movable set no longer matches what Android permits');
  assert.match(js, /const shellCanSwitch = \(a\) => a\.enabled === undefined \|\| SHELL_STATES\.has\(a\.enabled\)/,
    'an unreadable state must fall back to movable, not block everything');
});

test('both directions are gated by that same rule, not just enable', () => {
  assert.match(js, /const canEnable = \(a\) => !!a\.disabled && shellCanSwitch\(a\)/,
    'enable is not gated on what the shell can move');
  assert.match(js, /const canDisable = \(a\) => !a\.disabled && shellCanSwitch\(a\)/,
    'disable is not gated — it will offer a button Android refuses');
  assert.match(js, /const onCount = chosenApps\.filter\(canDisable\)\.length/,
    'the disable button counts the whole selection again');
  assert.match(js, /Disable \$\{onCount\} selected/);
  const h = js.slice(js.indexOf("$('apps-disable').addEventListener"));
  assert.match(h.slice(0, h.indexOf('\n});')), /selectedApps\.has\(a\.pkg\) && canDisable\(a\)/,
    'it sends apps Android will refuse to disable');
});

test('every off-state explains itself on the row', () => {
  const map = js.slice(js.indexOf('const OFF_STATE = {'), js.indexOf('const SHELL_STATES'));
  for (const state of [2, 3, 4]) {
    assert.match(map, new RegExp(`\\b${state}: \\{ chip: '`), `state ${state} has no chip of its own`);
  }
  assert.match(map, /why:/, 'the chips carry no explanation');
});

// A refused write must never pass in silence: before this, a failed bulk disable
// reported nothing at all and the rows simply stayed as they were.
test('a refused disable is reported, with Android\'s reason', () => {
  const h = js.slice(js.indexOf("$('apps-disable').addEventListener"));
  const body = h.slice(0, h.indexOf('\n});'));
  assert.match(body, /res\.failed/, 'the disable path ignores failures');
  assert.match(body, /androidWhy\(failed\[0\]\)/, 'it does not say why');
  const i = main.indexOf("ipcMain.handle('proposals:disable'");
  assert.match(main.slice(i, main.indexOf('\n});', i)), /failed\.push\(\{ pkg: p, out:/,
    'the disable handler throws the reason away');
});

// Reporting a change that did not happen is worse than reporting nothing: pm
// refuses inside its own output rather than by failing the adb call.
test('an enable that Android refused is not reported as a success', () => {
  const row = js.slice(js.indexOf('function appRow('));
  const body = row.slice(0, row.indexOf('\nfunction '));
  assert.match(body, /if \(!res \|\| !res\.ok\)/, 'the row button assumes the enable worked');
  assert.ok(body.indexOf('!res.ok') < body.indexOf('switched back on'),
    'it announces success before checking the reply');
  assert.match(js, /function androidWhy\(/, 'nothing surfaces what Android said');
  const i = main.indexOf("ipcMain.handle('proposals:enableMany'");
  assert.match(main.slice(i, main.indexOf('\n});', i)), /failed\.push\(\{ pkg: p, out:/,
    'the failure reason is thrown away before it reaches the UI');
});


// The fallback for an unreadable state is "treat it as changeable", which is
// right but is also exactly what the broken build did. It must be visible.
test('a failed state read announces itself instead of looking normal', () => {
  const h = js.slice(js.indexOf('async function loadApps('));
  const body = h.slice(0, h.indexOf('\n}'));
  assert.match(body, /a\.enabled !== undefined/, 'nothing checks whether states were read');
  assert.match(body, /could not read how apps are switched off/, 'a failed read is silent');
});

// This warning went out once written in implementation terms — "in a state adb
// cannot change in either direction" — which told the reader nothing they could
// act on. What the user needs is which apps, why the phone is holding them, and
// where to go instead.
test('the stuck-apps warning is written for the person reading it', () => {
  const fn = js.slice(js.indexOf('function stuckHint('), js.indexOf('function appRow('));
  const copy = [...fn.matchAll(/[`']([^`']{25,})[`']/g)].map(m => m[1]).join(' ');
  assert.ok(copy.length > 80, 'the warning has no prose left to check');
  for (const jargon of [/\badb\b/i, /SecurityException/, /component state/i, /DISABLED_/, /\bpm\b enable/i]) {
    assert.doesNotMatch(copy, jargon, `the warning leaks "${jargon}" at the reader`);
  }
  // It has to point somewhere, since nothing in this app can move these apps.
  assert.match(copy, /Settings/, 'the warning never says where the fix actually is');
  // Naming the apps beats counting them, until there are too many to name.
  assert.match(fn, /appLabel\(a\.pkg, a\.known\)/, 'it counts apps instead of naming them');
  // One app must not be told to "open them".
  assert.match(fn, /one \? 'it' : 'them'/, 'the pronoun does not follow the count');
  assert.match(fn, /one \? 'is' : 'are'/);
  assert.match(fn, /one \? 'was' : 'were'/);
});

test('the row tooltips speak the same way', () => {
  const map = js.slice(js.indexOf('const OFF_STATE = {'), js.indexOf('const SHELL_STATES'));
  for (const jargon of [/\badb\b/i, /Android refuses/, /user level ---/]) {
    assert.doesNotMatch(map, jargon, `a tooltip leaks "${jargon}"`);
  }
  assert.match(map, /Settings/, 'the immovable states never say what does move them');
});

// Hardware, Console and Terminal used to fold away behind an "Advanced" heading.
// They are ordinary destinations now, listed under History like everything else.
test('the sidebar is one flat list, with no collapsed group left behind', () => {
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  const order = [...nav.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(order.slice(order.indexOf('history')), ['history', 'hardware', 'console', 'terminal', 'about'],
    'the promoted views are not sitting under History');
  for (const dead of ['nav-advanced', 'nav-group', 'nav-caret', 'nav-group-items']) {
    assert.doesNotMatch(nav, new RegExp(dead), `${dead} survives in the markup`);
    assert.doesNotMatch(js, new RegExp(dead), `${dead} survives in the renderer`);
    assert.doesNotMatch(css, new RegExp('\\' + `.${dead}\\b`), `${dead} survives in the stylesheet`);
  }
  // Every nav child is a destination now, so none of them starts out hidden.
  assert.doesNotMatch(nav, /class="navitem[^"]*hidden/, 'a nav item is hidden at rest');
});

// Check runs and Changes made grow at completely different rates. Side by side
// in one grid, the longer one set the page height and the shorter one scrolled
// away with it past an empty column, so they take turns instead.
test('the two history lists take turns rather than sharing a page', () => {
  for (const id of ['hist-tabs', 'hist-runs', 'hist-actions', 'hc-runs', 'hc-actions', 'hist-tip']) {
    assert.ok(ids.has(id), `${id} is missing from the page`);
  }
  // Only one starts visible; the tab switch owns the other.
  const view = html.slice(html.indexOf('id="view-history"'), html.indexOf('</section>', html.indexOf('id="view-history"')));
  assert.match(view, /<div id="hist-actions" class="hidden">/, 'both lists render at once again');
  assert.doesNotMatch(view, /grid-template-columns/, 'the view reintroduced a column layout inline');
  assert.match(css, /\.hist-grid \{ display: grid; grid-template-columns: 1fr;/,
    'the history grid is back to two columns');
  assert.match(js, /function showHistTab\(which\)/, 'nothing switches between them');
});

test('each history tab carries its own count and its own explanation', () => {
  assert.match(js, /\$\('hc-runs'\)\.textContent = String\(res\.history\.length\)/);
  assert.match(js, /\$\('hc-actions'\)\.textContent = String\(res\.actions\.length\)/);
  // One tip for two lists means it has to follow the tab.
  assert.match(js, /HIST_TIP = \{/, 'the tip no longer changes with the tab');
  for (const k of ['runs:', 'actions:']) assert.match(js, new RegExp(`\\b${k}`), `no tip for ${k}`);
  assert.match(js, /\$\('hist-tip'\)\.dataset\.tip = HIST_TIP\[which\]/);
});

// The changes list renders only the 80 most recent. With a total on the tab, a
// silent cap would have the badge promising rows the list does not contain.
test('a capped changes list admits to being capped', () => {
  const fn = js.slice(js.indexOf('async function loadHistory('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /res\.actions\.slice\(0, 80\)/, 'the cap moved and this test is stale');
  assert.match(body, /Showing the 80 most recent of \$\{res\.actions\.length\}/,
    'the list is capped without saying so, while the tab shows the full count');
});

// Reading packages off a phone takes a second or more, and the state during it
// used to be an unchanged list with a full-stop-sized spinner in the toolbar.
// Every list view raises placeholders shaped like its rows instead.
test('every list view shows placeholders while it reads the phone', () => {
  assert.match(js, /function skeletonRows\(id, emptyId, n = \d+\)/, 'the placeholder helper is gone');
  assert.match(js, /setAttribute\('aria-busy', 'true'\)/, 'loading is not announced to a screen reader');
  const wanted = [
    ["skeletonRows('apps-rows', 'apps-empty')", 'apps'],
    ["skeletonRows('perms-rows', 'perms-empty')", 'permissions'],
    ["skeletonRows('settings-rows', 'settings-empty')", 'phone settings'],
    ["skeletonRows('proposals', 'advisor-empty')", 'debloat advisor'],
    ["skeletonRows('origins-rows', 'origins-empty')", 'install origins'],
  ];
  for (const [call, name] of wanted) {
    assert.ok(js.includes(call), `the ${name} list loads with no placeholders`);
  }
  assert.match(css, /\.sk-row \{/, 'the placeholder row has no style');
});

// Placeholders that outlive the read are worse than none: the view looks stuck
// for good. Every path out of a load has to take them down — the success path
// included, where rendering wipes the rows but left the busy flag raised.
test('placeholders come down on every path out of a load', () => {
  for (const fn of ['loadApps', 'loadPerms', 'loadSettings', 'loadProposals', 'loadOrigins']) {
    const i = js.indexOf('async function ' + fn + '(');
    assert.ok(i > 0, `${fn} is missing`);
    const body = js.slice(i, js.indexOf('\n}', i));
    const raised = (body.match(/skeletonRows\(/g) || []).length;
    const cleared = (body.match(/clearSkeleton\(/g) || []).length;
    assert.equal(raised, 1, `${fn} raises placeholders ${raised} times`);
    // One per early return, plus one on the success path.
    const returns = (body.match(/\breturn;/g) || []).length - 1;   // the adb guard runs before any are raised
    assert.ok(cleared >= returns, `${fn} has ${returns} exits but clears placeholders only ${cleared} times`);
    assert.ok(cleared >= 2, `${fn} never clears them on the success path`);
  }
  assert.match(js, /removeAttribute\('aria-busy'\)/, 'the busy flag is raised and never lowered');
});

// The advisor lists the same packages the Apps view does and offers the same
// Enable, so it needs the same knowledge of why an app is off. It used to see a
// boolean, put Enable on a preload the system had switched off, then reload the
// list and leave the row exactly as it was with nothing said.
test('the advisor reads real package states, like the apps view', () => {
  const checks = fs.readFileSync(path.join(__dirname, '..', 'src', 'checks.js'), 'utf8');
  const fn = checks.slice(checks.indexOf('async function buildProposals('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /await enabledStates\(\)/, 'the advisor still works from a yes-or-no answer');
  assert.match(body, /enabled: states\[pkg\]/, 'the state never reaches the renderer');
});

test('the advisor offers Enable only where it works, and reports refusals', () => {
  const fn = js.slice(js.indexOf('function proposalRow('));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  assert.match(body, /if \(canEnable\(asApp\(p\)\)\)/, 'Enable is offered on state alone again');
  assert.match(body, /if \(!res \|\| !res\.ok\)/, 'a refused enable is assumed to have worked');
  assert.ok(body.indexOf('!res.ok') < body.indexOf('loadProposals()'),
    'it reloads before checking whether anything changed');
  // Both screens read the same table, so they cannot describe a state differently.
  assert.match(js, /const asApp = \(p\) => \(\{ disabled: p\.state === 'disabled', enabled: p\.enabled \}\)/);
  assert.match(body, /offState\(asApp\(p\)\)/, 'the advisor describes states from its own table');
});
