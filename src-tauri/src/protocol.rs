use tauri::{AppHandle, Event};

/// The scheme `register_dzsa_protocol` claims in the Windows registry.
const SCHEME: &str = "dzsa://";

/// Handle a `dzsa://` deep-link event from the operating system.
///
/// When the OS launches this app with a `dzsa://connect/...` URI,
/// Tauri fires a `deep-link://` event that we listen for.
pub fn handle_deep_link(event: Event) {
    let payload = event.payload();
    eprintln!("received dzsa:// deep link: {payload}");
}

/// Pull a `dzsa://` link out of a process's command line, if it carries one.
///
/// Windows hands a registered protocol handler its URL as a plain argument, so
/// this is the only place a deep link appears. Everything else on the line —
/// the executable path, `--autostart` — is ignored.
pub fn link_in_argv(argv: &[String]) -> Option<&str> {
    argv.iter()
        .map(String::as_str)
        .find(|arg| arg.to_ascii_lowercase().starts_with(SCHEME))
}

/// Handle the command line of a duplicate launch that single-instance killed.
///
/// Without this the link is lost outright: the OS starts a second process to
/// carry it, the single-instance plugin exits that process, and nothing in the
/// surviving one ever sees the argument.
pub fn handle_argv(_app: &AppHandle, argv: &[String]) {
    if let Some(link) = link_in_argv(argv) {
        eprintln!("received dzsa:// deep link from a second launch: {link}");
    }
}

#[cfg(test)]
mod tests {
    use super::link_in_argv;

    fn argv(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_link_is_found_past_the_executable_path() {
        let args = argv(&[
            r"C:\Program Files\Tetra Launcher\tetra-launcher.exe",
            "dzsa://connect/1.2.3.4:2302",
        ]);
        assert_eq!(link_in_argv(&args), Some("dzsa://connect/1.2.3.4:2302"));
    }

    /// Windows does not promise a case for the scheme it hands back, and the
    /// registry key it comes from is case-insensitive.
    #[test]
    fn the_scheme_is_matched_case_insensitively() {
        let args = argv(&["tetra-launcher.exe", "DZSA://connect/1.2.3.4:2302"]);
        assert!(link_in_argv(&args).is_some());
    }

    /// The ordinary autostart launch. Treating `--autostart` as a link would
    /// mean every boot looked like a join request.
    #[test]
    fn an_ordinary_launch_carries_no_link() {
        assert_eq!(link_in_argv(&argv(&["tetra-launcher.exe"])), None);
        assert_eq!(
            link_in_argv(&argv(&["tetra-launcher.exe", "--autostart"])),
            None
        );
    }
}
