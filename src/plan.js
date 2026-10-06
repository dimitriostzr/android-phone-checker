// plan.js — the decision layer between "the user clicked apply" and "a command runs".
// Every modifying IPC handler in main.js asks a function here what should happen:
// which items are refused outright, which run, and which need a second, separate
// confirmation before they do. Nothing here touches the device, the per-device
// store or a dialog, so the rules that matter most — keep-tier refusal, the
// caution/system/trade-off second consent, package-name validation, what a
// "skip the risky ones" answer leaves behind — are testable without Electron
// and without a phone.
'use strict';

// A package name is the only externally-sourced string the handlers splice into a
// device shell command, so every plan validates it — including names coming back
// out of the per-device store, which older versions saved unvalidated.
const PKG_RE = /^[A-Za-z][A-Za-z0-9_.]*$/;
const PERM_RE = /^[A-Za-z][A-Za-z0-9_.]*$/;
const OP_RE = /^[A-Z][A-Z0-9_]*$/;
// Namespace, key and saved value all come back out of the store and get spliced
// into a device shell command, so a revert validates each before executing.
const NS_RE = /^(global|secure|system)$/;
const KEY_RE = /^[A-Za-z0-9_.]+$/;
const VAL_RE = /^[A-Za-z0-9_.:,\/@+-]+$/;

const validPkg = (p) => typeof p === 'string' && p.length <= 256 && PKG_RE.test(p);
const validPerm = (p) => typeof p === 'string' && p.length <= 128 && PERM_RE.test(p);
const validOp = (o) => typeof o === 'string' && OP_RE.test(o);

// The three modes mirror Android's own Settings > Battery states:
//   restricted   = RUN_ANY_IN_BACKGROUND "ignore" (no background use)
//   optimized    = the default ("default" op mode, not whitelisted)
//   unrestricted = on the battery-optimization whitelist
const BATTERY_LABEL = { restricted: 'Restricted', optimized: 'Optimized (default)', unrestricted: 'Unrestricted' };

// ---------- the second confirmation ----------
// Every second dialog offers the same three answers, so one resolver covers
// disable, battery, permissions and settings alike. Button 0 is always Cancel,
// 1 is always "skip the risky ones", 2 is always "do them too".
const SECOND = { CANCEL: 0, SKIP: 1, ALL: 2 };
function resolveSecond(items, flagged, response) {
  if (response !== SECOND.SKIP && response !== SECOND.ALL) return { cancelled: true };
  const kept = response === SECOND.SKIP ? items.filter(i => !flagged.includes(i)) : items;
  if (!kept.length) return { cancelled: true };
  return { items: kept };
}

// ---------- disabling packages ----------
// Risky means: caution-tier knowledge-base entries, plus system packages the
// knowledge base does not know at all — bulk disables from the Apps tab can
// include any package, not just advisor proposals.
function planDisable({ pkgs, kb = {}, thirdParty = [] }) {
  if (!Array.isArray(pkgs) || !pkgs.length) return { error: 'Nothing selected.' };
  const invalid = pkgs.filter(p => !validPkg(p));
  if (invalid.length) return { error: `Invalid package name(s): ${invalid.map(String).join(', ')}` };
  // Defense in depth: keep-tier packages can never be disabled, even if the UI is bypassed.
  const keep = pkgs.filter(p => kb[p] && kb[p].tier === 'keep');
  if (keep.length) return { error: `Refusing keep-tier package(s): ${keep.join(', ')}` };

  const third = new Set(thirdParty);
  const risky = pkgs.filter(p => (kb[p] && kb[p].tier === 'caution') || (!kb[p] && !third.has(p)));
  const why = {};
  for (const p of risky) {
    why[p] = kb[p]
      ? `${kb[p].name}: ${kb[p].desc}`
      : 'System package not in the knowledge base — disabling may break features. Research it first.';
  }
  return { items: [...pkgs], risky, why, needsSecond: risky.length > 0 };
}

// ---------- per-app battery states ----------
// Restricting a SYSTEM app's background use can break sync, alarms, calls or
// notifications, so that combination — and only that one — asks twice.
function planBattery({ pkgs, mode, thirdParty = [] }) {
  if (!BATTERY_LABEL[mode]) return { error: 'Unknown battery mode.' };
  if (!Array.isArray(pkgs) || !pkgs.length) return { error: 'Nothing selected.' };
  const invalid = pkgs.filter(p => !validPkg(p));
  if (invalid.length) return { error: `Invalid package name(s): ${invalid.map(String).join(', ')}` };
  const third = new Set(thirdParty);
  const system = pkgs.filter(p => !third.has(p));
  return { items: [...pkgs], system, label: BATTERY_LABEL[mode], needsSecond: mode === 'restricted' && system.length > 0 };
}

// The undo record for one package: what it was before, or nothing when the mode
// is already what it was. Returned rather than written so the caller keeps the store.
function batteryPrevMode(prev, pkg) {
  return prev.restricted.has(pkg) ? 'restricted' : prev.unrestricted.has(pkg) ? 'unrestricted' : 'optimized';
}

// ---------- phone settings ----------
// Settings carrying a real trade-off get their own consent spelling out the cost.
function planSettings({ keys, baseline = [] }) {
  const want = new Set(Array.isArray(keys) ? keys : []);
  const items = baseline.filter(s => want.has(s.key));
  const warns = items.filter(s => s.warn);
  return { items, warns, needsSecond: warns.length > 0 };
}

// A stored previous value is only restorable if all three parts still pass the
// shell-splice check. An unreadable one is skipped, never guessed at.
function restorableSetting({ ns, key, prev }) {
  const unset = !prev || prev === 'null';
  const ok = NS_RE.test(String(ns || '')) && KEY_RE.test(String(key || '')) && (unset || VAL_RE.test(String(prev)));
  return { ok, unset };
}

// ---------- permissions ----------
function permGroupById(id, permGroups = [], specialOps = []) {
  return permGroups.find(g => g.id === id) || specialOps.find(o => o.id === id) || null;
}

// "Ask each time" and "Don't allow" are both a revoke; what separates them is
// the USER_FIXED flag, which is the thing that stops Android prompting again.
const PERM_VERB = { grant: 'Give back', ask: 'Set to ask each time for', deny: "Don't allow", revoke: 'Take away' };

function planPerms({ groupId, mode, items = [], permGroups = [], specialOps = [], thirdParty = [] }) {
  if (!PERM_VERB[mode]) return { error: 'Unknown action.' };
  const group = permGroupById(groupId, permGroups, specialOps);
  if (!group) return { error: 'Unknown permission group.' };
  if (!Array.isArray(items) || !items.length) return { error: 'Nothing selected.' };

  const bad = items.map(i => i && i.pkg).filter(p => !validPkg(p));
  if (bad.length) return { error: `Invalid package name(s): ${bad.map(String).join(', ')}` };

  const isOp = !!group.op && !group.perms;
  // Which exact permissions each package will be touched for, filtered to the
  // ones this group is actually about so a stray name cannot be spliced in.
  const plan = [];
  for (const it of items) {
    if (isOp) { plan.push({ pkg: it.pkg, perms: [] }); continue; }
    const allowed = new Set(group.perms);
    const wanted = (Array.isArray(it.perms) ? it.perms : group.perms).filter(p => validPerm(p) && allowed.has(p));
    if (wanted.length) plan.push({ pkg: it.pkg, perms: wanted });
  }
  if (!plan.length) return { error: 'Nothing to change for this permission group.' };
  if (isOp && !validOp(group.op)) return { error: 'Bad operation name.' };

  const third = new Set(thirdParty);
  const systemApps = plan.filter(p => !third.has(p.pkg));
  const revoking = mode !== 'grant';
  // Taking a permission away from a system app can break something the phone
  // depends on; giving one back cannot, so only a revoke asks twice.
  return { group, isOp, items: plan, systemApps, revoking, verb: PERM_VERB[mode], needsSecond: revoking && systemApps.length > 0 };
}

// A stored permission undo record is only usable if the package still validates
// and the permission or op name it names is still well-formed.
function restorablePerm(rec) {
  if (!rec || !validPkg(rec.pkg)) return false;
  if (rec.kind === 'op') return validOp(rec.op || '');
  if (rec.kind === 'runtime') return validPerm(rec.perm);
  return false;
}

// ---------- terminal ----------
// Read-only commands run straight away, anything else needs an explicit
// confirmation naming the exact command, and destructive ones are confirmed twice.
function confirmationsFor(tier) {
  return tier === 'read' ? 0 : tier === 'destructive' ? 2 : 1;
}

module.exports = {
  validPkg, validPerm, validOp, restorableSetting, restorablePerm,
  BATTERY_LABEL, PERM_VERB, SECOND,
  resolveSecond, planDisable, planBattery, batteryPrevMode, planSettings,
  permGroupById, planPerms, confirmationsFor,
};
