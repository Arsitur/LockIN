//! Optional administrator-installed fail-closed watchdog. No firewall operation runs
//! in the ordinary desktop app, native host, or unit tests.
use crate::model::*;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
const SERVICE: &str = "LockINNetworkGuard";
const RULE: &str = "LockIN.StrictNetworkGuard.Outbound";
fn guard_dir() -> PathBuf {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            System::Com::CoTaskMemFree,
            UI::Shell::{FOLDERID_ProgramData, SHGetKnownFolderPath},
        };
        let mut pointer = std::ptr::null_mut();
        let hr = unsafe {
            SHGetKnownFolderPath(&FOLDERID_ProgramData, 0, std::ptr::null_mut(), &mut pointer)
        };
        if hr >= 0 && !pointer.is_null() {
            let mut len = 0;
            unsafe {
                while *pointer.add(len) != 0 {
                    len += 1;
                }
                let path = PathBuf::from(String::from_utf16_lossy(std::slice::from_raw_parts(
                    pointer, len,
                )));
                CoTaskMemFree(pointer.cast());
                return path.join("LockINNetworkGuard");
            }
        }
        return system_tool("unavailable")
            .parent()
            .unwrap()
            .join("LockINNetworkGuard-Unavailable");
    }
    #[cfg(not(windows))]
    {
        std::env::temp_dir().join("LockINNetworkGuard-Unavailable")
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardStatus {
    pub installed: bool,
    pub running: bool,
    pub blocked: bool,
    pub locked_until: i64,
    pub updated_at: i64,
    pub error: String,
    pub data_path: String,
    #[serde(default)]
    pub version: String,
}
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lease {
    pub locked_until: i64,
    pub latched: bool,
}
impl Lease {
    pub fn step(&mut self, now: i64, observed_until: Option<i64>, heartbeat_healthy: bool) -> bool {
        self.locked_until = self.locked_until.min(now + 26 * 60 * 60 * 1000);
        if self.locked_until <= now {
            self.locked_until = 0;
            self.latched = false;
        }
        if let Some(end) = observed_until {
            if end > now && end <= now + 26 * 60 * 60 * 1000 {
                self.locked_until = self.locked_until.max(end);
            }
        }
        if self.locked_until > now && !heartbeat_healthy {
            self.latched = true;
        }
        self.latched && self.locked_until > now
    }
}
#[derive(Serialize, Deserialize)]
struct Config {
    data_path: PathBuf,
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    if fs::metadata(path).ok()?.len() > 8 * 1024 * 1024 {
        return None;
    }
    fs::read(path)
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
}
fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(tmp, path).map_err(|e| e.to_string())
}
pub fn status() -> GuardStatus {
    let mut s: GuardStatus = read_json(&guard_dir().join("status.json")).unwrap_or_default();
    s.installed = guard_dir().join("config.json").exists();
    s.running =
        s.running && timestamp() - s.updated_at < 10000 && s.updated_at <= timestamp() + 2000;
    if s.installed && !s.running && s.error.is_empty() {
        s.error = "The Windows network guard is not responding.".into();
    }
    if s.running && !crate::bridge::version(&s.version).is_some_and(|v| v[0] == 1 && v[1] == 3) {
        s.error =
            "Update the Windows service for category timers before enabling strict protection."
                .into();
    }
    if !s.data_path.is_empty() && Path::new(&s.data_path) != crate::data_dir() {
        s.running = false;
        s.error =
            "The guard belongs to a different LockIN data folder. Install it for this account."
                .into();
    }
    if !s.running {
        if let Ok(error) = fs::read_to_string(crate::data_dir().join("guard-setup-error.txt")) {
            s.error = error.chars().take(4000).collect();
        }
    }
    s
}
#[cfg(windows)]
fn system_tool(name: &str) -> PathBuf {
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buffer = vec![0u16; 32768];
    let len = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if len == 0 || len >= buffer.len() {
        return PathBuf::from("::unavailable-windows-system-directory::").join(name);
    }
    PathBuf::from(String::from_utf16_lossy(&buffer[..len])).join(name)
}
#[cfg(windows)]
fn run_tool(exe: &Path, args: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new(exe)
        .args(args)
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{} failed: {}{}",
            exe.display(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}
#[cfg(windows)]
fn firewall(block: bool) -> Result<(), String> {
    let netsh = system_tool("netsh.exe");
    let name = format!("name={RULE}");
    if block {
        if run_tool(
            &netsh,
            &[
                "advfirewall",
                "firewall",
                "set",
                "rule",
                &name,
                "new",
                "enable=yes",
            ],
        )
        .is_err()
        {
            run_tool(
                &netsh,
                &[
                    "advfirewall",
                    "firewall",
                    "add",
                    "rule",
                    &name,
                    "dir=out",
                    "action=block",
                    "enable=yes",
                    "profile=any",
                    "protocol=any",
                    "remoteip=any",
                ],
            )?;
        }
    } else {
        // Only this app's named rule is disabled; other firewall rules are preserved.
        if let Err(error) = run_tool(
            &netsh,
            &[
                "advfirewall",
                "firewall",
                "set",
                "rule",
                &name,
                "new",
                "enable=no",
            ],
        ) {
            if run_tool(&netsh, &["advfirewall", "firewall", "show", "rule", &name]).is_ok() {
                return Err(error);
            }
        }
    }
    Ok(())
}
#[cfg(windows)]
fn firewall_ready() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let exe = system_tool(r"WindowsPowerShell\v1.0\powershell.exe");
    let output = std::process::Command::new(exe)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "@(Get-NetFirewallProfile -ErrorAction Stop | Where-Object { -not $_.Enabled }).Count",
        ])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != "0" {
        return Err("Enable Windows Defender Firewall on all profiles before enabling strict network protection.".into());
    }
    Ok(())
}
#[cfg(windows)]
pub fn request_install() -> Result<(), String> {
    let _ = fs::remove_file(crate::data_dir().join("guard-setup-error.txt"));
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let args = format!(
        "--install-network-guard \"{}\"",
        crate::data_dir().display()
    );
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            wide("runas".as_ref()).as_ptr(),
            wide(exe.as_os_str()).as_ptr(),
            wide(args.as_ref()).as_ptr(),
            std::ptr::null(),
            0,
        )
    } as isize;
    if result <= 32 {
        Err("Windows did not approve administrator setup. The guard has not been installed.".into())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
pub fn request_install() -> Result<(), String> {
    Err("The network guard is available on Windows.".into())
}
#[cfg(windows)]
pub fn install(data_path: PathBuf) -> Result<(), String> {
    if !data_path.is_absolute() || !data_path.join("state.json").is_file() {
        return Err(
            "Open the desktop app and save its configuration before installing the guard.".into(),
        );
    }
    let prior = status();
    if prior.locked_until > timestamp() {
        return Err(
            "Wait for the current strict lock to finish before updating the network guard.".into(),
        );
    }
    let dir = guard_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    use std::os::windows::fs::MetadataExt;
    if fs::symlink_metadata(&dir)
        .map_err(|e| e.to_string())?
        .file_attributes()
        & 0x400
        != 0
    {
        return Err("The network guard folder must not be a junction or symbolic link.".into());
    }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let meta = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        if meta.is_dir() || meta.file_attributes() & 0x400 != 0 {
            return Err(
                "The network guard folder contains an unexpected directory or link.".into(),
            );
        }
    }
    run_tool(
        &system_tool("icacls.exe"),
        &[dir.to_string_lossy().as_ref(), "/setowner", "*S-1-5-18"],
    )?;
    run_tool(
        &system_tool("icacls.exe"),
        &[
            dir.to_string_lossy().as_ref(),
            "/inheritance:r",
            "/grant:r",
            "*S-1-5-18:(OI)(CI)F",
            "*S-1-5-32-544:(OI)(CI)F",
            "*S-1-5-32-545:(OI)(CI)RX",
        ],
    )?;
    let sc = system_tool("sc.exe");
    let service_exists = run_tool(&sc, &["query", SERVICE]).is_ok();
    if service_exists {
        let _ = run_tool(&sc, &["stop", SERVICE]);
        for _ in 0..40 {
            if !status().running {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
    }
    let protected_exe = dir.join("lockin-network-guard.exe");
    if protected_exe.exists() {
        fs::remove_file(&protected_exe)
            .map_err(|e| format!("The guard is still running; wait before updating it: {e}"))?;
    }
    use std::io::Write;
    let source =
        fs::read(std::env::current_exe().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&protected_exe)
        .map_err(|e| e.to_string())?
        .write_all(&source)
        .map_err(|e| e.to_string())?;
    write_json(
        &dir.join("config.json"),
        &Config {
            data_path: data_path.clone(),
        },
    )?;
    let bin = format!("\"{}\" --network-service", protected_exe.display());
    write_json(&dir.join("lease.json"), &Lease::default())?;
    let _ = fs::remove_file(dir.join("recovery.flag"));
    if service_exists {
        run_tool(
            &sc,
            &["config", SERVICE, "binPath=", &bin, "start=", "auto"],
        )?;
    } else {
        run_tool(
            &sc,
            &[
                "create",
                SERVICE,
                "binPath=",
                &bin,
                "start=",
                "auto",
                "DisplayName=",
                "LockIN network protection",
            ],
        )?;
    }
    run_tool(
        &sc,
        &[
            "failure",
            SERVICE,
            "reset=",
            "86400",
            "actions=",
            "restart/1000/restart/1000/restart/1000",
        ],
    )?;
    run_tool(&sc, &["start", SERVICE])?;
    Ok(())
}
#[cfg(windows)]
mod windows_service_impl {
    use super::*;
    use std::{
        ffi::OsString,
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        },
        time::Duration,
    };
    use windows_service::{
        define_windows_service,
        service::{
            ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
            ServiceType,
        },
        service_control_handler::{self, ServiceControlHandlerResult},
    };
    define_windows_service!(entry, service_main);
    pub fn run() -> Result<(), String> {
        windows_service::service_dispatcher::start(SERVICE, entry).map_err(|e| e.to_string())
    }
    fn service_main(_: Vec<OsString>) {
        let _ = worker();
    }
    fn worker() -> Result<(), String> {
        let (tx, rx) = mpsc::channel();
        let locked = Arc::new(AtomicBool::new(false));
        let handler_locked = locked.clone();
        let handle = service_control_handler::register(SERVICE, move |event| match event {
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            ServiceControl::Stop if !handler_locked.load(Ordering::SeqCst) => {
                let _ = tx.send(());
                ServiceControlHandlerResult::NoError
            }
            _ => ServiceControlHandlerResult::NotImplemented,
        })
        .map_err(|e| e.to_string())?;
        let report = |state, active| {
            handle
                .set_service_status(ServiceStatus {
                    service_type: ServiceType::OWN_PROCESS,
                    current_state: state,
                    controls_accepted: if active {
                        ServiceControlAccept::empty()
                    } else {
                        ServiceControlAccept::STOP
                    },
                    exit_code: ServiceExitCode::Win32(0),
                    checkpoint: 0,
                    wait_hint: Duration::default(),
                    process_id: None,
                })
                .map_err(|e| e.to_string())
        };
        report(ServiceState::Running, false)?;
        let config: Config = read_json(&guard_dir().join("config.json"))
            .ok_or("Network guard configuration is missing.")?;
        let mut lease: Lease = read_json(&guard_dir().join("lease.json")).unwrap_or_default();
        let mut applied: Option<bool> = None;
        let mut tick = 0u64;
        let mut error = String::new();
        loop {
            let now = timestamp();
            let state: Option<AppState> = read_json(&config.data_path.join("state.json"));
            let state_error = state.as_ref().map(|s| s.validate().err()).unwrap_or(Some(
                "The network guard cannot read the desktop configuration.".into(),
            ));
            let until = state
                .as_ref()
                .and_then(|s| strict_until(s, chrono::Local::now()));
            let heartbeat = fs::read_to_string(config.data_path.join("bridge-heartbeat"))
                .ok()
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0);
            let healthy = heartbeat > 0 && now - heartbeat <= 6000 && heartbeat <= now + 1000;
            let block = lease.step(now, until, healthy);
            if tick % 10 == 0 {
                error = firewall_ready().err().unwrap_or_default();
            }
            // Persist the deadline before touching firewall rules, including across reboot.
            if let Err(e) = write_json(&guard_dir().join("lease.json"), &lease) {
                error = e;
            }
            locked.store(lease.locked_until > now, Ordering::SeqCst);
            if let Some(e) = state_error {
                error = e;
            }
            if applied != Some(block) || (block && tick % 5 == 0) {
                match firewall(block) {
                    Ok(()) => applied = Some(block),
                    Err(e) => {
                        error = e;
                        applied = None;
                    }
                }
            }
            let _ = report(ServiceState::Running, lease.locked_until > now);
            let _ = write_json(
                &guard_dir().join("status.json"),
                &GuardStatus {
                    version: env!("CARGO_PKG_VERSION").into(),
                    installed: true,
                    running: true,
                    blocked: block && applied == Some(true) && error.is_empty(),
                    locked_until: lease.locked_until,
                    updated_at: now,
                    error: error.clone(),
                    data_path: config.data_path.to_string_lossy().into(),
                },
            );
            tick += 1;
            if guard_dir().join("recovery.flag").exists() {
                lease = Lease::default();
                let _ = write_json(&guard_dir().join("lease.json"), &lease);
                break;
            }
            if rx.recv_timeout(Duration::from_secs(1)).is_ok() {
                break;
            }
        }
        firewall(false)?;
        let _ = write_json(
            &guard_dir().join("status.json"),
            &GuardStatus {
                version: env!("CARGO_PKG_VERSION").into(),
                installed: true,
                running: false,
                blocked: false,
                locked_until: 0,
                updated_at: timestamp(),
                error: String::new(),
                data_path: config.data_path.to_string_lossy().into(),
            },
        );
        report(ServiceState::Stopped, false)?;
        Ok(())
    }
}
#[cfg(windows)]
pub use windows_service_impl::run;
#[cfg(windows)]
pub fn recover() -> Result<(), String> {
    fs::write(
        guard_dir().join("recovery.flag"),
        b"Administrator requested emergency recovery",
    )
    .map_err(|e| e.to_string())?;
    firewall(false)?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disconnection_latches_until_the_fixed_deadline() {
        let mut l = Lease::default();
        assert!(!l.step(100, Some(1000), true));
        assert!(l.step(200, None, false));
        assert!(l.step(400, None, true));
        assert!(!l.step(1000, None, false));
    }
    #[test]
    fn deleted_configuration_cannot_release_a_recorded_lock() {
        let mut l = Lease {
            locked_until: 1000,
            latched: true,
        };
        assert!(l.step(500, None, false));
        let json = serde_json::to_vec(&l).unwrap();
        let mut restored: Lease = serde_json::from_slice(&json).unwrap();
        assert!(restored.step(900, None, false));
        assert!(!restored.step(1001, None, false));
    }
    #[test]
    fn invalid_distant_deadline_cannot_create_a_sliding_permanent_lock() {
        let mut lease = Lease::default();
        assert!(!lease.step(100, Some(i64::MAX), false));
        assert_eq!(lease.locked_until, 0);
    }
}
