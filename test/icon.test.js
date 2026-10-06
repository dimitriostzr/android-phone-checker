// icon.test.js — the app's mark, in the two places it is drawn. The dock icon is
// built from build/icon.svg and the sidebar draws its own inline SVG, so nothing
// stops the two from drifting into different logos over time; that had already
// happened once (a shield badge in the dock, a bare check in the sidebar). These
// hold both to one set of paths.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const svg = read('build/icon.svg');
const html = read('src/renderer/index.html');
const css = read('src/renderer/style.css');

const paths = (s) => [...s.matchAll(/\sd="([^"]+)"/g)].map(m => m[1].replace(/\s+/g, ' ').trim());
const logo = html.match(/<div class="logo">(.*?)<\/div>/s);

test('the sidebar logo and the app icon draw the same mark', () => {
  assert.ok(logo, 'the sidebar has no logo mark');
  const inSidebar = paths(logo[1]);
  const inIcon = paths(svg);
  assert.ok(inSidebar.length >= 2, 'the sidebar mark has too few paths to be the logo');
  assert.deepEqual(inSidebar, inIcon, 'the two marks have drifted apart');
});

test('both draw it in the same 24-unit box, so the shapes match at any size', () => {
  assert.match(logo[1], /viewBox="0 0 24 24"/, 'the sidebar mark left the 24-unit box');
  // The icon scales the same coordinates up rather than restating them.
  assert.match(svg, /<g transform="translate\([\d.\s-]+\) scale\([\d.]+\)"/,
    'the icon no longer scales the shared geometry');
  const weight = /stroke-width="1\.9"/;
  assert.match(logo[1], weight, 'the sidebar mark changed stroke weight');
  assert.match(svg, weight, 'the icon changed stroke weight');
});

test('the logo tile and the icon tile use the same fixed gradient', () => {
  const tileGrad = svg.match(/<linearGradient id="tile"[\s\S]*?<\/linearGradient>/);
  assert.ok(tileGrad, 'the icon has no tile gradient');
  const stops = [...tileGrad[0].matchAll(/stop-color="(#[0-9a-f]{6})"/g)].map(m => m[1]);
  const [from, to] = stops;
  assert.ok(from && to, 'the icon tile has no gradient stops');
  const tile = css.match(/\.logo \{[^}]*background: linear-gradient\(135deg, ([^)]+)\)/);
  assert.ok(tile, 'the sidebar tile has no gradient');
  assert.equal(tile[1].replace(/\s/g, ''), `${from},${to}`,
    'the sidebar tile and the app icon no longer share a gradient');
  // A brand mark must not follow the user's accent setting: the dock icon can't.
  assert.doesNotMatch(tile[1], /var\(--accent/, 'the logo tile follows the themable accent again');
});

// Asked for as a dark grey ground with a white mark: a tinted or light ground
// would be a different icon, and the mark has to stay legible on it.
test('the icon ground is a dark, untinted grey', () => {
  const tileGrad = svg.match(/<linearGradient id="tile"[\s\S]*?<\/linearGradient>/)[0];
  const stops = [...tileGrad.matchAll(/stop-color="#([0-9a-f]{6})"/g)].map(m => m[1]);
  assert.equal(stops.length, 2, 'the ground is no longer a two-stop gradient');
  for (const hex of stops) {
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 10, `#${hex} is tinted, not grey`);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    assert.ok(lum < 110, `#${hex} is too light to be a dark ground`);
  }
  assert.match(svg, /stroke="#fff"/, 'the mark is not white');
});
