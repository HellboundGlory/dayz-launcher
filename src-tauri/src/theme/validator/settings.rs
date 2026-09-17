use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::{Severity, ValidationIssue};

pub fn validate_settings_schema(value: &Value) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let mut report = |rule: &str, pointer: String, message: &str| {
        issues.push(ValidationIssue {
            rule_id: rule.into(),
            severity: Severity::Error,
            file: "settings.schema.json".into(),
            pointer,
            message: message.into(),
            hint: None,
        });
    };
    if !value.is_object() || value.get("schemaVersion").and_then(Value::as_u64) != Some(2) {
        report(
            "SET-01",
            "/schemaVersion".into(),
            "Expected a schema object with schemaVersion 2",
        );
    }
    let Some(fields) = value.get("fields").and_then(Value::as_array) else {
        report("SET-01", "/fields".into(), "Expected a fields array");
        return issues;
    };
    let mut ids = HashSet::new();
    let mut count = 1usize;
    for (index, field) in fields.iter().enumerate() {
        let path = format!("/fields/{index}");
        if !field.is_object() {
            report("SET-01", path, "Expected a field object");
            continue;
        }
        for key in ["id", "type", "label"] {
            if field.get(key).is_none() {
                report(
                    "SET-01",
                    format!("{path}/{key}"),
                    "Missing required field property",
                );
            }
        }
        if !field.get("id").and_then(Value::as_str).is_some_and(|id| {
            let valid = (1..=32).contains(&id.len())
                && id.as_bytes()[0].is_ascii_lowercase()
                && id.bytes().all(|c| c.is_ascii_alphanumeric());
            valid && ids.insert(id)
        }) {
            report(
                "SET-02",
                format!("{path}/id"),
                "Expected a unique field id matching [a-z][a-zA-Z0-9]{0,31}",
            );
        }
        if !label(field.get("label")) {
            report(
                "SET-01",
                format!("{path}/label"),
                "Expected a label of at most 40 characters",
            );
        }
        match field.get("type").and_then(Value::as_str) {
            Some("boolean") => {
                count = count.saturating_mul(2);
                if !field.get("default").is_some_and(Value::is_boolean) {
                    report(
                        "SET-04",
                        format!("{path}/default"),
                        "Expected a boolean default",
                    );
                }
            }
            Some("choice") => {
                let mut values = HashSet::new();
                if let Some(options) = field.get("options").and_then(Value::as_array) {
                    count = count.saturating_mul(options.len());
                    if options.len() < 2 {
                        report(
                            "SET-04",
                            format!("{path}/options"),
                            "Expected at least two options",
                        );
                    }
                    for (i, option) in options.iter().enumerate() {
                        if !option
                            .get("value")
                            .and_then(Value::as_str)
                            .is_some_and(|value| {
                                !value.is_empty()
                                    && value.bytes().all(|c| {
                                        c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-'
                                    })
                                    && values.insert(value)
                            })
                        {
                            report(
                                "SET-04",
                                format!("{path}/options/{i}/value"),
                                "Expected a unique option value matching [a-z0-9-]+",
                            );
                        }
                        if !label(option.get("label")) {
                            report(
                                "SET-04",
                                format!("{path}/options/{i}/label"),
                                "Expected an option label of at most 40 characters",
                            );
                        }
                    }
                } else {
                    report(
                        "SET-04",
                        format!("{path}/options"),
                        "Expected an options array",
                    );
                }
                if !field
                    .get("default")
                    .and_then(Value::as_str)
                    .is_some_and(|value| values.contains(value))
                {
                    report(
                        "SET-04",
                        format!("{path}/default"),
                        "Default must match an option value",
                    );
                }
            }
            Some("number") => {
                let bounds = ["min", "max", "default"].map(|key| {
                    let number = field
                        .get(key)
                        .and_then(Value::as_f64)
                        .filter(|v| v.is_finite());
                    if number.is_none() {
                        report(
                            "SET-03",
                            format!("{path}/{key}"),
                            "Expected a finite number",
                        );
                    }
                    number
                });
                if let [Some(min), Some(max), Some(default)] = bounds {
                    if min > max {
                        report(
                            "SET-03",
                            format!("{path}/min"),
                            "Minimum must not exceed maximum",
                        );
                    }
                    if !(min..=max).contains(&default) {
                        report(
                            "SET-03",
                            format!("{path}/default"),
                            "Default must lie within the bounds",
                        );
                    }
                }
                if field
                    .get("step")
                    .is_some_and(|v| !v.as_f64().is_some_and(|v| v.is_finite() && v > 0.0))
                {
                    report(
                        "SET-03",
                        format!("{path}/step"),
                        "Step must be a positive finite number",
                    );
                }
            }
            Some("color") => {
                if !field
                    .get("default")
                    .and_then(Value::as_str)
                    .is_some_and(|v| {
                        v.len() == 7
                            && v.starts_with('#')
                            && v.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
                    })
                {
                    report(
                        "SET-04",
                        format!("{path}/default"),
                        "Expected a #RRGGBB color default",
                    );
                }
            }
            _ => report("SET-01", format!("{path}/type"), "Unknown setting type"),
        }
    }
    if count > 64 {
        report(
            "SET-05",
            "/fields".into(),
            "Settings exceed 64 discrete combinations",
        );
    }
    issues
}

fn label(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|s| s.chars().count() <= 40)
}

pub fn extract_settings_combinations(
    schema: &Value,
) -> Result<Vec<HashMap<String, Value>>, Vec<ValidationIssue>> {
    let issues = validate_settings_schema(schema);
    if !issues.is_empty() {
        return Err(issues);
    }
    let mut combinations = vec![HashMap::new()];
    for field in schema["fields"].as_array().unwrap() {
        let values = match field["type"].as_str().unwrap() {
            "boolean" => vec![Value::Bool(false), Value::Bool(true)],
            "choice" => field["options"]
                .as_array()
                .unwrap()
                .iter()
                .map(|option| option["value"].clone())
                .collect(),
            _ => continue,
        };
        let id = field["id"].as_str().unwrap();
        let mut expanded = Vec::with_capacity(combinations.len() * values.len());
        for combination in combinations {
            for value in &values {
                let mut next = combination.clone();
                next.insert(id.into(), value.clone());
                expanded.push(next);
            }
        }
        combinations = expanded;
    }
    Ok(combinations)
}
