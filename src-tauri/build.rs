fn main() {
    println!("cargo:rerun-if-changed=../extension");
    tauri_build::build()
}
