use std::collections::HashSet;

use cssparser::{ParseError, Parser, Token};

use super::{Severity, ValidationIssue};

/// Validate a CSS stylesheet string according to Theme System SPEC §12.
pub fn validate_css_stylesheet(
    file_path: &str,
    source: &str,
    known_classes: Option<&HashSet<String>>,
) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();

    // CSS-08: Enforce max file size of 256 KB (262,144 bytes)
    if source.len() > 262_144 {
        issues.push(ValidationIssue {
            rule_id: "CSS-08".into(),
            severity: Severity::Error,
            file: file_path.into(),
            pointer: String::new(),
            message: "Stylesheet file size exceeds 256 KB (262,144 bytes)".into(),
            hint: None,
        });
        return issues;
    }

    let mut parser = Parser::new(source);

    parse_rules(&mut parser, file_path, known_classes, false, &mut issues);

    issues
}

fn parse_rules(
    parser: &mut Parser<'_>,
    file_path: &str,
    known_classes: Option<&HashSet<String>>,
    in_font_face: bool,
    issues: &mut Vec<ValidationIssue>,
) {
    while !parser.is_exhausted() {
        let state = parser.state();
        let token = match parser.next_including_whitespace_and_comments() {
            Ok(t) => t,
            Err(_) => break,
        };

        match token {
            Token::WhiteSpace(_) | Token::Comment(_) => continue,
            Token::AtKeyword(name) => {
                let at_name = name.to_ascii_lowercase();
                validate_at_rule(parser, &at_name, file_path, known_classes, issues);
            }
            _ => {
                parser.reset(&state);
                parse_qualified_rule(parser, file_path, known_classes, in_font_face, issues);
            }
        }
    }
}

fn validate_at_rule(
    parser: &mut Parser<'_>,
    at_name: &str,
    file_path: &str,
    known_classes: Option<&HashSet<String>>,
    issues: &mut Vec<ValidationIssue>,
) {
    match at_name {
        "media" => {
            let mut prelude_tokens = Vec::new();
            while !parser.is_exhausted() {
                let token = match parser.next_including_whitespace_and_comments() {
                    Ok(t) => t,
                    Err(_) => break,
                };
                match token {
                    Token::CurlyBracketBlock => {
                        validate_media_prelude_parser(parser, file_path, &prelude_tokens, issues);
                        let _ = parser.parse_nested_block(|nested| {
                            parse_rules(nested, file_path, known_classes, false, issues);
                            Ok::<(), ParseError<()>>(())
                        });
                        break;
                    }
                    Token::Semicolon => {
                        validate_media_prelude_parser(parser, file_path, &prelude_tokens, issues);
                        break;
                    }
                    Token::ParenthesisBlock => {
                        let mut paren_idents = Vec::new();
                        let _ = parser.parse_nested_block(|nested| {
                            while let Ok(t) = nested.next_including_whitespace_and_comments() {
                                if let Token::Ident(id) = t {
                                    paren_idents.push(id.to_string());
                                }
                            }
                            Ok::<(), ParseError<()>>(())
                        });
                        for id in paren_idents {
                            prelude_tokens.push(Token::Ident(id.into()));
                        }
                    }
                    t => prelude_tokens.push(t.clone()),
                }
            }
        }
        "keyframes" => {
            while !parser.is_exhausted() {
                let token = match parser.next_including_whitespace_and_comments() {
                    Ok(t) => t,
                    Err(_) => break,
                };
                match token {
                    Token::CurlyBracketBlock => {
                        let _ = parser.parse_nested_block(|nested| {
                            parse_keyframes_block(nested, file_path, issues);
                            Ok::<(), ParseError<()>>(())
                        });
                        break;
                    }
                    Token::Semicolon => break,
                    _ => {}
                }
            }
        }
        "font-face" => {
            while !parser.is_exhausted() {
                let token = match parser.next_including_whitespace_and_comments() {
                    Ok(t) => t,
                    Err(_) => break,
                };
                match token {
                    Token::CurlyBracketBlock => {
                        let _ = parser.parse_nested_block(|nested| {
                            parse_declarations(nested, file_path, true, issues);
                            Ok::<(), ParseError<()>>(())
                        });
                        break;
                    }
                    Token::Semicolon => break,
                    _ => {}
                }
            }
        }
        _ => {
            // CSS-06: Refuse any other at-rule (@import, @supports, @container, @layer, etc.)
            issues.push(ValidationIssue {
                rule_id: "CSS-06".into(),
                severity: Severity::Error,
                file: file_path.into(),
                pointer: format!("@{at_name}"),
                message: format!("Refused at-rule: @{at_name}"),
                hint: None,
            });

            while !parser.is_exhausted() {
                let token = match parser.next_including_whitespace_and_comments() {
                    Ok(t) => t,
                    Err(_) => break,
                };
                match token {
                    Token::CurlyBracketBlock => {
                        let _ = parser.parse_nested_block(|_| Ok::<(), ParseError<()>>(()));
                        break;
                    }
                    Token::Semicolon => break,
                    _ => {}
                }
            }
        }
    }
}

fn validate_media_prelude_parser(
    _parser: &mut Parser<'_>,
    file_path: &str,
    prelude: &[Token<'_>],
    issues: &mut Vec<ValidationIssue>,
) {
    for token in prelude {
        if let Token::Ident(name) = token {
            let lower = name.to_ascii_lowercase();
            if !is_allowed_media_feature(&lower) {
                issues.push(ValidationIssue {
                    rule_id: "CSS-06".into(),
                    severity: Severity::Error,
                    file: file_path.into(),
                    pointer: format!("@media ({lower})"),
                    message: format!("Media query contains disallowed feature '{lower}'"),
                    hint: None,
                });
            }
        }
    }
}

fn is_allowed_media_feature(feature: &str) -> bool {
    matches!(
        feature,
        "width"
            | "min-width"
            | "max-width"
            | "prefers-reduced-motion"
            | "prefers-color-scheme"
            | "reduce"
            | "dark"
            | "light"
            | "and"
            | "or"
            | "not"
            | "only"
            | "screen"
            | "all"
            | "px"
            | "em"
            | "rem"
    )
}

fn parse_keyframes_block(
    parser: &mut Parser<'_>,
    file_path: &str,
    issues: &mut Vec<ValidationIssue>,
) {
    while !parser.is_exhausted() {
        let token = match parser.next_including_whitespace_and_comments() {
            Ok(t) => t,
            Err(_) => break,
        };
        match token {
            Token::CurlyBracketBlock => {
                let _ = parser.parse_nested_block(|nested| {
                    parse_declarations(nested, file_path, false, issues);
                    Ok::<(), ParseError<()>>(())
                });
            }
            Token::Semicolon => {}
            _ => {}
        }
    }
}

fn parse_qualified_rule(
    parser: &mut Parser<'_>,
    file_path: &str,
    known_classes: Option<&HashSet<String>>,
    in_font_face: bool,
    issues: &mut Vec<ValidationIssue>,
) {
    parse_selector_and_validate(parser, file_path, known_classes, issues);

    if let Ok(token) = parser.next_including_whitespace_and_comments() {
        if matches!(token, Token::CurlyBracketBlock) {
            let _ = parser.parse_nested_block(|nested| {
                parse_declarations(nested, file_path, in_font_face, issues);
                Ok::<(), ParseError<()>>(())
            });
        }
    }
}

fn parse_selector_and_validate(
    parser: &mut Parser<'_>,
    file_path: &str,
    known_classes: Option<&HashSet<String>>,
    issues: &mut Vec<ValidationIssue>,
) {
    let mut expect_ident_is_type = true;

    while !parser.is_exhausted() {
        let state = parser.state();
        let token = match parser.next_including_whitespace_and_comments() {
            Ok(t) => t,
            Err(_) => break,
        };

        match token {
            Token::CurlyBracketBlock => {
                parser.reset(&state);
                break;
            }
            Token::Semicolon => break,
            Token::Comma => {
                expect_ident_is_type = true;
            }
            Token::WhiteSpace(_) | Token::Comment(_) => {
                expect_ident_is_type = true;
            }
            Token::Delim('>') | Token::Delim('+') | Token::Delim('~') => {
                expect_ident_is_type = true;
            }
            Token::Delim('.') => {
                if let Ok(Token::Ident(class_name)) =
                    parser.next_including_whitespace_and_comments()
                {
                    let name = class_name.to_string();
                    if name.starts_with("t-") || name == "t-" {
                        if is_valid_theme_class(&name) {
                            if let Some(known) = known_classes {
                                if !known.contains(&name) {
                                    issues.push(ValidationIssue {
                                        rule_id: "CSS-02".into(),
                                        severity: Severity::Error,
                                        file: file_path.into(),
                                        pointer: format!(".{name}"),
                                        message: format!("Undeclared theme class '.{name}'"),
                                        hint: None,
                                    });
                                }
                            }
                        } else {
                            issues.push(ValidationIssue {
                                rule_id: "CSS-03".into(),
                                severity: Severity::Error,
                                file: file_path.into(),
                                pointer: format!(".{name}"),
                                message: format!("Malformed theme class '.{name}'"),
                                hint: None,
                            });
                        }
                    } else {
                        issues.push(ValidationIssue {
                            rule_id: "CSS-01".into(),
                            severity: Severity::Error,
                            file: file_path.into(),
                            pointer: format!(".{name}"),
                            message: format!("Generic non-theme class '.{name}' is not allowed"),
                            hint: None,
                        });
                    }
                }
                expect_ident_is_type = false;
            }
            Token::Hash(ref name) | Token::IDHash(ref name) => {
                issues.push(ValidationIssue {
                    rule_id: "CSS-01".into(),
                    severity: Severity::Error,
                    file: file_path.into(),
                    pointer: format!("#{name}"),
                    message: format!("ID selector '#{name}' is not allowed"),
                    hint: None,
                });
                expect_ident_is_type = false;
            }
            Token::Delim('*') => {
                issues.push(ValidationIssue {
                    rule_id: "CSS-01".into(),
                    severity: Severity::Error,
                    file: file_path.into(),
                    pointer: "*".into(),
                    message: "Universal selector '*' is not allowed".into(),
                    hint: None,
                });
                expect_ident_is_type = false;
            }
            Token::Ident(ref name) => {
                if expect_ident_is_type {
                    issues.push(ValidationIssue {
                        rule_id: "CSS-01".into(),
                        severity: Severity::Error,
                        file: file_path.into(),
                        pointer: name.to_string(),
                        message: format!("Tag selector '{name}' is not allowed"),
                        hint: None,
                    });
                }
                expect_ident_is_type = false;
            }
            Token::SquareBracketBlock => {
                let attr_name = parser
                    .parse_nested_block(|nested| {
                        let mut first_ident = String::new();
                        while !nested.is_exhausted() {
                            match nested.next_including_whitespace_and_comments() {
                                Ok(Token::Ident(name)) if first_ident.is_empty() => {
                                    first_ident = name.to_string();
                                }
                                Err(_) => break,
                                _ => {}
                            }
                        }
                        Ok::<String, ParseError<()>>(first_ident)
                    })
                    .unwrap_or_default();

                let lower_attr = attr_name.to_ascii_lowercase();
                if !is_allowed_attribute(&lower_attr) {
                    issues.push(ValidationIssue {
                        rule_id: "CSS-01".into(),
                        severity: Severity::Error,
                        file: file_path.into(),
                        pointer: format!("[{attr_name}]"),
                        message: format!("Disallowed attribute selector '[{attr_name}]'"),
                        hint: None,
                    });
                }
                expect_ident_is_type = false;
            }
            Token::Colon => {
                let state2 = parser.state();
                match parser.next_including_whitespace_and_comments() {
                    Ok(Token::Colon) => {
                        if let Ok(Token::Ident(pseudo_el)) =
                            parser.next_including_whitespace_and_comments()
                        {
                            let lower = pseudo_el.to_ascii_lowercase();
                            if lower != "before" && lower != "after" {
                                issues.push(ValidationIssue {
                                    rule_id: "CSS-01".into(),
                                    severity: Severity::Error,
                                    file: file_path.into(),
                                    pointer: format!("::{pseudo_el}"),
                                    message: format!("Disallowed pseudo-element '::{pseudo_el}'"),
                                    hint: None,
                                });
                            }
                        }
                    }
                    Ok(Token::Ident(pseudo_cls)) => {
                        let lower = pseudo_cls.to_ascii_lowercase();
                        if !is_allowed_pseudo_class(&lower) {
                            issues.push(ValidationIssue {
                                rule_id: "CSS-01".into(),
                                severity: Severity::Error,
                                file: file_path.into(),
                                pointer: format!(":{pseudo_cls}"),
                                message: format!("Disallowed pseudo-class ':{pseudo_cls}'"),
                                hint: None,
                            });
                        }
                    }
                    Ok(Token::Function(func_name)) => {
                        let lower = func_name.to_ascii_lowercase();
                        if matches!(lower.as_str(), "not" | "is" | "where") {
                            let _ = parser.parse_nested_block(|nested| {
                                parse_selector_and_validate(
                                    nested,
                                    file_path,
                                    known_classes,
                                    issues,
                                );
                                Ok::<(), ParseError<()>>(())
                            });
                        } else if lower == "nth-child" {
                            let _ = parser.parse_nested_block(|_| Ok::<(), ParseError<()>>(()));
                        } else {
                            issues.push(ValidationIssue {
                                rule_id: "CSS-01".into(),
                                severity: Severity::Error,
                                file: file_path.into(),
                                pointer: format!(":{func_name}(...)"),
                                message: format!(
                                    "Disallowed pseudo-class function ':{func_name}(...)'"
                                ),
                                hint: None,
                            });
                            let _ = parser.parse_nested_block(|_| Ok::<(), ParseError<()>>(()));
                        }
                    }
                    _ => {
                        parser.reset(&state2);
                    }
                }
                expect_ident_is_type = false;
            }
            _ => {
                expect_ident_is_type = false;
            }
        }
    }
}

fn is_valid_theme_class(name: &str) -> bool {
    if !name.starts_with("t-") || name.len() <= 2 {
        return false;
    }
    name[2..]
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_allowed_attribute(attr: &str) -> bool {
    matches!(
        attr,
        "data-el"
            | "data-part"
            | "data-state"
            | "data-context"
            | "data-list"
            | "data-row"
            | "data-column"
            | "data-region"
            | "data-surface"
            | "aria-selected"
            | "aria-pressed"
            | "aria-expanded"
            | "aria-sort"
            | "disabled"
            | "data-tetra-slot"
            | "data-tetra-el"
    )
}

fn is_allowed_pseudo_class(pseudo: &str) -> bool {
    matches!(
        pseudo,
        "hover"
            | "focus"
            | "focus-visible"
            | "active"
            | "disabled"
            | "checked"
            | "first-child"
            | "last-child"
    )
}

fn parse_declarations(
    parser: &mut Parser<'_>,
    file_path: &str,
    in_font_face: bool,
    issues: &mut Vec<ValidationIssue>,
) {
    while !parser.is_exhausted() {
        let token = match parser.next_including_whitespace_and_comments() {
            Ok(t) => t,
            Err(_) => break,
        };

        match token {
            Token::WhiteSpace(_) | Token::Comment(_) | Token::Semicolon => continue,
            Token::Ident(prop_name) => {
                let property_name = prop_name.to_ascii_lowercase();

                let mut colon_found = false;
                while !parser.is_exhausted() {
                    let state = parser.state();
                    let v = match parser.next_including_whitespace_and_comments() {
                        Ok(t) => t,
                        Err(_) => break,
                    };
                    match v {
                        Token::Colon => {
                            colon_found = true;
                            break;
                        }
                        Token::WhiteSpace(_) | Token::Comment(_) => continue,
                        _ => {
                            parser.reset(&state);
                            break;
                        }
                    }
                }

                if !colon_found {
                    continue;
                }

                let mut value_tokens = Vec::new();
                let mut is_important = false;

                while !parser.is_exhausted() {
                    let v = match parser.next_including_whitespace_and_comments() {
                        Ok(t) => t,
                        Err(_) => break,
                    };
                    match v {
                        Token::Semicolon => break,
                        Token::Delim('!') => {
                            is_important = true;
                        }
                        Token::Ident(ref id) if id.eq_ignore_ascii_case("important") => {
                            is_important = true;
                        }
                        Token::UnquotedUrl(url) => {
                            value_tokens.push(Token::UnquotedUrl(url.clone()));
                        }
                        Token::BadUrl(s) => {
                            let raw = s.to_string();
                            let banned_constructs = [
                                "expression(",
                                "-moz-binding",
                                "behavior:",
                                "javascript:",
                                "vbscript:",
                                "@import",
                            ];
                            let mut found_banned = false;
                            for construct in banned_constructs {
                                if contains_ignore_case(&raw, construct) {
                                    issues.push(ValidationIssue {
                                        rule_id: "CSS-05".into(),
                                        severity: Severity::Error,
                                        file: file_path.into(),
                                        pointer: property_name.clone(),
                                        message: format!(
                                            "Value contains banned construct '{construct}'"
                                        ),
                                        hint: None,
                                    });
                                    found_banned = true;
                                }
                            }
                            if !found_banned {
                                issues.push(ValidationIssue {
                                    rule_id: "CSS-07".into(),
                                    severity: Severity::Error,
                                    file: file_path.into(),
                                    pointer: property_name.clone(),
                                    message: format!("Unreadable url({raw}) in declaration"),
                                    hint: None,
                                });
                            }
                        }
                        Token::Function(ref name) if name.eq_ignore_ascii_case("url") => {
                            let url_str = parser
                                .parse_nested_block(|nested| {
                                    let mut buf = String::new();
                                    while let Ok(t) =
                                        nested.next_including_whitespace_and_comments()
                                    {
                                        match t {
                                            Token::QuotedString(s) => {
                                                return Ok::<String, ParseError<()>>(s.to_string())
                                            }
                                            Token::WhiteSpace(_) | Token::Comment(_) => continue,
                                            Token::Ident(s) => buf.push_str(s),
                                            Token::Delim(c) => buf.push(*c),
                                            Token::UnquotedUrl(s) => buf.push_str(s),
                                            _ => {}
                                        }
                                    }
                                    Ok::<String, ParseError<()>>(buf)
                                })
                                .unwrap_or_default();
                            value_tokens.push(Token::QuotedString(url_str.into()));
                        }
                        t => value_tokens.push(t.clone()),
                    }
                }

                validate_declaration(
                    &property_name,
                    &value_tokens,
                    is_important,
                    file_path,
                    in_font_face,
                    issues,
                );
            }
            _ => {}
        }
    }
}

fn validate_declaration(
    prop: &str,
    value_tokens: &[Token<'_>],
    is_important: bool,
    file_path: &str,
    in_font_face: bool,
    issues: &mut Vec<ValidationIssue>,
) {
    if is_important {
        issues.push(ValidationIssue {
            rule_id: "CSS-01".into(),
            severity: Severity::Error,
            file: file_path.into(),
            pointer: prop.into(),
            message: "!important declaration is not allowed in theme rules".into(),
            hint: None,
        });
    }

    if prop == "z-index" {
        issues.push(ValidationIssue {
            rule_id: "CSS-04".into(),
            severity: Severity::Error,
            file: file_path.into(),
            pointer: "z-index".into(),
            message: "Property z-index is refused".into(),
            hint: None,
        });
    }

    if prop == "content" {
        let is_empty_string = value_tokens.iter().all(|t| match t {
            Token::WhiteSpace(_) | Token::Comment(_) => true,
            Token::QuotedString(s) => s.is_empty(),
            _ => false,
        }) && value_tokens
            .iter()
            .any(|t| matches!(t, Token::QuotedString(s) if s.is_empty()));

        if !is_empty_string {
            issues.push(ValidationIssue {
                rule_id: "CSS-05".into(),
                severity: Severity::Error,
                file: file_path.into(),
                pointer: "content".into(),
                message: "content property is only allowed with empty string \"\"".into(),
                hint: None,
            });
        }
    }

    let val_str = value_tokens_to_string(value_tokens);
    let decl_str = format!("{prop}: {val_str}");

    let banned_constructs = [
        "expression(",
        "-moz-binding",
        "behavior:",
        "javascript:",
        "vbscript:",
        "@import",
    ];
    for construct in banned_constructs {
        if contains_ignore_case(&decl_str, construct) {
            issues.push(ValidationIssue {
                rule_id: "CSS-05".into(),
                severity: Severity::Error,
                file: file_path.into(),
                pointer: prop.into(),
                message: format!("Value contains banned construct '{construct}'"),
                hint: None,
            });
        }
    }

    validate_urls_in_declaration(prop, value_tokens, file_path, in_font_face, issues);
}

fn validate_urls_in_declaration(
    prop: &str,
    tokens: &[Token<'_>],
    file_path: &str,
    in_font_face: bool,
    issues: &mut Vec<ValidationIssue>,
) {
    for token in tokens {
        match token {
            Token::UnquotedUrl(url) | Token::QuotedString(url) => {
                check_url_string(prop, url, file_path, in_font_face, issues);
            }
            _ => {}
        }
    }
}

fn check_url_string(
    prop: &str,
    raw_url: &str,
    file_path: &str,
    in_font_face: bool,
    issues: &mut Vec<ValidationIssue>,
) {
    let cleaned = raw_url.replace(['\t', '\n', '\r'], "");
    let url = cleaned.trim();

    if url.is_empty() {
        return;
    }

    if url.starts_with("//") {
        issues.push(ValidationIssue {
            rule_id: "CSS-07".into(),
            severity: Severity::Error,
            file: file_path.into(),
            pointer: prop.into(),
            message: format!("URL '{url}' is a scheme-relative URL"),
            hint: None,
        });
        return;
    }

    if let Some(scheme) = scheme_of(url) {
        issues.push(ValidationIssue {
            rule_id: "CSS-07".into(),
            severity: Severity::Error,
            file: file_path.into(),
            pointer: prop.into(),
            message: format!("URL '{url}' uses prohibited scheme '{scheme}'"),
            hint: None,
        });
        return;
    }

    if url.split(['/', '\\']).any(|segment| segment == "..") {
        issues.push(ValidationIssue {
            rule_id: "CSS-07".into(),
            severity: Severity::Error,
            file: file_path.into(),
            pointer: prop.into(),
            message: format!("URL '{url}' contains path traversal '..'"),
            hint: None,
        });
        return;
    }

    if in_font_face && prop == "src" {
        let normalized = url.strip_prefix("./").unwrap_or(url);
        if !normalized.starts_with("fonts/") {
            issues.push(ValidationIssue {
                rule_id: "CSS-07".into(),
                severity: Severity::Error,
                file: file_path.into(),
                pointer: prop.into(),
                message: format!("@font-face src URL '{url}' must point to files in fonts/"),
                hint: None,
            });
        }
    }
}

fn scheme_of(url: &str) -> Option<&str> {
    let scheme = url.split_once(':')?.0;
    let mut bytes = scheme.bytes();
    let first = bytes.next()?;
    let rest_is_scheme =
        bytes.all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.'));
    (first.is_ascii_alphabetic() && rest_is_scheme).then_some(scheme)
}

fn contains_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack
        .as_bytes()
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

fn value_tokens_to_string(tokens: &[Token<'_>]) -> String {
    let mut buf = String::new();
    for token in tokens {
        match token {
            Token::Ident(s) => buf.push_str(s),
            Token::QuotedString(s) => {
                buf.push('"');
                buf.push_str(s);
                buf.push('"');
            }
            Token::UnquotedUrl(s) => {
                buf.push_str("url(");
                buf.push_str(s);
                buf.push(')');
            }
            Token::Function(name) => {
                buf.push_str(name);
                buf.push('(');
            }
            Token::Delim(c) => buf.push(*c),
            Token::Colon => buf.push(':'),
            Token::Semicolon => buf.push(';'),
            Token::Comma => buf.push(','),
            Token::WhiteSpace(ws) => buf.push_str(ws),
            _ => {}
        }
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_selectors_and_at_rules_pass() {
        let css = r#"
            @media (min-width: 900px) and (prefers-reduced-motion: reduce) {
                [data-el="server.join"] { color: var(--accent); }
            }
            @keyframes fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @font-face {
                font-family: "MyFont";
                src: url("fonts/myfont.woff2");
            }
            [data-el="server.players"] [data-part="caption"] { display: flex; }
            [data-el="server.join"][data-state~="busy"] { opacity: 0.5; }
            [data-context="selection"] [data-el="server.name"] { font-weight: bold; }
            .t-detail-rail { border-radius: 4px; }
            [data-list="servers"] [data-row][data-state~="selected"] [data-column="players"] { color: red; }
            [data-el="button"]:hover, [data-el="button"]:focus-visible, [data-el="button"]:active { outline: none; }
            [data-el="button"]:not([data-state~="disabled"]):is([data-context="selection"]) { cursor: pointer; }
            [data-el="card"]::before, [data-el="card"]::after { content: ""; }
        "#;
        let mut known = HashSet::new();
        known.insert("t-detail-rail".to_string());
        let issues = validate_css_stylesheet("styles.css", css, Some(&known));
        assert!(issues.is_empty(), "Expected 0 issues, got: {issues:#?}");
    }

    #[test]
    fn test_css_01_refused_selectors_and_important() {
        let css = r#"
            div { color: red; }
            #header { background: blue; }
            .generic-class { display: block; }
            [href="http://example.com"] { color: green; }
            [data-el="button"] { color: red !important; }
            [data-el="button"]:focus { outline: none; }
            [data-el="button"]::placeholder { color: gray; }
        "#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        let rules: Vec<&str> = issues.iter().map(|i| i.rule_id.as_str()).collect();
        assert!(
            rules.iter().all(|r| *r == "CSS-01"),
            "Expected all CSS-01, got: {rules:?}"
        );
    }

    #[test]
    fn test_css_02_undeclared_theme_class() {
        let css = ".t-unknown-class { color: red; }";
        let known = HashSet::new();
        let issues = validate_css_stylesheet("styles.css", css, Some(&known));
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].rule_id, "CSS-02");
    }

    #[test]
    fn test_css_03_malformed_theme_class() {
        let css = ".t-FooClass { color: red; } .t-foo_bar { color: blue; } .t- { color: green; }";
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert_eq!(issues.len(), 3);
        assert!(issues.iter().all(|i| i.rule_id == "CSS-03"));
    }

    #[test]
    fn test_css_04_z_index_refused() {
        let css = "[data-el=\"box\"] { z-index: 100; }";
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].rule_id, "CSS-04");
    }

    #[test]
    fn test_css_05_content_and_legacy_constructs() {
        let css = r#"
            [data-el="box"]::before { content: "hello"; }
            [data-el="box"] { width: expression(alert(1)); }
            [data-el="box"] { -moz-binding: url(evil.xml); }
            [data-el="box"] { behavior: url(evil.htc); }
            [data-el="box"] { background: url(javascript:alert(1)); }
            [data-el="box"] { background: url(vbscript:msgbox(1)); }
        "#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert!(
            issues.iter().all(|i| i.rule_id == "CSS-05"),
            "Got issues: {issues:#?}"
        );
    }

    #[test]
    fn test_css_06_refused_at_rules_and_media_features() {
        let css = r#"
            @import "other.css";
            @supports (display: grid) { [data-el="box"] { display: grid; } }
            @container (min-width: 100px) { [data-el="box"] { color: red; } }
            @layer theme { [data-el="box"] { color: red; } }
            @media (min-height: 500px) { [data-el="box"] { color: red; } }
        "#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert_eq!(issues.len(), 5);
        assert!(issues.iter().all(|i| i.rule_id == "CSS-06"));
    }

    #[test]
    fn test_css_07_invalid_urls() {
        let css = r#"
            [data-el="box"] { background: url("https://example.com/image.png"); }
            [data-el="box"] { background: url("//example.com/image.png"); }
            [data-el="box"] { background: url("data:image/png;base64,1234"); }
            [data-el="box"] { background: url("../secret.png"); }
            @font-face { font-family: "Foo"; src: url("myfont.woff2"); }
        "#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert_eq!(issues.len(), 5);
        assert!(
            issues.iter().all(|i| i.rule_id == "CSS-07"),
            "Got issues: {issues:#?}"
        );
    }

    #[test]
    fn test_css_08_file_size_exceeded() {
        let large_css = "a".repeat(262_145);
        let issues = validate_css_stylesheet("styles.css", &large_css, None);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].rule_id, "CSS-08");
    }
}
