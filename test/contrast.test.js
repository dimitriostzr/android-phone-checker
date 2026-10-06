// contrast.test.js — the palette, measured. Every colour in the app is a token in
// style.css, and every tint is a color-mix() over those tokens, so the ratios can
// be computed from the stylesheet itself rather than eyeballed in a screenshot.
// This resolves the tokens for both themes and holds them to WCAG 2.1 AA: 4.5:1
// for text, 3:1 for the graphical indicators that are not text.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf8');

function blockAfter(selector) {
  const i = css.indexOf(selector);
  assert.ok(i >= 0, `style.css no longer contains the block "${selector}"`);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
}
function tokensIn(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}
const base = tokensIn(blockAfter(':root {'));
const shared = tokensIn(blockAfter(':root, :root[data-theme="dark"] {'));
const LIGHT = { ...base, ...shared };
const DARK = { ...base, ...tokensIn(blockAfter(':root[data-theme="dark"] {')), ...shared };

function fromHex(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
}
// Enough of the CSS colour grammar to cover what the tokens actually use:
// a hex literal, a var() reference, and a two-colour srgb color-mix whose
// percentage may itself be a token.
function resolve(value, map, depth = 0) {
  assert.ok(depth < 10, `token cycle while resolving ${value}`);
  const v = String(value).trim();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (v.startsWith('#')) return fromHex(v);
  const ref = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (ref) {
    assert.ok(map[ref[1]] !== undefined, `unknown token ${ref[1]}`);
    return resolve(map[ref[1]], map, depth + 1);
  }
  const mix = v.match(/^color-mix\(in srgb,\s*(.+?)\s+(var\(--[a-z0-9-]+\)|[\d.]+%)\s*,\s*(.+)\)$/i);
  assert.ok(mix, `cannot resolve colour: ${v}`);
  const pctRaw = mix[2].startsWith('var(') ? map[mix[2].slice(4, -1)] : mix[2];
  const p = parseFloat(pctRaw) / 100;
  const A = resolve(mix[1], map, depth + 1), B = resolve(mix[3], map, depth + 1);
  // CSS mixes in premultiplied alpha and un-premultiplies the result, which is why
  // "colour 13%, transparent" is that colour at 13% opacity rather than a colour
  // already faded 87% toward black. Doing it any other way double-counts the tint.
  const a = A.a * p + B.a * (1 - p);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const ch = (k) => (A[k] * A.a * p + B[k] * B.a * (1 - p)) / a;
  return { r: ch('r'), g: ch('g'), b: ch('b'), a };
}
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
function luminance(c) {
  const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(fgTok, bgTok, map, viaTok) {
  // Tinted backgrounds are translucent, so they composite over the surface they sit on.
  let bg = resolve(map[bgTok], map);
  if (bg.a < 1) bg = over(bg, resolve(map[viaTok || '--panel'], map));
  const fg = over(resolve(map[fgTok], map), bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = [['light', LIGHT], ['dark', DARK]];
const SURFACES = ['--bg', '--panel', '--panel2', '--sidebar-bg'];
// AA for normal-size text. The app has no large-text-only colour.
const AA_TEXT = 4.5;
// AA for a graphical object that carries meaning but is not text (1.4.11).
const AA_NONTEXT = 3;

test('the stylesheet still exposes the three token blocks this test reads', () => {
  for (const t of ['--text', '--muted', '--faint', '--accent', '--panel', '--bg']) {
    assert.ok(LIGHT[t], `light theme lost ${t}`);
    assert.ok(DARK[t], `dark theme lost ${t}`);
  }
  assert.notEqual(LIGHT['--text'], DARK['--text'], 'both themes resolved to the same palette');
});

test('body, secondary and tertiary text clear AA on every surface, in both themes', () => {
  for (const [name, map] of THEMES) {
    for (const fg of ['--text', '--muted', '--faint']) {
      for (const bg of SURFACES) {
        const r = contrast(fg, bg, map);
        assert.ok(r >= AA_TEXT, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${AA_TEXT}`);
      }
    }
  }
});

test('link and accent text clears AA on every surface, in both themes', () => {
  for (const [name, map] of THEMES) {
    for (const fg of ['--accent', '--accent-2']) {
      for (const bg of SURFACES) {
        const r = contrast(fg, bg, map);
        assert.ok(r >= AA_TEXT, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${AA_TEXT}`);
      }
    }
  }
});

test('the text hierarchy stays a hierarchy — muted darker than faint, faint lighter than body', () => {
  for (const [name, map] of THEMES) {
    const on = (t) => contrast(t, '--panel', map);
    assert.ok(on('--text') > on('--muted'), `${name}: body text is no longer the strongest`);
    assert.ok(on('--muted') > on('--faint'), `${name}: muted and faint have collapsed or swapped`);
  }
});

test('every chip label clears AA on its own tinted background', () => {
  const chips = [
    ['--chip-rec-fg', '--chip-rec-bg'], ['--chip-opt-fg', '--chip-opt-bg'],
    ['--chip-caution-fg', '--chip-caution-bg'], ['--chip-keep-fg', '--chip-keep-bg'],
    ['--chip-en-fg', '--chip-en-bg'], ['--chip-priv-fg', '--chip-priv-bg'],
    ['--badge-dis-fg', '--badge-dis-bg'],
  ];
  for (const [name, map] of THEMES) {
    for (const [fg, bg] of chips) {
      const r = contrast(fg, bg, map);
      assert.ok(r >= AA_TEXT, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${AA_TEXT}`);
    }
  }
});

test('the status glyph is readable on its own dot, in both themes', () => {
  // app.js draws the dot in the status colour and the glyph inside it in --panel.
  for (const [name, map] of THEMES) {
    for (const dot of ['--ok', '--flag', '--note', '--info', '--muted']) {
      const r = contrast('--panel', dot, map);
      assert.ok(r >= AA_NONTEXT, `${name}: the glyph on the ${dot} dot is ${r.toFixed(2)}:1, needs ${AA_NONTEXT}`);
    }
  }
});

test('a status colour is distinguishable from the surface it marks', () => {
  // Card edges, dots and legend swatches are non-text indicators.
  for (const [name, map] of THEMES) {
    for (const c of ['--ok', '--flag', '--note', '--info']) {
      for (const bg of ['--panel', '--panel2']) {
        const r = contrast(c, bg, map);
        assert.ok(r >= AA_NONTEXT, `${name}: ${c} on ${bg} is ${r.toFixed(2)}:1, needs ${AA_NONTEXT}`);
      }
    }
  }
});

test('the tinted status row backgrounds keep body text readable', () => {
  for (const [name, map] of THEMES) {
    for (const row of ['--flag-row-bg', '--note-row-bg', '--info-row-bg', '--ok-row-bg']) {
      const r = contrast('--text', row, map);
      assert.ok(r >= AA_TEXT, `${name}: --text on ${row} is ${r.toFixed(2)}:1, needs ${AA_TEXT}`);
    }
  }
});
