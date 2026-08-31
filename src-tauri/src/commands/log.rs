//! Tiny bridge so the frontend's diagnostics land in the same file logger as
//! the backend's — without a command the webview has no way to write a file.

use tauri::AppHandle;

/// Cap on a field's length after sanitising, so the webview can't flood the log file.
const MAX_FIELD_LEN: usize = 2000;

/// Strip control characters (so a message can't forge a fake second log line
/// via an embedded newline) and cap the length.
fn sanitise(s: &str) -> String {
    let cleaned: String = s.chars().filter(|c| !c.is_control()).collect();
    match cleaned.char_indices().nth(MAX_FIELD_LEN) {
        Some((byte_idx, _)) => cleaned[..byte_idx].to_string(),
        None => cleaned,
    }
}

/// Append `message` from the frontend to `tetra-launcher.log`, tagged `[frontend]`.
/// `verbose` routes hot-path lines through `log_line_verbose`, debug-build only.
#[tauri::command]
pub fn log_client(app: AppHandle, level: String, message: String, verbose: Option<bool>) {
    let level = sanitise(&level);
    let msg = format!("[frontend] {}", sanitise(&message));
    if verbose.unwrap_or(false) {
        crate::log::log_line_verbose(&app, &level, &msg);
    } else {
        crate::log::log_line(&app, &level, &msg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_newlines_so_a_message_cannot_forge_a_second_log_line() {
        let forged = "real message\n[exit] state persisted and Steam shut down; terminating";
        let cleaned = sanitise(forged);
        assert!(!cleaned.contains('\n'));
        assert_eq!(
            cleaned,
            "real message[exit] state persisted and Steam shut down; terminating"
        );
    }

    #[test]
    fn strips_other_control_characters_too() {
        assert_eq!(sanitise("a\rb\tc\u{7}d"), "abcd");
    }

    #[test]
    fn an_ordinary_message_is_unchanged() {
        assert_eq!(
            sanitise("get_server_list: 42 rows in 12ms"),
            "get_server_list: 42 rows in 12ms"
        );
    }

    #[test]
    fn a_field_longer_than_the_cap_is_truncated_not_rejected() {
        let long = "a".repeat(MAX_FIELD_LEN + 500);
        let cleaned = sanitise(&long);
        assert_eq!(cleaned.chars().count(), MAX_FIELD_LEN);
    }
}
