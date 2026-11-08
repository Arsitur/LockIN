use crate::{data_dir, model::*, write_state, Engine};
use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use tauri::{Emitter, Manager};
const BUNDLE: Dir = include_dir!("$CARGO_MANIFEST_DIR/../extension");
#[derive(Serialize)]
pub struct BundleInfo {
    pub path: String,
    pub version: String,
}
fn check_bundle_version(installed: &str, bundled: &str) -> Result<(), String> {
    let old =
        crate::bridge::version(installed).ok_or("The managed companion version is invalid.")?;
    let new = crate::bridge::version(bundled).ok_or("The bundled companion version is invalid.")?;
    if old > new {
        return Err(format!("Companion {installed} is newer than this desktop bundle ({bundled}). Open the latest LockIN app; downgrades are blocked."));
    }
    Ok(())
}
pub fn prepare() -> Result<BundleInfo, String> {
    if let Ok(state) = crate::read_state() {
        if strict_until(&state, chrono::Local::now()).is_some() {
            return Err(
                "Wait for strict Lights Out to finish before updating the companion.".into(),
            );
        }
    }
    let root = data_dir().join("chrome-extension");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if fs::symlink_metadata(&root)
            .map_err(|e| e.to_string())?
            .file_attributes()
            & 0x400
            != 0
        {
            return Err(
                "The managed extension folder must not be a junction or symbolic link.".into(),
            );
        }
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let manifest = BUNDLE
        .get_file("manifest.json")
        .ok_or("The bundled manifest is missing.")?;
    let bundled: serde_json::Value =
        serde_json::from_slice(manifest.contents()).map_err(|e| e.to_string())?;
    let version = bundled["version"]
        .as_str()
        .ok_or("The bundled version is missing.")?;
    if version != env!("CARGO_PKG_VERSION") {
        return Err("The desktop and bundled companion versions do not match. Reinstall the latest LockIN build.".into());
    }
    if let Ok(bytes) = fs::read(root.join("manifest.json")) {
        let existing: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| "The managed companion manifest is damaged.")?;
        check_bundle_version(existing["version"].as_str().unwrap_or(""), version)?;
    }
    fn copy(dir: &Dir, root: &Path) -> Result<(), String> {
        for f in dir.files() {
            // Publish the new manifest only after every script is in place.
            if f.path() == Path::new("manifest.json") {
                continue;
            }
            let path = root.join(f.path());
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                if !parent
                    .canonicalize()
                    .map_err(|e| e.to_string())?
                    .starts_with(root)
                {
                    return Err(
                        "The managed extension contains a folder outside its destination.".into(),
                    );
                }
            }
            let tmp = path.with_extension(format!("{}.lockin-tmp", uuid::Uuid::new_v4()));
            use std::io::Write;
            let mut output = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&tmp)
                .map_err(|e| e.to_string())?;
            output.write_all(f.contents()).map_err(|e| e.to_string())?;
            drop(output);
            fs::rename(&tmp, path).map_err(|e| e.to_string())?;
        }
        for child in dir.dirs() {
            copy(child, root)?;
        }
        Ok(())
    }
    copy(&BUNDLE, &root)?;
    let temporary_manifest = root.join(format!("manifest-{}.lockin-tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary_manifest, manifest.contents()).map_err(|e| e.to_string())?;
    fs::rename(temporary_manifest, root.join("manifest.json")).map_err(|e| e.to_string())?;
    Ok(BundleInfo {
        path: root.to_string_lossy().trim_start_matches(r"\\?\").into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}
pub fn open_folder() -> Result<(), String> {
    let bundle = prepare()?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(bundle.path)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAdd {
    pub request_id: String,
    pub domain: String,
    pub name: String,
    pub category_id: String,
}
pub fn add_website(state: &mut AppState, request: &QuickAdd) -> Result<String, String> {
    if !valid_domain(&request.domain)
        || request.name.len() > 240
        || !state.categories.iter().any(|c| c.id == request.category_id)
    {
        return Err("Choose a valid website and an existing category.".into());
    }
    if let Some(site) = state
        .sites
        .iter()
        .find(|s| s.domain == request.domain && s.category_id == request.category_id)
    {
        return Ok(site.id.clone());
    }
    if state.sites.len() >= 2000 {
        return Err("Your website list is full.".into());
    }
    let before = state.clone();
    let id = uuid::Uuid::new_v4().to_string();
    state.sites.push(Site {
        id: id.clone(),
        name: if request.name.trim().is_empty() {
            request.domain.clone()
        } else {
            request.name.clone()
        },
        domain: request.domain.clone(),
        category_id: request.category_id.clone(),
        enabled: true,
        custom_icon: None,
        duration_minutes: None,
    });
    state.inherit_active_categories(&before);
    state.revision += 1;
    Ok(id)
}
pub fn send_quick_add(mut request: QuickAdd) -> Result<serde_json::Value, String> {
    request.request_id = uuid::Uuid::new_v4().to_string();
    let dir = data_dir().join("quick-add");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.request", request.request_id));
    let reply = dir.join(format!("{}.response", request.request_id));
    fs::write(
        &path,
        serde_json::to_vec(&request).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    for _ in 0..80 {
        if let Ok(bytes) = fs::read(&reply) {
            let _ = fs::remove_file(&reply);
            return serde_json::from_slice(&bytes).map_err(|e| e.to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let _ = fs::remove_file(path);
    Err("Open the LockIN desktop app (or leave it in the tray) to add this website.".into())
}
pub fn process_inbox(app: &tauri::AppHandle) {
    let dir = data_dir().join("quick-add");
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten().take(30) {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("request") {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        if bytes.len() > 16384 {
            let _ = fs::remove_file(path);
            continue;
        }
        let Ok(request) = serde_json::from_slice::<QuickAdd>(&bytes) else {
            let _ = fs::remove_file(path);
            continue;
        };
        if uuid::Uuid::parse_str(&request.request_id).is_err() {
            let _ = fs::remove_file(path);
            continue;
        }
        let engine = app.state::<Engine>();
        let mut current = engine.state.lock().unwrap();
        let mut next = current.clone();
        let result = add_website(&mut next, &request).and_then(|id| {
            write_state(&next)?;
            *current = next;
            Ok(id)
        });
        let response = match result {
            Ok(id) => {
                let _ = app.emit("state-updated", ());
                serde_json::json!({"ok":true,"siteId":id})
            }
            Err(error) => serde_json::json!({"ok":false,"error":error}),
        };
        let _ = fs::write(
            dir.join(format!("{}.response", request.request_id)),
            serde_json::to_vec(&response).unwrap_or_default(),
        );
        let _ = fs::remove_file(path);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn companion_updates_refuse_downgrades() {
        assert!(check_bundle_version("1.3.1", "1.2.0").is_err());
        assert!(check_bundle_version("1.3.1", "1.3.1").is_ok());
        assert!(check_bundle_version("1.3.0", "1.3.1").is_ok());
        assert!(check_bundle_version("broken", "1.3.1").is_err());
        let manifest: serde_json::Value =
            serde_json::from_slice(BUNDLE.get_file("manifest.json").unwrap().contents()).unwrap();
        assert_eq!(manifest["version"], env!("CARGO_PKG_VERSION"));
    }
    #[test]
    fn quick_add_inherits_manual_category_and_deduplicates() {
        let mut state = AppState::default();
        state.session = Some(Session {
            id: "s".into(),
            site_ids: vec!["instagram".into()],
            domains: vec!["instagram.com".into()],
            started_at: timestamp(),
            ends_at: timestamp() + 60000,
            test_mode: true,
            protection: state.settings.protection.clone(),
            policy_category_id: "social".into(),
            label: "Social media".into(),
            blocked_keywords: vec![],
            strict_network_guard: false,
            app_ids: vec![],
            app_paths: vec![],
            category_ids: vec!["social".into()],
            unlock: None,
        });
        state.migrate();
        let request = QuickAdd {
            request_id: uuid::Uuid::new_v4().to_string(),
            domain: "new.example".into(),
            name: "New".into(),
            category_id: "social".into(),
        };
        let id = add_website(&mut state, &request).unwrap();
        assert!(state
            .sessions
            .first()
            .unwrap()
            .domains
            .contains(&"new.example".into()));
        assert_eq!(add_website(&mut state, &request).unwrap(), id);
        assert_eq!(state.sites.len(), 9);
        assert_eq!(state.revision, 1);
    }
}
