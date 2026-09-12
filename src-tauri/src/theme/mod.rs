//! File-backed theme storage: one directory per theme under
//! [`crate::paths::themes_dir`], holding a [`manifest::ThemeManifest`] in
//! `theme.json` and the palette in `tokens.json`.
//!
//! Everything here takes a plain `&Path` root rather than an `AppHandle`, so
//! the storage rules are testable against a scratch directory and the commands
//! layer owns path resolution and logging. Deliberately no archive handling
//! and no knowledge of what a token means — `tokens.json` is an opaque
//! [`serde_json::Value`] past its structure, and the palette semantics live in
//! the frontend.
//!
//! Read errors are never fatal, matching `settings.rs`'s posture: an
//! unreadable theme is one entry missing from the grid, not a failed launch.

pub mod manifest;

use std::path::{Path, PathBuf};

pub use manifest::ThemeManifest;
use serde_json::Value;

/// The manifest file's name, in one place because `save` and `scan` both need it.
pub const MANIFEST_FILE: &str = "theme.json";

/// The palette file's name, alongside the manifest.
pub const TOKENS_FILE: &str = "tokens.json";

/// A theme as the grid lists it: the manifest fields a card or a compatibility
/// check can use, without reading `tokens.json` for every install. `license`,
/// `homepage` and `schemaVersion` stay in the full manifest — [`get`] returns those.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSummary {
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    /// The token API `tokens.json` is written against.
    pub theme_api: String,
    /// The oldest launcher that can load this theme, for the frontend's gate.
    pub minimum_launcher_version: String,
    pub tier: String,
    pub description: String,
    pub preview: Option<String>,
    pub tags: Vec<String>,
    pub capabilities: Vec<String>,
}

impl ThemeSummary {
    fn of(manifest: &ThemeManifest) -> Self {
        Self {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            author: manifest.author.clone(),
            version: manifest.version.clone(),
            theme_api: manifest.theme_api.clone(),
            minimum_launcher_version: manifest.minimum_launcher_version.clone(),
            tier: manifest.tier.clone(),
            description: manifest.description.clone(),
            preview: manifest.preview.clone(),
            tags: manifest.tags.clone(),
            capabilities: manifest.capabilities.clone(),
        }
    }
}

/// One theme, fully: its manifest and its `tokens.json` verbatim. The manifest
/// is flattened into the same object rather than nested, so this reads as a
/// manifest that happens to carry a `tokens` key.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ThemeFile {
    #[serde(flatten)]
    pub manifest: ThemeManifest,
    pub tokens: serde_json::Value,
}

/// What a scan of the themes directory found: the themes it can list, and one
/// message per directory it had to skip (for the caller to log).
#[derive(Debug, Default)]
pub struct Scan {
    pub themes: Vec<ThemeSummary>,
    pub skipped: Vec<String>,
}

/// What a legacy migration did. `migrated` is ids that now exist on disk —
/// only those, so a caller remapping its selection can't be pointed at a
/// theme that was never written.
#[derive(Debug, Default)]
pub struct Migration {
    pub migrated: Vec<String>,
    pub skipped: Vec<String>,
}

/// A custom theme as the frontend's `localStorage` held it, before themes were
/// files. Mirrors the frontend's `SavedTheme`; only read, never written.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LegacyTheme {
    pub name: String,
    pub dark: serde_json::Value,
    pub light: serde_json::Value,
    pub bloom: Option<f64>,
    pub scheme: Option<String>,
}

/// Whether `id` can be one directory name under the themes root.
///
/// The manifest's `id` is author-controlled, and it becomes a path component —
/// so `../../evil` must never be joined onto the themes directory — and the
/// same layout travels from Windows to Linux, so the characters a Windows file
/// name refuses are refused everywhere.
pub fn is_usable_id(id: &str) -> bool {
    !id.trim().is_empty()
        && id != "."
        && id != ".."
        && !id.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
}

/// `themes_root/<id>`, or an error if `id` could not name a directory there.
fn theme_dir(themes_root: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_usable_id(id) {
        return Err(format!(
            "`{id}` is not a usable theme id — it must be a single directory name"
        ));
    }
    Ok(themes_root.join(id))
}

/// A palette must be a JSON object carrying a `schemaVersion`; nothing else
/// about it is the backend's business.
pub fn validate_tokens(tokens: &Value) -> Result<(), String> {
    let Some(object) = tokens.as_object() else {
        return Err("tokens.json must be a JSON object".to_string());
    };
    if !object.contains_key("schemaVersion") {
        return Err("tokens.json has no `schemaVersion`".to_string());
    }
    Ok(())
}

/// Read `theme.json` from one theme's directory.
fn read_manifest(dir: &Path) -> Result<ThemeManifest, String> {
    let path = dir.join(MANIFEST_FILE);
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("{} is not a valid manifest: {e}", path.display()))
}

/// One theme's manifest and raw tokens.
pub fn get(themes_root: &Path, id: &str) -> Result<ThemeFile, String> {
    let dir = theme_dir(themes_root, id)?;
    if !dir.is_dir() {
        return Err(format!("No installed theme `{id}` at {}", dir.display()));
    }

    let manifest = read_manifest(&dir)?;
    // The directory name is the theme's identity — `save` derives one from the
    // other — so a manifest whose `id` disagrees would be addressable under two
    // names. Treat it as a broken install rather than guessing which wins.
    if manifest.id != id {
        return Err(format!(
            "{} declares id `{}`, which does not match its directory",
            dir.join(MANIFEST_FILE).display(),
            manifest.id
        ));
    }

    let tokens_path = dir.join(TOKENS_FILE);
    let raw = std::fs::read_to_string(&tokens_path)
        .map_err(|e| format!("Could not read {}: {e}", tokens_path.display()))?;
    let tokens: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("{} is not valid JSON: {e}", tokens_path.display()))?;
    validate_tokens(&tokens)?;

    Ok(ThemeFile { manifest, tokens })
}

/// Every theme under `themes_root`, sorted by id so the grid's order is stable
/// across runs. A directory with a missing, unreadable, corrupt or
/// self-contradicting manifest is reported in [`Scan::skipped`] and left out.
pub fn scan(themes_root: &Path) -> Scan {
    let mut scan = Scan::default();
    let Ok(entries) = std::fs::read_dir(themes_root) else {
        // No themes directory at all is the ordinary first-run case.
        return scan;
    };

    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let dir = entry.path();
        let dir_name = entry.file_name().to_string_lossy().into_owned();
        match read_manifest(&dir) {
            Ok(manifest) if manifest.id == dir_name => {
                scan.themes.push(ThemeSummary::of(&manifest));
            }
            Ok(manifest) => scan.skipped.push(format!(
                "{} declares id `{}`, which does not match its directory; skipping",
                dir.display(),
                manifest.id
            )),
            Err(e) => scan.skipped.push(format!("Skipping theme directory: {e}")),
        }
    }

    scan.themes.sort_by(|a, b| a.id.cmp(&b.id));
    scan
}

/// Install a new theme as `themes_root/<manifest.id>`. Create-only: an
/// existing directory is an error, never an update. Returns the id written.
pub fn save(
    themes_root: &Path,
    manifest: &ThemeManifest,
    tokens: &Value,
) -> Result<String, String> {
    let dir = theme_dir(themes_root, &manifest.id)?;
    validate_tokens(tokens)?;

    // Serialised before anything is created, so a manifest that can't be
    // written never leaves a directory behind.
    let manifest_json = serde_json::to_vec_pretty(manifest)
        .map_err(|e| format!("Could not serialise the manifest: {e}"))?;
    let tokens_json = serde_json::to_vec_pretty(tokens)
        .map_err(|e| format!("Could not serialise tokens: {e}"))?;

    std::fs::create_dir_all(themes_root)
        .map_err(|e| format!("Could not create {}: {e}", themes_root.display()))?;
    // `create_dir`, not `create_dir_all`: an existing theme must fail here
    // rather than be silently merged into.
    std::fs::create_dir(&dir).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!(
            "A theme with id `{}` is already installed at {}",
            manifest.id,
            dir.display()
        ),
        _ => format!("Could not create {}: {e}", dir.display()),
    })?;

    // A theme is its two files; a half-written directory would show up in the
    // grid as a theme that can't be loaded, so it is removed rather than kept.
    for (name, bytes) in [(MANIFEST_FILE, &manifest_json), (TOKENS_FILE, &tokens_json)] {
        let path = dir.join(name);
        if let Err(e) = crate::atomic_write::write_atomically(&path, bytes) {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(format!("Could not write {}: {e}", path.display()));
        }
    }

    Ok(manifest.id.clone())
}

/// Delete an installed theme. An id with no directory is refused rather than
/// ignored — a built-in preset has nothing to delete, and this command is not
/// the way to try. That check comes first: "switch away from it" is misleading
/// advice for an id that was never installed. `active` is the currently
/// selected theme id, which must be switched away from first — deleting it
/// would leave the selection pointing at nothing.
pub fn delete(themes_root: &Path, id: &str, active: Option<&str>) -> Result<(), String> {
    let dir = theme_dir(themes_root, id)?;
    if !dir.is_dir() {
        return Err(format!(
            "No installed theme `{id}` at {} — built-in themes have no directory to delete",
            dir.display()
        ));
    }
    if active == Some(id) {
        return Err(format!(
            "`{id}` is the active theme; switch to another theme before deleting it"
        ));
    }

    std::fs::remove_dir_all(&dir).map_err(|e| format!("Could not delete {}: {e}", dir.display()))
}

/// Lowercase, with every run of non-alphanumeric characters collapsed to a
/// single `-` and the ends trimmed. `"Blaze Orange!"` -> `"blaze-orange"`.
pub fn slugify(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    for c in name.chars() {
        if c.is_alphanumeric() {
            slug.extend(c.to_lowercase());
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.trim_matches('-').to_string()
}

/// Bring themes saved in the frontend's `localStorage` into file-backed
/// storage, one directory each. One-shot and best-effort: an entry that can't
/// be written is reported and the rest still migrate.
pub fn migrate(themes_root: &Path, legacy: &[LegacyTheme]) -> Migration {
    let mut migration = Migration::default();
    for theme in legacy {
        let fallback = || format!("{:?}", theme.name);
        // A palette the frontend saved is a pair of token maps. Anything else
        // is a partial or corrupt entry, and writing it would install a theme
        // that cannot load.
        if !theme.dark.is_object() || !theme.light.is_object() {
            migration.skipped.push(format!(
                "{}: dark/light are not token objects; not migrated",
                fallback()
            ));
            continue;
        }

        let id = format!("local.{}", slugify(&theme.name));
        // Exactly the documented shape — `bloom` and `scheme` are the
        // frontend's to interpret, and inventing extra token keys here would
        // be guessing at a contract this backend deliberately doesn't own.
        let tokens = serde_json::json!({
            "schemaVersion": manifest::SCHEMA_VERSION,
            "dark": theme.dark,
            "light": theme.light,
        });

        let manifest = ThemeManifest {
            id: id.clone(),
            name: theme.name.clone(),
            author: "local".to_string(),
            version: "1.0.0".to_string(),
            theme_api: manifest::SCHEMA_VERSION.to_string(),
            // This build wrote it, so this build is the floor it can rely on.
            minimum_launcher_version: env!("CARGO_PKG_VERSION").to_string(),
            tier: "basic".to_string(),
            description: "Migrated from a saved custom theme.".to_string(),
            capabilities: vec!["tokens".to_string()],
            ..ThemeManifest::default()
        };

        match save(themes_root, &manifest, &tokens) {
            Ok(id) => migration.migrated.push(id),
            Err(e) => migration.skipped.push(format!("{}: {e}", fallback())),
        }
    }
    migration
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch directory unique to one test, the way `paths.rs` does it (no
    /// `tempfile` dependency) — never the real data root.
    fn scratch(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tetra-theme-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).expect("could not create scratch dir");
        dir
    }

    fn manifest(id: &str) -> ThemeManifest {
        ThemeManifest {
            id: id.to_string(),
            name: "Test Theme".to_string(),
            author: "tester".to_string(),
            version: "2.1.0".to_string(),
            theme_api: "1".to_string(),
            minimum_launcher_version: "2.6.0".to_string(),
            tier: "full".to_string(),
            description: "A theme for a test.".to_string(),
            capabilities: vec!["tokens".to_string()],
            ..ThemeManifest::default()
        }
    }

    fn tokens() -> Value {
        serde_json::json!({ "schemaVersion": 1, "dark": { "bg": "#0d0f13" }, "light": {} })
    }

    #[test]
    fn a_saved_theme_reads_back_exactly_as_written() {
        let root = scratch("roundtrip");
        let written_tokens = tokens();

        let id = save(&root, &manifest("dev.roundtrip"), &written_tokens).expect("save");
        let loaded = get(&root, "dev.roundtrip").expect("get");

        assert_eq!(id, "dev.roundtrip");
        assert_eq!(loaded.manifest.id, "dev.roundtrip");
        assert_eq!(loaded.manifest.name, "Test Theme");
        assert_eq!(loaded.manifest.version, "2.1.0");
        assert_eq!(loaded.manifest.capabilities, vec!["tokens".to_string()]);
        assert_eq!(loaded.tokens, written_tokens, "tokens round-trip verbatim");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Create-only: an existing id must be refused, not merged into or overwritten.
    #[test]
    fn saving_over_an_installed_id_is_refused() {
        let root = scratch("exists");
        save(&root, &manifest("dev.taken"), &tokens()).expect("first save");

        let err = save(&root, &manifest("dev.taken"), &tokens()).expect_err("second save");

        assert!(err.contains("already installed"), "{err}");
        assert_eq!(
            get(&root, "dev.taken").expect("still there").manifest.name,
            "Test Theme"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The id becomes a path component, so it can never climb out of the
    /// themes directory.
    #[test]
    fn an_id_that_is_a_path_is_refused() {
        let root = scratch("escape");
        let escaped = manifest("../../escaped");

        let err = save(&root, &escaped, &tokens()).expect_err("must refuse");
        assert!(err.contains("not a usable theme id"), "{err}");
        assert!(
            !root.join("..").join("escaped").exists(),
            "nothing outside the themes root may be created"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn deleting_the_active_theme_is_refused() {
        let root = scratch("active");
        save(&root, &manifest("dev.active"), &tokens()).expect("save");

        let err = delete(&root, "dev.active", Some("dev.active")).expect_err("must refuse");

        assert!(err.contains("active theme"), "{err}");
        assert!(
            get(&root, "dev.active").is_ok(),
            "the installed theme must survive the refusal"
        );
        // ...and goes once the selection has moved away.
        delete(&root, "dev.active", Some("neutral")).expect("delete after switching");
        assert!(get(&root, "dev.active").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn deleting_an_id_with_no_directory_is_refused() {
        let root = scratch("absent");

        // `neutral` is a built-in preset: no directory, nothing to delete.
        let err = delete(&root, "neutral", Some("neutral")).expect_err("must refuse");
        assert!(err.contains("No installed theme"), "{err}");
        // And an active-id refusal is not what catches it: the directory is missing.
        let err = delete(&root, "neutral", None).expect_err("must refuse");
        assert!(err.contains("No installed theme"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A corrupt install must cost its own card, not the whole grid.
    #[test]
    fn a_corrupt_manifest_is_skipped_rather_than_fatal() {
        let root = scratch("corrupt");
        save(&root, &manifest("dev.good"), &tokens()).expect("save");
        let broken = root.join("dev.broken");
        std::fs::create_dir_all(&broken).unwrap();
        std::fs::write(broken.join(MANIFEST_FILE), "{ not json").unwrap();

        let scan = scan(&root);

        assert_eq!(scan.themes.len(), 1);
        assert_eq!(scan.themes[0].id, "dev.good");
        assert_eq!(scan.skipped.len(), 1, "{:?}", scan.skipped);
        assert!(scan.skipped[0].contains("dev.broken"), "{:?}", scan.skipped);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_themes_directory_scans_as_empty() {
        let root = scratch("none").join("absent");

        let scan = scan(&root);

        assert!(scan.themes.is_empty());
        assert!(scan.skipped.is_empty(), "a first run is not a problem");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn legacy_themes_migrate_one_directory_each_with_a_slugified_id() {
        let root = scratch("migrate");
        let legacy = vec![
            LegacyTheme {
                name: "My Cool Theme!".to_string(),
                dark: serde_json::json!({ "bg": "#111111" }),
                light: serde_json::json!({ "bg": "#eeeeee" }),
                bloom: Some(0.9),
                scheme: Some("slate".to_string()),
            },
            LegacyTheme {
                name: "  Second   One  ".to_string(),
                dark: serde_json::json!({ "bg": "#222222" }),
                light: serde_json::json!({}),
                bloom: None,
                scheme: None,
            },
        ];

        let migration = migrate(&root, &legacy);

        assert_eq!(
            migration.migrated,
            vec!["local.my-cool-theme", "local.second-one"]
        );
        assert!(migration.skipped.is_empty(), "{:?}", migration.skipped);
        for (id, bg) in [
            ("local.my-cool-theme", "#111111"),
            ("local.second-one", "#222222"),
        ] {
            let loaded = get(&root, id).expect("migrated theme should load");
            assert_eq!(loaded.manifest.tier, "basic");
            assert_eq!(loaded.manifest.capabilities, vec!["tokens".to_string()]);
            assert_eq!(loaded.tokens["dark"]["bg"], bg);
            assert!(loaded.tokens["light"].is_object());
        }
        // The authored pair arrives intact under the documented keys.
        let first = get(&root, "local.my-cool-theme").expect("load");
        assert_eq!(first.tokens["dark"]["bg"], "#111111");
        assert_eq!(first.tokens["light"]["bg"], "#eeeeee");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A partial/corrupt `localStorage` entry must not become a broken install.
    #[test]
    fn a_legacy_entry_without_palettes_is_reported_and_skipped() {
        let root = scratch("migrate-bad");
        let legacy = vec![LegacyTheme {
            name: "Half Saved".to_string(),
            dark: Value::Null,
            light: serde_json::json!({}),
            bloom: None,
            scheme: None,
        }];

        let migration = migrate(&root, &legacy);

        assert!(migration.migrated.is_empty());
        assert_eq!(migration.skipped.len(), 1, "{:?}", migration.skipped);
        assert!(
            migration.skipped[0].contains("Half Saved"),
            "{:?}",
            migration.skipped
        );
        assert!(!root.join("local.half-saved").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn slugs_collapse_runs_and_trim_the_ends() {
        assert_eq!(slugify("Blaze Orange"), "blaze-orange");
        assert_eq!(slugify("  --My__Theme!!  "), "my-theme");
        assert_eq!(slugify("Already-slugged"), "already-slugged");
        assert_eq!(slugify("!!!"), "");
    }

    #[test]
    fn tokens_must_be_an_object_carrying_a_schema_version() {
        assert!(validate_tokens(&serde_json::json!({ "schemaVersion": 1 })).is_ok());
        assert!(validate_tokens(&serde_json::json!({ "dark": {} })).is_err());
        assert!(validate_tokens(&serde_json::json!([1, 2])).is_err());
    }
}
