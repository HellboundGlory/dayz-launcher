use std::collections::{BTreeSet, HashSet};

use serde_json::{Map, Value};

use super::ast::{LayoutFile, Node, NodeKind};
use super::{Severity, ValidationIssue};
use crate::theme::registry::{EnumValue, Multiplicity, OptionDef, Registry, Subject};

pub(super) fn validate(
    file: &str,
    value: &Value,
    registry: &Registry,
    composing_regions: &HashSet<String>,
) -> Vec<ValidationIssue> {
    let mut validator = Validator {
        file,
        registry,
        issues: Vec::new(),
        regions: HashSet::new(),
        references: Vec::new(),
        placements: HashSet::new(),
    };
    validator.file(value);
    for (id, pointer) in std::mem::take(&mut validator.references) {
        if !validator.regions.contains(&id) && !composing_regions.contains(&id) {
            validator.issue(
                "LAY-09",
                &pointer,
                format!("Region {id:?} does not exist in this composition"),
            );
        }
    }
    validator.issues
}

#[derive(Clone, Default)]
struct Context {
    subject: Option<Subject>,
    scope: String,
    selection: bool,
    row: bool,
    column_depth: Option<usize>,
    in_scroll: bool,
}

struct Validator<'a> {
    file: &'a str,
    registry: &'a Registry,
    issues: Vec<ValidationIssue>,
    regions: HashSet<String>,
    references: Vec<(String, String)>,
    placements: HashSet<(String, String)>,
}

impl Validator<'_> {
    fn issue(&mut self, rule: &str, pointer: &str, message: impl Into<String>) {
        self.issues.push(ValidationIssue {
            rule_id: rule.into(),
            severity: Severity::Error,
            file: self.file.into(),
            pointer: pointer.into(),
            message: message.into(),
            hint: None,
        });
    }

    fn file(&mut self, value: &Value) {
        let Some(layout) = LayoutFile::from_value(value) else {
            self.issue("LAY-01", "", "Layout envelope must be an object");
            return;
        };
        let fields = layout.fields;
        if fields.get("schemaVersion").and_then(Value::as_u64) != Some(2) {
            self.issue("LAY-01", "/schemaVersion", "schemaVersion must be 2");
        }
        let list = self
            .registry
            .lists
            .values()
            .find(|list| list.template == self.file);
        let list_file = self.file.starts_with("layout/lists/");
        if list_file && list.is_none() {
            self.issue("LST-01", "", "Unknown list template file");
        }
        let mut context = Context::default();
        if let Some(modal) = self
            .registry
            .modals
            .values()
            .find(|modal| modal.file == self.file)
        {
            context.subject = modal.subject;
        }
        if let Some(id) = self
            .file
            .strip_prefix("layout/popups/")
            .and_then(|name| name.strip_suffix(".json"))
        {
            context.subject = self
                .registry
                .popups
                .get(id)
                .and_then(|popup| self.registry.elements.get(&popup.opened_by))
                .and_then(|element| element.subject);
        }
        let mut roots = Vec::new();
        if list_file {
            if fields.contains_key("root") || fields.contains_key("variants") {
                self.issue("LAY-01", "", "List templates use row, not root or variants");
            }
            self.columns(fields, list);
            if let Some(row) = fields.get("row") {
                let row_context = Context {
                    subject: list.map(|list| list.subject),
                    scope: "/row".into(),
                    row: true,
                    column_depth: fields
                        .get("columns")
                        .and_then(Value::as_array)
                        .filter(|columns| !columns.is_empty())
                        .map(|_| 2),
                    ..Context::default()
                };
                roots.push((row, "/row".into(), row_context));
            }
            if let Some(empty) = fields.get("empty") {
                roots.push((empty, "/empty".into(), Context::default()));
            }
        } else {
            if fields.contains_key("root") == fields.contains_key("variants") {
                self.issue("LAY-01", "", "Provide exactly one of root or variants");
            }
            if let Some(root) = fields.get("root") {
                roots.push((root, "/root".into(), context.clone()));
            }
            if let Some(variants) = fields.get("variants") {
                if let Some(variants) = variants.as_array() {
                    if !(2..=4).contains(&variants.len()) {
                        self.issue("LAY-10", "/variants", "Provide two to four variants");
                    }
                    if variants.len() > 4 {
                        self.issue("LIM-04", "/variants", "At most four variants are allowed");
                    }
                    let mut previous = None;
                    for (index, variant) in variants.iter().enumerate() {
                        let pointer = format!("/variants/{index}");
                        let width = variant.get("minWidth").and_then(Value::as_f64);
                        if width.is_none_or(|width| {
                            width < 0.0
                                || (index == 0 && width != 0.0)
                                || previous.is_some_and(|previous| width <= previous)
                        }) {
                            self.issue(
                                "LAY-10",
                                &child(&pointer, "minWidth"),
                                "Variant widths must start at zero and strictly increase",
                            );
                        }
                        previous = width;
                        if let Some(root) = variant.get("root") {
                            roots.push((root, child(&pointer, "root"), context.clone()));
                        } else {
                            self.issue(
                                "LAY-10",
                                &child(&pointer, "root"),
                                "Variant requires a root node",
                            );
                        }
                    }
                } else {
                    self.issue("LAY-10", "/variants", "variants must be an array");
                }
            }
        }
        self.structure(&roots);
        for (root, pointer, context) in roots {
            // Responsive roots never coexist; structural limits still span the file.
            self.placements.clear();
            self.node(root, &pointer, 1, &context);
        }
    }

    fn structure(&mut self, roots: &[(&Value, String, Context)]) {
        let mut pending: Vec<_> = roots
            .iter()
            .rev()
            .map(|(node, path, _)| (*node, path.clone(), 1))
            .collect();
        let mut count = 0;
        let mut classes = BTreeSet::new();
        let mut class_limit_reported = false;
        while let Some((value, pointer, depth)) = pending.pop() {
            count += 1;
            if count == 2001 {
                self.issue(
                    "LIM-01",
                    &pointer,
                    "At most 2,000 nodes are allowed per file",
                );
            }
            if depth == 25 {
                self.issue("LIM-02", &pointer, "Node depth exceeds 24");
            }
            let Some(props) = value.as_object() else {
                continue;
            };
            if let Some(id) = props.get("id") {
                if let Some(id) = id.as_str().filter(|id| region_id(id)) {
                    if !self.regions.insert(id.into()) {
                        self.issue(
                            "LAY-08",
                            &child(&pointer, "id"),
                            "Region id is duplicated in this file",
                        );
                    }
                } else {
                    self.issue(
                        "LAY-07",
                        &child(&pointer, "id"),
                        "Region ids must match r-[a-z0-9-]+",
                    );
                }
            }
            if props.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(text) = props.get("value").and_then(Value::as_str) {
                    if text.chars().count() > 120 {
                        self.issue(
                            "LIM-03",
                            &child(&pointer, "value"),
                            "Text exceeds 120 characters",
                        );
                    }
                }
            }
            if let Some(class) = props.get("class") {
                match class {
                    Value::String(class) => {
                        classes.extend(class.split_whitespace().map(str::to_owned))
                    }
                    Value::Array(array) => {
                        for class in array.iter().filter_map(Value::as_str) {
                            classes.extend(class.split_whitespace().map(str::to_owned));
                        }
                    }
                    _ => {}
                }
                if classes.len() > 200 && !class_limit_reported {
                    class_limit_reported = true;
                    self.issue(
                        "LIM-05",
                        &child(&pointer, "class"),
                        "At most 200 distinct theme classes are allowed",
                    );
                }
            }
            for (node, path) in descendants(props, &pointer).into_iter().rev() {
                pending.push((node, path, depth + 1));
            }
        }
    }

    fn node(&mut self, value: &Value, pointer: &str, depth: usize, inherited: &Context) {
        if depth > 24 {
            return;
        }
        let Some(node) = Node::from_value(value) else {
            self.issue("LAY-02", pointer, "Expected a known container or leaf node");
            return;
        };
        let mut context = inherited.clone();
        if let Some(setting) = node.props.get("context") {
            let subject = match setting.as_str() {
                Some("selection") => Some(Subject::Server),
                Some("modSelection") => Some(Subject::Mod),
                Some("modFilterPreview") => Some(Subject::WorkshopMod),
                _ => None,
            };
            let allowed_file = match setting.as_str() {
                Some("selection" | "modSelection") => {
                    self.file == "layout/shell.json" || self.file.starts_with("layout/views/")
                }
                Some("modFilterPreview") => self.file == "layout/modals/modFilter.json",
                _ => false,
            };
            if !node.kind.is_container()
                || inherited.subject.is_some()
                || subject.is_none()
                || !allowed_file
            {
                self.issue(
                    "ELE-03",
                    &child(pointer, "context"),
                    "Context is unknown, nested, or unavailable in this file",
                );
            } else {
                context.subject = subject;
                context.scope = pointer.into();
                context.selection = setting == "selection";
            }
        }
        self.props(node, pointer, depth, &context);
        match node.kind {
            NodeKind::Element => self.element(node.props, pointer, &context),
            NodeKind::Surface => {
                if let Some(surface) = node
                    .props
                    .get("surface")
                    .and_then(Value::as_str)
                    .and_then(|id| self.registry.surfaces.get(id))
                {
                    if !surface
                        .r#where
                        .iter()
                        .any(|code| self.placement(code, &context))
                    {
                        self.issue("ELE-02", pointer, "Surface cannot be placed here");
                    }
                    let mut elements = BTreeSet::new();
                    let mut visited = HashSet::new();
                    for id in &surface.contains {
                        super::composition::expand(id, self.registry, &mut elements, &mut visited);
                    }
                    for id in elements {
                        self.placed_element(id, &Map::new(), pointer, &context);
                    }
                } else {
                    self.issue("ELE-01", &child(pointer, "surface"), "Unknown surface id");
                }
            }
            NodeKind::Tabs => self.sections(node.props, pointer, true),
            NodeKind::Accordion => self.sections(node.props, pointer, false),
            _ => {}
        }
        context.in_scroll |= node.kind == NodeKind::Scroll;
        let before = node
            .props
            .get("collapsible")
            .and_then(|value| value.get("collapsed"))
            .map(|_| self.placements.clone());
        let mut collapsed = None;
        for (descendant, path) in descendants(node.props, pointer) {
            if path == format!("{pointer}/collapsible/collapsed") {
                collapsed = Some((descendant, path));
            } else {
                let descendant_context = if path == child(pointer, "empty") {
                    Context {
                        subject: inherited.subject,
                        scope: inherited.scope.clone(),
                        ..context.clone()
                    }
                } else {
                    context.clone()
                };
                self.node(descendant, &path, depth + 1, &descendant_context);
            }
        }
        if let (Some((collapsed, path)), Some(before)) = (collapsed, before) {
            let expanded = std::mem::replace(&mut self.placements, before);
            self.node(collapsed, &path, depth + 1, &context);
            self.placements.extend(expanded);
        }
    }

    fn props(&mut self, node: Node<'_>, pointer: &str, depth: usize, context: &Context) {
        for (key, value) in node.props {
            let path = child(pointer, key);
            if key.starts_with("margin") {
                self.issue(
                    "LAY-05",
                    &path,
                    "Margins are not supported; use token padding or gap",
                );
            } else if !node.kind.accepts(key) {
                self.issue(
                    "LAY-03",
                    &path,
                    format!("Unknown property {key:?} on this node"),
                );
            }
            if matches!(
                key.as_str(),
                "width" | "height" | "minWidth" | "maxWidth" | "minHeight" | "maxHeight" | "basis"
            ) && !sizing(value, false)
            {
                self.issue(
                    "LAY-04",
                    &path,
                    "Expected a size, intrinsic keyword, or space token",
                );
            }
            if (key.starts_with("padding")
                || matches!(key.as_str(), "gap" | "rowGap" | "columnGap"))
                && !value.as_str().is_some_and(space_token)
            {
                self.issue("LAY-05", &path, "Spacing must be a space token or role");
            }
            if node.kind == NodeKind::Grid && matches!(key.as_str(), "columns" | "rows") {
                if let Some(tracks) = value.as_array() {
                    for (index, track) in tracks.iter().enumerate() {
                        if !sizing(track, true) {
                            self.issue(
                                "LAY-04",
                                &child(&path, &index.to_string()),
                                "Invalid grid track size",
                            );
                        }
                    }
                } else {
                    self.issue("LAY-04", &path, "Grid tracks must be an array of sizes");
                }
            }
            if key == "position" {
                self.position(value, &path);
            }
            if key == "resizable" {
                for bound in ["min", "max"] {
                    if let Some(value) = value.get(bound) {
                        if !sizing(value, false) {
                            self.issue("LAY-04", &child(&path, bound), "Invalid resize bound");
                        }
                    }
                }
            }
            if key == "column" && context.column_depth != Some(depth) {
                self.issue(
                    "LST-05",
                    &path,
                    "column is only allowed on direct row children with declared columns",
                );
            }
            if key == "children" && !value.is_array() {
                self.issue("LAY-03", &path, "children must be an array of nodes");
            }
        }
    }

    fn position(&mut self, value: &Value, pointer: &str) {
        let Some(position) = value.as_object() else {
            self.issue("LAY-06", pointer, "position must be an object");
            return;
        };
        if !position
            .get("anchor")
            .and_then(Value::as_str)
            .is_some_and(|anchor| {
                matches!(
                    anchor,
                    "topLeft"
                        | "top"
                        | "topRight"
                        | "left"
                        | "center"
                        | "right"
                        | "bottomLeft"
                        | "bottom"
                        | "bottomRight"
                )
            })
        {
            self.issue(
                "LAY-06",
                &child(pointer, "anchor"),
                "Unknown position anchor",
            );
        }
        for (key, value) in position {
            if key != "anchor"
                && (!matches!(key.as_str(), "x" | "y")
                    || !value
                        .as_str()
                        .is_some_and(|value| length(value, true) || space_token(value)))
            {
                self.issue(
                    "LAY-06",
                    &child(pointer, key),
                    "Position offsets must be lengths or space tokens",
                );
            }
        }
    }

    fn sections(&mut self, props: &Map<String, Value>, pointer: &str, tabs: bool) {
        let (rule, key, parts) = if tabs {
            ("LAY-11", "tabs", ["label", "content"])
        } else {
            ("LAY-12", "sections", ["header", "body"])
        };
        if !tabs {
            for (key, allowed) in [
                ("mode", ["single", "multiple"]),
                ("initial", ["none", "first"]),
            ] {
                if !props
                    .get(key)
                    .and_then(Value::as_str)
                    .is_some_and(|value| allowed.contains(&value))
                {
                    self.issue(
                        rule,
                        &child(pointer, key),
                        format!("Invalid accordion {key}"),
                    );
                }
            }
        }
        let path = child(pointer, key);
        let Some(sections) = props
            .get(key)
            .and_then(Value::as_array)
            .filter(|sections| !sections.is_empty())
        else {
            self.issue(rule, &path, "Expected a nonempty section array");
            return;
        };
        let mut ids = HashSet::new();
        for (index, section) in sections.iter().enumerate() {
            let path = child(&path, &index.to_string());
            match section.get("id").and_then(Value::as_str) {
                Some(id) if slug(id) && ids.insert(id) => {}
                _ => self.issue(
                    rule,
                    &child(&path, "id"),
                    "Section id is missing, invalid, or duplicated",
                ),
            }
            for part in parts {
                if !section.get(part).is_some_and(Value::is_object) {
                    self.issue(
                        rule,
                        &child(&path, part),
                        format!("Section requires a {part} node"),
                    );
                }
            }
        }
    }

    fn placement(&self, code: &str, context: &Context) -> bool {
        match code {
            "app" => {
                self.file == "layout/shell.json"
                    || self.file == "layout/settings.json"
                    || self.file.starts_with("layout/views/")
            }
            "browser" => self.file == "layout/views/browser.json",
            "mods" => self.file == "layout/views/mods.json",
            "settings" => self.file == "layout/settings.json",
            "server" => context.subject == Some(Subject::Server),
            "server-panel" => context.subject == Some(Subject::Server) && !context.row,
            "mod" => context.subject == Some(Subject::Mod),
            "mod-panel" => context.subject == Some(Subject::Mod) && !context.row,
            "serverMod" => context.subject == Some(Subject::ServerMod),
            "modServer" => context.subject == Some(Subject::ModServer),
            "workshopMod" => context.subject == Some(Subject::WorkshopMod),
            "selection" => context.selection,
            "modFilter" => self.file == "layout/modals/modFilter.json",
            "update" => self.file == "layout/modals/update.json",
            "modal" => self.file.starts_with("layout/modals/"),
            "popup" => self.file.starts_with("layout/popups/"),
            _ => [("popup:", "layout/popups/"), ("modal:", "layout/modals/")]
                .iter()
                .any(|(prefix, directory)| {
                    code.strip_prefix(prefix).is_some_and(|id| {
                        self.file
                            .strip_prefix(directory)
                            .and_then(|name| name.strip_suffix(".json"))
                            == Some(id)
                    })
                }),
        }
    }

    fn element(&mut self, props: &Map<String, Value>, pointer: &str, context: &Context) {
        let Some(id) = props.get("element").and_then(Value::as_str) else {
            self.issue(
                "ELE-01",
                &child(pointer, "element"),
                "Element id must be a string",
            );
            return;
        };
        self.placed_element(id, props, pointer, context);
    }

    fn placed_element(
        &mut self,
        id: &str,
        props: &Map<String, Value>,
        pointer: &str,
        context: &Context,
    ) {
        if id.starts_with("list.") && !self.registry.lists.contains_key(id) {
            self.issue("LST-01", &child(pointer, "element"), "Unknown list id");
        }
        let Some(def) = self.registry.elements.get(id) else {
            self.issue(
                "ELE-01",
                &child(pointer, "element"),
                format!("Unknown element {id:?}"),
            );
            return;
        };
        if !def.r#where.iter().any(|code| self.placement(code, context))
            || def
                .excluded_where
                .as_ref()
                .is_some_and(|codes| codes.iter().any(|code| self.placement(code, context)))
        {
            self.issue(
                "ELE-02",
                pointer,
                format!("Element {id:?} cannot be placed here"),
            );
        }
        if def.subject.is_some() && def.subject != context.subject {
            self.issue(
                "ELE-03",
                pointer,
                format!("Element {id:?} requires a matching subject context"),
            );
        }
        let options = props.get("options");
        if options.is_some_and(|options| !options.is_object()) {
            self.issue(
                "ELE-06",
                &child(pointer, "options"),
                "Options must be an object",
            );
        }
        if let Some(options) = options.and_then(Value::as_object) {
            for (key, value) in options {
                let path = child(&child(pointer, "options"), key);
                if let Some(schema) = def.options.get(key) {
                    if !option_value(schema, value, self.registry) {
                        self.issue("ELE-06", &path, format!("Invalid value for option {key:?}"));
                    }
                    if matches!(schema, OptionDef::Region) {
                        if let Some(region) = value.as_str().filter(|region| region_id(region)) {
                            self.references.push((region.into(), path.clone()));
                        }
                    }
                } else {
                    self.issue("ELE-05", &path, format!("Unknown option {key:?}"));
                }
                if key == "label" {
                    self.label(value, def.free_label, &path);
                }
            }
        }
        if let Some(label) = props.get("label") {
            self.label(label, def.free_label, &child(pointer, "label"));
        }
        if def.multiplicity != Multiplicity::Many {
            let scope = if def.multiplicity_scope.is_some() {
                props
                    .get("options")
                    .and_then(|options| options.get("region"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
            } else if def.multiplicity == Multiplicity::PerContext {
                &context.scope
            } else {
                ""
            };
            if !self.placements.insert((id.into(), scope.into())) {
                self.issue(
                    "ELE-04",
                    pointer,
                    format!("Element {id:?} is duplicated in its multiplicity scope"),
                );
            }
        }
        if self.registry.lists.contains_key(id) && context.in_scroll {
            self.issue(
                "LST-06",
                pointer,
                "Lists own their scroller and cannot be inside scroll containers",
            );
        }
    }

    fn label(&mut self, value: &Value, allowed: bool, pointer: &str) {
        if !allowed {
            self.issue(
                "ELE-07",
                pointer,
                "This element does not allow a free label",
            );
        }
        match value.as_str() {
            Some(label) if label.chars().count() > 40 => {
                self.issue("ELE-08", pointer, "Free label exceeds 40 characters")
            }
            None => self.issue("ELE-06", pointer, "Free label must be plain text"),
            _ => {}
        }
    }

    fn columns(
        &mut self,
        fields: &Map<String, Value>,
        list: Option<&crate::theme::registry::ListDef>,
    ) {
        let Some(columns) = fields.get("columns") else {
            return;
        };
        let Some(columns) = columns.as_array() else {
            self.issue("LAY-01", "/columns", "columns must be an array");
            return;
        };
        let mut ids = HashSet::new();
        for (index, column) in columns.iter().enumerate() {
            let pointer = format!("/columns/{index}");
            if let Some(id) = column.get("id").and_then(Value::as_str) {
                if !ids.insert(id) {
                    self.issue("LST-02", &child(&pointer, "id"), "Column id is duplicated");
                }
                if !slug(id) {
                    self.issue("LAY-01", &child(&pointer, "id"), "Invalid column id");
                }
            } else {
                self.issue("LAY-01", &child(&pointer, "id"), "Column requires an id");
            }
            for key in ["width", "minWidth", "maxWidth"] {
                if let Some(width) = column.get(key) {
                    if !column_width(width, key == "width") {
                        self.issue("LST-03", &child(&pointer, key), "Invalid column width");
                    }
                } else if key == "width" {
                    self.issue("LST-03", &child(&pointer, key), "Column requires a width");
                }
            }
            if let Some(sort) = column.get("sort") {
                if !sort.as_str().is_some_and(|key| {
                    list.is_some_and(|list| list.sort_keys.iter().any(|allowed| allowed == key))
                }) {
                    self.issue("LST-04", &child(&pointer, "sort"), "Unknown list sort key");
                }
            }
            if let Some(label) = column.get("label").and_then(Value::as_str) {
                if label.chars().count() > 24 {
                    self.issue(
                        "LIM-03",
                        &child(&pointer, "label"),
                        "Column label exceeds 24 characters",
                    );
                }
            }
        }
    }
}

fn child(pointer: &str, key: &str) -> String {
    format!("{pointer}/{}", key.replace('~', "~0").replace('/', "~1"))
}

pub(super) fn descendants<'a>(
    props: &'a Map<String, Value>,
    pointer: &str,
) -> Vec<(&'a Value, String)> {
    let mut children = Vec::new();
    if let Some(array) = props.get("children").and_then(Value::as_array) {
        for (index, node) in array.iter().enumerate() {
            children.push((node, format!("{pointer}/children/{index}")));
        }
    }
    for (key, parts) in [
        ("tabs", ["label", "content"]),
        ("sections", ["header", "body"]),
    ] {
        if let Some(array) = props.get(key).and_then(Value::as_array) {
            for (index, section) in array.iter().enumerate() {
                for part in parts {
                    if let Some(node) = section.get(part) {
                        children.push((node, format!("{pointer}/{key}/{index}/{part}")));
                    }
                }
            }
        }
    }
    if let Some(empty) = props.get("empty") {
        children.push((empty, child(pointer, "empty")));
    }
    if let Some(collapsed) = props
        .get("collapsible")
        .and_then(|value| value.get("collapsed"))
    {
        children.push((collapsed, format!("{pointer}/collapsible/collapsed")));
    }
    children
}

fn slug(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn region_id(value: &str) -> bool {
    value.strip_prefix("r-").is_some_and(slug)
}

fn space_token(value: &str) -> bool {
    static NAMES: std::sync::LazyLock<HashSet<String>> = std::sync::LazyLock::new(|| {
        use crate::theme::tokens::{SpaceRolesTokensV2, SpaceScalesTokensV2};
        [
            serde_json::to_value(SpaceScalesTokensV2::default()).expect("space scales serialize"),
            serde_json::to_value(SpaceRolesTokensV2::default()).expect("space roles serialize"),
        ]
        .into_iter()
        .flat_map(|value| {
            value
                .as_object()
                .expect("space tokens are objects")
                .keys()
                .cloned()
                .collect::<Vec<_>>()
        })
        .collect()
    });
    value
        .strip_prefix("space.")
        .is_some_and(|step| NAMES.contains(step))
}

fn number(value: &str, signed: bool) -> bool {
    let value = if signed {
        value.strip_prefix('-').unwrap_or(value)
    } else {
        value
    };
    let mut dots = 0;
    let mut digits = 0;
    for byte in value.bytes() {
        if byte == b'.' {
            dots += 1;
        } else if byte.is_ascii_digit() {
            digits += 1;
        } else {
            return false;
        }
    }
    digits > 0 && dots <= 1 && value.parse::<f64>().is_ok_and(|number| number.is_finite())
}

fn length(value: &str, signed: bool) -> bool {
    value
        .strip_suffix("px")
        .or_else(|| value.strip_suffix('%'))
        .is_some_and(|n| number(n, signed))
}

fn sizing(value: &Value, tracks: bool) -> bool {
    value.as_str().is_some_and(|value| {
        matches!(value, "auto" | "min-content" | "max-content")
            || length(value, false)
            || space_token(value)
            || (tracks && value.strip_suffix("fr").is_some_and(|n| number(n, false)))
    })
}

fn column_width(value: &Value, track: bool) -> bool {
    value.as_str().is_some_and(|value| {
        length(value, false)
            || space_token(value)
            || (track
                && (value == "auto" || value.strip_suffix("fr").is_some_and(|n| number(n, false))))
    })
}

fn option_value(schema: &OptionDef, value: &Value, registry: &Registry) -> bool {
    match schema {
        OptionDef::Enum { values, .. } => values.iter().any(|allowed| match allowed {
            EnumValue::Text(text) => value.as_str() == Some(text),
            EnumValue::Number(number) => value.as_i64() == Some(*number),
        }),
        OptionDef::Boolean { .. } => value.is_boolean(),
        OptionDef::Text { .. } => value.is_string(),
        OptionDef::Length { .. } => sizing(value, false),
        OptionDef::Token { default } => value
            .as_str()
            .is_some_and(|token| space_token(token) || default.as_deref() == Some(token)),
        OptionDef::Region => value.as_str().is_some_and(region_id),
        OptionDef::Icon { .. } => value.as_str().is_some_and(|icon| {
            icon == "none"
                || registry.icons.iter().any(|known| known == icon)
                || icon.strip_prefix("images/").is_some_and(|path| {
                    !path.is_empty()
                        && !path.contains(['\\', '?', '#', ':'])
                        && path.split('/').all(|part| !matches!(part, "" | "." | ".."))
                        && [".svg", ".png", ".webp"]
                            .iter()
                            .any(|extension| path.ends_with(extension))
                })
        }),
    }
}
