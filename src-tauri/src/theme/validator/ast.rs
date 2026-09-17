use serde_json::{Map, Value};

// Borrow the JSON so malformed fields retain their exact diagnostic locations.
#[derive(Debug, Clone, Copy)]
pub struct LayoutFile<'a> {
    pub fields: &'a Map<String, Value>,
}

impl<'a> LayoutFile<'a> {
    pub fn from_value(value: &'a Value) -> Option<Self> {
        value.as_object().map(|fields| Self { fields })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    Stack,
    Grid,
    Box,
    Scroll,
    Tabs,
    Accordion,
    Element,
    Surface,
    Text,
    Image,
    Outlet,
}

impl NodeKind {
    pub fn is_container(self) -> bool {
        matches!(
            self,
            Self::Stack | Self::Grid | Self::Box | Self::Scroll | Self::Tabs | Self::Accordion
        )
    }

    pub fn accepts(self, prop: &str) -> bool {
        if COMMON_PROPS.contains(&prop) {
            return true;
        }
        if self.is_container() && matches!(prop, "children" | "gap" | "empty") {
            return true;
        }
        match self {
            Self::Stack => matches!(prop, "direction" | "align" | "justify" | "wrap"),
            Self::Grid => matches!(
                prop,
                "columns"
                    | "rows"
                    | "areas"
                    | "columnGap"
                    | "rowGap"
                    | "alignItems"
                    | "justifyItems"
            ),
            Self::Scroll => prop == "axis",
            Self::Tabs => prop == "tabs",
            Self::Accordion => matches!(prop, "sections" | "mode" | "initial"),
            Self::Element => matches!(prop, "element" | "options" | "label"),
            Self::Surface => prop == "surface",
            Self::Text => matches!(prop, "value" | "role"),
            Self::Image => matches!(prop, "src" | "icon" | "fit"),
            Self::Outlet => prop == "name",
            Self::Box => false,
        }
    }
}

pub const COMMON_PROPS: &[&str] = &[
    "type",
    "id",
    "class",
    "padding",
    "paddingX",
    "paddingY",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "width",
    "height",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "grow",
    "shrink",
    "basis",
    "area",
    "position",
    "hidden",
    "landmark",
    "context",
    "collapsible",
    "resizable",
    "column",
];

#[derive(Debug, Clone, Copy)]
pub struct Node<'a> {
    pub kind: NodeKind,
    pub props: &'a Map<String, Value>,
}

impl<'a> Node<'a> {
    pub fn from_value(value: &'a Value) -> Option<Self> {
        let props = value.as_object()?;
        let kind = match (
            props.get("type"),
            props.contains_key("element"),
            props.contains_key("surface"),
        ) {
            (None, true, false) => NodeKind::Element,
            (None, false, true) => NodeKind::Surface,
            (Some(Value::String(kind)), false, false) => match kind.as_str() {
                "stack" => NodeKind::Stack,
                "grid" => NodeKind::Grid,
                "box" => NodeKind::Box,
                "scroll" => NodeKind::Scroll,
                "tabs" => NodeKind::Tabs,
                "accordion" => NodeKind::Accordion,
                "text" => NodeKind::Text,
                "image" => NodeKind::Image,
                "outlet" => NodeKind::Outlet,
                _ => return None,
            },
            _ => return None,
        };
        Some(Self { kind, props })
    }
}
