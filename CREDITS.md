# Credits & attribution

Phone Checker's package knowledge base is written in my own words, grounded in
first-hand device forensics (a documented 2026 investigation of unrequested app installs
delivered through a manufacturer's pre-installed, privileged store) and cross-checked
against public community research.
**No third-party code or data files are copied into this project.** Facts about what a
package does are facts; the descriptions here are mine. I'm still grateful for the
community work that informed the research:

- **Universal Android Debloater Next Generation** (Universal Debloater Alliance) —
  the reference community effort for per-manufacturer package safety tiers. Its curated
  lists are GPL-licensed and are deliberately *not* embedded here; users who want them
  should use UAD-NG itself. https://github.com/Universal-Debloater-Alliance/universal-android-debloater-next-generation
- **khlam** — long-standing manufacturer ADB debloat command reference, including warnings
  about packages whose removal breaks the camera and capture features.
  https://github.com/khlam/debloat-samsung-android
- **itxjobe** — recent flagship-device package research, including the stock-keyboard /
  desktop-mode interaction warning. https://github.com/itxjobe/samsungdebloat
- **Willie169** — categorized manufacturer package documentation, including file-manager /
  launcher dependency warnings. https://github.com/Willie169/Samsung-Android-Debloat-List
- **Echap / stalkerware-indicators** — the maintained public stalkerware IOC list,
  licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Their full list is not bundled; the app ships only a small built-in set of
  well-known stalkerware package names, cross-checked against public indicator lists
  including theirs. https://github.com/AssoEchap/stalkerware-indicators
- Security-research coverage of OEM preload channels (SMEX, Malwarebytes, and others)
  that documented the AppCloud/Aura ecosystem this app's tripwires watch for.

## Android documentation

Everything the app does on the phone is documented, user-level Android behavior:

- **Android Debug Bridge (adb)** — the official reference for USB debugging, per-computer
  authorization, `pm list packages` (including the `-3 -d -u -i` filters the app uses) and
  `adb pull`. https://developer.android.com/tools/adb
- **Optimize for Doze and App Standby** — Doze, App Standby and the battery-optimization
  exemption list; the model behind the app's Restricted / Optimized / Unrestricted battery
  states. https://developer.android.com/training/monitoring-device-state/doze-standby
- **AppOpsManager** — API reference for the app-operations layer the `appops` commands read
  and set. https://developer.android.com/reference/android/app/AppOpsManager

## Further reading

Research on preinstalled software across many manufacturers, for readers who want the wider
picture:

- **Gamba, Rashed, Razaghpanah, Tapiador, Vallina-Rodriguez — "An Analysis of Pre-installed
  Android Software"** (IEEE Symposium on Security and Privacy, 2020; Best Practical Paper).
  82,000 preinstalled apps across 1,700 devices from 214 brands.
  https://ieeexplore.ieee.org/document/9152633/
- **Privacy International — "Research Methodology: Pre-installed Android App Analysis"** —
  a vendor-neutral method for pulling and examining preloads over ADB.
  https://privacyinternational.org/explainer/3232/research-methodology-pre-installed-android-app-analysis

Android, Google Play, and all other product, manufacturer and project marks are trademarks
of their respective owners, used here only to identify compatibility and sources.
