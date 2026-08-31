#![windows_subsystem = "windows"]

fn main() {
    // Linux: force WebKit software rendering + X11 to avoid a blank window on
    // WebKitGTK/Wayland (see .ai-notes/src-tauri/src/main.rs.md).
    #[cfg(target_os = "linux")]
    {
        for (key, value) in [
            ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
            ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
        ] {
            if std::env::var_os(key).is_none() {
                std::env::set_var(key, value);
            }
        }
        if std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }

    app_lib::run();
}
