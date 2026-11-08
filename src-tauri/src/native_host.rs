use crate::{model::timestamp, read_state};
use std::io::{Read, Write};

pub fn run() {
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut header = [0_u8; 4];
        if input.read_exact(&mut header).is_err() {
            break;
        }
        let length = u32::from_le_bytes(header) as usize;
        if length > 1024 * 1024 {
            break;
        }
        let mut bytes = vec![0_u8; length];
        if input.read_exact(&mut bytes).is_err() {
            break;
        }
        let Ok(message) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            break;
        };
        let response = if crate::bridge::registered_elsewhere() {
            serde_json::json!({"type":"reconnect_required", "error":"The current desktop app repaired the bridge registration. Reconnecting to its executable."})
        } else if message["type"] == "quick_add" {
            let request = crate::companion::QuickAdd {
                request_id: String::new(),
                domain: message["domain"].as_str().unwrap_or("").to_string(),
                name: message["name"].as_str().unwrap_or("").to_string(),
                category_id: message["categoryId"].as_str().unwrap_or("").to_string(),
            };
            match crate::companion::send_quick_add(request) {
                Ok(result) => {
                    serde_json::json!({"type":"quick_add_result","requestId":message["requestId"],"result":result})
                }
                Err(error) => {
                    serde_json::json!({"type":"quick_add_result","requestId":message["requestId"],"result":{"ok":false,"error":error}})
                }
            }
        } else if message["type"] == "update_extension" {
            match crate::companion::prepare() {
                Ok(bundle) => serde_json::json!({"type":"extension_updated","bundle":bundle}),
                Err(error) => serde_json::json!({"type":"extension_update_error","error":error}),
            }
        } else if message["type"] == "sync" {
            match read_state() {
                Ok(state) => {
                    let state = if message["supportsSessions"].as_bool() == Some(true) {
                        state
                    } else {
                        crate::model::legacy_companion_state(state)
                    };
                    serde_json::json!({"type":"state", "state":state, "syncedAt":timestamp(),"extensionVersion":env!("CARGO_PKG_VERSION"),"protocolVersion":2})
                }
                Err(error) => serde_json::json!({"type":"error", "error":error}),
            }
        } else {
            continue;
        };
        let Ok(payload) = serde_json::to_vec(&response) else {
            break;
        };
        if output
            .write_all(&(payload.len() as u32).to_le_bytes())
            .is_err()
            || output.write_all(&payload).is_err()
            || output.flush().is_err()
        {
            break;
        }
        // Only a round trip from an extension with successfully applied rules counts as connected.
        if message["type"] == "sync"
            && response["type"] == "state"
            && message["applied"].as_bool() == Some(true)
        {
            let _ =
                crate::bridge::record_applied(message["extensionVersion"].as_str().unwrap_or(""));
        }
    }
}
