//! The Linux `vm.max_map_count` limit, which DayZ under Proton runs out of.

/// DayZ needs at least this many memory areas to map.
pub const RECOMMENDED: u64 = 1_048_576;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct MemoryMapStatus {
    pub current: u64,
    pub recommended: u64,
}

pub fn status_from_text(text: &str) -> Option<MemoryMapStatus> {
    let current: u64 = text.trim().parse().ok()?;
    (current < RECOMMENDED).then_some(MemoryMapStatus {
        current,
        recommended: RECOMMENDED,
    })
}

#[cfg(target_os = "linux")]
pub fn current_status() -> Option<MemoryMapStatus> {
    let text = std::fs::read_to_string("/proc/sys/vm/max_map_count").ok()?;
    status_from_text(&text)
}

#[cfg(not(target_os = "linux"))]
pub fn current_status() -> Option<MemoryMapStatus> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_low_limit_reports_the_recommendation() {
        assert_eq!(
            status_from_text("65530\n"),
            Some(MemoryMapStatus {
                current: 65_530,
                recommended: 1_048_576
            })
        );
        assert_eq!(
            status_from_text("1048575"),
            Some(MemoryMapStatus {
                current: 1_048_575,
                recommended: 1_048_576
            })
        );
    }

    #[test]
    fn a_limit_at_or_above_the_recommendation_needs_no_warning() {
        assert_eq!(status_from_text("1048576\n"), None);
        assert_eq!(status_from_text("16777216\n"), None);
    }

    #[test]
    fn unreadable_text_gives_no_warning() {
        for text in ["", "  ", "abc", "-1", "1e6", "1048576 1048576"] {
            assert_eq!(status_from_text(text), None, "{text:?}");
        }
    }
}
