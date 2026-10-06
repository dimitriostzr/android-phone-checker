# Security

Phone Checker is a free tool from one person. There's no security team behind it, no bug
bounty, no disclosure process and no promise of a reply. I built it for my own phone and put
it out under the MIT License so others can use it. The project is unmaintained: if you find
a hole, fix it in your own fork.

What follows is the part with lasting value: what the app promises, where in the code each
promise is kept, and what would count as breaking one. It's written for someone who wants
to judge the app before running it, and for anyone changing it who wants to know what not to
break.

## What the app promises

Every claim below points at the file that keeps it. All of them are a grep away.

| Promise | Where it's kept |
| --- | --- |
| Nothing changes on the phone without a native confirmation dialog | Every writing handler in `src/main.js` calls `dialog.showMessageBox` before the command, and `src/plan.js` decides what needs a second one. `test/dialogs.test.js` fails if a handler sends a write without one |
| Cancel is the default button in every dialog | `defaultId: 0, cancelId: 0` on each `showMessageBox` in `src/main.js`, held there by `test/dialogs.test.js` |
| The rules behind those dialogs are tested | `src/plan.js` is pure; `test/plan.test.js` covers refusal, the second confirmation, and what "skip the risky ones" leaves behind |
| A string from outside can't be spliced into a shell command unchecked | `PKG_RE`, `PERM_RE`, `OP_RE`, `NS_RE`, `KEY_RE` and `VAL_RE` in `src/plan.js`. Every handler validates, and stored values are validated again before a revert |
| A typed Terminal command is classified before it runs, and unknown means "ask" | `classify` in `src/terminal.js`; `test/terminal.test.js` pins the read-only cases |
| Every pre-built Terminal command is read-only | The test suite classifies each entry of the library in `src/profiles.js` and fails if one isn't `read` |
| A failed read is never reported as a pass | `failCount()` in `src/adb.js` and the `guard` wrapper in `src/checks.js` |
| Keep-tier packages can't be disabled even if the interface is bypassed | `planDisable` in `src/plan.js` refuses the whole request |
| The page has no access to your computer | `contextIsolation: true, nodeIntegration: false` in `src/main.js`; the bridge in `src/preload.js` is the whole surface |
| The page loads nothing from the network | `default-src 'self'` in `src/renderer/index.html` |
| The app makes no network requests of its own | No `fetch`, `http` or `net` call anywhere in `src/`. The only outward calls hand a URL to your browser, and `open:url` accepts `https://` only |
| No adb is bundled | `src/adb.js` looks for yours and tells you where to get Google's if it can't find one |
| Everything the app does on the phone is logged | `setLogger` in `src/adb.js`; the Console view and the daily file under the data folder |
| What the app changed can be undone from the app | The undo lists in the per-phone store, described in [ARCHITECTURE.md](ARCHITECTURE.md#a-change-end-to-end). The one exception, turning USB debugging off, says so in its dialog |

## What would count as a security bug

If you're testing the app or changing it, these are the things that matter. Any of them
would be a real hole in the safety model:

- A command that changes the phone running without a dialog, from any view.
- A Terminal command that changes the phone classified as `read`.
- A package name, permission name, settings key or stored value reaching a shell command
  without passing the validators, including one read back out of the per-phone JSON.
- A failed adb read shown as an `ok` result, or a baseline updated from a failed read.
- A keep-tier package getting disabled by any route.
- Any way for the page to reach the filesystem, spawn a process or load a remote resource.
- A change recorded as reversible that can't be reverted, other than USB debugging off.
- Anything written outside the app's data folder, the temp folder Verify uses, or a location
  you chose in a save dialog.
- Any network request made by the app itself.

If you find one, fix it in your fork, ideally with a test that fails before the fix and
passes after it.

## Out of scope

- **adb and Android.** The app uses the documented debugging interface with user-level
  commands. What adb or the phone does with them is theirs.
- **What a manufacturer's software does.** Package descriptions record delivery channels
  documented in public research or read off a device. They aren't a claim that any app or
  vendor is malicious, and they aren't a vulnerability report.
- **Unsigned installers.** When installers exist they won't be code-signed, so macOS and
  Windows will warn on first launch. That warning applies to any unsigned app. Each release
  will ship a `SHA256SUMS.txt`, and checking it is the verification that matters.
- **Your phone's own security.** A clean result means these checks, over adb, found nothing.
  It isn't a certification and it isn't a malware scan. The README's
  [What it is not](README.md#honest-expectations-what-it-is-not) says the rest.

## Using it safely

Three habits cover most of the risk, and the app reminds you of them on the way out.

1. **Turn USB debugging off when you're done.** While it's on, any computer you've allowed
   can run everything this app runs. The quit checklist has a button for it.
2. **Treat the app's own files as personal.** The per-phone JSON, the snapshots, the logs
   and any exported report describe one specific phone and its owner.
   [ARCHITECTURE.md](ARCHITECTURE.md#what-the-app-writes-on-your-computer) lists each one.
   Read before you share.
3. **Read the dialog.** It says what will run, lists every item, and marks the ones that
   need care. Cancel is always the default button.
