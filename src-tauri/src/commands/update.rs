/// The only sites the app links to. Anything else is refused.
const ALLOWED_HOSTS: &[&str] = &["tetralauncher.com", "github.com"];

/// Longest link the app will check, well above any real changelog link.
const MAX_URL_LEN: usize = 2048;

/// Cap on a release-notes body, so a hostile reply cannot exhaust memory.
const MAX_NOTES_BYTES: usize = 256 * 1024;

/// Open a link from the WebView in the user's browser. Only `https` links to
/// [`ALLOWED_HOSTS`] are passed through — everything else is an error.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let checked = checked_external_url(&url)?;
    tetra_launch::spawn::open_with_desktop(std::ffi::OsStr::new(&checked))
        .map_err(|e| format!("Could not open the link: {e}"))
}

/// Returns the normalised form of an allowed link, so what is opened is what
/// was checked. Errors are fixed strings; the input is never echoed back.
fn checked_external_url(raw: &str) -> Result<String, String> {
    if raw.len() > MAX_URL_LEN {
        return Err("Link is too long".into());
    }
    // The parser silently drops newlines and encodes spaces in a path, which
    // would let a checked link differ from the one typed in the markdown.
    if raw.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Invalid link".into());
    }
    let url = reqwest::Url::parse(raw).map_err(|_| "Invalid link".to_string())?;
    if url.scheme() != "https" {
        return Err("Only https links are allowed".into());
    }
    if !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Err("Invalid link".into());
    }
    let allowed = match url.host_str() {
        // Only this project's own pages on GitHub, not any repo or login page.
        Some("github.com") => url.path().starts_with(REPO_PATH),
        Some(host) => ALLOWED_HOSTS.contains(&host),
        None => false,
    };
    if allowed {
        Ok(url.as_str().to_string())
    } else {
        Err("That site is not allowed".into())
    }
}

/// The project's path on github.com; links elsewhere on GitHub are refused.
const REPO_PATH: &str = "/HellboundGlory/dayz-launcher";

/// A release-notes redirect may only stay on the GitHub API over https.
fn redirect_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("api.github.com")
}

/// Fetch a release's changelog from GitHub when the update manifest has none.
/// Every failure is `Ok(None)`, matching the dialog's "no notes" state.
#[tauri::command]
pub async fn fetch_release_notes(version: String) -> Result<Option<String>, String> {
    let Some(url) = release_notes_url(&version) else {
        return Err("Invalid version".into());
    };
    let client = match reqwest::Client::builder()
        .user_agent(concat!("tetra-launcher/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 || !redirect_allowed(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
    {
        Ok(client) => client,
        Err(_) => return Ok(None),
    };
    let Ok(res) = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
    else {
        return Ok(None);
    };
    if !res.status().is_success() {
        return Ok(None);
    }
    let mut res = res;
    let mut body: Vec<u8> = Vec::new();
    loop {
        match res.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() + chunk.len() > MAX_NOTES_BYTES {
                    return Ok(None);
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => return Ok(None),
        }
    }
    Ok(notes_from_body(&body))
}

/// The release API URL for a version, built from the parsed form so nothing
/// from the raw string reaches the path.
fn release_notes_url(version: &str) -> Option<String> {
    let parsed = semver::Version::parse(version).ok()?;
    if !parsed.build.is_empty() {
        return None;
    }
    Some(format!(
        "https://api.github.com/repos/HellboundGlory/dayz-launcher/releases/tags/v{parsed}"
    ))
}

/// The trimmed `body` field of a release JSON response, or `None`.
fn notes_from_body(bytes: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let body = value.get("body")?.as_str()?.trim();
    if body.is_empty() {
        None
    } else {
        Some(body.to_string())
    }
}

/// Whether this copy lives in an NSIS/AppImage install location, vs a portable exe.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn is_installed_copy() -> bool {
    // Linux ships as an AppImage, which the updater replaces in place.
    true
}

#[cfg(windows)]
#[tauri::command]
pub fn is_installed_copy() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };

    // Must match `productName` in tauri.conf.json.
    const PRODUCT_DIR: &str = "Tetra Launcher";

    for var in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        let Ok(root) = std::env::var(var) else {
            continue;
        };
        let installed_root = std::path::Path::new(&root).join(PRODUCT_DIR);
        if exe.starts_with(&installed_root) {
            return true;
        }
    }
    false
}

/// No macOS distribution model yet, so default to portable (`false`).
#[cfg(not(any(target_os = "linux", windows)))]
#[tauri::command]
pub fn is_installed_copy() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::{checked_external_url, notes_from_body, redirect_allowed, release_notes_url};

    #[test]
    fn checked_external_url_accepts_only_https_links_to_the_project_sites() {
        let allowed = [
            (
                "https://tetralauncher.com/download",
                "https://tetralauncher.com/download",
            ),
            (
                "https://github.com/HellboundGlory/dayz-launcher/releases/tag/v3.1.1",
                "https://github.com/HellboundGlory/dayz-launcher/releases/tag/v3.1.1",
            ),
        ];
        for (raw, expected) in allowed {
            assert_eq!(
                checked_external_url(raw).as_deref(),
                Ok(expected),
                "raw: {raw:?}"
            );
        }

        let long = format!("https://tetralauncher.com/{}", "a".repeat(3000));
        let refused = [
            "http://tetralauncher.com",
            "https://evil.example",
            "https://tetralauncher.com.evil.example/",
            "https://evil.example/tetralauncher.com",
            "https://github.com/someone-else/repo",
            "https://github.com/login/oauth/authorize?client_id=x",
            "https://github.com./HellboundGlory/dayz-launcher",
            "https://user@tetralauncher.com/",
            "https://tetralauncher.com:8443/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "-oProxyCommand=x",
            "",
            "https://tetralauncher.com/a b",
            "https://tetralauncher.com/a\nb",
            long.as_str(),
        ];
        for raw in refused {
            assert!(checked_external_url(raw).is_err(), "accepted: {raw:?}");
        }
    }

    #[test]
    fn release_notes_redirects_stay_on_the_github_api() {
        for (url, ok) in [
            ("https://api.github.com/repositories/1/releases/2", true),
            ("http://api.github.com/x", false),
            ("https://evil.example/x", false),
            ("https://objects.githubusercontent.com/x", false),
        ] {
            let url = reqwest::Url::parse(url).unwrap();
            assert_eq!(redirect_allowed(&url), ok, "url: {url}");
        }
    }

    #[test]
    fn release_notes_url_is_built_from_a_parsed_version() {
        let accepted = [
            (
                "3.1.1",
                "https://api.github.com/repos/HellboundGlory/dayz-launcher/releases/tags/v3.1.1",
            ),
            (
                "3.1.1-beta.2",
                "https://api.github.com/repos/HellboundGlory/dayz-launcher/releases/tags/v3.1.1-beta.2",
            ),
        ];
        for (version, expected) in accepted {
            assert_eq!(
                release_notes_url(version).as_deref(),
                Some(expected),
                "version: {version:?}"
            );
        }
        for version in ["3.1.1+build", "../x", "3.1", "v3.1.1", "", "3.1.1/../../x"] {
            assert_eq!(release_notes_url(version), None, "version: {version:?}");
        }
    }

    #[test]
    fn notes_from_body_reads_a_trimmed_body_or_nothing() {
        assert_eq!(
            notes_from_body(br#"{"body":"  hello \n"}"#),
            Some("hello".to_string())
        );
        for raw in [r#"{"body":""}"#, "{}", "[]", "not json", r#"{"body":5}"#] {
            assert_eq!(notes_from_body(raw.as_bytes()), None, "raw: {raw:?}");
        }
    }
}
