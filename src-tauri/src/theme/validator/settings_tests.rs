use serde_json::{json, Value};

use super::settings::{resolve_settings, validate_settings_schema, SettingsField, SettingsOption};

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
            schema(json!({"id":"foo","type":"boolean","label":"","default":false})),
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
        ("/options/1/label", json!("")),
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
fn fields_resolve_in_file_order_with_their_properties() {
    let value = json!({"schemaVersion":2,"fields":[
        {"id":"gap","type":"number","label":"Gap","min":0,"max":24,"step":2,"default":8},
        {"id":"compact","type":"boolean","label":"Compact","default":true},
        {"id":"density","type":"choice","label":"Density","default":"cosy","options":[{"value":"cosy","label":"Cosy"},{"value":"tight","label":"Tight"}]},
        {"id":"tint","type":"color","label":"Tint","default":"#abcdef"}
    ]});
    assert_eq!(
        resolve_settings(&value).fields,
        vec![
            SettingsField::Number {
                id: "gap".into(),
                label: "Gap".into(),
                min: 0.0,
                max: 24.0,
                step: Some(2.0),
                default: 8.0,
            },
            SettingsField::Boolean {
                id: "compact".into(),
                label: "Compact".into(),
                default: true,
            },
            SettingsField::Choice {
                id: "density".into(),
                label: "Density".into(),
                options: vec![
                    SettingsOption {
                        value: "cosy".into(),
                        label: "Cosy".into(),
                    },
                    SettingsOption {
                        value: "tight".into(),
                        label: "Tight".into(),
                    },
                ],
                default: "cosy".into(),
            },
            SettingsField::Color {
                id: "tint".into(),
                label: "Tint".into(),
                default: "#abcdef".into(),
            },
        ]
    );
    assert_eq!(
        resolve_settings(&schema(
            json!({"id":"gap","type":"number","label":"Gap","min":0,"max":24,"default":8})
        ))
        .fields[0],
        SettingsField::Number {
            id: "gap".into(),
            label: "Gap".into(),
            min: 0.0,
            max: 24.0,
            step: None,
            default: 8.0,
        }
    );
}

#[test]
fn invalid_fields_are_dropped_and_the_others_stay() {
    let good = json!({"id":"size","type":"number","label":"Size","min":0,"max":10,"default":5});
    let kept = SettingsField::Number {
        id: "size".into(),
        label: "Size".into(),
        min: 0.0,
        max: 10.0,
        step: None,
        default: 5.0,
    };
    for bad in [
        json!({"id":"mode","type":"text","label":"Mode"}),
        json!({"id":"size","type":"number","label":"Again","min":0,"max":10,"default":5}),
        json!({"id":"offset","type":"number","label":"Offset","min":0,"max":10,"default":11}),
        json!({"id":"blank","type":"boolean","label":"","default":true}),
    ] {
        let fields = resolve_settings(&json!({"schemaVersion":2,"fields":[good,bad]})).fields;
        assert_eq!(fields, vec![kept.clone()], "{bad}");
    }

    // A drop at one index does not reach the field at a higher index sharing the digits.
    let mut value = json!({"schemaVersion":2,"fields":(0..11)
        .map(|i| json!({"id":format!("f{i}"),"type":"boolean","label":"Flag","default":false}))
        .collect::<Vec<_>>()});
    value["fields"][1]["type"] = json!("text");
    let fields = resolve_settings(&value).fields;
    assert_eq!(fields.len(), 10);
    assert!(fields
        .iter()
        .any(|field| matches!(field, SettingsField::Boolean { id, .. } if id == "f10")));
}

#[test]
fn combinations_expand_discrete_fields_and_pin_defaults() {
    let value = json!({"schemaVersion":2,"fields":[
        {"id":"flag","type":"boolean","label":"Flag","default":true},
        {"id":"alt","type":"boolean","label":"Alt","default":false},
        {"id":"mode","type":"choice","label":"Mode","default":"a","options":[{"value":"a","label":"A"},{"value":"b","label":"B"}]},
        {"id":"size","type":"number","label":"Size","min":0,"max":10,"default":4}
    ]});
    let resolved = resolve_settings(&value);
    assert!(!resolved.capped);
    assert_eq!(resolved.combinations.len(), 8);
    assert_eq!(
        resolved.combinations[0].label,
        "flag=off · alt=off · mode=a"
    );
    assert_eq!(resolved.combinations[7].label, "flag=on · alt=on · mode=b");
    assert_eq!(
        serde_json::to_value(&resolved.combinations[0].values).unwrap(),
        json!({"flag":false,"alt":false,"mode":"a","size":4.0})
    );
    assert!(resolved
        .combinations
        .iter()
        .all(|combination| combination.values.len() == 4));

    let value = json!({"schemaVersion":2,"fields":[
        {"id":"size","type":"number","label":"Size","min":0,"max":10,"default":4},
        {"id":"tint","type":"color","label":"Tint","default":"#abcdef"}
    ]});
    let resolved = resolve_settings(&value);
    assert_eq!(resolved.combinations.len(), 1);
    assert_eq!(resolved.combinations[0].label, "Defaults");
    assert_eq!(
        serde_json::to_value(&resolved.combinations[0].values).unwrap(),
        json!({"size":4.0,"tint":"#abcdef"})
    );

    let value = json!({"schemaVersion":2,"fields":(0..7)
        .map(|i| json!({"id":format!("f{i}"),"type":"boolean","label":"Flag","default":false}))
        .collect::<Vec<_>>()});
    assert!(validate_settings_schema(&value)
        .iter()
        .any(|issue| issue.rule_id == "SET-05" && issue.pointer == "/fields"));
    let resolved = resolve_settings(&value);
    assert_eq!(resolved.fields.len(), 7);
    assert_eq!(resolved.combinations.len(), 64);
    assert!(resolved.capped);
    let distinct: std::collections::HashSet<String> = resolved
        .combinations
        .iter()
        .map(|c| serde_json::to_string(&c.values).unwrap())
        .collect();
    assert_eq!(distinct.len(), 64);
}
