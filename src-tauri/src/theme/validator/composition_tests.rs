use std::collections::HashMap;

use serde_json::{json, Value};

use super::{validate_theme_layouts, REGISTRY};

const SHELL: &str = "layout/shell.json";
const BROWSER: &str = "layout/views/browser.json";

fn layout(elements: &[&str]) -> Value {
    json!({"schemaVersion": 2, "root": {"type":"stack", "children": elements.iter().map(|id| json!({"element":id})).collect::<Vec<_>>()}})
}

fn required(codes: &[&str]) -> Vec<&'static str> {
    REGISTRY
        .elements
        .iter()
        .filter(|(_, def)| {
            def.required
                .iter()
                .any(|code| codes.contains(&code.as_str()))
        })
        .map(|(id, _)| id.as_str())
        .collect()
}

fn theme() -> HashMap<String, Value> {
    HashMap::from([
        (
            SHELL.into(),
            layout(&required(&["views", "views+settings"])),
        ),
        (BROWSER.into(), layout(&required(&["view:browser"]))),
        (
            "layout/views/mods.json".into(),
            layout(&required(&["view:mods"])),
        ),
        (
            "layout/settings.json".into(),
            layout(&required(&["settings"])),
        ),
    ])
}

#[test]
fn valid_compositions_share_shell_requirements_and_allow_view_only_themes() {
    let files = theme();
    assert_eq!(validate_theme_layouts(&files), vec![]);
    let standalone = HashMap::from([(
        BROWSER.into(),
        layout(&required(&["views", "views+settings", "view:browser"])),
    )]);
    assert_eq!(validate_theme_layouts(&standalone), vec![]);
    assert_eq!(validate_theme_layouts(&HashMap::new()), vec![]);
}

#[test]
fn required_failures_report_composition_file_and_row_pointer() {
    for (file, rule, pointer) in [
        (BROWSER, "REQ-01", ""),
        ("layout/views/mods.json", "REQ-01", ""),
        ("layout/settings.json", "REQ-02", ""),
        ("layout/modals/serverInfo.json", "REQ-03", ""),
        ("layout/modals/modFilter.json", "REQ-03", ""),
        ("layout/modals/update.json", "REQ-03", ""),
        ("layout/popups/mapFilter.json", "REQ-04", ""),
        ("layout/popups/modsUnique.json", "REQ-04", ""),
        ("layout/popups/regionFilter.json", "REQ-04", ""),
        ("layout/popups/sort.json", "REQ-04", ""),
        ("layout/popups/tagsFilter.json", "REQ-04", ""),
        ("layout/lists/servers.json", "REQ-05", "/row"),
        ("layout/lists/mods.json", "REQ-05", "/row"),
        ("layout/lists/modFilterResults.json", "REQ-05", "/row"),
    ] {
        let value = if file.contains("/lists/") {
            json!({"schemaVersion":2,"row":{"type":"box"}})
        } else {
            layout(&[])
        };
        let issues = validate_theme_layouts(&HashMap::from([(file.into(), value)]));
        assert!(
            issues.iter().any(|issue| issue.rule_id == rule
                && issue.file == file
                && issue.pointer == pointer),
            "{file}: {issues:#?}"
        );
    }
}

#[test]
fn surfaces_satisfy_requirements_and_collide_with_explicit_elements() {
    let mut files = theme();
    let children = files.get_mut(SHELL).unwrap()["root"]["children"]
        .as_array_mut()
        .unwrap();
    children.retain(|node| {
        !["app.minimize", "app.maximize", "app.close"].contains(&node["element"].as_str().unwrap())
    });
    children.push(json!({"surface":"surface.windowControls"}));
    assert_eq!(validate_theme_layouts(&files), vec![]);
    files.get_mut(BROWSER).unwrap()["root"]["children"]
        .as_array_mut()
        .unwrap()
        .push(json!({"element":"app.close"}));
    let issues = validate_theme_layouts(&files);
    assert!(issues
        .iter()
        .any(|i| i.rule_id == "ELE-04" && i.file == BROWSER));
}

#[test]
fn join_notice_is_required_in_each_row_modal_and_selection_context() {
    for (file, rule) in [
        ("layout/lists/servers.json", "REQ-05"),
        ("layout/modals/serverInfo.json", "REQ-03"),
        (BROWSER, "REQ-01"),
    ] {
        let mut files = theme();
        let mut root = layout(&["server.join"])["root"].take();
        let field = if file.contains("/lists/") {
            "row"
        } else {
            "root"
        };
        if file == BROWSER {
            root["context"] = json!("selection");
        }
        if file.contains("/modals/") {
            root["children"]
                .as_array_mut()
                .unwrap()
                .push(json!({"element":"modal.close"}));
        }
        let value = json!({"schemaVersion":2, field:root});
        files.insert(file.into(), value);
        let issues = validate_theme_layouts(&files);
        assert!(
            issues
                .iter()
                .any(|i| i.rule_id == rule && i.message.contains("server.actionNotice")),
            "{issues:#?}"
        );
        files.get_mut(file).unwrap()[field]["children"]
            .as_array_mut()
            .unwrap()
            .push(json!({"element":"server.actionNotice"}));
        assert!(!validate_theme_layouts(&files)
            .iter()
            .any(|i| i.message.contains("server.actionNotice")));
    }
}

#[test]
fn another_selection_cannot_supply_join_notice() {
    let mut files = theme();
    let children = files.get_mut(BROWSER).unwrap()["root"]["children"]
        .as_array_mut()
        .unwrap();
    children.extend([
        json!({"type":"box","context":"selection","children":[{"element":"server.join"}]}),
        json!({"type":"box","context":"selection","children":[{"element":"server.actionNotice"}]}),
    ]);
    assert!(validate_theme_layouts(&files)
        .iter()
        .any(|i| i.rule_id == "REQ-01" && i.message.contains("server.actionNotice")));
}

#[test]
fn popup_close_depends_on_placement_mode() {
    let file = "layout/popups/mapFilter.json";
    let mut files = HashMap::from([(file.into(), layout(&["popup.mapOptions"]))]);
    assert_eq!(validate_theme_layouts(&files), vec![]);
    files.get_mut(file).unwrap()["placement"] = json!({"mode":"inline"});
    assert!(validate_theme_layouts(&files)
        .iter()
        .any(|i| i.rule_id == "REQ-04" && i.message.contains("popup.close")));
    files.get_mut(file).unwrap()["root"]["children"]
        .as_array_mut()
        .unwrap()
        .push(json!({"element":"popup.close"}));
    assert_eq!(validate_theme_layouts(&files), vec![]);
}

#[test]
fn region_ids_are_global_but_references_only_resolve_in_composing_files() {
    let mut files = theme();
    files.get_mut(SHELL).unwrap()["root"]["id"] = json!("r-main");
    files.get_mut(BROWSER).unwrap()["root"]["children"]
        .as_array_mut()
        .unwrap()
        .push(json!({"element":"app.collapseToggle","options":{"region":"r-main"}}));
    files.get_mut("layout/settings.json").unwrap()["presentation"] =
        json!({"mode":"overlay","region":"r-main"});
    assert_eq!(validate_theme_layouts(&files), vec![]);
    files.get_mut("layout/views/mods.json").unwrap()["root"]["id"] = json!("r-main");
    assert!(validate_theme_layouts(&files)
        .iter()
        .any(|i| i.rule_id == "LAY-08"));
    files.get_mut("layout/views/mods.json").unwrap()["root"]["id"] = json!("r-other");
    files.get_mut(BROWSER).unwrap()["root"]["children"]
        .as_array_mut()
        .unwrap()
        .push(json!({"element":"app.collapseToggle","options":{"region":"r-other"}}));
    assert!(validate_theme_layouts(&files)
        .iter()
        .any(|i| i.rule_id == "LAY-09" && i.file == BROWSER));
    files.get_mut(BROWSER).unwrap()["metadata"] = json!({"ref":"r-missing"});
    assert!(validate_theme_layouts(&files)
        .iter()
        .any(|i| i.rule_id == "LAY-09" && i.pointer == "/metadata/ref"));
}

#[test]
fn responsive_compositions_only_compare_simultaneously_active_roots() {
    let mut files = theme();
    let shell = files[SHELL]["root"].clone();
    let browser = files[BROWSER]["root"].clone();
    files
        .get_mut(SHELL)
        .unwrap()
        .as_object_mut()
        .unwrap()
        .remove("root");
    files
        .get_mut(BROWSER)
        .unwrap()
        .as_object_mut()
        .unwrap()
        .remove("root");
    files.get_mut(SHELL).unwrap()["variants"] =
        json!([{"minWidth":0,"root":shell},{"minWidth":800,"root":shell}]);
    files.get_mut(BROWSER).unwrap()["variants"] =
        json!([{"minWidth":0,"root":browser},{"minWidth":800,"root":browser}]);
    assert_eq!(validate_theme_layouts(&files), vec![]);
    files.get_mut(BROWSER).unwrap()["variants"][1]["root"]["children"] = json!([]);
    assert!(validate_theme_layouts(&files)
        .iter()
        .any(|i| i.rule_id == "REQ-01"));
}

#[test]
fn nested_surfaces_expand_recursively() {
    let mut registry = (*REGISTRY).clone();
    registry
        .surfaces
        .get_mut("surface.windowControls")
        .unwrap()
        .contains = vec!["surface.testControls".into()];
    registry.surfaces.insert(
        "surface.testControls".into(),
        crate::theme::registry::SurfaceDef {
            r#where: vec!["app".into()],
            contains: vec![
                "app.minimize".into(),
                "app.maximize".into(),
                "app.close".into(),
            ],
        },
    );
    let mut files = theme();
    let children = files.get_mut(SHELL).unwrap()["root"]["children"]
        .as_array_mut()
        .unwrap();
    children.retain(|node| {
        !["app.minimize", "app.maximize", "app.close"].contains(&node["element"].as_str().unwrap())
    });
    children.push(json!({"surface":"surface.windowControls"}));
    assert_eq!(super::composition::validate(&files, &registry), vec![]);
}

#[test]
fn empty_row_content_neither_satisfies_requirements_nor_hides_regions() {
    let file = "layout/lists/servers.json";
    let mut files = HashMap::from([
        (
            file.into(),
            json!({"schemaVersion":2,"row":{"type":"box","children":[{"element":"server.join"}],"empty":{"element":"server.actionNotice"}},"empty":{"type":"box","id":"r-empty"}}),
        ),
        (
            SHELL.into(),
            json!({"schemaVersion":2,"root":{"type":"box","id":"r-empty"}}),
        ),
    ]);
    let issues = validate_theme_layouts(&files);
    assert!(issues
        .iter()
        .any(|i| i.rule_id == "REQ-05" && i.message.contains("server.actionNotice")));
    assert!(issues.iter().any(|i| i.rule_id == "LAY-08"));
    files.get_mut(file).unwrap()["row"] = json!({"type":"box"});
    files.get_mut(file).unwrap()["empty"] = json!({"element":"server.join"});
    assert!(validate_theme_layouts(&files)
        .iter()
        .any(|i| i.rule_id == "REQ-05" && i.message.contains("server.join")));
}
