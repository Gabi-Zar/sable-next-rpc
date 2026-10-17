//! Chromium reads its scrolling switches at launch, before the frontend can
//! send preferences, so the last choice is kept in a file next to the config.

const FILE: &str = "smooth_scrolling";

#[must_use]
pub fn enabled() -> bool {
    crate::app_dirs::config_dir()
        .and_then(|dir| std::fs::read_to_string(dir.join(FILE)).ok())
        .is_none_or(|stored| stored.trim() != "0")
}

pub fn remember(enabled: bool) {
    let Some(dir) = crate::app_dirs::config_dir() else {
        return;
    };
    let _ = crate::app_dirs::create_private_dir(&dir);
    let _ = std::fs::write(dir.join(FILE), if enabled { "1" } else { "0" });
}
