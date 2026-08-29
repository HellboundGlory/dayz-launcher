use std::path::PathBuf;

/// Paths discovered from Steam.
///
/// On Windows these come from the registry (`HKLM\...\Valve\Steam`); on Linux
/// they come from Steam's own files under `~/.local/share/Steam`, mainly the
/// `steamapps/libraryfolders.vdf` manifest. The two backends live in `imp`.
pub struct SteamPaths {
    pub steam_install: PathBuf,
    pub dayz_install: PathBuf,
    pub workshop_dir: PathBuf,
}

/// Query the Windows registry for Steam installation paths.
///
/// Looks in `HKLM\SOFTWARE\WOW6432Node\Valve\Steam` for the Steam
/// install directory, then derives the DayZ and workshop paths from it.
#[cfg(windows)]
mod imp {
    use super::*;
    use winreg::enums::*;

    pub fn find_steam_paths() -> Option<SteamPaths> {
        let hklm = winreg::RegKey::predef(HKEY_LOCAL_MACHINE);
        let steam_key = hklm
            .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
            .ok()?;

        let steam_install: String = steam_key.get_value("InstallPath").ok()?;
        let steam_install = PathBuf::from(steam_install);

        // The library that actually holds DayZ — not necessarily
        // `steam_install` itself, since DayZ can live on a second drive.
        // Workshop content for an app lives in the *same* library as the app
        // (M10, 2026-08-29 audit): `workshop_dir` used to be computed
        // unconditionally under `steam_install`, so an install on a
        // secondary library reported a workshop path that doesn't exist —
        // the Linux implementation already searches every library for this
        // reason; only Windows had the gap.
        let dayz_library = find_dayz_library(&steam_install)?;
        let dayz_install = dayz_library.join("steamapps").join("common").join("DayZ");
        let workshop_dir = dayz_library
            .join("steamapps")
            .join("workshop")
            .join("content")
            .join("221100");

        Some(SteamPaths {
            steam_install,
            dayz_install,
            workshop_dir,
        })
    }

    /// Locate `steam.exe` so the launcher can offer to start Steam for the user.
    pub fn find_steam_exe() -> Option<PathBuf> {
        let from_user = winreg::RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Valve\\Steam")
            .ok()
            .and_then(|key| key.get_value::<String, _>("SteamExe").ok())
            .map(PathBuf::from)
            .filter(|path| path.exists());

        from_user.or_else(|| {
            winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
                .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
                .ok()
                .and_then(|key| key.get_value::<String, _>("InstallPath").ok())
                .map(|dir| PathBuf::from(dir).join("steam.exe"))
                .filter(|path| path.exists())
        })
    }

    /// The Steam library *root* that contains DayZ — either the main Steam
    /// install or one declared in `libraryfolders.vdf`.
    ///
    /// Returns the root itself, not `<root>/steamapps/common/DayZ` — that's
    /// what lets `find_steam_paths` derive `workshop_dir` from the same
    /// library `dayz_install` came from, instead of assuming it's always
    /// under `steam_dir`.
    fn find_dayz_library(steam_dir: &std::path::Path) -> Option<PathBuf> {
        // Default Steam library location
        let default_dayz = steam_dir.join("steamapps").join("common").join("DayZ");
        if default_dayz.exists() {
            return Some(steam_dir.to_path_buf());
        }

        // Check LibraryFolders for alternate install locations
        let library_folders = steam_dir.join("steamapps").join("libraryfolders.vdf");

        if let Ok(contents) = std::fs::read_to_string(&library_folders) {
            for line in contents.lines() {
                // Parse lines like: "1"		"E:\\SteamLibrary"
                if let Some(path_str) = line.split('"').nth(3) {
                    if path_str.contains(':') {
                        let root = PathBuf::from(path_str);
                        let candidate = root.join("steamapps").join("common").join("DayZ");
                        if candidate.exists() {
                            return Some(root);
                        }
                    }
                }
            }
        }

        None
    }
}

/// Discover Steam/DaYZ/Workshop paths on Linux (native Steam).
///
/// Native Steam keeps its files under `$XDG_DATA_HOME/Steam` (default
/// `~/.local/share/Steam`). DayZ and workshop content can live in the root
/// library or any library listed in `steamapps/libraryfolders.vdf`; all of them
/// are candidates.
#[cfg(target_os = "linux")]
mod imp {
    use super::*;

    pub fn find_steam_paths() -> Option<SteamPaths> {
        let steam_install = steam_root()?;

        // Every candidate library root: the Steam root itself plus any extra
        // libraries declared in libraryfolders.vdf.
        let mut roots = vec![steam_install.clone()];
        roots.extend(library_paths(&steam_install));

        let dayz_install = roots
            .iter()
            .map(|r| r.join("steamapps").join("common").join("DayZ"))
            .find(|d| d.exists())?;

        let workshop_dir = roots
            .iter()
            .map(|r| {
                r.join("steamapps")
                    .join("workshop")
                    .join("content")
                    .join("221100")
            })
            .find(|w| w.is_dir());

        Some(SteamPaths {
            steam_install: steam_install.clone(),
            dayz_install,
            workshop_dir: workshop_dir.unwrap_or_else(|| {
                steam_install
                    .join("steamapps")
                    .join("workshop")
                    .join("content")
                    .join("221100")
            }),
        })
    }

    /// Locate the native `steam` launcher so the launcher can start Steam.
    pub fn find_steam_exe() -> Option<PathBuf> {
        if let Some(root) = steam_root() {
            let sh = root.join("steam.sh");
            if sh.exists() {
                return Some(sh);
            }
        }
        find_in_path("steam")
    }

    /// Resolve the native Steam root from the filesystem.
    fn steam_root() -> Option<PathBuf> {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::var_os("HOME")
                    .map(|h| PathBuf::from(h).join(".local").join("share"))
                    .unwrap_or_default()
            });
        let native = base.join("Steam");
        if native.join("steam.sh").exists()
            || native.join("steamapps").join("libraryfolders.vdf").exists()
        {
            return Some(native);
        }
        None
    }

    /// Collect library roots declared in `libraryfolders.vdf`.
    fn library_paths(root: &std::path::Path) -> Vec<PathBuf> {
        let vdf = root.join("steamapps").join("libraryfolders.vdf");
        let mut out = Vec::new();
        let Ok(text) = std::fs::read_to_string(&vdf) else {
            return out;
        };
        for line in text.lines() {
            // Pull every `"quoted"` token. A line whose first token is "path"
            // carries the library path as its second token, e.g.:
            //   "1"  {  "path"  "/mnt/games"  }
            let mut tokens: Vec<String> = Vec::new();
            let mut rest = line;
            while let Some(q) = rest.find('"') {
                rest = &rest[q + 1..];
                match rest.find('"') {
                    Some(e) => tokens.push(rest[..e].to_string()),
                    None => break,
                }
                rest = &rest[rest.find('"').unwrap() + 1..];
            }
            if tokens.first().map(|t| t == "path").unwrap_or(false) {
                if let Some(v) = tokens.get(1) {
                    out.push(PathBuf::from(v));
                }
            }
        }
        out
    }

    fn find_in_path(name: &str) -> Option<PathBuf> {
        let path = std::env::var_os("PATH")?;
        for dir in std::env::split_paths(&path) {
            let cand = dir.join(name);
            if cand.exists() {
                return Some(cand);
            }
        }
        None
    }
}

/// Discover the Steam, DayZ and workshop directories for this platform.
pub fn find_steam_paths() -> Option<SteamPaths> {
    imp::find_steam_paths()
}

/// Locate the Steam launcher binary so the app can offer to start it.
pub fn find_steam_exe() -> Option<PathBuf> {
    imp::find_steam_exe()
}
