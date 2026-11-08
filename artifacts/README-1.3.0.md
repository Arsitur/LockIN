# LockIN 1.3.0

1. Quit the old LockIN from its tray after any protected focus time ends.
2. Run `LockIN_1.3.0_x64-setup.exe`, then open LockIN. Your saved categories and sites are retained.
3. Open **Chrome extension → Prepare / update companion**. A companion already loaded from the managed folder reloads itself. If you use an old extracted folder, load the managed folder shown by **Open folder** in `chrome://extensions` and pair its ID once.
4. If needed, pair the extension again in the new installed app and click **Reconnect to desktop**.

## Use the new controls

- **Overview:** click a category’s timer or the clock beside a website, enter its duration, then **Start timer**. You can keep starting other targets while timers run.
- **Active timers:** each card has its own countdown and unlock button. Ending one timer leaves other timers and schedules intact.
- **Applications:** use the clock beside an app to give it its own timer; save work before confirming.
- **Settings → Filtering & protection:** select a category for its keywords and optional strict network setting. Its filter runs only during its own locks, including individual targets and schedules.
- **Unlock protection:** select a category to configure its own phrase, reflection steps, and mandatory wait. Each running timer keeps its own protection and progress.
- Durations are remembered per category/website. Your old global filtering/protection preferences are copied to each category once.
- The tray shows the next timer to finish and the active count.

## Optional Windows service

If you already installed the strict network service, use **Update Windows service** in the app after existing locks end. Strict timers require this updated service. Updating uses Windows administrator approval. Nothing in the build/test process installs or activates the service.

The independent timer, unlock, tray, application guard, and native messaging behavior was tested in isolated data folders. Chrome request blocking, keyword rules, overlapping locks, and expiry were tested in an isolated browser profile. No live firewall block was activated on this computer; the optional service deadline behavior is covered by Rust state-machine tests.
