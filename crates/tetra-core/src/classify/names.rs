/// Names DayZ and its templates give a server nobody has renamed. Hosting
/// companies' own defaults are rentals with an owner, so they are not here.
pub const DEFAULT_NAMES: &[&str] = &[
    "example name",
    "dayz server",
    "dayz local server",
    "dayzsa server",
    "test",
    "test server",
];

/// Whether `name` is one of [`DEFAULT_NAMES`], ignoring case and surrounding spaces.
pub fn is_default_name(name: &str) -> bool {
    let name = name.trim();
    DEFAULT_NAMES
        .iter()
        .any(|default| default.eq_ignore_ascii_case(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_names_match_regardless_of_case_and_padding() {
        for name in ["EXAMPLE NAME", " dayz server ", "Test", "dayzsa server"] {
            assert!(is_default_name(name), "{name:?} is a default name");
        }
        for name in [
            "Testing Grounds",
            "Nitrado.net GameServer",
            "",
            "Example Name Ltd",
        ] {
            assert!(!is_default_name(name), "{name:?} is a real name");
        }
    }
}
