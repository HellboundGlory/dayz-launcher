use std::path::PathBuf;
use winreg::enums::*;

/// Paths discovered from the Windows registry.
pub struct SteamPaths {
    pub steam_install: PathBuf,
    pub dayz_install: PathBuf,
    pub workshop_dir: PathBuf,
}

/// Query the Windows registry for Steam installation paths.
///
/// Looks in `HKLM\SOFTWARE\WOW6432Node\Valve\Steam` for the Steam
/// install directory, then derives the DayZ and workshop paths from it.
pub fn find_steam_paths() -> Option<SteamPaths> {
    let hklm = winreg::RegKey::predef(HKEY_LOCAL_MACHINE);
    let steam_key = hklm
        .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
        .ok()?;

    let steam_install: String = steam_key.get_value("InstallPath").ok()?;
    let steam_install = PathBuf::from(steam_install);

    let workshop_dir = steam_install
        .join("steamapps")
        .join("workshop")
        .join("content")
        .join("221100");

    // DayZ install path: check common locations
    let dayz_install = find_dayz_install(&steam_install)?;

    Some(SteamPaths {
        steam_install,
        dayz_install,
        workshop_dir,
    })
}

/// Locate `steam.exe` so the launcher can offer to start Steam for the user.
///
/// Deliberately not derived from [`find_steam_paths`]: that returns `None` when
/// DayZ itself cannot be found, and the startup "Steam isn't running" prompt has
/// to work for someone whose DayZ folder is missing or on an unmounted drive —
/// those are exactly the people who need Steam running to fix it.
///
/// `SteamExe` is per-user and holds the full path (with forward slashes, which
/// Windows accepts); the machine-wide `InstallPath` is the fallback for a
/// profile that has never launched Steam.
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

fn find_dayz_install(steam_dir: &std::path::Path) -> Option<PathBuf> {
    // Default Steam library location
    let default = steam_dir
        .join("steamapps")
        .join("common")
        .join("DayZ");

    if default.exists() {
        return Some(default);
    }

    // Check LibraryFolders for alternate install locations
    let library_folders = steam_dir
        .join("steamapps")
        .join("libraryfolders.vdf");

    if let Ok(contents) = std::fs::read_to_string(&library_folders) {
        for line in contents.lines() {
            // Parse lines like: "1"		"E:\\SteamLibrary"
            if let Some(path_str) = line.split('"').nth(3) {
                if path_str.contains(':') {
                    let path = PathBuf::from(path_str).join("steamapps").join("common").join("DayZ");
                    if path.exists() {
                        return Some(path);
                    }
                }
            }
        }
    }

    None
}