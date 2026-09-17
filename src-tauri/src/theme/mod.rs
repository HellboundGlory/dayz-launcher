//! File-backed theme storage: one directory per theme under
//! [`crate::paths::themes_dir`], holding a [`manifest::ThemeManifest`] in
//! `theme.json`, the palette in `tokens.json`, and whatever else an advanced
//! theme ships — `layout.json`, `styles.css`, fonts and images.
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

pub use manifest::ThemeManifest;
use serde_json::Value;

/// The manifest file's name, in one place because `save` and `scan` both need it.
pub const MANIFEST_FILE: &str = "theme.json";

/// The palette file's name, alongside the manifest.
pub const TOKENS_FILE: &str = "tokens.json";

/// The optional layout file's name, alongside the palette.
pub const LAYOUT_FILE: &str = "layout.json";

/// The optional advanced-tier stylesheet's name — the one path
/// `src/theme/css-loader.ts` fetches, so it is gated by exactly this name.
pub const STYLES_FILE: &str = "styles.css";

/// The optional expert-tier settings-schema file's name.
pub const SETTINGS_SCHEMA_FILE: &str = "settings.schema.json";

/// The optional expert-tier component-composition directory's name: one file
/// per composed slot, named after the slot id verbatim.
pub const COMPONENTS_DIR: &str = "components";

/// The frontend's `src/theme/slots.ts` `SLOTS` array mirrored as `(slot id,
/// compositionCeiling is "advanced")`. Kept in sync by hand — update when
/// `slots.ts` changes.
pub const SLOTS: [(&str, bool); 24] = [
    ("shell.sidebar", false),
    ("view.servers", false),
    ("view.favourites", false),
    ("view.recent", false),
    ("view.mods", false),
    ("shell.header", false),
    ("shell.footer", false),
    ("filterBar", false),
    ("server.row", false),
    ("server.rowActions", false),
    ("modal.serverInfo", false),
    ("modal.modFilter", false),
    ("modal.update", false),
    ("modal.steamRequired", true),
    ("mods.toolbar", false),
    ("mods.row", false),
    ("mods.inspector", false),
    ("mods.actionBar", false),
    ("modal.onboarding", true),
    ("settings.background", true),
    ("settings.shell", true),
    ("settings.game", true),
    ("settings.launcher", true),
    ("settings.theme", true),
];

/// The slot registry's verdict on a composition's slot id: `Some((slot,
/// composable))` for a known slot, `None` for one the registry does not know.
/// The bool is `false` exactly for the slots `slots.ts` caps at
/// `compositionCeiling: "advanced"`. The one definition of "a components
/// file", shared with the import gate.
pub fn composition_gate(slot_id: &str) -> Option<(&str, bool)> {
    SLOTS
        .iter()
        .find(|(known, _)| *known == slot_id)
        .map(|&(known, restricted)| (known, !restricted))
}

/// The error [`read_components`] and the import gate report for a composition
/// file the slot registry refuses.
pub fn composition_refused(name: &str, slot: &str) -> String {
    format!("`{name}` targets `{slot}`, which is not a slot a theme may compose components into.")
}

/// Whether `name` could name a composition file at all: `<slot id>.json` with
/// a nonempty slot id. Anything else under `components/` is a stray, not a
/// slot reference, and is ignored rather than validated.
pub fn is_composition_name(name: &str) -> bool {
    name.strip_suffix(".json")
        .is_some_and(|slot| !slot.is_empty())
}

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

/// One theme, fully: its manifest flattened with its raw optional content —
/// `tokens.json` and whatever else the theme ships.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ThemeFile {
    #[serde(flatten)]
    pub manifest: ThemeManifest,
    pub tokens: serde_json::Value,
    pub layout: Option<serde_json::Value>,
    /// `rename` because `ThemeFile` has no struct-level `rename_all`.
    #[serde(rename = "settingsSchema")]
    pub settings_schema: Option<serde_json::Value>,
    /// Keyed by slot id, one entry per `components/<slot id>.json` the theme
    /// ships. Absent from the map is "this theme ships none", not an error.
    pub components: std::collections::BTreeMap<String, serde_json::Value>,
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

/// A layout must be a JSON object carrying a `schemaVersion`, exactly as a
/// palette must; the slots themselves are the frontend's business.
pub fn validate_layout(layout: &Value) -> Result<(), String> {
    let Some(object) = layout.as_object() else {
        return Err("layout.json must be a JSON object".to_string());
    };
    if !object.contains_key("schemaVersion") {
        return Err("layout.json has no `schemaVersion`".to_string());
    }
    Ok(())
}

/// A settings schema must be a JSON object carrying a `schemaVersion`, exactly
/// as a layout must; the field list is the frontend's business.
pub fn validate_settings_schema(schema: &Value) -> Result<(), String> {
    let Some(object) = schema.as_object() else {
        return Err("settings.schema.json must be a JSON object".to_string());
    };
    if !object.contains_key("schemaVersion") {
        return Err("settings.schema.json has no `schemaVersion`".to_string());
    }
    Ok(())
}

/// A component tree must be a JSON object carrying a `schemaVersion`, exactly
/// as a layout must; the `stack`/`box`/`grid`/`core` shape is the frontend's business.
pub fn validate_components(components: &Value) -> Result<(), String> {
    let Some(object) = components.as_object() else {
        return Err("a components file must be a JSON object".to_string());
    };
    if !object.contains_key("schemaVersion") {
        return Err("a components file has no `schemaVersion`".to_string());
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
/// Every composition a theme ships, one `components/<slot id>.json` each,
/// keyed by the slot id its own filename names. No `components/` directory at
/// all is the ordinary "this theme composes nothing" case, not an error; a
/// file that is not a known, unrestricted slot's composition fails the whole
/// read, exactly as a corrupt `tokens.json` does.
fn read_components(dir: &Path) -> Result<std::collections::BTreeMap<String, Value>, String> {
    let components_dir = dir.join(COMPONENTS_DIR);
    if !components_dir.is_dir() {
        return Ok(std::collections::BTreeMap::new());
    }
    let entries = std::fs::read_dir(&components_dir)
        .map_err(|e| format!("Could not read {}: {e}", components_dir.display()))?;

    let mut components = std::collections::BTreeMap::new();
    for entry in entries {
        let entry =
            entry.map_err(|e| format!("Could not read {}: {e}", components_dir.display()))?;
        if !entry.path().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_composition_name(&name) {
            continue;
        }
        let slot_id = name.strip_suffix(".json").unwrap();
        let Some((slot, composable)) = composition_gate(slot_id) else {
            return Err(format!(
                "`{name}` in {} names no slot in the slot registry.",
                components_dir.display()
            ));
        };
        if !composable {
            return Err(composition_refused(&name, slot));
        }
        if let Some(tree) = read_optional_json(&components_dir, &name, validate_components)? {
            components.insert(slot.to_string(), tree);
        }
    }
    Ok(components)
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

    let layout = read_optional_json(&dir, LAYOUT_FILE, validate_layout)?;
    let settings_schema = read_optional_json(&dir, SETTINGS_SCHEMA_FILE, validate_settings_schema)?;
    let components = read_components(&dir)?;

    Ok(ThemeFile {
        manifest,
        tokens,
        layout,
        settings_schema,
        components,
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
    layout: Option<&Value>,
) -> Result<String, String> {
    let dir = theme_dir(themes_root, &manifest.id)?;
    validate_tokens(tokens)?;
    if let Some(layout) = layout {
        validate_layout(layout)?;
    }

    // Serialised before anything is created, so a manifest that can't be
    // written never leaves a directory behind.
    let manifest_json = serde_json::to_vec_pretty(manifest)
        .map_err(|e| format!("Could not serialise the manifest: {e}"))?;
    let tokens_json = serde_json::to_vec_pretty(tokens)
        .map_err(|e| format!("Could not serialise tokens: {e}"))?;
    let layout_json = layout
        .map(serde_json::to_vec_pretty)
        .transpose()
        .map_err(|e| format!("Could not serialise the layout: {e}"))?;

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

    let mut files: Vec<(&str, &[u8])> =
        vec![(MANIFEST_FILE, &manifest_json), (TOKENS_FILE, &tokens_json)];
    if let Some(layout_json) = &layout_json {
        files.push((LAYOUT_FILE, layout_json));
    }

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

/// Replace an *already-installed* theme's layout.json wholesale — always a
/// full replace, never a merge, since the caller (the frontend) always holds
/// and resends the complete object. Refuses a theme with no installed
/// directory, the same way [`settings_values::values_path`] does.
pub fn update_layout(themes_root: &Path, id: &str, layout: &Value) -> Result<(), String> {
    validate_layout(layout)?;
    let dir = theme_dir(themes_root, id)?;
    if !dir.is_dir() {
        return Err(format!("No installed theme `{id}` at {}", dir.display()));
    }
    let json = serde_json::to_vec_pretty(layout)
        .map_err(|e| format!("Could not serialise {LAYOUT_FILE}: {e}"))?;
    let path = dir.join(LAYOUT_FILE);
    crate::atomic_write::write_atomically(&path, &json)
        .map_err(|e| format!("Could not write {}: {e}", path.display()))
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
            theme_api: manifest::SCHEMA_VERSION.to_string(),
            // This build wrote it, so this build is the floor it can rely on.
            minimum_launcher_version: env!("CARGO_PKG_VERSION").to_string(),
            tier: "basic".to_string(),
            description: "Migrated from a saved custom theme.".to_string(),
            capabilities: vec!["tokens".to_string()],
            ..ThemeManifest::default()
        };

        match save(themes_root, &manifest, &tokens, None) {
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
            tier: "basic".to_string(),
            description: "A theme for a test.".to_string(),
            capabilities: vec!["tokens".to_string()],
            ..ThemeManifest::default()
        }
    }

    fn tokens() -> Value {
        serde_json::json!({ "schemaVersion": 1, "dark": { "bg": "#0d0f13" }, "light": {} })
    }

    fn layout() -> Value {
        serde_json::json!({ "schemaVersion": 1, "slots": { "sidebar": "aside" } })
    }

    fn settings_schema() -> Value {
        serde_json::json!({ "schemaVersion": 1, "fields": [{ "key": "bloom", "type": "number" }] })
    }

    fn components() -> Value {
        serde_json::json!({ "schemaVersion": 1, "root": { "type": "stack" } })
    }

    #[test]
    fn a_saved_theme_reads_back_exactly_as_written() {
        let root = scratch("roundtrip");
        let written_tokens = tokens();

        let id = save(&root, &manifest("dev.roundtrip"), &written_tokens, None).expect("save");
        let loaded = get(&root, "dev.roundtrip").expect("get");

        assert_eq!(id, "dev.roundtrip");
        assert_eq!(loaded.manifest.id, "dev.roundtrip");
        assert_eq!(loaded.manifest.name, "Test Theme");
        assert_eq!(loaded.manifest.version, "2.1.0");
        assert_eq!(loaded.manifest.capabilities, vec!["tokens".to_string()]);
        assert_eq!(loaded.tokens, written_tokens, "tokens round-trip verbatim");
        assert!(loaded.layout.is_none(), "no layout was written");
        assert!(
            loaded.settings_schema.is_none(),
            "no settings schema was written"
        );
        assert!(
            loaded.components.is_empty(),
            "no components directory was written"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The three expert-tier files are read back, and each is independently
    /// optional: neither an absent file nor the other's presence is an error.
    #[test]
    fn the_optional_expert_files_read_back_when_present_and_are_independently_optional() {
        let root = scratch("expert");
        let dir = root.join("dev.expert");
        save(&root, &manifest("dev.expert"), &tokens(), None).expect("save");

        let written_schema = settings_schema();
        let written_server_row = components();
        let written_mods_row =
            serde_json::json!({ "schemaVersion": 1, "root": { "type": "grid" } });
        std::fs::write(
            dir.join(SETTINGS_SCHEMA_FILE),
            serde_json::to_vec_pretty(&written_schema).unwrap(),
        )
        .unwrap();
        std::fs::create_dir_all(dir.join(COMPONENTS_DIR)).unwrap();
        std::fs::write(
            dir.join(COMPONENTS_DIR).join("server.row.json"),
            serde_json::to_vec_pretty(&written_server_row).unwrap(),
        )
        .unwrap();
        std::fs::write(
            dir.join(COMPONENTS_DIR).join("mods.row.json"),
            serde_json::to_vec_pretty(&written_mods_row).unwrap(),
        )
        .unwrap();

        let loaded = get(&root, "dev.expert").expect("get");
        assert_eq!(loaded.settings_schema.as_ref(), Some(&written_schema));
        assert_eq!(loaded.components.len(), 2, "{:?}", loaded.components);
        assert_eq!(loaded.components["server.row"], written_server_row);
        assert_eq!(loaded.components["mods.row"], written_mods_row);

        // `ThemeFile` carries no struct-level `rename_all`, so the field is
        // camelCase on the wire only because of its own `rename`.
        let wire = serde_json::to_value(&loaded).expect("serialise");
        assert_eq!(wire["settingsSchema"], written_schema);
        assert!(wire.get("settings_schema").is_none());

        // Only one of the two component files present: one key, no error.
        std::fs::remove_file(dir.join(COMPONENTS_DIR).join("mods.row.json")).unwrap();
        let loaded = get(&root, "dev.expert").expect("get");
        assert_eq!(loaded.components.len(), 1, "{:?}", loaded.components);
        assert!(loaded.components.contains_key("server.row"));

        // Settings schema removed too: `None`, and the map stays as it was.
        std::fs::remove_file(dir.join(SETTINGS_SCHEMA_FILE)).unwrap();
        let loaded = get(&root, "dev.expert").expect("get");
        assert!(loaded.settings_schema.is_none());
        assert_eq!(loaded.components.len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The generalization itself: the directory scan finds one slot per
    /// `components/<slot id>.json`, whatever the slot id is — not the two the
    /// backend used to hardcode.
    #[test]
    fn every_slot_id_under_components_is_read_back_under_its_own_name() {
        let root = scratch("anyslot");
        let dir = root.join("dev.anyslot");
        save(&root, &manifest("dev.anyslot"), &tokens(), None).expect("save");
        let components = dir.join(COMPONENTS_DIR);
        std::fs::create_dir_all(&components).unwrap();

        let written =
            |kind: &str| serde_json::json!({ "schemaVersion": 1, "root": { "type": kind } });
        for (slot, kind) in [
            ("server.row", "stack"),
            ("mods.row", "grid"),
            ("shell.sidebar", "box"),
        ] {
            std::fs::write(
                components.join(format!("{slot}.json")),
                serde_json::to_vec_pretty(&written(kind)).unwrap(),
            )
            .unwrap();
        }
        // Neither of these is a composition: the extension is not `.json`, and
        // a subdirectory is not a file, however it is named.
        std::fs::write(components.join("notes.txt"), b"not a composition").unwrap();
        std::fs::create_dir_all(components.join("nested")).unwrap();

        let loaded = get(&root, "dev.anyslot").expect("get");
        assert_eq!(
            loaded.components.keys().collect::<Vec<_>>(),
            ["mods.row", "server.row", "shell.sidebar"],
            "one entry per `.json` file, keyed by its own slot id"
        );
        assert_eq!(loaded.components["shell.sidebar"], written("box"));
        assert!(
            !loaded.components.contains_key("notes") && !loaded.components.contains_key("nested"),
            "only `.json` files are compositions: {:?}",
            loaded.components.keys().collect::<Vec<_>>()
        );

        // The write half: a third slot added later reads back too, so the map
        // is not a fixed pair that only grows at save time.
        std::fs::write(
            components.join("filterBar.json"),
            serde_json::to_vec_pretty(&written("stack")).unwrap(),
        )
        .unwrap();
        let loaded = get(&root, "dev.anyslot").expect("get");
        assert_eq!(loaded.components.len(), 4, "{:?}", loaded.components);
        assert_eq!(loaded.components["filterBar"], written("stack"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Fail-closed, like a corrupt `tokens.json`: a composition file whose
    /// filename names no slot in the registry costs the whole theme, since a
    /// typo would otherwise do nothing and look like a working theme.
    #[test]
    fn a_components_file_for_an_unknown_slot_fails_the_read() {
        let root = scratch("unknownslot");
        let dir = root.join("dev.bad");
        save(&root, &manifest("dev.bad"), &tokens(), None).expect("save");
        let components_dir = dir.join(COMPONENTS_DIR);
        std::fs::create_dir_all(&components_dir).unwrap();
        std::fs::write(
            components_dir.join("server.rows.json"),
            serde_json::to_vec_pretty(&components()).unwrap(),
        )
        .unwrap();

        let err = get(&root, "dev.bad").expect_err("an unknown slot must fail the read");
        assert!(
            err.contains("server.rows.json") && err.contains("no slot in the slot registry"),
            "{err}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The `compositionCeiling: "advanced"` line in `slots.ts` is enforced
    /// here too: a recovery/config slot accepts no composition file at all.
    #[test]
    fn a_components_file_for_a_restricted_slot_fails_the_read() {
        let root = scratch("restrictedslot");
        let dir = root.join("dev.bad");
        save(&root, &manifest("dev.bad"), &tokens(), None).expect("save");
        let components_dir = dir.join(COMPONENTS_DIR);
        std::fs::create_dir_all(&components_dir).unwrap();
        std::fs::write(
            components_dir.join("modal.steamRequired.json"),
            serde_json::to_vec_pretty(&components()).unwrap(),
        )
        .unwrap();

        let err = get(&root, "dev.bad").expect_err("a restricted slot must fail the read");
        assert!(err.contains("not a slot a theme may compose"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The gate rejects only the file that earned it: unrestricted slots read
    /// exactly as before, one entry per file.
    #[test]
    fn unrestricted_slots_compose_exactly_as_before_the_gate() {
        let root = scratch("unrestrictedslot");
        let dir = root.join("dev.good");
        save(&root, &manifest("dev.good"), &tokens(), None).expect("save");
        let components_dir = dir.join(COMPONENTS_DIR);
        std::fs::create_dir_all(&components_dir).unwrap();
        let written_server_row = components();
        std::fs::write(
            components_dir.join("server.row.json"),
            serde_json::to_vec_pretty(&written_server_row).unwrap(),
        )
        .unwrap();
        std::fs::write(
            components_dir.join("mods.actionBar.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "schemaVersion": 1, "root": { "type": "grid" }
            }))
            .unwrap(),
        )
        .unwrap();

        let loaded = get(&root, "dev.good").expect("get");
        assert_eq!(loaded.components.len(), 2, "{:?}", loaded.components);
        assert_eq!(loaded.components["server.row"], written_server_row);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_saved_layout_reads_back_verbatim_and_is_optional_on_disk() {
        let root = scratch("layout");
        let written_layout = layout();

        save(
            &root,
            &manifest("dev.layout"),
            &tokens(),
            Some(&written_layout),
        )
        .expect("save");
        let loaded = get(&root, "dev.layout").expect("get");

        assert_eq!(loaded.layout.as_ref(), Some(&written_layout));

        // A theme on disk with no layout.json at all is still a complete theme.
        save(&root, &manifest("dev.nolayout"), &tokens(), None).expect("save");
        assert!(!root.join("dev.nolayout").join(LAYOUT_FILE).exists());
        assert!(get(&root, "dev.nolayout").expect("get").layout.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Fail-closed, like a corrupt `tokens.json`: a broken layout costs the
    /// whole theme rather than silently reading as layout-less.
    #[test]
    fn a_corrupt_layout_fails_the_read_rather_than_being_ignored() {
        let root = scratch("badlayout");
        save(&root, &manifest("dev.bad"), &tokens(), None).expect("save");
        std::fs::write(root.join("dev.bad").join(LAYOUT_FILE), "{ not json").unwrap();

        assert!(get(&root, "dev.bad").is_err());

        std::fs::write(root.join("dev.bad").join(LAYOUT_FILE), r#"{"slots":{}}"#).unwrap();
        let err = get(&root, "dev.bad").expect_err("a layout with no schemaVersion must fail");
        assert!(err.contains("schemaVersion"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Fail-closed, like a corrupt `tokens.json`: a broken optional file costs
    /// the whole theme rather than silently reading as absent.
    #[test]
    fn a_corrupt_settings_schema_or_components_file_fails_the_read_rather_than_being_ignored() {
        let root = scratch("badexpert");
        let dir = root.join("dev.bad");
        save(&root, &manifest("dev.bad"), &tokens(), None).expect("save");
        let components = dir.join(COMPONENTS_DIR);
        std::fs::create_dir_all(&components).unwrap();

        for name in [
            SETTINGS_SCHEMA_FILE.to_string(),
            format!("{COMPONENTS_DIR}/server.row.json"),
            format!("{COMPONENTS_DIR}/mods.row.json"),
        ] {
            std::fs::write(dir.join(&name), "{ not json").unwrap();
            assert!(
                get(&root, "dev.bad").is_err(),
                "{name} should fail the read"
            );

            std::fs::write(dir.join(&name), r#"{"root":{}}"#).unwrap();
            let err =
                get(&root, "dev.bad").expect_err("a file with no schemaVersion must fail the read");
            assert!(err.contains("schemaVersion"), "{name}: {err}");

            std::fs::remove_file(dir.join(&name)).unwrap();
        }
        // With every one of them gone, the theme reads again — the failures
        // above were the files, not the theme.
        assert!(get(&root, "dev.bad").is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A layout that is not an object is refused before anything is created.
    #[test]
    fn a_non_object_layout_is_refused_before_the_directory_exists() {
        let root = scratch("badsavelayout");

        let err = save(
            &root,
            &manifest("dev.bad"),
            &tokens(),
            Some(&serde_json::json!([1, 2])),
        )
        .expect_err("must refuse");

        assert!(err.contains("JSON object"), "{err}");
        assert!(!root.join("dev.bad").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The editor's write: whichever complete object arrives is what lands on
    /// disk, with no trace of what was there before. A theme that shipped no
    /// `layout.json` gains one.
    #[test]
    fn updating_a_layout_is_a_full_replace_not_a_merge() {
        let root = scratch("updatelayout");
        let original = layout();
        save(&root, &manifest("dev.edited"), &tokens(), Some(&original)).expect("save");

        let edited = serde_json::json!({ "schemaVersion": 1, "slots": { "toolbar": "hidden" } });
        update_layout(&root, "dev.edited", &edited).expect("update");

        let loaded = get(&root, "dev.edited").expect("get");
        assert_eq!(loaded.layout.as_ref(), Some(&edited));
        assert!(
            loaded.manifest.name == "Test Theme" && loaded.tokens == tokens(),
            "only layout.json is touched"
        );

        // Absent before: the full replace creates it rather than refusing.
        save(&root, &manifest("dev.fresh"), &tokens(), None).expect("save");
        assert!(!root.join("dev.fresh").join(LAYOUT_FILE).exists());
        update_layout(&root, "dev.fresh", &edited).expect("update");
        assert_eq!(
            get(&root, "dev.fresh").expect("get").layout.as_ref(),
            Some(&edited)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Same rule `save` applies, checked before the write: a bad object must
    /// never cost the theme its working layout.
    #[test]
    fn an_invalid_layout_update_is_refused_and_leaves_the_file_untouched() {
        let root = scratch("updatebadlayout");
        let original = layout();
        save(&root, &manifest("dev.edited"), &tokens(), Some(&original)).expect("save");
        let path = root.join("dev.edited").join(LAYOUT_FILE);
        let before = std::fs::read(&path).unwrap();

        for invalid in [
            serde_json::json!([1, 2]),
            serde_json::json!({ "slots": {} }),
            serde_json::json!("a string"),
        ] {
            let err = update_layout(&root, "dev.edited", &invalid).expect_err("must refuse");
            assert!(
                err.contains("schemaVersion") || err.contains("JSON object"),
                "{err}"
            );
        }

        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(
            get(&root, "dev.edited").expect("get").layout.as_ref(),
            Some(&original)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Only an installed theme's own layout.json is reachable, exactly as
    /// `set_value` requires: no directory means nothing to update.
    #[test]
    fn updating_a_layout_of_an_uninstalled_theme_is_refused() {
        let root = scratch("updatemissing");

        assert!(update_layout(&root, "dev.other", &layout()).is_err());
        assert!(update_layout(&root, "../../escape", &layout()).is_err());
        assert!(!root.join("dev.other").exists());
        assert!(!root.join("..").join("escape").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Create-only: an existing id must be refused, not merged into or overwritten.
    #[test]
    fn saving_over_an_installed_id_is_refused() {
        let root = scratch("exists");
        save(&root, &manifest("dev.taken"), &tokens(), None).expect("first save");

        let err = save(&root, &manifest("dev.taken"), &tokens(), None).expect_err("second save");

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

        let err = save(&root, &escaped, &tokens(), None).expect_err("must refuse");
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
        save(&root, &manifest("dev.active"), &tokens(), None).expect("save");

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
        save(&root, &manifest("dev.good"), &tokens(), None).expect("save");
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

    /// Exactly the rule `validate_tokens` applies: an object with a
    /// `schemaVersion`, and nothing else about the contents.
    #[test]
    fn layouts_are_held_to_the_same_shape_rule_as_tokens() {
        assert!(validate_layout(&serde_json::json!({ "schemaVersion": 1 })).is_ok());
        assert!(validate_layout(&serde_json::json!({ "slots": {} })).is_err());
        assert!(validate_layout(&serde_json::json!([1, 2])).is_err());
        assert!(validate_layout(&serde_json::json!("a string")).is_err());
        // Unknown slot ids and keys are not the backend's business.
        assert!(validate_layout(&layout()).is_ok());
    }

    /// The expert-tier files are held to exactly the same rule: an object with
    /// a `schemaVersion`, and nothing else about the contents.
    #[test]
    fn settings_schemas_and_components_are_held_to_the_same_shape_rule_as_layouts() {
        assert!(validate_settings_schema(&settings_schema()).is_ok());
        assert!(validate_settings_schema(&serde_json::json!({ "schemaVersion": 1 })).is_ok());
        assert!(validate_settings_schema(&serde_json::json!({ "fields": [] })).is_err());
        assert!(validate_settings_schema(&serde_json::json!([1, 2])).is_err());
        assert!(validate_settings_schema(&serde_json::json!("a string")).is_err());

        assert!(validate_components(&components()).is_ok());
        assert!(validate_components(&serde_json::json!({ "schemaVersion": 1 })).is_ok());
        assert!(validate_components(&serde_json::json!({ "root": {} })).is_err());
        assert!(validate_components(&serde_json::json!([1, 2])).is_err());
        assert!(validate_components(&serde_json::json!("a string")).is_err());
    }
}
