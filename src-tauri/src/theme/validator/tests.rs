use serde_json::{json, Value};

use super::{validate_layout_file, validate_layout_value, Severity, ValidationIssue};

const SHELL: &str = "layout/shell.json";
const BROWSER: &str = "layout/views/browser.json";
const LIST: &str = "layout/lists/servers.json";

fn layout(root: Value) -> Value {
    json!({"schemaVersion": 2, "root": root})
}

fn check(file: &str, value: Value, rule: &str, pointer: &str) {
    let issues = validate_layout_file(file, &value.to_string());
    assert!(
        issues
            .iter()
            .any(|issue| issue.rule_id == rule && issue.pointer == pointer),
        "Missing {rule} at {pointer}: {issues:#?}"
    );
    assert!(issues
        .iter()
        .all(|issue| issue.file == file && issue.severity == Severity::Error));
}

#[test]
fn valid_layout_accepts_existing_spacing_scale_and_roles() {
    let root = json!({
        "type": "stack", "direction": "column", "padding": "space.10", "gap": "space.panelPad",
        "children": [
            {"element": "app.logo", "options": {"wordmark": true}},
            {"type": "grid", "columns": ["1fr", "20px", "auto"], "width": "100%", "children": []},
            {"type": "text", "value": "hello", "position": {"anchor": "topRight", "x": "8px"}},
            {"type": "image", "src": "images/logo.png", "fit": "contain"},
            {"type": "outlet", "name": "view"},
            {"surface": "surface.windowControls"}
        ]
    });
    assert_eq!(
        validate_layout_file(SHELL, &layout(root).to_string()),
        vec![]
    );
}

#[test]
fn layout_rules_report_exact_pointers() {
    for (value, rule, pointer) in [
        (
            json!({"schemaVersion":1,"root":{"type":"box"}}),
            "LAY-01",
            "/schemaVersion",
        ),
        (json!({"schemaVersion":2}), "LAY-01", ""),
        (
            json!({"schemaVersion":2,"root":{},"variants":[]}),
            "LAY-01",
            "",
        ),
        (layout(json!({"type":"unknown"})), "LAY-02", "/root"),
        (
            layout(json!({"type":"box","colur":"red"})),
            "LAY-03",
            "/root/colur",
        ),
        (
            layout(json!({"type":"box","x/y~z":true})),
            "LAY-03",
            "/root/x~1y~0z",
        ),
        (
            layout(json!({"type":"box","width":"1fr"})),
            "LAY-04",
            "/root/width",
        ),
        (
            layout(json!({"type":"grid","columns":["1em"]})),
            "LAY-04",
            "/root/columns/0",
        ),
        (
            layout(json!({"type":"box","padding":"8px"})),
            "LAY-05",
            "/root/padding",
        ),
        (
            layout(json!({"type":"box","margin":"space.8"})),
            "LAY-05",
            "/root/margin",
        ),
        (
            layout(json!({"type":"box","position":{"anchor":"north"}})),
            "LAY-06",
            "/root/position/anchor",
        ),
        (
            layout(json!({"type":"box","position":{"anchor":"top","x":"auto"}})),
            "LAY-06",
            "/root/position/x",
        ),
        (
            layout(json!({"type":"box","id":"wrong"})),
            "LAY-07",
            "/root/id",
        ),
        (
            layout(json!({"type":"box","id":"r-one","children":[{"type":"box","id":"r-one"}]})),
            "LAY-08",
            "/root/children/0/id",
        ),
        (
            layout(json!({"element":"app.collapseToggle","options":{"region":"r-missing"}})),
            "LAY-09",
            "/root/options/region",
        ),
        (
            json!({"schemaVersion":2,"variants":[{"minWidth":1,"root":{"type":"box"}},{"minWidth":900,"root":{"type":"box"}}]}),
            "LAY-10",
            "/variants/0/minWidth",
        ),
        (
            json!({"schemaVersion":2,"variants":[{"minWidth":0,"root":{"type":"box"}},{"minWidth":0,"root":{"type":"box"}}]}),
            "LAY-10",
            "/variants/1/minWidth",
        ),
        (
            layout(
                json!({"type":"tabs","tabs":[{"id":"Bad","label":{"type":"text","value":"OK"},"content":{"type":"box"}}]}),
            ),
            "LAY-11",
            "/root/tabs/0/id",
        ),
        (
            layout(json!({"type":"tabs","tabs":[{"id":"ok","content":{"type":"box"}}]})),
            "LAY-11",
            "/root/tabs/0/label",
        ),
        (
            layout(json!({"type":"accordion","mode":"bad","initial":"none","sections":[]})),
            "LAY-12",
            "/root/mode",
        ),
        (
            layout(
                json!({"type":"accordion","mode":"single","initial":"none","sections":[{"id":"ok","header":{"type":"box"}}]}),
            ),
            "LAY-12",
            "/root/sections/0/body",
        ),
    ] {
        check(SHELL, value, rule, pointer);
    }
}

#[test]
fn element_rules_report_exact_pointers() {
    for (root, rule, pointer) in [
        (json!({"element":"not.real"}), "ELE-01", "/root/element"),
        (json!({"element":"filter.search"}), "ELE-02", "/root"),
        (json!({"element":"server.name"}), "ELE-03", "/root"),
        (
            json!({"type":"box","children":[{"element":"nav.servers"},{"element":"nav.servers"}]}),
            "ELE-04",
            "/root/children/1",
        ),
        (
            json!({"element":"app.logo","options":{"bad":true}}),
            "ELE-05",
            "/root/options/bad",
        ),
        (
            json!({"element":"app.logo","options":{"wordmark":"yes"}}),
            "ELE-06",
            "/root/options/wordmark",
        ),
        (
            json!({"element":"app.logo","label":"renamed"}),
            "ELE-07",
            "/root/label",
        ),
        (
            json!({"element":"app.collapseToggle","label":"é".repeat(41)}),
            "ELE-08",
            "/root/label",
        ),
    ] {
        check(SHELL, layout(root), rule, pointer);
    }
    check(
        BROWSER,
        layout(json!({"type":"box","context":"selection","children":[
            {"element":"server.join","options":{"wording":"invented"}}
        ]})),
        "ELE-06",
        "/root/children/0/options/wording",
    );
}

#[test]
fn list_rules_report_exact_pointers() {
    check(
        BROWSER,
        layout(json!({"element":"list.unknown"})),
        "LST-01",
        "/root/element",
    );
    check(
        "layout/lists/unknown.json",
        json!({"schemaVersion":2}),
        "LST-01",
        "",
    );
    check(
        LIST,
        json!({"schemaVersion":2,"columns":[{"id":"x","width":"auto"},{"id":"x","width":"1fr"}]}),
        "LST-02",
        "/columns/1/id",
    );
    check(
        LIST,
        json!({"schemaVersion":2,"columns":[{"id":"x","width":"2em"}]}),
        "LST-03",
        "/columns/0/width",
    );
    check(
        LIST,
        json!({"schemaVersion":2,"columns":[{"id":"x","width":"auto","sort":"unknown"}]}),
        "LST-04",
        "/columns/0/sort",
    );
    check(
        SHELL,
        layout(json!({"type":"box","column":"x"})),
        "LST-05",
        "/root/column",
    );
    check(
        BROWSER,
        layout(
            json!({"type":"scroll","children":[{"type":"box","children":[{"element":"list.servers"}]}]}),
        ),
        "LST-06",
        "/root/children/0/children/0",
    );
}

#[test]
fn structural_limits_report_exact_boundaries() {
    let mut nodes = vec![json!({"type":"box"}); 1999];
    assert!(
        validate_layout_value(SHELL, &layout(json!({"type":"box","children":nodes}))).is_empty()
    );
    nodes.push(json!({"type":"box"}));
    check(
        SHELL,
        layout(json!({"type":"box","children":nodes})),
        "LIM-01",
        "/root/children/1999",
    );
    let mut root = json!({"type":"box"});
    for _ in 1..24 {
        root = json!({"type":"box","children":[root]});
    }
    assert!(validate_layout_value(SHELL, &layout(root.clone())).is_empty());
    root = json!({"type":"box","children":[root]});
    check(
        SHELL,
        layout(root),
        "LIM-02",
        &format!("/root{}", "/children/0".repeat(24)),
    );
    check(
        SHELL,
        layout(json!({"type":"text","value":"é".repeat(121)})),
        "LIM-03",
        "/root/value",
    );
    check(
        LIST,
        json!({"schemaVersion":2,"columns":[{"id":"x","width":"auto","label":"é".repeat(25)}]}),
        "LIM-03",
        "/columns/0/label",
    );
    let variants: Vec<_> = (0..5)
        .map(|width| json!({"minWidth":width*100,"root":{"type":"box"}}))
        .collect();
    check(
        SHELL,
        json!({"schemaVersion":2,"variants":variants}),
        "LIM-04",
        "/variants",
    );
    let classes: Vec<_> = (0..201).map(|index| format!("t-class-{index}")).collect();
    check(
        SHELL,
        layout(json!({"type":"box","class":classes})),
        "LIM-05",
        "/root/class",
    );
    assert!(validate_layout_value(
        SHELL,
        &layout(json!({"type":"text","value":"é".repeat(120),"class":classes[..200]}))
    )
    .is_empty());
}

#[test]
fn row_subjects_and_column_placement_follow_registry_templates() {
    let valid = json!({"schemaVersion":2,"columns":[{"id":"name","width":"1fr","sort":"name"}],
        "row":{"type":"grid","children":[{"element":"server.name","column":"name"},{"element":"server.join"}]},
        "empty":{"type":"text","value":"Nothing here"}});
    assert!(validate_layout_value(LIST, &valid).is_empty());
    check(
        LIST,
        json!({"schemaVersion":2,"row":{"type":"box","children":[{"element":"server.name","column":"name"}]}}),
        "LST-05",
        "/row/children/0/column",
    );
    check(
        LIST,
        json!({"schemaVersion":2,"columns":[{"id":"name","width":"1fr"}],"row":{"type":"box","children":[{"type":"box","children":[{"element":"server.name","column":"name"}]}]}}),
        "LST-05",
        "/row/children/0/children/0/column",
    );
    check(
        LIST,
        json!({"schemaVersion":2,"row":{"type":"box","context":"selection"}}),
        "ELE-03",
        "/row/context",
    );
    check(
        LIST,
        json!({"schemaVersion":2,"empty":{"element":"server.name"}}),
        "ELE-03",
        "/empty",
    );
}

#[test]
fn multiplicity_counts_surfaces_contexts_and_region_targets() {
    check(
        BROWSER,
        layout(
            json!({"type":"box","children":[{"surface":"surface.filterBar"},{"element":"filter.search"}]}),
        ),
        "ELE-04",
        "/root/children/1",
    );
    let panel = json!({"type":"box","context":"selection","children":[{"element":"server.join"}]});
    assert!(validate_layout_value(
        BROWSER,
        &layout(json!({"type":"box","children":[panel,panel]}))
    )
    .is_empty());
    check(
        BROWSER,
        layout(
            json!({"type":"box","context":"selection","children":[{"element":"server.join"},{"element":"server.join"}]}),
        ),
        "ELE-04",
        "/root/children/1",
    );
    let toggle = json!({"element":"app.collapseToggle","options":{"region":"r-one"}});
    check(
        SHELL,
        layout(json!({"type":"box","id":"r-one","children":[toggle,toggle]})),
        "ELE-04",
        "/root/children/1",
    );
    assert!(validate_layout_value(
        SHELL,
        &layout(json!({"type":"box","children":[
            {"type":"box","id":"r-one"},{"type":"box","id":"r-two"},toggle,
            {"element":"app.collapseToggle","options":{"region":"r-two"}}
        ]}))
    )
    .is_empty());
}

#[test]
fn alternatives_do_not_double_count_element_placements() {
    let root = json!({"type":"box","children":[{"element":"nav.servers"}]});
    assert!(validate_layout_value(
        SHELL,
        &json!({"schemaVersion":2,"variants":[
            {"minWidth":0,"root":root},{"minWidth":900,"root":root}
        ]})
    )
    .is_empty());
    assert!(validate_layout_value(
        SHELL,
        &layout(json!({"type":"box",
            "collapsible":{"default":"expanded","collapsed":root},
            "children":[{"element":"nav.servers"}]
        }))
    )
    .is_empty());
}

#[test]
fn tabs_accordion_and_collapsed_subtrees_are_traversed() {
    check(
        SHELL,
        layout(json!({"type":"tabs","tabs":[
            {"id":"same","label":{"type":"text","value":"first"},"content":{"type":"box"}},
            {"id":"same","label":{"type":"text","value":"second"},"content":{"type":"box"}}
        ]})),
        "LAY-11",
        "/root/tabs/1/id",
    );
    check(
        SHELL,
        layout(
            json!({"type":"accordion","mode":"single","initial":"first","sections":[
                {"id":"ok","header":{"type":"text","value":"header"},"body":{"element":"unknown"}}
            ]}),
        ),
        "ELE-01",
        "/root/sections/0/body/element",
    );
    check(
        SHELL,
        layout(json!({"type":"box","collapsible":{"collapsed":{"element":"unknown"}}})),
        "ELE-01",
        "/root/collapsible/collapsed/element",
    );
}

#[test]
fn malformed_json_and_issue_wire_format_are_stable() {
    let issues = validate_layout_file(SHELL, "{invalid");
    assert_eq!(issues[0].rule_id, "LAY-01");
    assert_eq!(issues[0].pointer, "");
    let wire = serde_json::to_value(&issues[0]).unwrap();
    assert_eq!(wire["ruleId"], "LAY-01");
    assert_eq!(wire["severity"], "error");
    assert!(wire.get("hint").is_none());
    assert_eq!(
        serde_json::from_value::<ValidationIssue>(wire).unwrap(),
        issues[0]
    );
}

#[test]
fn registry_exclusions_override_subject_placement_and_defaults_are_valid() {
    check(
        "layout/modals/serverInfo.json",
        layout(json!({"element":"server.info"})),
        "ELE-02",
        "/root",
    );
    assert!(validate_layout_value(
        BROWSER,
        &layout(json!({"element":"list.servers", "options":{"rowGap":"none"}}))
    )
    .is_empty());
}
