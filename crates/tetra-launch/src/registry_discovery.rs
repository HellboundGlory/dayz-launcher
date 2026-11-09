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

/// The library root that holds DayZ: the one with both DayZ's app manifest and
/// its `common/DayZ` folder, or failing that the one with the folder. The Steam
/// root is checked before any declared library.
fn dayz_library(steam_install: &std::path::Path, libraries: &[PathBuf]) -> Option<PathBuf> {
    let roots = || std::iter::once(steam_install).chain(libraries.iter().map(PathBuf::as_path));
    roots()
        .find(|root| dayz_manifest(root).exists() && dayz_dir(root).exists())
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

/// The first root whose libraries hold DayZ. A stale root that Steam still
/// creates but that holds no game must not hide a second install elsewhere.
fn paths_from_first_root(roots: &[PathBuf]) -> Option<SteamPaths> {
    roots
        .iter()
        .find_map(|root| resolve_paths(root, &declared_libraries(root)))
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
        paths_from_first_root(&steam_roots())
    }

    /// The per-user key first: Steam writes it for every install, while the
    /// machine-wide key is absent when only that user has Steam.
    fn steam_roots() -> Vec<PathBuf> {
        let mut roots = Vec::new();

        let from_user = winreg::RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Valve\\Steam")
            .ok()
            .and_then(|key| key.get_value::<String, _>("SteamPath").ok())
            .filter(|dir| !dir.is_empty());
        if let Some(dir) = from_user {
            roots.push(PathBuf::from(dir));
        }

        let from_machine = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
            .ok()
            .and_then(|key| key.get_value::<String, _>("InstallPath").ok());
        if let Some(dir) = from_machine {
            roots.push(PathBuf::from(dir));
        }

        roots
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

/// Discover Steam/DayZ/Workshop paths on Linux. Same native root as before,
/// plus the places a packaged Steam keeps its data.
#[cfg(target_os = "linux")]
mod imp {
    use super::*;

    pub fn find_steam_paths() -> Option<SteamPaths> {
        paths_from_first_root(&existing(linux_steam_roots))
    }

    /// Like [`find_steam_paths`], but only a plain-home install: Proton and
    /// its runtime cannot run from a sandboxed Steam's folders.
    pub fn find_native_steam_paths() -> Option<SteamPaths> {
        paths_from_first_root(&existing(linux_plain_roots))
    }

    /// Locate the native `steam` launcher so the launcher can start Steam.
    pub fn find_steam_exe() -> Option<PathBuf> {
        // Start the same Steam whose games we read. A sandboxed Steam's
        // `steam.sh` cannot run outside its sandbox, so then use `PATH`.
        let plain = existing(linux_plain_roots);
        let candidates = match paths_from_first_root(&existing(linux_steam_roots)) {
            Some(paths) if plain.contains(&paths.steam_install) => vec![paths.steam_install],
            Some(_) => Vec::new(),
            None => plain,
        };
        for root in candidates {
            let sh = root.join("steam.sh");
            if sh.exists() {
                return Some(sh);
            }
        }
        find_in_path("steam")
    }

    /// Which Steam the launcher hands a launch to, given the root that exists
    /// and whatever `steam` binary was found. Flatpak Steam owns everything
    /// under `~/.var/app/com.valvesoftware.Steam`.
    pub fn install_kind(
        home: &std::path::Path,
        first_root: Option<&std::path::Path>,
        steam_exe: Option<&std::path::Path>,
    ) -> Option<SteamInstall> {
        if let Some(root) = first_root {
            let flatpak = home.join(".var/app/com.valvesoftware.Steam");
            // A root can be a link into the Flatpak's data.
            let real = |p: &std::path::Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
            if root.starts_with(&flatpak) || real(root).starts_with(real(&flatpak)) {
                return Some(SteamInstall::Flatpak);
            }
            return Some(SteamInstall::Native(
                steam_exe
                    .map(std::path::Path::to_path_buf)
                    .unwrap_or_else(|| PathBuf::from("steam")),
            ));
        }
        steam_exe.map(|exe| SteamInstall::Native(exe.to_path_buf()))
    }

    /// The Steam install a launch can be handed to, if any.
    pub fn find_steam_install() -> Option<SteamInstall> {
        let home = home_dir()?;
        let root = paths_from_first_root(&existing(linux_steam_roots)).map(|p| p.steam_install);
        install_kind(&home, root.as_deref(), find_steam_exe().as_deref())
    }

    /// Roots of a normal user install, in search order. Only these can run
    /// their `steam.sh` or Proton from outside a sandbox.
    pub(super) fn linux_plain_roots(
        home: &std::path::Path,
        data_home: Option<&std::path::Path>,
    ) -> Vec<PathBuf> {
        let data_home = data_home
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local").join("share"));
        vec![
            data_home.join("Steam"),
            home.join(".steam").join("steam"),
            home.join(".steam").join("debian-installation"),
        ]
    }

    /// Every root a Steam client may keep its data under: the plain ones,
    /// then Flatpak and Snap layouts (unconfirmed on a machine here, kept in
    /// one list so a wrong one is a one-line fix). Duplicates removed.
    pub(super) fn linux_steam_roots(
        home: &std::path::Path,
        data_home: Option<&std::path::Path>,
    ) -> Vec<PathBuf> {
        let mut roots = linux_plain_roots(home, data_home);
        roots.extend([
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
            home.join(".var/app/com.valvesoftware.Steam/.steam/steam"),
            home.join(".var/app/com.valvesoftware.Steam/data/Steam"),
            home.join("snap/steam/common/.local/share/Steam"),
        ]);
        let mut seen = std::collections::HashSet::new();
        roots.retain(|root| seen.insert(root.clone()));
        roots
    }

    /// The roots from `list` that actually exist as a Steam root on this machine.
    fn existing(
        list: fn(&std::path::Path, Option<&std::path::Path>) -> Vec<PathBuf>,
    ) -> Vec<PathBuf> {
        let Some(home) = home_dir() else {
            return Vec::new();
        };
        let data_home = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from);
        list(&home, data_home.as_deref())
            .into_iter()
            .filter(|root| is_steam_root(root))
            .collect()
    }

    fn is_steam_root(root: &std::path::Path) -> bool {
        root.join("steam.sh").exists() || root.join("steamapps").join("libraryfolders.vdf").exists()
    }

    fn home_dir() -> Option<PathBuf> {
        std::env::var_os("HOME").map(PathBuf::from)
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

/// Steam paths Proton can run from: on Linux only a plain-home install.
#[cfg(target_os = "linux")]
pub fn find_native_steam_paths() -> Option<SteamPaths> {
    imp::find_native_steam_paths()
}

/// Discover the Steam, DayZ and workshop directories for this platform.
pub fn find_steam_paths() -> Option<SteamPaths> {
    imp::find_steam_paths()
}

/// Locate the Steam launcher binary so the app can offer to start it.
pub fn find_steam_exe() -> Option<PathBuf> {
    imp::find_steam_exe()
}

/// The Steam a launch can be handed to on Linux: a native install's own
/// launcher, or the Flatpak app when Steam lives in its sandbox.
#[cfg(target_os = "linux")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SteamInstall {
    Native(PathBuf),
    Flatpak,
}

/// The Steam install a launch can be handed to, if any.
#[cfg(target_os = "linux")]
pub fn find_steam_install() -> Option<SteamInstall> {
    imp::find_steam_install()
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
    fn the_manifest_decides_which_library_holds_dayz_and_its_workshop() {
        // A leftover DayZ folder *and* stale workshop content sit in the Steam
        // root, but the install of record (the app manifest) is in an extra library.
        let root = ScratchDir::new();
        touch(&root.join("steam"), "steamapps/common/DayZ");
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

    #[test]
    fn a_manifest_without_the_game_folder_does_not_pick_the_library() {
        let root = ScratchDir::new();
        touch(&root.join("steam"), "steamapps/appmanifest_221100.acf");
        touch(&root.join("extra"), "steamapps/common/DayZ");
        let paths = resolve_paths(&root.join("steam"), &[root.join("extra")]).unwrap();
        assert_eq!(paths.dayz_install, root.join("extra/steamapps/common/DayZ"));
    }

    /// A Steam root that exists but holds no game must not hide another
    /// install, whether that is a packaged Steam's data directory or a second
    /// plain-home root.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_packaged_steam_holding_dayz_is_found_when_the_native_root_is_empty() {
        for holding in [
            ".var/app/com.valvesoftware.Steam/.local/share/Steam",
            ".steam/debian-installation",
        ] {
            let home = ScratchDir::new();
            touch(&home, ".local/share/Steam/steam.sh");
            touch(&home, &format!("{holding}/steamapps/common/DayZ"));
            touch(
                &home,
                &format!("{holding}/steamapps/appmanifest_221100.acf"),
            );

            let roots: Vec<PathBuf> = imp::linux_steam_roots(&home, None)
                .into_iter()
                .filter(|root| root.exists())
                .collect();
            let paths = paths_from_first_root(&roots).expect("no Steam install found");

            assert_eq!(paths.steam_install, home.join(holding), "root: {holding}");
            // Proton only runs from a plain-home Steam, never from a sandboxed one.
            let native: Vec<PathBuf> = imp::linux_plain_roots(&home, None)
                .into_iter()
                .filter(|root| root.exists())
                .collect();
            assert_eq!(
                paths_from_first_root(&native).is_some(),
                holding == ".steam/debian-installation",
                "root: {holding}"
            );
            assert_eq!(
                paths.dayz_install,
                home.join(holding).join("steamapps/common/DayZ"),
                "root: {holding}"
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_install_kind_follows_the_root_steam_keeps_its_data_under() {
        let home = PathBuf::from("/home/u");
        let flatpak_root = home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam");
        let world_of_steam = home.join("World of Steam/Steam");
        let exe = PathBuf::from("/usr/bin/steam");

        let flatpak = imp::install_kind(&home, Some(&flatpak_root), None);
        assert_eq!(flatpak, Some(SteamInstall::Flatpak));

        let native = imp::install_kind(&home, Some(&world_of_steam), Some(&exe));
        assert_eq!(native, Some(SteamInstall::Native(exe.clone())));

        // A root without a `steam.sh` still starts the client through `PATH`.
        let fallback = imp::install_kind(&home, Some(&world_of_steam), None);
        assert_eq!(fallback, Some(SteamInstall::Native(PathBuf::from("steam"))));

        let path_only = imp::install_kind(&home, None, Some(&exe));
        assert_eq!(path_only, Some(SteamInstall::Native(exe)));

        assert_eq!(imp::install_kind(&home, None, None), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_root_linked_into_flatpak_steam_is_flatpak() {
        let home = ScratchDir::new();
        let real = home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam");
        std::fs::create_dir_all(&real).unwrap();
        let link = home.join(".steam/steam");
        std::fs::create_dir_all(link.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();

        assert_eq!(
            imp::install_kind(&home, Some(&link), Some(Path::new("/usr/bin/steam"))),
            Some(SteamInstall::Flatpak)
        );
    }
}
