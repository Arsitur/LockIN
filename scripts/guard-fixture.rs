// Harmless executable used only by the isolated desktop guard smoke test.
fn main() {
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}
