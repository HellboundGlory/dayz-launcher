//! An installed theme's `theme.json`. camelCase field names: a theme author
//! writes these directly. `tokens.json` has no counterpart here — it stays an
//! opaque [`serde_json::Value`] (see [`crate::theme`]).

pub const SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePreview {
    pub file: String,
    pub caption: String,
}

/// `default` so a manifest from an older build still loads, missing fields at
/// their defaults instead of failing to parse.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ThemeManifest {
    pub schema_version: u32,
    /// Also the theme's directory name under `themes/` — see `theme::is_usable_id`.
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    /// The token API `tokens.json` is written against.
    pub theme_api: String,
    pub minimum_launcher_version: String,
    /// Kept for v1 manifests' display metadata; no gate uses it.
    pub tier: String,
    pub description: String,
    pub preview: Option<String>,
    pub previews: Vec<ThemePreview>,
    pub license: Option<String>,
    pub homepage: Option<String>,
    pub tags: Vec<String>,
    pub capabilities: Vec<String>,
}

impl Default for ThemeManifest {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            id: String::new(),
            name: String::new(),
            author: String::new(),
            version: String::new(),
            theme_api: "2.0".to_string(),
            minimum_launcher_version: String::new(),
            tier: String::new(),
            description: String::new(),
            preview: None,
            previews: Vec::new(),
            license: None,
            homepage: None,
            tags: Vec::new(),
            capabilities: Vec::new(),
        }
    }
}
