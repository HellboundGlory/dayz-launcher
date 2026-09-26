//! File-backed theme storage: one directory per theme under
//! [`crate::paths::themes_dir`], holding a [`manifest::ThemeManifest`] in
//! `theme.json`, the palette in `tokens.json`, and the v2 content files a
//! theme ships — `styles.css`, `settings.schema.json` and `layout/`.
//! Takes a plain `&Path` root (not an `AppHandle`) so it's testable against a
//! scratch directory. A read error is never fatal — an unreadable theme is just
//! missing from the grid.

pub mod archive;
pub mod css;
pub mod manifest;
pub mod protocol;
pub mod registry;
pub mod settings_values;
pub mod tokens;
pub mod validator;
pub mod watch;

use std::path::{Path, PathBuf};

pub use manifest::{ThemeManifest, ThemePreview};
use serde_json::Value;

/// The manifest file's name, in one place because `save` and `scan` both need it.
pub const MANIFEST_FILE: &str = "theme.json";

/// The palette file's name, alongside the manifest.
pub const TOKENS_FILE: &str = "tokens.json";

/// The optional advanced-tier stylesheet's name — the one path
/// `src/theme/css-loader.ts` fetches, so it is gated by exactly this name.
pub const STYLES_FILE: &str = "styles.css";

/// The optional expert-tier settings-schema file's name.
pub const SETTINGS_SCHEMA_FILE: &str = "settings.schema.json";

/// A theme as the grid lists it, without reading `tokens.json` for every
/// install. `license`/`homepage`/`schemaVersion` stay in the full manifest — [`get`] returns those.
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
    pub incompatible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incompatible_reason: Option<String>,
    pub previews: Vec<ThemePreview>,
}

impl ThemeSummary {
    fn of(manifest: &ThemeManifest) -> Self {
        let incompatible = manifest.schema_version == 1 || manifest.theme_api.starts_with("1.");
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
            incompatible,
            incompatible_reason: incompatible
                .then(|| "Incompatible — older theme format".to_string()),
            previews: manifest.previews.clone(),
        }
    }
}

/// Every path the v2 `layout/` allowlist admits.
pub const LAYOUT_ALLOWLIST: &[&str] = &[
    "layout/shell.json",
    "layout/settings.json",
    "layout/views/browser.json",
    "layout/views/mods.json",
    "layout/modals/serverInfo.json",
    "layout/modals/modFilter.json",
    "layout/modals/update.json",
    "layout/lists/servers.json",
    "layout/lists/mods.json",
    "layout/lists/modFilterResults.json",
    "layout/lists/serverMods.json",
    "layout/lists/modServers.json",
    "layout/popups/mapFilter.json",
    "layout/popups/modsUnique.json",
    "layout/popups/regionFilter.json",
    "layout/popups/sort.json",
    "layout/popups/tagsFilter.json",
    "layout/popups/serverActions.json",
    "layout/popups/serverLoad.json",
    "layout/popups/modActions.json",
    "layout/popups/settingsNav.json",
];

/// One theme, fully: its manifest flattened with its raw optional content —
/// `tokens.json` and whatever else the theme ships.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ThemeFile {
    #[serde(flatten)]
    pub manifest: ThemeManifest,
    pub tokens: serde_json::Value,
    /// `rename` because `ThemeFile` has no struct-level `rename_all`.
    #[serde(rename = "settingsSchema")]
    pub settings_schema: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub layouts: std::collections::BTreeMap<String, serde_json::Value>,
}

/// A scan's result: themes found, and one skip message per directory that failed.
#[derive(Debug, Default)]
pub struct Scan {
    pub themes: Vec<ThemeSummary>,
    pub skipped: Vec<String>,
}

/// `migrated` is ids that now exist on disk — a caller remapping its
/// selection can't be pointed at a theme that failed to write.
#[derive(Debug, Default)]
pub struct Migration {
    pub migrated: Vec<String>,
    pub skipped: Vec<String>,
}

/// A custom theme as the frontend's `localStorage` held it, before themes were
/// files. Mirrors the frontend's `SavedTheme`; read-only.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LegacyTheme {
    pub name: String,
    pub dark: serde_json::Value,
    pub light: serde_json::Value,
    pub bloom: Option<f64>,
    pub scheme: Option<String>,
}

/// Whether `id` can be one directory name under the themes root — author
/// controlled and becomes a path component, so `../../evil` must be refused,
/// and Windows-illegal characters are refused everywhere for one shared layout.
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

/// v1 keeps its envelope check until the package-format cutover.
pub fn validate_tokens(tokens: &Value) -> Result<(), String> {
    let Some(object) = tokens.as_object() else {
        return Err("tokens.json must be a JSON object".to_string());
    };
    if !object.contains_key("schemaVersion") {
        return Err("tokens.json has no `schemaVersion`".to_string());
    }
    if object.get("schemaVersion").and_then(Value::as_u64) == Some(2) {
        serde_json::from_value::<tokens::TokensV2>(tokens.clone())
            .map_err(|error| format!("Invalid tokens.json: {error}"))?;
    }
    Ok(())
}

/// A settings schema must be a JSON object carrying a `schemaVersion`, exactly
/// as a palette must; the field list is the frontend's business.
pub fn validate_settings_schema(schema: &Value) -> Result<(), String> {
    let Some(object) = schema.as_object() else {
        return Err("settings.schema.json must be a JSON object".to_string());
    };
    if !object.contains_key("schemaVersion") {
        return Err("settings.schema.json has no `schemaVersion`".to_string());
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

/// Read one optional JSON file from a theme directory, enforcing `validate`
/// when it is present. Absent is `Ok(None)`; a present-but-broken file fails
/// the whole read, exactly as a corrupt `tokens.json` does.
fn read_optional_json(
    dir: &Path,
    name: &str,
    validate: fn(&Value) -> Result<(), String>,
) -> Result<Option<Value>, String> {
    let path = dir.join(name);
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?;
    validate(&value)?;
    Ok(Some(value))
}
/// Reads every layout file a theme ships from [`LAYOUT_ALLOWLIST`].
fn read_layouts(dir: &Path) -> Result<std::collections::BTreeMap<String, Value>, String> {
    let mut layouts = std::collections::BTreeMap::new();
    for rel_path in LAYOUT_ALLOWLIST {
        let file = dir.join(rel_path);
        if !file.is_file() {
            continue;
        }
        let raw = std::fs::read_to_string(&file)
            .map_err(|e| format!("Could not read {}: {e}", file.display()))?;
        let value: Value = serde_json::from_str(&raw)
            .map_err(|e| format!("{} is not valid JSON: {e}", file.display()))?;
        layouts.insert((*rel_path).to_string(), value);
    }
    Ok(layouts)
}

/// One theme's manifest, tokens, and whichever optional content files it ships.
pub fn get(themes_root: &Path, id: &str) -> Result<ThemeFile, String> {
    let dir = theme_dir(themes_root, id)?;
    if !dir.is_dir() {
        return Err(format!("No installed theme `{id}` at {}", dir.display()));
    }

    let manifest = read_manifest(&dir)?;
    // The directory name is the theme's identity; a disagreeing manifest.id is a broken install.
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

    let settings_schema = read_optional_json(&dir, SETTINGS_SCHEMA_FILE, validate_settings_schema)?;
    let layouts = read_layouts(&dir)?;

    Ok(ThemeFile {
        manifest,
        tokens,
        settings_schema,
        layouts,
    })
}

/// Every theme under `themes_root`, sorted by id. A directory with a missing,
/// unreadable, or self-contradicting manifest is reported in [`Scan::skipped`] and left out.
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
        // `.staging` and friends are the storage layer's own, never themes.
        if dir_name.starts_with('.') {
            continue;
        }
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
    // create_dir, not create_dir_all: an existing theme must fail, not merge.
    std::fs::create_dir(&dir).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!(
            "A theme with id `{}` is already installed at {}",
            manifest.id,
            dir.display()
        ),
        _ => format!("Could not create {}: {e}", dir.display()),
    })?;

    let files: Vec<(&str, &[u8])> =
        vec![(MANIFEST_FILE, &manifest_json), (TOKENS_FILE, &tokens_json)];

    // A half-written directory would show up as a theme that can't load, so remove it instead.
    for (name, bytes) in files {
        let path = dir.join(name);
        if let Err(e) = crate::atomic_write::write_atomically(&path, bytes) {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(format!("Could not write {}: {e}", path.display()));
        }
    }

    Ok(manifest.id.clone())
}

/// Delete an installed theme. Refuses an id with no directory (a built-in
/// preset, checked first so the error isn't misleading) and refuses `active`,
/// which would otherwise leave the selection pointing at nothing.
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
/// storage, one directory each. Best-effort: a bad entry is reported and the rest still migrate.
pub fn migrate(themes_root: &Path, legacy: &[LegacyTheme]) -> Migration {
    let mut migration = Migration::default();
    for theme in legacy {
        let fallback = || format!("{:?}", theme.name);
        // A saved palette is a pair of token-map objects; anything else is corrupt.
        if !theme.dark.is_object() || !theme.light.is_object() {
            migration.skipped.push(format!(
                "{}: dark/light are not token objects; not migrated",
                fallback()
            ));
            continue;
        }

        let id = format!("local.{}", slugify(&theme.name));
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
            theme_api: archive::SUPPORTED_THEME_API_RANGE.to_string(),
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
            theme_api: "2.0".to_string(),
            minimum_launcher_version: "2.6.0".to_string(),
            tier: "basic".to_string(),
            description: "A theme for a test.".to_string(),
            capabilities: vec!["tokens".to_string()],
            ..ThemeManifest::default()
        }
    }

    #[test]
    fn scan_reports_older_formats_as_incompatible_without_hiding_them() {
        let root = scratch("incompatible");
        for (id, schema, api) in [
            ("old.schema", 1, "2.0"),
            ("old.api", 2, "1.3"),
            ("current.theme", 2, "2.0"),
        ] {
            let mut manifest = manifest(id);
            manifest.schema_version = schema;
            manifest.theme_api = api.to_string();
            save(&root, &manifest, &tokens()).unwrap();
        }
        let scanned = scan(&root);
        assert!(scanned.skipped.is_empty());
        assert_eq!(scanned.themes.len(), 3);
        for theme in scanned.themes {
            assert_eq!(theme.incompatible, theme.id.starts_with("old."));
            assert_eq!(
                theme.incompatible_reason.as_deref(),
                theme
                    .incompatible
                    .then_some("Incompatible — older theme format")
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    fn tokens() -> Value {
        serde_json::json!({ "schemaVersion": 1, "dark": { "bg": "#0d0f13" }, "light": {} })
    }

    fn settings_schema() -> Value {
        serde_json::json!({ "schemaVersion": 1, "fields": [{ "key": "bloom", "type": "number" }] })
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
        assert!(
            loaded.settings_schema.is_none(),
            "no settings schema was written"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The optional settings schema reads back when present; its absence is not
    /// an error, and a corrupt one fails the read like a corrupt `tokens.json`.
    #[test]
    fn an_optional_settings_schema_reads_back_when_present() {
        let root = scratch("schema");
        let dir = root.join("dev.schema");
        save(&root, &manifest("dev.schema"), &tokens()).expect("save");

        let loaded = get(&root, "dev.schema").expect("get");
        assert!(loaded.settings_schema.is_none(), "absent by default");

        let written_schema = settings_schema();
        std::fs::write(
            dir.join(SETTINGS_SCHEMA_FILE),
            serde_json::to_vec_pretty(&written_schema).unwrap(),
        )
        .unwrap();

        let loaded = get(&root, "dev.schema").expect("get");
        assert_eq!(loaded.settings_schema.as_ref(), Some(&written_schema));

        // `ThemeFile` carries no struct-level `rename_all`, so the field is
        // camelCase on the wire only because of its own `rename`.
        let wire = serde_json::to_value(&loaded).expect("serialise");
        assert_eq!(wire["settingsSchema"], written_schema);
        assert!(wire.get("settings_schema").is_none());
        // The v1 keys are gone from the wire the frontend codes against.
        assert!(wire.get("layout").is_none());
        assert!(wire.get("components").is_none());

        std::fs::remove_file(dir.join(SETTINGS_SCHEMA_FILE)).unwrap();
        let loaded = get(&root, "dev.schema").expect("get");
        assert!(loaded.settings_schema.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Fail-closed, like a corrupt `tokens.json`: a broken settings schema
    /// costs the whole theme rather than silently reading as absent.
    #[test]
    fn a_corrupt_settings_schema_fails_the_read_rather_than_being_ignored() {
        let root = scratch("badschema");
        let dir = root.join("dev.bad");
        save(&root, &manifest("dev.bad"), &tokens()).expect("save");

        std::fs::write(dir.join(SETTINGS_SCHEMA_FILE), "{ not json").unwrap();
        assert!(get(&root, "dev.bad").is_err(), "malformed JSON must fail");

        std::fs::write(dir.join(SETTINGS_SCHEMA_FILE), r#"{"fields":[]}"#).unwrap();
        let err = get(&root, "dev.bad").expect_err("a file with no schemaVersion must fail");
        assert!(err.contains("schemaVersion"), "{err}");

        std::fs::remove_file(dir.join(SETTINGS_SCHEMA_FILE)).unwrap();
        // With it gone, the theme reads again — the failure was the file, not the theme.
        assert!(get(&root, "dev.bad").is_ok());
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

    /// The settings schema is held to the same rule: an object with a
    /// `schemaVersion`, and nothing else about the contents.
    #[test]
    fn a_settings_schema_is_held_to_an_object_with_a_schema_version() {
        assert!(validate_settings_schema(&settings_schema()).is_ok());
        assert!(validate_settings_schema(&serde_json::json!({ "schemaVersion": 1 })).is_ok());
        assert!(validate_settings_schema(&serde_json::json!({ "fields": [] })).is_err());
        assert!(validate_settings_schema(&serde_json::json!([1, 2])).is_err());
        assert!(validate_settings_schema(&serde_json::json!("a string")).is_err());
    }
}
