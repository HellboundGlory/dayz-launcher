use std::collections::HashSet;

use serde::Serialize;
use serde_json::Value;

use super::{Severity, ValidationIssue};

const COMBINATION_CAP: usize = 64;

fn issue(rule: &str, pointer: String, message: &str) -> ValidationIssue {
    ValidationIssue {
        rule_id: rule.into(),
        severity: Severity::Error,
        file: "settings.schema.json".into(),
        pointer,
        message: message.into(),
        hint: None,
    }
}

/// SET-01 to SET-04 per field; SET-05 comes from the resolver, over the fields that pass.
pub fn validate_settings_schema(value: &Value) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let mut report = |rule: &str, pointer: String, message: &str| {
        issues.push(issue(rule, pointer, message));
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
                "Expected a label of 1 to 40 characters",
            );
        }
        match field.get("type").and_then(Value::as_str) {
            Some("boolean") => {
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
                                "Expected an option label of 1 to 40 characters",
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
    issues
}

fn label(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|s| (1..=40).contains(&s.chars().count()))
}

/// One field of a resolved schema, as the app renders it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SettingsField {
    Number {
        id: String,
        label: String,
        min: f64,
        max: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        step: Option<f64>,
        default: f64,
    },
    Boolean {
        id: String,
        label: String,
        default: bool,
    },
    Choice {
        id: String,
        label: String,
        options: Vec<SettingsOption>,
        default: String,
    },
    Color {
        id: String,
        label: String,
        default: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SettingsOption {
    pub value: String,
    pub label: String,
}

impl SettingsField {
    pub fn id(&self) -> &str {
        match self {
            SettingsField::Number { id, .. }
            | SettingsField::Boolean { id, .. }
            | SettingsField::Choice { id, .. }
            | SettingsField::Color { id, .. } => id,
        }
    }

    /// The values a `hidden` condition can test, for the fields that are discrete.
    pub fn discrete_values(&self) -> Option<Vec<Value>> {
        match self {
            SettingsField::Boolean { .. } => Some(vec![Value::Bool(false), Value::Bool(true)]),
            SettingsField::Choice { options, .. } => Some(
                options
                    .iter()
                    .map(|option| Value::String(option.value.clone()))
                    .collect(),
            ),
            SettingsField::Number { .. } | SettingsField::Color { .. } => None,
        }
    }
}

/// One entry of the switcher: every field's value, and the label naming the discrete picks.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SettingsCombination {
    pub values: serde_json::Map<String, Value>,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ResolvedSettings {
    pub fields: Vec<SettingsField>,
    pub combinations: Vec<SettingsCombination>,
    pub capped: bool,
    #[serde(skip)]
    pub dropped: Vec<(String, String)>,
}

/// The fields a schema declares that pass validation, and the combinations they offer.
pub fn resolve_settings(schema: &Value) -> ResolvedSettings {
    resolve_settings_with_issues(schema).0
}

/// [`resolve_settings`] plus the issues the schema check found, for Dev Mode.
pub fn resolve_settings_with_issues(schema: &Value) -> (ResolvedSettings, Vec<ValidationIssue>) {
    let mut issues = validate_settings_schema(schema);
    // Only a field-level issue drops a field; `/schemaVersion` and `/fields` issues leave them alone.
    let mut fields = Vec::new();
    let mut dropped = Vec::new();
    let raw = schema
        .get("fields")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    for (index, field) in raw.iter().enumerate() {
        let prefix = format!("/fields/{index}");
        let nested = format!("{prefix}/");
        match issues
            .iter()
            .find(|issue| issue.pointer == prefix || issue.pointer.starts_with(&nested))
        {
            Some(issue) => {
                if let Some(id) = field.get("id").and_then(Value::as_str) {
                    dropped.push((id.to_string(), issue.rule_id.clone()));
                }
            }
            None => fields.push(settings_field(field)),
        }
    }
    // A duplicate id is refused only at its later field; the kept one still works.
    dropped.retain(|(id, _)| !fields.iter().any(|field| field.id() == id));
    let (combinations, capped) = combinations(&fields);
    if capped {
        issues.push(issue(
            "SET-05",
            "/fields".into(),
            "Settings exceed 64 discrete combinations",
        ));
    }
    (
        ResolvedSettings {
            fields,
            combinations,
            capped,
            dropped,
        },
        issues,
    )
}

/// Validation already checked every property read here, so the unwraps cannot fire.
fn settings_field(field: &Value) -> SettingsField {
    let id = field["id"].as_str().unwrap().to_string();
    let label = field["label"].as_str().unwrap().to_string();
    match field["type"].as_str().unwrap() {
        "number" => SettingsField::Number {
            id,
            label,
            min: field["min"].as_f64().unwrap(),
            max: field["max"].as_f64().unwrap(),
            step: field.get("step").and_then(Value::as_f64),
            default: field["default"].as_f64().unwrap(),
        },
        "boolean" => SettingsField::Boolean {
            id,
            label,
            default: field["default"].as_bool().unwrap(),
        },
        "choice" => SettingsField::Choice {
            id,
            label,
            options: field["options"]
                .as_array()
                .unwrap()
                .iter()
                .map(|option| SettingsOption {
                    value: option["value"].as_str().unwrap().to_string(),
                    label: option["label"].as_str().unwrap().to_string(),
                })
                .collect(),
            default: field["default"].as_str().unwrap().to_string(),
        },
        "color" => SettingsField::Color {
            id,
            label,
            default: field["default"].as_str().unwrap().to_string(),
        },
        _ => unreachable!("validation rejects every other type"),
    }
}

fn combinations(fields: &[SettingsField]) -> (Vec<SettingsCombination>, bool) {
    let mut defaults = serde_json::Map::new();
    let mut discrete: Vec<(&str, Vec<Value>)> = Vec::new();
    for field in fields {
        let default = match field {
            SettingsField::Number { default, .. } => Value::from(*default),
            SettingsField::Boolean { default, .. } => Value::Bool(*default),
            SettingsField::Choice { default, .. } | SettingsField::Color { default, .. } => {
                Value::String(default.clone())
            }
        };
        defaults.insert(field.id().to_string(), default);
        if let Some(values) = field.discrete_values() {
            discrete.push((field.id(), values));
        }
    }
    let total = discrete.iter().fold(1usize, |total, (_, values)| {
        total.saturating_mul(values.len())
    });
    let capped = total > COMBINATION_CAP;

    let mut combinations = Vec::with_capacity(total.min(COMBINATION_CAP));
    for index in 0..total.min(COMBINATION_CAP) {
        // Mixed-radix decode: the last discrete field varies fastest.
        let mut remaining = index;
        let mut values = defaults.clone();
        let mut parts = Vec::with_capacity(discrete.len());
        for (id, options) in discrete.iter().rev() {
            let value = options[remaining % options.len()].clone();
            remaining /= options.len();
            parts.push(format!("{id}={}", discrete_label(&value)));
            values.insert((*id).to_string(), value);
        }
        parts.reverse();
        let label = if parts.is_empty() {
            "Defaults".into()
        } else {
            parts.join(" · ")
        };
        combinations.push(SettingsCombination { values, label });
    }
    (combinations, capped)
}

fn discrete_label(value: &Value) -> &str {
    match value {
        Value::String(text) => text,
        Value::Bool(true) => "on",
        _ => "off",
    }
}
