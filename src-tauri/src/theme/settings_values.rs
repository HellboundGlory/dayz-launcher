//! The launcher's own record of which `settings.schema.json` fields an end
//! user has tuned for one installed theme. A sidecar file rather than a merge
//! into `tokens.json`/`layout.json`, so a theme's `{{placeholder}}` templates
//! survive and stay reusable (Phase 3 §0 decision 4) — never theme-authored,
//! never exported, only ever written from here.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

/// A theme-relative filename, but launcher-owned: a theme author never ships
/// one, and `archive::export` skips it like `theme.json`/`tokens.json`.
pub const SETTINGS_VALUES_FILE: &str = "settings.values.json";

/// One installed theme's tuned values, keyed by settings-schema field id. No
/// file is `{}` — the ordinary case, since nothing is tuned until the user
/// moves a control.
pub fn get_values(themes_root: &Path, id: &str) -> Result<Value, String> {
    let path = values_path(themes_root, id)?;
    Ok(Value::Object(read_object(&path)?))
}

/// Set exactly one field, keeping every other value already on disk.
pub fn set_value(
    themes_root: &Path,
    id: &str,
    field_id: &str,
    value: &Value,
) -> Result<(), String> {
    let path = values_path(themes_root, id)?;
    // Read-modify-write rather than trusting the caller's whole object: two
    // fields set in quick succession would otherwise race each other's write.
    let mut object = read_object(&path)?;
    object.insert(field_id.to_string(), value.clone());

    let json = serde_json::to_vec_pretty(&Value::Object(object))
        .map_err(|e| format!("Could not serialise {SETTINGS_VALUES_FILE}: {e}"))?;
    crate::atomic_write::write_atomically(&path, &json)
        .map_err(|e| format!("Could not write {}: {e}", path.display()))
}

/// The sidecar's path inside an *installed* theme. A values file is meaningless
/// without the theme it tunes, so a missing directory is refused like
/// [`crate::theme::get`] refuses it — only a missing file is ordinary.
fn values_path(themes_root: &Path, id: &str) -> Result<PathBuf, String> {
    let dir = super::theme_dir(themes_root, id)?;
    if !dir.is_dir() {
        return Err(format!("No installed theme `{id}` at {}", dir.display()));
    }
    Ok(dir.join(SETTINGS_VALUES_FILE))
}

/// The whole sidecar as a JSON object. Malformed content is an error rather
/// than silently dropped: only this launcher writes the file, so a corrupt one
/// means a real fault, not hostile input.
fn read_object(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| format!("{} must be a JSON object", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A scratch themes root holding one installed theme directory.
    fn installed(tag: &str) -> PathBuf {
        static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let seq = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("tetra-theme-values-{tag}-{nanos}-{seq}"));
        std::fs::create_dir_all(root.join("dev.values")).expect("could not create scratch dir");
        root
    }

    #[test]
    fn a_missing_sidecar_reads_as_an_empty_object() {
        let root = installed("absent");
        assert_eq!(get_values(&root, "dev.values").unwrap(), json!({}));
        assert!(!root.join("dev.values").join(SETTINGS_VALUES_FILE).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_set_value_reads_back_typed_and_verbatim() {
        let root = installed("roundtrip");
        set_value(&root, "dev.values", "accentHue", &json!(210)).unwrap();
        set_value(&root, "dev.values", "compactRows", &json!(true)).unwrap();

        let values = get_values(&root, "dev.values").unwrap();
        assert_eq!(values, json!({ "accentHue": 210, "compactRows": true }));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn setting_one_field_keeps_every_other_field_already_on_disk() {
        let root = installed("merge");
        set_value(&root, "dev.values", "accentHue", &json!(210)).unwrap();
        set_value(&root, "dev.values", "rowGap", &json!(0.5)).unwrap();

        assert_eq!(
            get_values(&root, "dev.values").unwrap(),
            json!({ "accentHue": 210, "rowGap": 0.5 })
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn setting_the_same_field_twice_overwrites_rather_than_appends() {
        let root = installed("overwrite");
        set_value(&root, "dev.values", "accentHue", &json!(210)).unwrap();
        set_value(&root, "dev.values", "accentHue", &json!(40)).unwrap();

        assert_eq!(
            get_values(&root, "dev.values").unwrap(),
            json!({ "accentHue": 40 })
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The id becomes a path component, so a traversing one must never reach disk.
    #[test]
    fn an_unusable_id_is_refused_both_ways() {
        let root = installed("bad-id");
        assert!(get_values(&root, "../../evil").is_err());
        assert!(set_value(&root, "..", "accentHue", &json!(1)).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_uninstalled_theme_is_refused_rather_than_read_as_empty() {
        let root = installed("missing-theme");
        assert!(get_values(&root, "dev.other").is_err());
        assert!(set_value(&root, "dev.other", "accentHue", &json!(1)).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_corrupt_sidecar_is_refused_rather_than_silently_discarded() {
        let root = installed("corrupt");
        std::fs::write(
            root.join("dev.values").join(SETTINGS_VALUES_FILE),
            b"[1, 2]",
        )
        .unwrap();
        assert!(get_values(&root, "dev.values").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
