//! The gate a theme's `styles.css` passes before it is ever served or installed.

use crate::theme::validator::css::validate_css_stylesheet;

/// Refuse `source` unless it is a valid stylesheet a theme may serve.
pub fn validate_css(source: &str) -> Result<(), String> {
    let issues = validate_css_stylesheet("styles.css", source, None);
    if let Some(first) = issues.first() {
        Err(format!("[{}] {}", first.rule_id, first.message))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rejects(source: &str, construct: &str) {
        let error = validate_css(source).expect_err("must be refused");
        assert!(error.contains(construct), "{error}");
    }

    #[test]
    fn an_at_import_is_refused() {
        rejects(r#"@import "other.css";"#, "@import");
        rejects("@IMPORT url(other.css);", "@import");
    }

    #[test]
    fn an_escaped_at_import_is_refused() {
        rejects(r#"@\69 mport "other.css";"#, "@import");
    }

    #[test]
    fn an_expression_function_is_refused() {
        rejects(
            "[data-el=\"box\"] { width: expression(alert(1)); }",
            "expression(",
        );
    }

    #[test]
    fn a_moz_binding_is_refused() {
        rejects(
            "[data-el=\"box\"] { -moz-binding: url(evil.xml#x); }",
            "-moz-binding",
        );
    }

    #[test]
    fn a_behavior_property_is_refused() {
        rejects(
            "[data-el=\"box\"] { behavior: url(evil.htc); }",
            "behavior:",
        );
    }

    #[test]
    fn a_javascript_url_is_refused() {
        rejects(
            "[data-el=\"link\"] { background: url(javascript:alert(1)); }",
            "javascript:",
        );
    }

    #[test]
    fn a_vbscript_url_is_refused() {
        rejects(
            "[data-el=\"link\"] { background: url(vbscript:msgbox(1)); }",
            "vbscript:",
        );
    }

    #[test]
    fn a_remote_url_is_refused() {
        rejects(
            "[data-el=\"link\"] { background: url(https://evil.example/x.png); }",
            "https://evil.example/x.png",
        );
        rejects(
            r#"[data-el="link"] { background: url("https://evil.example/x.png"); }"#,
            "https://evil.example/x.png",
        );
    }

    #[test]
    fn an_escaped_remote_url_is_refused() {
        rejects(
            r#"[data-el="link"] { background: url("https\3a //evil.example/x.png"); }"#,
            "https://evil.example/x.png",
        );
        rejects(
            r#"[data-el="link"] { background: url("ht\74 ps://evil.example/x.png"); }"#,
            "https://evil.example/x.png",
        );
    }

    #[test]
    fn a_scheme_hidden_behind_a_newline_is_refused() {
        rejects(
            r#"[data-el="link"] { background: url("java\a script:alert(1)"); }"#,
            "javascript:",
        );
    }

    #[test]
    fn a_scheme_relative_url_is_refused() {
        rejects(
            "[data-el=\"link\"] { background: url(//evil.example/x.png); }",
            "//evil.example/x.png",
        );
    }

    #[test]
    fn a_parent_segment_is_refused() {
        rejects(
            "[data-el=\"link\"] { background: url(../secret.png); }",
            "../secret.png",
        );
        rejects(
            "[data-el=\"link\"] { background: url(x/../../secret.png); }",
            "..",
        );
        rejects(
            r#"[data-el="link"] { background: url("assets/../secret.png"); }"#,
            "assets/../secret.png",
        );
    }

    #[test]
    fn an_escaped_parent_segment_is_refused() {
        rejects(
            r"[data-el=link] { background: url(\2e\2e/secret.png); }",
            "..",
        );
        rejects(
            r#"[data-el="link"] { background: url("assets\2f ..\2f secret.png"); }"#,
            "..",
        );
    }

    #[test]
    fn a_separator_hidden_behind_a_backslash_is_refused() {
        rejects(r"[data-el=link] { background: url(..\\secret.png); }", "..");
    }

    #[test]
    fn a_data_url_is_refused() {
        rejects(
            "[data-el=\"link\"] { background: url(data:image/png;base64,iVBORw0KGgo=); }",
            "data:",
        );
    }

    #[test]
    fn the_element_rule_passes() {
        validate_css(r#"[data-el="server.row"] { border-radius: 2px; }"#)
            .expect("an element rule must pass");
    }

    #[test]
    fn a_relative_url_passes() {
        validate_css("[data-el=\"link\"] { background: url(assets/bg.png); }").expect("must pass");
        validate_css(r#"[data-el="link"] { background: url("assets/bg.png"); }"#)
            .expect("must pass");
        validate_css("[data-el=\"link\"] { background: url(./assets/bg.png); }")
            .expect("must pass");
    }

    #[test]
    fn harmless_unknown_css_passes() {
        validate_css(
            "@media (min-width: 1px) { [data-el=\"card\"]:hover::before { -unknown-thing: 3 silly; } }",
        )
        .expect("must pass");
        validate_css("[data-el=\"card\"] { color: notacolor; }").expect("must pass");
        validate_css("").expect("an empty stylesheet must pass");
    }
}
