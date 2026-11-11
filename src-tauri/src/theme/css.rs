//! The gate a theme's `styles.css` passes before it is ever served or installed.

use crate::theme::validator::css::validate_css_stylesheet;

/// Refuse `source` unless it is a valid stylesheet a theme may serve.
pub fn validate_css(source: &str) -> Result<(), String> {
    let issues = validate_css_stylesheet("styles.css", source);
    if let Some(first) = issues.first() {
        Err(format!("[{}] {}", first.rule_id, first.message))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// CSS escapes are decoded before a construct is judged, so an escape cannot
    /// hide one the rule would otherwise catch.
    #[test]
    fn a_banned_construct_is_refused_even_when_it_is_escaped() {
        let cases: &[(&str, &str, &str)] = &[
            (
                "moz binding",
                "[data-el=\"box\"] { -moz-binding: url(evil.xml#x); }",
                "-moz-binding",
            ),
            ("at import", r#"@\69 mport "other.css";"#, "@import"),
            (
                "remote url behind an escaped colon",
                r#"[data-el="link"] { background: url("https\3a //evil.example/x.png"); }"#,
                "https://evil.example/x.png",
            ),
            (
                "remote url behind an escaped letter",
                r#"[data-el="link"] { background: url("ht\74 ps://evil.example/x.png"); }"#,
                "https://evil.example/x.png",
            ),
            (
                "scheme behind a newline",
                r#"[data-el="link"] { background: url("java\a script:alert(1)"); }"#,
                "javascript:",
            ),
            (
                "escaped parent segments",
                r"[data-el=link] { background: url(\2e\2e/secret.png); }",
                "..",
            ),
            (
                "parent segments behind escaped separators",
                r#"[data-el="link"] { background: url("assets\2f ..\2f secret.png"); }"#,
                "..",
            ),
            (
                "separator behind a backslash",
                r"[data-el=link] { background: url(..\\secret.png); }",
                "..",
            ),
        ];
        for (label, source, construct) in cases {
            let error = validate_css(source).expect_err("must be refused");
            assert!(error.contains(construct), "{label}: {error}");
        }
    }

    #[test]
    fn a_stylesheet_with_nothing_banned_passes() {
        validate_css("").expect("an empty stylesheet must pass");
        validate_css(r#"[data-el="server.row"] { border-radius: 2px; }"#)
            .expect("an element rule must pass");
        validate_css(r#"[data-el="link"] { background: url(assets/bg.png); }"#)
            .expect("a relative url must pass");
        validate_css("[data-el=\"link\"] { background: url(./assets/bg.png); }")
            .expect("a relative url must pass");
        validate_css("[data-el=\"card\"] { color: notacolor; }")
            .expect("an unknown value must pass");
        validate_css(
            "@media (min-width: 1px) { [data-el=\"card\"]:hover::before { -unknown-thing: 3 silly; } }",
        )
        .expect("harmless unknown css must pass");
    }
}
