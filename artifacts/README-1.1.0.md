# LockIN

**A little less noise. A lot more you.**

A local desktop distraction blocker built with **Svelte 5, TypeScript, Tauri 2, and Rust**, with a Chrome Manifest V3 companion extension. The desktop app owns your configuration and sessions; the extension enforces the network rules.

## Run

Requirements: Node.js 22.12+ (or Node.js 24+), Rust, Windows C++ Build Tools, and WebView2. Native host pairing is implemented for Windows.

```powershell
npm install
npm run tauri dev
```

For a UI preview, run `npm run dev` and open `http://127.0.0.1:1420`. Browser previews use local storage and simulate the session UI. **Real blocking requires the desktop app and paired extension.**

## Connect Chrome

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose this project's `extension` folder.
3. Copy the 32-letter extension ID.
4. In the **desktop app**, click **Chrome extension**, paste the ID, and click **Connect extension**.
5. Open the extension popup and click **Reconnect to desktop**. The desktop connection indicator turns green after a successful rule sync.

Pairing registers `com.lockin.bridge` under the current user's Chrome and Edge native messaging registry keys; it does not need administrator access. The host manifest points to the app executable. Pair again if you move/reinstall the executable or switch between development and installed builds.

## What works

- Manually add, edit, remove, search, and toggle websites. URLs are normalized to their domain.
- Create and customize categories, toggle a whole category, and start a session for that category.
- Drag to reorder websites or drop them onto sidebar categories. Hold Ctrl while dragging to copy.
- Select a website, then use **Ctrl+C / Ctrl+X / Ctrl+V**, **Delete**, **Ctrl+Z**, and **Ctrl+Shift+Z / Ctrl+Y**. Paste into the category selected in the sidebar. The row menu provides edit, copy, cut, move, and remove actions.
- Choose or save custom duration tags from 1 to 1,440 minutes. Tags are ordered by actual usage. Manage saved times in Settings → General. Sessions survive app restarts.
- Repeat schedules on selected weekdays, including overnight periods. Schedules follow the device's local timezone, including daylight saving transitions.
- Protect early session termination with a custom phrase, 0–10 reflection steps, and a waiting period up to 30 minutes. Rust validates these steps and persists progress across restarts.
- Enable **Test mode** in Settings → General for manual sessions that can end immediately and active schedules that can be edited, paused, or deleted. A regular manual session keeps its original unlock protection.
- Preview a custom accent and click **Save accent** to add it to your reusable palette. The theme colors surfaces, borders, illustration, controls, and icons. The extension follows the saved theme/accent, including its toolbar icon and badge. All UI copy is in English.
- Windows tray with a live countdown icon, tooltip, and menu. Closing the window hides LockIN in the tray; click its icon to reopen it. Quit from the tray menu after protected Lights Out finishes (or while in test mode).
- Add Windows applications by selecting their `.exe` files. Include them in manual sessions and category schedules. An explicit confirmation precedes manual sessions that close applications.
- Local session totals, offline fonts, local persistence, and no analytics or accounts.

## Blocking behavior

The extension uses Chrome's `declarativeNetRequest` **block** action. It blocks requests to each selected domain and its subdomains, plus requests initiated by pages on those domains, including fetch/XHR, media, and WebSockets. Newly blocked tabs reload to terminate existing connections. Chrome displays its own blocked-request error rather than a custom interstitial.

The extension controls network access **inside the connected Chrome profile**. It does not disable the computer's internet connection or cover unpaired browsers or incognito profiles. Related domains are separate: add `twitter.com` alongside `x.com`, or `youtu.be` alongside `youtube.com`, if you want those covered too. Browser-internal pages and already downloaded local content are outside the extension's scope.

The extension caches the last desktop configuration, keeps rules across browser restarts, and evaluates timer and schedule boundaries locally. A native messaging connection normally syncs every two seconds; Chrome alarms provide reconciliation after service-worker suspension. Sleep or browser suspension can delay a boundary until Chrome resumes.

Schedules include **every website and application in the selected categories**, regardless of their Overview switches. Creating, editing, or enabling a schedule that includes the current time asks for **Close**, **Accept**, or **Next time**. Close discards the proposed change; Accept starts the current occurrence; Next time saves the schedule but skips only this occurrence, including overnight periods.

Outside test mode, active schedules cannot be edited, paused, or removed until their end time, and protected domains/apps cannot be removed from active coverage. Manual session domains and executable paths are frozen at session start. Overlapping schedules and sessions keep an item blocked until all applicable periods finish.

Application blocking uses a Rust guard that inspects matching executable paths every 250 ms and terminates selected processes, including new launches. **Apps can briefly start before the guard closes them.** This is not a Windows policy that denies execution before process creation. Keep LockIN running in the tray. Save work in selected apps before a manual session or scheduled interval; those apps are closed automatically. Windows system executables and LockIN itself are excluded. Elevated applications may require matching administrator privileges; access failures are shown in Applications. Apps with the same filename in a different folder are not targeted.

LockIN is a personal focus tool. A user with control of Chrome or the local configuration can disable the extension, edit saved data, or change the system clock. It is not an administrator-enforced firewall.

## Storage and architecture

- `src/`: Svelte UI, typed model, and Tauri/browser storage adapter.
- `src-tauri/`: Rust session authority, validation, atomic JSON persistence, tray countdown, executable guard, Windows bridge registration, and native messaging host.
- `extension/`: Read-only browser companion, network rules, schedule reconciliation, and popup.
- `%LOCALAPPDATA%\LockIN\state.json`: Desktop state, active session, history, and unlock progress.
- `%LOCALAPPDATA%\LockIN\com.lockin.bridge.json`: Native host manifest.

Chrome starts a separate instance of the same executable in native messaging mode. That instance reads the saved configuration, so blocking and schedules continue after the desktop window closes. Only the desktop app can change session state through its command API. Native messages do not accept writes.

## Build and verify

```powershell
npm run check
npm run build
npx playwright install chromium
npm test
npm run test:rust
npm run tauri build
```

After building, `node scripts/smoke-native.mjs` checks the executable's native messaging protocol in an isolated temporary data folder. `node scripts/smoke-desktop.mjs` launches an isolated WebView2 instance and verifies the actual Rust commands reject premature unlocks and persist progress. Temporary test data is removed afterward.

If another LockIN instance is open, build the desktop smoke binary with `npm run tauri build -- --debug --no-bundle --config tests/tauri-smoke.conf.json`, then run `node scripts/smoke-desktop.mjs src-tauri/target/debug/lockin.exe`. That configuration uses a separate Windows instance identifier, so verification does not focus or alter your running app. It also verifies native drag-and-drop, a ticking tray countdown, and real executable termination/relaunch protection with a harmless test process.

For an update, quit the older app before launching the new one. Reload the extension at `chrome://extensions`, pair its ID in the updated desktop app, and click **Reconnect to desktop** in the popup. Reconnect replaces an existing native host connection so the new executable is used.

The Windows installer is written to `src-tauri/target/release/bundle/nsis/`. Load the unpacked extension separately; it is not published to the Chrome Web Store.

Fonts are bundled under `public/fonts` with their SIL Open Font License files. Run `python scripts/vendor-fonts.py` to refresh them. The app makes no external network calls for fonts, icons, or analytics.
