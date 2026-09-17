use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TokenValue {
    Text(String),
    Number(f64),
}

impl From<&str> for TokenValue {
    fn from(value: &str) -> Self {
        Self::Text(value.into())
    }
}

macro_rules! token_group {
    ($name:ident { $($field:ident: $ty:ty = $value:expr => $key:literal,)* }) => {
        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        #[serde(default)]
        pub struct $name {
            $(#[serde(rename = $key)] pub $field: $ty,)*
        }

        impl Default for $name {
            fn default() -> Self {
                Self { $($field: $value,)* }
            }
        }
    };
}

token_group! {
    DarkColorsTokensV2 {
        bg: String = "#0d0f13".into() => "bg",
        surface: String = "#12151b".into() => "surface",
        surface2: String = "#1a1e26".into() => "surface2",
        border: String = "#262b34".into() => "border",
        text: String = "#e7ebf0".into() => "text",
        muted: String = "#7a8494".into() => "muted",
        muted2: String = "#98a2b2".into() => "muted2",
        accent: String = "#8fa3bd".into() => "accent",
        accent2: String = "#b0976a".into() => "accent2",
        success: String = "#4d9a75".into() => "success",
        warn: String = "#c19a55".into() => "warn",
        danger: String = "#b3564d".into() => "danger",
    }
}

token_group! {
    LightColorsTokensV2 {
        bg: String = "#f3f4f6".into() => "bg",
        surface: String = "#ffffff".into() => "surface",
        surface2: String = "#e9ebef".into() => "surface2",
        border: String = "#d2d6dc".into() => "border",
        text: String = "#181b20".into() => "text",
        muted: String = "#5d6570".into() => "muted",
        muted2: String = "#8a919d".into() => "muted2",
        accent: String = "#3e5f7d".into() => "accent",
        accent2: String = "#8a6d34".into() => "accent2",
        success: String = "#287a4f".into() => "success",
        warn: String = "#9a7b3a".into() => "warn",
        danger: String = "#a94a42".into() => "danger",
    }
}

token_group! {
    ColorsTokensV2 {
        dark: DarkColorsTokensV2 = DarkColorsTokensV2::default() => "dark",
        light: LightColorsTokensV2 = LightColorsTokensV2::default() => "light",
    }
}

token_group! {
    RadiusScalesTokensV2 {
        none: TokenValue = TokenValue::Number(0.0) => "none",
        xs: TokenValue = "2px".into() => "xs",
        sm: TokenValue = "4px".into() => "sm",
        md: TokenValue = "6px".into() => "md",
        lg: TokenValue = "8px".into() => "lg",
        full: TokenValue = "9999px".into() => "full",
    }
}

token_group! {
    SpaceScalesTokensV2 {
        step_0: TokenValue = "0px".into() => "0",
        step_2: TokenValue = "2px".into() => "2",
        step_4: TokenValue = "4px".into() => "4",
        step_6: TokenValue = "6px".into() => "6",
        step_8: TokenValue = "8px".into() => "8",
        step_10: TokenValue = "10px".into() => "10",
        step_12: TokenValue = "12px".into() => "12",
        step_14: TokenValue = "14px".into() => "14",
        step_16: TokenValue = "16px".into() => "16",
        step_18: TokenValue = "18px".into() => "18",
        step_20: TokenValue = "20px".into() => "20",
        step_22: TokenValue = "22px".into() => "22",
        step_24: TokenValue = "24px".into() => "24",
        step_26: TokenValue = "26px".into() => "26",
        step_28: TokenValue = "28px".into() => "28",
        step_30: TokenValue = "30px".into() => "30",
        step_32: TokenValue = "32px".into() => "32",
        step_34: TokenValue = "34px".into() => "34",
        step_36: TokenValue = "36px".into() => "36",
        step_38: TokenValue = "38px".into() => "38",
        step_40: TokenValue = "40px".into() => "40",
        step_42: TokenValue = "42px".into() => "42",
        step_44: TokenValue = "44px".into() => "44",
        step_46: TokenValue = "46px".into() => "46",
        step_48: TokenValue = "48px".into() => "48",
    }
}

token_group! {
    SizeTypeScalesTokensV2 {
        step_3xs: TokenValue = "7px".into() => "3xs",
        step_2xs: TokenValue = "8px".into() => "2xs",
        xs: TokenValue = "9px".into() => "xs",
        sm: TokenValue = "10px".into() => "sm",
        md: TokenValue = "11px".into() => "md",
        lg: TokenValue = "12px".into() => "lg",
        xl: TokenValue = "13px".into() => "xl",
        step_2xl: TokenValue = "14px".into() => "2xl",
        step_3xl: TokenValue = "22px".into() => "3xl",
    }
}

token_group! {
    WeightTypeScalesTokensV2 {
        normal: TokenValue = TokenValue::Number(400.0) => "normal",
        medium: TokenValue = TokenValue::Number(500.0) => "medium",
        semibold: TokenValue = TokenValue::Number(600.0) => "semibold",
        bold: TokenValue = TokenValue::Number(700.0) => "bold",
        extrabold: TokenValue = TokenValue::Number(800.0) => "extrabold",
    }
}

token_group! {
    TrackingTypeScalesTokensV2 {
        none: TokenValue = TokenValue::Number(0.0) => "none",
        tight: TokenValue = "-0.025em".into() => "tight",
        wide: TokenValue = "0.025em".into() => "wide",
        wider: TokenValue = "0.05em".into() => "wider",
        widest: TokenValue = "0.1em".into() => "widest",
    }
}

token_group! {
    LeadingTypeScalesTokensV2 {
        none: TokenValue = TokenValue::Number(1.0) => "none",
        tight: TokenValue = TokenValue::Number(1.25) => "tight",
        snug: TokenValue = TokenValue::Number(1.375) => "snug",
        normal: TokenValue = TokenValue::Number(1.5) => "normal",
        relaxed: TokenValue = TokenValue::Number(1.625) => "relaxed",
    }
}

token_group! {
    FamilyTypeScalesTokensV2 {
        ui: TokenValue = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif".into() => "ui",
        data: TokenValue = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace".into() => "data",
    }
}

token_group! {
    TypeScalesTokensV2 {
        size: SizeTypeScalesTokensV2 = SizeTypeScalesTokensV2::default() => "size",
        weight: WeightTypeScalesTokensV2 = WeightTypeScalesTokensV2::default() => "weight",
        tracking: TrackingTypeScalesTokensV2 = TrackingTypeScalesTokensV2::default() => "tracking",
        leading: LeadingTypeScalesTokensV2 = LeadingTypeScalesTokensV2::default() => "leading",
        family: FamilyTypeScalesTokensV2 = FamilyTypeScalesTokensV2::default() => "family",
    }
}

token_group! {
    BorderScalesTokensV2 {
        none: TokenValue = TokenValue::Number(0.0) => "none",
        hairline: TokenValue = "1px".into() => "hairline",
        thick: TokenValue = "2px".into() => "thick",
    }
}

token_group! {
    ShadowScalesTokensV2 {
        none: TokenValue = "none".into() => "none",
        sm: TokenValue = "0 8px 24px rgba(0,0,0,0.4)".into() => "sm",
        md: TokenValue = "0 10px 28px rgba(0,0,0,0.5)".into() => "md",
        lg: TokenValue = "0 12px 40px rgba(0,0,0,0.5)".into() => "lg",
        xl: TokenValue = "0 24px 60px rgba(0,0,0,0.6)".into() => "xl",
        glow: TokenValue = "var(--glow)".into() => "glow",
    }
}

token_group! {
    DurationMotionScalesTokensV2 {
        fast: TokenValue = "150ms".into() => "fast",
        normal: TokenValue = "200ms".into() => "normal",
        slow: TokenValue = "300ms".into() => "slow",
    }
}

token_group! {
    EasingMotionScalesTokensV2 {
        standard: TokenValue = "cubic-bezier(0.4, 0, 0.2, 1)".into() => "standard",
        linear: TokenValue = "linear".into() => "linear",
    }
}

token_group! {
    MotionScalesTokensV2 {
        duration: DurationMotionScalesTokensV2 = DurationMotionScalesTokensV2::default() => "duration",
        easing: EasingMotionScalesTokensV2 = EasingMotionScalesTokensV2::default() => "easing",
    }
}

token_group! {
    ScalesTokensV2 {
        radius: RadiusScalesTokensV2 = RadiusScalesTokensV2::default() => "radius",
        space: SpaceScalesTokensV2 = SpaceScalesTokensV2::default() => "space",
        r#type: TypeScalesTokensV2 = TypeScalesTokensV2::default() => "type",
        border: BorderScalesTokensV2 = BorderScalesTokensV2::default() => "border",
        shadow: ShadowScalesTokensV2 = ShadowScalesTokensV2::default() => "shadow",
        motion: MotionScalesTokensV2 = MotionScalesTokensV2::default() => "motion",
    }
}

token_group! {
    RadiusRolesTokensV2 {
        window: TokenValue = "lg".into() => "window",
        panel: TokenValue = "9px".into() => "panel",
        card: TokenValue = "lg".into() => "card",
        modal: TokenValue = "10px".into() => "modal",
        popup: TokenValue = "7px".into() => "popup",
        row: TokenValue = "lg".into() => "row",
        control: TokenValue = "md".into() => "control",
        input: TokenValue = "md".into() => "input",
        chip: TokenValue = "sm".into() => "chip",
        badge: TokenValue = "3px".into() => "badge",
        thumb: TokenValue = "7px".into() => "thumb",
        track: TokenValue = "xs".into() => "track",
        pill: TokenValue = "full".into() => "pill",
        sidebar_item: TokenValue = "7px".into() => "sidebarItem",
        control_small: TokenValue = "sm".into() => "controlSmall",
        popup_item: TokenValue = "5px".into() => "popupItem",
        confirm: TokenValue = "lg".into() => "confirm",
        control_compact: TokenValue = "5px".into() => "controlCompact",
        readiness_row: TokenValue = "5px".into() => "readinessRow",
        modal_large: TokenValue = "12px".into() => "modalLarge",
    }
}

token_group! {
    SpaceRolesTokensV2 {
        window_pad: TokenValue = "0".into() => "windowPad",
        panel_pad: TokenValue = "16".into() => "panelPad",
        modal_pad: TokenValue = "14".into() => "modalPad",
        popup_pad: TokenValue = "4".into() => "popupPad",
        row_x: TokenValue = "12".into() => "rowX",
        row_y: TokenValue = "8".into() => "rowY",
        control_x: TokenValue = "12".into() => "controlX",
        control_y: TokenValue = "6".into() => "controlY",
        chip_x: TokenValue = "4".into() => "chipX",
        chip_y: TokenValue = "1px".into() => "chipY",
        stack_gap: TokenValue = "12".into() => "stackGap",
        inline_gap: TokenValue = "6".into() => "inlineGap",
        section_gap: TokenValue = "14".into() => "sectionGap",
        list_gap: TokenValue = "6".into() => "listGap",
        control_compact_x: TokenValue = "8".into() => "controlCompactX",
        control_compact_y: TokenValue = "5px".into() => "controlCompactY",
        control_small_x: TokenValue = "10".into() => "controlSmallX",
        control_small_y: TokenValue = "2".into() => "controlSmallY",
        sidebar_pad: TokenValue = "8".into() => "sidebarPad",
        sidebar_settings_pad: TokenValue = "10".into() => "sidebarSettingsPad",
        sidebar_logo_y: TokenValue = "14".into() => "sidebarLogoY",
        sidebar_list_gap: TokenValue = "3px".into() => "sidebarListGap",
        sidebar_item_gap: TokenValue = "10".into() => "sidebarItemGap",
        inline_gap_wide: TokenValue = "8".into() => "inlineGapWide",
        inline_gap_small: TokenValue = "4".into() => "inlineGapSmall",
        popup_filter_pad: TokenValue = "5px".into() => "popupFilterPad",
        popup_offset: TokenValue = "5px".into() => "popupOffset",
        popup_clear_gap: TokenValue = "7px".into() => "popupClearGap",
        separator_x: TokenValue = "2".into() => "separatorX",
        separator_y: TokenValue = "4".into() => "separatorY",
        footer_x: TokenValue = "14".into() => "footerX",
        footer_y: TokenValue = "7px".into() => "footerY",
        footer_gap: TokenValue = "14".into() => "footerGap",
        state_chip_y: TokenValue = "3px".into() => "stateChipY",
        window_control_width: TokenValue = "40".into() => "windowControlWidth",
        window_control_height: TokenValue = "28".into() => "windowControlHeight",
        sidebar_width: TokenValue = "176px".into() => "sidebarWidth",
        sidebar_collapsed_width: TokenValue = "52px".into() => "sidebarCollapsedWidth",
        sidebar_toggle_offset: TokenValue = "96px".into() => "sidebarToggleOffset",
        sidebar_toggle_height: TokenValue = "46".into() => "sidebarToggleHeight",
        search_min_width: TokenValue = "140px".into() => "searchMinWidth",
        popup_min_width: TokenValue = "190px".into() => "popupMinWidth",
        popup_max_height: TokenValue = "320px".into() => "popupMaxHeight",
        scale_track_width: TokenValue = "120px".into() => "scaleTrackWidth",
        scale_knob_size: TokenValue = "7px".into() => "scaleKnobSize",
        slider_height: TokenValue = "3px".into() => "sliderHeight",
        state_dot_size: TokenValue = "5px".into() => "stateDotSize",
        ping_track_width: TokenValue = "56px".into() => "pingTrackWidth",
        data_width: TokenValue = "36".into() => "dataWidth",
        icon_tiny: TokenValue = "11px".into() => "iconTiny",
        icon_small: TokenValue = "12".into() => "iconSmall",
        icon_chevron: TokenValue = "13px".into() => "iconChevron",
        icon_medium: TokenValue = "14".into() => "iconMedium",
        icon_large: TokenValue = "18".into() => "iconLarge",
        icon_box: TokenValue = "22".into() => "iconBox",
    }
}

token_group! {
    DisplayTypeRolesTokensV2 {
        family: TokenValue = "data".into() => "family",
        size: TokenValue = "3xl".into() => "size",
        weight: TokenValue = "extrabold".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "none".into() => "leading",
    }
}

token_group! {
    HeadingTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "2xl".into() => "size",
        weight: TokenValue = "bold".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "snug".into() => "leading",
    }
}

token_group! {
    SubheadingTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "lg".into() => "size",
        weight: TokenValue = "semibold".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    BodyTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "md".into() => "size",
        weight: TokenValue = "normal".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    LabelTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "sm".into() => "size",
        weight: TokenValue = "semibold".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    CaptionTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "xs".into() => "size",
        weight: TokenValue = "normal".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "1.4".into() => "leading",
    }
}

token_group! {
    MicroTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "2xs".into() => "size",
        weight: TokenValue = "normal".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    ButtonTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "sm".into() => "size",
        weight: TokenValue = "bold".into() => "weight",
        tracking: TokenValue = "wider".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    ChipTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "2xs".into() => "size",
        weight: TokenValue = "bold".into() => "weight",
        tracking: TokenValue = "0.04em".into() => "tracking",
        leading: TokenValue = "1.3".into() => "leading",
    }
}

token_group! {
    DataTypeRolesTokensV2 {
        family: TokenValue = "data".into() => "family",
        size: TokenValue = "sm".into() => "size",
        weight: TokenValue = "normal".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    RowNameTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "lg".into() => "size",
        weight: TokenValue = "semibold".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    RowMetaTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "xs".into() => "size",
        weight: TokenValue = "normal".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    StatValueTypeRolesTokensV2 {
        family: TokenValue = "data".into() => "family",
        size: TokenValue = "xl".into() => "size",
        weight: TokenValue = "bold".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "none".into() => "leading",
    }
}

token_group! {
    StatCaptionTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "3xs".into() => "size",
        weight: TokenValue = "bold".into() => "weight",
        tracking: TokenValue = "0.07em".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    BrandTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "xl".into() => "size",
        weight: TokenValue = "bold".into() => "weight",
        tracking: TokenValue = "0.06em".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    CompactMicroTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "8.5px".into() => "size",
        weight: TokenValue = "normal".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    CompactCaptionTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "9.5px".into() => "size",
        weight: TokenValue = "normal".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    CompactBodyTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "10.5px".into() => "size",
        weight: TokenValue = "normal".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    CompactHeadingTypeRolesTokensV2 {
        family: TokenValue = "ui".into() => "family",
        size: TokenValue = "13.5px".into() => "size",
        weight: TokenValue = "normal".into() => "weight",
        tracking: TokenValue = "none".into() => "tracking",
        leading: TokenValue = "normal".into() => "leading",
    }
}

token_group! {
    TypeRolesTokensV2 {
        display: DisplayTypeRolesTokensV2 = DisplayTypeRolesTokensV2::default() => "display",
        heading: HeadingTypeRolesTokensV2 = HeadingTypeRolesTokensV2::default() => "heading",
        subheading: SubheadingTypeRolesTokensV2 = SubheadingTypeRolesTokensV2::default() => "subheading",
        body: BodyTypeRolesTokensV2 = BodyTypeRolesTokensV2::default() => "body",
        label: LabelTypeRolesTokensV2 = LabelTypeRolesTokensV2::default() => "label",
        caption: CaptionTypeRolesTokensV2 = CaptionTypeRolesTokensV2::default() => "caption",
        micro: MicroTypeRolesTokensV2 = MicroTypeRolesTokensV2::default() => "micro",
        button: ButtonTypeRolesTokensV2 = ButtonTypeRolesTokensV2::default() => "button",
        chip: ChipTypeRolesTokensV2 = ChipTypeRolesTokensV2::default() => "chip",
        data: DataTypeRolesTokensV2 = DataTypeRolesTokensV2::default() => "data",
        row_name: RowNameTypeRolesTokensV2 = RowNameTypeRolesTokensV2::default() => "rowName",
        row_meta: RowMetaTypeRolesTokensV2 = RowMetaTypeRolesTokensV2::default() => "rowMeta",
        stat_value: StatValueTypeRolesTokensV2 = StatValueTypeRolesTokensV2::default() => "statValue",
        stat_caption: StatCaptionTypeRolesTokensV2 = StatCaptionTypeRolesTokensV2::default() => "statCaption",
        brand: BrandTypeRolesTokensV2 = BrandTypeRolesTokensV2::default() => "brand",
        compact_micro: CompactMicroTypeRolesTokensV2 = CompactMicroTypeRolesTokensV2::default() => "compactMicro",
        compact_caption: CompactCaptionTypeRolesTokensV2 = CompactCaptionTypeRolesTokensV2::default() => "compactCaption",
        compact_body: CompactBodyTypeRolesTokensV2 = CompactBodyTypeRolesTokensV2::default() => "compactBody",
        compact_heading: CompactHeadingTypeRolesTokensV2 = CompactHeadingTypeRolesTokensV2::default() => "compactHeading",
    }
}

token_group! {
    ColorRolesTokensV2 {
        on_accent: TokenValue = "#10131a".into() => "onAccent",
        on_accent2: TokenValue = "#10131a".into() => "onAccent2",
        on_danger: TokenValue = "#10131a".into() => "onDanger",
        on_success: TokenValue = "#10131a".into() => "onSuccess",
        focus_ring: TokenValue = "var(--accent-line)".into() => "focusRing",
        scrim: TokenValue = "rgba(5,8,13,0.7)".into() => "scrim",
        row_hover: TokenValue = "var(--row-hover)".into() => "rowHover",
        row_selected: TokenValue = "var(--row-selected)".into() => "rowSelected",
    }
}

token_group! {
    BorderRolesTokensV2 {
        hairline: TokenValue = "hairline".into() => "hairline",
        control: TokenValue = "hairline".into() => "control",
        focus: TokenValue = "thick".into() => "focus",
    }
}

token_group! {
    ShadowRolesTokensV2 {
        panel: TokenValue = "none".into() => "panel",
        modal: TokenValue = "lg".into() => "modal",
        popup: TokenValue = "sm".into() => "popup",
        drawer: TokenValue = "-10px 0 26px rgba(0,0,0,0.4)".into() => "drawer",
        glow: TokenValue = "glow".into() => "glow",
        popup_filter: TokenValue = "md".into() => "popupFilter",
        state_warning: TokenValue = "0 0 4px var(--warn)".into() => "stateWarning",
        confirm: TokenValue = "0 25px 50px -12px rgb(0 0 0 / 0.25)".into() => "confirm",
        readiness_warning: TokenValue = "0 0 5px rgba(193,154,85,0.6)".into() => "readinessWarning",
        readiness_success: TokenValue = "0 0 5px rgba(77,154,117,0.6)".into() => "readinessSuccess",
        status_dot: TokenValue = "0 0 4px currentColor".into() => "statusDot",
        update: TokenValue = "0 25px 50px -12px rgb(0 0 0 / 0.5)".into() => "update",
    }
}

token_group! {
    HoverMotionRolesTokensV2 {
        duration: TokenValue = "fast".into() => "duration",
        easing: TokenValue = "standard".into() => "easing",
    }
}

token_group! {
    ExpandMotionRolesTokensV2 {
        duration: TokenValue = "normal".into() => "duration",
        easing: TokenValue = "standard".into() => "easing",
    }
}

token_group! {
    OverlayMotionRolesTokensV2 {
        duration: TokenValue = "0ms".into() => "duration",
        easing: TokenValue = "standard".into() => "easing",
    }
}

token_group! {
    MotionRolesTokensV2 {
        hover: HoverMotionRolesTokensV2 = HoverMotionRolesTokensV2::default() => "hover",
        expand: ExpandMotionRolesTokensV2 = ExpandMotionRolesTokensV2::default() => "expand",
        overlay: OverlayMotionRolesTokensV2 = OverlayMotionRolesTokensV2::default() => "overlay",
    }
}

token_group! {
    RolesTokensV2 {
        radius: RadiusRolesTokensV2 = RadiusRolesTokensV2::default() => "radius",
        space: SpaceRolesTokensV2 = SpaceRolesTokensV2::default() => "space",
        r#type: TypeRolesTokensV2 = TypeRolesTokensV2::default() => "type",
        color: ColorRolesTokensV2 = ColorRolesTokensV2::default() => "color",
        border: BorderRolesTokensV2 = BorderRolesTokensV2::default() => "border",
        shadow: ShadowRolesTokensV2 = ShadowRolesTokensV2::default() => "shadow",
        motion: MotionRolesTokensV2 = MotionRolesTokensV2::default() => "motion",
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TokensV2 {
    #[serde(deserialize_with = "schema_version")]
    pub schema_version: u8,
    pub colors: ColorsTokensV2,
    pub bloom: f64,
    pub scales: ScalesTokensV2,
    pub roles: RolesTokensV2,
}

impl Default for TokensV2 {
    fn default() -> Self {
        Self {
            schema_version: 2,
            colors: ColorsTokensV2::default(),
            bloom: 0.9,
            scales: ScalesTokensV2::default(),
            roles: RolesTokensV2::default(),
        }
    }
}

fn schema_version<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<u8, D::Error> {
    let version = u8::deserialize(deserializer)?;
    if version != 2 {
        return Err(serde::de::Error::custom("schemaVersion must be 2"));
    }
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_objects_restore_neutral_at_every_level() {
        for input in [
            "{}",
            r#"{"colors":{"dark":{}},"scales":{"type":{"size":{}}},"roles":{"type":{"heading":{}},"motion":{"hover":{}}}}"#,
        ] {
            let tokens: TokensV2 = serde_json::from_str(input).unwrap();
            assert_eq!(tokens, TokensV2::default());
        }
    }

    #[test]
    fn partial_overrides_preserve_sibling_defaults() {
        let tokens: TokensV2 = serde_json::from_str(r##"{
            "schemaVersion": 2, "bloom": 0,
            "colors": {"light": {"accent": "#ff0000"}},
            "scales": {"radius": {"md": "7px"}, "type": {"weight": {"normal": 450}}},
            "roles": {"type": {"heading": {"size": "17px"}}, "motion": {"hover": {"duration": "slow"}}}
        }"##).unwrap();
        let mut expected = TokensV2 {
            bloom: 0.0,
            ..TokensV2::default()
        };
        expected.colors.light.accent = "#ff0000".into();
        expected.scales.radius.md = "7px".into();
        expected.scales.r#type.weight.normal = TokenValue::Number(450.0);
        expected.roles.r#type.heading.size = "17px".into();
        expected.roles.motion.hover.duration = "slow".into();
        assert_eq!(tokens, expected);
        assert_eq!(
            serde_json::from_value::<TokensV2>(serde_json::to_value(&tokens).unwrap()).unwrap(),
            tokens
        );
    }

    #[test]
    fn invalid_leaf_shapes_are_not_accepted_as_overrides() {
        for input in [
            r#"{"schemaVersion":1}"#,
            r#"{"roles":{"radius":{"row":true}}}"#,
            r#"{"scales":{"space":{"6":null}}}"#,
        ] {
            assert!(serde_json::from_str::<TokensV2>(input).is_err());
        }
    }
}
