use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub const REGISTRY_JSON: &str = include_str!("../../../src/theme/registry.json");

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registry {
    pub registry_version: String,
    pub elements: BTreeMap<String, ElementDef>,
    pub surfaces: BTreeMap<String, SurfaceDef>,
    pub lists: BTreeMap<String, ListDef>,
    pub modals: BTreeMap<String, ModalDef>,
    pub popups: BTreeMap<String, PopupDef>,
    pub blocks: BTreeMap<String, BlockDef>,
    pub icons: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ElementKind {
    Display,
    Input,
    Action,
    Nav,
    Notice,
    List,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Subject {
    Server,
    Mod,
    ServerMod,
    ModServer,
    WorkshopMod,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Multiplicity {
    Many,
    PerComposition,
    PerContext,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EnumValue {
    Text(String),
    Number(i64),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum OptionDef {
    Enum {
        values: Vec<EnumValue>,
        #[serde(skip_serializing_if = "Option::is_none")]
        default: Option<EnumValue>,
    },
    Boolean {
        #[serde(skip_serializing_if = "Option::is_none")]
        default: Option<bool>,
    },
    Icon {
        #[serde(skip_serializing_if = "Option::is_none")]
        default: Option<String>,
    },
    Text {
        #[serde(skip_serializing_if = "Option::is_none")]
        default: Option<String>,
    },
    Length {
        #[serde(skip_serializing_if = "Option::is_none")]
        default: Option<String>,
    },
    Token {
        #[serde(skip_serializing_if = "Option::is_none")]
        default: Option<String>,
    },
    Region,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MultiplicityScope {
    Region,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElementDef {
    pub kind: ElementKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<Subject>,
    pub r#where: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excluded_where: Option<Vec<String>>,
    pub required: Vec<String>,
    pub multiplicity: Multiplicity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multiplicity_scope: Option<MultiplicityScope>,
    pub options: BTreeMap<String, OptionDef>,
    pub free_label: bool,
    pub parts: Vec<String>,
    pub states: Vec<String>,
    pub since: String,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceDef {
    pub r#where: Vec<String>,
    pub contains: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortDirection {
    Ascending,
    Descending,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SortDef {
    pub key: String,
    pub direction: SortDirection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListDef {
    pub subject: Subject,
    pub template: String,
    pub sort_keys: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_sort: Option<SortDef>,
    pub states: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModalDef {
    pub file: String,
    pub subject: Option<Subject>,
    pub required: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PopupDef {
    pub opened_by: String,
    pub required_contents: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockDef {
    pub r#where: Vec<String>,
}

pub fn parse_registry() -> Result<Registry, serde_json::Error> {
    serde_json::from_str(REGISTRY_JSON)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::path::Path;

    #[test]
    fn shared_registry_parses_without_losing_fields() {
        let registry = parse_registry().unwrap();
        assert_eq!(registry.registry_version, "2.0");
        assert_eq!(registry.elements.len(), 203);
        assert_eq!(
            serde_json::to_value(&registry).unwrap(),
            serde_json::from_str::<serde_json::Value>(REGISTRY_JSON).unwrap()
        );
    }

    /// A theme may name any icon in the registry, so the registry's allowlist
    /// must be exactly the set the renderer can draw — one entry out either way
    /// renders nothing or refuses an icon that works.
    #[test]
    fn icon_allowlist_matches_what_the_renderer_draws() {
        let source = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/theme/renderer/leaves.tsx"),
        )
        .expect("the renderer's icon table");

        let body = source
            .split_once("export const ICONS")
            .and_then(|(_, rest)| rest.split_once('{'))
            .and_then(|(_, rest)| rest.split_once("\n};"))
            .map(|(body, _)| body)
            .expect("the ICONS table");
        let drawn: BTreeSet<&str> = body
            .lines()
            .filter_map(|line| line.trim().split_once(':'))
            .map(|(name, _)| name)
            .collect();
        let registry = parse_registry().unwrap();
        let allowed: BTreeSet<&str> = registry.icons.iter().map(String::as_str).collect();

        assert_eq!(drawn, allowed);
    }

    /// The layout surfaces a theme may name. Nothing else pins the set, so a
    /// surface dropped from the registry would silently stop being targetable.
    #[test]
    fn every_layout_surface_is_registered() {
        let registry = parse_registry().unwrap();
        let surfaces: BTreeSet<&str> = registry.surfaces.keys().map(String::as_str).collect();

        assert_eq!(
            surfaces,
            BTreeSet::from([
                "surface.windowControls",
                "surface.navRail",
                "surface.filterBar",
                "surface.footerStatus",
                "surface.serverIdentity",
                "surface.serverStats",
                "surface.serverProps",
                "surface.modDetails",
                "surface.modsActionBar",
                "surface.updateBody",
            ])
        );
    }

    #[test]
    fn rejects_unknown_kinds_and_mistyped_options() {
        let mut json: serde_json::Value = serde_json::from_str(REGISTRY_JSON).unwrap();
        json["elements"]["server.join"]["kind"] = "button".into();
        assert!(serde_json::from_value::<Registry>(json).is_err());
        let mut json: serde_json::Value = serde_json::from_str(REGISTRY_JSON).unwrap();
        json["elements"]["app.logo"]["options"]["wordmark"]["default"] = "true".into();
        assert!(serde_json::from_value::<Registry>(json).is_err());
    }
}
