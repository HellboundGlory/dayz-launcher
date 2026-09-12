//! The shape of an installed theme's `theme.json`.
//!
//! Field names are camelCase because they are the names a theme author writes
//! and the frontend reads. There is deliberately no counterpart for
//! `tokens.json`: that file stays an opaque [`serde_json::Value`] (see
//! [`crate::theme`]), since what a token means is the frontend's concern.

/// The manifest schema this build writes. A `theme.json` predating the field
/// reads as this version rather than as 0 — see [`ThemeManifest`]'s `Default`.
pub const SCHEMA_VERSION: u32 = 1;

/// One theme's manifest, as `theme.json` on disk. Same conventions as
/// [`crate::commands::settings::AppSettings`]: camelCase, and `default` so a
/// manifest written by an older build still loads with the fields it lacks at
/// their defaults instead of failing to parse.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ThemeManifest {
    /// Schema this manifest is written to, for a future reader to branch on.
    pub schema_version: u32,
    /// The theme's identity, and the name of its directory under `themes/`.
    /// Must be a single path segment — see `theme::is_usable_id`.
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    /// The token API the theme's `tokens.json` is written against.
    pub theme_api: String,
    pub minimum_launcher_version: String,
    /// How much of the theme system it uses: `basic` (tokens only) or `full`.
    pub tier: String,
    pub description: String,
    /// Preview image, relative to the theme's own directory. `None` for a
    /// theme that ships no artwork.
    pub preview: Option<String>,
    pub license: Option<String>,
    pub homepage: Option<String>,
    pub tags: Vec<String>,
    /// What the theme relies on the frontend honouring, `tokens` first.
    pub capabilities: Vec<String>,
}

impl Default for ThemeManifest {
    fn default() -> Self {
        Self {
            // Not `0`: a manifest that predates the field is one this build
            // wrote, and every schema so far has been the current one.
            schema_version: SCHEMA_VERSION,
            id: String::new(),
            name: String::new(),
            author: String::new(),
            version: String::new(),
            theme_api: String::new(),
            minimum_launcher_version: String::new(),
            tier: String::new(),
            description: String::new(),
            preview: None,
            license: None,
            homepage: None,
            tags: Vec::new(),
            capabilities: Vec::new(),
        }
    }
}
