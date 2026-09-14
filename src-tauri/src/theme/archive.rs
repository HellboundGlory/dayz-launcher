//! Importing a theme `.zip`: [`stage_for_preview`] unpacks into
//! `themes/.staging/<id>` (never the live themes directory) and reports what
//! it found. Every limit is enforced while streaming, cheapest checks first,
//! before an entry is written — this is still hostile input. Anything a theme
//! carries besides its two JSON files is then content-sniffed: the extension
//! only picks the decoder, the bytes have to prove they are that format.
//!
//! [`export`] goes the other way: repackages an installed theme into the same
//! files an import accepts, and refuses to ship one naming this machine's own
//! data folder.

use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

use crate::theme::{
    components_slot, ThemeManifest, ThemeSummary, COMPONENTS_DIR, LAYOUT_FILE, MANIFEST_FILE,
    SETTINGS_SCHEMA_FILE, STYLES_FILE, TOKENS_FILE,
};
use quick_xml::events::Event;

/// Exact match today since `"1.0"` is the only version so far; becomes a
/// range check once a second one exists (hence the name).
pub const SUPPORTED_THEME_API_RANGE: &str = "1.0";

/// The tiers this build can load.
const SUPPORTED_TIERS: [&str; 3] = ["basic", "advanced", "expert"];

/// Headroom above a manifest+palette, not a target — big enough for a real
/// theme, small enough to reject an accidental asset pack cleanly.
const MAX_FILES: usize = 20;

/// Uncompressed, summed across entries — generous for two JSON files, small
/// enough to refuse a zip bomb before it fills a disk.
const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024;

/// `preview/dark/…` is already deeper nesting than a theme ships.
const MAX_PATH_DEPTH: usize = 3;

/// Everything a theme package may carry. This widens what an import accepts,
/// not what it trusts: each extension below is content-sniffed in
/// [`sniff_asset`], and an extension outside this list still fails the whole
/// package. `.json` is the manifest and the palette, `.txt`/`.md` plain notes.
const ALLOWED_EXTENSIONS: [&str; 13] = [
    "json", "css", "png", "webp", "jpg", "jpeg", "svg", "woff2", "woff", "ttf", "otf", "txt", "md",
];

/// The two extension families an advanced-tier theme must declare a
/// capability for; every member is also in [`ALLOWED_EXTENSIONS`].
const FONT_EXTENSIONS: [&str; 4] = ["woff2", "woff", "ttf", "otf"];
const IMAGE_EXTENSIONS: [&str; 5] = ["png", "webp", "jpg", "jpeg", "svg"];

/// A theme image is chrome: a 4096 square is already a full-screen backdrop.
/// Checked against the header before any pixel buffer is allocated.
const MAX_IMAGE_DIMENSION: u32 = 4096;

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
    // The id comes from the frontend and names one directory under `.staging`;
    // anything else would let it resolve outside the themes root.
    if !crate::theme::is_usable_id(staging_id) {
        return Err(format!(
            "`{staging_id}` is not a usable staging id — it must be a single directory name"
        ));
    }
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
                "This package holds more than {MAX_FILES} files — a theme is a manifest, a palette and its assets."
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
        let Some(extension) = allowed_extension(&name) else {
            return Err(format!(
                "`{name}` is not a file a theme package may hold — allowed are {ALLOWED_EXTENSIONS:?}."
            ));
        };

        // Read into memory rather than straight to disk: an asset has to be
        // sniffed before it is staged, and a theme asset is bounded by the
        // uncompressed ceiling this loop already enforces.
        let bytes = read_entry(&mut entry, &name, &mut total_bytes)?;
        sniff_asset(&name, extension, &bytes)?;
        std::fs::write(&output, &bytes)
            .map_err(|e| format!("Could not write {}: {e}", output.display()))?;
        extracted += 1;
    }

    let manifest_path = staging_dir.join(MANIFEST_FILE);
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|_| format!("This package has no {MANIFEST_FILE} — it is not a Tetra theme."))?;
    let parsed: ThemeManifest = serde_json::from_str(&raw)
        .map_err(|e| format!("{MANIFEST_FILE} is not a valid manifest: {e}"))?;

    // Three compatibility gates, cheapest first, before tokens.json is even read.
    if !SUPPORTED_TIERS.contains(&parsed.tier.as_str()) {
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

    // A layout is optional in a package just as it is in an installed theme.
    let layout_path = staging_dir.join(LAYOUT_FILE);
    if layout_path.exists() {
        let raw = std::fs::read_to_string(&layout_path)
            .map_err(|e| format!("Could not read {}: {e}", layout_path.display()))?;
        let layout: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("{LAYOUT_FILE} is not valid JSON: {e}"))?;
        crate::theme::validate_layout(&layout)?;
    }

    // Checked once the content exists on disk: an advanced package's manifest
    // must declare what it ships.
    missing_capabilities(&parsed, staging_dir)?;

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

/// Read one entry into memory, counting the bytes actually read so the size
/// ceiling cannot be bypassed by a lying header. Nothing reaches the staging
/// directory until the content has been sniffed, which needs the whole file.
fn read_entry(
    entry: &mut zip::read::ZipFile<'_>,
    name: &str,
    total_bytes: &mut u64,
) -> Result<Vec<u8>, String> {
    // The declared size is an upper bound only, and the caller already refused
    // anything above the ceiling — this is just so the common case allocates once.
    let mut bytes = Vec::with_capacity(usize::try_from(entry.size()).unwrap_or(0));
    // Chunked, not read_to_end, so the running total is checked as it grows rather than after the fact.
    let mut buffer = [0u8; 16 * 1024];
    let mut tail = [0u8; 1];
    loop {
        let read = entry
            .read(&mut buffer)
            .map_err(|e| format!("Could not read `{name}` from the package: {e}"))?;
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
        bytes.extend_from_slice(&buffer[..read]);
    }
    // One byte past what was declared, to catch a size that lied short.
    if entry
        .read(&mut tail)
        .map_err(|e| format!("Could not read `{name}` from the package: {e}"))?
        != 0
    {
        return Err(format!("`{name}` is longer than the package declares."));
    }
    Ok(bytes)
}

/// The entry's extension in the allow-list, or `None` if it has none or an
/// unlisted one. Compared case-insensitively, so `LOGO.PNG` is `logo.png`.
fn allowed_extension(name: &str) -> Option<&'static str> {
    let extension = Path::new(name).extension()?.to_str()?;
    ALLOWED_EXTENSIONS
        .into_iter()
        .find(|allowed| allowed.eq_ignore_ascii_case(extension))
}

/// Prove the bytes are what the extension claims they are, before they are
/// staged. A theme is shared between machines, so the extension is a claim by
/// the author and the content is the evidence.
fn sniff_asset(name: &str, extension: &str, bytes: &[u8]) -> Result<(), String> {
    match extension {
        // The manifest and the palette are parsed as JSON further down; a
        // nested `.json` has no schema of its own to check against.
        "json" | "txt" | "md" => Ok(()),
        "css" => sniff_css(name, bytes),
        "png" | "webp" | "jpg" | "jpeg" => sniff_raster_image(name, extension, bytes),
        "woff2" | "woff" | "ttf" | "otf" => sniff_font(name, extension, bytes),
        "svg" => sniff_svg(name, bytes),
        // Unreachable: the extension came from `allowed_extension`.
        other => Err(format!("`{name}` has unhandled extension `.{other}`.")),
    }
}

/// Decode with the `image` crate — headers first, so an oversized image is
/// refused before its pixel buffer is allocated.
fn sniff_raster_image(name: &str, extension: &str, bytes: &[u8]) -> Result<(), String> {
    let expected = match extension {
        "png" => image::ImageFormat::Png,
        "webp" => image::ImageFormat::WebP,
        "jpg" | "jpeg" => image::ImageFormat::Jpeg,
        other => return Err(format!("`{name}` has unhandled extension `.{other}`.")),
    };
    // Format pinned to the extension rather than guessed, so a PNG named
    // `.jpg` fails here instead of decoding as whatever it really is.
    let dimensions = image::ImageReader::with_format(std::io::Cursor::new(bytes), expected)
        .into_dimensions()
        .map_err(|e| format!("`{name}` is not a readable {extension} image: {e}"))?;
    if dimensions.0 > MAX_IMAGE_DIMENSION || dimensions.1 > MAX_IMAGE_DIMENSION {
        return Err(format!(
            "`{name}` is {}x{}, larger than the {MAX_IMAGE_DIMENSION}x{MAX_IMAGE_DIMENSION} a theme image may be.",
            dimensions.0, dimensions.1
        ));
    }
    // Dimensions come from the header, so this is the first step that has to
    // touch pixel data — a truncated or corrupt body still fails.
    image::ImageReader::with_format(std::io::Cursor::new(bytes), expected)
        .decode()
        .map_err(|e| format!("`{name}` is not a readable {extension} image: {e}"))?;
    Ok(())
}

/// Package C's gate: a reject-list plus a `url()` check (see `theme::css`).
fn sniff_css(name: &str, bytes: &[u8]) -> Result<(), String> {
    let text =
        std::str::from_utf8(bytes).map_err(|e| format!("`{name}` is not valid UTF-8: {e}"))?;
    crate::theme::css::validate_css(text)
}

/// SVG is XML that can carry script, so it is parsed rather than pattern-matched.
/// Accepts one well-formed `<svg>` root with no `<script>` element and no `on*`
/// attribute. Only real elements and attributes are inspected — text, CDATA and
/// entity content are never expanded into markup, so escaped angle brackets
/// cannot fake either check.
fn sniff_svg(name: &str, bytes: &[u8]) -> Result<(), String> {
    let malformed = |detail: &str| format!("`{name}` is not a well-formed SVG document: {detail}");
    let text = std::str::from_utf8(bytes).map_err(|e| malformed(&e.to_string()))?;
    // A byte-order mark is legal but not part of the document body.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);

    let mut reader = quick_xml::Reader::from_str(text);
    let mut depth: usize = 0;
    let mut roots: usize = 0;
    loop {
        let event = match reader.read_event() {
            Ok(event) => event,
            Err(e) => return Err(malformed(&e.to_string())),
        };
        // Every element is inspected whichever way it was written; only a
        // `Start` leaves an element open to balance later.
        let (element, opens) = match event {
            Event::Eof => break,
            Event::Start(element) => (element, true),
            Event::Empty(element) => (element, false),
            Event::End(_) => {
                depth = depth.saturating_sub(1);
                continue;
            }
            _ => continue,
        };
        if depth == 0 {
            roots += 1;
            // The image sniff pins the format to the extension; do the same
            // here, so a non-SVG XML file named `.svg` fails too.
            if roots == 1 && !element.local_name().as_ref().eq_ignore_ascii_case(b"svg") {
                return Err(malformed("its root element is not `<svg>`"));
            }
        }
        if element
            .local_name()
            .as_ref()
            .eq_ignore_ascii_case(b"script")
        {
            return Err(format!(
                "`{name}` contains a `<script>` element; an SVG a theme ships must not carry script."
            ));
        }
        for attribute in element.attributes() {
            let attribute = attribute.map_err(|e| malformed(&e.to_string()))?;
            let key = attribute.key.local_name();
            let key = key.as_ref();
            // `onload`, `onclick`, `ONERROR` … any handler, either case.
            if key.len() >= 2
                && key[0].eq_ignore_ascii_case(&b'o')
                && key[1].eq_ignore_ascii_case(&b'n')
            {
                return Err(format!(
                    "`{name}` uses the event handler attribute `{}`; an SVG a theme ships must not carry script.",
                    String::from_utf8_lossy(key)
                ));
            }
        }
        depth += usize::from(opens);
    }
    if depth != 0 {
        return Err(malformed("it does not close every element it opens"));
    }
    if roots != 1 {
        return Err(malformed("it does not hold exactly one root element"));
    }
    Ok(())
}

/// Parse the font's real tables. `ttf-parser` reads sfnt only, so the two
/// container formats are rebuilt into an sfnt buffer first — that is also
/// where their own structure (directory, lengths, compression) gets checked.
fn sniff_font(name: &str, extension: &str, bytes: &[u8]) -> Result<(), String> {
    match extension {
        "woff" => parse_font(name, &woff_sfnt(name, bytes)?),
        "woff2" => parse_font(name, &woff2_sfnt(name, bytes)?),
        // A `.ttf`/`.otf` file *is* sfnt; `.otf` may hold either outline
        // flavour, so the extension does not pin the version — the file's own
        // magic does.
        _ => parse_font(name, bytes),
    }
}

fn parse_font(name: &str, sfnt: &[u8]) -> Result<(), String> {
    ttf_parser::Face::parse(sfnt, 0)
        .map_err(|e| format!("`{name}` is not a readable font: {e}"))?;
    Ok(())
}

/// The tags a WOFF2 table directory may name by index, from the "Known Table
/// Tags" table in the WOFF2 spec. An index of 63 means the tag is written out.
const WOFF2_KNOWN_TAGS: [&[u8; 4]; 63] = [
    b"cmap", b"head", b"hhea", b"hmtx", b"maxp", b"name", b"OS/2", b"post", b"cvt ", b"fpgm",
    b"glyf", b"loca", b"prep", b"CFF ", b"VORG", b"EBDT", b"EBLC", b"gasp", b"hdmx", b"kern",
    b"LTSH", b"PCLT", b"VDMX", b"vhea", b"vmtx", b"BASE", b"GDEF", b"GPOS", b"GSUB", b"EBSC",
    b"JSTF", b"MATH", b"CBDT", b"CBLC", b"COLR", b"CPAL", b"SVG ", b"sbix", b"acnt", b"avar",
    b"bdat", b"bloc", b"bsln", b"cvar", b"fdsc", b"feat", b"fmtx", b"fvar", b"gvar", b"hsty",
    b"just", b"lcar", b"mort", b"morx", b"opbd", b"prop", b"trak", b"Zapf", b"Silf", b"Glat",
    b"Gloc", b"Feat", b"Sill",
];

/// Rebuild the sfnt a WOFF 1.0 file wraps: one zlib stream per table, with the
/// original length recorded next to it.
fn woff_sfnt(name: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let truncated = || format!("`{name}` is missing part of its WOFF header or table directory.");
    if bytes.len() < 44 || &bytes[..4] != b"wOFF" {
        return Err(format!("`{name}` is not a WOFF font."));
    }
    let flavor = be_u32(bytes, 4).ok_or_else(truncated)?;
    let count = be_u16(bytes, 12).ok_or_else(truncated)?;
    if (bytes.len() as u64) < 44 + u64::from(count) * 20 {
        return Err(truncated());
    }

    let mut tables: Vec<([u8; 4], Vec<u8>)> = Vec::with_capacity(usize::from(count));
    let mut total = 0u64;
    for index in 0..usize::from(count) {
        let entry = 44 + index * 20;
        let tag = [
            bytes[entry],
            bytes[entry + 1],
            bytes[entry + 2],
            bytes[entry + 3],
        ];
        let offset = be_u32(bytes, entry + 4).ok_or_else(truncated)?;
        let stored = be_u32(bytes, entry + 8).ok_or_else(truncated)?;
        let original = be_u32(bytes, entry + 12).ok_or_else(truncated)?;
        if stored > original {
            return Err(format!(
                "`{name}` has a WOFF table longer compressed than raw."
            ));
        }
        total += u64::from(original);
        if total > MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(format!(
                "`{name}` expands to more than {} MB.",
                MAX_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024)
            ));
        }
        let end = usize::try_from(u64::from(offset) + u64::from(stored))
            .ok()
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| format!("`{name}` has a WOFF table past the end of the file."))?;
        let range = offset as usize..end;
        // Equal lengths is how WOFF marks a table it stored uncompressed.
        let table = if stored == original {
            bytes[range].to_vec()
        } else {
            let mut table = Vec::with_capacity(original as usize);
            flate2::read::ZlibDecoder::new(&bytes[range])
                .take(u64::from(original) + 1)
                .read_to_end(&mut table)
                .map_err(|e| format!("`{name}` has a WOFF table that will not decompress: {e}"))?;
            table
        };
        if table.len() != original as usize {
            return Err(format!(
                "`{name}` has a WOFF table that does not match its recorded length."
            ));
        }
        tables.push((tag, table));
    }
    sfnt_from_tables(name, flavor, &tables)
}

/// Rebuild the sfnt a WOFF2 file wraps: one Brotli stream covering every table.
/// Tables carrying a transform (`glyf`/`loca`, sometimes `hmtx`) are dropped
/// rather than reversed — the sniff needs the real `head`, `hhea` and `maxp`,
/// which are never transformed, and a font is not defined by its outlines.
fn woff2_sfnt(name: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let truncated = || format!("`{name}` is missing part of its WOFF2 header or table directory.");
    if bytes.len() < 48 || &bytes[..4] != b"wOF2" {
        return Err(format!("`{name}` is not a WOFF2 font."));
    }
    let flavor = be_u32(bytes, 4).ok_or_else(truncated)?;
    if flavor == u32::from_be_bytes(*b"ttcf") {
        return Err(format!(
            "`{name}` is a font collection, which a theme package may not carry."
        ));
    }
    let count = be_u16(bytes, 12).ok_or_else(truncated)?;
    let compressed = be_u32(bytes, 20).ok_or_else(truncated)?;

    // Directory entries describe the order the tables appear in the one
    // compressed stream, and how much of it each one consumes.
    let mut at = 48usize;
    let mut entries: Vec<([u8; 4], bool, usize)> = Vec::with_capacity(usize::from(count));
    let mut total = 0usize;
    for _ in 0..count {
        let flags = *bytes.get(at).ok_or_else(truncated)?;
        at += 1;
        let index = usize::from(flags & 0x3f);
        let tag = if index == 63 {
            let tag = bytes.get(at..at + 4).ok_or_else(truncated)?;
            at += 4;
            [tag[0], tag[1], tag[2], tag[3]]
        } else {
            *WOFF2_KNOWN_TAGS[index]
        };
        let version = flags >> 6;
        // Every table uses version 0 for "no transform" except the glyf/loca
        // pair, whose null transform is version 3.
        let transformed = if &tag == b"glyf" || &tag == b"loca" {
            version != 3
        } else {
            version != 0
        };
        let original = read_base128(bytes, &mut at).ok_or_else(truncated)?;
        let consumed = if transformed {
            read_base128(bytes, &mut at).ok_or_else(truncated)?
        } else {
            original
        };
        total = total
            .checked_add(usize::try_from(consumed).map_err(|_| truncated())?)
            .filter(|total| *total as u64 <= MAX_TOTAL_UNCOMPRESSED_BYTES)
            .ok_or_else(|| {
                format!(
                    "`{name}` expands to more than {} MB.",
                    MAX_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024)
                )
            })?;
        entries.push((tag, transformed, consumed as usize));
    }

    let data_end = at
        .checked_add(compressed as usize)
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| format!("`{name}` has a WOFF2 data block past the end of the file."))?;
    // Capped at the directory's own total, so a small compressed block cannot
    // decompress into an allocation far larger than the tables claim to be.
    let mut block = Vec::with_capacity(total);
    brotli::Decompressor::new(&bytes[at..data_end], 4096)
        .take(total as u64 + 1)
        .read_to_end(&mut block)
        .map_err(|e| format!("`{name}` has a WOFF2 data block that will not decompress: {e}"))?;
    if block.len() != total {
        return Err(format!(
            "`{name}` has a WOFF2 data block that does not match its table directory."
        ));
    }

    let mut tables: Vec<([u8; 4], Vec<u8>)> = Vec::with_capacity(entries.len());
    let mut cursor = 0usize;
    for (tag, transformed, consumed) in entries {
        let slice = &block[cursor..cursor + consumed];
        cursor += consumed;
        if !transformed {
            tables.push((tag, slice.to_vec()));
        }
    }
    sfnt_from_tables(name, flavor, &tables)
}

/// Lay tables out as sfnt so `ttf-parser` can read them the way it reads a
/// `.ttf`. Checksums are left zero — nothing in this path verifies them.
fn sfnt_from_tables(
    name: &str,
    flavor: u32,
    tables: &[([u8; 4], Vec<u8>)],
) -> Result<Vec<u8>, String> {
    let count = u16::try_from(tables.len())
        .map_err(|_| format!("`{name}` declares more font tables than a font can hold."))?;
    // Sorted by tag: the sfnt directory is ordered, and `ttf-parser` looks
    // entries up by tag rather than by position.
    let mut ordered: Vec<&([u8; 4], Vec<u8>)> = tables.iter().collect();
    ordered.sort_unstable_by_key(|(tag, _)| *tag);

    let mut out = Vec::with_capacity(12 + ordered.len() * 16);
    out.extend_from_slice(&flavor.to_be_bytes());
    out.extend_from_slice(&count.to_be_bytes());
    // searchRange, entrySelector and rangeShift, which readers skip.
    out.extend_from_slice(&[0u8; 6]);

    let mut offset = 12 + ordered.len() * 16;
    for (tag, table) in &ordered {
        out.extend_from_slice(tag);
        out.extend_from_slice(&0u32.to_be_bytes());
        out.extend_from_slice(&(offset as u32).to_be_bytes());
        out.extend_from_slice(&(table.len() as u32).to_be_bytes());
        offset += table.len() + (4 - table.len() % 4) % 4;
    }
    for (_, table) in &ordered {
        out.extend_from_slice(table);
        // Tables are padded to a four-byte boundary.
        out.resize(out.len() + (4 - table.len() % 4) % 4, 0);
    }
    Ok(out)
}

/// UIntBase128, the length encoding a WOFF2 table directory uses: seven bits
/// per byte, high bit set while more follow. The spec's leading-zero and
/// five-byte limits on a valid encoding are enforced here.
fn read_base128(bytes: &[u8], at: &mut usize) -> Option<u64> {
    let mut value: u64 = 0;
    for index in 0..5 {
        let byte = *bytes.get(*at)?;
        *at += 1;
        if index == 0 && byte == 0x80 {
            return None;
        }
        if value & 0xfe00_0000 != 0 {
            return None;
        }
        value = (value << 7) | u64::from(byte & 0x7f);
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

fn be_u16(bytes: &[u8], at: usize) -> Option<u16> {
    let slice = bytes.get(at..at + 2)?;
    Some(u16::from_be_bytes([slice[0], slice[1]]))
}

fn be_u32(bytes: &[u8], at: usize) -> Option<u32> {
    let slice = bytes.get(at..at + 4)?;
    Some(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// Whether `relative` is a slot composition: exactly `components/<slot id>.json`,
/// one level deep. A nested `assets/components/x.json` is an inert data file,
/// and so is anything under `components/` that is not a `.json`.
fn is_components_file(relative: &str) -> bool {
    let mut segments = relative.split('/');
    let (Some(dir), Some(name), None) = (segments.next(), segments.next(), segments.next()) else {
        return false;
    };
    dir == COMPONENTS_DIR && components_slot(name).is_some()
}

/// Refuse an `advanced` or `expert` package whose content needs a capability
/// its manifest does not declare. `basic` is exempt: a basic theme may carry
/// stray assets nothing reads, and every theme installed before this gate
/// existed is basic. Every missing capability is reported at once, not one
/// per attempt.
fn missing_capabilities(manifest: &ThemeManifest, staging_dir: &Path) -> Result<(), String> {
    if manifest.tier != "advanced" && manifest.tier != "expert" {
        return Ok(());
    }
    let declares = |capability: &str| manifest.capabilities.iter().any(|d| d == capability);

    // One trigger file per capability, in a fixed order so the message is stable.
    let mut triggers: [(&str, Option<String>); 6] = [
        ("layout", None),
        ("css", None),
        ("fonts", None),
        ("assets", None),
        ("components", None),
        ("settings", None),
    ];
    let mut stack = vec![(staging_dir.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let relative = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if entry.path().is_dir() {
                stack.push((entry.path(), relative));
                continue;
            }
            let extension = Path::new(&name)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default();
            // Only the two names the importer actually reads are root-only:
            // a nested `assets/layout.json` is an inert file, not a layout.
            let slot = if prefix.is_empty() && name == LAYOUT_FILE {
                0
            } else if prefix.is_empty() && name == STYLES_FILE {
                1
            } else if FONT_EXTENSIONS
                .iter()
                .any(|f| f.eq_ignore_ascii_case(extension))
            {
                2
            } else if IMAGE_EXTENSIONS
                .iter()
                .any(|i| i.eq_ignore_ascii_case(extension))
            {
                3
            } else if is_components_file(&relative) {
                4
            } else if prefix.is_empty() && name == SETTINGS_SCHEMA_FILE {
                5
            } else {
                continue;
            };
            triggers[slot].1.get_or_insert(relative);
        }
    }

    let mut missing = Vec::new();
    for (capability, trigger) in triggers {
        if let Some(trigger) = trigger {
            if !declares(capability) {
                missing.push(format!("`{capability}` (it has {trigger})"));
            }
        }
    }
    if missing.is_empty() {
        return Ok(());
    }
    Err(format!(
        "`{}` is an `advanced` theme that does not declare the capabilities its content needs: {}. Declare them in {MANIFEST_FILE}, or remove those files.",
        manifest.name,
        missing.join(", ")
    ))
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

/// Manifest fields an export dialog may edit before packaging. Every field is
/// optional and named as in [`ThemeManifest`]: `Some` overwrites the installed
/// value, `None` exports it unchanged.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ManifestOverrides {
    pub name: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub license: Option<String>,
    pub homepage: Option<String>,
}

impl ManifestOverrides {
    fn apply_to(&self, manifest: &mut ThemeManifest) {
        if let Some(v) = &self.name {
            manifest.name = v.clone();
        }
        if let Some(v) = &self.author {
            manifest.author = v.clone();
        }
        if let Some(v) = &self.version {
            manifest.version = v.clone();
        }
        if let Some(v) = &self.description {
            manifest.description = v.clone();
        }
        if let Some(v) = &self.tags {
            manifest.tags = v.clone();
        }
        if let Some(v) = &self.license {
            manifest.license = Some(v.clone());
        }
        if let Some(v) = &self.homepage {
            manifest.homepage = Some(v.clone());
        }
    }
}

/// Package the installed theme `id` into `dest_path` as the same files
/// [`stage_for_preview`] accepts — the portable package is the installed
/// directory, zipped, so nothing an advanced theme ships is lost on export.
/// `data_root` is this machine's own data folder; a package naming it is
/// refused rather than shipped — a theme is shared, so anything carrying a
/// local path would hand out someone's folder layout.
pub fn export(
    themes_root: &Path,
    id: &str,
    overrides: &ManifestOverrides,
    data_root: &Path,
    dest_path: &Path,
) -> Result<(), String> {
    let theme_dir = crate::theme::theme_dir(themes_root, id)?;
    let crate::theme::ThemeFile {
        mut manifest,
        tokens,
        layout,
        ..
    } = crate::theme::get(themes_root, id)?;
    overrides.apply_to(&mut manifest);

    let manifest_json = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| format!("Could not serialise the manifest: {e}"))?;
    let tokens_json = serde_json::to_vec_pretty(&tokens)
        .map_err(|e| format!("Could not serialise tokens: {e}"))?;
    let layout_json = layout
        .as_ref()
        .map(serde_json::to_vec_pretty)
        .transpose()
        .map_err(|e| format!("Could not serialise layout: {e}"))?;

    let mut files = vec![
        (MANIFEST_FILE.to_string(), manifest_json),
        (TOKENS_FILE.to_string(), tokens_json),
    ];
    if let Some(layout_json) = layout_json {
        files.push((LAYOUT_FILE.to_string(), layout_json));
    }

    let styles_path = theme_dir.join(STYLES_FILE);
    if styles_path.is_file() {
        let bytes = std::fs::read(&styles_path)
            .map_err(|e| format!("Could not read {}: {e}", styles_path.display()))?;
        // Defensive: a local theme placed by hand never passed the import gate
        // a packaged one did, and a stylesheet is the one file whose content is
        // the attack surface.
        let text = std::str::from_utf8(&bytes)
            .map_err(|e| format!("{STYLES_FILE} is not valid UTF-8: {e}"))?;
        crate::theme::css::validate_css(text)?;
        files.push((STYLES_FILE.to_string(), bytes));
    }

    let named = files.len();
    append_assets(&theme_dir, &mut files)?;
    // `read_dir` order is arbitrary; a stable one keeps two exports byte-identical.
    files[named..].sort_by(|a, b| a.0.cmp(&b.0));

    for (name, bytes) in &files {
        if leaks_path(bytes, data_root) {
            return Err(format!(
                "{name} names this Launcher's own data folder ({}); refusing to export a theme that would leak it.",
                data_root.display()
            ));
        }
    }

    write_package(dest_path, &files)
}

/// The files an export writes from named sources rather than by walking the
/// install directory; the walk skips them so nothing is packaged twice.
/// `settings.values.json` is listed although no named source writes it: it is
/// this user's own tuning of their installed copy, not the theme's portable
/// content (Phase 3 §0 decision 4).
const EXPORTED_FILES: [&str; 5] = [
    MANIFEST_FILE,
    TOKENS_FILE,
    LAYOUT_FILE,
    STYLES_FILE,
    crate::theme::settings_values::SETTINGS_VALUES_FILE,
];

/// Append every other file an installed theme ships, at its own relative path.
///
/// Entry names join path components with `/` explicitly, never the OS
/// separator, so a package written on Windows is the one Linux reads. A file
/// whose extension is outside [`ALLOWED_EXTENSIONS`], or whose bytes fail
/// [`sniff_asset`], is skipped rather than fatal: this reads a directory the
/// Launcher itself installed, and the allow-list is the same enforcement point
/// the import side already applies.
///
/// The ceilings an import enforces apply here too, checked before each file is
/// read — an export must never produce a package this build would refuse, and a
/// stray gigabyte must not be read into memory to discover that. Depth is the
/// count of `/` in the entry name, exactly as the import side counts it.
fn append_assets(theme_dir: &Path, files: &mut Vec<(String, Vec<u8>)>) -> Result<(), String> {
    let mut total_bytes: u64 = files.iter().map(|(_, bytes)| bytes.len() as u64).sum();
    let mut stack = vec![(theme_dir.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| format!("Could not read {}: {e}", dir.display()))?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let relative = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            // Symlinks are neither followed nor packaged: import refuses them,
            // so one here came from outside the theme pipeline.
            let file_type = entry
                .file_type()
                .map_err(|e| format!("Could not inspect {}: {e}", entry.path().display()))?;
            if file_type.is_dir() {
                stack.push((entry.path(), relative));
                continue;
            }
            if !file_type.is_file() || EXPORTED_FILES.contains(&relative.as_str()) {
                continue;
            }
            let Some(extension) = allowed_extension(&relative) else {
                continue;
            };
            let depth = relative.matches('/').count();
            if depth > MAX_PATH_DEPTH {
                return Err(format!(
                    "`{relative}` is nested {depth} levels deep; a theme package may nest at most {MAX_PATH_DEPTH}."
                ));
            }
            if files.len() >= MAX_FILES {
                return Err(format!(
                    "This theme holds more than {MAX_FILES} packageable files — a theme is a manifest, a palette and its assets."
                ));
            }
            let path = entry.path();
            let len = entry
                .metadata()
                .map_err(|e| format!("Could not inspect {}: {e}", path.display()))?
                .len();
            if total_bytes + len > MAX_TOTAL_UNCOMPRESSED_BYTES {
                return Err(format!(
                    "This theme expands to more than {} MB; refusing to export it.",
                    MAX_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024)
                ));
            }
            let bytes = std::fs::read(&path)
                .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
            if sniff_asset(&relative, extension, &bytes).is_err() {
                continue;
            }
            total_bytes += bytes.len() as u64;
            files.push((relative, bytes));
        }
    }
    Ok(())
}

/// Whether `bytes` mention `path`, in raw form or as JSON escapes it — on
/// Windows the serialised form doubles every backslash (`C:\\Users\\…`).
fn leaks_path(bytes: &[u8], path: &Path) -> bool {
    let path = path.to_string_lossy();
    if path.trim().is_empty() {
        return false;
    }
    if contains(bytes, path.as_bytes()) {
        return true;
    }
    serde_json::to_string(&*path)
        .map(|escaped| contains(bytes, escaped.trim_matches('"').as_bytes()))
        .unwrap_or(false)
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && haystack.windows(needle.len()).any(|w| w == needle)
}

/// Write the package's entries in the order given, nothing else and no
/// directory entries.
fn write_package(dest_path: &Path, files: &[(String, Vec<u8>)]) -> Result<(), String> {
    match write_package_inner(dest_path, files) {
        Ok(()) => Ok(()),
        Err(e) => {
            // A half-written package is not a package; leave nothing behind.
            let _ = std::fs::remove_file(dest_path);
            Err(e)
        }
    }
}

fn write_package_inner(dest_path: &Path, files: &[(String, Vec<u8>)]) -> Result<(), String> {
    let file = std::fs::File::create(dest_path)
        .map_err(|e| format!("Could not create {}: {e}", dest_path.display()))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        // The DOS epoch, not "now": a real timestamp would make two exports of
        // the same theme differ byte for byte.
        .last_modified_time(zip::DateTime::default());

    for (name, bytes) in files {
        writer
            .start_file(name.as_str(), options)
            .map_err(|e| format!("Could not add {name} to {}: {e}", dest_path.display()))?;
        writer
            .write_all(bytes)
            .map_err(|e| format!("Could not write {name} into {}: {e}", dest_path.display()))?;
    }

    writer
        .finish()
        .map_err(|e| format!("Could not finish {}: {e}", dest_path.display()))?;
    Ok(())
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
            tier: "basic".to_string(),
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

    /// One entry for the writer below; a symlink needs `add_symlink`, and a
    /// real asset needs bytes, so each is its own case.
    enum Entry {
        File(String, Vec<u8>),
        Symlink(String, String),
    }

    impl Entry {
        fn file(name: impl Into<String>, body: impl Into<String>) -> Self {
            Self::File(name.into(), body.into().into_bytes())
        }

        /// A file whose bytes are not text — a real image or font.
        fn bytes(name: impl Into<String>, body: impl Into<Vec<u8>>) -> Self {
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
                    writer.write_all(body).expect("could not write file body");
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
                    // Already bytes; the `Entry::file` helper would re-encode them as text.
                    Entry::File(name, body) => Entry::bytes(name.clone(), body.clone()),
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
            tier: "basic".to_string(),
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

    /// One file for each capability a package can have to declare.
    fn content_entry(kind: &str) -> Entry {
        match kind {
            "layout" => Entry::file(
                LAYOUT_FILE,
                serde_json::json!({ "schemaVersion": 1, "slots": {} }).to_string(),
            ),
            "css" => Entry::file(
                STYLES_FILE,
                r#"[data-tetra-slot="shell.sidebar"] { opacity: 0.9; }"#,
            ),
            "fonts" => Entry::bytes("assets/fonts/body.ttf", minimal_ttf()),
            "assets" => Entry::bytes(
                "assets/preview.png",
                encode_image(image::ImageFormat::Png, 8, 8),
            ),
            other => panic!("unknown content kind {other}"),
        }
    }

    /// A package at `tier` carrying exactly `content` and declaring exactly
    /// `capabilities`, so a capability test varies one side only.
    fn content_package(
        themes_root: &Path,
        tag: &str,
        tier: &str,
        capabilities: &[&str],
        content: &[&str],
    ) -> PathBuf {
        let themed = ThemeManifest {
            tier: tier.to_string(),
            capabilities: capabilities.iter().map(|c| c.to_string()).collect(),
            ..manifest()
        };
        let zip_path = themes_root.join(format!("{tag}.zip"));
        let mut entries = vec![
            Entry::file(MANIFEST_FILE, serde_json::to_string(&themed).unwrap()),
            Entry::file(TOKENS_FILE, tokens_json()),
        ];
        entries.extend(content.iter().map(|kind| content_entry(kind)));
        build_zip(&zip_path, &entries);
        zip_path
    }

    /// A `head` table good enough for a real font parser: 54 bytes, the sfnt
    /// magic, a legal units-per-em and a short loca format.
    fn head_table() -> Vec<u8> {
        let mut table = vec![0u8; 54];
        table[12..16].copy_from_slice(&0x5F0F_3CF5u32.to_be_bytes());
        table[18..20].copy_from_slice(&1000u16.to_be_bytes());
        table[50..52].copy_from_slice(&0u16.to_be_bytes());
        table
    }

    /// A `hhea` table: version, the three vertical metrics, then the metric count.
    fn hhea_table() -> Vec<u8> {
        let mut table = vec![0u8; 36];
        table[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        table[4..6].copy_from_slice(&800i16.to_be_bytes());
        table[6..8].copy_from_slice(&(-200i16).to_be_bytes());
        table[34..36].copy_from_slice(&1u16.to_be_bytes());
        table
    }

    fn maxp_table(glyphs: u16) -> Vec<u8> {
        let mut table = vec![0u8; 32];
        table[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        table[4..6].copy_from_slice(&glyphs.to_be_bytes());
        table
    }

    /// The three tables a parser insists on, so a fixture font is small and
    /// hand-built rather than a checked-in binary blob.
    fn minimal_font_tables() -> Vec<(&'static [u8; 4], Vec<u8>)> {
        vec![
            (b"head", head_table()),
            (b"hhea", hhea_table()),
            (b"maxp", maxp_table(1)),
        ]
    }

    /// Lay out tables as sfnt, independently of the code under test: the
    /// reader must agree with a plain reading of the format spec.
    fn build_sfnt(flavor: u32, tables: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&flavor.to_be_bytes());
        out.extend_from_slice(&(tables.len() as u16).to_be_bytes());
        out.extend_from_slice(&[0u8; 6]);
        let mut offset = 12 + tables.len() * 16;
        for (tag, table) in tables {
            out.extend_from_slice(*tag);
            out.extend_from_slice(&0u32.to_be_bytes());
            out.extend_from_slice(&(offset as u32).to_be_bytes());
            out.extend_from_slice(&(table.len() as u32).to_be_bytes());
            offset += table.len() + (4 - table.len() % 4) % 4;
        }
        for (_, table) in tables {
            out.extend_from_slice(table);
            out.resize(out.len() + (4 - table.len() % 4) % 4, 0);
        }
        out
    }

    fn minimal_ttf() -> Vec<u8> {
        build_sfnt(0x0001_0000, &minimal_font_tables())
    }

    /// Wrap tables as WOFF 1.0: one zlib stream per table, canonical header.
    fn build_woff(tables: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        use std::io::Write as _;

        let mut stored: Vec<(&[u8; 4], Vec<u8>, Vec<u8>)> = Vec::new();
        for (tag, table) in tables {
            let mut compressed = Vec::new();
            let mut encoder =
                flate2::write::ZlibEncoder::new(&mut compressed, flate2::Compression::default());
            encoder.write_all(table).unwrap();
            encoder.finish().unwrap();
            stored.push((tag, compressed, table.clone()));
        }

        let mut out = vec![0u8; 44 + stored.len() * 20];
        out[0..4].copy_from_slice(b"wOFF");
        out[4..8].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        out[12..14].copy_from_slice(&(stored.len() as u16).to_be_bytes());
        let mut offset = 44 + stored.len() * 20;
        for (index, (tag, compressed, original)) in stored.iter().enumerate() {
            let entry = &mut out[44 + index * 20..44 + (index + 1) * 20];
            entry[0..4].copy_from_slice(*tag);
            entry[4..8].copy_from_slice(&(offset as u32).to_be_bytes());
            entry[8..12].copy_from_slice(&(compressed.len() as u32).to_be_bytes());
            entry[12..16].copy_from_slice(&(original.len() as u32).to_be_bytes());
            offset += compressed.len();
        }
        for (_, compressed, _) in &stored {
            out.extend_from_slice(compressed);
        }
        let length = out.len() as u32;
        out[8..12].copy_from_slice(&length.to_be_bytes());
        out
    }

    /// Wrap tables as WOFF2: one Brotli stream, unprefixed tags.
    fn build_woff2(tables: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        use std::io::Write as _;

        let mut directory = Vec::new();
        let mut data = Vec::new();
        for (tag, table) in tables {
            let index = WOFF2_KNOWN_TAGS
                .iter()
                .position(|known| known == tag)
                .expect("fixture tags must be in the WOFF2 known table");
            directory.push(index as u8);
            directory.extend_from_slice(&base128(table.len() as u32));
            data.extend_from_slice(table);
        }

        let mut compressed = Vec::new();
        let mut writer = brotli::CompressorWriter::new(&mut compressed, 4096, 5, 22);
        writer.write_all(&data).unwrap();
        drop(writer);

        let mut out = vec![0u8; 48];
        out[0..4].copy_from_slice(b"wOF2");
        out[4..8].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        out[12..14].copy_from_slice(&(tables.len() as u16).to_be_bytes());
        out[20..24].copy_from_slice(&(compressed.len() as u32).to_be_bytes());
        out.extend_from_slice(&directory);
        out.extend_from_slice(&compressed);
        let length = out.len() as u32;
        out[8..12].copy_from_slice(&length.to_be_bytes());
        out
    }

    /// UIntBase128, the length encoding a WOFF2 directory uses.
    fn base128(mut value: u32) -> Vec<u8> {
        let mut encoded = Vec::new();
        loop {
            let mut byte = (value & 0x7f) as u8;
            let rest = value >> 7;
            if !encoded.is_empty() {
                byte |= 0x80;
            }
            encoded.push(byte);
            if rest == 0 {
                break;
            }
            value = rest;
        }
        // Most significant group first.
        encoded.reverse();
        encoded
    }

    /// A real PNG/JPEG/WEBP of the given size, encoded by the `image` crate.
    fn encode_image(format: image::ImageFormat, width: u32, height: u32) -> Vec<u8> {
        use image::ImageEncoder as _;

        let pixels = vec![0x40u8; (width * height * 3) as usize];
        let mut bytes = Vec::new();
        match format {
            image::ImageFormat::Png => image::codecs::png::PngEncoder::new(&mut bytes).write_image(
                &pixels,
                width,
                height,
                image::ExtendedColorType::Rgb8,
            ),
            image::ImageFormat::Jpeg => image::codecs::jpeg::JpegEncoder::new(&mut bytes)
                .write_image(&pixels, width, height, image::ExtendedColorType::Rgb8),
            image::ImageFormat::WebP => image::codecs::webp::WebPEncoder::new_lossless(&mut bytes)
                .write_image(&pixels, width, height, image::ExtendedColorType::Rgb8),
            other => panic!("unexpected fixture format {other:?}"),
        }
        .expect("could not encode the image fixture");
        bytes
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
    fn an_extension_outside_the_allow_list_is_refused() {
        let root = scratch("extension");
        let zip_path = fixture(&root, "extension", &[Entry::file("payload.sh", "echo hi")]);

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("payload.sh"), "message was: {error}");
        assert!(error.contains("allowed are"), "message was: {error}");
        assert!(
            !root.join(STAGING_DIR).read_dir().unwrap().next().is_some(),
            "a refused package must leave no staging directory"
        );
    }

    #[test]
    fn every_format_the_allow_list_accepts_is_staged_when_it_is_real() {
        let root = scratch("assets-ok");
        let zip_path = fixture(
            &root,
            "assets-ok",
            &[
                Entry::bytes(
                    "art/logo.png",
                    encode_image(image::ImageFormat::Png, 24, 16),
                ),
                Entry::bytes(
                    "art/logo.webp",
                    encode_image(image::ImageFormat::WebP, 24, 16),
                ),
                Entry::bytes(
                    "art/logo.jpg",
                    encode_image(image::ImageFormat::Jpeg, 24, 16),
                ),
                Entry::bytes(
                    "art/logo.jpeg",
                    encode_image(image::ImageFormat::Jpeg, 24, 16),
                ),
                Entry::bytes("art/icon.ttf", minimal_ttf()),
                Entry::bytes("art/icon.woff", build_woff(&minimal_font_tables())),
                Entry::bytes("art/icon.woff2", build_woff2(&minimal_font_tables())),
                Entry::file(
                    "art/logo.svg",
                    r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>"#,
                ),
            ],
        );

        let preview = stage_for_preview(&root, &zip_path, &[]).expect("real assets must stage");

        assert_eq!(preview.file_count, 10);
        let staged = staging_dir(&root, &preview);
        for asset in [
            "art/logo.png",
            "art/logo.webp",
            "art/icon.woff2",
            "art/logo.svg",
        ] {
            assert!(staged.join(asset).is_file(), "{asset} must be staged");
        }
    }

    #[test]
    fn a_renamed_extension_on_non_image_bytes_is_refused() {
        for (extension, body) in [
            ("png", "this is definitely not a png"),
            ("webp", "this is definitely not a webp"),
            ("jpg", "this is definitely not a jpeg"),
            ("jpeg", "this is definitely not a jpeg"),
        ] {
            let root = scratch("fake-image");
            let name = format!("art/logo.{extension}");
            let zip_path = fixture(&root, "fake-image", &[Entry::file(&name, body)]);

            let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

            assert!(error.contains(&name), "message was: {error}");
            assert!(
                !root.join(STAGING_DIR).read_dir().unwrap().next().is_some(),
                "nothing may stay staged for a refused package"
            );
        }
    }

    /// The polyglot that matters most: a real image of one format wearing
    /// another's extension. `image` would happily decode the PNG as a PNG, so
    /// this only fails if the decoder is pinned to the extension.
    #[test]
    fn an_image_declared_as_the_wrong_format_is_refused() {
        let root = scratch("mismatched-image");
        let zip_path = fixture(
            &root,
            "mismatched-image",
            &[Entry::bytes(
                "art/logo.jpg",
                encode_image(image::ImageFormat::Png, 8, 8),
            )],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("art/logo.jpg"), "message was: {error}");
    }

    #[test]
    fn an_image_over_the_dimension_cap_is_refused_before_it_is_decoded() {
        let root = scratch("oversize-image");
        // The header claims an oversized image, and the IDAT that follows is
        // not decodable at all. Decoding first would fail as corrupt; only a
        // cap read from the header can report it as too large.
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&MAX_IMAGE_DIMENSION.to_be_bytes());
        ihdr.extend_from_slice(&(MAX_IMAGE_DIMENSION + 1).to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        let idat = b"not a zlib stream".to_vec();

        let mut png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        for (kind, data) in [(&b"IHDR"[..], &ihdr[..]), (&b"IDAT"[..], &idat[..])] {
            png.extend_from_slice(&(data.len() as u32).to_be_bytes());
            png.extend_from_slice(kind);
            png.extend_from_slice(data);
            png.extend_from_slice(&crc32(kind, data).to_be_bytes());
        }
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&crc32(b"IEND", &[]).to_be_bytes());
        let zip_path = fixture(&root, "oversize-image", &[Entry::bytes("art/big.png", png)]);

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(
            error.contains("larger than the 4096x4096"),
            "message was: {error}"
        );
    }

    /// A baseline JPEG whose headers declare `width`x`height` but which carries
    /// no entropy-coded data, so it has readable dimensions and cannot decode.
    fn jpeg_without_scan_data(width: u16, height: u16) -> Vec<u8> {
        let mut jpeg = vec![0xFF, 0xD8];
        jpeg.extend_from_slice(&[0xFF, 0xE0, 0x00, 0x10]);
        jpeg.extend_from_slice(b"JFIF\0");
        jpeg.extend_from_slice(&[0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
        jpeg.extend_from_slice(&[0xFF, 0xDB, 0x00, 0x43, 0x00]);
        jpeg.extend_from_slice(&[1u8; 64]);
        jpeg.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 0x08]);
        jpeg.extend_from_slice(&height.to_be_bytes());
        jpeg.extend_from_slice(&width.to_be_bytes());
        jpeg.push(3);
        for component in [1u8, 2, 3] {
            jpeg.extend_from_slice(&[component, 0x11, 0x00]);
        }
        let mut lengths = [0u8; 16];
        lengths[0] = 1;
        jpeg.extend_from_slice(&[0xFF, 0xC4, 0x00, 0x14, 0x00]);
        jpeg.extend_from_slice(&lengths);
        jpeg.push(0);
        jpeg.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x0C, 0x03]);
        for component in [1u8, 2, 3] {
            jpeg.extend_from_slice(&[component, 0x00]);
        }
        jpeg.extend_from_slice(&[0x00, 0x3F, 0x00]);
        jpeg
    }

    /// The dimension cap has to come from the header for every raster format,
    /// not just PNG. Each fixture below reports dimensions but cannot decode,
    /// so only a header-first cap can call it oversized rather than corrupt.
    #[test]
    fn an_oversized_image_of_every_raster_format_is_refused_before_decoding() {
        // A real oversized WebP, truncated after the header that states its size.
        let mut oversized_webp = encode_image(image::ImageFormat::WebP, 5000, 8);
        oversized_webp.truncate(40);

        for (extension, body) in [
            (
                "jpg",
                jpeg_without_scan_data(MAX_IMAGE_DIMENSION as u16 + 1, 8),
            ),
            ("webp", oversized_webp),
        ] {
            let root = scratch("oversize-each");
            let name = format!("art/big.{extension}");
            let zip_path = fixture(&root, "oversize-each", &[Entry::bytes(&name, body)]);

            let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

            assert!(
                error.contains("larger than the 4096x4096"),
                "`{extension}` message was: {error}"
            );
        }
    }

    #[test]
    fn a_corrupt_image_body_at_an_allowed_size_is_refused() {
        let root = scratch("corrupt-image");
        let good = encode_image(image::ImageFormat::Png, 32, 32);
        // Header intact so the size check passes; the body is gone.
        let zip_path = fixture(
            &root,
            "corrupt-image",
            &[Entry::bytes("art/broken.png", &good[..40])],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("art/broken.png"), "message was: {error}");
    }

    #[test]
    fn a_renamed_extension_on_non_font_bytes_is_refused() {
        for extension in ["ttf", "otf", "woff", "woff2"] {
            let root = scratch("fake-font");
            let name = format!("art/icon.{extension}");
            let zip_path = fixture(&root, "fake-font", &[Entry::file(&name, "not a font")]);

            let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

            assert!(error.contains(&name), "message was: {error}");
        }
    }

    /// Each container is identified from its own magic, so neither web format
    /// can be smuggled in under the other's extension, nor a wrapped font under
    /// the sfnt extensions. (`.otf` and `.ttf` are one container — both hold
    /// either outline flavour — so they are not mismatched with each other.)
    #[test]
    fn a_font_container_under_the_wrong_extension_is_refused() {
        for (extension, body) in [
            ("woff", build_woff2(&minimal_font_tables())),
            ("woff2", build_woff(&minimal_font_tables())),
            ("ttf", build_woff(&minimal_font_tables())),
            ("otf", build_woff2(&minimal_font_tables())),
        ] {
            let root = scratch("wrong-font-container");
            let name = format!("art/icon.{extension}");
            let zip_path = fixture(&root, "wrong-font-container", &[Entry::bytes(&name, body)]);

            let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

            assert!(error.contains(&name), "message was: {error}");
        }
    }

    /// `.otf` and `.ttf` are the same sfnt container, and an `.otf` typically
    /// holds CFF outlines (`OTTO`) rather than TrueType ones — so the extension
    /// must accept both flavours rather than pinning either.
    #[test]
    fn an_otf_may_hold_either_outline_flavour() {
        for flavor in [0x0001_0000u32, u32::from_be_bytes(*b"OTTO")] {
            let root = scratch("otf-flavor");
            let zip_path = fixture(
                &root,
                "otf-flavor",
                &[Entry::bytes(
                    "art/icon.otf",
                    build_sfnt(flavor, &minimal_font_tables()),
                )],
            );

            let preview = stage_for_preview(&root, &zip_path, &[])
                .unwrap_or_else(|e| panic!("flavour {flavor:#x} must be accepted: {e}"));

            assert_eq!(preview.file_count, 3);
        }
    }

    /// A container whose bytes are a valid font *elsewhere* still has to fail:
    /// the tables the reader picks up must be the ones the container names.
    #[test]
    fn a_font_whose_tables_do_not_parse_is_refused() {
        let root = scratch("bad-font-tables");
        let mut tables = minimal_font_tables();
        // A `head` table too short for any parser to accept.
        tables[0].1.truncate(20);
        let zip_path = fixture(
            &root,
            "bad-font-tables",
            &[Entry::bytes(
                "art/icon.ttf",
                build_sfnt(0x0001_0000, &tables),
            )],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(
            error.contains("not a readable font"),
            "message was: {error}"
        );
    }

    #[test]
    fn an_svg_containing_a_script_element_is_refused() {
        let root = scratch("svg-script");
        let zip_path = fixture(
            &root,
            "svg-script",
            &[Entry::file(
                "art/evil.svg",
                r#"<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT>alert(1)</SCRIPT></svg>"#,
            )],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("art/evil.svg"), "message was: {error}");
        assert!(error.contains("<script>"), "message was: {error}");
    }

    #[test]
    fn an_svg_with_an_event_handler_attribute_is_refused() {
        for attribute in ["onload=\"alert(1)\"", "ONCLICK=\"alert(1)\""] {
            let root = scratch("svg-handler");
            let body = format!(
                r#"<svg xmlns="http://www.w3.org/2000/svg" {attribute}><rect width="4" height="4"/></svg>"#
            );
            let zip_path = fixture(&root, "svg-handler", &[Entry::file("art/evil.svg", body)]);

            let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

            assert!(
                error.contains("event handler attribute"),
                "message was: {error}"
            );
        }
    }

    /// Escaped text is text, not markup: XML-encoding a `<script>` mention is
    /// what a documented example would look like, and must not be refused.
    #[test]
    fn an_svg_that_only_mentions_script_in_text_is_accepted() {
        let root = scratch("svg-mentions-script");
        let zip_path = fixture(
            &root,
            "svg-mentions-script",
            &[Entry::file(
                "art/notes.svg",
                r#"<svg xmlns="http://www.w3.org/2000/svg"><desc>A &lt;script&gt; tag is banned.</desc></svg>"#,
            )],
        );

        let preview =
            stage_for_preview(&root, &zip_path, &[]).expect("escaped text must not read as markup");

        assert_eq!(preview.file_count, 3);
    }

    #[test]
    fn a_malformed_svg_is_refused() {
        let root = scratch("svg-malformed");
        let zip_path = fixture(
            &root,
            "svg-malformed",
            &[Entry::file(
                "art/broken.svg",
                r#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="4">"#,
            )],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("well-formed"), "message was: {error}");
    }

    /// A non-SVG XML document is not a theme image, whatever it is named.
    #[test]
    fn xml_that_is_not_svg_is_refused() {
        let root = scratch("not-svg");
        let zip_path = fixture(
            &root,
            "not-svg",
            &[Entry::file("art/logo.svg", "<html><body>hi</body></html>")],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("not `<svg>`"), "message was: {error}");
    }

    /// A stylesheet with nothing `theme::css::validate_css` bans stages fine.
    #[test]
    fn a_clean_stylesheet_is_staged() {
        let root = scratch("css-clean");
        let zip_path = fixture(
            &root,
            "css-clean",
            &[Entry::file(
                "style/theme.css",
                r#"[data-tetra-slot="server.row"] { border-radius: 2px; }"#,
            )],
        );

        stage_for_preview(&root, &zip_path, &[]).expect("a clean stylesheet must stage");
    }

    /// The same gate Package C ships runs here too — a theme cannot smuggle
    /// through what `validate_css` would otherwise refuse.
    #[test]
    fn a_stylesheet_validate_css_would_refuse_is_refused_here_too() {
        let root = scratch("css-banned");
        let zip_path = fixture(
            &root,
            "css-banned",
            &[Entry::file("style/theme.css", r#"@import "other.css";"#)],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("@import"), "message was: {error}");
    }

    /// The sniff runs before the entry is written, so a package that trips it
    /// leaves nothing at all behind — not even the entries that came first.
    #[test]
    fn an_asset_refused_mid_package_leaves_no_staging_directory() {
        let root = scratch("asset-atomic");
        let zip_path = fixture(
            &root,
            "asset-atomic",
            &[
                Entry::bytes("art/good.png", encode_image(image::ImageFormat::Png, 8, 8)),
                Entry::file("art/fake.ttf", "not a font"),
            ],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("art/fake.ttf"), "message was: {error}");
        assert!(
            !root.join(STAGING_DIR).read_dir().unwrap().next().is_some(),
            "the whole import must be discarded"
        );
    }

    /// CRC-32, so a hand-built PNG fixture carries a real checksum without
    /// pulling a dependency into the test module.
    fn crc32(kind: &[u8], data: &[u8]) -> u32 {
        let mut crc = 0xffff_ffffu32;
        for byte in kind.iter().chain(data) {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xedb8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    #[test]
    fn an_extension_in_a_different_case_is_still_the_format_it_names() {
        let root = scratch("uppercase");
        let logo = encode_image(image::ImageFormat::Png, 8, 8);
        let zip_path = fixture(
            &root,
            "uppercase",
            &[Entry::bytes("art/LOGO.PNG", logo.clone())],
        );

        let preview = stage_for_preview(&root, &zip_path, &[]).expect("`LOGO.PNG` is still a png");

        let staged = staging_dir(&root, &preview);
        assert!(staged.join("art/LOGO.PNG").is_file());
    }

    #[test]
    fn a_plain_text_asset_is_staged_without_further_checks() {
        let root = scratch("text");
        let zip_path = fixture(
            &root,
            "text",
            &[
                Entry::file("README.md", "# Aurora\n"),
                Entry::file("preview/notes.txt", "notes"),
            ],
        );

        let preview = stage_for_preview(&root, &zip_path, &[]).expect("notes must stage");

        assert_eq!(preview.file_count, 4);
        let staged = staging_dir(&root, &preview);
        assert_eq!(
            std::fs::read_to_string(staged.join("README.md")).unwrap(),
            "# Aurora\n"
        );
        assert!(staged.join("preview/notes.txt").is_file());
    }

    /// An advanced package carrying content and declaring every capability it
    /// needs imports, and each kind of content survives staging.
    #[test]
    fn an_advanced_theme_declaring_its_capabilities_is_accepted() {
        let root = scratch("tier-advanced");
        let zip_path = content_package(
            &root,
            "tier-advanced",
            "advanced",
            &["tokens", "layout", "css", "fonts", "assets"],
            &["layout", "css", "fonts", "assets"],
        );

        let preview = stage_for_preview(&root, &zip_path, &[])
            .expect("a declared advanced theme must import");

        assert_eq!(preview.manifest.tier, "advanced");
        assert_eq!(preview.file_count, 6);
        let staged = staging_dir(&root, &preview);
        for file in [
            LAYOUT_FILE,
            STYLES_FILE,
            "assets/fonts/body.ttf",
            "assets/preview.png",
        ] {
            assert!(staged.join(file).is_file(), "{file} must be staged");
        }
    }

    /// Each capability its content implies must be declared; one absent
    /// capability is a rejection naming that capability and the file behind it.
    #[test]
    fn an_advanced_theme_missing_a_capability_it_ships_is_refused() {
        for (kind, capability) in [
            ("layout", "layout"),
            ("css", "css"),
            ("fonts", "fonts"),
            ("assets", "assets"),
        ] {
            let root = scratch(&format!("tier-missing-{kind}"));
            let zip_path = content_package(
                &root,
                &format!("tier-missing-{kind}"),
                "advanced",
                &["tokens"],
                &[kind],
            );

            let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

            assert!(
                error.contains(&format!("`{capability}`")),
                "message for undeclared {capability} was: {error}"
            );
            assert!(
                !root.join(STAGING_DIR).read_dir().unwrap().next().is_some(),
                "a refused import must leave no staging directory"
            );
        }
    }

    /// Every absent capability is reported together, so a theme author fixes
    /// the manifest once instead of one capability per re-attempt.
    #[test]
    fn an_advanced_theme_missing_several_capabilities_names_them_all_at_once() {
        let root = scratch("tier-missing-all");
        let zip_path = content_package(
            &root,
            "tier-missing-all",
            "advanced",
            &["tokens"],
            &["layout", "css", "fonts", "assets"],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        for capability in ["layout", "css", "fonts", "assets"] {
            assert!(
                error.contains(&format!("`{capability}`")),
                "the combined message must name {capability}, was: {error}"
            );
        }
    }

    /// The capability cross-check is advanced-only: a basic theme carrying
    /// assets is the pre-Phase-2 shape and must load exactly as it always did.
    #[test]
    fn a_basic_theme_with_stray_content_and_no_capabilities_is_still_accepted() {
        let root = scratch("tier-basic-exempt");
        let zip_path = content_package(
            &root,
            "tier-basic-exempt",
            "basic",
            &[],
            &["fonts", "assets", "layout"],
        );

        let preview = stage_for_preview(&root, &zip_path, &[]).expect("basic is exempt");

        assert_eq!(preview.manifest.tier, "basic");
        assert_eq!(preview.file_count, 5);
    }

    /// The capability check reads the two names this codebase actually
    /// consumes: a nested `assets/layout.json` is an inert data file, not a
    /// layout, and must not demand the `layout` capability.
    #[test]
    fn a_nested_file_sharing_a_root_name_does_not_demand_its_capability() {
        let root = scratch("tier-nested-name");
        let zip_path = root.join("nested-name.zip");
        build_zip(
            &zip_path,
            &[
                Entry::file(
                    MANIFEST_FILE,
                    serde_json::to_string(&ThemeManifest {
                        tier: "advanced".to_string(),
                        ..manifest()
                    })
                    .unwrap(),
                ),
                Entry::file(TOKENS_FILE, tokens_json()),
                Entry::file("assets/layout.json", "{}"),
            ],
        );

        let preview =
            stage_for_preview(&root, &zip_path, &[]).expect("a nested json must stay inert");

        assert_eq!(preview.file_count, 3);
    }

    /// `expert` is in `SUPPORTED_TIERS`: the tier gate itself no longer
    /// refuses it (the capability cross-check is separate and covered by its
    /// own tests).
    #[test]
    fn an_expert_tier_theme_clears_the_tier_gate() {
        let root = scratch("tier");
        let mut expert = manifest();
        expert.tier = "expert".to_string();
        let zip_path = fixture_with_manifest(&root, "tier", &expert);

        let preview =
            stage_for_preview(&root, &zip_path, &[]).expect("expert is a supported tier now");

        assert_eq!(preview.manifest.tier, "expert");
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
    fn a_package_with_a_layout_stages_and_keeps_it_in_the_staging_directory() {
        let root = scratch("layout");
        let zip_path = fixture(
            &root,
            "layout",
            &[Entry::file(
                LAYOUT_FILE,
                serde_json::json!({ "schemaVersion": 1, "slots": { "sidebar": "aside" } })
                    .to_string(),
            )],
        );

        let preview = stage_for_preview(&root, &zip_path, &[]).expect("a layout is optional");

        assert_eq!(preview.file_count, 3);
        assert!(staging_dir(&root, &preview).join(LAYOUT_FILE).is_file());
    }

    /// Fail-closed like a malformed palette: the whole import is refused and
    /// the staging directory goes with it.
    #[test]
    fn a_layout_that_is_not_a_layout_object_is_refused_at_inspect_time() {
        let root = scratch("badlayout");
        let zip_path = fixture(
            &root,
            "badlayout",
            &[Entry::file(LAYOUT_FILE, r#"{"slots":{}}"#)],
        );

        let error = stage_for_preview(&root, &zip_path, &[]).unwrap_err();

        assert!(error.contains("schemaVersion"), "message was: {error}");
        assert!(
            !root.join(STAGING_DIR).read_dir().unwrap().next().is_some(),
            "a refused import must leave no staging directory"
        );
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
            None,
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
            None,
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

    // POSIX-only: occupying the aside path with a file reliably fails a
    // directory rename onto it there, but on Windows that same rename
    // succeeds (replacing the file) instead of erroring — a real platform
    // difference in rename-over-existing semantics, not a safety gap (the
    // aside path is namespaced by a per-import staging id, so this
    // collision can't happen outside a deliberately forced test).
    #[cfg(unix)]
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
            None,
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
            None,
        )
        .unwrap();
        let before = std::fs::read_dir(&root).unwrap().count();

        let error = confirm_theme_install(&root, "no-such-staging-id").unwrap_err();

        assert!(error.contains("no-such-staging-id"), "message was: {error}");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), before);
        assert!(crate::theme::get(&root, "installed.theme").is_ok());
        assert!(!root.join("aurora.test").exists());
    }

    /// Install one theme into `themes_root` so an export has something live to read.
    fn install(root: &Path, manifest: &ThemeManifest, tokens: &str) {
        let tokens: serde_json::Value = serde_json::from_str(tokens).unwrap();
        crate::theme::save(root, manifest, &tokens, None)
            .expect("could not install the fixture theme");
    }

    #[test]
    fn an_exported_theme_round_trips_through_the_import_pipeline() {
        let root = scratch("export-roundtrip");
        install(&root, &manifest(), &tokens_json());
        let dest = root.join("aurora.zip");

        export(
            &root,
            "aurora.test",
            &ManifestOverrides::default(),
            &root,
            &dest,
        )
        .expect("exporting an installed theme must work");

        let preview = stage_for_preview(&root, &dest, &[]).expect("an export must re-import");
        assert_eq!(preview.manifest.id, "aurora.test");
        assert_eq!(preview.file_count, 2);

        let staged = staging_dir(&root, &preview).join(TOKENS_FILE);
        // Byte-identical, not merely equal-after-parsing: the palette a user
        // exported is the palette whoever imports it gets.
        assert_eq!(
            std::fs::read(staged).unwrap(),
            std::fs::read(root.join("aurora.test").join(TOKENS_FILE)).unwrap()
        );
    }

    #[test]
    fn exporting_the_same_theme_twice_writes_identical_bytes() {
        let root = scratch("export-deterministic");
        install(&root, &manifest(), &tokens_json());
        let first = root.join("first.zip");
        let second = root.join("second.zip");

        for dest in [&first, &second] {
            export(
                &root,
                "aurora.test",
                &ManifestOverrides::default(),
                &root,
                dest,
            )
            .unwrap();
        }

        assert_eq!(
            std::fs::read(&first).unwrap(),
            std::fs::read(&second).unwrap()
        );
    }

    #[test]
    fn an_exported_package_holds_both_files_in_a_fixed_order_and_timestamp() {
        let root = scratch("export-shape");
        install(&root, &manifest(), &tokens_json());
        let dest = root.join("shape.zip");
        export(
            &root,
            "aurora.test",
            &ManifestOverrides::default(),
            &root,
            &dest,
        )
        .unwrap();

        let mut archive = zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert_eq!(names, vec![MANIFEST_FILE, TOKENS_FILE]);

        // The DOS epoch, not the moment of export — a live clock here is what
        // would make two exports of an unchanged theme differ.
        for index in 0..archive.len() {
            assert_eq!(
                archive.by_index(index).unwrap().last_modified(),
                Some(zip::DateTime::default()),
                "entry {index} must carry the fixed export timestamp"
            );
        }
    }

    /// A theme installed with a layout.json must not lose it on export —
    /// the portable package mirrors the live install directory.
    #[test]
    fn an_exported_theme_carries_its_layout_json_when_it_has_one() {
        let root = scratch("export-layout");
        let tokens: serde_json::Value = serde_json::from_str(&tokens_json()).unwrap();
        let layout = serde_json::json!({ "schemaVersion": 1, "slots": {} });
        crate::theme::save(&root, &manifest(), &tokens, Some(&layout))
            .expect("could not install the fixture theme");
        let dest = root.join("layout.zip");

        export(
            &root,
            "aurora.test",
            &ManifestOverrides::default(),
            &root,
            &dest,
        )
        .unwrap();

        let mut archive = zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert_eq!(names, vec![MANIFEST_FILE, TOKENS_FILE, LAYOUT_FILE]);

        let preview = stage_for_preview(&root, &dest, &[]).expect("an export must re-import");
        assert_eq!(preview.file_count, 3);
    }

    /// Package I's acceptance test: an installed advanced theme carrying a
    /// palette, a layout, a stylesheet and a font must survive export →
    /// reimport on a clean profile with every byte intact.
    #[test]
    fn an_advanced_theme_round_trips_through_export_and_reimport() {
        let root = scratch("export-advanced");
        let clean = scratch("export-advanced-clean");
        let tokens: serde_json::Value = serde_json::from_str(&tokens_json()).unwrap();
        let layout = serde_json::json!({ "schemaVersion": 1, "slots": { "sidebar": "aside" } });
        let advanced = ThemeManifest {
            tier: "advanced".to_string(),
            capabilities: ["tokens", "layout", "css", "fonts"]
                .iter()
                .map(|c| c.to_string())
                .collect(),
            ..manifest()
        };
        crate::theme::save(&root, &advanced, &tokens, Some(&layout)).unwrap();

        // A hand-placed local theme's own files, which `save` does not write.
        let styles = br#"[data-tetra-slot="shell.sidebar"] { opacity: 0.9; }"#.to_vec();
        let font = minimal_ttf();
        let installed = root.join("aurora.test");
        std::fs::create_dir_all(installed.join("assets/fonts")).unwrap();
        std::fs::write(installed.join(STYLES_FILE), &styles).unwrap();
        std::fs::write(installed.join("assets/fonts/body.ttf"), &font).unwrap();

        let dest = root.join("advanced.zip");
        export(
            &root,
            "aurora.test",
            &ManifestOverrides::default(),
            &root,
            &dest,
        )
        .expect("exporting an advanced theme must work");

        let preview =
            stage_for_preview(&clean, &dest, &[]).expect("the export must re-import cleanly");
        assert_eq!(preview.manifest.tier, "advanced");
        assert_eq!(preview.file_count, 5);

        let staged = staging_dir(&clean, &preview);
        assert_eq!(preview.manifest.id, advanced.id);
        assert_eq!(preview.manifest.capabilities, advanced.capabilities);
        for (name, original) in [
            (
                TOKENS_FILE,
                std::fs::read(installed.join(TOKENS_FILE)).unwrap(),
            ),
            (
                LAYOUT_FILE,
                std::fs::read(installed.join(LAYOUT_FILE)).unwrap(),
            ),
            (STYLES_FILE, styles),
            ("assets/fonts/body.ttf", font),
        ] {
            assert_eq!(
                std::fs::read(staged.join(name)).unwrap(),
                original,
                "{name} must survive the round trip byte for byte"
            );
        }
    }

    /// Phase 3's own acceptance test: an installed expert theme carrying
    /// every file kind this phase added — a palette, a layout, a stylesheet,
    /// a font, both component trees and a settings schema — must survive
    /// export -> reimport on a clean profile with every byte intact, now
    /// that the tier gate lets `expert` through.
    #[test]
    fn an_expert_theme_round_trips_through_export_and_reimport() {
        let root = scratch("export-expert");
        let clean = scratch("export-expert-clean");
        let tokens: serde_json::Value = serde_json::from_str(&tokens_json()).unwrap();
        let layout = serde_json::json!({ "schemaVersion": 1, "slots": { "sidebar": "aside" } });
        let expert = ThemeManifest {
            tier: "expert".to_string(),
            capabilities: ["tokens", "layout", "css", "fonts", "components", "settings"]
                .iter()
                .map(|c| c.to_string())
                .collect(),
            ..manifest()
        };
        crate::theme::save(&root, &expert, &tokens, Some(&layout)).unwrap();

        // Hand-placed local files, which `save` does not write.
        let styles = br#"[data-tetra-slot="shell.sidebar"] { opacity: 0.9; }"#.to_vec();
        let font = minimal_ttf();
        let server_row =
            br#"{"schemaVersion":1,"slot":"server.row","root":{"type":"core","ref":"name"}}"#
                .to_vec();
        let mods_row =
            br#"{"schemaVersion":1,"slot":"mods.row","root":{"type":"core","ref":"modName"}}"#
                .to_vec();
        let sidebar =
            br#"{"schemaVersion":1,"slot":"shell.sidebar","root":{"type":"core","ref":"navList"}}"#
                .to_vec();
        let settings_schema = br#"{"schemaVersion":1,"fields":[{"id":"accentHue","type":"number","label":"Accent hue","min":0,"max":360,"default":210}]}"#.to_vec();
        let installed = root.join("aurora.test");
        std::fs::create_dir_all(installed.join("assets/fonts")).unwrap();
        std::fs::create_dir_all(installed.join(COMPONENTS_DIR)).unwrap();
        std::fs::write(installed.join(STYLES_FILE), &styles).unwrap();
        std::fs::write(installed.join("assets/fonts/body.ttf"), &font).unwrap();
        for (slot, tree) in [
            ("server.row", &server_row),
            ("mods.row", &mods_row),
            ("shell.sidebar", &sidebar),
        ] {
            std::fs::write(
                installed.join(COMPONENTS_DIR).join(format!("{slot}.json")),
                tree,
            )
            .unwrap();
        }
        std::fs::write(installed.join(SETTINGS_SCHEMA_FILE), &settings_schema).unwrap();

        let dest = root.join("expert.zip");
        export(
            &root,
            "aurora.test",
            &ManifestOverrides::default(),
            &root,
            &dest,
        )
        .expect("exporting an expert theme must work");

        let preview = stage_for_preview(&clean, &dest, &[])
            .expect("the export must re-import cleanly now that expert is supported");
        assert_eq!(preview.manifest.tier, "expert");
        assert_eq!(preview.file_count, 9);

        let staged = staging_dir(&clean, &preview);
        assert_eq!(preview.manifest.id, expert.id);
        assert_eq!(preview.manifest.capabilities, expert.capabilities);
        for (name, original) in [
            (
                TOKENS_FILE,
                std::fs::read(installed.join(TOKENS_FILE)).unwrap(),
            ),
            (
                LAYOUT_FILE,
                std::fs::read(installed.join(LAYOUT_FILE)).unwrap(),
            ),
            (STYLES_FILE, styles),
            ("assets/fonts/body.ttf", font),
            (
                "components/server.row.json",
                std::fs::read(installed.join("components/server.row.json")).unwrap(),
            ),
            (
                "components/mods.row.json",
                std::fs::read(installed.join("components/mods.row.json")).unwrap(),
            ),
            (
                "components/shell.sidebar.json",
                std::fs::read(installed.join("components/shell.sidebar.json")).unwrap(),
            ),
            (
                SETTINGS_SCHEMA_FILE,
                std::fs::read(installed.join(SETTINGS_SCHEMA_FILE)).unwrap(),
            ),
        ] {
            assert_eq!(
                std::fs::read(staged.join(name)).unwrap(),
                original,
                "{name} must survive the round trip byte for byte"
            );
        }

        // The generalized names are read back as the slot ids they name, not
        // just carried as opaque bytes through the zip: install the staged
        // import and read the theme the launcher would actually serve.
        let installed_id =
            confirm_theme_install(&clean, &preview.staging_id).expect("the staged import confirms");
        let reinstalled =
            crate::theme::get(&clean, &installed_id).expect("the installed theme reads back");
        for slot in ["server.row", "mods.row", "shell.sidebar"] {
            assert!(
                reinstalled.components.contains_key(slot),
                "{slot} should have been discovered under components/: {:?}",
                reinstalled.components.keys().collect::<Vec<_>>()
            );
        }
    }

    /// Export is the allow-list's second enforcement point: a file the import
    /// side would refuse is left out of the package rather than failing the
    /// export, and one that fails the content sniff goes with it.
    #[test]
    fn an_export_skips_files_outside_the_allow_list_or_failing_the_sniff() {
        let root = scratch("export-skip");
        install(&root, &manifest(), &tokens_json());
        let installed = root.join("aurora.test");
        std::fs::create_dir_all(installed.join("assets")).unwrap();
        std::fs::write(installed.join("assets/run.sh"), b"#!/bin/sh\n").unwrap();
        std::fs::write(installed.join("assets/broken.ttf"), b"not a font").unwrap();
        let font = minimal_ttf();
        std::fs::write(installed.join("assets/icon.ttf"), &font).unwrap();

        let dest = root.join("skips.zip");
        export(
            &root,
            "aurora.test",
            &ManifestOverrides::default(),
            &root,
            &dest,
        )
        .unwrap();

        let preview = stage_for_preview(&root, &dest, &[]).expect("the export must re-import");
        assert_eq!(preview.file_count, 3);
        let staged = staging_dir(&root, &preview).join("assets/icon.ttf");
        // The real relative path, with `/` as the separator, is the entry name.
        assert_eq!(std::fs::read(staged).unwrap(), font);
    }

    /// The settings-values sidecar is this user's own tuning of their installed
    /// copy, not the theme's portable content — an export must leave it behind
    /// even though `append_assets`' extension walk would otherwise accept it.
    #[test]
    fn an_export_leaves_the_settings_values_sidecar_behind() {
        let root = scratch("export-values");
        install(&root, &manifest(), &tokens_json());
        let installed = root.join("aurora.test");
        std::fs::write(
            installed.join(crate::theme::settings_values::SETTINGS_VALUES_FILE),
            br#"{ "accentHue": 40 }"#,
        )
        .unwrap();

        let dest = root.join("values.zip");
        export(
            &root,
            "aurora.test",
            &ManifestOverrides::default(),
            &root,
            &dest,
        )
        .unwrap();

        let preview = stage_for_preview(&root, &dest, &[]).expect("the export must re-import");
        assert_eq!(preview.file_count, 2);
        assert!(!staging_dir(&root, &preview)
            .join(crate::theme::settings_values::SETTINGS_VALUES_FILE)
            .exists());
    }

    /// The ceilings an import enforces apply on the way out too, so an export
    /// can never produce a package this build would then refuse.
    #[test]
    fn an_export_over_the_file_count_ceiling_is_refused() {
        let root = scratch("export-too-many");
        install(&root, &manifest(), &tokens_json());
        let installed = root.join("aurora.test");
        std::fs::create_dir_all(installed.join("assets")).unwrap();
        for n in 0..MAX_FILES {
            std::fs::write(installed.join(format!("assets/note-{n}.txt")), b"note").unwrap();
        }
        let dest = root.join("too-many.zip");

        let error = export(
            &root,
            "aurora.test",
            &ManifestOverrides::default(),
            &root,
            &dest,
        )
        .unwrap_err();

        assert!(error.contains("more than 20"), "message was: {error}");
        assert!(!dest.exists(), "a refused export must write no package");
    }

    /// A hand-placed local theme's `styles.css` never passed the import gate,
    /// so export runs it through the same sanitiser rather than shipping it.
    #[test]
    fn an_export_refuses_a_stylesheet_validate_css_would_reject() {
        let root = scratch("export-bad-css");
        install(&root, &manifest(), &tokens_json());
        let installed = root.join("aurora.test");
        std::fs::write(installed.join(STYLES_FILE), br#"@import "remote.css";"#).unwrap();
        let dest = root.join("bad-css.zip");

        let error = export(
            &root,
            "aurora.test",
            &ManifestOverrides::default(),
            &root,
            &dest,
        )
        .unwrap_err();

        assert!(error.contains("@import"), "message was: {error}");
        assert!(!dest.exists(), "a refused export must write no package");
    }

    #[test]
    fn overrides_replace_named_fields_and_leave_the_rest_installed() {
        let root = scratch("export-overrides");
        install(&root, &manifest(), &tokens_json());
        let dest = root.join("overridden.zip");

        let overrides = ManifestOverrides {
            name: Some("Aurora Deluxe".to_string()),
            version: Some("2.0.0".to_string()),
            tags: Some(vec!["dark".to_string(), "blue".to_string()]),
            ..ManifestOverrides::default()
        };
        export(&root, "aurora.test", &overrides, &root, &dest).unwrap();

        let preview = stage_for_preview(&root, &dest, &[]).unwrap();
        assert_eq!(preview.manifest.name, "Aurora Deluxe");
        assert_eq!(preview.manifest.version, "2.0.0");
        assert_eq!(
            preview.manifest.tags,
            vec!["dark".to_string(), "blue".to_string()]
        );
        // Omitted overrides: the installed manifest's own values survive intact.
        assert_eq!(preview.manifest.author, "tester");
        assert_eq!(preview.manifest.description, "A test theme.");
        assert_eq!(preview.manifest.minimum_launcher_version, "1.0.0");
    }

    #[test]
    fn an_export_is_refused_when_the_palette_names_this_machines_data_folder() {
        let root = scratch("export-leak-tokens");
        let leaker = serde_json::json!({
            "schemaVersion": manifest::SCHEMA_VERSION,
            "dark": { "bg": root.to_string_lossy() },
            "light": { "bg": "#f5f5f7" },
        })
        .to_string();
        install(&root, &manifest(), &leaker);
        let dest = root.join("leaky.zip");

        let error = export(
            &root,
            "aurora.test",
            &ManifestOverrides::default(),
            &root,
            &dest,
        )
        .unwrap_err();

        assert!(error.contains(TOKENS_FILE), "message was: {error}");
        assert!(
            error.contains(&root.to_string_lossy().to_string()),
            "message was: {error}"
        );
        assert!(!dest.exists(), "a refused export must write no package");
    }

    #[test]
    fn an_export_is_refused_when_the_manifest_names_this_machines_data_folder() {
        let root = scratch("export-leak-manifest");
        install(&root, &manifest(), &tokens_json());
        let dest = root.join("leaky-manifest.zip");

        let overrides = ManifestOverrides {
            description: Some(format!("built in {}", root.display())),
            ..ManifestOverrides::default()
        };
        let error = export(&root, "aurora.test", &overrides, &root, &dest).unwrap_err();

        assert!(error.contains(MANIFEST_FILE), "message was: {error}");
        assert!(!dest.exists(), "a refused export must write no package");
    }

    #[test]
    fn an_export_of_a_missing_theme_is_refused() {
        let root = scratch("export-missing");
        let dest = root.join("nothing.zip");

        let error = export(
            &root,
            "not.installed",
            &ManifestOverrides::default(),
            &root,
            &dest,
        )
        .unwrap_err();

        assert!(error.contains("not.installed"), "message was: {error}");
    }

    /// The whole package through the real entry point: a theme carrying every
    /// asset kind the allow-list accepts must import, and each asset must be
    /// staged byte-for-byte — sniffing inspects the bytes, never rewrites them.
    #[test]
    fn a_multi_asset_theme_package_stages_every_asset_verbatim() {
        let root = scratch("e2e-assets");
        let logo = encode_image(image::ImageFormat::Png, 12, 9);
        let hero = encode_image(image::ImageFormat::Jpeg, 12, 9);
        let backdrop = encode_image(image::ImageFormat::WebP, 12, 9);
        let icon = minimal_ttf();
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>"#;

        let zip_path = root.join("e2e-assets.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in [
            (
                MANIFEST_FILE,
                serde_json::to_string(&manifest()).unwrap().into_bytes(),
            ),
            (TOKENS_FILE, tokens_json().into_bytes()),
            ("preview/logo.png", logo.clone()),
            ("preview/hero.jpg", hero.clone()),
            ("preview/bg.webp", backdrop.clone()),
            ("preview/icon.ttf", icon.clone()),
            ("preview/icon.svg", svg.to_vec()),
            ("preview/readme.md", b"# Aurora".to_vec()),
        ] {
            writer
                .start_file(name, options)
                .expect("could not start file");
            writer.write_all(&body).expect("could not write file body");
        }
        writer.finish().expect("could not finish the package");

        let preview =
            stage_for_preview(&root, &zip_path, &[]).expect("a real multi-asset theme must import");

        assert_eq!(preview.file_count, 8);
        let staged = staging_dir(&root, &preview);
        for asset in [
            "preview/logo.png",
            "preview/hero.jpg",
            "preview/bg.webp",
            "preview/icon.ttf",
            "preview/icon.svg",
            "preview/readme.md",
        ] {
            assert!(staged.join(asset).is_file(), "{asset} must be staged");
        }
        assert_eq!(
            std::fs::read(staged.join("preview/logo.png")).unwrap(),
            logo
        );
        assert_eq!(
            std::fs::read(staged.join("preview/bg.webp")).unwrap(),
            backdrop
        );
        assert_eq!(
            std::fs::read(staged.join("preview/icon.ttf")).unwrap(),
            icon
        );
    }

    /// A real font, in each of the three containers, produced by an actual
    /// font toolchain rather than by this test — the hand-built fixtures above
    /// cannot exercise a WOFF2 whose `glyf` really is transformed, which is
    /// the common shape of every WOFF2 in the wild.
    const REAL_TTF: &str =
        "AAEAAAAGAEAAAgAgZ2x5ZgAAAAAAAADwAAAAAWhlYWQpdvuHAAAAbAAAADZoaGVhGEcPPAAAAKQAAAAkaG10eAgA\
        AAAAAADoAAAABGxvY2EAAAAAAAAA7AAAAARtYXhwBCgBZgAAAMgAAAAgAAEAAAACWZmbYwF1Xw889QAfCAAAAAAA\
        0ocefAAAAADmzDgRABf91BDYCJAAAAAIAAIAAAAAAAAAAQAAB23+HQAAER0AAAAAENgAAQAAAAAAAAAAAAAAAAAA\
        AAEAAQAAAAEAmAAEAAAAAAACABAAmQAHAAAECwAzAAAAAAgAAAAAAAAAAAAAAA==";
    const REAL_WOFF: &str =
        "d09GRgABAAAAAAEoAAYAAAAAAPQAAlmZAAAAAAAAAAAAAAAAAAAAAAAAAABnbHlmAAABJAAAAAEAAAABAAAAAGhl\
        YWQAAACkAAAANgAAADYpdvuHaGhlYQAAANwAAAAgAAAAJBhHDzxobXR4AAABHAAAAAQAAAAECAAAAGxvY2EAAAEg\
        AAAABAAAAAQAAAAAbWF4cAAAAPwAAAAgAAAAIAQoAWYAAQAAAAJZmZtjAXVfDzz1AB8IAAAAAADShx58AAAAAObM\
        OBEAF/3UENgIkAAAAAgAAgAAAAAAAHicY2BkYGDP/SfLwCAoy8DAwCBwg4GRARUwAgBFUAKpAAEAAAABAJgABAAA\
        AAAAAgAQAJkABwAABAsAMwAAAAAIAAAAAAAAAAAAAAA=";
    const REAL_WOFF2: &str =
        "d09GMgABAAAAAACoAAYAAAAAAPQAAABqAAJZmQAAAAAAAAAAAAAAAAAAAAAAAAAACgEqATYCJAMECwQABCAbpwD4\
        LwrsxuIM1TpU0ocDK74P4+Ht9v7fbXdb0EVRQhnFcealGgWUWFUHT3/g8EFqhC/qeu1xuMgshAtGRBAgAQBQABDI\
        7WpPjgfALcG7k/mrP200CYJ6/JgW6I8AAESDQDgVkLpLpQxW";

    fn decode_base64(text: &str) -> Vec<u8> {
        // The fixture strings wrap across lines for readability.
        let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
        let mut bytes = Vec::with_capacity(compact.len() / 4 * 3);
        let alphabet = |byte: u8| -> u8 {
            match byte {
                b'A'..=b'Z' => byte - b'A',
                b'a'..=b'z' => byte - b'a' + 26,
                b'0'..=b'9' => byte - b'0' + 52,
                b'+' => 62,
                b'=' => 0,
                _ => 63,
            }
        };
        for chunk in compact.as_bytes().chunks(4) {
            let mut value = 0u32;
            for byte in chunk {
                value = (value << 6) | u32::from(alphabet(*byte));
            }
            let padding = chunk.iter().filter(|byte| **byte == b'=').count();
            let out = value.to_be_bytes();
            bytes.extend_from_slice(&out[1..4 - padding]);
        }
        bytes
    }

    #[test]
    fn fonts_from_a_real_toolchain_are_accepted_in_every_container() {
        for (extension, fixture) in [
            ("ttf", REAL_TTF),
            ("woff", REAL_WOFF),
            ("woff2", REAL_WOFF2),
        ] {
            let bytes = decode_base64(fixture);
            let name = format!("art/icon.{extension}");

            sniff_asset(&name, extension, &bytes)
                .unwrap_or_else(|e| panic!("a real {extension} font must be accepted: {e}"));
        }
    }

    /// The same real bytes, renamed: the container is read from the content, so
    /// a `.ttf` holding WOFF2 still fails.
    #[test]
    fn a_real_font_under_the_wrong_extension_is_still_refused() {
        let bytes = decode_base64(REAL_WOFF2);

        let error = sniff_asset("art/icon.ttf", "ttf", &bytes).unwrap_err();

        assert!(
            error.contains("not a readable font"),
            "message was: {error}"
        );
    }
}
