#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ValidationIssue {
    #[serde(rename = "ruleId")]
    pub rule_id: String,
    pub severity: Severity,
    pub file: String,
    pub pointer: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

impl ValidationIssue {
    pub fn error(
        rule: impl Into<String>,
        file: impl Into<String>,
        pointer: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            rule_id: rule.into(),
            severity: Severity::Error,
            file: file.into(),
            pointer: pointer.into(),
            message: message.into(),
            hint: None,
        }
    }
}
