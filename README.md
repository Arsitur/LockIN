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

Version **1.3.1** repairs an existing native-host registration when the desktop starts, preserving paired extension IDs. If an older host process is already connected, click **Reconnect to desktop** once after upgrading. Later patched hosts also reconnect when their registered executable changes. The popup displays both companion and bridge versions and refuses companion downgrades.

1. In the desktop app, open **Chrome extension → Prepare / update companion → Open folder**. The managed folder is `%LOCALAPPDATA%\LockIN\chrome-extension`.
2. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose that managed folder. This is a one-time setup. The project's `extension` folder and the versioned ZIP remain available for development/manual installation.
3. Copy the 32-letter extension ID.
4. In the **desktop app**, click **Chrome extension**, paste the ID, and click **Connect extension**.
5. Open the extension popup and click **Reconnect to desktop**. The desktop connection indicator turns green after a successful rule sync.

Pairing registers `com.lockin.bridge` under the current user's Chrome and Edge native messaging registry keys; it does not need administrator access. The host manifest points to the app executable. Pair again if you move/reinstall the executable or switch between development and installed builds.

For future companion updates, click **Prepare / update companion** in the app or **Update companion** in the popup. Files in the managed folder are replaced and the loaded extension reloads automatically. An extension loaded from a different folder cannot silently switch its installation path; load the managed folder once and pair its new ID. Use the 1.3 companion with the 1.3 desktop app. The desktop also provides a read-only compatibility view for the previous companion while you update it.

Updating from an older executable previously allowed that executable to overwrite the companion with its own older bundle. The desktop now updates the registered path, checks applied-rule receipts from the current host, and refuses to overwrite newer companion files. The new manifest is published after all companion scripts have been copied.

Press **Alt+Shift+L** in Chrome (or use the page context menu) to open quick add. The current domain is prefilled; choose a category to add it. The desktop app must be running, including in the tray. The native host queues this narrow request to the desktop authority instead of independently rewriting saved configuration.

## What works

- Manually add, edit, remove, search, and toggle websites. URLs are normalized to their domain.
- Create and customize categories, toggle a whole category, and start independent timers for categories, websites, and applications. Overview stays available while other timers run; each target remembers its last duration.
- More than 20 category colors, any custom hex color, and 32 searchable category icons. Appearance → Website icons switches between bundled brand SVG logos and a per-website custom icon.
- Drag to reorder websites or drop them onto sidebar categories. Hold Ctrl while dragging to copy.
- Select a website, then use **Ctrl+C / Ctrl+X / Ctrl+V**, **Delete**, **Ctrl+Z**, and **Ctrl+Shift+Z / Ctrl+Y**. Paste into the category selected in the sidebar. The row menu provides edit, copy, cut, move, and remove actions.
- Choose or save custom duration tags from 1 to 1,440 minutes. Tags are ordered by actual usage. Manage saved times in Settings → General. Sessions survive app restarts.
- Repeat schedules on selected weekdays, including overnight periods. Schedules follow the device's local timezone, including daylight saving transitions.
- Choose a category in **Unlock protection** to set its phrase, 0–10 reflection steps, and waiting period up to 30 minutes. Every timer snapshots its own protection. Rust validates each timer independently and persists its unlock progress across restarts.
- Enable **Test mode** in Settings → General for manual sessions that can end immediately and active schedules that can be edited, paused, or deleted. A regular manual session keeps its original unlock protection.
- Preview a custom accent and click **Save accent** to add it to your reusable palette. The theme colors surfaces, borders, illustration, controls, and icons. The extension follows the saved theme/accent, including its toolbar icon and badge. All UI copy is in English.
- Windows tray with a live countdown to the next ending timer, the active timer count, tooltip, and menu. Closing the window hides LockIN in the tray; click its icon to reopen it. Quit from the tray menu after protected Lights Out finishes (or while in test mode).
- Add Windows applications by selecting their `.exe` files. Include them in manual sessions and category schedules. An explicit confirmation precedes manual sessions that close applications.
- Local session totals, offline fonts, local persistence, and no analytics or accounts.
- Overview shows **Locked until** on active categories. New websites added or moved into a category protected by a manual session inherit its remaining lock; schedules always include every item in their categories. Inherited domains remain blocked through the current session even if removed from the list afterward.

## Independent timers (1.3)

- In **Overview**, click the timer on a category card or beside a website, choose its minutes, then **Start timer**. Applications have the same timer action.
- Category timers include every website/application in that category, including disabled inclusion switches and new items added during the lock. The large **Lights Out** button starts one independent timer for each selected category.
- **Active timers** shows each countdown and unlock action. Start other timers while these run. A website covered by several timers or schedules stays unavailable until all its applicable locks finish.
- Each category and website remembers its last duration. Saved duration tags remain available and sort by usage.
- In **Settings → Filtering & protection**, select the category before configuring its URL filter or strict network guard. In **Unlock protection**, select the category before configuring its unlock journey. Active regular category policies stay protected; inactive categories remain editable.
- Existing settings are copied into each category on upgrade. An existing single focus session is migrated without resetting its end time or unlock progress.

## URL keyword filtering

Chrome can reject a long keyword's expanded encoded-URL regular expression. Such a rejection no longer cancels website blocking: supported encoded rules are kept, longer words fall back to basic network matching and decoded navigation checks, and the popup explains the fallback. Some encoded resource requests for those longer words rely on navigation filtering rather than a network regex. Domain rules remain applied independently of that limitation.

Open **Settings → Filtering & protection** to enable the URL filter and edit its words for a category. Starter words are `porn`, `sex`, `hentai`, and `fuck`; the filter is initially off so you can review the list. Choose a category first. Its enabled filter applies only while that category has a timer, an individually timed target, or an active schedule. Words from all active categories are combined; an inactive category contributes no words.

Chrome blocks matching requests before they reach the server, including Google search query strings, uppercase text, and repeated percent encoding. Single-page navigation and URL fragment changes also trigger a local blocked page. Matching is a substring anywhere in the address: `sex` also matches `essex`. This does not inspect page text or images. Existing cached/downloaded content is outside network request filtering. Filtering settings stay protected during regular Lights Out.

## Optional strict Windows network guard

An ordinary unpacked Chrome extension cannot make itself impossible to disable or uninstall. Google restricts force installation of off-store extensions to managed environments; see [Google's Windows extension policy documentation](https://support.google.com/chrome/a/answer/7532015?hl=EN). LockIN therefore provides a separate, optional Windows service rather than presenting a browser-only switch as tamper-proof.

1. In **Settings → Filtering & protection**, select **Set up Windows service**, review the behavior, and approve the Windows administrator/UAC prompt.
2. Wait for **Service ready**. Windows Defender Firewall must be enabled on all profiles; LockIN reports a configuration error instead of claiming protection when it is off.
3. Turn on **Strict network protection**. Connect the Chrome companion before starting a manual strict session.

During strict Lights Out, the service records the current deadline in an administrator-protected folder. If the companion is disabled, removed, closed, or stops responding, after the heartbeat timeout (about six seconds, subject to system load) it enables a named Windows Firewall rule that blocks **all outbound network traffic across the computer**, including other apps and browsers. Once triggered, reconnecting the extension does not release that lock. It ends at the recorded deadline. The service runs independently of the desktop window and starts with Windows; the deadline is persisted across restarts.

Strict sessions cannot end early. Test mode does not arm new strict locks, and strict protection cannot be switched to test mode during an active regular lock. Do companion/service updates while strict Lights Out is inactive. Setup alone does not block traffic, and this feature remains off until explicitly enabled.

This is protection against the simple browser disable/remove bypass, not protection against all local tampering: editing local configuration/heartbeat files or using administrator privileges to change services, firewall rules, or the clock can undermine it. It does not make an unpacked extension itself undeletable. The privileged installer and live firewall enforcement have **not been executed against the development computer**; unit tests cover the watchdog deadline/latch/restart behavior, and normal desktop/extension behavior is exercised separately.

Strict network protection is configured separately for each category and arms only for its active regular timers or schedules. If you already installed the 1.2 service, use **Update Windows service** after existing locks finish; 1.3 requires the updated service to understand independent timers. The service is not installed or activated by building or testing the app.

The service is `LockINNetworkGuard`; its protected executable, configuration, status, and deadline are in Windows' ProgramData known folder under `LockINNetworkGuard`. Only the app's named firewall rule, `LockIN.StrictNetworkGuard.Outbound`, is changed. Other firewall policies are preserved.

Administrator emergency recovery, if needed: run the installed application with `--recover-network-guard` from an **elevated** terminal. This places a protected recovery signal, disables only LockIN's firewall rule, and lets the service stop. Reinstall/update the service through the app to re-arm it afterward. The inactive service can be removed with `sc.exe delete LockINNetworkGuard` from an elevated terminal.

## Blocking behavior

The extension uses Chrome's `declarativeNetRequest` **block** action. It blocks requests to each selected domain and its subdomains, plus requests initiated by pages on those domains, including fetch/XHR, media, and WebSockets. Newly blocked tabs reload to terminate existing connections. Chrome displays its own blocked-request error rather than a custom interstitial.

The extension controls network access **inside the connected Chrome profile**. It does not disable the computer's internet connection or cover unpaired browsers or incognito profiles. Related domains are separate: add `twitter.com` alongside `x.com`, or `youtu.be` alongside `youtube.com`, if you want those covered too. Browser-internal pages and already downloaded local content are outside the extension's scope.

The extension caches the last desktop configuration, keeps rules across browser restarts, and evaluates timer and schedule boundaries locally. A native messaging connection normally syncs every two seconds; Chrome alarms provide reconciliation after service-worker suspension. Sleep or browser suspension can delay a boundary until Chrome resumes.

Schedules include **every website and application in the selected categories**, regardless of their Overview switches. Creating, editing, or enabling a schedule that includes the current time asks for **Close**, **Accept**, or **Next time**. Close discards the proposed change; Accept starts the current occurrence; Next time saves the schedule but skips only this occurrence, including overnight periods.

Outside test mode, active schedules cannot be edited, paused, or removed until their end time, and protected domains/apps cannot be removed from active coverage. Category timers preserve their original domains and paths and extend to newly added items in their protected categories. Individual website/app timers cover only their own targets. Ending one timer never releases another timer or an active schedule. Overlapping schedules and sessions keep an item blocked until all applicable periods finish.

Application blocking uses a Rust guard that inspects matching executable paths every 250 ms and terminates selected processes, including new launches. **Apps can briefly start before the guard closes them.** This is not a Windows policy that denies execution before process creation. Keep LockIN running in the tray. Save work in selected apps before a manual session or scheduled interval; those apps are closed automatically. Windows system executables and LockIN itself are excluded. Elevated applications may require matching administrator privileges; access failures are shown in Applications. Apps with the same filename in a different folder are not targeted.

LockIN is a personal focus tool. Its optional network guard adds an administrator-installed firewall service, but does not make the device tamper-proof.

## Storage and architecture

- `src/`: Svelte UI, typed model, and Tauri/browser storage adapter.
- `src-tauri/`: Rust session authority, validation, atomic JSON persistence, tray countdown, executable guard, Windows bridge registration, and native messaging host.
- `extension/`: Browser companion, URL/domain rules, schedule reconciliation, quick add, and popup.
- `%LOCALAPPDATA%\LockIN\state.json`: Desktop state, independent active timers, category policies, history, and per-timer unlock progress.
- `%LOCALAPPDATA%\LockIN\com.lockin.bridge.json`: Native host manifest.

Chrome starts a separate instance of the same executable in native messaging mode. It reads the saved configuration and can queue a validated quick-add request or refresh the fixed managed-extension folder. The desktop app owns state changes and rejects stale configuration revisions so a browser addition cannot silently disappear under a concurrent edit.

## Build and verify

```powershell
npm run check
npm run build
npx playwright install chromium
npm test
npm run test:rust
npm run tauri build
```

The real Chrome/native bridge regression test uses only a temporary Chrome profile, disposable state, and a uniquely named registry host. After building the verification executable, run `$env:LOCKIN_TEST_NATIVE_EXE = (Resolve-Path 'src-tauri/target/debug/lockin.exe').Path`, then `npx playwright test tests/bridge-native.spec.ts`. It reproduces a 1.2 host, verifies the companion refuses its timer-less snapshot, repairs the test registration, and verifies that Chrome blocks an actual request after connecting to the current executable.

After building, `node scripts/smoke-native.mjs` checks the executable's native messaging protocol in an isolated temporary data folder. `node scripts/smoke-desktop.mjs` launches an isolated WebView2 instance and verifies the actual Rust commands reject premature unlocks and persist progress. Temporary test data is removed afterward.

If another LockIN instance is open, build the desktop smoke binary with `npm run tauri build -- --debug --no-bundle --config tests/tauri-smoke.conf.json`, then run `node scripts/smoke-desktop.mjs src-tauri/target/debug/lockin.exe`. That configuration uses a separate Windows instance identifier, so verification does not focus or alter your running app. It also verifies native drag-and-drop, a ticking tray countdown, and real executable termination/relaunch protection with a harmless test process.

For an update, quit the older app before launching the new one. Reload the extension at `chrome://extensions`, pair its ID in the updated desktop app, and click **Reconnect to desktop** in the popup. Reconnect replaces an existing native host connection so the new executable is used.

The Windows installer is written to `src-tauri/target/release/bundle/nsis/`. Load the unpacked extension separately; it is not published to the Chrome Web Store.

Fonts are bundled under `public/fonts` with their SIL Open Font License files. Run `python scripts/vendor-fonts.py` to refresh them. The app makes no external network calls for fonts, icons, or analytics.
