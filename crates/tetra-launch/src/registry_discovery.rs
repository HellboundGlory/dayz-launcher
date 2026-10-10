use std::path::PathBuf;

/// Paths discovered from Steam — Windows registry, Linux `libraryfolders.vdf`.
pub struct SteamPaths {
    pub steam_install: PathBuf,
    pub dayz_install: PathBuf,
    pub workshop_dir: PathBuf,
}

const DAYZ_APP_ID: &str = "221100";

fn dayz_dir(root: &std::path::Path) -> PathBuf {
    root.join("steamapps").join("common").join("DayZ")
}

fn dayz_manifest(root: &std::path::Path) -> PathBuf {
    root.join("steamapps")
        .join(format!("appmanifest_{DAYZ_APP_ID}.acf"))
}

fn workshop_dir(root: &std::path::Path) -> PathBuf {
    root.join("steamapps")
        .join("workshop")
        .join("content")
        .join(DAYZ_APP_ID)
}

/// Library roots declared in `libraryfolders.vdf`, in file order. Reads both
/// the `"path"  "<dir>"` form and the older `"<n>"  "<dir>"` form.
fn library_paths(vdf: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for line in vdf.lines() {
        let tokens = quoted_tokens(line);
        if tokens.len() != 2 {
            continue;
        }
        let (key, value) = (&tokens[0], &tokens[1]);
        let numbered = key.chars().all(|c| c.is_ascii_digit());
        if key.as_str() == "path" || (numbered && looks_like_path(value)) {
            roots.push(PathBuf::from(value));
        }
    }
    roots
}

fn looks_like_path(value: &str) -> bool {
    value.contains(':') || value.contains('/') || value.contains('\\')
}

/// Split a VDF line into its quoted values, unescaping `\\` and `\"`.
fn quoted_tokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c != '"' {
            continue;
        }
        let mut value = String::new();
        loop {
            match chars.next() {
                Some('\\') => {
                    if let Some(escaped) = chars.next() {
                        value.push(escaped);
                    }
                }
                Some('"') | None => break,
                Some(other) => value.push(other),
            }
        }
        tokens.push(value);
    }
    tokens
}

/// The library root that holds DayZ: the one with DayZ's app manifest, or
/// failing that the one with a `common/DayZ` folder. The Steam root is
/// checked before any declared library.
fn dayz_library(steam_install: &std::path::Path, libraries: &[PathBuf]) -> Option<PathBuf> {
    let roots = || std::iter::once(steam_install).chain(libraries.iter().map(PathBuf::as_path));
    roots()
        .find(|root| dayz_manifest(root).exists())
        .or_else(|| roots().find(|root| dayz_dir(root).exists()))
        .map(std::path::Path::to_path_buf)
}

/// Resolve both paths from the library that holds DayZ; the workshop folder
/// is always under that library, whether or not Steam has created it yet.
fn resolve_paths(steam_install: &std::path::Path, libraries: &[PathBuf]) -> Option<SteamPaths> {
    let library = dayz_library(steam_install, libraries)?;
    Some(SteamPaths {
        steam_install: steam_install.to_path_buf(),
        dayz_install: dayz_dir(&library),
        workshop_dir: workshop_dir(&library),
    })
}

/// Library roots declared beside a Steam root, if `libraryfolders.vdf` exists.
fn declared_libraries(steam_install: &std::path::Path) -> Vec<PathBuf> {
    let vdf = steam_install.join("steamapps").join("libraryfolders.vdf");
    match std::fs::read_to_string(vdf) {
        Ok(text) => library_paths(&text),
        Err(_) => Vec::new(),
    }
}

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

        let libraries = declared_libraries(&steam_install);
        resolve_paths(&steam_install, &libraries)
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
}

/// Discover Steam/DayZ/Workshop paths on Linux (native Steam, under
/// `$XDG_DATA_HOME/Steam`).
#[cfg(target_os = "linux")]
mod imp {
    use super::*;

    pub fn find_steam_paths() -> Option<SteamPaths> {
        let steam_install = steam_root()?;
        let libraries = declared_libraries(&steam_install);
        resolve_paths(&steam_install, &libraries)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A per-test scratch directory that deletes itself on drop.
    struct ScratchDir(PathBuf);

    impl ScratchDir {
        fn new() -> Self {
            static N: AtomicU64 = AtomicU64::new(0);
            let id = N.fetch_add(1, Ordering::Relaxed);
            let dir =
                std::env::temp_dir().join(format!("tetra-steam-paths-{}-{id}", std::process::id()));
            std::fs::create_dir_all(&dir).expect("could not create scratch dir");
            Self(dir)
        }
    }

    impl std::ops::Deref for ScratchDir {
        type Target = Path;

        fn deref(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for ScratchDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn touch(root: &Path, rel: &str) {
        std::fs::create_dir_all(root.join(rel)).expect("could not create fixture dir");
    }

    #[test]
    fn library_paths_parses_declared_roots() {
        let cases: &[(&str, &[&str])] = &[
            (
                "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"/steam\"\n\t}\n}\n",
                &["/steam"],
            ),
            (
                "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"/steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"/games\"\n\t}\n}\n",
                &["/steam", "/games"],
            ),
            (
                "\"1\"\n{\n\t\"path\"\t\t\"/mnt/games/Steam Library\"\n}\n",
                &["/mnt/games/Steam Library"],
            ),
            (
                "\"1\"\n{\n\t\"path\"\t\t\"E:\\\\SteamLibrary\"\n}\n",
                &["E:\\SteamLibrary"],
            ),
            (
                "\"LibraryFolders\"\n{\n\t\"TimeNextStatsReport\"\t\t\"42\"\n\t\"1\"\t\t\"D:\\\\SteamLibrary\"\n}\n",
                &["D:\\SteamLibrary"],
            ),
            (
                "\"libraryfolders\"\n{\n}\n\t\"1\"\t\t\"42\"\n\tsome junk line\n",
                &[],
            ),
        ];
        for (vdf, expected) in cases {
            let want: Vec<PathBuf> = expected.iter().map(PathBuf::from).collect();
            assert_eq!(library_paths(vdf), want, "vdf: {vdf:?}");
        }
    }

    #[test]
    fn the_manifest_decides_which_library_holds_dayz() {
        // A leftover DayZ folder sits in the Steam root, but the install of
        // record (the app manifest) is in an extra library.
        let root = ScratchDir::new();
        touch(&root.join("steam"), "steamapps/common/DayZ");
        touch(&root.join("extra"), "steamapps/common/DayZ");
        touch(&root.join("extra"), "steamapps/appmanifest_221100.acf");
        let paths = resolve_paths(&root.join("steam"), &[root.join("extra")]).unwrap();
        assert_eq!(paths.dayz_install, root.join("extra/steamapps/common/DayZ"));
        assert_eq!(
            paths.workshop_dir,
            root.join("extra/steamapps/workshop/content/221100")
        );
    }

    #[test]
    fn the_workshop_folder_follows_dayz_even_before_it_exists() {
        // Stale workshop content under the Steam root, DayZ installed elsewhere.
        let root = ScratchDir::new();
        touch(&root.join("steam"), "steamapps/workshop/content/221100");
        touch(&root.join("extra"), "steamapps/common/DayZ");
        touch(&root.join("extra"), "steamapps/appmanifest_221100.acf");
        let paths = resolve_paths(&root.join("steam"), &[root.join("extra")]).unwrap();
        assert_eq!(paths.dayz_install, root.join("extra/steamapps/common/DayZ"));
        assert_eq!(
            paths.workshop_dir,
            root.join("extra/steamapps/workshop/content/221100")
        );
    }
}
