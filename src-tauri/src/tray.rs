use crate::{app_guard, model::*, write_state, Engine};
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub tray: bool,
    pub tooltip: String,
    pub blocked_apps: usize,
    pub guard_errors: Vec<String>,
}
pub fn countdown_text(seconds: i64) -> String {
    let s = seconds.max(0);
    if s >= 3600 {
        format!("{}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
    } else {
        format!("{:02}:{:02}", s / 60, s % 60)
    }
}
fn rgba(accent: &str) -> [u8; 4] {
    let hex = accent.trim_start_matches('#');
    [
        u8::from_str_radix(&hex[0..2], 16).unwrap_or(216),
        u8::from_str_radix(&hex[2..4], 16).unwrap_or(237),
        u8::from_str_radix(&hex[4..6], 16).unwrap_or(171),
        255,
    ]
}
pub fn icon(accent: &str, seconds: Option<i64>) -> Image<'static> {
    let color = rgba(accent);
    let ink = if (color[0] as u32 * 2126 + color[1] as u32 * 7152 + color[2] as u32 * 722) > 1400000
    {
        [22, 30, 18, 255]
    } else {
        [255, 255, 255, 255]
    };
    let mut data = vec![0u8; 32 * 32 * 4];
    let mut pixel = |x: usize, y: usize, c: [u8; 4]| {
        if x < 32 && y < 32 {
            data[(y * 32 + x) * 4..(y * 32 + x) * 4 + 4].copy_from_slice(&c);
        }
    };
    if let Some(seconds) = seconds {
        for y in 0..32 {
            for x in 0..32 {
                pixel(x, y, color);
            }
        }
        let digits: [[u8; 5]; 10] = [
            [7, 5, 5, 5, 7],
            [2, 6, 2, 2, 7],
            [7, 1, 7, 4, 7],
            [7, 1, 7, 1, 7],
            [5, 5, 7, 1, 1],
            [7, 4, 7, 1, 7],
            [7, 4, 7, 5, 7],
            [7, 1, 1, 1, 1],
            [7, 5, 7, 5, 7],
            [7, 5, 7, 1, 7],
        ];
        let s = seconds.max(0);
        let (top, bottom) = if s >= 3600 {
            (s / 3600, (s % 3600) / 60)
        } else {
            (s / 60, s % 60)
        };
        for (row, value) in [top, bottom].iter().enumerate() {
            for (col, digit) in [(value / 10) % 10, value % 10].iter().enumerate() {
                for y in 0..5 {
                    for x in 0..3 {
                        if digits[*digit as usize][y] & (1 << (2 - x)) != 0 {
                            for dy in 0..2 {
                                for dx in 0..3 {
                                    pixel(
                                        5 + col * 12 + x * 3 + dx,
                                        3 + row * 15 + y * 2 + dy,
                                        ink,
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    } else {
        for y in 3..29 {
            for x in 3..29 {
                pixel(x, y, color);
            }
        }
        for y in 9..24 {
            for x in 9..13 {
                pixel(x, y, ink);
            }
        }
        for y in 20..24 {
            for x in 9..23 {
                pixel(x, y, ink);
            }
        }
        for y in 9..13 {
            for x in 18..25 {
                pixel(x, y, ink);
            }
        }
        for y in 9..17 {
            for x in 21..25 {
                pixel(x, y, ink);
            }
        }
    }
    Image::new_owned(data, 32, 32)
}
pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "show", "Open LockIN", true, None::<&str>)?;
    let status = MenuItem::with_id(app, "countdown", "Ready when you are", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit LockIN", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&status, &open, &quit])?;
    TrayIconBuilder::with_id("focus")
        .icon(icon("#d8edab", None))
        .tooltip("LockIN — Ready when you are")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id.as_ref() == "show" {
                show(app);
            } else if event.id.as_ref() == "quit" {
                let engine = app.state::<Engine>();
                let state = engine.state.lock().unwrap();
                let locked = !state.settings.test_mode
                    && countdown_until(&state, chrono::Local::now()).is_some();
                drop(state);
                if locked {
                    show(app);
                    let _ = app.emit("show-unlock", ());
                } else {
                    app.exit(0);
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show(tray.app_handle());
            }
        })
        .build(app)?;
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let mut last = Instant::now() - Duration::from_secs(2);
        let mut previous_accent = String::new();
        loop {
            crate::companion::process_inbox(&handle);
            let engine = handle.state::<Engine>();
            let snapshot = {
                let mut state = engine.state.lock().unwrap();
                if state.expire() {
                    let _ = write_state(&state);
                    let _ = handle.emit("state-updated", ());
                }
                state.clone()
            };
            let now = chrono::Local::now();
            let apps = blocked_app_paths(&snapshot, now);
            let errors = app_guard::enforce(&apps);
            if last.elapsed() >= Duration::from_secs(1) {
                let mut ends: Vec<_> = snapshot
                    .sessions
                    .iter()
                    .filter(|s| s.ends_at > now.timestamp_millis())
                    .map(|s| s.ends_at)
                    .collect();
                ends.extend(
                    snapshot
                        .schedules
                        .iter()
                        .filter(|s| schedule_active(s, now))
                        .map(|s| schedule_occurrence_end(s, now)),
                );
                let timer_count = ends.len();
                let seconds = ends
                    .into_iter()
                    .min()
                    .map(|end| ((end - now.timestamp_millis() + 999) / 1000).max(0));
                let caption = seconds
                    .map(|s| {
                        format!(
                            "Lights Out · {timer_count} timers · next {}",
                            countdown_text(s)
                        )
                    })
                    .unwrap_or_else(|| "Ready when you are".into());
                let tooltip = format!(
                    "LockIN — {caption} · {} websites · {} apps",
                    blocked_domains(&snapshot, now).len(),
                    apps.len()
                );
                if let Some(tray) = handle.tray_by_id("focus") {
                    let _ = tray.set_icon(Some(icon(&snapshot.settings.accent, seconds)));
                    let _ = tray.set_tooltip(Some(&tooltip));
                }
                let _ = status.set_text(&caption);
                let locked = !snapshot.settings.test_mode && seconds.is_some();
                let _ = quit.set_enabled(!locked);
                let _ = quit.set_text(if locked {
                    "Finish Lights Out to quit"
                } else {
                    "Quit LockIN"
                });
                if previous_accent != snapshot.settings.accent {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.set_icon(icon(&snapshot.settings.accent, None));
                    }
                    previous_accent = snapshot.settings.accent.clone();
                }
                *engine.runtime.lock().unwrap() = RuntimeStatus {
                    tray: true,
                    tooltip,
                    blocked_apps: apps.len(),
                    guard_errors: errors,
                };
                last = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });
    Ok(())
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tray_countdown_has_real_frames_and_colors() {
        assert_eq!(countdown_text(3599), "59:59");
        assert_eq!(countdown_text(3600), "1:00:00");
        assert_ne!(
            icon("#a855f7", Some(60)).rgba(),
            icon("#a855f7", Some(59)).rgba()
        );
        assert_ne!(icon("#a855f7", None).rgba(), icon("#d8edab", None).rgba());
    }
}
