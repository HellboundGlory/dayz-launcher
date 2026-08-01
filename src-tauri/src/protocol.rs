use tauri::Event;

/// Handle a `dzsa://` deep-link event from the operating system.
///
/// When the OS launches this app with a `dzsa://connect/...` URI,
/// Tauri fires a `deep-link://` event that we listen for.
pub fn handle_deep_link(event: Event) {
    let payload = event.payload();
    eprintln!("received dzsa:// deep link: {payload}");
}
