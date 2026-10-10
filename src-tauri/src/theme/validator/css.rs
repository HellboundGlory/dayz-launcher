use std::collections::HashSet;

use cssparser::{ParseError, Parser, Token};

use super::{Severity, ValidationIssue};

const BANNED_CONSTRUCTS: [&str; 6] = [
    "expression(",
    "-moz-binding",
    "behavior:",
    "javascript:",
    "vbscript:",
    "@import",
];

const MAX_BLOCK_DEPTH: u32 = 32;

fn is_url_function(name: &str) -> bool {
    [
        "url",
        "image-set",
        "-webkit-image-set",
        "cross-fade",
        "image",
    ]
    .iter()
    .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

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

    parse_rules(&mut parser, file_path, known_classes, false, &mut issues, 0);

    issues
}

fn parse_rules(
    parser: &mut Parser<'_>,
    file_path: &str,
    known_classes: Option<&HashSet<String>>,
    in_font_face: bool,
    issues: &mut Vec<ValidationIssue>,
    depth: u32,
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
                validate_at_rule(
                    parser,
                    &at_name,
                    file_path,
                    known_classes,
                    issues,
                    depth,
                    false,
                );
            }
            _ => {
                parser.reset(&state);
                parse_qualified_rule(
                    parser,
                    file_path,
                    known_classes,
                    in_font_face,
                    issues,
                    depth,
                );
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
    depth: u32,
    inside_style_rule: bool,
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
                        if depth >= MAX_BLOCK_DEPTH {
                            issues.push(nesting_too_deep(file_path, &format!("@{at_name}")));
                            let _ = parser.parse_nested_block(|_| Ok::<(), ParseError<()>>(()));
                        } else {
                            let _ = parser.parse_nested_block(|nested| {
                                if inside_style_rule {
                                    parse_declarations(
                                        nested,
                                        file_path,
                                        known_classes,
                                        false,
                                        issues,
                                        depth + 1,
                                    );
                                } else {
                                    parse_rules(
                                        nested,
                                        file_path,
                                        known_classes,
                                        false,
                                        issues,
                                        depth + 1,
                                    );
                                }
                                Ok::<(), ParseError<()>>(())
                            });
                        }
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
                            parse_keyframes_block(
                                nested,
                                file_path,
                                known_classes,
                                issues,
                                depth + 1,
                            );
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
                            parse_declarations(
                                nested,
                                file_path,
                                known_classes,
                                true,
                                issues,
                                depth + 1,
                            );
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
    known_classes: Option<&HashSet<String>>,
    issues: &mut Vec<ValidationIssue>,
    depth: u32,
) {
    while !parser.is_exhausted() {
        let token = match parser.next_including_whitespace_and_comments() {
            Ok(t) => t,
            Err(_) => break,
        };
        match token {
            Token::CurlyBracketBlock => {
                let _ = parser.parse_nested_block(|nested| {
                    parse_declarations(nested, file_path, known_classes, false, issues, depth);
                    Ok::<(), ParseError<()>>(())
                });
            }
            Token::Semicolon => {}
            _ => {}
        }
    }
}

fn nesting_too_deep(file_path: &str, pointer: &str) -> ValidationIssue {
    ValidationIssue {
        rule_id: "CSS-01".into(),
        severity: Severity::Error,
        file: file_path.into(),
        pointer: pointer.into(),
        message: format!("Nesting depth exceeds {MAX_BLOCK_DEPTH}"),
        hint: None,
    }
}

fn parse_qualified_rule(
    parser: &mut Parser<'_>,
    file_path: &str,
    known_classes: Option<&HashSet<String>>,
    in_font_face: bool,
    issues: &mut Vec<ValidationIssue>,
    depth: u32,
) {
    parse_selector_and_validate(parser, file_path, known_classes, issues);

    let state = parser.state();
    match parser.next_including_whitespace_and_comments() {
        Ok(Token::CurlyBracketBlock) => {
            if depth >= MAX_BLOCK_DEPTH {
                issues.push(nesting_too_deep(file_path, ""));
                let _ = parser.parse_nested_block(|_| Ok::<(), ParseError<()>>(()));
            } else {
                let _ = parser.parse_nested_block(|nested| {
                    parse_declarations(
                        nested,
                        file_path,
                        known_classes,
                        in_font_face,
                        issues,
                        depth + 1,
                    );
                    Ok::<(), ParseError<()>>(())
                });
            }
        }
        Ok(_) => parser.reset(&state),
        Err(_) => {}
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
                            if lower != "before"
                                && lower != "after"
                                && !is_allowed_pseudo_element(&lower)
                            {
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

fn is_allowed_pseudo_element(pseudo: &str) -> bool {
    matches!(
        pseudo,
        "-webkit-scrollbar"
            | "-webkit-scrollbar-thumb"
            | "-webkit-scrollbar-track"
            | "-webkit-scrollbar-corner"
            | "-webkit-slider-thumb"
            | "-webkit-slider-runnable-track"
    )
}

fn parse_declarations(
    parser: &mut Parser<'_>,
    file_path: &str,
    known_classes: Option<&HashSet<String>>,
    in_font_face: bool,
    issues: &mut Vec<ValidationIssue>,
    depth: u32,
) {
    while !parser.is_exhausted() {
        let statement = parser.state();
        let token = match parser.next_including_whitespace_and_comments() {
            Ok(t) => t,
            Err(_) => break,
        };

        match token {
            Token::WhiteSpace(_) | Token::Comment(_) | Token::Semicolon => continue,
            Token::AtKeyword(name) => {
                let at_name = name.to_ascii_lowercase();
                validate_at_rule(
                    parser,
                    &at_name,
                    file_path,
                    known_classes,
                    issues,
                    depth,
                    true,
                );
            }
            Token::CurlyBracketBlock => {
                issues.push(ValidationIssue {
                    rule_id: "CSS-01".into(),
                    severity: Severity::Error,
                    file: file_path.into(),
                    pointer: String::new(),
                    message: "Nested block without a selector is not allowed".into(),
                    hint: None,
                });
                let _ = parser.parse_nested_block(|_| Ok::<(), ParseError<()>>(()));
            }
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

                // A custom property may hold a `{` block as its value; anything
                // else with a block, or an identifier with no colon, is a rule.
                let has_block = declaration_has_block(parser);
                let declaration = colon_found && (property_name.starts_with("--") || !has_block);
                if !declaration {
                    if has_block {
                        parser.reset(&statement);
                        parse_qualified_rule(
                            parser,
                            file_path,
                            known_classes,
                            false,
                            issues,
                            depth,
                        );
                    } else {
                        issues.push(ValidationIssue {
                            rule_id: "CSS-01".into(),
                            severity: Severity::Error,
                            file: file_path.into(),
                            pointer: property_name.clone(),
                            message: format!("Declaration '{property_name}' is missing ':'"),
                            hint: None,
                        });
                        skip_statement(parser);
                    }
                    continue;
                }

                let mut value_tokens = Vec::new();
                let mut urls = Vec::new();
                let mut is_important = false;
                let mut sink = TokenSink {
                    tokens: &mut value_tokens,
                    urls: &mut urls,
                    issues: &mut *issues,
                    property: &property_name,
                    file: file_path,
                };

                parse_declaration_value(parser, &mut sink, &mut is_important);

                validate_declaration(
                    &property_name,
                    &value_tokens,
                    &urls,
                    is_important,
                    file_path,
                    in_font_face,
                    issues,
                );
            }
            _ => {
                parser.reset(&statement);
                parse_qualified_rule(parser, file_path, known_classes, false, issues, depth);
            }
        }
    }
}

/// Whether the declaration value starting at the parser's position holds a
/// top-level `{` block (a nested rule rather than a declaration value).
fn declaration_has_block(parser: &mut Parser<'_>) -> bool {
    let state = parser.state();
    let mut found = false;
    while !parser.is_exhausted() {
        let token = match parser.next_including_whitespace_and_comments() {
            Ok(t) => t,
            Err(_) => break,
        };
        match token {
            Token::Semicolon => break,
            Token::CurlyBracketBlock => {
                found = true;
                break;
            }
            Token::Function(_) | Token::ParenthesisBlock | Token::SquareBracketBlock => {
                let _ = parser.parse_nested_block(|_| Ok::<(), ParseError<()>>(()));
            }
            _ => {}
        }
    }
    parser.reset(&state);
    found
}

fn skip_statement(parser: &mut Parser<'_>) {
    while !parser.is_exhausted() {
        match parser.next_including_whitespace_and_comments() {
            Ok(Token::Semicolon) => break,
            Ok(Token::Function(_) | Token::ParenthesisBlock | Token::SquareBracketBlock) => {
                let _ = parser.parse_nested_block(|_| Ok::<(), ParseError<()>>(()));
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
}

struct TokenSink<'a, 'i> {
    tokens: &'a mut Vec<Token<'i>>,
    urls: &'a mut Vec<String>,
    issues: &'a mut Vec<ValidationIssue>,
    property: &'a str,
    file: &'a str,
}

fn parse_declaration_value<'i>(
    parser: &mut Parser<'i>,
    sink: &mut TokenSink<'_, 'i>,
    is_important: &mut bool,
) {
    while !parser.is_exhausted() {
        let v = match parser.next_including_whitespace_and_comments() {
            Ok(t) => t,
            Err(_) => break,
        };
        match v {
            Token::Semicolon => break,
            Token::Delim('!') => {
                *is_important = true;
            }
            Token::Ident(id) if id.eq_ignore_ascii_case("important") => {
                *is_important = true;
            }
            Token::UnquotedUrl(url) => {
                sink.urls.push(url.to_string());
                sink.tokens.push(Token::UnquotedUrl(url.clone()));
            }
            Token::BadUrl(s) => scan_bad_url(s, sink),
            Token::Function(_)
            | Token::ParenthesisBlock
            | Token::SquareBracketBlock
            | Token::CurlyBracketBlock => {
                let opener = v.clone();
                collect_block(parser, sink, opener, false, 0);
            }
            t => sink.tokens.push(t.clone()),
        }
    }
}

fn collect_nested_tokens<'i>(
    parser: &mut Parser<'i>,
    sink: &mut TokenSink<'_, 'i>,
    url_context: bool,
    depth: u32,
) {
    while !parser.is_exhausted() {
        let v = match parser.next_including_whitespace_and_comments() {
            Ok(t) => t,
            Err(_) => break,
        };
        match v {
            Token::UnquotedUrl(url) => {
                sink.urls.push(url.to_string());
                sink.tokens.push(Token::UnquotedUrl(url.clone()));
            }
            Token::BadUrl(s) => scan_bad_url(s, sink),
            Token::Function(_)
            | Token::ParenthesisBlock
            | Token::SquareBracketBlock
            | Token::CurlyBracketBlock => {
                let opener = v.clone();
                collect_block(parser, sink, opener, url_context, depth);
            }
            Token::QuotedString(s) => {
                if url_context {
                    sink.urls.push(s.to_string());
                }
                sink.tokens.push(Token::QuotedString(s.clone()));
            }
            t => sink.tokens.push(t.clone()),
        }
    }
}

fn collect_block<'i>(
    parser: &mut Parser<'i>,
    sink: &mut TokenSink<'_, 'i>,
    opener: Token<'i>,
    url_context: bool,
    depth: u32,
) {
    let child_url_context =
        url_context || matches!(&opener, Token::Function(name) if is_url_function(name));
    let closer = match &opener {
        Token::SquareBracketBlock => Token::CloseSquareBracket,
        Token::CurlyBracketBlock => Token::CloseCurlyBracket,
        _ => Token::CloseParenthesis,
    };

    sink.tokens.push(opener);

    if depth >= MAX_BLOCK_DEPTH {
        sink.issues.push(nesting_too_deep(sink.file, sink.property));
        let _ = parser.parse_nested_block(|_| Ok::<(), ParseError<()>>(()));
    } else {
        let _ = parser.parse_nested_block(|nested| {
            collect_nested_tokens(nested, sink, child_url_context, depth + 1);
            Ok::<(), ParseError<()>>(())
        });
    }

    sink.tokens.push(closer);
}

fn scan_bad_url(raw: &str, sink: &mut TokenSink<'_, '_>) {
    let mut found_banned = false;
    for construct in BANNED_CONSTRUCTS {
        if contains_ignore_case(raw, construct) {
            sink.issues.push(ValidationIssue {
                rule_id: "CSS-05".into(),
                severity: Severity::Error,
                file: sink.file.into(),
                pointer: sink.property.to_string(),
                message: format!("Value contains banned construct '{construct}'"),
                hint: None,
            });
            found_banned = true;
        }
    }
    if !found_banned {
        sink.issues.push(ValidationIssue {
            rule_id: "CSS-07".into(),
            severity: Severity::Error,
            file: sink.file.into(),
            pointer: sink.property.to_string(),
            message: format!("Unreadable url({raw}) in declaration"),
            hint: None,
        });
    }
}

fn validate_declaration(
    prop: &str,
    value_tokens: &[Token<'_>],
    urls: &[String],
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

    for construct in BANNED_CONSTRUCTS {
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

    validate_urls_in_declaration(prop, urls, file_path, in_font_face, issues);
}

fn validate_urls_in_declaration(
    prop: &str,
    urls: &[String],
    file_path: &str,
    in_font_face: bool,
    issues: &mut Vec<ValidationIssue>,
) {
    for url in urls {
        check_url_string(prop, url, file_path, in_font_face, issues);
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
            Token::ParenthesisBlock => buf.push('('),
            Token::SquareBracketBlock => buf.push('['),
            Token::CurlyBracketBlock => buf.push('{'),
            Token::CloseParenthesis => buf.push(')'),
            Token::CloseSquareBracket => buf.push(']'),
            Token::CloseCurlyBracket => buf.push('}'),
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
    fn scrollbar_and_slider_pseudo_elements_pass_bare_or_scoped() {
        let css = r#"
            ::-webkit-scrollbar { width: 6px; }
            ::-webkit-scrollbar-thumb { background: red; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-corner { background: transparent; }
            ::-webkit-slider-thumb { background: var(--accent); }
            ::-webkit-slider-runnable-track { background: var(--border); }
            [data-list="servers"] ::-webkit-scrollbar { width: 10px; }
        "#;
        let issues = validate_css_stylesheet("styles.css", css, None);
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
    fn test_css_01_unrelated_pseudo_element_still_refused() {
        let css = "::selection { color: red; }";
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].rule_id, "CSS-01");
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
    fn urls_inside_functions_are_refused() {
        let values = [
            r#"background: image-set("https://evil.example/a.png" 1x)"#,
            "background: -webkit-image-set(url(https://evil.example/a.png) 1x)",
            "background: var(--x, url(https://evil.example/a.png))",
            "background: cross-fade(url(//evil.example/a.png), url(b.png), 50%)",
            r#"background: image-set("../../secret.png" 1x)"#,
        ];
        for value in values {
            let css = format!("[data-el=\"box\"] {{ {value}; }}");
            let issues = validate_css_stylesheet("styles.css", &css, None);
            assert!(
                issues.iter().any(|i| i.rule_id == "CSS-07"),
                "Expected CSS-07 for `{value}`, got: {issues:#?}"
            );
        }
    }

    #[test]
    fn banned_construct_inside_function_is_refused() {
        let css = r#"[data-el="box"] { width: calc(expression(alert(1))); }"#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert!(
            issues.iter().any(|i| i.rule_id == "CSS-05"),
            "Got: {issues:#?}"
        );
    }

    #[test]
    fn functions_without_urls_pass() {
        let css = r#"
            [data-el="box"] { background: image-set("images/a.png" 1x, "images/a@2x.png" 2x); }
            [data-el="box"] { background: linear-gradient(to right, var(--accent), transparent); }
            [data-el="box"] { color: rgb(0 0 0 / 50%); }
            [data-el="box"] { background: url(images/a.png); }
        "#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert!(issues.is_empty(), "Expected 0 issues, got: {issues:#?}");
    }

    #[test]
    fn strings_outside_url_functions_are_not_urls() {
        let css = r#"
            @font-face { font-family: "X"; src: url("fonts/x.woff2") format("woff2"); }
            [data-el="box"] { font-family: local("Inter"), url("fonts/x.woff2"); }
            [data-el="box"] { --label: var(--x, "note:1"); }
        "#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert!(issues.is_empty(), "Expected 0 issues, got: {issues:#?}");
    }

    #[test]
    fn important_inside_a_function_is_not_a_declaration_flag() {
        let css = "[data-el=\"box\"] { color: var(--a, important); }";
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert!(
            issues.iter().all(|i| i.rule_id != "CSS-01"),
            "Got: {issues:#?}"
        );
    }

    #[test]
    fn a_url_in_a_curly_block_is_refused() {
        let css = "[data-el=\"box\"] { --x: { url(https://evil.example/p.png) }; }";
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert!(
            issues.iter().any(|i| i.rule_id == "CSS-07"),
            "Got: {issues:#?}"
        );
    }

    #[test]
    fn deeply_nested_blocks_are_refused() {
        let open = "(".repeat(200);
        let close = ")".repeat(200);
        let css = format!("[data-el=\"box\"] {{ color: {open}a{close}; }}");
        let issues = validate_css_stylesheet("styles.css", &css, None);
        assert!(
            issues.iter().any(|i| i.rule_id == "CSS-01"),
            "Got: {issues:#?}"
        );
    }

    #[test]
    fn test_css_08_file_size_exceeded() {
        let large_css = "a".repeat(262_145);
        let issues = validate_css_stylesheet("styles.css", &large_css, None);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].rule_id, "CSS-08");
    }

    #[test]
    fn a_nested_rule_is_checked_like_a_top_level_rule() {
        let pairs = [
            (
                r#"[data-el="b"] { .x { background: url(https://evil/p.png) } }"#,
                r#".x { background: url(https://evil/p.png) }"#,
            ),
            (
                r#"[data-el="b"] { & #root, * { display: none !important } }"#,
                "& #root, * { display: none !important }",
            ),
        ];
        for (nested, flat) in pairs {
            let nested_ids: Vec<String> = validate_css_stylesheet("styles.css", nested, None)
                .iter()
                .map(|i| i.rule_id.clone())
                .collect();
            let flat_ids: Vec<String> = validate_css_stylesheet("styles.css", flat, None)
                .iter()
                .map(|i| i.rule_id.clone())
                .collect();
            assert_eq!(
                nested_ids, flat_ids,
                "nested rule in `{nested}` was not checked"
            );
            assert!(!nested_ids.is_empty());
        }
    }

    #[test]
    fn a_url_inside_nested_rules_is_refused() {
        let css =
            r#"[data-el="b"] { [data-el="c"] { .x { background: url(https://evil/p.png) } } }"#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert!(
            issues.iter().any(|i| i.rule_id == "CSS-07"),
            "Got: {issues:#?}"
        );
    }

    #[test]
    fn a_legitimate_nested_rule_passes() {
        let css = r#"[data-el="x"] { &:hover { color: var(--accent); } }"#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert!(issues.is_empty(), "Expected 0 issues, got: {issues:#?}");
    }

    #[test]
    fn nested_rules_deeper_than_the_limit_are_refused() {
        let css = format!("{}{}", "[data-el=\"b\"] {".repeat(40), "}".repeat(40));
        let issues = validate_css_stylesheet("styles.css", &css, None);
        assert!(
            issues.iter().any(|i| i.rule_id == "CSS-01"),
            "Got: {issues:#?}"
        );
    }

    #[test]
    fn a_nested_block_without_a_selector_is_refused() {
        let css = r#"[data-el="b"] { { color: red; } }"#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert!(
            issues.iter().any(|i| i.rule_id == "CSS-01"),
            "Got: {issues:#?}"
        );
    }

    #[test]
    fn a_font_face_src_with_local_then_url_passes() {
        let css = r#"@font-face { font-family: "Inter"; src: local("Inter"), url("fonts/x.woff2") format("woff2"); }"#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert!(issues.is_empty(), "Expected 0 issues, got: {issues:#?}");
    }

    #[test]
    fn a_media_rule_inside_a_style_rule_still_checks_its_declarations() {
        let cases = [
            (
                r#"[data-el="b"] { @media all { &;background:url(https://evil.example/x.png) } }"#,
                "CSS-07",
            ),
            (
                r#"[data-el="b"] { @media all { z-index: 9 !important } }"#,
                "CSS-04",
            ),
            (
                r#"[data-el="b"] { @media all { behavior: url(x.htc) } }"#,
                "CSS-05",
            ),
        ];
        for (css, expected) in cases {
            let issues = validate_css_stylesheet("styles.css", css, None);
            assert!(
                issues.iter().any(|i| i.rule_id == expected),
                "Expected {expected} for `{css}`, got: {issues:#?}"
            );
        }
    }

    #[test]
    fn declarations_in_a_media_rule_inside_a_style_rule_pass() {
        let css = r#"[data-el="x"] { @media (max-width: 600px) { color: var(--accent); } }"#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert!(issues.is_empty(), "Expected 0 issues, got: {issues:#?}");
    }

    #[test]
    fn a_statement_without_a_colon_is_a_bad_declaration() {
        let css = r#"[data-el="b"] { color red; }"#;
        let issues = validate_css_stylesheet("styles.css", css, None);
        assert_eq!(issues.len(), 1, "Got: {issues:#?}");
        assert_eq!(issues[0].rule_id, "CSS-01");
        assert!(
            !issues[0].message.contains("selector"),
            "Expected a declaration error, got: {}",
            issues[0].message
        );
    }

    #[test]
    fn alternating_group_and_style_rules_share_the_one_depth_limit() {
        let mut css = String::from("[data-el=\"b\"] {");
        for _ in 0..20 {
            css.push_str(" @media screen { & {");
        }
        css.push_str(&" } }".repeat(20));
        css.push('}');
        let issues = validate_css_stylesheet("styles.css", &css, None);
        let depth: Vec<&ValidationIssue> = issues
            .iter()
            .filter(|i| i.message.contains("Nesting depth"))
            .collect();
        assert_eq!(depth.len(), 1, "Got: {issues:#?}");
    }
}
