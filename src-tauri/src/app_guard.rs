use std::collections::BTreeSet;
use std::path::Path;

pub fn normalize_path(path: &str) -> String {
    path.trim_start_matches(r"\\?\")
        .replace('/', r"\")
        .to_lowercase()
}
pub fn validate_path(path: &str) -> Result<(), String> {
    let normalized = normalize_path(path);
    if !Path::new(path).is_absolute() || !normalized.ends_with(".exe") || path.len() > 32700 {
        return Err("Choose an absolute path to a Windows .exe application.".into());
    }
    if matches!(
        Path::new(&normalized).file_name().and_then(|n| n.to_str()),
        Some("lockin.exe" | "lockin-network-guard.exe")
    ) {
        return Err("LockIN cannot block itself.".into());
    }
    if let Ok(windows) = std::env::var("WINDIR") {
        if normalized.starts_with(&(normalize_path(&windows) + r"\")) {
            return Err(
                "Choose a user application. Windows system executables cannot be blocked.".into(),
            );
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if normalize_path(&exe.to_string_lossy()) == normalized {
            return Err("LockIN cannot block itself.".into());
        }
    }
    Ok(())
}

#[cfg(windows)]
pub fn enforce(paths: &BTreeSet<String>) -> Vec<String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, TerminateProcess,
                PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
            },
        },
    };
    if paths.is_empty() {
        return vec![];
    }
    let paths: BTreeSet<_> = paths.iter().map(|p| normalize_path(p)).collect();
    let names: BTreeSet<_> = paths
        .iter()
        .filter_map(|p| p.rsplit('\u{005c}').next().map(str::to_string))
        .collect();
    let mut errors = BTreeSet::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return vec!["Could not inspect running applications.".into()];
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snapshot, &mut entry);
        while ok != 0 {
            let len = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();
            if entry.th32ProcessID != std::process::id() && names.contains(&name) {
                let query = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID);
                if !query.is_null() {
                    let mut buffer = vec![0u16; 32768];
                    let mut size = buffer.len() as u32;
                    if QueryFullProcessImageNameW(query, 0, buffer.as_mut_ptr(), &mut size) != 0 {
                        let path =
                            normalize_path(&String::from_utf16_lossy(&buffer[..size as usize]));
                        if paths.contains(&path) {
                            let process = OpenProcess(PROCESS_TERMINATE, 0, entry.th32ProcessID);
                            if process.is_null() {
                                errors.insert(format!(
                                    "Cannot close {name}: it may be running as administrator."
                                ));
                            } else {
                                if TerminateProcess(process, 1) == 0 {
                                    errors.insert(format!("Windows did not allow closing {name}."));
                                }
                                CloseHandle(process);
                            }
                        }
                    }
                    CloseHandle(query);
                } else {
                    errors.insert(format!("Cannot inspect {name}: Windows denied access."));
                }
            }
            ok = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
    }
    errors.into_iter().collect()
}
#[cfg(not(windows))]
pub fn enforce(_: &BTreeSet<String>) -> Vec<String> {
    vec![]
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    #[ignore]
    fn guard_fixture() {
        if std::env::var("LOCKIN_GUARD_FIXTURE").as_deref() == Ok("1") {
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
    }
    #[test]
    fn guard_closes_only_the_selected_executable_path() {
        let root = std::env::temp_dir().join(format!("lockin-guard-test-{}", uuid::Uuid::new_v4()));
        assert!(root.starts_with(std::env::temp_dir()));
        let a = root.join("a");
        let b = root.join("b");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        let target = a.join("focus-fixture.exe");
        let control = b.join("focus-fixture.exe");
        std::fs::copy(std::env::current_exe().unwrap(), &target).unwrap();
        std::fs::copy(&target, &control).unwrap();
        let spawn = |path: &Path| {
            use std::os::windows::process::CommandExt;
            std::process::Command::new(path)
                .args(["--ignored", "--exact", "app_guard::tests::guard_fixture"])
                .env("LOCKIN_GUARD_FIXTURE", "1")
                .creation_flags(0x08000000)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .unwrap()
        };
        let mut blocked = spawn(&target);
        let mut allowed = spawn(&control);
        let paths = [target.to_string_lossy().to_string()].into_iter().collect();
        for _ in 0..60 {
            enforce(&paths);
            if blocked.try_wait().unwrap().is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let killed = blocked.try_wait().unwrap().is_some();
        let unaffected = allowed.try_wait().unwrap().is_none();
        let _ = blocked.kill();
        let _ = blocked.wait();
        let _ = allowed.kill();
        let _ = allowed.wait();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(killed, "Selected executable should be terminated");
        assert!(
            unaffected,
            "An app with the same filename in another folder must remain running"
        );
    }
}
