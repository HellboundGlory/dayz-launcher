use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde_json::Value;

use super::ast::{Node, NodeKind};
use super::{rules, Severity, ValidationIssue};
use crate::theme::registry::{Multiplicity, Registry};

const SHELL: &str = "layout/shell.json";

#[derive(Default)]
struct Root<'a> {
    start: f64,
    end: Option<f64>,
    elements: BTreeSet<&'a str>,
    placements: BTreeMap<(&'a str, &'a str), String>,
    contexts: BTreeMap<String, BTreeSet<&'a str>>,
}

#[derive(Default)]
struct Layout<'a> {
    roots: Vec<Root<'a>>,
    regions: BTreeMap<&'a str, String>,
    references: Vec<(&'a str, String)>,
}

pub(super) fn validate(
    files: &HashMap<String, Value>,
    registry: &Registry,
) -> Vec<ValidationIssue> {
    let layouts: BTreeMap<_, _> = files
        .iter()
        .map(|(file, value)| (file.as_str(), collect(value, registry)))
        .collect();
    let mut issues = Vec::new();
    let mut global_regions = BTreeMap::new();
    for (file, layout) in &layouts {
        for (id, pointer) in &layout.regions {
            if let Some(previous) = global_regions.insert(id, file) {
                issue(
                    &mut issues,
                    "LAY-08",
                    file,
                    pointer,
                    format!("Region {id:?} is also defined in {previous}"),
                );
            }
        }
    }
    for (file, layout) in &layouts {
        let partners: Vec<_> = if *file == SHELL {
            layouts
                .iter()
                .filter(|(name, _)| composes_shell(name))
                .map(|(_, layout)| layout)
                .collect()
        } else if composes_shell(file) {
            layouts.get(SHELL).into_iter().collect()
        } else {
            Vec::new()
        };
        // A shell reference must resolve in every screen with which it composes.
        let mut regions: HashSet<String> = layout.regions.keys().map(|id| (*id).into()).collect();
        if let Some(first) = partners.first() {
            regions.extend(
                first
                    .regions
                    .keys()
                    .filter(|id| partners.iter().all(|p| p.regions.contains_key(*id)))
                    .map(|id| (*id).to_string()),
            );
        }
        issues.extend(rules::validate(file, &files[*file], registry, &regions));
        for (id, pointer) in &layout.references {
            if !regions.contains(*id) {
                issue(
                    &mut issues,
                    "LAY-09",
                    file,
                    pointer,
                    format!("Region {id:?} does not exist in this composition"),
                );
            }
        }
        let Some((rule, mut codes, pointer)) = requirements(file) else {
            continue;
        };
        if file.starts_with("layout/popups/") {
            if let Some(mode @ ("region" | "inline")) = files[*file]
                .pointer("/placement/mode")
                .and_then(Value::as_str)
            {
                codes.push(format!("popup:{mode}"));
            }
        }
        let required: Vec<_> = registry
            .elements
            .iter()
            .filter(|(_, def)| def.required.iter().any(|code| codes.contains(code)))
            .map(|(id, _)| id.as_str())
            .collect();
        let fallback = Root::default();
        let shell = composes_shell(file).then(|| layouts.get(SHELL)).flatten();
        let shell_roots: Vec<_> = shell
            .map(|layout| layout.roots.iter().collect())
            .unwrap_or_else(|| vec![&fallback]);
        for root in &layout.roots {
            for shell_root in &shell_roots {
                if !overlaps(root, shell_root) {
                    continue;
                }
                for id in &required {
                    if !root.elements.contains(id) && !shell_root.elements.contains(id) {
                        issue(
                            &mut issues,
                            rule,
                            file,
                            pointer,
                            format!("Required element {id:?} is missing from this composition"),
                        );
                    }
                }
                for (key, path) in &root.placements {
                    if shell_root.placements.contains_key(key) {
                        issue(
                            &mut issues,
                            "ELE-04",
                            file,
                            path,
                            format!("Element {:?} is also placed in {SHELL}", key.0),
                        );
                    }
                }
            }
        }
    }
    // Context-local requirements never borrow an action notice from another file or selection.
    for (file, layout) in &layouts {
        let rule = if file.starts_with("layout/lists/") {
            "REQ-05"
        } else if file.starts_with("layout/modals/") {
            "REQ-03"
        } else if file.starts_with("layout/popups/") {
            "REQ-04"
        } else {
            "REQ-01"
        };
        for root in &layout.roots {
            for (pointer, elements) in &root.contexts {
                if elements.contains("server.join") {
                    for (id, def) in &registry.elements {
                        if def.required.iter().any(|code| code == "withJoin")
                            && !elements.contains(id.as_str())
                        {
                            issue(&mut issues, rule, file, pointer, format!("Element {id:?} is required alongside server.join in this context"));
                        }
                    }
                }
            }
        }
    }
    issues.sort_by(|a, b| {
        (&a.file, &a.pointer, &a.rule_id, &a.message)
            .cmp(&(&b.file, &b.pointer, &b.rule_id, &b.message))
    });
    issues.dedup();
    issues
}

fn composes_shell(file: &str) -> bool {
    matches!(
        file,
        "layout/views/browser.json" | "layout/views/mods.json" | "layout/settings.json"
    )
}

fn requirements(file: &str) -> Option<(&'static str, Vec<String>, &'static str)> {
    if file == "layout/settings.json" {
        return Some((
            "REQ-02",
            vec!["settings".into(), "views+settings".into()],
            "",
        ));
    }
    for (prefix, rule, code, pointer) in [
        ("layout/views/", "REQ-01", "view", ""),
        ("layout/modals/", "REQ-03", "modal", ""),
        ("layout/popups/", "REQ-04", "popup", ""),
        ("layout/lists/", "REQ-05", "list", "/row"),
    ] {
        if let Some(id) = file
            .strip_prefix(prefix)
            .and_then(|id| id.strip_suffix(".json"))
        {
            let mut codes = vec![format!(
                "{code}:{id}{}",
                if code == "list" { "/row" } else { "" }
            )];
            if code == "view" {
                codes.extend(["views".into(), "views+settings".into()]);
            }
            if code == "modal" {
                codes.push("modal".into());
            }
            return Some((rule, codes, pointer));
        }
    }
    None
}

fn overlaps(a: &Root<'_>, b: &Root<'_>) -> bool {
    a.end.is_none_or(|end| b.start < end) && b.end.is_none_or(|end| a.start < end)
}

fn collect<'a>(value: &'a Value, registry: &'a Registry) -> Layout<'a> {
    let mut layout = Layout::default();
    let mut roots = Vec::new();
    if let Some(root) = value.get("root") {
        roots.push((root, "/root".into(), 0.0, None));
    }
    if let Some(row) = value.get("row") {
        roots.push((row, "/row".into(), 0.0, None));
    }
    if let Some(variants) = value.get("variants").and_then(Value::as_array) {
        for (i, variant) in variants.iter().enumerate() {
            if let Some(root) = variant.get("root") {
                roots.push((
                    root,
                    format!("/variants/{i}/root"),
                    variant
                        .get("minWidth")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                    variants
                        .get(i + 1)
                        .and_then(|v| v.get("minWidth"))
                        .and_then(Value::as_f64),
                ));
            }
        }
    }
    if roots.is_empty() {
        layout.roots.push(Root::default());
    }
    for (value, pointer, start, end) in roots {
        let mut root = Root {
            start,
            end,
            ..Root::default()
        };
        let mut pending = vec![(value, pointer.clone(), pointer)];
        while let Some((value, pointer, inherited)) = pending.pop() {
            let Some(props) = value.as_object() else {
                continue;
            };
            let context = if props.contains_key("context") {
                pointer.clone()
            } else {
                inherited.clone()
            };
            if let Some(node) = Node::from_value(value) {
                let id = match node.kind {
                    NodeKind::Element => props.get("element"),
                    NodeKind::Surface => props.get("surface"),
                    _ => None,
                }
                .and_then(Value::as_str);
                if let Some(id) = id {
                    let mut elements = BTreeSet::new();
                    expand(id, registry, &mut elements, &mut HashSet::new());
                    for id in elements {
                        root.elements.insert(id);
                        root.contexts.entry(context.clone()).or_default().insert(id);
                        if let Some(def) = registry
                            .elements
                            .get(id)
                            .filter(|def| def.multiplicity == Multiplicity::PerComposition)
                        {
                            let scope = if def.multiplicity_scope.is_some() {
                                props
                                    .get("options")
                                    .and_then(|o| o.get("region"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                            } else {
                                ""
                            };
                            root.placements
                                .entry((id, scope))
                                .or_insert_with(|| pointer.clone());
                        }
                    }
                }
            }
            for (child, path) in rules::descendants(props, &pointer) {
                let scope = if path == format!("{pointer}/empty") {
                    path.clone()
                } else {
                    context.clone()
                };
                pending.push((child, path, scope));
            }
        }
        layout.roots.push(root);
    }
    // References may occur in placement metadata as well as node properties.
    let mut pending = vec![(value, String::new())];
    while let Some((value, pointer)) = pending.pop() {
        match value {
            Value::Object(props) => {
                if Node::from_value(value).is_some() {
                    if let Some(id) = props.get("id").and_then(Value::as_str) {
                        layout
                            .regions
                            .entry(id)
                            .or_insert_with(|| format!("{pointer}/id"));
                    }
                }
                for (key, value) in props {
                    let path = format!("{pointer}/{}", key.replace('~', "~0").replace('/', "~1"));
                    if key == "ref"
                        || (key == "region"
                            && matches!(pointer.as_str(), "/presentation" | "/placement"))
                    {
                        if let Some(id) = value.as_str() {
                            layout.references.push((id, path.clone()));
                        }
                    }
                    pending.push((value, path));
                }
            }
            Value::Array(values) => {
                for (i, value) in values.iter().enumerate() {
                    pending.push((value, format!("{pointer}/{i}")));
                }
            }
            _ => {}
        }
    }
    layout
}

pub(super) fn expand<'a>(
    id: &'a str,
    registry: &'a Registry,
    elements: &mut BTreeSet<&'a str>,
    visited: &mut HashSet<&'a str>,
) {
    if !visited.insert(id) {
        return;
    }
    if let Some(surface) = registry.surfaces.get(id) {
        for child in &surface.contains {
            expand(child, registry, elements, visited);
        }
    } else if registry.elements.contains_key(id) {
        elements.insert(id);
    }
}

fn issue(
    issues: &mut Vec<ValidationIssue>,
    rule: &str,
    file: &str,
    pointer: &str,
    message: String,
) {
    issues.push(ValidationIssue {
        rule_id: rule.into(),
        severity: Severity::Error,
        file: file.into(),
        pointer: pointer.into(),
        message,
        hint: None,
    });
}
