// profiles.js — the knowledge base. Package descriptions, safety tiers, tripwires.
// Sources: original research from a documented forensic case on the author's own device,
// cross-checked with community debloat knowledge. Tiers:
//   recommended — safe to disable for nearly everyone; no core feature loss
//   optional    — disables a real feature some people use; explained per item
//   caution     — carries a feature that fails silently; disable only knowingly
//   keep        — do NOT disable; known breakage (shown for education, never proposed)
'use strict';

const KB = {
  // ---- ads / promo / partner channels ----
  'android.autoinstalls.config.samsung': { name: 'Preinstall config (PAI)', tier: 'recommended', desc: 'Play-store preinstall campaign configuration. Inert after setup; disabling closes a preload vector.' },
  'com.samsung.android.mas': { name: 'Samsung Ads SDK service', tier: 'recommended', desc: 'Ad-serving component used by Samsung apps.' },
  'com.samsung.android.app.spage': { name: 'Samsung Free / News', tier: 'recommended', desc: 'News/content feed panel with sponsored content.' },
  'com.samsung.sree': { name: 'Samsung Global Goals', tier: 'recommended', desc: 'Charity/ads app preloaded by Samsung.' },
  'com.samsung.android.rubin.app': { name: 'Customization Service', tier: 'recommended', desc: 'Samsung service that analyzes device usage to personalize content ("personalized experiences"). Core privacy disable.' },
  'com.facebook.appmanager': { name: 'Meta App Manager', tier: 'recommended', desc: 'Preinstalled Meta stub that can update/install Facebook software in the background.' },
  'com.facebook.services': { name: 'Meta Services', tier: 'recommended', desc: 'Preinstalled Meta background service stub.' },
  'com.facebook.system': { name: 'Meta App Installer', tier: 'recommended', desc: 'Preinstalled Meta stub holding silent-install rights for Facebook apps.' },
  'com.aura.oobe.samsung': { name: 'AppCloud / Aura installer', tier: 'recommended', desc: 'ironSource/Unity Aura partner-app installer. Public security research has reported this preload channel delivering apps users did not request on some devices.' },
  'com.ironsource.appcloud.oobe': { name: 'AppCloud installer', tier: 'recommended', desc: 'ironSource AppCloud partner-app installer.' },

  // ---- preload/telemetry components seen on other manufacturers' devices
  // (picked up automatically when such a device is connected; brand-neutral wording) ----
  'com.miui.analytics': { name: 'Device analytics service', tier: 'recommended', desc: 'Preinstalled usage-analytics component of the device software.' },
  'com.miui.msa.global': { name: 'System ad services', tier: 'recommended', desc: 'Ad-delivery component that serves ads inside preinstalled apps.' },
  'com.xiaomi.joyose': { name: 'Cloud game-tuning service', tier: 'optional', desc: 'Cloud-driven game performance tuning; also receives remote configuration on some builds.' },

  // ---- telemetry / diagnostics ----
  'com.sec.android.diagmonagent': { name: 'Samsung diagnostics agent', tier: 'recommended', desc: 'Uploads diagnostic/error data to Samsung.' },
  'com.samsung.android.dqagent': { name: 'Data quality agent', tier: 'recommended', desc: 'Samsung quality-telemetry collector.' },
  'com.samsung.android.mapsagent': { name: 'Maps agent', tier: 'recommended', desc: 'Samsung background telemetry helper.' },
  'com.google.android.feedback': { name: 'Google feedback reporter', tier: 'recommended', desc: 'Sends app crash feedback to Google.' },
  'com.samsung.android.voc': { name: 'Samsung Members', tier: 'optional', desc: 'Support/community app; includes diagnostics and marketing. Needed for some warranty-support flows.' },

  // ---- Bixby & assistants ----
  'com.samsung.android.bixby.agent': { name: 'Bixby Voice', tier: 'optional', desc: 'Samsung voice assistant. Disable if you use Google Assistant/Gemini.' },
  'com.samsung.android.bixby.wakeup': { name: 'Bixby wake-up', tier: 'optional', desc: '"Hi Bixby" hotword listener.' },
  'com.samsung.android.visionintelligence': { name: 'Bixby Vision', tier: 'recommended', desc: 'Camera-based object recognition tied to Bixby.' },
  'com.samsung.android.intellivoiceservice': { name: 'Intelligent voice service', tier: 'recommended', desc: 'Bixby voice support service remnant.' },

  // ---- caller ID / third-party data services ----
  'com.hiya.star': { name: 'Hiya caller-ID service', tier: 'recommended', desc: 'Third-party caller-ID/spam backend for the Samsung dialer (Smart Call); checks numbers against Hiya\'s online service, as described in its privacy policy. Not used if your dialer is Google Phone.' },
  'com.samsung.android.smartcallprovider': { name: 'Smart Call provider', tier: 'recommended', desc: 'Samsung-dialer caller ID (pairs with Hiya). Useless with Google Phone.' },
  'com.samsung.android.fast': { name: 'Secure Wi-Fi', tier: 'recommended', desc: 'Samsung\'s Secure Wi-Fi VPN, operated with a third-party security partner; routes traffic through its servers by design. Redundant if you run your own VPN.' },

  // ---- unused-features (safe but user-dependent) ----
  'com.samsung.android.kidsinstaller': { name: 'Kids Mode installer', tier: 'recommended', desc: 'Installs Samsung Kids on demand; holds silent-install rights.' },
  'com.samsung.android.app.parentalcare': { name: 'Parental Care', tier: 'recommended', desc: 'Family supervision helper.' },
  'com.samsung.android.ipsgeofence': { name: 'Indoor positioning geofence', tier: 'recommended', desc: 'Indoor-location geofencing service.' },
  'com.samsung.android.dck.timesync': { name: 'Digital car key time-sync', tier: 'recommended', desc: 'Supports the digital car key feature.' },
  'com.samsung.petservice': { name: 'Pet service', tier: 'recommended', desc: 'Backend for pet-photo features.' },
  'com.swiftkey.swiftkeyconfigurator': { name: 'SwiftKey configurator', tier: 'recommended', desc: 'Settings shim for the preloaded SwiftKey keyboard.' },
  'com.touchtype.swiftkey': { name: 'Microsoft SwiftKey', tier: 'optional', desc: 'Preloaded third-party keyboard. Keep if it is your keyboard.' },
  'com.google.android.apps.restore': { name: 'Android Switch/Restore', tier: 'recommended', desc: 'Device-transfer tool; inert post-setup; holds install rights.' },
  'com.google.android.printservice.recommendation': { name: 'Print service recommender', tier: 'recommended', desc: 'Suggests print-service plugins.' },
  'com.samsung.android.aremojieditor': { name: 'AR Emoji editor', tier: 'recommended', desc: 'AR avatar creation/editing.' },
  'com.samsung.android.aremoji': { name: 'AR Emoji', tier: 'recommended', desc: 'AR avatar camera mode.' },
  'com.samsung.android.arzone': { name: 'AR Zone', tier: 'recommended', desc: 'AR camera feature hub.' },
  'com.sec.android.mimage.avatarstickers': { name: 'AR avatar stickers', tier: 'recommended', desc: 'Sticker packs for AR emoji.' },
  'com.samsung.android.stickercenter': { name: 'Sticker Center', tier: 'optional', desc: 'Keyboard/message sticker management.' },
  'com.samsung.android.tvplus': { name: 'Samsung TV Plus', tier: 'recommended', desc: 'Ad-supported streaming app.' },
  'com.samsung.android.game.gos': { name: 'Game Optimizing Service', tier: 'optional', desc: 'Game performance/thermal governor + telemetry. Disabling may change game thermals.' },
  'com.samsung.android.game.gametools': { name: 'Game Booster', tier: 'optional', desc: 'In-game overlay toolbar.' },
  'com.samsung.android.game.gamehome': { name: 'Game Launcher', tier: 'optional', desc: 'Game hub app.' },
  'com.samsung.android.app.taskedge': { name: 'Task Edge panel', tier: 'optional', desc: 'Edge-panel shortcuts. Disable if you do not use Edge panels.' },
  'com.samsung.android.app.clipboardedge': { name: 'Clipboard Edge panel', tier: 'optional', desc: 'Edge-panel clipboard.' },
  'com.samsung.android.allshare.service.mediashare': { name: 'DLNA media share', tier: 'optional', desc: 'Legacy media sharing to TVs/speakers.' },
  'com.samsung.android.audiomirroring': { name: 'Audio mirroring', tier: 'optional', desc: 'Casts audio to other devices.' },
  'com.samsung.android.da.daagent': { name: 'Dual Messenger', tier: 'optional', desc: 'Runs cloned second instances of messengers. Disabling breaks existing clones.' },
  'com.samsung.android.appseparation': { name: 'App separation', tier: 'optional', desc: 'Work-style app isolation; holds install rights.' },
  'com.sec.spp.push': { name: 'Samsung Push Service', tier: 'optional', desc: 'Delivery channel for Samsung app pushes incl. store/marketing notices; some Samsung-account notices arrive slower without it.' },
  'com.samsung.android.easysetup': { name: 'Nearby device setup', tier: 'optional', desc: 'Popups for pairing new Samsung devices (Buds etc.). Re-enable temporarily when pairing.' },
  'com.samsung.android.aware.service': { name: 'SmartThings Find mesh', tier: 'optional', desc: 'Offline-finding crowd network; affects locating your own devices offline.' },
  'com.samsung.android.beaconmanager': { name: 'Beacon manager', tier: 'optional', desc: 'BLE beacon scanning for nearby services.' },
  'com.samsung.android.scloud': { name: 'Samsung Cloud', tier: 'caution', desc: 'Samsung backup/sync. Disable only if you back up elsewhere (e.g. Google One).' },
  'com.samsung.android.samsungpass': { name: 'Samsung Pass', tier: 'caution', desc: 'Samsung password/identity manager. Disable only if you use another password manager.' },
  'com.samsung.android.smartswitchassistant': { name: 'Smart Switch assistant', tier: 'optional', desc: 'Device-transfer helper.' },
  'com.samsung.android.mocca': { name: 'Samsung shopping/benefits', tier: 'recommended', desc: 'Galaxy Store ecosystem promotions component.' },
  'com.samsung.android.smartsuggestions': { name: 'Smart suggestions', tier: 'recommended', desc: 'Suggested-content service.' },

  // ---- things that BREAK features (education only; never proposed) ----
  'com.sec.android.app.samsungapps': { name: 'Galaxy Store', tier: 'caution', desc: 'Samsung\'s app store; holds privileged rights to install and update apps in the background, and is the update channel for Samsung apps. Its Disable button is greyed out in Settings; can be disabled via ADB — Samsung apps then stop receiving updates outside firmware updates, which has security implications.' },
  'com.xiaomi.mipicks': { name: 'Preinstalled app store', tier: 'caution', desc: 'The manufacturer\'s own store; holds privileged install rights and is the update channel for preloaded apps. Disabling stops those updates, which has security implications.' },
  'com.heytap.market': { name: 'Preinstalled app store', tier: 'caution', desc: 'The manufacturer\'s own store; holds privileged install rights and is the update channel for preloaded apps. Disabling stops those updates, which has security implications.' },
  'com.bbk.appstore': { name: 'Preinstalled app store', tier: 'caution', desc: 'The manufacturer\'s own store; holds privileged install rights and is the update channel for preloaded apps. Disabling stops those updates, which has security implications.' },
  'com.huawei.appmarket': { name: 'Preinstalled app store', tier: 'caution', desc: 'The manufacturer\'s own store; holds privileged install rights and is the update channel for preloaded apps. Disabling stops those updates, which has security implications.' },
  'com.transsnet.store': { name: 'Preinstalled app store', tier: 'caution', desc: 'The manufacturer\'s own store; holds privileged install rights and is the update channel for preloaded apps. Disabling stops those updates, which has security implications.' },
  'com.samsung.android.honeyboard': { name: 'Samsung Keyboard', tier: 'keep', desc: 'Known bootloop trigger with DeX if disabled; keep even when using another keyboard.' },
  'com.sec.android.app.myfiles': { name: 'My Files', tier: 'keep', desc: 'Disabling can crash Settings screens.' },
  'com.samsung.android.app.smartcapture': { name: 'Samsung Capture', tier: 'keep', desc: 'Screenshots/screen recording break without it.' },
  'com.samsung.android.provider.filterprovider': { name: 'Camera filter provider', tier: 'keep', desc: 'Stock camera crashes without it.' },
  'com.samsung.android.app.dressroom': { name: 'Wallpaper and style', tier: 'keep', desc: 'The Settings > Wallpaper and style screen; fails silently if disabled.' },
  'com.sec.android.app.launcher': { name: 'One UI Home', tier: 'keep', desc: 'The launcher; recents/multitasking depend on it.' },
  'com.google.android.healthconnect.controller': { name: 'Health Connect', tier: 'keep', desc: 'Health-data hub used by fitness apps.' },
  'com.google.android.apps.setupwizard.searchselector': { name: 'Search choice screen', tier: 'keep', desc: 'EU-mandated (DMA) browser/search chooser; harmless.' },
  'com.samsung.android.smartmirroring': { name: 'Smart View', tier: 'caution', desc: 'Screen casting/mirroring; some builds misbehave when disabled.' },
  'com.samsung.android.app.omcagent': { name: 'Region config agent', tier: 'caution', desc: 'Applies region/carrier configuration after firmware updates.' },
};

// Tripwire packages: ordinary, legitimate apps whose PRESENCE is worth confirming, because
// public research and the case files behind this project have documented them arriving through
// preload/partner-campaign channels on some devices without a user request. Listing a package
// here is a statement about that delivery channel — never about the app or its maker.
// The partner-installer family below has been documented across several manufacturers,
// so it is checked on every device.
const GLOBAL_TRIPWIRES = [
  'com.aura.oobe', 'com.aura.oobe.samsung',
  'com.ironsource.appcloud.oobe', 'com.ironsource.appcloud.oobe.hutchison',
];

// Per-manufacturer profiles, matched on the device's reported manufacturer.
// Deliberately data-only: the checks read from this table and speak generically
// in the UI ("the preinstalled store"), so support is silent — no brand names
// are surfaced beyond what the device itself reports.
const VENDORS = [
  { id: 'samsung', match: /samsung/i, store: 'com.sec.android.app.samsungapps',
    tripwires: ['com.einnovation.temu', 'com.aks.notes.sam301', 'com.amazon.mp3', 'com.mygalaxy'] },
  { id: 'xiaomi', match: /xiaomi|redmi|poco/i, store: 'com.xiaomi.mipicks', tripwires: [] },
  { id: 'oppo', match: /oppo|realme|oneplus/i, store: 'com.heytap.market', tripwires: [] },
  { id: 'vivo', match: /vivo|iqoo/i, store: 'com.bbk.appstore', tripwires: [] },
  { id: 'transsion', match: /tecno|infinix|itel|transsion/i, store: 'com.transsnet.store', tripwires: [] },
  { id: 'huawei', match: /huawei|honor/i, store: 'com.huawei.appmarket', tripwires: [] },
];

// Small embedded stalkerware set: well-known, high-confidence package names, cross-checked
// against public indicator lists (see CREDITS.md). The full maintained list is at
// github.com/AssoEchap/stalkerware-indicators.
const STALKERWARE = [
  'com.lsdroid.cerberus', 'com.mspy.lite', 'com.thetruthspy', 'com.systemservice',
  'net.trackview', 'com.androidlost', 'com.hellospy.system', 'com.mobistealth.android',
  'com.retina.x', 'com.spy2mobile.light', 'com.spyhuman', 'com.xnspy',
];

// Settings baseline, grown from the hardening research behind this project,
// audited against a real device's settings snapshot. Read by the
// health check (privacy + security categories only) and by the Phone settings
// tab (all categories), which applies entries item by item with confirmation.
// `samsung: true` entries only appear on Samsung devices; `warn` marks a real
// trade-off — those are never bulk-selected, only chosen deliberately.
const SETTINGS_BASELINE = [
  // ---- privacy ----
  { cat: 'privacy', ns: 'secure', key: 'lock_screen_allow_private_notifications', want: '0', desc: 'Hide notification content on the lock screen' },
  { cat: 'privacy', ns: 'secure', key: 'clipboard_show_access_notifications', want: '1', desc: 'Warn when apps read the clipboard' },
  { cat: 'privacy', ns: 'global', key: 'send_action_app_error', want: '0', desc: 'No app-crash report prompts' },
  { cat: 'privacy', ns: 'global', key: 'wifi_scan_always_enabled', want: '0', desc: 'No background Wi-Fi location scanning' },
  { cat: 'privacy', ns: 'global', key: 'ble_scan_always_enabled', want: '0', desc: 'No background Bluetooth location scanning' },
  { cat: 'privacy', ns: 'global', key: 'wifi_wakeup_enabled', want: '0', desc: 'Wi-Fi does not turn itself on near saved networks (location-based)' },
  { cat: 'privacy', ns: 'global', key: 'assisted_gps_enabled', want: '0', desc: 'No assisted-GPS requests to carrier/Google servers', warn: 'the first GPS fix after a reboot becomes noticeably slower' },
  { cat: 'privacy', ns: 'secure', key: 'notification_history_enabled', want: '0', desc: 'Do not keep a history of dismissed notifications', unsetOk: true },
  { cat: 'privacy', ns: 'global', key: 'captive_portal_mode', want: '0', desc: 'No connectivity pings to Google when joining networks', warn: 'hotel/café Wi-Fi login pages will no longer pop up automatically' },
  { cat: 'privacy', ns: 'secure', key: 'samsung_errorlog_agree', want: '0', desc: 'Samsung diagnostics consent off', samsung: true },
  { cat: 'privacy', ns: 'secure', key: 'send_security_reports', want: '0', desc: 'Samsung security-report uploads off', samsung: true },
  // ---- security ----
  { cat: 'security', ns: 'global', key: 'package_verifier_user_consent', want: '1', desc: 'Play Protect verification on' },
  { cat: 'security', ns: 'global', key: 'verifier_verify_adb_installs', want: '1', desc: 'Verify apps installed over adb' },
  { cat: 'security', ns: 'global', key: 'adb_wifi_enabled', want: '0', desc: 'Wireless debugging off', unsetOk: true },
  { cat: 'security', ns: 'global', key: 'auto_time', want: '1', desc: 'Automatic date & time (correct time keeps TLS certificates valid)' },
  { cat: 'security', ns: 'global', key: 'auto_time_zone', want: '1', desc: 'Automatic time zone' },
  { cat: 'security', ns: 'global', key: 'stay_on_while_plugged_in', want: '0', desc: 'Screen does not stay awake while charging (adb work often switches this on)', unsetOk: true },
  { cat: 'security', ns: 'system', key: 'show_password', want: '0', desc: 'Do not briefly show password characters while typing' },
  // ---- leanness ----
  { cat: 'leanness', ns: 'global', key: 'wifi_networks_available_notification_on', want: '0', desc: 'No open-Wi-Fi nags' },
  { cat: 'leanness', ns: 'global', key: 'window_animation_scale', want: '0.5', desc: 'Snappier window animations' },
  { cat: 'leanness', ns: 'global', key: 'transition_animation_scale', want: '0.5', desc: 'Snappier screen transitions' },
  { cat: 'leanness', ns: 'global', key: 'animator_duration_scale', want: '0.5', desc: 'Snappier in-app animations' },
  { cat: 'leanness', ns: 'secure', key: 'skip_first_use_hints', want: '1', desc: 'Ask apps to skip their first-use hints and tips' },
  { cat: 'leanness', ns: 'system', key: 'sound_effects_enabled', want: '0', desc: 'Touch sounds off (pure taste — skip if you like them)' },
  { cat: 'leanness', ns: 'system', key: 'lockscreen_sounds_enabled', want: '0', desc: 'Lock/unlock sound off' },
  { cat: 'leanness', ns: 'global', key: 'charging_sounds_enabled', want: '0', desc: 'No charging chime' },
  { cat: 'leanness', ns: 'system', key: 'dtmf_tone_when_dialing', want: '0', desc: 'No dial-pad touch tones' },
  { cat: 'leanness', ns: 'global', key: 'mobile_data_always_on', want: '0', desc: 'Mobile data sleeps while on Wi-Fi (battery, less radio chatter)', warn: 'switching from Wi-Fi back to mobile data becomes a little slower' },
];

const TRUSTED_INSTALLERS = [
  'com.android.vending', 'com.sec.android.app.samsungapps', 'com.sec.android.easyMover',
  'com.android.settings', 'com.google.android.packageinstaller',
  'com.samsung.android.goodlock', 'com.samsung.android.app.omcagent', 'com.heytap.market',
  'com.xiaomi.market', 'com.xiaomi.mipicks', 'com.bbk.appstore', 'com.huawei.appmarket',
  'com.transsnet.store', 'com.oppo.market', 'com.amazon.venezia',
];

function forDevice(manufacturer) {
  const vendor = VENDORS.find(v => v.match.test(manufacturer || '')) || null;
  const samsung = !!vendor && vendor.id === 'samsung';
  return {
    samsung,
    vendorId: vendor ? vendor.id : null,
    storePkg: vendor ? vendor.store : null,
    kb: KB,
    tripwires: [...GLOBAL_TRIPWIRES, ...(vendor ? vendor.tripwires : [])],
    stalkerware: STALKERWARE,
    trustedInstallers: TRUSTED_INSTALLERS,
    settingsBaseline: samsung ? SETTINGS_BASELINE : SETTINGS_BASELINE.filter(s => !s.samsung),
  };
}


// Terminal command library — the pre-built commands offered in the Terminal
// view's sidebar. Every entry here is read-only by construction (each one is
// checked against src/terminal.js by the test suite), so clicking one can never
// change the phone. Entries are written for someone who has never used adb:
// `label` says what you learn, `cmd` is what actually runs.
//
//   {pkg}       — a placeholder the user fills in; the command is inserted into
//                 the prompt with the placeholder selected instead of running.
//   {store}     — replaced with this phone's preinstalled app store package;
//                 the entry is dropped on phones with no known vendor store.
//   vendor      — entry only appears on that manufacturer's devices.
const COMMANDS = [
  {
    id: 'device', title: 'Device & build',
    hint: 'What the phone says it is: model, Android version, patch level, hardware.',
    items: [
      { label: 'Model, brand and codename', cmd: "getprop | grep -E 'ro\\.product\\.(manufacturer|model|device|name)'", desc: 'The phone\'s own identity properties — what every app sees when it asks what device it is running on.' },
      { label: 'Android version and security patch', cmd: "getprop | grep -E 'ro\\.build\\.version\\.(release|sdk|security_patch)'", desc: 'Which Android release is installed and how recent the monthly security patch is. A patch date many months old means known fixes are missing.' },
      { label: 'Full build fingerprint', cmd: 'getprop ro.build.fingerprint', desc: 'The exact firmware build. Useful when comparing your phone against what the manufacturer says it should be running.' },
      { label: 'Every property the phone reports', cmd: 'getprop', desc: 'The complete property list — several hundred lines. Everything the other entries in this section pick out of.' },
      { label: 'Serial number', cmd: 'getprop ro.serialno', desc: 'The hardware serial. Handy when you file a support case; treat it as identifying information.' },
      { label: 'Region / carrier customisation code', cmd: 'getprop | grep -iE "csc|omc|carrier"', desc: 'Which regional or carrier firmware variant is installed. This decides which preloaded apps and update schedule your phone gets.' },
      { label: 'Kernel version', cmd: 'uname -a', desc: 'The Linux kernel this build runs on, with its build date.' },
      { label: 'Time since the last restart', cmd: 'uptime', desc: 'How long the phone has been running. A reboot you did not perform is worth noticing.' },
      { label: 'Screen size and density', cmd: 'wm size; wm density', desc: 'Resolution in pixels and the display density the interface is drawn at.' },
      { label: 'Phones this computer can see', cmd: 'adb devices -l', desc: 'Runs on this computer, not the phone: every device adb has a connection to. Use it when the app says no device is connected.' },
    ],
  },
  {
    id: 'apps', title: 'Apps & where they came from',
    hint: 'What is installed, who installed it, and when — the trail behind an app you did not ask for.',
    items: [
      { label: 'Apps you installed yourself', cmd: 'pm list packages -3', desc: 'Third-party packages: everything that did not ship with the firmware.' },
      { label: 'Every installed package', cmd: 'pm list packages', desc: 'All packages, system and third-party. Long list.' },
      { label: 'Preloaded system packages', cmd: 'pm list packages -s', desc: 'Everything that came with the firmware. This is where preinstalled stores, ad frameworks and vendor services live.' },
      { label: 'Disabled packages', cmd: 'pm list packages -d', desc: 'Packages currently switched off — by you, by this app, or by the system.' },
      { label: 'Who installed each app', cmd: 'pm list packages -i', desc: 'The installer of record for every package: the app that put it there. An app whose installer is a preinstalled store, rather than the Play Store or you, arrived through the vendor\'s own channel.' },
      { label: 'Install and update date of every app', cmd: "dumpsys package packages | grep -E 'Package \\[|firstInstallTime|lastUpdateTime'", desc: 'Long output, but it is the record that shows exactly when each app appeared on the phone — the fastest way to spot a cluster of installs you did not make.' },
      { label: 'Everything about one app', cmd: 'dumpsys package {pkg}', desc: 'The package manager\'s full record for a single app: version, install dates, installer, permissions, signatures.', arg: 'package name' },
      { label: 'Install date, updater and source of one app', cmd: "dumpsys package {pkg} | grep -E 'versionName|firstInstallTime|lastUpdateTime|installerPackageName|nitiatingPackageName|riginatingPackageName|packageSource|installReason'", desc: 'The provenance lines for one app: when it arrived, when it was last updated, and which app is on record as having installed it.', arg: 'package name' },
      { label: 'Install sessions the phone still remembers', cmd: 'dumpsys package installs', desc: 'Every install or update the phone has performed since its last restart, with the app that requested it. Kept in memory only, so it starts empty after a reboot.' },
      { label: 'Where an app\'s APK file lives', cmd: 'pm path {pkg}', desc: 'The on-device path of the installed package file. A path under /system or /vendor means it was preloaded in the firmware.', arg: 'package name' },
      { label: 'Apps allowed to install other apps', cmd: 'cmd appops query-op REQUEST_INSTALL_PACKAGES allow', desc: 'Which apps hold the right to install further apps. This is the permission behind an app appearing without you downloading it.' },
      { label: 'Your phone maker\'s app store — full record', cmd: 'dumpsys package {store}', desc: 'The complete package record for the preinstalled store on this phone: its version, its permissions and the install rights it holds.', needsStore: true },
      { label: 'Accounts and profiles on this phone', cmd: 'pm list users', desc: 'User profiles set up on the device. An unexpected extra profile is worth investigating.' },
    ],
  },
  {
    id: 'privacy', title: 'Permissions & privacy',
    hint: 'Which apps can reach your camera, microphone, location, notifications and screen.',
    items: [
      { label: 'Apps that may use the camera', cmd: 'cmd appops query-op CAMERA allow', desc: 'Every app currently allowed to open the camera.' },
      { label: 'Apps that may use the microphone', cmd: 'cmd appops query-op RECORD_AUDIO allow', desc: 'Every app currently allowed to record audio.' },
      { label: 'Apps that may read your location', cmd: 'cmd appops query-op COARSE_LOCATION allow', desc: 'Apps allowed to get your approximate location. Run the fine-location version for precise access.' },
      { label: 'Apps that may draw over other apps', cmd: 'cmd appops query-op SYSTEM_ALERT_WINDOW allow', desc: 'Overlay permission. Legitimate for chat bubbles and password managers; also the permission behind screen-overlay tricks.' },
      { label: 'Apps that can read all your notifications', cmd: 'settings get secure enabled_notification_listeners', desc: 'Notification listeners see the content of every notification, including message previews and one-time codes.' },
      { label: 'Accessibility services that are switched on', cmd: 'settings get secure enabled_accessibility_services', desc: 'Accessibility services can read the screen and act on your behalf. Genuinely needed by assistive tools — and the single most abused permission on Android.' },
      { label: 'Permissions granted to one app', cmd: "dumpsys package {pkg} | grep -E 'granted=true'", desc: 'Every permission an app currently holds, straight from the phone\'s own permission records.', arg: 'package name' },
      { label: 'Apps with device-administrator rights', cmd: 'dumpsys device_policy', desc: 'Device admins can lock, wipe or restrict the phone. Expect your employer\'s management app here — and nothing else.' },
      { label: 'Which app is your default browser', cmd: 'cmd role get-role-holders android.app.role.BROWSER', desc: 'Swap BROWSER for DIALER, SMS or HOME to see the other defaults.' },
      { label: 'Keyboards installed on the phone', cmd: 'ime list -s', desc: 'Every input method available. A keyboard you do not recognise sees everything you type.' },
    ],
  },
  {
    id: 'security', title: 'Security state',
    hint: 'Boot integrity, encryption, debugging — the settings that decide how hard your phone is to tamper with.',
    items: [
      { label: 'Bootloader and verified-boot state', cmd: "getprop | grep -E 'verifiedboot|flash\\.locked|warranty'", desc: '"green" and "locked" mean the phone booted firmware it could verify, with the bootloader closed. Anything else means the boot chain has been opened.' },
      { label: 'Storage encryption state', cmd: 'getprop ro.crypto.state', desc: '"encrypted" is the expected answer on any modern Android phone.' },
      { label: 'SELinux enforcement', cmd: 'getenforce', desc: '"Enforcing" is normal. "Permissive" means Android\'s mandatory access controls are switched off.' },
      { label: 'Is USB debugging switched on?', cmd: 'settings get global adb_enabled', desc: '1 means on. It has to be on for this app to work — turn it back off when you are done.' },
      { label: 'Are apps installed over adb verified?', cmd: 'settings get global verifier_verify_adb_installs', desc: '1 means Android still scans apps installed over a cable. Leaving this on costs nothing.' },
      { label: 'Is a root binary present?', cmd: 'which su', desc: 'An empty answer is the good one on a normal phone: no root shell available.' },
      { label: 'Knox warranty bit', cmd: 'getprop ro.boot.warranty_bit', desc: '0 means the device\'s hardware-backed warranty flag has never been tripped by unofficial firmware.', vendor: 'samsung' },
      { label: 'Screen-lock state', cmd: 'locksettings get-disabled', desc: 'Whether the lock screen has been disabled. "false" means a lock is in place.' },
    ],
  },
  {
    id: 'network', title: 'Network & connections',
    hint: 'How the phone is connected, where its DNS goes, and what is talking to the network.',
    items: [
      { label: 'Current connection summary', cmd: 'dumpsys connectivity | head -40', desc: 'Which network is active — Wi-Fi, mobile or VPN — and its state.' },
      { label: 'IP addresses', cmd: 'ip addr', desc: 'Every network interface and the addresses assigned to it.' },
      { label: 'Private DNS setting', cmd: 'settings get global private_dns_mode; settings get global private_dns_specifier', desc: 'Whether encrypted DNS is on and which resolver it uses. "off" means DNS queries travel in the clear.' },
      { label: 'HTTP proxy setting', cmd: 'settings get global http_proxy', desc: 'A proxy you did not configure means someone routed the phone\'s traffic through a server of their choosing.' },
      { label: 'VPN state', cmd: 'dumpsys connectivity | grep -i vpn', desc: 'Whether a VPN is active and which app provides it.' },
      { label: 'Open network connections', cmd: 'netstat -tun', desc: 'Sockets currently open. A snapshot, not a monitor — run it a few times to see what recurs.' },
      { label: 'Background Wi-Fi scanning', cmd: 'settings get global wifi_scan_always_enabled', desc: '1 means the phone keeps scanning for Wi-Fi networks for location purposes even when Wi-Fi is switched off.' },
    ],
  },
  {
    id: 'battery', title: 'Battery & background activity',
    hint: 'What is running, what is exempt from Android\'s power limits, and what is draining the battery.',
    items: [
      { label: 'Battery level, health and temperature', cmd: 'dumpsys battery', desc: 'The raw battery record: charge level, health, temperature in tenths of a degree, and charging state.' },
      { label: 'Apps exempt from battery optimisation', cmd: 'dumpsys deviceidle whitelist', desc: 'Apps allowed to keep working while the phone is idle. Every entry here is an app that can run whenever it likes.' },
      { label: 'Apps blocked from background work', cmd: 'cmd appops query-op RUN_ANY_IN_BACKGROUND ignore', desc: 'Apps you (or Android) have restricted from running in the background.' },
      { label: 'What is running right now', cmd: 'ps -A -o PID,USER,NAME | head -40', desc: 'Live process list. Every running app and system service.' },
      { label: 'Busiest processes', cmd: 'top -b -n 1 -m 15', desc: 'A single snapshot of the fifteen processes using the most CPU.' },
      { label: 'Running background services', cmd: 'dumpsys activity services | head -60', desc: 'Services currently alive — the background work apps are doing without a screen of their own.' },
      { label: 'Battery use since the last full charge', cmd: 'dumpsys batterystats --charged | head -60', desc: 'Android\'s own accounting of which apps spent the battery.' },
    ],
  },
  {
    id: 'storage', title: 'Storage & memory',
    hint: 'Where the space and memory went.',
    items: [
      { label: 'Free space', cmd: 'df -h', desc: 'Space used and free on each mounted volume. /data is the one that holds your apps and files.' },
      { label: 'Biggest folders in shared storage', cmd: 'du -sh /sdcard/* 2>/dev/null | sort -h | tail -20', desc: 'The twenty largest folders in your shared storage, smallest to largest.' },
      { label: 'Memory', cmd: 'cat /proc/meminfo | head -5', desc: 'Total and available RAM as the kernel reports it.' },
      { label: 'Memory used per app', cmd: 'dumpsys meminfo | head -50', desc: 'Which processes are holding the most memory.' },
    ],
  },
  {
    id: 'logs', title: 'Logs & diagnostics',
    hint: 'The phone\'s live log. This is where an install or a crash leaves its trace.',
    items: [
      { label: 'Last 200 log lines', cmd: 'logcat -d -t 200', desc: 'A snapshot of the system log. -d means "dump what is there and stop", so it never runs forever.' },
      { label: 'Recent errors only', cmd: 'logcat -d -t 300 *:E', desc: 'The same log filtered down to error-level messages.' },
      { label: 'App crashes', cmd: 'logcat -d -b crash -t 200', desc: 'The dedicated crash buffer: what failed and why.' },
      { label: 'Package installs and removals in the log', cmd: "logcat -d -t 1000 | grep -iE 'packagemanager|packageinstaller|installd'", desc: 'Install activity as the system logged it. The log only goes back a few hours, so run it soon after something appears.' },
      { label: 'Recently used apps', cmd: 'dumpsys usagestats | head -60', desc: 'Android\'s usage records — which apps were in the foreground and when.' },
      { label: 'Recent screens', cmd: 'dumpsys activity recents | head -40', desc: 'The recent-apps list as the system holds it.' },
    ],
  },
];

// The library as one connected phone should see it: vendor-gated entries dropped
// where they do not apply, {store} resolved to this phone's preinstalled store.
function commandLibrary(manufacturer) {
  const { vendorId, storePkg } = forDevice(manufacturer);
  const out = [];
  for (const cat of COMMANDS) {
    const items = cat.items
      .filter(it => (!it.vendor || it.vendor === vendorId) && (!it.needsStore || storePkg))
      .map(it => ({
        label: it.label,
        desc: it.desc,
        cmd: it.cmd.replace('{store}', storePkg || ''),
        arg: it.arg || null,
      }));
    if (items.length) out.push({ id: cat.id, title: cat.title, hint: cat.hint, items });
  }
  return out;
}

module.exports = { forDevice, KB, COMMANDS, commandLibrary };
