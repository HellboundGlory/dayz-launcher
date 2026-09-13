//! Serving an installed theme's static assets to the webview, read-only:
//! `tetra-theme://<theme id>/<relative path>`. Nothing here writes, renames or
//! deletes, and a request that resolves anywhere but its own theme's directory
//! is refused — see [`resolve_asset`].

use std::path::{Component, Path, PathBuf};

use tauri::http::{header, HeaderValue, Request, Response, StatusCode, Uri};
use tauri::{AppHandle, UriSchemeResponder};

/// The scheme the webview loads theme CSS, images and fonts from. Named here
/// and in `tauri.conf.json`'s CSP — the only two places that know it.
pub const SCHEME: &str = "tetra-theme";

/// Answer one `tetra-theme://` request. Registered by `run` in lib.rs.
pub fn handle(app: &AppHandle, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let themes_root = crate::paths::themes_dir(app);
    let uri = request.uri().clone();
    let app = app.clone();
    // Off the webview thread: answering the request reads a file.
    tauri::async_runtime::spawn_blocking(move || match read_asset(&themes_root, &uri) {
        Ok((content_type, bytes)) => {
            let mut response = Response::new(bytes);
            response
                .headers_mut()
                .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
            responder.respond(response);
        }
        // The one bare 404 every kind of refusal answers with: which part of a
        // request failed is not the webview's business.
        Err(reason) => {
            crate::log::log_line_verbose(&app, "theme", &format!("{uri}: {reason}"));
            let mut response = Response::new(Vec::new());
            *response.status_mut() = StatusCode::NOT_FOUND;
            responder.respond(response);
        }
    });
}

/// One request end to end: URL -> theme-relative path -> the bytes and the
/// content type to serve them as.
fn read_asset(themes_root: &Path, uri: &Uri) -> Result<(&'static str, Vec<u8>), String> {
    let (theme_id, rel_path) = split_uri(uri)?;
    let path = resolve_asset(themes_root, &theme_id, &rel_path)?;
    // A theme directory also holds the manifest and the palette; the webview
    // has no reason to be served either, so only known asset types are read.
    let content_type =
        asset_type(&path).ok_or_else(|| format!("`{rel_path}` is not a servable asset type"))?;
    let bytes =
        std::fs::read(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    Ok((content_type, bytes))
}

/// `tetra-theme://<theme id>/<relative path>` -> its two halves. The path
/// arrives percent-encoded; an asset name may hold spaces or non-ASCII.
fn split_uri(uri: &Uri) -> Result<(String, String), String> {
    let rel_path = percent_encoding::percent_decode_str(uri.path())
        .decode_utf8()
        .map_err(|_| "The request path is not valid UTF-8.".to_string())?;
    Ok((
        uri.host().unwrap_or_default().to_string(),
        rel_path.trim_start_matches('/').to_string(),
    ))
}

/// Resolve a theme-relative asset path inside that theme's own installed
/// directory, or say why it stays unserved. Takes a plain `&Path` root so it is
/// testable against a scratch directory, the way the rest of `theme` is.
pub fn resolve_asset(
    themes_root: &Path,
    theme_id: &str,
    rel_path: &str,
) -> Result<PathBuf, String> {
    // The id becomes a path component, exactly as in `theme::theme_dir`.
    if !crate::theme::is_usable_id(theme_id) {
        return Err(format!(
            "`{theme_id}` is not a usable theme id — it must be a single directory name"
        ));
    }

    let relative = Path::new(rel_path);
    // Checked before the `..` scan below: on Windows a leading `\` makes the
    // parser emit `RootDir` then `ParentDir` for something like `\..\x`, so
    // checking rootedness first is what keeps the rejection reason consistent
    // between platforms for a path that is both rooted and walks upward.
    // `Path::join` discards the theme directory rather than nesting under it
    // for any of these: a root or a Windows drive prefix in the parsed path, or
    // a leading separator — a backslash is an ordinary character off Windows,
    // so it needs its own check.
    if relative
        .components()
        .any(|c| matches!(c, Component::RootDir | Component::Prefix(_)))
        || rel_path.starts_with('/')
        || rel_path.starts_with('\\')
    {
        return Err(format!(
            "`{rel_path}` is an absolute path (which `Path::join` would let override the theme directory); refusing it."
        ));
    }
    if relative
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(format!(
            "`{rel_path}` points outside the theme (`..` in its path); refusing it."
        ));
    }

    let theme_root = themes_root.join(theme_id);
    if !theme_root.is_dir() {
        return Err(format!(
            "No installed theme `{theme_id}` at {}",
            theme_root.display()
        ));
    }
    let theme_root = theme_root
        .canonicalize()
        .map_err(|e| format!("Could not resolve {}: {e}", theme_root.display()))?;

    let candidate = theme_root.join(relative);
    // Before canonicalising, which would follow the link: checked on the final
    // path, so a link pointing back inside the theme is refused too.
    if std::fs::symlink_metadata(&candidate)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!("`{rel_path}` is a symbolic link; refusing it."));
    }

    let resolved = candidate
        .canonicalize()
        .map_err(|e| format!("Could not resolve {}: {e}", candidate.display()))?;
    // The link check above only sees the last component, so this prefix check
    // is what refuses a *directory* link earlier in the path — and any other
    // escape from the theme's own directory.
    if !resolved.starts_with(&theme_root) {
        return Err(format!(
            "`{rel_path}` resolves outside theme `{theme_id}`; refusing it."
        ));
    }
    Ok(resolved)
}

/// What a theme asset is served as. Only these extensions are served at all —
/// `theme.json`, `tokens.json` and everything else on disk in a theme
/// directory stays there.
fn asset_type(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "css" => "text/css",
        "png" => "image/png",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A scratch themes root unique to one test — never the real one (no
    /// `tempfile` dependency), same as the rest of `theme`.
    fn scratch(tag: &str) -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let seq = N.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tetra-theme-protocol-{tag}-{nanos}-{seq}"));
        std::fs::create_dir_all(&dir).expect("could not create scratch dir");
        dir
    }

    /// A root holding one installed theme (`aurora.theme`, with a nested asset
    /// and a palette) plus a file outside it that a test can try to reach.
    fn installed(tag: &str) -> PathBuf {
        let root = scratch(tag);
        let theme = root.join("aurora.theme");
        std::fs::create_dir_all(theme.join("preview/dark")).unwrap();
        std::fs::write(theme.join("main.css"), b"body{}").unwrap();
        std::fs::write(theme.join("preview/dark/bg.png"), b"png").unwrap();
        std::fs::write(theme.join(crate::theme::TOKENS_FILE), b"{}").unwrap();
        std::fs::write(root.join("settings.json"), b"{}").unwrap();
        root
    }

    /// The URL the webview would ask for, built the way the frontend will.
    fn request(theme_id: &str, rel_path: &str) -> Uri {
        format!("{SCHEME}://{theme_id}/{rel_path}")
            .parse()
            .expect("a valid request URL")
    }

    #[test]
    fn a_nested_asset_resolves_inside_its_theme() {
        let root = installed("nested");
        let theme = root.join("aurora.theme");

        let resolved =
            resolve_asset(&root, "aurora.theme", "preview/dark/bg.png").expect("must resolve");

        assert_eq!(
            resolved,
            theme.join("preview/dark/bg.png").canonicalize().unwrap()
        );
        assert!(resolve_asset(&root, "aurora.theme", "main.css").is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Refused before anything is joined, so the file outside the theme (which
    /// does exist, at the themes root) is never reached.
    #[test]
    fn a_parent_segment_is_refused() {
        let root = installed("parent");

        for escape in [
            "../settings.json",
            "../../settings.json",
            "preview/../../settings.json",
            "preview/dark/../../../settings.json",
        ] {
            let reason = resolve_asset(&root, "aurora.theme", escape).expect_err("must refuse");
            assert!(reason.contains(".."), "{escape}: {reason}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_absolute_path_is_refused() {
        let root = installed("absolute");
        let outside = root.join("settings.json");

        for absolute in [
            outside.to_string_lossy().into_owned(),
            // A leading separator survives `Path::new` as a root component, so
            // it is refused by the same check as the platform's own absolute form.
            "\\..\\settings.json".to_string(),
        ] {
            let reason = resolve_asset(&root, "aurora.theme", &absolute).expect_err("must refuse");
            assert!(reason.contains("absolute"), "{absolute}: {reason}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_theme_that_is_not_installed_is_refused() {
        let root = installed("unknown");

        let reason = resolve_asset(&root, "not.installed", "main.css").expect_err("must refuse");

        assert!(reason.contains("No installed theme"), "{reason}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_theme_id_that_is_a_path_is_refused() {
        let root = installed("id");

        for id in ["..", "../../etc", "aurora.theme/../.."] {
            let reason = resolve_asset(&root, id, "main.css").expect_err("must refuse");
            assert!(reason.contains("usable theme id"), "{id}: {reason}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The link points at a file *inside* the theme, so the canonicalised
    /// prefix check would let it through — only the deliberate link check refuses.
    #[cfg(unix)]
    #[test]
    fn a_symlink_at_the_resolved_path_is_refused() {
        let root = installed("symlink");
        let theme = root.join("aurora.theme");
        std::os::unix::fs::symlink(theme.join("main.css"), theme.join("alias.css")).unwrap();

        let reason = resolve_asset(&root, "aurora.theme", "alias.css").expect_err("must refuse");

        assert!(reason.contains("symbolic link"), "{reason}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A link earlier in the path is a directory to `symlink_metadata` on the
    /// final path; the canonicalised prefix check is what refuses it.
    #[cfg(unix)]
    #[test]
    fn a_symlinked_directory_cannot_smuggle_a_path_out_of_the_theme() {
        let root = installed("symlink-dir");
        let theme = root.join("aurora.theme");
        let outside = root.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("stolen.css"), b"body{}").unwrap();
        std::os::unix::fs::symlink(&outside, theme.join("linked")).unwrap();

        let reason =
            resolve_asset(&root, "aurora.theme", "linked/stolen.css").expect_err("must refuse");

        assert!(reason.contains("outside theme"), "{reason}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A chain of two links (one to another link, the last to a file outside
    /// the theme) must not resolve any further than a single hop does.
    #[cfg(unix)]
    #[test]
    fn a_chained_symlink_cannot_smuggle_a_path_out_of_the_theme() {
        let root = installed("symlink-chain");
        let theme = root.join("aurora.theme");
        let outside = root.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("stolen.css"), b"body{}").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("hop1")).unwrap();
        std::os::unix::fs::symlink(root.join("hop1"), theme.join("hop2")).unwrap();

        let reason =
            resolve_asset(&root, "aurora.theme", "hop2/stolen.css").expect_err("must refuse");

        assert!(reason.contains("outside theme"), "{reason}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A symlink loop must fail closed (an unresolvable path), not panic or
    /// hang.
    #[cfg(unix)]
    #[test]
    fn a_symlink_loop_is_refused_rather_than_panicking() {
        let root = installed("symlink-loop");
        let theme = root.join("aurora.theme");
        std::os::unix::fs::symlink(theme.join("loop-b"), theme.join("loop-a")).unwrap();
        std::os::unix::fs::symlink(theme.join("loop-a"), theme.join("loop-b")).unwrap();

        let reason = resolve_asset(&root, "aurora.theme", "loop-a").expect_err("must refuse");

        assert!(!reason.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A request path carrying a raw NUL byte cannot slip past the `..`/
    /// absolute-path checks by confusing something into truncating the string.
    #[test]
    fn a_null_byte_in_the_path_is_refused_not_silently_truncated() {
        let root = installed("nul");

        let reason = resolve_asset(&root, "aurora.theme", "main.css\0/../../settings.json")
            .expect_err("must refuse");

        assert!(!reason.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An overlong UTF-8 encoding of `/` (`%c0%af`) must not decode into a
    /// path separator the traversal check would otherwise have caught as `..`.
    #[test]
    fn an_overlong_utf8_slash_is_refused_as_invalid_encoding() {
        let root = installed("overlong");
        let uri = request("aurora.theme", "..%c0%afsettings.json");

        let reason = read_asset(&root, &uri).expect_err("must refuse");

        assert!(!reason.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_request_url_splits_into_theme_id_and_asset_path() {
        let uri: Uri = "tetra-theme://aurora.theme/preview/dark/bg%20one.png"
            .parse()
            .expect("a valid request URL");

        let (theme_id, rel_path) = split_uri(&uri).expect("must split");

        assert_eq!(theme_id, "aurora.theme");
        assert_eq!(rel_path, "preview/dark/bg one.png");
    }

    #[test]
    fn a_served_asset_carries_its_bytes_and_content_type() {
        let root = installed("read");

        let (content_type, bytes) =
            read_asset(&root, &request("aurora.theme", "main.css")).expect("must serve");

        assert_eq!(content_type, "text/css");
        assert_eq!(bytes, b"body{}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Every refusal is the same 404 with no body — a request naming a file
    /// that is absent, one that exists but is not servable, and one trying to
    /// escape all answer alike.
    #[test]
    fn refused_requests_all_read_the_same() {
        let root = installed("refused");

        for uri in [
            request("aurora.theme", "missing.css"),
            request("aurora.theme", crate::theme::TOKENS_FILE),
            request("aurora.theme", "theme.json"),
            request("aurora.theme", "../../settings.json"),
            request("not.installed", "main.css"),
            // Percent-encoded here as the webview delivers it, decoded by
            // `split_uri` before `resolve_asset` ever sees it.
            request("aurora.theme", "%2e%2e%2fsettings.json"),
            request("aurora.theme", "..%2fsettings.json"),
        ] {
            let reason = read_asset(&root, &uri).expect_err("must refuse");
            assert!(!reason.is_empty(), "{uri}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn only_the_asset_types_the_webview_needs_are_served() {
        for (name, expected) in [
            ("theme.css", "text/css"),
            ("bg.png", "image/png"),
            ("bg.PNG", "image/png"),
            ("bg.webp", "image/webp"),
            ("bg.jpg", "image/jpeg"),
            ("bg.jpeg", "image/jpeg"),
            ("icon.svg", "image/svg+xml"),
            ("body.woff2", "font/woff2"),
            ("body.woff", "font/woff"),
            ("body.ttf", "font/ttf"),
            ("body.otf", "font/otf"),
        ] {
            assert_eq!(asset_type(Path::new(name)), Some(expected), "{name}");
        }

        for name in [
            crate::theme::MANIFEST_FILE,
            crate::theme::TOKENS_FILE,
            "README.md",
            "notes.txt",
            "no-extension",
        ] {
            assert_eq!(asset_type(Path::new(name)), None, "{name}");
        }
    }
}
