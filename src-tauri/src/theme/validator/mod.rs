pub mod ast;
mod composition;
pub mod issue;
mod rules;
pub mod settings;

#[cfg(test)]
mod settings_tests;

pub use issue::{Severity, ValidationIssue};

use std::sync::LazyLock;

use crate::theme::registry::{parse_registry, Registry};
use serde_json::Value;

static REGISTRY: LazyLock<Registry> =
    LazyLock::new(|| parse_registry().expect("compiled element registry is valid"));

pub fn validate_layout_file(file_path: &str, content: &str) -> Vec<ValidationIssue> {
    match serde_json::from_str(content) {
        Ok(value) => validate_layout_value(file_path, &value),
        Err(error) => vec![ValidationIssue {
            rule_id: "LAY-01".into(),
            severity: Severity::Error,
            file: file_path.into(),
            pointer: String::new(),
            message: format!("Invalid layout JSON: {error}"),
            hint: None,
        }],
    }
}

pub fn validate_theme_layouts(
    files: &std::collections::HashMap<String, Value>,
) -> Vec<ValidationIssue> {
    composition::validate(files, &REGISTRY)
}

pub fn validate_layout_value(file_path: &str, value: &Value) -> Vec<ValidationIssue> {
    rules::validate(file_path, value, &REGISTRY, &Default::default())
}

#[cfg(test)]
mod composition_tests;

#[cfg(test)]
mod tests;
