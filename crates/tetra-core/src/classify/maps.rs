/// Vanilla and first-party maps whose engine name differs from what players
/// call them. Community maps are not listed; they display their raw name,
/// which is what their authors intended.
const KNOWN: &[(&str, &str)] = &[
    ("chernarusplus", "Chernarus"),
    ("chernarusplusgloom", "Chernarus (Gloom)"),
    ("enoch", "Livonia"),
    ("enochgloom", "Livonia (Gloom)"),
    ("sakhal", "Sakhal"),
    ("nasdara", "Nasdara"),
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

/// Engine keys whose player-facing label contains `term`, ASCII case-insensitive,
/// so a search for a map's common name finds the servers running it.
pub fn engine_names_matching(term: &str) -> Vec<&'static str> {
    let needle = term.to_ascii_lowercase();
    KNOWN
        .iter()
        .filter(|(_, label)| label.to_ascii_lowercase().contains(&needle))
        .map(|(key, _)| *key)
        .collect()
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
        // Engine keys are matched case-insensitively.
        assert_eq!(display_name("ChernarusPlus"), "Chernarus");
        assert_eq!(display_name("enoch"), "Livonia");
    }

    #[test]
    fn passes_unknown_modded_maps_through_unchanged() {
        assert_eq!(display_name("GreenCounty"), "GreenCounty");
        assert_eq!(display_name("Azalea"), "Azalea");
    }
}
