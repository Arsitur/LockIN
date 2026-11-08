use crate::{data_dir, model::timestamp};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::Path};

pub fn version(value: &str) -> Option<[u32; 3]> {
    let parts: Vec<_> = value.split('.').map(str::parse::<u32>).collect();
    if parts.len() != 3 {
        return None;
    }
    Some([
        parts[0].as_ref().ok().copied()?,
        parts[1].as_ref().ok().copied()?,
        parts[2].as_ref().ok().copied()?,
    ])
}
pub fn same_path(a: &Path, b: &Path) -> bool {
    let a = a.canonicalize().unwrap_or_else(|_| a.to_path_buf());
    let b = b.canonicalize().unwrap_or_else(|_| b.to_path_buf());
    a.to_string_lossy()
        .eq_ignore_ascii_case(&b.to_string_lossy())
}
fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}
#[derive(Serialize, Deserialize)]
struct Registration {
    path: String,
    version: String,
}
fn valid_origin(value: &str) -> bool {
    value
        .strip_prefix("chrome-extension://")
        .and_then(|s| s.strip_suffix('/'))
        .is_some_and(|id| id.len() == 32 && id.chars().all(|c| ('a'..='p').contains(&c)))
}
fn repair_at(root: &Path, executable: &Path, current_version: &str) -> Result<bool, String> {
    let path = root.join("com.lockin.bridge.json");
    let bytes = match fs::read(&path) {
        Ok(value) => value,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
    };
    let mut manifest: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Pair the companion again: its bridge registration is damaged.")?;
    let origins = manifest["allowed_origins"]
        .as_array()
        .ok_or("Pair your Chrome extension in this app first.")?;
    if manifest["name"] != "com.lockin.bridge"
        || origins.is_empty()
        || !origins.iter().all(|v| v.as_str().is_some_and(valid_origin))
    {
        return Err("Pair your Chrome extension in this app first.".into());
    }
    let registered = manifest["path"].as_str().unwrap_or("");
    let metadata = fs::read(root.join("bridge-registration.json"))
        .ok()
        .and_then(|v| serde_json::from_slice::<Registration>(&v).ok());
    if let Some(meta) = &metadata {
        if same_path(Path::new(&meta.path), Path::new(registered))
            && version(&meta.version) > version(current_version)
        {
            return Err(format!(
                "A newer LockIN {} owns the Chrome bridge. Open that version instead.",
                meta.version
            ));
        }
    }
    let changed = !same_path(Path::new(registered), executable)
        || metadata.as_ref().is_none_or(|m| {
            m.version != current_version || !same_path(Path::new(&m.path), executable)
        });
    if changed {
        manifest["path"] = serde_json::to_value(executable).map_err(|e| e.to_string())?;
        manifest["type"] = Value::String("stdio".into());
        atomic_json(&path, &manifest)?;
        atomic_json(
            &root.join("bridge-registration.json"),
            &Registration {
                path: executable.to_string_lossy().into(),
                version: current_version.into(),
            },
        )?;
    }
    Ok(changed)
}
pub fn refresh_existing() -> Result<bool, String> {
    let changed = repair_at(
        &data_dir(),
        &std::env::current_exe().map_err(|e| e.to_string())?,
        env!("CARGO_PKG_VERSION"),
    )?;
    if data_dir().join("com.lockin.bridge.json").exists() {
        register_manifest_path(&data_dir().join("com.lockin.bridge.json"))?;
    }
    Ok(changed)
}
pub fn registered_elsewhere() -> bool {
    let manifest = fs::read(data_dir().join("com.lockin.bridge.json"))
        .ok()
        .and_then(|v| serde_json::from_slice::<Value>(&v).ok());
    manifest
        .and_then(|m| m["path"].as_str().map(str::to_owned))
        .is_some_and(|path| {
            std::env::current_exe()
                .ok()
                .is_some_and(|exe| !same_path(Path::new(&path), &exe))
        })
}
fn register_manifest_path(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for browser in [
            r"Software\Google\Chrome\NativeMessagingHosts\com.lockin.bridge",
            r"Software\Microsoft\Edge\NativeMessagingHosts\com.lockin.bridge",
        ] {
            let (key, _) = hkcu.create_subkey(browser).map_err(|e| e.to_string())?;
            let expected = path.to_string_lossy().to_string();
            if key.get_value::<String, _>("").ok().as_deref() != Some(&expected) {
                key.set_value("", &expected).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}
pub fn register(extension_id: &str) -> Result<(), String> {
    if extension_id.len() != 32 || !extension_id.chars().all(|c| ('a'..='p').contains(&c)) {
        return Err("Enter the 32-letter Chrome extension ID.".into());
    }
    fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let path = data_dir().join("com.lockin.bridge.json");
    atomic_json(
        &path,
        &serde_json::json!({"name":"com.lockin.bridge", "description":"LockIN local focus bridge", "path":exe, "type":"stdio", "allowed_origins":[format!("chrome-extension://{extension_id}/")]}),
    )?;
    atomic_json(
        &data_dir().join("bridge-registration.json"),
        &Registration {
            path: exe.to_string_lossy().into(),
            version: env!("CARGO_PKG_VERSION").into(),
        },
    )?;
    register_manifest_path(&path)?;
    Ok(())
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub last_seen: i64,
    pub host_version: String,
    pub host_path: String,
    pub extension_version: String,
}
pub fn record_applied(extension_version: &str) -> Result<(), String> {
    fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let now = timestamp();
    atomic_json(
        &data_dir().join("bridge-verified.json"),
        &Receipt {
            last_seen: now,
            host_version: env!("CARGO_PKG_VERSION").into(),
            host_path: std::env::current_exe()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into(),
            extension_version: extension_version.into(),
        },
    )?;
    fs::write(data_dir().join("bridge-heartbeat"), now.to_string()).map_err(|e| e.to_string())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    pub last_seen: i64,
    pub host_version: String,
    pub extension_version: String,
    pub error: String,
}
pub fn status() -> Status {
    let repair_error = refresh_existing().err();
    let receipt = fs::read(data_dir().join("bridge-verified.json"))
        .ok()
        .and_then(|v| serde_json::from_slice::<Receipt>(&v).ok());
    let current = std::env::current_exe().ok();
    let valid = receipt.as_ref().is_some_and(|r| {
        timestamp() - r.last_seen < 12000
            && r.last_seen <= timestamp() + 1000
            && r.host_version == env!("CARGO_PKG_VERSION")
            && current
                .as_ref()
                .is_some_and(|exe| same_path(exe, Path::new(&r.host_path)))
    });
    let configured = data_dir().join("com.lockin.bridge.json").exists();
    Status {
        connected: valid && repair_error.is_none(),
        last_seen: receipt.as_ref().map_or(0, |r| r.last_seen),
        host_version: receipt
            .as_ref()
            .map_or_else(String::new, |r| r.host_version.clone()),
        extension_version: receipt
            .as_ref()
            .map_or_else(String::new, |r| r.extension_version.clone()),
        error: repair_error.unwrap_or_else(|| {
            if configured && !valid {
                "Waiting for the current bridge. Open the companion and click Reconnect to desktop."
                    .into()
            } else {
                String::new()
            }
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repair_preserves_pairing_and_never_downgrades_a_newer_registration() {
        let root =
            std::env::temp_dir().join(format!("lockin-bridge-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let old = root.join("old.exe");
        let current = root.join("current.exe");
        fs::write(&old, b"fixture").unwrap();
        fs::write(&current, b"fixture").unwrap();
        let origins = vec![
            "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
            "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/",
        ];
        atomic_json(&root.join("com.lockin.bridge.json"), &serde_json::json!({"name":"com.lockin.bridge", "path":old, "allowed_origins":origins, "type":"stdio"})).unwrap();
        assert!(repair_at(&root, &current, "1.3.1").unwrap());
        let manifest: Value =
            serde_json::from_slice(&fs::read(root.join("com.lockin.bridge.json")).unwrap())
                .unwrap();
        assert_eq!(manifest["allowed_origins"], serde_json::json!(origins));
        assert_eq!(manifest["path"], current.to_string_lossy().as_ref());
        assert!(!repair_at(&root, &current, "1.3.1").unwrap());
        assert!(repair_at(&root, &old, "1.2.0").is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn numeric_versions_and_pairing_validation() {
        assert!(version("1.10.0") > version("1.3.1"));
        assert_eq!(version("broken"), None);
        assert!(!valid_origin("chrome-extension://*/"));
    }
}
