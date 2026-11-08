#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.get(1).map(String::as_str) == Some("--recover-network-guard") {
            if lockin_lib::network_guard::recover().is_err() {
                std::process::exit(1);
            }
            return;
        }
        if args.get(1).map(String::as_str) == Some("--network-service") {
            let _ = lockin_lib::network_guard::run();
            return;
        }
        if args.get(1).map(String::as_str) == Some("--install-network-guard") {
            if let Some(path) = args.get(2) {
                let result = lockin_lib::network_guard::install(std::path::PathBuf::from(path));
                if let Err(error) = result {
                    let _ = std::fs::write(
                        std::path::Path::new(path).join("guard-setup-error.txt"),
                        error,
                    );
                    std::process::exit(1);
                }
            }
            return;
        }
    }
    // Chrome passes the extension origin as the first argument to a native host.
    if std::env::args()
        .skip(1)
        .any(|a| a.starts_with("chrome-extension://"))
    {
        lockin_lib::native_host::run();
        return;
    }
    lockin_lib::run();
}
