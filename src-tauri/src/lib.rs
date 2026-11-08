pub mod app_guard;
pub mod bridge;
pub mod companion;
pub mod model;
pub mod native_host;
pub mod network_guard;
pub mod tray;

use model::*;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

pub fn data_dir() -> PathBuf {
    #[cfg(windows)]
    let root = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let root = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".local/share")));
    root.unwrap_or_else(std::env::temp_dir).join("LockIN")
}
fn state_path() -> PathBuf {
    data_dir().join("state.json")
}
pub fn read_state() -> Result<AppState, String> {
    match fs::read_to_string(state_path()) {
        Ok(json) => serde_json::from_str::<AppState>(&json)
            .map(|mut s| {
                s.migrate();
                s
            })
            .map_err(|e| {
                format!(
                    "Could not read saved data: {e}. Your data has been preserved in {}.",
                    state_path().display()
                )
            }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(AppState::default()),
        Err(e) => Err(format!("Could not open saved data: {e}")),
    }
}
fn write_state(state: &AppState) -> Result<(), String> {
    fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let tmp = data_dir().join(format!("state-{}.tmp", std::process::id()));
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(&tmp, state_path()).map_err(|e| e.to_string())
}
struct Engine {
    state: Mutex<AppState>,
    runtime: Mutex<tray::RuntimeStatus>,
}
#[tauri::command]
fn load_state(engine: State<Engine>) -> Result<AppState, String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    if state.expire() {
        write_state(&state)?;
    }
    Ok(state.clone())
}
#[tauri::command]
fn save_state(mut state: AppState, engine: State<Engine>) -> Result<AppState, String> {
    let mut current = engine.state.lock().map_err(|e| e.to_string())?;
    if state.revision != current.revision {
        return Err("Changes arrived from the browser companion. Refresh and try again.".into());
    }
    current.expire();
    state.validate()?;
    for category in &state.categories {
        if state.policy(&category.id).strict_network_guard
            && !current
                .categories
                .iter()
                .any(|old| old.id == category.id && current.policy(&old.id).strict_network_guard)
        {
            let guard = network_guard::status();
            if !guard.running || !guard.error.is_empty() {
                return Err("Install the Windows network guard and wait for its healthy status before enabling strict protection.".into());
            }
        }
    }
    for app in &mut state.apps {
        if !current
            .apps
            .iter()
            .any(|old| old.id == app.id && old.path == app.path)
        {
            let path = fs::canonicalize(&app.path)
                .map_err(|_| format!("Application not found: {}", app.path))?;
            app.path = path
                .to_string_lossy()
                .trim_start_matches(r"\\?\")
                .to_string();
            app_guard::validate_path(&app.path)?;
        }
    }
    // Session state and unlock progress are exclusively owned by Rust commands.
    state.session = None;
    state.sessions = current.sessions.clone();
    state.history = current.history.clone();
    state.inherit_active_categories(&current);
    let now = chrono::Local::now();
    let active: Vec<_> = current
        .schedules
        .iter()
        .filter(|s| schedule_active(s, now))
        .collect();
    for category in &current.categories {
        if current.policy_locked(&category.id, now)
            && (!state.categories.iter().any(|c| c.id == category.id)
                || state.policy(&category.id) != current.policy(&category.id))
        {
            return Err("This category's filtering and protection stay locked until its timers and schedules end.".into());
        }
    }
    if (current.sessions.iter().any(|s| !s.test_mode) || strict_until(&current, now).is_some())
        && state.settings.test_mode != current.settings.test_mode
    {
        return Err("Test mode cannot change during active Lights Out.".into());
    }
    for schedule in active.into_iter().filter(|_| !current.settings.test_mode) {
        if !state.schedules.iter().any(|s| s == schedule) {
            return Err("An active schedule stays locked until its end time.".into());
        }
    }
    if !current.settings.test_mode
        && (!blocked_domains(&current, now).is_subset(&blocked_domains(&state, now))
            || !blocked_app_paths(&current, now).is_subset(&blocked_app_paths(&state, now)))
    {
        return Err("Protected websites cannot be unblocked during Lights Out.".into());
    }
    state.revision = current.revision + 1;
    write_state(&state)?;
    *current = state;
    Ok(current.clone())
}
#[tauri::command]
fn start_session(
    site_ids: Vec<String>,
    duration_minutes: f64,
    test_mode: bool,
    app_ids: Option<Vec<String>>,
    category_ids: Option<Vec<String>>,
    engine: State<Engine>,
) -> Result<AppState, String> {
    let mut current = engine.state.lock().map_err(|e| e.to_string())?;
    let mut state = current.clone();
    state.start_timers(
        &site_ids,
        &app_ids.unwrap_or_default(),
        &category_ids.unwrap_or_default(),
        duration_minutes,
        test_mode,
    )?;
    if strict_until(&state, chrono::Local::now()).is_some() && !test_mode {
        let guard = network_guard::status();
        if !guard.running || !guard.error.is_empty() {
            return Err(
                "The strict network guard must be running and healthy before starting.".into(),
            );
        }
        if timestamp() - bridge_status().last_seen > 5000 {
            return Err(
                "Wait for the Chrome companion to connect before starting a strict timer.".into(),
            );
        }
    }
    state.revision += 1;
    write_state(&state)?;
    *current = state;
    Ok(current.clone())
}
#[tauri::command]
fn begin_unlock(session_id: String, engine: State<Engine>) -> Result<UnlockProgress, String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.expire();
    let session = state
        .sessions
        .iter_mut()
        .find(|s| s.id == session_id)
        .ok_or("This timer has finished.")?;
    let progress = session
        .unlock
        .get_or_insert_with(|| UnlockProgress {
            step: 0,
            total: if session.test_mode {
                0
            } else {
                session.protection.steps
            },
            ready_at: timestamp()
                + if session.test_mode {
                    0
                } else {
                    session.protection.wait_minutes as i64 * 60000
                },
        })
        .clone();
    write_state(&state)?;
    Ok(progress)
}
#[tauri::command]
fn advance_unlock(session_id: String, engine: State<Engine>) -> Result<UnlockProgress, String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.expire();
    let session = state
        .sessions
        .iter_mut()
        .find(|s| s.id == session_id)
        .ok_or("This timer has finished.")?;
    let p = session
        .unlock
        .as_mut()
        .ok_or("Begin the unlock process first.")?;
    if timestamp() < p.ready_at {
        return Err("Let the waiting timer finish first.".into());
    }
    p.step = (p.step + 1).min(p.total);
    let progress = p.clone();
    write_state(&state)?;
    Ok(progress)
}
#[tauri::command]
fn finish_unlock(
    phrase: String,
    session_id: String,
    engine: State<Engine>,
) -> Result<AppState, String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    if state.expire() {
        write_state(&state)?;
    }
    if !state.sessions.iter().any(|s| s.id == session_id) {
        return Ok(state.clone());
    }
    let session = state
        .sessions
        .iter()
        .find(|s| s.id == session_id)
        .ok_or("This timer has finished.")?;
    if session.strict_network_guard && !session.test_mode {
        return Err(
            "Strict sessions run until their timer ends. Early unlock is unavailable.".into(),
        );
    }
    if !session.test_mode {
        let p = session
            .unlock
            .as_ref()
            .ok_or("Complete the unlock process first.")?;
        if timestamp() < p.ready_at || p.step < p.total {
            return Err("Complete the waiting period and all reflection steps.".into());
        }
        if session.protection.phrase_enabled && phrase != session.protection.phrase {
            return Err("Type the exact unlock phrase.".into());
        }
    }
    state.finish_session(&session_id, timestamp(), false);
    state.revision += 1;
    write_state(&state)?;
    Ok(state.clone())
}
#[tauri::command]
fn bridge_status() -> bridge::Status {
    bridge::status()
}
#[tauri::command]
fn install_bridge(extension_id: String) -> Result<String, String> {
    if extension_id.len() != 32 || !extension_id.chars().all(|c| ('a'..='p').contains(&c)) {
        return Err("Enter the 32-letter Chrome extension ID.".into());
    }
    #[cfg(not(windows))]
    {
        return Err("Automatic native host registration is currently supported on Windows.".into());
    }
    #[cfg(windows)]
    {
        bridge::register(&extension_id)?;
        Ok("Bridge registered. Open the extension and click Reconnect.".into())
    }
}
#[tauri::command]
async fn pick_application(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Windows application", &["exe"])
            .blocking_pick_file()
            .map(|file| {
                file.into_path()
                    .map(|p| p.to_string_lossy().to_string())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn runtime_status(engine: State<Engine>) -> tray::RuntimeStatus {
    engine.runtime.lock().unwrap().clone()
}
#[tauri::command]
fn hide_to_tray(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}
#[tauri::command]
fn prepare_extension() -> Result<companion::BundleInfo, String> {
    bridge::refresh_existing()?;
    companion::prepare()
}
#[tauri::command]
fn open_extension_folder() -> Result<(), String> {
    companion::open_folder()
}
#[tauri::command]
fn network_guard_status() -> network_guard::GuardStatus {
    network_guard::status()
}
#[tauri::command]
fn install_network_guard() -> Result<(), String> {
    network_guard::request_install()
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let mut state = read_state().map_err(std::io::Error::other)?;
            state.validate().map_err(std::io::Error::other)?;
            state.expire();
            write_state(&state).map_err(std::io::Error::other)?;
            // Preserve existing extension IDs while moving Chrome to this executable.
            let _ = bridge::refresh_existing();
            if data_dir().join("chrome-extension/manifest.json").exists() {
                let _ = companion::prepare();
            }
            app.manage(Engine {
                state: Mutex::new(state),
                runtime: Mutex::new(tray::RuntimeStatus::default()),
            });
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            start_session,
            begin_unlock,
            advance_unlock,
            finish_unlock,
            bridge_status,
            install_bridge,
            pick_application,
            runtime_status,
            hide_to_tray,
            prepare_extension,
            open_extension_folder,
            network_guard_status,
            install_network_guard
        ])
        .run(tauri::generate_context!())
        .expect("Could not start LockIN");
}
