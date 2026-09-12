//! Importing a theme `.zip`: everything between "the user picked a file" and
//! "a validated theme is waiting in a staging directory".
//!
//! [Staging](stage_for_preview) never writes into the themes directory itself.
//! It unpacks a package into `themes/.staging/<id>` and reports what it found,
//! so the confirmation step that follows can install from a layout it already
//! trusts, and an importer that closes the dialog leaves nothing behind but a
//! staging directory the next import overwrites.
//!
//! An accepted archive is still hostile input: every limit here is enforced
//! while streaming, before the entry is written, and the checks run cheap-first
//! — a truncated file is rejected before a single byte is extracted. Like
//! [`crate::theme`], every failure is a message to show the user, never a panic.

use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

use crate::theme::{ThemeManifest, ThemeSummary, MANIFEST_FILE, TOKENS_FILE};

/// The token API this build understands. A package written against any other
/// one is refused rather than guessed at.
///
/// Exact equality today because `"1.0"` is the only API version there has ever
/// been. When a second one exists this becomes a range check (a package on
/// `"1.1"` should still load on a launcher that speaks `"1.0"`), which is why
/// the name says range rather than version.
pub const SUPPORTED_THEME_API_RANGE: &str = "1.0";

/// The only tier this build can honour. `full` and anything a later build
/// invents name launcher features that are not here.
const SUPPORTED_TIER: &str = "basic";

/// Packages hold a manifest and a palette. The ceiling is headroom above that,
/// not a target — it exists so a themed asset pack someone zipped by accident
/// fails here with a size message instead of mid-extraction.
const MAX_FILES: usize = 20;

/// Uncompressed, summed across entries. A theme's `tokens.json` is a few kB;
/// this is generous for two JSON files and small enough that a zip bomb is
/// refused before it can fill a disk.
const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024;

/// Path separators an entry name may contain. Three levels is
/// `preview/dark/…`, already more nesting than a theme ships.
const MAX_PATH_DEPTH: usize = 3;

/// The directory name imports are staged under, inside the themes root.
const STAGING_DIR: &str = ".staging";

/// What a validated package would install, for the confirmation dialog.
///
/// `staging_id` is the handle a later `confirm_theme_install` uses to find the
/// extracted files: the directory [`stage_for_preview`] left at
/// `themes/.staging/<staging_id>`. The rest is what the dialog shows and what
/// the install step will write, already parsed here so neither has to reopen
/// the archive.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeImportPreview {
    /// Name of the staging directory holding the extracted package.
    pub staging_id: String,
    /// The package's manifest, validated against this build.
    pub manifest: ThemeManifest,
    /// Compressed size of the package the user picked.
    pub package_size_bytes: u64,
    /// Files extracted from it — the manifest, the palette, and any artwork.
    pub file_count: usize,
    /// What installing would do to the installed themes, so the dialog can say
    /// "Update to 1.2.0" rather than "Install". One of `"new"`, `"update"`,
    /// `"same_version"` or `"downgrade"`.
    pub classification: String,
}

/// What installing does when no installed theme shares the package's id.
const CLASSIFICATION_NEW: &str = "new";

/// Unpack `zip_path` into `themes/.staging/<id>` and report what it holds.
///
/// `installed` is the caller's [`crate::theme::scan`] result, passed in rather
/// than re-scanned so this stays a pure function of its arguments and is
/// testable with no installed-themes directory at all.
///
/// On success the staging directory stays put for the install step to consume.
/// On the first failed check it is removed and the caller gets [`Err`] — the
/// message is written to be shown to the user as-is.
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
    // (1) A file that isn't a zip at all, or is truncated, fails here — before
    // any staging directory exists to clean up.
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

/// The checks themselves, split out so [`stage_for_preview`] owns exactly one
/// cleanup path: every `Err` from here discards the staging directory.
///
/// The order is deliberate — limits and the zip-slip guard are answered from
/// the central directory, so a malicious archive is refused before it can
/// inflate; the manifest's semantics are only examined once its bytes exist.
fn inspect<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    staging_dir: &Path,
) -> Result<(ThemeManifest, usize), String> {
    // Canonicalised once here: the zip-slip guard compares a resolved output
    // path against it, and `staging_dir` was just created, so on Windows the
    // resolved form (`\\?\C:\…`) is what the comparison needs.
    let staging_root = staging_dir
        .canonicalize()
        .map_err(|e| format!("Could not resolve {}: {e}", staging_dir.display()))?;

    let mut extracted = 0usize;
    // Actual bytes decompressed, never `ZipFile::size()` — that field is the
    // archive's own claim. A crafted archive can declare a small size and then
    // stream gigabytes, so the limit has to be enforced against what is read.
    let mut total_bytes = 0u64;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Could not read entry {index} of the package: {e}"))?;
        let name = entry.name().to_string();

        // (2) Limits, before an entry is written: one archive past any of
        // these is refused whole, not partially unpacked.
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
        // Declared sizes are refused early too, but only as a cheap hint — the
        // streaming sum below is what actually enforces the limit.
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

        // (3) Zip-slip, for *every* entry including directories: a name that
        // would resolve outside the staging directory is refused without being
        // written, symlinks included — an extracted symlink is a path out of
        // the package by another route. This runs before the directory skip
        // below so a `../` directory cannot create a directory outside staging
        // and have the next entry "legitimately" write into it.
        let output = safe_output_path(&staging_root, &name, &entry)?;

        // Directories carry no content and, importantly, no extension: they
        // are skipped rather than run through the allow-list below, since a
        // package may legitimately hold a `preview/` directory. The path was
        // still vetted just above.
        if entry.is_dir() {
            continue;
        }

        // (4) A package's files are JSON. Extension is checked against the
        // full name on purpose: `tokens.json/…` and `tokens.json.exe` alike
        // fail, and there is no "close enough" here to slip past.
        if !name.ends_with(".json") {
            return Err(format!(
                "`{name}` is not a `.json` file — a theme package holds only `theme.json` and `tokens.json`."
            ));
        }

        write_entry(&mut entry, &output, &mut total_bytes)?;
        extracted += 1;
    }

    // (5) The manifest: present, JSON, and a manifest.
    let manifest_path = staging_dir.join(MANIFEST_FILE);
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|_| format!("This package has no {MANIFEST_FILE} — it is not a Tetra theme."))?;
    let parsed: ThemeManifest = serde_json::from_str(&raw)
        .map_err(|e| format!("{MANIFEST_FILE} is not a valid manifest: {e}"))?;

    // The three compatibility gates, cheapest first, all before `tokens.json`
    // is even read. Each names what the user can do about it, since the fix is
    // on the theme's side, not theirs.
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

    // (6) The palette, by the same rules an installed theme's is held to.
    let tokens_path = staging_dir.join(TOKENS_FILE);
    let raw = std::fs::read_to_string(&tokens_path)
        .map_err(|_| format!("This package has no {TOKENS_FILE} — it is not a Tetra theme."))?;
    let tokens: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("{TOKENS_FILE} is not valid JSON: {e}"))?;
    crate::theme::validate_tokens(&tokens)?;

    // Last, and after everything else has passed: an id only matters once the
    // theme is acceptable, and it becomes a directory name on install.
    if !crate::theme::is_usable_id(&parsed.id) {
        return Err(format!(
            "This package declares id `{}`, which is not a usable theme id.",
            parsed.id
        ));
    }

    Ok((parsed, extracted))
}

/// Resolve one entry's output path inside `staging_root`, or refuse the entry.
///
/// The three refusals are the ways an entry name escapes: a literal `..`
/// segment, an absolute path (which `Path::join` would discard the staging
/// directory for), and a symlink (whose *content* is a path elsewhere, which
/// the install step would then follow). After that, the canonicalised parent
/// is checked to still be under `staging_root` — belt and braces against a
/// name that is none of those but resolves out anyway.
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
    // The parent is created before the check because canonicalising it is what
    // proves the join stayed inside — and a `None` here means the name's parent
    // is not a directory, which the write below would fail on regardless.
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
    // Chunked rather than `io::copy` so the running total is checked as it
    // grows: `io::copy` would happily stream the whole bomb before returning.
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
    // One byte past the buffer: an archive that lies about its size would
    // otherwise leave a silently truncated file that still parses.
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

/// Refuse a manifest that needs a launcher newer than this build.
///
/// Both sides are real versions rather than strings, because `"2.6.0" > "2.10.0"`
/// lexically and the comparison here decides whether a theme loads at all. A
/// manifest whose version does not parse is refused rather than skipped: it
/// cannot be shown to be compatible, and installing it would fail at load.
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

/// What installing `manifest` would do to `installed`.
///
/// Whichever installed theme shares the id decides the comparison — an update
/// that skips a version is still an update, and a re-import of the same number
/// is called out separately so the dialog can warn before replacing a theme
/// the user already has. An installed theme whose version does not parse is
/// treated as older: its `version` is not a fact anyone can act on.
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
        // Unparseable incoming version: it cannot beat a real one, and
        // "same_version" would be a claim about two things, neither of which
        // is a version.
        Err(_) => "downgrade",
    };
    classification.to_string()
}

/// A staging directory name, unique enough that two imports in the same
/// process — or two launchers sharing a data root — cannot collide.
///
/// `paths.rs` and `theme`'s tests use the clock for the same reason: unique
/// here means "never equal to a name already on disk", not globally random.
/// The counter covers imports landing within one clock tick, which is the case
/// a tests' loop hits, and carries the pid so a second process cannot reuse a
/// tick this one already spent.
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

    /// A scratch directory unique to one test, the way `paths.rs` does it (no
    /// `tempfile` dependency) — never the real themes root.
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

    /// A manifest that passes every gate, so a test only varies the field it
    /// is about.
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

    /// One entry for the writer below. A symlink is not a file's business —
    /// `add_symlink` writes it — so it is its own case rather than a
    /// `ZipEntry` variant.
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

    /// Build a package in-test with the `zip` crate's own writer, so a fixture
    /// is never a checked-in binary that could rot or be edited by hand.
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

        // The field names the frontend dialog will read. Checked here because
        // `rename_all` is one attribute away from `staging_id`, which no other
        // assertion would notice until the dialog saw `undefined`. Sorted,
        // because `serde_json` without `preserve_order` emits keys in
        // alphabetical order rather than declaration order.
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
        // `.staging` lives inside the themes root (the layout this task
        // specifies), so `theme::scan` walks into it — and a staged package
        // carries a valid `theme.json`, so what must hold is that a
        // previewed-but-unconfirmed theme is not *installed*.
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
        // Held because `staging_id` has no `theme.json` at the top level of
        // `.staging`: were a later change to flatten the files up a level, this
        // is what catches a staged theme leaking into the grid as installed.
        assert_eq!(
            scan.themes
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["installed.theme"]
        );
        // The staging root itself is the one directory scan must report: it is
        // not a theme, and `scan` deliberately reports rather than silently
        // ignores a directory it cannot read (see `theme::scan`). Pinned so a
        // second unknown directory in `skipped` is a failure, not new noise.
        assert_eq!(scan.skipped.len(), 1, "scan skipped: {:?}", scan.skipped);
        assert!(
            scan.skipped[0].contains(STAGING_DIR),
            "scan skipped: {:?}",
            scan.skipped
        );
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
}
