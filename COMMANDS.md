# Every command Phone Checker can run

This is the complete list. The [README](README.md#under-the-hood-how-it-communicates) has the short
version and the reasoning; this page is the reference. Everything goes through ADB, using only
commands available to any user, and every one of them shows up live in the **Console** view
and in the daily log file on your computer.

**Reading** — none of these change the phone, so they run without asking:

| Command | What it reads |
| --- | --- |
| `getprop` | device identity, OS build, security patch level |
| `pm list packages [-3 -d -u -i]` | installed / disabled / uninstalled packages and each one's installer of record |
| `settings get global\|secure\|system …` | individual system-settings values |
| `settings list global\|secure\|system` | the complete settings tables, for Save state comparisons |
| `dumpsys package packages` · `dumpsys package installs` | every package record (install dates, installer, initiator, flags) and the install sessions the phone still remembers |
| `dumpsys device_policy · battery · package · deviceidle` | device admins, battery state, package details and permission grants |
| `appops get · cmd appops query-op` | per-app operation records: background activity, special access, last recorded use |
| `pm path` + `adb pull` | copies an app's APK **to** your computer for local checksumming — a read; the phone is untouched, and the temporary copy is deleted right after hashing |
| `wm size · wm density · df · uname · cat /proc/…`, `dumpsys display · SurfaceFlinger` | screen, refresh rate, storage and hardware basics |
| `cat /proc/cpuinfo · meminfo · loadavg`, `/sys/…/cpufreq`, `/sys/class/thermal` | processor clocks, memory, load and temperatures for the Hardware view |
| `which su` | root probe (presence check only) |
| `pm list packages [-s -f --apex-only]` · `pm list features · libraries · instrumentation` · `pm list permissions -g -f` | report export: the packages that shipped with the firmware, the APK file behind each one, the APEX modules that update separately from it, the features and shared libraries this build declares, any test harness registered on the phone, and every permission it defines with how strongly each is protected |
| `cmd device_config list` | report export: the server-pushed feature flags — which experimental behaviours are switched on for this phone |
| `dumpsys input_method · accessibility · autofill · shortcut · companiondevice · media_projection` · `cmd overlay list` | report export: the places software can watch the screen, see what is typed, read form fields, draw over other apps, or ride along on a paired device |
| `ls /system/etc/security/cacerts …` · `getenforce` · `dumpsys trust · lock_settings · webviewupdate · backup` | report export: the certificate authorities this phone trusts and any added by hand, SELinux mode, screen-lock and trust agents, the WebView engine behind every in-app web page, and where backups go |
| `pm list users` · `pm list packages -u --user N` · `ps -A` · `service list` · `dumpsys role · jobscheduler · alarm · power · activity services · activity providers · netpolicy · sensorservice · usb · nfc` | report export: user profiles and the packages on each, processes running at collection time, every registered system service, which app holds each system role, scheduled jobs and alarms, what is holding the phone awake, per-app data restrictions, sensors, USB and NFC |
| `dumpsys connectivity · account · content · wifi · bluetooth_manager · telephony.registry · carrier_config · location · notification · usagestats · dropbox · netstats --full` · `logcat -d` | **report export only, and optional:** network/VPN/proxy state, accounts signed in, sync adapters, saved Wi-Fi, paired Bluetooth devices, SIM and carrier state, location requests, notifications, which apps were used and when, recent crashes, per-app network history, and the last few thousand lines of the system log. These can hold personal content, so the export marks them, names them in the report's own README, and can leave them out |

**Writing** — each of these waits for you to approve a native confirmation dialog listing
every affected item, and the previous state is saved first, except for the re-enable, which
is itself the way back. All of it is reversible from inside the app except the last row,
which says so in the dialog before it runs:

| Command | What it changes |
| --- | --- |
| `pm disable-user --user 0 <package>` | disables an app for your user — Android's supported, reversible mechanism (`pm enable --user 0` undoes it) |
| `pm enable --user 0 <package>` | switches a disabled app back on, from History, the advisor or the Apps view, one package or several. Asks once; there is no caution tier, since it restores rather than removes. Recorded in History. Nothing is saved beforehand, and the way to reverse it is to disable the app again through the same views |
| `settings put <namespace> <key> <value>` | applies a settings change you selected (`settings delete` restores a previously-unset value on undo) |
| `cmd appops set <package> RUN_ANY_IN_BACKGROUND …` and `dumpsys deviceidle whitelist ±<package>` | per-app battery states (Restricted / Optimized / Unrestricted) |
| `pm grant`/`pm revoke --user 0 <package> <permission>`, and `cmd appops set <package> <op> allow\|deny` for special access | takes a permission away from an app, or gives it back, from the Permission audit. The previous grant is saved first, and taking one away from a system app is confirmed a second time |
| `settings put global adb_enabled 0` | turns USB debugging off from the quit checklist, if you press the button there. **The one change the app cannot undo** — it disconnects the phone, which is also how the app confirms it worked. Re-enable it by hand in Developer options |

That's the whole list. No system-partition changes, no flashing, nothing that trips a
warranty or security flag. Caution-tier packages, settings with trade-offs, unknown system
packages, battery restriction of system apps and taking a permission away from a system app
all get a **second, separate confirmation** that spells out what breaks.

**The Terminal** is the one place a command the app didn't write reaches your phone, because
you typed it. The same rule applies, enforced the same way: before anything runs, the
command is classified.

| Classification | What happens |
| --- | --- |
| **read-only** — recognised as a query (`getprop`, `pm list`, `settings get`, `dumpsys`, `cmd … query-op`, `logcat -d`, pipes into `grep`/`head`/`sort`, …) | runs straight away |
| **not recognised as read-only** — anything else, including every command the classifier does not know | a confirmation dialog naming the exact command and why it is being asked |
| **destructive** — `pm uninstall`/`clear`, `rm`, `adb install`/`push`/`reboot`, factory-reset broadcasts, `settings delete`, direct database edits, … | confirmed **twice**, with what is at stake spelled out |

Anything unknown falls back to "ask": if the classifier has never seen a command, it assumes
that command could change something. All ~60 library commands are read-only, and the test
suite re-checks them against the classifier on every run, so a library entry can't quietly
turn into a write. Terminal commands that weren't read-only go into History, but unlike the
app's own changes, **the app can't undo them**. The Terminal runs exactly what you typed,
and the dialog tells you so before it runs.
