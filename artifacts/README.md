# LockIN 1.3.1

This patch fixes two independent failures:

- Chrome could keep launching the 1.2 executable after the desktop was upgraded. That host could not read category timers and its update command restored its own older companion.
- A long URL keyword could exceed Chrome's compiled-regex limit. Its rejected rule incorrectly stopped the entire update, including all website domain rules, even while navigation filtering still worked.

## Install

1. Quit the old desktop app from the tray. Wait for protected regular sessions to finish if Quit is unavailable.
2. Run `LockIN_1.3.1_x64-setup.exe`, then open the installed app. Existing websites, categories, timers, and protection preferences are preserved.
3. The app repairs its existing bridge registration and refreshes an existing managed companion folder. In the companion, click **Reconnect to desktop** once to close any already-running older native host. It should show **Companion 1.3.1 · Bridge 1.3.1**.
4. If your extension uses a different folder, use **Chrome extension → Prepare / update companion → Open folder**, load that managed folder once in Chrome, and pair its ID.

The companion refuses update commands from an older bridge and refuses automatic reloads into an older version. The desktop also rejects bundle downgrades. A plain old heartbeat no longer produces a green current-bridge connection indicator.

Website domain rules are now applied even when a keyword's encoded network regex exceeds Chrome's limit. That keyword retains basic network matching and decoded navigation filtering. The popup reports this fallback; encoded resource requests for unusually long keywords have more limited network filtering.

The existing 1.3.0 optional Windows network service remains compatible with this patch. No service installation or firewall block was performed as part of this repair.

Verified with the UI/Chrome suite, Rust unit tests, isolated native desktop smoke checks, and a real Chrome-to-native-host regression test. Blocking was also confirmed in the user's existing Chrome profile after repairing the bridge and updating the companion.
