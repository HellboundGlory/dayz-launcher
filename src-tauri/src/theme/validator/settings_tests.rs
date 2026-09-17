use serde_json::{json, Value};

use super::settings::{extract_settings_combinations, validate_settings_schema};

fn schema(field: Value) -> Value {
    json!({"schemaVersion":2,"fields":[field]})
}

#[test]
fn malformed_schemas_report_field_locations() {
    for (value, pointer) in [
        (json!({"fields":[]}), "/schemaVersion"),
        (json!({"schemaVersion":2,"fields":{}}), "/fields"),
        (
            schema(json!({"id":"foo","type":"boolean","label":"x".repeat(41),"default":false})),
            "/fields/0/label",
        ),
        (
            schema(json!({"id":"foo","type":"text","label":"Foo"})),
            "/fields/0/type",
        ),
        (schema(json!(null)), "/fields/0"),
        (
            schema(json!({"type":"boolean","label":"Foo","default":true})),
            "/fields/0/id",
        ),
    ] {
        assert!(validate_settings_schema(&value)
            .iter()
            .any(|issue| issue.rule_id == "SET-01" && issue.pointer == pointer));
        assert!(extract_settings_combinations(&value).is_err());
    }
}

#[test]
fn field_ids_are_ascii_bounded_and_unique() {
    for id in ["", "Foo", "foo-bar", "é", &"a".repeat(33)] {
        assert!(validate_settings_schema(&schema(
            json!({"id":id,"type":"boolean","label":"Foo","default":true})
        ))
        .iter()
        .any(|issue| issue.rule_id == "SET-02"));
    }
    let field = json!({"id":"foo","type":"boolean","label":"Foo","default":true});
    assert!(
        validate_settings_schema(&json!({"schemaVersion":2,"fields":[field,field]}))
            .iter()
            .any(|issue| issue.rule_id == "SET-02" && issue.pointer == "/fields/1/id")
    );
    assert!(validate_settings_schema(&schema(json!({"id":format!("a{}", "Z9".repeat(15)),"type":"boolean","label":"é".repeat(40),"default":false}))).is_empty());
}

#[test]
fn number_bounds_defaults_and_steps_are_enforced() {
    let valid =
        json!({"id":"size","type":"number","label":"Size","min":0,"max":10,"default":5,"step":0.5});
    for key in ["min", "max", "default"] {
        let mut field = valid.clone();
        field.as_object_mut().unwrap().remove(key);
        assert!(validate_settings_schema(&schema(field))
            .iter()
            .any(|issue| issue.rule_id == "SET-03" && issue.pointer.ends_with(key)));
    }
    for (key, value) in [
        ("min", json!(11)),
        ("default", json!(-1)),
        ("default", json!(11)),
        ("step", json!(0)),
        ("step", json!(-1)),
        ("step", json!("1")),
    ] {
        let mut field = valid.clone();
        field[key] = value;
        assert!(validate_settings_schema(&schema(field))
            .iter()
            .any(|issue| issue.rule_id == "SET-03"));
    }
    for boundary in [0, 10] {
        let mut field = valid.clone();
        field["default"] = json!(boundary);
        assert!(validate_settings_schema(&schema(field)).is_empty());
    }
}

#[test]
fn discrete_and_color_defaults_and_options_are_validated() {
    let choice = json!({"id":"mode","type":"choice","label":"Mode","default":"a","options":[{"value":"a","label":"A"},{"value":"b","label":"B"}]});
    for (pointer, value) in [
        ("/options", json!([{"value":"a","label":"A"}])),
        ("/options/1/value", json!("a")),
        ("/options/1/value", json!("Bad")),
        ("/options/1/label", json!("x".repeat(41))),
        ("/default", json!("c")),
    ] {
        let mut field = choice.clone();
        *field.pointer_mut(pointer).unwrap() = value;
        assert!(validate_settings_schema(&schema(field))
            .iter()
            .any(|issue| issue.rule_id == "SET-04"));
    }
    for field in [
        json!({"id":"foo","type":"boolean","label":"Foo","default":"true"}),
        json!({"id":"foo","type":"color","label":"Foo","default":"#fff"}),
        json!({"id":"foo","type":"color","label":"Foo","default":"#12345g"}),
    ] {
        assert!(validate_settings_schema(&schema(field))
            .iter()
            .any(|issue| issue.rule_id == "SET-04"));
    }
    assert!(validate_settings_schema(&schema(choice)).is_empty());
    assert!(validate_settings_schema(&schema(
        json!({"id":"foo","type":"color","label":"Foo","default":"#aB09fF"})
    ))
    .is_empty());
}

#[test]
fn combinations_expand_discrete_fields_only_and_enforce_the_cap() {
    let fields: Vec<_> = (0..7)
        .map(|i| json!({"id":format!("f{i}"),"type":"boolean","label":"Flag","default":false}))
        .collect();
    let mut value = json!({"schemaVersion":2,"fields":fields});
    let errors = extract_settings_combinations(&value).unwrap_err();
    assert!(errors
        .iter()
        .any(|issue| issue.rule_id == "SET-05" && issue.pointer == "/fields"));
    value["fields"].as_array_mut().unwrap().pop();
    let combinations = extract_settings_combinations(&value).unwrap();
    assert_eq!(combinations.len(), 64);
    let unique: std::collections::HashSet<_> = combinations
        .iter()
        .map(|settings| {
            (0..6)
                .map(|i| settings[&format!("f{i}")].as_bool().unwrap())
                .collect::<Vec<_>>()
        })
        .collect();
    assert_eq!(unique.len(), 64);
    let value = json!({"schemaVersion":2,"fields":[
        {"id":"flag","type":"boolean","label":"Flag","default":true},
        {"id":"mode","type":"choice","label":"Mode","default":"a","options":[{"value":"a","label":"A"},{"value":"b","label":"B"},{"value":"c","label":"C"}]},
        {"id":"size","type":"number","label":"Size","min":0,"max":1,"default":0},
        {"id":"tint","type":"color","label":"Tint","default":"#abcdef"}
    ]});
    let combinations = extract_settings_combinations(&value).unwrap();
    assert_eq!(combinations.len(), 6);
    for flag in [false, true] {
        for mode in ["a", "b", "c"] {
            assert!(combinations
                .iter()
                .any(|s| s.len() == 2 && s["flag"] == flag && s["mode"] == mode));
        }
    }
    assert_eq!(
        extract_settings_combinations(&json!({"schemaVersion":2,"fields":[]})).unwrap(),
        vec![std::collections::HashMap::new()]
    );
}
