#![windows_subsystem = "windows"]

fn main() {
    // Linux: WebKitGTK frequently fails to allocate GBM/DMA-BUF buffers on
    // modern GPU stacks (NVIDIA/AMD under XWayland) and renders a blank window,
    // and the raw Wayland backend throws protocol errors with WebKit. These
    // force WebKit to a software renderer and route GTK through X11/XWayland,
    // which is far more stable. Each is set only when absent so a user can still
    // override. Without these the launcher starts (tray + taskbar appear) but no
    // window renders.
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
