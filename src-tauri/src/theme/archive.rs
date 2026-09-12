//! Importing a theme `.zip`: [`stage_for_preview`] unpacks into
//! `themes/.staging/<id>` (never the live themes directory) and reports what
//! it found. Every limit is enforced while streaming, cheapest checks first,
//! before an entry is written — this is still hostile input.

use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

use crate::theme::{ThemeManifest, ThemeSummary, MANIFEST_FILE, TOKENS_FILE};

/// Exact match today since `"1.0"` is the only version so far; becomes a
/// range check once a second one exists (hence the name).
pub const SUPPORTED_THEME_API_RANGE: &str = "1.0";

const SUPPORTED_TIER: &str = "basic";

/// Headroom above a manifest+palette, not a target — big enough for a real
/// theme, small enough to reject an accidental asset pack cleanly.
const MAX_FILES: usize = 20;

/// Uncompressed, summed across entries — generous for two JSON files, small
/// enough to refuse a zip bomb before it fills a disk.
const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024;

/// `preview/dark/…` is already deeper nesting than a theme ships.
const MAX_PATH_DEPTH: usize = 3;

const STAGING_DIR: &str = ".staging";

/// What a validated package would install, for the confirmation dialog.
/// `staging_id` names the directory under `themes/.staging/` that
/// `confirm_theme_install` will later consume.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeImportPreview {
    pub staging_id: String,
    pub manifest: ThemeManifest,
    pub package_size_bytes: u64,
    pub file_count: usize,
    /// `"new"`, `"update"`, `"same_version"` or `"downgrade"`.
    pub classification: String,
}

const CLASSIFICATION_NEW: &str = "new";

/// Unpack `zip_path` into `themes/.staging/<id>` and report what it holds.
/// `installed` is the caller's [`crate::theme::scan`] result, passed in so
/// this stays pure and testable. On success the staging dir stays for the
/// install step; on the first failed check it's removed and the caller gets [`Err`].
pub fn stage_for_preview(
    themes_root: &Path,
    zip_path: &Path,
    installed: &[ThemeSummary],
) -> Result<ThemeImportPreview, String> {
    let package_size_bytes = std::fs::metadata(zip_path)
        .map_err(|e| format!("Could not read {}: {e}", zip_path.display()))?
        .len();
    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("Could not open {}: {e}", zip_path.display()))?;
    // A non-zip or truncated file fails here, before any staging directory exists.
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        format!(
            "{} is not a readable theme package: {e}",
            zip_path.display()
        )
    })?;

    let staging_root = themes_root.join(STAGING_DIR);
    std::fs::create_dir_all(&staging_root)
        .map_err(|e| format!("Could not create {}: {e}", staging_root.display()))?;
    let staging_id = staging_name();
    let staging_dir = staging_root.join(&staging_id);
    std::fs::create_dir(&staging_dir)
        .map_err(|e| format!("Could not create {}: {e}", staging_dir.display()))?;

    match inspect(&mut archive, &staging_dir) {
        Ok((manifest, file_count)) => Ok(ThemeImportPreview {
            staging_id,
            classification: classify(&manifest, installed),
            manifest,
            package_size_bytes,
            file_count,
        }),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&staging_dir);
            Err(e)
        }
    }
}

/// Move a staged import into place as `themes_root/<id>`. An already-installed
/// theme with that id is renamed aside first and deleted only once the new
/// directory is in place, so the live theme is never missing.
pub fn confirm_theme_install(themes_root: &Path, staging_id: &str) -> Result<String, String> {
    let staging_dir = themes_root.join(STAGING_DIR).join(staging_id);
    if !staging_dir.is_dir() {
        return Err(format!("No staged theme import `{staging_id}` to confirm."));
    }

    let manifest_path = staging_dir.join(MANIFEST_FILE);
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Could not read {}: {e}", manifest_path.display()))?;
    let manifest: ThemeManifest = serde_json::from_str(&raw)
        .map_err(|e| format!("{} is not a valid manifest: {e}", manifest_path.display()))?;
    // The id becomes a path component; `stage_for_preview` checks it, a
    // hand-made staging directory would not.
    if !crate::theme::is_usable_id(&manifest.id) {
        return Err(format!(
            "This import declares id `{}`, which is not a usable theme id.",
            manifest.id
        ));
    }

    let target_dir = themes_root.join(&manifest.id);
    if !target_dir.exists() {
        std::fs::rename(&staging_dir, &target_dir).map_err(|e| {
            format!(
                "Could not move {} into place at {}: {e}",
                staging_dir.display(),
                target_dir.display()
            )
        })?;
        return Ok(manifest.id);
    }

    let aside = themes_root
        .join(STAGING_DIR)
        .join(format!("{}.replaced-{staging_id}", manifest.id));
    std::fs::rename(&target_dir, &aside)
        .map_err(|e| format!("Could not move {} aside: {e}", target_dir.display()))?;
    if let Err(e) = std::fs::rename(&staging_dir, &target_dir) {
        // Put the old install back before reporting; only the new theme landing
        // in place makes deleting it safe.
        let _ = std::fs::rename(&aside, &target_dir);
        return Err(format!(
            "Could not move {} into place at {}: {e}",
            staging_dir.display(),
            target_dir.display()
        ));
    }
    let _ = std::fs::remove_dir_all(&aside);

    Ok(manifest.id)
}

/// Split out so [`stage_for_preview`] owns the one cleanup path: every `Err`
/// here discards the staging directory. Order is deliberate: limits and
/// zip-slip are checked before extraction, the manifest only after its bytes exist.
fn inspect<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    staging_dir: &Path,
) -> Result<(ThemeManifest, usize), String> {
    // Canonicalised once: on Windows the zip-slip check needs `\\?\C:\…` form to compare against.
    let staging_root = staging_dir
        .canonicalize()
        .map_err(|e| format!("Could not resolve {}: {e}", staging_dir.display()))?;

    let mut extracted = 0usize;
    // Bytes actually decompressed, never the archive's own claimed `size()` —
    // a crafted entry can declare small and stream gigabytes.
    let mut total_bytes = 0u64;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Could not read entry {index} of the package: {e}"))?;
        let name = entry.name().to_string();

        if extracted >= MAX_FILES {
            return Err(format!(
                "This package holds more than {MAX_FILES} files — a theme is a manifest and a palette."
            ));
        }
        let depth = name.matches('/').count();
        if depth > MAX_PATH_DEPTH {
            return Err(format!(
                "`{name}` is nested {depth} levels deep; a theme package may nest at most {MAX_PATH_DEPTH}."
            ));
        }
        // A cheap early hint only — the streaming sum below is what actually enforces the limit.
        if let Some(claimed) = entry.size().checked_add(total_bytes) {
            if claimed > MAX_TOTAL_UNCOMPRESSED_BYTES {
                return Err(format!(
                    "This package expands to more than {} MB; a theme package should be far smaller.",
                    MAX_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024)
                ));
            }
        } else {
            return Err("This package's declared size overflows — refusing it.".to_string());
        }

        // Checked for every entry including directories, before the directory
        // skip below — a `../` directory must not exist for a later entry to write into.
        let output = safe_output_path(&staging_root, &name, &entry)?;

        // No extension to check, and a legitimate `preview/` dir is fine — already path-checked above.
        if entry.is_dir() {
            continue;
        }

        // Checked against the full name: `tokens.json/…` and `tokens.json.exe` both fail.
        if !name.ends_with(".json") {
            return Err(format!(
                "`{name}` is not a `.json` file — a theme package holds only `theme.json` and `tokens.json`."
            ));
        }

        write_entry(&mut entry, &output, &mut total_bytes)?;
        extracted += 1;
    }

    let manifest_path = staging_dir.join(MANIFEST_FILE);
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|_| format!("This package has no {MANIFEST_FILE} — it is not a Tetra theme."))?;
    let parsed: ThemeManifest = serde_json::from_str(&raw)
        .map_err(|e| format!("{MANIFEST_FILE} is not a valid manifest: {e}"))?;

    // Three compatibility gates, cheapest first, before tokens.json is even read.
    if parsed.tier != SUPPORTED_TIER {
        return Err(format!(
            "`{}` is a `{}` theme, which this build cannot load — this theme needs a newer Tetra Launcher.",
            parsed.name, parsed.tier
        ));
    }
    if parsed.theme_api != SUPPORTED_THEME_API_RANGE {
        return Err(format!(
            "`{}` is written against theme API {} and this Launcher speaks {SUPPORTED_THEME_API_RANGE} — this theme needs a newer Tetra Launcher.",
            parsed.name, parsed.theme_api
        ));
    }
    minimum_launcher_version_at_most(&parsed)?;

    let tokens_path = staging_dir.join(TOKENS_FILE);
    let raw = std::fs::read_to_string(&tokens_path)
        .map_err(|_| format!("This package has no {TOKENS_FILE} — it is not a Tetra theme."))?;
    let tokens: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("{TOKENS_FILE} is not valid JSON: {e}"))?;
    crate::theme::validate_tokens(&tokens)?;

    // Checked last: the id becomes a directory name on install.
    if !crate::theme::is_usable_id(&parsed.id) {
        return Err(format!(
            "This package declares id `{}`, which is not a usable theme id.",
            parsed.id
        ));
    }

    Ok((parsed, extracted))
}

/// Resolve one entry's output path inside `staging_root`, refusing the three
/// ways a name escapes it: a `..` segment, an absolute path (which
/// `Path::join` would let override the staging root), or a symlink (whose
/// target is a path elsewhere). Then the canonicalised parent is checked to
/// still be under `staging_root`, belt and braces against any other escape.
fn safe_output_path(
    staging_root: &Path,
    name: &str,
    entry: &zip::read::ZipFile<'_>,
) -> Result<PathBuf, String> {
    let relative = Path::new(name);
    if relative
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!(
            "`{name}` points outside the theme package (`..` in its path); refusing it."
        ));
    }
    if relative.is_absolute() || name.starts_with('/') || name.starts_with('\\') {
        return Err(format!(
            "`{name}` is an absolute path; a theme package must not contain one."
        ));
    }
    if entry.is_symlink() {
        return Err(format!(
            "`{name}` is a symbolic link; a theme package must not contain one."
        ));
    }

    let output = staging_root.join(relative);
    // Created before canonicalising, since canonicalize needs the path to exist.
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
        let resolved = parent
            .canonicalize()
            .map_err(|e| format!("Could not resolve {}: {e}", parent.display()))?;
        if !resolved.starts_with(staging_root) {
            return Err(format!(
                "`{name}` would extract to {} — outside the theme package; refusing it.",
                resolved.display()
            ));
        }
    }
    Ok(output)
}

/// Copy one entry to `output`, counting the bytes actually read so the size
/// ceiling cannot be bypassed by a lying header.
fn write_entry(
    entry: &mut zip::read::ZipFile<'_>,
    output: &Path,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let mut file = std::fs::File::create(output)
        .map_err(|e| format!("Could not write {}: {e}", output.display()))?;
    // Chunked, not io::copy, so the running total is checked as it grows rather than after the fact.
    let mut buffer = [0u8; 16 * 1024];
    let mut tail = [0u8; 1];
    loop {
        let read = entry
            .read(&mut buffer)
            .map_err(|e| format!("Could not read {} from the package: {e}", output.display()))?;
        if read == 0 {
            break;
        }
        *total_bytes += read as u64;
        if *total_bytes > MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(format!(
                "This package expands to more than {} MB; a theme package should be far smaller.",
                MAX_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024)
            ));
        }
        file.write_all(&buffer[..read])
            .map_err(|e| format!("Could not write {}: {e}", output.display()))?;
    }
    // One byte past what was declared, to catch a size that lied short.
    if entry
        .read(&mut tail)
        .map_err(|e| format!("Could not read {} from the package: {e}", output.display()))?
        != 0
    {
        return Err(format!(
            "`{}` is longer than the package declares.",
            output.display()
        ));
    }
    Ok(())
}

/// Refuse a manifest that needs a launcher newer than this build. Parsed as
/// real versions, not compared as strings — `"2.6.0" > "2.10.0"` lexically.
/// An unparseable version is refused, not skipped: it can't be shown compatible.
fn minimum_launcher_version_at_most(manifest: &ThemeManifest) -> Result<(), String> {
    let minimum =
        semver::Version::parse(manifest.minimum_launcher_version.trim()).map_err(|e| {
            format!(
                "`{}` declares minimumLauncherVersion `{}`, which is not a version: {e}",
                manifest.name, manifest.minimum_launcher_version
            )
        })?;
    let running = semver::Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|e| format!("This build's own version is unparseable: {e}"))?;
    if minimum > running {
        return Err(format!(
            "`{}` needs Tetra Launcher {} or newer; this build is {}.",
            manifest.name, minimum, running
        ));
    }
    Ok(())
}

/// What installing `manifest` would do to `installed`, keyed on a shared id.
fn classify(manifest: &ThemeManifest, installed: &[ThemeSummary]) -> String {
    let Some(existing) = installed.iter().find(|t| t.id == manifest.id) else {
        return CLASSIFICATION_NEW.to_string();
    };
    let classification = match semver::Version::parse(manifest.version.trim()) {
        Ok(incoming) => match semver::Version::parse(existing.version.trim()) {
            Ok(current) if incoming > current => "update",
            Ok(current) if incoming < current => "downgrade",
            Ok(_) => "same_version",
            Err(_) => "update",
        },
        // An unparseable incoming version can't beat a real one.
        Err(_) => "downgrade",
    };
    classification.to_string()
}

/// Unique enough that two imports never collide: never equal to a name
/// already on disk, not globally random. The pid guards against a second
/// process reusing a clock tick this one already spent.
fn staging_name() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{seq:x}-{:x}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::manifest;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A scratch directory unique to one test — never the real themes root.
    fn scratch(tag: &str) -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let seq = N.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tetra-theme-archive-{tag}-{nanos}-{seq}"));
        std::fs::create_dir_all(&dir).expect("could not create scratch dir");
        dir
    }

    /// Passes every gate, so a test only varies the field it's about.
    fn manifest() -> ThemeManifest {
        ThemeManifest {
            id: "aurora.test".to_string(),
            name: "Aurora".to_string(),
            author: "tester".to_string(),
            version: "1.0.0".to_string(),
            theme_api: SUPPORTED_THEME_API_RANGE.to_string(),
            minimum_launcher_version: "1.0.0".to_string(),
            tier: SUPPORTED_TIER.to_string(),
            description: "A test theme.".to_string(),
            capabilities: vec!["tokens".to_string()],
            ..ThemeManifest::default()
        }
    }

    fn tokens_json() -> String {
        serde_json::json!({
            "schemaVersion": manifest::SCHEMA_VERSION,
            "dark": { "bg": "#101014" },
            "light": { "bg": "#f5f5f7" },
        })
        .to_string()
    }

    /// One entry for the writer below; a symlink needs `add_symlink`, so it's its own case.
    enum Entry {
        File(String, String),
        Symlink(String, String),
    }

    impl Entry {
        fn file(name: impl Into<String>, body: impl Into<String>) -> Self {
            Self::File(name.into(), body.into())
        }

        fn symlink(name: impl Into<String>, target: impl Into<String>) -> Self {
            Self::Symlink(name.into(), target.into())
        }
    }

    /// Built in-test with the `zip` crate's own writer — never a checked-in binary fixture.
    fn build_zip(path: &Path, entries: &[Entry]) {
        let file = std::fs::File::create(path).expect("could not create fixture zip");
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for entry in entries {
            match entry {
                Entry::File(name, body) => {
                    writer
                        .start_file(name, options)
                        .expect("could not start file");
                    writer
                        .write_all(body.as_bytes())
                        .expect("could not write file body");
                }
                Entry::Symlink(name, target) => {
                    writer
                        .add_symlink(name, target, options)
                        .expect("could not add symlink");
                }
            }
        }
        writer.finish().expect("could not finish fixture zip");
    }

    /// A valid two-file package, plus any extra entries a test adds.
    fn fixture(themes_root: &Path, tag: &str, extra: &[Entry]) -> PathBuf {
        let zip_path = themes_root.join(format!("{tag}.zip"));
        let mut entries = vec![
            Entry::file(MANIFEST_FILE, serde_json::to_string(&manifest()).unwrap()),
            Entry::file(TOKENS_FILE, tokens_json()),
        ];
        entries.extend(
            extra
                .iter()
                .map(|e| match e {
                    Entry::File(name, body) => Entry::file(name.clone(), body.clone()),
                    Entry::Symlink(name, target) => Entry::symlink(name.clone(), target.clone()),
                })
                .collect::<Vec<_>>(),
        );
        build_zip(&zip_path, &entries);
        zip_path
    }

    /// A package whose manifest is `manifest` verbatim, so a test can vary one
    /// field of an otherwise valid theme.
    fn fixture_with_manifest(themes_root: &Path, tag: &str, manifest: &ThemeManifest) -> PathBuf {
        let zip_path = themes_root.join(format!("{tag}.zip"));
        build_zip(
            &zip_path,
            &[
                Entry::file(MANIFEST_FILE, serde_json::to_string(manifest).unwrap()),
                Entry::file(TOKENS_FILE, tokens_json()),
            ],
        );
        zip_path
    }

    fn summary(id: &str, version: &str) -> ThemeSummary {
        ThemeSummary {
            id: id.to_string(),
            name: "Installed".to_string(),
            author: "tester".to_string(),
            version: version.to_string(),
            theme_api: SUPPORTED_THEME_API_RANGE.to_string(),
            minimum_launcher_version: "1.0.0".to_string(),
            tier: SUPPORTED_TIER.to_string(),
            description: String::new(),
            preview: None,
            tags: Vec::new(),
            capabilities: Vec::new(),
        }
    }

    /// The staging directory a preview points at, and whether it survived.
    fn staging_dir(themes_root: &Path, preview: &ThemeImportPreview) -> PathBuf {
        themes_root.join(STAGING_DIR).join(&preview.staging_id)
    }

    #[test]
    fn a_valid_two_file_package_is_staged_and_reported() {
        let root = scratch("valid");
        let zip_path = fixture(&root, "valid", &[]);

        let preview = stage_for_preview(&root, &zip_path, &[]).expect("a valid package must stage");

        assert_eq!(preview.manifest.id, "aurora.test");
        assert_eq!(preview.file_count, 2);
        assert_eq!(preview.classification, "new");
        assert_eq!(
            preview.package_size_bytes,
            std::fs::metadata(&zip_path).unwrap().len()
        );
        let dir = staging_dir(&root, &preview);
        assert!(dir.join(MANIFEST_FILE).is_file());
        assert!(dir.join(TOKENS_FILE).is_file());

        // The wire field names, so a `rename_all` slip doesn't surface as `undefined` in the dialog.
        let json = serde_json::to_value(&preview).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        let mut expected = [
            "stagingId",
            "manifest",
            "packageSizeBytes",
            "fileCount",
            "classification",
        ];
        expected.sort_unstable();
        assert_eq!(keys, expected);
    }

    #[test]
    fn a_staged_package_classifies_by_version_against_installed_themes() {
        let root = scratch("classify");
        let installed = [summary("aurora.test", "1.0.0")];

        let same = manifest();
        let preview = stage_for_preview(
            &root,
            &fixture_with_manifest(&root, "same", &same),
            &installed,
        )
        .unwrap();
        assert_eq!(preview.classification, "same_version");

        let mut newer = manifest();
        newer.version = "1.10.0".to_string();
        let preview = stage_for_preview(
            &root,
            &fixture_with_manifest(&root, "newer", &newer),
            &installed,
        )
        .unwrap();
        // Lexically "1.10.0" < "1.0.0"; as versions it is an update.
        assert_eq!(preview.classification, "update");

        let mut older = manifest();
        older.version = "0.9.0".to_string();
        let preview = stage_for_preview(
            &root,
            &fixture_with_manifest(&root, "older", &older),
            &installed,
        )
        .unwrap();
        assert_eq!(preview.classification, "downgrade");

        // A different id is a new theme no matter what it is called.
        let mut renamed = manifest();
        renamed.id = "other.theme".to_string();
        renamed.version = "0.0.1".to_string();
        let preview = stage_for_preview(
            &root,
            &fixture_with_manifest(&root, "renamed", &renamed),
            &installed,
        )
        .unwrap();
        assert_eq!(preview.classification, "new");
    }

    #[test]
    fn a_zip_slip_path_is_refused_and_leaves_nothing_behind() {
        let root = scratch("slip");
        let zip_path = fixture(&root, "slip", &[Entry::file("../../escaped.json", "{}")]);

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("../../escaped.json"), "message was: {error}");
        assert!(!root.join(STAGING_DIR).read_dir().unwrap().next().is_some());
        assert!(!root.parent().unwrap().join("escaped.json").exists());
    }

    #[test]
    fn a_symlink_entry_is_refused() {
        let root = scratch("symlink");
        let zip_path = fixture(
            &root,
            "symlink",
            &[Entry::symlink("link.json", "/etc/passwd")],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("symbolic link"), "message was: {error}");
    }

    #[test]
    fn too_many_files_is_refused() {
        let root = scratch("count");
        // One over the limit: the ceiling is a limit, not a suggestion.
        let extras: Vec<Entry> = (0..MAX_FILES)
            .map(|n| Entry::file(format!("extra-{n}.json"), "{}"))
            .collect();
        let zip_path = fixture(&root, "count", &extras);

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("more than 20 files"), "message was: {error}");
    }

    #[test]
    fn a_package_over_the_uncompressed_ceiling_is_refused_despite_a_small_compressed_size() {
        let root = scratch("bomb");
        // Highly compressible: the archive is tiny, the content is not. The
        // limit must follow the decompressed bytes, not the file size.
        let bomb = "a".repeat(MAX_TOTAL_UNCOMPRESSED_BYTES as usize + 1);
        let zip_path = fixture(&root, "bomb", &[Entry::file("big.json", bomb)]);
        let compressed = std::fs::metadata(&zip_path).unwrap().len();
        assert!(
            compressed < MAX_TOTAL_UNCOMPRESSED_BYTES / 100,
            "the fixture must actually compress, was {compressed} bytes"
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(
            error.contains("expands to more than 2 MB"),
            "message was: {error}"
        );
    }

    #[test]
    fn a_package_nested_deeper_than_the_limit_is_refused() {
        let root = scratch("depth");
        let zip_path = fixture(&root, "depth", &[Entry::file("a/b/c/d/deep.json", "{}")]);

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(
            error.contains("nested 4 levels deep"),
            "message was: {error}"
        );
    }

    #[test]
    fn a_nested_json_file_within_the_depth_limit_is_staged() {
        let root = scratch("nested");
        let zip_path = fixture(&root, "nested", &[Entry::file("meta/extra.json", "{}")]);

        let preview = stage_for_preview(&root, &zip_path, &[]).expect("nested json must stage");

        assert_eq!(preview.file_count, 3);
        assert!(staging_dir(&root, &preview)
            .join("meta/extra.json")
            .is_file());
    }

    #[test]
    fn a_non_json_file_is_refused() {
        let root = scratch("extension");
        let zip_path = fixture(&root, "extension", &[Entry::file("notes.txt", "hi")]);

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("notes.txt"), "message was: {error}");
        assert!(error.contains(".json"), "message was: {error}");
    }

    #[test]
    fn a_full_tier_theme_is_refused_with_the_newer_launcher_message() {
        let root = scratch("tier");
        let mut advanced = manifest();
        advanced.tier = "advanced".to_string();
        let zip_path = fixture_with_manifest(&root, "tier", &advanced);

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(
            error.contains("newer Tetra Launcher"),
            "message was: {error}"
        );
    }

    #[test]
    fn an_unknown_theme_api_is_refused() {
        let root = scratch("api");
        let mut future = manifest();
        future.theme_api = "2.0".to_string();
        let zip_path = fixture_with_manifest(&root, "api", &future);

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("theme API 2.0"), "message was: {error}");
    }

    #[test]
    fn a_minimum_launcher_version_ahead_of_this_build_is_refused() {
        let root = scratch("minver");
        let running = semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
        let mut future = manifest();
        future.minimum_launcher_version = format!("{}.0.0", running.major + 1);
        let zip_path = fixture_with_manifest(&root, "minver", &future);

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("or newer"), "message was: {error}");
    }

    #[test]
    fn a_package_with_no_manifest_is_refused() {
        let root = scratch("nomanifest");
        let zip_path = root.join("nomanifest.zip");
        build_zip(&zip_path, &[Entry::file(TOKENS_FILE, tokens_json())]);

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains(MANIFEST_FILE), "message was: {error}");
    }

    #[test]
    fn a_package_with_no_palette_is_refused() {
        let root = scratch("nopalette");
        let zip_path = root.join("nopalette.zip");
        build_zip(
            &zip_path,
            &[Entry::file(
                MANIFEST_FILE,
                serde_json::to_string(&manifest()).unwrap(),
            )],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains(TOKENS_FILE), "message was: {error}");
    }

    #[test]
    fn a_palette_that_is_not_a_token_object_is_refused() {
        let root = scratch("badtokens");
        let zip_path = root.join("badtokens.zip");
        build_zip(
            &zip_path,
            &[
                Entry::file(MANIFEST_FILE, serde_json::to_string(&manifest()).unwrap()),
                // Valid JSON, no `schemaVersion` — the same rule an installed
                // theme's palette is held to.
                Entry::file(TOKENS_FILE, r#"{"dark":{}}"#),
            ],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("schemaVersion"), "message was: {error}");
    }

    #[test]
    fn a_manifest_that_is_not_json_is_refused() {
        let root = scratch("badmanifest");
        let zip_path = root.join("badmanifest.zip");
        build_zip(
            &zip_path,
            &[
                Entry::file(MANIFEST_FILE, "{ not json"),
                Entry::file(TOKENS_FILE, tokens_json()),
            ],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(
            error.contains("not a valid manifest"),
            "message was: {error}"
        );
    }

    #[test]
    fn a_file_that_is_not_a_zip_is_refused_before_staging() {
        let root = scratch("notzip");
        let zip_path = root.join("theme.zip");
        std::fs::write(&zip_path, b"definitely not a zip").unwrap();

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(
            error.contains("not a readable theme package"),
            "message was: {error}"
        );
        assert!(
            !root.join(STAGING_DIR).exists(),
            "nothing should have been staged"
        );
    }

    #[test]
    fn a_manifest_id_that_cannot_name_a_directory_is_refused() {
        let root = scratch("badid");
        let mut traversal = manifest();
        traversal.id = "../../evil".to_string();
        let zip_path = fixture_with_manifest(&root, "badid", &traversal);

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(
            error.contains("not a usable theme id"),
            "message was: {error}"
        );
    }

    #[test]
    fn staging_does_not_disturb_the_installed_themes_scan() {
        let root = scratch("scansafe");
        // `.staging` lives inside the themes root, so `theme::scan` walks into
        // it — a staged-but-unconfirmed theme must not show up as installed.
        crate::theme::save(
            &root,
            &ThemeManifest {
                id: "installed.theme".to_string(),
                ..manifest()
            },
            &serde_json::json!({ "schemaVersion": manifest::SCHEMA_VERSION }),
        )
        .unwrap();
        let zip_path = fixture_with_manifest(&root, "scansafe", &manifest());

        let preview = stage_for_preview(&root, &zip_path, &[]).unwrap();
        let scan = crate::theme::scan(&root);

        assert!(staging_dir(&root, &preview).is_dir());
        assert_eq!(
            scan.themes
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["installed.theme"]
        );
        // `.staging` is dot-prefixed, so scan ignores it silently rather than logging a skip.
        assert!(scan.skipped.is_empty(), "scan skipped: {:?}", scan.skipped);
    }

    #[test]
    fn two_imports_of_the_same_package_do_not_share_a_staging_directory() {
        let root = scratch("unique");
        let zip_path = fixture(&root, "unique", &[]);

        let first = stage_for_preview(&root, &zip_path, &[]).unwrap();
        let second = stage_for_preview(&root, &zip_path, &[]).unwrap();

        assert_ne!(first.staging_id, second.staging_id);
        assert!(staging_dir(&root, &first).is_dir());
        assert!(staging_dir(&root, &second).is_dir());
    }

    #[test]
    fn confirming_a_fresh_import_installs_it_and_clears_the_staging_directory() {
        let root = scratch("confirm-new");
        let zip_path = fixture(&root, "confirm-new", &[]);
        let preview = stage_for_preview(&root, &zip_path, &[]).unwrap();

        let id = confirm_theme_install(&root, &preview.staging_id).unwrap();

        assert_eq!(id, "aurora.test");
        assert!(!staging_dir(&root, &preview).exists());
        let installed = crate::theme::get(&root, &id).expect("the theme must be readable");
        assert_eq!(installed.manifest.id, "aurora.test");
        assert_eq!(installed.manifest.version, "1.0.0");
    }

    #[test]
    fn confirming_an_update_replaces_the_installed_theme_and_leaves_no_staging_leftovers() {
        let root = scratch("confirm-update");
        let installed = ThemeManifest {
            version: "1.0.0".to_string(),
            name: "Old Aurora".to_string(),
            ..manifest()
        };
        crate::theme::save(
            &root,
            &installed,
            &serde_json::json!({ "schemaVersion": manifest::SCHEMA_VERSION, "dark": { "bg": "#000000" } }),
        )
        .unwrap();

        let replacement = ThemeManifest {
            version: "2.0.0".to_string(),
            name: "New Aurora".to_string(),
            ..manifest()
        };
        let zip_path = fixture_with_manifest(&root, "confirm-update", &replacement);
        let preview = stage_for_preview(&root, &zip_path, &[]).unwrap();

        let id = confirm_theme_install(&root, &preview.staging_id).unwrap();

        assert_eq!(id, "aurora.test");
        let installed = crate::theme::get(&root, &id).expect("the replaced theme must be readable");
        assert_eq!(installed.manifest.name, "New Aurora");
        assert_eq!(installed.manifest.version, "2.0.0");
        // The aside directory was the old install; nothing, old or new, is left
        // under the staging root.
        let leftovers: Vec<_> = std::fs::read_dir(root.join(STAGING_DIR))
            .map(|entries| entries.flatten().map(|e| e.file_name()).collect())
            .unwrap_or_default();
        assert!(leftovers.is_empty(), "staging leftovers: {leftovers:?}");
    }

    #[test]
    fn an_install_that_cannot_move_the_old_theme_aside_leaves_it_installed() {
        let root = scratch("confirm-swap");
        crate::theme::save(
            &root,
            &ThemeManifest {
                version: "1.0.0".to_string(),
                name: "Old Aurora".to_string(),
                ..manifest()
            },
            &serde_json::json!({ "schemaVersion": manifest::SCHEMA_VERSION }),
        )
        .unwrap();
        let replacement = ThemeManifest {
            version: "2.0.0".to_string(),
            ..manifest()
        };
        let zip_path = fixture_with_manifest(&root, "confirm-swap", &replacement);
        let preview = stage_for_preview(&root, &zip_path, &[]).unwrap();
        // Occupy the aside path so the swap cannot even start.
        std::fs::write(
            root.join(STAGING_DIR)
                .join(format!("aurora.test.replaced-{}", preview.staging_id)),
            b"occupied",
        )
        .unwrap();

        let error = confirm_theme_install(&root, &preview.staging_id).unwrap_err();

        assert!(error.contains("aside"), "message was: {error}");
        let installed =
            crate::theme::get(&root, "aurora.test").expect("the old theme must survive");
        assert_eq!(installed.manifest.name, "Old Aurora");
        // The staged import is untouched too, so the same preview can be confirmed again.
        assert!(staging_dir(&root, &preview).is_dir());
    }

    #[test]
    fn confirming_an_unknown_staging_id_errors_and_touches_nothing() {
        let root = scratch("confirm-unknown");
        crate::theme::save(
            &root,
            &ThemeManifest {
                id: "installed.theme".to_string(),
                ..manifest()
            },
            &serde_json::json!({ "schemaVersion": manifest::SCHEMA_VERSION }),
        )
        .unwrap();
        let before = std::fs::read_dir(&root).unwrap().count();

        let error = confirm_theme_install(&root, "no-such-staging-id").unwrap_err();

        assert!(error.contains("no-such-staging-id"), "message was: {error}");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), before);
        assert!(crate::theme::get(&root, "installed.theme").is_ok());
        assert!(!root.join("aurora.test").exists());
    }
}
