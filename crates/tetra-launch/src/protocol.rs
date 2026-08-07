use crate::error::ProtocolError;

#[cfg(windows)]
use winreg::enums::*;

/// Parsed `dzsa://` URI.
pub struct DzsaUri {
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
}

/// Parse a `dzsa://connect/IP:PORT?password=...` URI.
///
/// Expected format: `dzsa://connect/127.0.0.1:2302?password=secret`
pub fn parse_dzsa_uri(uri: &str) -> Result<DzsaUri, ProtocolError> {
    let without_prefix = uri
        .strip_prefix("dzsa://connect/")
        .ok_or_else(|| ProtocolError::InvalidUri("expected dzsa://connect/ prefix".into()))?;

    let (host_port, query) = match without_prefix.split_once('?') {
        Some((hp, q)) => (hp, Some(q)),
        None => (without_prefix, None),
    };

    let (host, port_str) = host_port
        .split_once(':')
        .ok_or_else(|| ProtocolError::InvalidUri("missing port after IP".into()))?;

    let port: u16 = port_str
        .parse()
        .map_err(|_| ProtocolError::InvalidUri(format!("invalid port: {port_str}")))?;

    let password = query.and_then(|q| {
        q.split('&')
            .find(|p| p.starts_with("password="))
            .map(|p| p.strip_prefix("password=").unwrap().to_string())
    });

    Ok(DzsaUri {
        host: host.to_string(),
        port,
        password,
    })
}

/// Register `dzsa://` protocol handler in Windows registry.
///
/// Writes to `HKCU\Software\Classes\dzsa\` so the operating system knows
/// to open this launcher when a `dzsa://` link is clicked.
#[cfg(windows)]
pub fn register_dzsa_protocol(exe_path: &std::path::Path) -> Result<(), ProtocolError> {
    let hkcu = winreg::RegKey::predef(HKEY_CURRENT_USER);
    let (dzsa, _) = hkcu.create_subkey("Software\\Classes\\dzsa")?;
    dzsa.set_value("", &"URL: DayZ Standalone Launcher Protocol")?;
    dzsa.set_value("URL Protocol", &"")?;

    let (icon, _) = dzsa.create_subkey("DefaultIcon")?;
    icon.set_value("", &format!("\"{}\",0", exe_path.display()))?;

    let (cmd, _) = dzsa.create_subkey("shell\\open\\command")?;
    cmd.set_value("", &format!("\"{}\" \"%1\"", exe_path.display()))?;

    Ok(())
}

/// Unregister the `dzsa://` protocol handler.
#[cfg(windows)]
pub fn unregister_dzsa_protocol() -> Result<(), ProtocolError> {
    let hkcu = winreg::RegKey::predef(HKEY_CURRENT_USER);
    hkcu.delete_subkey_all("Software\\Classes\\dzsa")?;
    Ok(())
}

/// Register the `dzsa://` protocol handler on Linux via an XDG desktop entry.
///
/// Writes `~/.local/share/applications/tetra-launcher-dzsa.desktop` marking the
/// launcher as the handler for `x-scheme-handler/dzsa`, then tells the desktop
/// environment to use it. The Windows twin writes to the registry instead.
#[cfg(target_os = "linux")]
pub fn register_dzsa_protocol(exe_path: &std::path::Path) -> Result<(), ProtocolError> {
    let home = std::env::var_os("HOME")
        .ok_or_else(|| ProtocolError::InvalidUri("no HOME in environment".into()))?;
    let apps_dir = std::path::PathBuf::from(home)
        .join(".local")
        .join("share")
        .join("applications");
    std::fs::create_dir_all(&apps_dir)?;

    let desktop_file = apps_dir.join("tetra-launcher-dzsa.desktop");
    let content = format!(
        "[Desktop Entry]\nType=Application\nName=Tetra Launcher\nComment=DayZ Standalone Launcher Protocol Handler\nExec=\"{}\" %u\nMimeType=x-scheme-handler/dzsa;\nNoDisplay=true\n",
        exe_path.display()
    );
    std::fs::write(&desktop_file, content)?;

    let _ = std::process::Command::new("xdg-mime")
        .args([
            "default",
            "tetra-launcher-dzsa.desktop",
            "x-scheme-handler/dzsa",
        ])
        .status();
    Ok(())
}

/// Remove the Linux `dzsa://` desktop entry.
#[cfg(target_os = "linux")]
pub fn unregister_dzsa_protocol() -> Result<(), ProtocolError> {
    if let Some(home) = std::env::var_os("HOME") {
        let desktop_file = std::path::PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("applications")
            .join("tetra-launcher-dzsa.desktop");
        if desktop_file.exists() {
            std::fs::remove_file(&desktop_file)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_uri() {
        let uri = "dzsa://connect/127.0.0.1:2302";
        let parsed = parse_dzsa_uri(uri).unwrap();
        assert_eq!(parsed.host, "127.0.0.1");
        assert_eq!(parsed.port, 2302);
        assert_eq!(parsed.password, None);
    }

    #[test]
    fn parses_uri_with_password() {
        let uri = "dzsa://connect/192.168.1.1:27016?password=hunter2";
        let parsed = parse_dzsa_uri(uri).unwrap();
        assert_eq!(parsed.host, "192.168.1.1");
        assert_eq!(parsed.port, 27016);
        assert_eq!(parsed.password, Some("hunter2".into()));
    }

    #[test]
    fn rejects_malformed_uri() {
        assert!(parse_dzsa_uri("http://example.com").is_err());
        assert!(parse_dzsa_uri("dzsa://something/127.0.0.1").is_err());
        assert!(parse_dzsa_uri("dzsa://connect/127.0.0.1").is_err());
    }
}
