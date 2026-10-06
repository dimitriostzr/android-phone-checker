// disclaimer.test.js — the startup notice, which is the one screen every user
// sees before anything else and the only place some of them will read what this
// app can do. Its parts are easy to lose in a refactor and nothing at runtime
// notices: the page still opens, the box still ticks, and the warning it was
// meant to carry is gone. These hold the notice to what it promises.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', p), 'utf8');
const html = read('index.html');
const js = read('app.js');
const css = read('style.css');

// The modal, from its opening tag to the close of its backdrop.
const modal = (() => {
  const i = html.indexOf('<div id="modal-disclaimer"');
  assert.ok(i > 0, 'the startup notice is gone from the page');
  return html.slice(i, html.indexOf('<!-- ============ QUIT CHECKLIST'));
})();

test('it opens with the app rather than hidden behind a button', () => {
  const tag = modal.slice(0, modal.indexOf('>'));
  assert.doesNotMatch(tag, /\bhidden\b/, 'the notice starts hidden, so nobody reads it');
  assert.match(modal, /role="dialog"[^>]*aria-modal="true"/, 'it is not announced as a modal dialog');
});

test('it says the risk is the user\'s, in its own callout', () => {
  const box = modal.match(/<div class="callout callout-risk">.*?<\/div>/s);
  assert.ok(box, 'the use-at-your-own-risk callout is gone');
  assert.match(box[0], /at your own risk/i);
  assert.match(box[0], /without warranty/i);
  assert.match(box[0], /your responsibility/i);
});

test('it tells the user to back up the phone first', () => {
  const box = modal.match(/<div class="callout callout-backup">.*?<\/div>\s*<\/div>/s);
  assert.ok(box, 'the backup callout is gone');
  assert.match(box[0], /back up your phone first/i, 'the callout no longer leads with the advice');
  assert.match(box[0], /full backup/i);
});

test('it names what the app is not affiliated with, and whose the trademarks are', () => {
  assert.match(modal, /not affiliated with, endorsed by,\s*\n?\s*or sponsored by/i);
  assert.match(modal, /trademark/i, 'the trademark line is gone');
});

test('Continue stays disabled until the acceptance box is ticked', () => {
  assert.match(modal, /<button id="disclaimer-accept"[^>]*\bdisabled\b/, 'Continue ships enabled');
  const label = modal.match(/<label class="check-label big">.*?<\/label>/s);
  assert.ok(label, 'the acceptance checkbox is gone');
  assert.match(label[0], /id="disclaimer-check"/);
  assert.match(label[0], /at my own risk/i, 'the box no longer says what is being accepted');
  assert.match(label[0], /backup/i, 'the box no longer mentions the backup');
  // A <b> inside this flex label becomes its own flex item unless the text is
  // wrapped, which breaks the sentence into columns.
  assert.match(label[0], /<span>.*<\/span>/s, 'the label text is not wrapped, so bold text breaks the layout');

  assert.match(js, /disclaimer-check'\)\.addEventListener\('change'/, 'nothing watches the checkbox');
  assert.match(js, /\$\('disclaimer-accept'\)\.disabled = !e\.target\.checked/, 'the checkbox no longer gates Continue');
});

test('the notice is asked again on every launch, not remembered forever', () => {
  // sessionStorage dies with the app, so a fresh launch always asks again; a
  // reload inside the same run does not.
  assert.match(js, /sessionStorage\.getItem\('disclaimerAccepted'\)/);
  assert.doesNotMatch(js, /localStorage\.(get|set)Item\('disclaimerAccepted'/, 'acceptance is remembered across launches');
});

test('the notice scrolls its text, never its buttons', () => {
  // The notice is taller than the shortest window the app allows (600px), so
  // Continue has to stay pinned or it sits below the fold.
  assert.match(modal, /<div class="modal modal-tall"/, 'the notice no longer uses the pinned layout');
  assert.match(modal, /<div class="modal-body">/, 'the notice has no scrolling body');
  assert.match(css, /\.modal\.modal-tall \{[^}]*display: flex[^}]*flex-direction: column/, 'modal-tall is not a flex column');
  assert.match(css, /\.modal-tall \.modal-body \{[^}]*overflow-y: auto/, 'the body does not scroll');
  // The checkbox and the actions must sit outside the scrolling body.
  const body = modal.slice(modal.indexOf('<div class="modal-body">'));
  const bodyEnd = body.indexOf('<label class="check-label big">');
  assert.ok(bodyEnd > 0, 'the checkbox no longer follows the body');
  assert.ok(!body.slice(0, bodyEnd).includes('disclaimer-accept'), 'Continue is inside the scrolling area');
});

// The same three promises are made again in About, where a user goes looking for
// them after the startup notice is gone. Both places have to keep saying it.
const about = (() => {
  const i = html.indexOf('<section id="view-about"');
  assert.ok(i > 0, 'the About view is gone from the page');
  return html.slice(i, html.indexOf('</section>', i));
})();

test('About names the trademark owners rather than gesturing at them', () => {
  for (const owner of ['Google LLC', 'Samsung Electronics Co., Ltd.']) {
    assert.ok(about.includes(owner), `About no longer names ${owner} as a trademark owner`);
  }
  assert.match(about, /Android and Google Play are trademarks/);
  assert.match(about, /trademark of its respective owner/, 'the catch-all for everyone else is gone');
});

test('About says who the project is not affiliated with, by name', () => {
  assert.match(about, /not\s*\n?\s*affiliated with, endorsed by, or sponsored by Google, Samsung/);
  assert.match(about, /Use at your own risk/, 'About no longer states the risk is the user\'s');
  assert.match(about, /without warranty of any kind/);
});

test('the startup notice and About agree on the trademark owners', () => {
  // Both are hand-wrapped markup, so compare on the text rather than the lines.
  const flat = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  for (const owner of ['Google LLC', 'Samsung Electronics Co., Ltd.']) {
    assert.ok(flat(modal).includes(owner), `the startup notice no longer names ${owner}`);
  }
});
