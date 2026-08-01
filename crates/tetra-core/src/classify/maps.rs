/// Vanilla and first-party maps whose engine name differs from what players
/// call them. Community maps are not listed; they display their raw name,
/// which is what their authors intended.
const KNOWN: &[(&str, &str)] = &[
    ("chernarusplus", "Chernarus"),
    ("chernarusplusgloom", "Chernarus (Gloom)"),
    ("enoch", "Livonia"),
    ("enochgloom", "Livonia (Gloom)"),
    ("sakhal", "Sakhal"),
    ("deerisle", "Deer Isle"),
    ("namalsk", "Namalsk"),
    ("banov", "Banov"),
    ("chiemsee", "Chiemsee"),
    ("takistanplus", "Takistan"),
    ("pripyat", "Pripyat"),
    ("livonia", "Livonia"),
];

/// Grouping key for a map name: trimmed and lowercased.
pub fn normalise_map(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

/// Human-facing label. Unknown maps pass through with original casing.
pub fn display_name(raw: &str) -> String {
    let key = normalise_map(raw);
    KNOWN
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, label)| (*label).to_string())
        .unwrap_or_else(|| raw.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_case_variants_together() {
        assert_eq!(normalise_map("chernarusplus"), "chernarusplus");
        assert_eq!(normalise_map("ChernarusPlus"), "chernarusplus");
        assert_eq!(normalise_map("  DeerIsle  "), "deerisle");
    }

    #[test]
    fn gives_friendly_names_to_known_maps() {
        assert_eq!(display_name("chernarusplus"), "Chernarus");
        assert_eq!(display_name("ChernarusPlus"), "Chernarus");
        assert_eq!(display_name("enoch"), "Livonia");
        assert_eq!(display_name("sakhal"), "Sakhal");
        assert_eq!(display_name("deerisle"), "Deer Isle");
        assert_eq!(display_name("namalsk"), "Namalsk");
    }

    #[test]
    fn passes_unknown_modded_maps_through_unchanged() {
        assert_eq!(display_name("GreenCounty"), "GreenCounty");
        assert_eq!(display_name("Azalea"), "Azalea");
    }

    #[test]
    fn handles_empty_input() {
        assert_eq!(normalise_map(""), "");
        assert_eq!(display_name(""), "");
    }
}
