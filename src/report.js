// report.js — the "everything this app can read" export.
//
// One folder holding a single structured report.json plus the raw command
// output it was built from, so the collection can be checked, diffed, kept as
// evidence, or handed to something else for analysis. Read-only throughout:
// every command below is a query, and nothing on the phone is changed.
//
// The aim is completeness: every settings table (including the server-pushed
// feature flags), every package on every user profile, every place software can
// watch or manage the phone from, and the hardware and runtime state around it.
//
// Some of what a phone will tell you is personal (network and VPN state, accounts,
// saved Wi-Fi and paired devices, recent app usage, notifications, the system log,
// network history). Those are marked `personal: true` here, listed in the report's
// own README, and can be left out entirely.
'use strict';
const { shell, adb, failCount } = require('./adb');
const { runChecks, permissionAudit, listAllApps, batterySets } = require('./checks');
const { readOrigins } = require('./inventory');
const { parseSettingsList } = require('./snapshot');
const sys = require('./system');
const hardware = require('./hardware');
const { forDevice } = require('./profiles');

const BIG = 180000;   // long-running dumps get a generous timeout

// Raw captures, in the order they are written. `personal` marks output that can
// carry content about the owner rather than about the software on the phone;
// those are collected last so a report without them stops cleanly at the end.
const RAW = [
  // --- identity ---
  { file: '01-properties.txt', cmd: 'getprop', what: 'every system property the phone reports (model, build, security patch, region)' },

  // --- packages ---
  { file: '02-packages-full.txt', cmd: 'dumpsys package packages 2>/dev/null', what: 'the package manager\'s full record for every installed app: install dates, installer, flags, signatures, permission grants', timeout: BIG },
  { file: '03-install-sessions.txt', cmd: 'dumpsys package installs 2>/dev/null', what: 'install sessions the phone still remembers since its last restart' },
  { file: '04-installers.txt', cmd: 'pm list packages -i --user 0 2>/dev/null', what: 'every package with its installer of record' },
  { file: '05-packages-third-party.txt', cmd: 'pm list packages -3 --user 0 2>/dev/null', what: 'packages that did not ship with the firmware' },
  { file: '06-packages-disabled.txt', cmd: 'pm list packages -d --user 0 2>/dev/null', what: 'packages currently disabled' },
  { file: '07-packages-uninstalled.txt', cmd: 'pm list packages -u --user 0 2>/dev/null', what: 'packages including ones removed but still recorded' },
  { file: '08-packages-system.txt', cmd: 'pm list packages -s --user 0 2>/dev/null', what: 'packages that shipped as part of the firmware' },
  { file: '09-packages-apk-paths.txt', cmd: 'pm list packages -f --user 0 2>/dev/null', what: 'every package with the APK file it is installed from, which names the partition it lives on' },
  { file: '10-packages-apex.txt', cmd: 'pm list packages --apex-only 2>/dev/null', what: 'APEX system modules — the parts of Android that update separately from the firmware' },
  { file: '11-app-links.txt', cmd: 'echo "== verified app links =="; pm get-app-links --user 0 2>/dev/null; echo; echo "== preferred apps =="; dumpsys package domain-preferred-apps 2>/dev/null; echo; echo "== preferred activities =="; dumpsys package preferred-xml 2>/dev/null', what: 'which app opens which web domain, and the default-app preferences behind that' },

  // --- settings ---
  { file: '12-settings-global.txt', cmd: 'settings list global 2>/dev/null', what: 'the global settings table' },
  { file: '13-settings-secure.txt', cmd: 'settings list secure 2>/dev/null', what: 'the secure settings table' },
  { file: '14-settings-system.txt', cmd: 'settings list system 2>/dev/null', what: 'the system settings table' },
  { file: '15-device-config.txt', cmd: 'cmd device_config list 2>/dev/null', what: 'the server-pushed feature flags: which experimental behaviours are switched on for this phone', timeout: BIG },

  // --- permissions and special access ---
  { file: '16-appops.txt', cmd: 'dumpsys appops 2>/dev/null', what: 'the per-app operations ledger: background access, special permissions, last-use times', timeout: BIG },
  { file: '17-permissions-catalog.txt', cmd: 'pm list permissions -g -f 2>/dev/null', what: 'every permission this build defines, grouped, with how strongly each one is protected', timeout: BIG },

  // --- management and policy ---
  { file: '18-device-policy.txt', cmd: 'dumpsys device_policy 2>/dev/null', what: 'device administrators and any management (MDM) profile' },
  { file: '19-deviceidle.txt', cmd: 'dumpsys deviceidle 2>/dev/null', what: 'battery-optimisation state and the exemption whitelist' },
  { file: '20-netpolicy.txt', cmd: 'dumpsys netpolicy 2>/dev/null', what: 'per-app data restrictions and background-data rules' },
  { file: '21-roles.txt', cmd: 'dumpsys role 2>/dev/null', what: 'which app holds each system role (dialer, SMS, browser, home)' },
  { file: '22-users.txt', cmd: 'pm list users 2>/dev/null', what: 'user profiles on the device, including any work profile' },

  // --- the places software can watch, type for, or draw over ---
  { file: '23-input-methods.txt', cmd: 'dumpsys input_method 2>/dev/null', what: 'every keyboard installed, which are enabled, and which one is in use', timeout: BIG },
  { file: '24-accessibility.txt', cmd: 'dumpsys accessibility 2>/dev/null', what: 'accessibility services — what each one is allowed to read from the screen and inject' },
  { file: '25-autofill.txt', cmd: 'dumpsys autofill 2>/dev/null', what: 'the autofill service, which sees form and password fields' },
  { file: '26-overlays.txt', cmd: 'cmd overlay list 2>/dev/null', what: 'resource overlays — vendor and carrier packages that reskin or re-configure system apps' },
  { file: '27-shortcuts.txt', cmd: 'dumpsys shortcut 2>/dev/null', what: 'app shortcuts and the launchers allowed to read them', timeout: BIG },
  { file: '28-companion-devices.txt', cmd: 'dumpsys companiondevice 2>/dev/null', what: 'apps paired with a watch, earbuds or tracker, which grants them background access' },
  { file: '29-media-projection.txt', cmd: 'dumpsys media_projection 2>/dev/null', what: 'screen-capture and screen-recording grants' },
  { file: '30-backup.txt', cmd: 'dumpsys backup 2>/dev/null', what: 'the backup transport in use and which apps are backed up off the device' },
  { file: '31-webview.txt', cmd: 'dumpsys webviewupdate 2>/dev/null', what: 'the WebView provider — the browser engine every in-app web page runs on' },

  // --- integrity ---
  { file: '32-certificates.txt', cmd: 'echo "== system =="; ls /system/etc/security/cacerts 2>/dev/null; ls /apex/com.android.conscrypt/cacerts 2>/dev/null; echo "== user-added =="; ls /data/misc/user/0/cacerts-added 2>/dev/null; echo "== user-removed =="; ls /data/misc/user/0/cacerts-removed 2>/dev/null', what: 'the certificate authorities this phone trusts, and any added or removed by hand — an added one can let traffic be read in the middle' },
  { file: '33-integrity.txt', cmd: 'echo "== getenforce =="; getenforce 2>/dev/null; echo "== boot and build =="; for k in ro.boot.verifiedbootstate ro.boot.flash.locked ro.boot.veritymode ro.boot.warranty_bit ro.secure ro.debuggable ro.build.type ro.build.tags ro.build.selinux; do echo "$k=$(getprop $k)"; done; echo "== su on PATH =="; which su 2>/dev/null || echo none', what: 'SELinux mode, verified boot and bootloader state, build type, and whether a root binary is on the path' },
  { file: '34-lock-and-trust.txt', cmd: 'echo "== trust =="; dumpsys trust 2>/dev/null; echo; echo "== lock settings =="; dumpsys lock_settings 2>/dev/null', what: 'screen-lock state and any agent allowed to keep the phone unlocked' },

  // --- what is running ---
  { file: '35-services-registered.txt', cmd: 'service list 2>/dev/null', what: 'every system service registered with the phone, which names the vendor additions' },
  { file: '36-services-running.txt', cmd: 'dumpsys activity services 2>/dev/null', what: 'app services running at collection time and what started them', timeout: BIG },
  { file: '37-content-providers.txt', cmd: 'dumpsys activity providers 2>/dev/null', what: 'content providers, which is how apps read each other\'s data', timeout: BIG },
  { file: '38-processes.txt', cmd: 'ps -A -o PID,PPID,USER,NAME 2>/dev/null', what: 'processes running at collection time' },
  { file: '39-jobs.txt', cmd: 'dumpsys jobscheduler 2>/dev/null', what: 'scheduled background jobs, including any store polling for updates', timeout: BIG },
  { file: '40-alarms.txt', cmd: 'dumpsys alarm 2>/dev/null', what: 'alarms apps have set to wake the phone, and how often each has fired', timeout: BIG },
  { file: '41-power.txt', cmd: 'dumpsys power 2>/dev/null', what: 'wake locks — what is holding the phone awake — and the power policy around them', timeout: BIG },

  // --- hardware and capacity ---
  { file: '42-battery.txt', cmd: 'dumpsys battery 2>/dev/null', what: 'battery level, health, temperature, voltage and current' },
  { file: '43-thermal.txt', cmd: 'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type 2>/dev/null)|$(cat $z/temp 2>/dev/null)"; done 2>/dev/null', what: 'every thermal sensor and its reading' },
  { file: '44-cpu-memory.txt', cmd: 'echo "== /proc/cpuinfo =="; cat /proc/cpuinfo; echo; echo "== /proc/meminfo =="; cat /proc/meminfo; echo; echo "== /proc/stat =="; cat /proc/stat; echo; echo "== /proc/loadavg =="; cat /proc/loadavg; echo; echo "== /proc/uptime =="; cat /proc/uptime; echo; echo "== /proc/version =="; cat /proc/version', what: 'processor, memory, load and kernel version as the kernel reports them' },
  { file: '45-storage.txt', cmd: 'echo "== df -h =="; df -h 2>/dev/null; echo; echo "== volumes =="; sm list-volumes all 2>/dev/null; echo; echo "== mounts =="; cat /proc/mounts 2>/dev/null', what: 'storage use per mount point, the volumes the phone knows about, and how each is mounted' },
  { file: '46-features.txt', cmd: 'pm list features 2>/dev/null', what: 'the hardware and software features this build declares' },
  { file: '47-libraries.txt', cmd: 'pm list libraries 2>/dev/null', what: 'shared libraries apps can link against, including vendor ones' },
  { file: '48-instrumentation.txt', cmd: 'pm list instrumentation 2>/dev/null', what: 'test harnesses registered on the phone — these can drive other apps, and should not normally be present on a shipping device' },
  { file: '49-sensors.txt', cmd: 'dumpsys sensorservice 2>/dev/null', what: 'every sensor and the apps currently subscribed to it', timeout: BIG },
  { file: '50-usb.txt', cmd: 'dumpsys usb 2>/dev/null', what: 'USB mode and which apps hold USB device access' },
  { file: '51-nfc.txt', cmd: 'dumpsys nfc 2>/dev/null', what: 'NFC state and the apps registered to handle taps and payments', timeout: BIG },

  // --- personal: about the owner, not just the software ---
  { file: '52-connectivity.txt', cmd: 'dumpsys connectivity 2>/dev/null', what: 'network state, VPN and proxy configuration', personal: true, timeout: BIG },
  { file: '53-accounts.txt', cmd: 'dumpsys account 2>/dev/null', what: 'accounts signed in on the device', personal: true },
  { file: '54-sync-adapters.txt', cmd: 'dumpsys content 2>/dev/null', what: 'which apps sync which account, and when each last ran', personal: true, timeout: BIG },
  { file: '55-wifi.txt', cmd: 'dumpsys wifi 2>/dev/null', what: 'Wi-Fi state and saved networks', personal: true, timeout: BIG },
  { file: '56-bluetooth.txt', cmd: 'dumpsys bluetooth_manager 2>/dev/null', what: 'Bluetooth state and paired devices', personal: true, timeout: BIG },
  { file: '57-telephony.txt', cmd: 'dumpsys telephony.registry 2>/dev/null', what: 'SIM, carrier and mobile network state', personal: true, timeout: BIG },
  { file: '58-carrier-config.txt', cmd: 'dumpsys carrier_config 2>/dev/null', what: 'the carrier configuration applied to this SIM', personal: true, timeout: BIG },
  { file: '59-location.txt', cmd: 'dumpsys location 2>/dev/null', what: 'location providers and the apps currently requesting a fix', personal: true, timeout: BIG },
  { file: '60-notifications.txt', cmd: 'dumpsys notification 2>/dev/null', what: 'notification channels, listeners, and recent notifications — which can include their text', personal: true, timeout: BIG },
  { file: '61-usage-stats.txt', cmd: 'dumpsys usagestats 2>/dev/null', what: 'which apps were used and when', personal: true, timeout: BIG },
  { file: '62-crash-history.txt', cmd: 'dumpsys dropbox --print 2>/dev/null | head -n 4000', what: 'the phone\'s record of recent crashes and system errors', personal: true, timeout: BIG },
  { file: '63-system-log.txt', cmd: 'logcat -d -t 4000 2>/dev/null', what: 'the last few thousand lines of the system log', personal: true, timeout: BIG },
  { file: '64-network-stats.txt', cmd: 'dumpsys netstats --full 2>/dev/null', what: 'per-app network history', personal: true, timeout: BIG },
];

const personalFiles = () => RAW.filter(r => r.personal).map(r => r.file);

// Collect everything. `onStep(label, done, total)` reports progress, and
// `includePersonal` decides whether the personal captures are taken at all.
async function collectReport(device, { onStep = () => {}, includePersonal = true, store = null, snapshots = [] } = {}) {
  const started = new Date();
  const f0 = failCount();
  const raws = RAW.filter(r => includePersonal || !r.personal);
  // One extra step per non-primary user profile is added once `pm list users`
  // has been read, so the progress bar grows rather than overshooting.
  let steps = raws.length + 7;
  let done = 0;
  const step = (label) => { onStep(label, done++, steps); };

  step('Reading the device identity');
  const adbVersion = (await adb(['version'], 10000)).stdout.trim().split('\n')[0] || null;
  const details = await require('./adb').deviceDetails();

  step('Reading the hardware');
  const hw = await hardware.readHardware();

  step('Reading every package record');
  const origins = await readOrigins();

  step('Reading app states and battery modes');
  const apps = await listAllApps();

  step('Reading permission grants');
  const perms = await permissionAudit();

  step('Reading battery exemptions');
  const battery = await batterySets();

  step('Running the health checks');
  const baseline = store ? { ...store } : {};
  const checks = await runChecks(device, baseline, null);
  const counts = { flag: 0, note: 0, ok: 0, skip: 0 };
  for (const r of checks.results) counts[r.status === 'flag' ? 'flag' : r.status === 'note' ? 'note' : r.status === 'skip' ? 'skip' : 'ok']++;

  const rawFiles = [];
  const label = (file) => file.replace(/^\d+-/, '').replace(/\.txt$/, '').replace(/-/g, ' ');
  for (const r of raws) {
    step(`Capturing ${label(r.file)}`);
    const text = await shell(r.cmd, r.timeout || 90000);
    rawFiles.push({ file: r.file, what: r.what, personal: !!r.personal, cmd: r.cmd, text, bytes: Buffer.byteLength(text) });
  }
  const byFile = Object.fromEntries(rawFiles.map(r => [r.file, r.text]));

  // Every user profile gets its own package list. User 0 is already covered by
  // the lists above; a work or secondary profile can hold apps that never show
  // up there at all, and leaving them out would make the report look complete
  // while missing a whole account's worth of software.
  const users = sys.parseUsers(byFile['22-users.txt']);
  const extra = users.filter(u => u.id !== 0);
  steps += extra.length;
  const packagesByUser = { 0: sys.parsePmList(byFile['07-packages-uninstalled.txt']) };
  for (const u of extra) {
    step(`Capturing packages for user ${u.id}`);
    const text = await shell(`pm list packages -u --user ${u.id} 2>/dev/null`, 90000);
    const file = `22-user-${u.id}-packages.txt`;
    packagesByUser[u.id] = sys.parsePmList(text);
    rawFiles.push({
      file, text, personal: false, cmd: `pm list packages -u --user ${u.id} 2>/dev/null`,
      what: `packages on user profile ${u.id}${u.name ? ` (${u.name})` : ''}, including ones removed but still recorded`,
      bytes: Buffer.byteLength(text),
    });
  }

  const settings = {
    global: parseSettingsList(byFile['12-settings-global.txt']),
    secure: parseSettingsList(byFile['13-settings-secure.txt']),
    system: parseSettingsList(byFile['14-settings-system.txt']),
    deviceConfig: sys.parseDeviceConfig(byFile['15-device-config.txt']),
  };
  const properties = sys.parseProps(byFile['01-properties.txt']);
  const profile = forDevice(device.manufacturer);
  const settingsCount = ['global', 'secure', 'system'].reduce((n, ns) => n + Object.keys(settings[ns]).length, 0)
    + Object.values(settings.deviceConfig).reduce((n, ns) => n + Object.keys(ns).length, 0);

  const json = {
    report: {
      kind: 'phone-checker-report',
      version: 2,
      generatedAt: started.toISOString(),
      finishedAt: new Date().toISOString(),
      collectedBy: 'Phone Checker for Android',
      readOnly: true,
      note: 'Every command in this report is a read. Nothing on the phone was changed to produce it.',
      includesPersonalCaptures: includePersonal,
      personalFiles: includePersonal ? personalFiles() : [],
      adbVersion,
      failedReads: failCount() - f0,
      counts: {
        packages: Array.isArray(origins.records) ? origins.records.length : null,
        properties: Object.keys(properties).length,
        settings: settingsCount,
        users: users.length,
        rawCaptures: rawFiles.length,
      },
    },
    device: {
      serial: device.serial,
      manufacturer: device.manufacturer,
      model: device.model,
      android: device.android,
      securityPatch: device.patch,
      build: device.build,
      verifiedBoot: device.verifiedBoot,
      bootloaderLocked: device.bootloaderLocked,
      knoxWarrantyBit: device.knoxWarranty || null,
      vendorProfile: { id: profile.vendorId, preinstalledStore: profile.storePkg },
      details: details && details.state === 'device' ? { identity: details.identity, software: details.software, hardware: details.hardware, apps: details.apps, power: details.power } : null,
    },
    hardware: hw && !hw.error ? hw : { error: hw && hw.error },
    // Every property the phone reports, verbatim — the whole of `getprop` as a map.
    properties,
    packages: origins.error ? { error: origins.error } : origins.records,
    packageLists: {
      user0: sys.parsePmList(byFile['07-packages-uninstalled.txt']),
      thirdParty: sys.parsePmList(byFile['05-packages-third-party.txt']),
      system: sys.parsePmList(byFile['08-packages-system.txt']),
      disabled: sys.parsePmList(byFile['06-packages-disabled.txt']),
      apex: sys.parsePmList(byFile['10-packages-apex.txt']),
      byUser: packagesByUser,
    },
    installSessionsRemembered: origins.error ? null : origins.sessionsRemembered,
    appStates: Array.isArray(apps) ? apps : null,
    permissions: perms && perms.error ? { error: perms.error } : perms,
    permissionCatalog: sys.parsePermissionCatalog(byFile['17-permissions-catalog.txt']),
    settings,
    // The places software can watch, type for, redirect or manage this phone from,
    // read out of the settings tables and the device-policy dump.
    surfaces: sys.surfacesFrom(settings, byFile['18-device-policy.txt']),
    batteryOptimization: {
      restricted: [...battery.restricted].sort(),
      unrestricted: [...battery.unrestricted].sort(),
    },
    users,
    roles: sys.parseRoles(byFile['21-roles.txt']),
    features: sys.parsePmList(byFile['46-features.txt'], 'feature'),
    libraries: sys.parsePmList(byFile['47-libraries.txt'], 'library'),
    instrumentation: sys.parseInstrumentation(byFile['48-instrumentation.txt']),
    certificates: sys.parseCertList(byFile['32-certificates.txt']),
    webView: sys.parseWebView(byFile['31-webview.txt']),
    registeredServices: sys.parseServices(byFile['35-services-registered.txt']),
    processes: sys.parseProcesses(byFile['38-processes.txt']),
    healthChecks: { counts, results: checks.results },
    appHistory: store ? {
      runs: (store.history || []).map(h => ({ ts: h.ts, counts: h.counts })),
      changesMade: store.actions || [],
      packagesDisabledByApp: store.disabledByApp || [],
      settingsChangedByApp: store.settingsChangedByApp || {},
      batteryChangedByApp: store.batteryChangedByApp || {},
      trustedSideloads: store.trustedSideloads || [],
      savedStates: snapshots,
    } : null,
    rawFiles: rawFiles.map(r => ({ file: r.file, describes: r.what, command: `adb shell ${r.cmd}`, personal: r.personal, bytes: r.bytes })),
  };
  return { json, rawFiles, steps, personalFiles: personalFiles() };
}

// The folder's own explanation, written beside the data.
function readmeFor(json, rawFiles) {
  const d = json.device;
  const c = json.report.counts || {};
  const L = [
    '# Phone report',
    '',
    `Collected ${new Date(json.report.generatedAt).toLocaleString()} by ${json.report.collectedBy}.`,
    '',
    `- Phone: ${[d.manufacturer, d.model].filter(Boolean).join(' ')} (serial ${d.serial})`,
    `- Android ${d.android}, security patch ${d.securityPatch}, build ${d.build}`,
    `- Packages recorded: ${Array.isArray(json.packages) ? json.packages.length : 'unavailable'}`,
    `- User profiles: ${c.users || 1}`,
    `- Settings values: ${c.settings || 0} across global, secure, system and the feature flags`,
    `- System properties: ${c.properties || 0}`,
    `- Health checks: ${json.healthChecks.counts.flag} flagged, ${json.healthChecks.counts.note} worth a look, ${json.healthChecks.counts.ok} clear${json.healthChecks.counts.skip ? `, ${json.healthChecks.counts.skip} unreadable` : ''}`,
    '',
    '## What is here',
    '',
    '- `report.json` — everything below in one structured file: device and hardware, every system property, every package with its install date and installer, the package list for each user profile, permission grants and the full permission catalogue, all three settings tables plus the server-pushed feature flags, the security surfaces (keyboards, accessibility services, notification listeners, autofill, VPN, device admins), trusted certificate authorities, system roles, declared features and libraries, registered services, running processes, and the health-check results.',
    '- `raw/` — the untouched output of each command, so anything in `report.json` can be traced back to what the phone actually said.',
    '- `logs/` — this app\'s own record of every adb command it has run on this computer, if any existed.',
    '',
    '## How it was collected',
    '',
    'Over ADB, using documented query commands only. Nothing was installed, changed, enabled or disabled to produce this report. Each raw file names the exact command that produced it.',
    '',
    `${rawFiles.length} captures were taken${json.report.failedReads ? `; ${json.report.failedReads} command(s) the phone would not answer are empty` : ''}.`,
    '',
    '| File | Command | Contents |',
    '| --- | --- | --- |',
  ];
  for (const r of rawFiles) L.push(`| \`raw/${r.file}\` | \`adb shell ${r.cmd.length > 60 ? r.cmd.slice(0, 57) + '…' : r.cmd}\` | ${r.what}${r.personal ? ' **(can contain personal content)**' : ''} |`);
  L.push('', '## Before you share this', '');
  if (json.report.includesPersonalCaptures) {
    L.push('This report describes one specific phone and its owner. Treat the whole folder as personal.',
      '',
      'These files in particular can contain personal content rather than just software details:',
      '');
    for (const f of json.report.personalFiles) L.push(`- \`raw/${f}\``);
    L.push('', 'The serial number, the account names, the saved Wi-Fi and paired devices, the list of installed apps and the usage records all identify the device or its owner. Remove what you do not need before sending this anywhere.');
  } else {
    L.push('The captures that can hold personal content (network and VPN state, accounts, sync adapters, saved Wi-Fi, paired Bluetooth devices, SIM and carrier state, location requests, notifications, app usage, crash history, the system log and network history) were left out of this collection.',
      '',
      'What remains still identifies the device: the serial number, the exact build and the full list of installed apps. Treat it as personal even so.');
  }
  return L.join('\n');
}

module.exports = { collectReport, readmeFor, RAW, personalFiles };
