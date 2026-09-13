//! The gate a theme's `styles.css` passes before it is ever served or
//! installed: [`validate_css`] classifies the file and never rewrites it, so
//! whatever the caller holds after a pass is byte-identical to what was
//! validated.
//!
//! Not a linter. Six constructs are refused outright and every `url(...)` must
//! stay inside the theme package; unknown selectors, unknown property values
//! and other harmless-but-broken CSS are none of its business. A refusal is
//! always the whole file — never strip the offending rule and serve the rest —
//! and the source arrives as a `&str`: no file I/O, no `AppHandle`.

use std::borrow::Cow;

use cssparser::{ParseError, Parser, Token};

/// Refused before the file is tokenized at all: a case-insensitive substring
/// scan of the raw source is the cheapest gate. First the remote stylesheet
/// load, then the legacy script-execution hooks — no engine this project ships
/// runs those, but a theme must not carry them.
const BANNED: [&str; 6] = [
    "@import",
    "expression(",
    "-moz-binding",
    "behavior:",
    "javascript:",
    "vbscript:",
];

/// A `url()` this gate cannot read as a single URL, and so cannot vouch for.
const UNREADABLE_URL: &str =
    "This theme's styles.css has a `url(...)` that is not a single readable URL, so it cannot be checked.";

/// Refuse `source` unless it is a stylesheet a theme may serve.
///
/// Cheap checks first, the way `theme::archive` orders its gates: the banned
/// constructs are found by substring before the file is tokenized, and then
/// every `url(...)` in it is classified.
// Nothing calls this yet — wiring it into import and serve is a later
// package's work — so the lib target would otherwise warn that it is unused.
#[allow(dead_code)]
pub fn validate_css(source: &str) -> Result<(), String> {
    if let Some(construct) = BANNED
        .iter()
        .copied()
        .find(|construct| contains_ignore_case(source, construct))
    {
        return Err(banned_error(construct));
    }

    walk(&mut Parser::new(source)).map_err(|error| error.to_string())
}

/// Whether `haystack` holds `needle`, ASCII-case-insensitively. Borrows both
/// and allocates nothing: the needles are the six ASCII constructs above, not
/// anything a theme author writes.
fn contains_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack
        .as_bytes()
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

/// What one token means to the walk: a block to descend into, a `url("…")` to
/// read, or nothing.
enum Step {
    Ignore,
    Block,
    UrlFunction,
}

/// Every token in `parser`, at any nesting depth.
///
/// `url(x)` arrives as a url token and `url("x")` as a `url` function, so both
/// are read; the at-keyword is checked here because an escape (`@\69 mport`)
/// tokenizes to `@import` while the raw scan above sees none.
fn walk(parser: &mut Parser<'_>) -> Result<(), ParseError<String>> {
    loop {
        let step = match parser.next_including_whitespace_and_comments() {
            Ok(Token::UnquotedUrl(url)) => {
                check_url(url).map_err(ParseError::custom)?;
                Step::Ignore
            }
            // A `url(...)` the tokenizer could not read is refused rather than
            // taken as its raw text: the argument is exactly what this gate
            // exists to inspect, and a browser drops such a declaration anyway.
            Ok(Token::BadUrl(_)) => return Err(ParseError::custom(UNREADABLE_URL)),
            Ok(Token::Function(name)) if name.eq_ignore_ascii_case("url") => Step::UrlFunction,
            Ok(Token::AtKeyword(name)) if name.eq_ignore_ascii_case("import") => {
                return Err(ParseError::custom(banned_error("@import")))
            }
            Ok(Token::Function(_))
            | Ok(Token::ParenthesisBlock)
            | Ok(Token::SquareBracketBlock)
            | Ok(Token::CurlyBracketBlock) => Step::Block,
            Ok(_) => Step::Ignore,
            Err(_) => return Ok(()),
        };

        match step {
            Step::Ignore => {}
            Step::Block => parser.parse_nested_block(walk)?,
            Step::UrlFunction => {
                let argument = parser.parse_nested_block(string_argument)?;
                check_url(&argument).map_err(ParseError::custom)?;
            }
        }
    }
}

/// The single string `url("…")` holds, which the tokenizer hands back as a
/// `url` function rather than as a url token.
///
/// Anything else — no string, or more than one — is refused rather than
/// skipped: a `url()` this gate cannot read is a URL it cannot vouch for, and
/// the declaration is one a browser would drop anyway.
fn string_argument(parser: &mut Parser<'_>) -> Result<String, ParseError<String>> {
    let mut argument: Option<String> = None;
    while let Ok(token) = parser.next_including_whitespace_and_comments() {
        match token {
            Token::WhiteSpace(_) | Token::Comment(_) => {}
            Token::QuotedString(value) if argument.is_none() => argument = Some(value.to_string()),
            _ => return Err(ParseError::custom(UNREADABLE_URL)),
        }
    }
    argument.ok_or_else(|| ParseError::custom(UNREADABLE_URL))
}

/// Refuse a `url()` argument that reaches outside the theme package.
fn check_url(url: &str) -> Result<(), String> {
    // A URL parser drops tabs and newlines anywhere in its input before
    // resolving, where the tokenizer keeps them: `url("ht\74 ps://…")` and a
    // `\a `-split `javascript:` are both schemes by the time they run.
    let url = if url.contains(['\t', '\n', '\r']) {
        Cow::Owned(url.replace(['\t', '\n', '\r'], ""))
    } else {
        Cow::Borrowed(url)
    };
    let url = url.trim();

    // `data:` bytes are inline and reach nothing; every other scheme fetches
    // while the theme renders, which a theme stylesheet may not do.
    if let Some(scheme) = scheme_of(url) {
        return if scheme.eq_ignore_ascii_case("data") {
            Ok(())
        } else {
            Err(format!(
                "This theme's styles.css loads `{url}`, a remote URL — a theme may only reference paths inside its own package or `data:` URIs."
            ))
        };
    }
    if url.starts_with("//") {
        return Err(format!(
            "This theme's styles.css loads `{url}`, a scheme-relative URL — a theme may only reference paths inside its own package or `data:` URIs."
        ));
    }
    // `\` counts as a separator: the URL parser reads it as one for the schemes
    // a launcher can be served from, so `..\x` walks out just as `../x` does.
    if url.split(['/', '\\']).any(|segment| segment == "..") {
        return Err(format!(
            "This theme's styles.css loads `{url}`, which walks out of the theme package with a `..` segment."
        ));
    }
    Ok(())
}

/// The scheme of an absolute URL — the RFC 3986 `scheme:` prefix — or `None`
/// for a relative reference. A network-path reference (`//host/x`) has none,
/// and [`check_url`] refuses that one by name.
fn scheme_of(url: &str) -> Option<&str> {
    let scheme = url.split_once(':')?.0;
    let mut bytes = scheme.bytes();
    let first = bytes.next()?;
    let rest_is_scheme =
        bytes.all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.'));
    (first.is_ascii_alphabetic() && rest_is_scheme).then_some(scheme)
}

fn banned_error(construct: &str) -> String {
    format!(
        "This theme's styles.css contains `{construct}`, which a theme stylesheet must not use."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Asserts the whole file is refused, by a message naming the construct found.
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
        // Spelled with an escape, so the raw substring scan cannot see it; the
        // tokenizer still reads an `@import`, and the file is refused for one.
        rejects(r#"@\69 mport "other.css";"#, "@import");
    }

    #[test]
    fn an_expression_function_is_refused() {
        rejects("body { width: expression(alert(1)); }", "expression(");
    }

    #[test]
    fn a_moz_binding_is_refused() {
        rejects("body { -moz-binding: url(evil.xml#x); }", "-moz-binding");
    }

    #[test]
    fn a_behavior_property_is_refused() {
        rejects("body { behavior: url(evil.htc); }", "behavior:");
    }

    #[test]
    fn a_javascript_url_is_refused() {
        rejects("a { background: url(javascript:alert(1)); }", "javascript:");
    }

    #[test]
    fn a_vbscript_url_is_refused() {
        rejects("a { background: url(vbscript:msgbox(1)); }", "vbscript:");
    }

    #[test]
    fn a_remote_url_is_refused() {
        rejects(
            "a { background: url(https://evil.example/x.png); }",
            "https://evil.example/x.png",
        );
        rejects(
            r#"a { background: url("https://evil.example/x.png"); }"#,
            "https://evil.example/x.png",
        );
    }

    #[test]
    fn an_escaped_remote_url_is_refused() {
        // `\3a ` is `:` and `\74` is `t`: no scheme in the raw source, a scheme
        // to the tokenizer.
        rejects(
            r#"a { background: url("https\3a //evil.example/x.png"); }"#,
            "https://evil.example/x.png",
        );
        rejects(
            r#"a { background: url("ht\74 ps://evil.example/x.png"); }"#,
            "https://evil.example/x.png",
        );
    }

    #[test]
    fn a_scheme_hidden_behind_a_newline_is_refused() {
        // A URL parser drops the newline `\a ` inserted, turning this into
        // `javascript:`, which the raw scan never saw.
        rejects(
            r#"a { background: url("java\a script:alert(1)"); }"#,
            "javascript:",
        );
    }

    #[test]
    fn a_scheme_relative_url_is_refused() {
        rejects(
            "a { background: url(//evil.example/x.png); }",
            "//evil.example/x.png",
        );
    }

    #[test]
    fn a_parent_segment_is_refused() {
        rejects("a { background: url(../secret.png); }", "../secret.png");
        rejects("a { background: url(x/../../secret.png); }", "x/../../");
        rejects(
            r#"a { background: url("assets/../secret.png"); }"#,
            "assets/../secret.png",
        );
    }

    #[test]
    fn an_escaped_parent_segment_is_refused() {
        // `\2e` is `.` and `\2f` is `/`: hidden from the raw scan, a `..` path
        // to the tokenizer.
        rejects(
            r"a { background: url(\2e\2e/secret.png); }",
            "../secret.png",
        );
        rejects(
            r#"a { background: url("assets\2f ..\2f secret.png"); }"#,
            "assets/../secret.png",
        );
    }

    #[test]
    fn a_separator_hidden_behind_a_backslash_is_refused() {
        // `\\` is one `\`, which the URL parser reads as a separator.
        rejects(r"a { background: url(..\\secret.png); }", r"..\secret.png");
    }

    #[test]
    fn an_unreadable_url_argument_is_refused() {
        rejects(
            r#"a { background: url("a" "https://evil.example/x"); }"#,
            "not a single readable URL",
        );
        rejects(
            "a { background: url(var(--bg)); }",
            "not a single readable URL",
        );
    }

    #[test]
    fn the_token_slot_rule_passes() {
        validate_css(r#"[data-tetra-slot="server.row"] { border-radius: 2px; }"#)
            .expect("a token rule must pass");
    }

    #[test]
    fn a_relative_url_passes() {
        validate_css("a { background: url(assets/bg.png); }").expect("must pass");
        validate_css(r#"a { background: url("assets/bg.png"); }"#).expect("must pass");
        validate_css("a { background: url(./assets/bg.png); }").expect("must pass");
    }

    #[test]
    fn a_data_url_passes() {
        validate_css("a { background: url(data:image/png;base64,iVBORw0KGgo=); }")
            .expect("must pass");
        validate_css(r#"a { background: url("data:image/svg+xml;utf8,<svg/>"); }"#)
            .expect("must pass");
        validate_css("a { background: url(DATA:image/png;base64,AA==); }").expect("must pass");
    }

    #[test]
    fn harmless_unknown_css_passes() {
        // Not a linter: an unknown property, an unknown selector and a missing
        // brace are still a servable file.
        validate_css(
            "@media (min-width: 1px) { .nope:hover::before { -unknown-thing: 3 silly; } }",
        )
        .expect("must pass");
        validate_css(".nope { color: notacolor;").expect("must pass");
        validate_css("").expect("an empty stylesheet must pass");
    }
}
