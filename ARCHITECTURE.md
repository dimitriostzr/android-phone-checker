# How Phone Checker is put together

This is for anyone who has cloned the repo to change it. The [README](README.md) says what
the app does and how to use it. This page says how to run it from source, where each piece
lives, how a check and a change travel through the code, what the app writes on your
computer, and where to start if you want to add something. There's no support process
behind the project, so this page and the tests are what you get. They're meant to be
enough.

## Running it from source

```bash
npm install
npm start
```

`npm start` works from any terminal, including the ones built into editors. Those set
`ELECTRON_RUN_AS_NODE=1`, which turns the Electron binary into plain Node, so the app would
open no window and exit straight away. The start script clears that variable before launching.

Package installers for all three platforms (dmg/zip, nsis/portable, AppImage/deb):

```bash
npm run dist
```

### Tests

```bash
npm test
```

About 130 tests covering the rules behind every confirmation dialog, how the phone's
package records are parsed, which terminal commands count as read-only, and the colour
palette's contrast in both themes. They read source files and run pure functions, so they
need neither a phone nor `npm install`. Plain Node is enough.

Worth running if you fork this to change the vendor package lists, since the suite is what
catches a command that turns out not to be read-only.

## Three processes and one bridge

Electron runs the app as three parts, and the safety claims in the README rest on the split.

- **Main** (`src/main.js` and what it requires). Plain Node. It's the only place adb is
  executed and the only place a command that changes the phone is sent. Every such command
  sits behind a native confirmation dialog in this file, and the dialog says what will run.
  `test/dialogs.test.js` fails if a handler sends a write without one.
- **Preload** (`src/preload.js`). The bridge. It exposes one global, `window.sentinel`,
  holding a fixed list of named operations, each mapped to one IPC channel that main
  handles. Nothing else crosses. An operation that isn't in that file can't be called from
  the page.
- **Renderer** (`src/renderer/`). The page that draws the interface. Node integration is
  off and context isolation is on (the `webPreferences` line in `src/main.js`), so the page
  has no filesystem, no child processes and no `require`. Its content security policy is
  `default-src 'self'` (line 5 of `index.html`), so it loads nothing from the network. It's
  one HTML file, one stylesheet and one script, `app.js`, which holds every view and reaches
  main only through the bridge.

`app.js` is big and the pure modules are small, on purpose. Anything that decides whether
something is safe, or parses what the phone said, lives in a module that needs neither
Electron nor a phone, so a test can hold it still.

## The modules

Two layers. One talks to the phone. The other turns text into facts or facts into decisions,
and never touches adb, Electron or the disk.

**Talks to the phone**

| File | What it does | Uses |
| --- | --- | --- |
| `src/adb.js` | Finds the adb you already have (PATH first, then the usual SDK folders) and runs it. Every call goes through one function that logs it and counts failures. No adb is bundled. | `child_process` |
| `src/checks.js` | The health checks, the debloat proposals, the permission audit, per-app battery states, and the parser for Android's enabled states. | adb, profiles |
| `src/inventory.js` | The reads behind Install origins and Save state: the full package dump, install sessions, the settings tables. | adb, origin, snapshot, checks |
| `src/hardware.js` | CPU, memory, storage, battery and thermal readings from `/proc`, `/sys` and `dumpsys`. Best effort. A value the build won't answer is left out, not guessed. | adb |
| `src/report.js` | The full report export: a fixed list of raw captures plus the `report.json` built from the other readers. | adb, checks, inventory, hardware, snapshot, system, profiles |

**Pure**

| File | What it does | Held by |
| --- | --- | --- |
| `src/profiles.js` | The knowledge base. Package descriptions and tiers, vendor profiles, tripwires, the stalkerware set, the settings baseline and the Terminal's command library. Data plus two lookups. | `test/profiles.test.js` |
| `src/plan.js` | The decision layer for every change: what's refused, what runs, what needs a second dialog, and the validation of every string that will be spliced into a shell command. | `test/plan.test.js` |
| `src/terminal.js` | Splits a typed command and classifies it as read, write or destructive. | `test/terminal.test.js` |
| `src/origin.js` | Parses `dumpsys package` output into per-package records and says where each app came from. | `test/origin.test.js` |
| `src/snapshot.js` | Builds a Save state snapshot from raw command output and diffs two of them. | `test/snapshot.test.js` |
| `src/system.js` | Parses the system-wide dumps the full report collects — properties, users, roles, the permission catalogue, feature flags, services, certificates — and derives the security surfaces from the settings tables. | `test/system.test.js` |
| `src/userdata.js` | Moves the app's data folder when the app's name changes, and refuses to touch anything that isn't ours. | `test/userdata.test.js` |

The other tests read source files instead of calling functions. `menu.test.js` holds
`index.html` and `app.js` to each other, so an id renamed in one place can't silently kill a
button. `contrast.test.js` computes WCAG ratios from the colour tokens in `style.css` for
both themes. `icon.test.js` keeps the dock icon and the sidebar mark the same drawing.
`launch.test.js` guards the start script. `states.test.js` runs the enabled-state parser
against the shapes `dumpsys` actually prints. `dialogs.test.js` holds every handler that
writes to the phone to opening a dialog first, and Cancel to being the default button in
each one.

## A check run, end to end

1. The Dashboard calls `runChecks` on the bridge. Main asks adb for the device summary:
   serial, manufacturer, model, Android version, patch level, verified-boot state, bootloader
   lock.
2. Main loads the per-phone store, a JSON file named after the serial (see
   [What the app writes on your computer](#what-the-app-writes-on-your-computer)), and passes
   it into `runChecks` in `checks.js`. The store is the baseline.
3. `checks.js` asks `forDevice(manufacturer)` in `profiles.js` for the profile: which package
   is the preinstalled store, which tripwires apply, which settings make up the baseline. A
   manufacturer with no profile gets a neutral one with only the cross-vendor tripwires.
4. Each check is one block. It reads what it needs, builds `{ id, title, status, lines }` and
   hands it to `add`. Status is `ok`, `flag`, `note`, `info` or `skip`. The `SCOPES` table at
   the top of the file says which ids are privacy; everything else counts as security.
5. Before a check reads anything it notes `failCount()` from `adb.js`. A failed adb call
   comes back as an empty string, and every parser would read that as "nothing found". So
   when the reads are done, `guard` compares the counter. If any call failed, the result is
   swapped for a `skip` with an "unreadable" line, and the check's baseline is left alone.
   That one rule is what stops a loose cable from producing an all-clear.
6. Three checks learn a baseline on the first run and diff against it afterwards: the
   accessibility, notification-listener and device-admin surfaces, the full package list, and
   the sideloads you've marked as trusted. Since the baseline is the store, those three
   fields (`surfaces`, `packages`, `trustedSideloads`) live in the per-phone JSON.
7. Each result goes to the window over `checks:result` as it finishes, so cards appear one
   by one. When the run ends, main puts the whole run at the front of `history` in the store
   (the last 40 runs, results included) and stamps `lastRun`.

The renderer draws a card from the result object alone, so a new check appears on the
Dashboard without any renderer change. The only per-check code in `app.js` is the set of
ids whose package lines get an Origin button, and the privacy card's link to the Phone
settings tab.

## A change, end to end

Every change takes the same route. Disabling a package is the example; battery states,
settings, permissions and the Terminal follow it with their own plan function.

1. The renderer calls a named operation, here `disablePackages(pkgs)`, with the selection.
   The renderer has already shown the risk hint next to the button, but nothing the renderer
   says is trusted past this point.
2. The handler in `main.js` reads the phone's third-party package list and asks
   `planDisable` in `plan.js` what to do. The plan validates every package name against
   `PKG_RE`, refuses the whole request if any name is keep-tier, and marks as risky anything
   caution-tier or any system package the knowledge base doesn't know. Risky items need a
   second dialog, with a reason recorded per item.
3. Main shows the first native dialog. It names the command (`pm disable-user --user 0`),
   lists every package, and marks the risky ones. Cancel is the default button.
4. If the plan asked for it, main shows the second dialog with the reason for each risky
   item. It always offers the same three answers: cancel, skip the risky ones, or do them
   too. `resolveSecond` in `plan.js` turns the answer into the final list.
5. Main runs the command per package, checks the phone's own reply as well as the exit code,
   and writes each outcome to `actions` in the store. What succeeded is added to
   `disabledByApp`.
6. Undo lives beside the change. History re-enables what was disabled, one item or all of
   it; the Apps view restores battery states; the Permissions view restores grants; the Phone
   settings view restores values. Each reads its own list from the store, and every outcome
   lands in `actions`, which History lists. Re-enable is the exact reverse command, and it
   asks first too, for one package or for all of them, since switching an app back on
   restores whatever that app does.

The same pattern gives each family its own undo list in the store: `disabledByApp`,
`batteryChangedByApp`, `settingsChangedByApp` and `permsChangedByApp`. The battery, settings
and permission lists hold the previous state, saved before the command ran; the disable list
only needs the package name, since the reverse is always enable. Before a revert splices a
stored value into a command, `plan.js` validates it again. A record that no longer validates
is skipped, never guessed at.

Turning USB debugging off is the one write outside this pattern. It's recorded in `actions`
but has no undo list, because the phone disconnects the moment it works. Its handler polls
for the disconnect rather than trusting the command's exit code.

## The Terminal

The Terminal is the one place a command the app didn't write reaches the phone. `classify`
in `terminal.js` runs on every command before it's sent and returns a tier:

- **read**: a recognised query. Runs at once.
- **write**: anything not recognised as read-only, including a command the classifier has
  never seen. One confirmation naming the command and why it's being asked.
- **destructive**: uninstalls, data wipes, reboots, `adb install` or `push`,
  `settings delete`, direct database edits. Two confirmations.

The classifier splits on pipes and separators with quote tracking, so a `grep 'a|b'` isn't
torn in half. A nested sub-command (`$(…)` or backticks) is always write, because what it
runs can't be checked in advance. Output redirected into a file on the phone is write.
`confirmationsFor` in `plan.js` turns the tier into a count of dialogs.

Every entry in the command library in `profiles.js` is run through the classifier by the
test suite and must come back as read. That's the check that stops a library entry from
quietly becoming a write.

## What the app writes on your computer

Nothing leaves the machine, but plenty is written to it. All of it is under Electron's data
folder for the app name `Phone Checker`:

| OS | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/Phone Checker/` |
| Windows | `%APPDATA%\Phone Checker\` |
| Linux | `~/.config/Phone Checker/` |

Inside it:

- **`devices/<serial>.json`**: one file per phone the app has seen. Its fields: `device`
  (serial, model, manufacturer), `lastRun`, `history` (the last 40 check runs with their full
  results), `actions` (the last 500 things the app did, with timestamps and outcomes), the
  baselines `surfaces`, `packages` and `trustedSideloads`, and the undo lists
  `disabledByApp`, `batteryChangedByApp`, `settingsChangedByApp` and `permsChangedByApp`. If
  you want to know what the app did to a phone, this file is the record.
- **`snapshots/<serial>/<id>.json`** plus an `index.json`: every saved state. A snapshot
  holds the build identity, every package with its version, state, installer and sensitive
  permissions, all three settings tables in full, the surfaces, and the battery lists.
- **`logs/adb-YYYY-MM-DD.log`**: one line per adb command, with the timestamp, the exact
  command, whether it succeeded, how long it took and how many bytes came back. A line with
  `!!` after the timestamp records a window crash or a hang, so a crash leaves a trace.
- Electron's own browser storage, in the same folder, holds the theme and accent choice, the
  first-run flag, and the Terminal's command history.

Two more places, both chosen by you in a dialog:

- **Exports** (the Export buttons on each view, and the PNG of the Hardware view) go
  wherever you save them.
- **The full report** goes into a folder you pick: `report.json`, a `raw/` folder with the
  untouched output of every command, a `README.md` describing the contents, and a `logs/`
  folder with copies of the last seven daily command logs, so the collection itself can be
  audited. It is the widest read the app does — around 65 commands, one of them repeated per
  user profile — so it takes a few minutes.

And one temporary file: Verify pulls an app's APK into a `phone-checker-verify/` folder
under the system temp folder, hashes it, and deletes it in a `finally` block whether or not
the hash succeeded.

**Which of this is personal.** All of it, by the standard the app itself applies. The device
file and the logs carry the serial and every package name on the phone. Snapshots carry the
full settings tables, which hold account names, network names and more. The report's
optional captures (network and VPN state, accounts, sync adapters, saved Wi-Fi, paired
Bluetooth devices, SIM and carrier state, location requests, notifications, app usage, crash
history, the system log, network history) are marked as personal in its own README, and the
app lets you leave them out. Don't paste any of these into a public place without reading
them first.

## Making it yours

The licence lets you change anything. These are the places you're most likely to touch, and
what catches a mistake while you do.

**Add or change a knowledge-base entry** (`KB` in `src/profiles.js`). One line per package:
`name`, `tier` and `desc`. The tiers:

| Tier | Meaning |
| --- | --- |
| `recommended` | Safe to disable for nearly everyone. No core feature is lost. |
| `optional` | Disabling loses a real feature some people use. The description says which. |
| `caution` | Something fails silently when it's off. Asks a second time. |
| `keep` | Known to break the camera, screenshots, Settings or similar. Shown, never selectable, and `planDisable` refuses it even if the interface is bypassed. |

Write the description for someone who has never seen the package name. Say what it does,
then what disabling costs. Where a package's presence is documented as arriving through a
preload or partner campaign, say so about the delivery channel, not about the app.
Manufacturers' own components are described generically in the interface ("the
manufacturer's preinstalled store"), and the package id is always shown beside the label, so
the phone identifies itself and the app doesn't. `profiles.test.js` checks that every entry
has all three fields and a valid tier.

Don't paste entries from the community debloat lists. They're credited in
[CREDITS.md](CREDITS.md), which also says that no third-party data is copied into the
project, and the descriptions here are original. Their lists are GPL-licensed, so copying
entries across would bring the GPL's terms and their copyright notice with them, and that
line in CREDITS.md would have to change.

**Add a vendor profile** (`VENDORS` in `src/profiles.js`). An id, a regex matched against
what the phone reports as its manufacturer, the package id of that vendor's store, and any
vendor-specific tripwires. The store package must also be in `TRUSTED_INSTALLERS`, and the
test checks that. Everything the checks say about a vendor store is phrased generically, so
a new profile needs no new strings.

**Add a check** (`runChecks` in `src/checks.js`). Copy the shape of an existing block: note
`failCount()` first, read, build `{ id, title, status, lines }`, wrap it in `guard` with that
count, pass it to `add`. Add the id to `SCOPES` if it's about privacy. If the check learns a
baseline, store it on the `baseline` object and only update it when no read failed. Write
the first line of `lines` as the one-sentence verdict, since the card shows it in the summary
row. A `skip` is not a pass and should never be turned into one.

**Add a Terminal library command** (`COMMANDS` in `src/profiles.js`). A `label` saying what
you learn, the `cmd`, and a `desc` for someone who has never used adb. A `{pkg}`
placeholder needs an `arg` name; a `{store}` placeholder needs `needsStore: true`;
`vendor: '<id>'` limits it to one vendor's phones. It has to classify as read, or the suite
fails.

**Add a setting to the baseline** (`SETTINGS_BASELINE` in `src/profiles.js`). Namespace,
key, the wanted value, a category (`privacy`, `security` or `leanness`) and a description.
Add `warn` with a plain sentence when the setting has a real cost, and it will get the
second dialog and never be bulk-selected. `unsetOk: true` means an absent key counts as
satisfied.

**Add an operation the page can call.** Three places: a line in `src/preload.js`, an
`ipcMain.handle` in `src/main.js`, and the call in `app.js`. If the operation writes to the
phone, put its rules in a function in `src/plan.js`, test that function, show the dialog in
the handler (`dialogs.test.js` fails if you don't), save the previous state before the
command, and record the outcome with `logAction`. If it only reads, note `failCount()` around the reads and return an error
rather than an empty result when they fail. Every string that will be spliced into a shell
command, including one read back out of the store, goes through the validators in `plan.js`
first.

**Run the tests** with `npm test` after every change. If you change `index.html` or
`app.js`, `menu.test.js` will tell you about an id that no longer matches. If you change a
colour token, `contrast.test.js` will tell you whether it still reads.

## What stays out of the repo

The `.gitignore` refuses zip files, APKs, backups, anything named like a bugreport, logcat
output and `runs/` folders. That's deliberate: a device dump is a picture of one person's
phone, and only redacted excerpts inside a Markdown file belong in a public repository. Keep
it that way in a fork too. The report export and the snapshots described above are the same
kind of material.

The packaged build takes `src/**`, `scripts/**`, `package.json`, the icon, `CREDITS.md` and
`LICENSE`. Anything else you put under `src/` ships with the app.
