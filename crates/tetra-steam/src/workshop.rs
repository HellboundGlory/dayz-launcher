/// Steam's `EItemState` bit values, and the classification the launcher derives
/// from them.
pub struct ItemFlags(pub u32);

/// Steam's `EItemState` bitmask. Mirrors `steamworks::ugc::ItemState` and must
/// not be renumbered. `LEGACY_ITEM` is listed even though nothing reads it —
/// omitting it shifts every flag above `SUBSCRIBED` down one bit.
impl ItemFlags {
    pub const NONE: u32 = 0;
    pub const SUBSCRIBED: u32 = 1;
    pub const LEGACY_ITEM: u32 = 2;
    pub const INSTALLED: u32 = 4;
    pub const NEEDS_UPDATE: u32 = 8;
    pub const DOWNLOADING: u32 = 16;
    pub const DOWNLOAD_PENDING: u32 = 32;
}

/// What the launcher should say about one workshop item.
///
/// Derived from the raw bitmask in exactly one place so the pre-launch gate and
/// the details panel can never disagree about whether a mod is usable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModState {
    /// Installed, current, and not mid-download.
    Ready,
    /// Installed but Steam has a newer version — must not count as ready.
    NeedsUpdate,
    Downloading,
    /// Subscribed but the content is not on disk yet.
    NotInstalled,
    /// No bits set. Steam returns `NONE` both for "never subscribed" and "not
    /// a workshop item at all" — the two can't be told apart from `item_state`.
    NotSubscribed,
    /// The server declared this mod with workshop id `0` — server-side or
    /// locally-installed mods with nothing to subscribe to. Excluded from
    /// every Steam call: `download_item(0)` queues a phantom transfer that
    /// persists until Steam restarts.
    NotOnWorkshop,
}

impl ModState {
    /// Classify a raw `EItemState` bitmask. Order matters since the bits
    /// co-occur: downloading wins outright (content on disk is in flux),
    /// then not-subscribed outranks installed (Steam clears `SUBSCRIBED`
    /// before it deletes the folder), then needs-update outranks installed.
    pub fn from_bits(bits: u32) -> Self {
        let set = |flag: u32| bits & flag != 0;

        if set(ItemFlags::DOWNLOADING) || set(ItemFlags::DOWNLOAD_PENDING) {
            Self::Downloading
        } else if !set(ItemFlags::SUBSCRIBED) {
            Self::NotSubscribed
        } else if set(ItemFlags::NEEDS_UPDATE) {
            Self::NeedsUpdate
        } else if set(ItemFlags::INSTALLED) {
            Self::Ready
        } else {
            Self::NotInstalled
        }
    }

    /// Whether this id is a Workshop item Steam can act on at all — Steam
    /// accepts id `0` and then misbehaves rather than erroring.
    pub fn is_workshop_id(workshop_id: u64) -> bool {
        workshop_id != 0
    }

    /// Whether DayZ can be launched against this mod as-is.
    pub fn is_ready(self) -> bool {
        matches!(self, Self::Ready)
    }
}

/// Whether the copy on disk is missing or older than the Workshop copy.
/// `updated_at == 0` means Steam has not answered yet, so hold off.
pub fn is_outdated(installed_at: u32, updated_at: u32) -> bool {
    updated_at != 0 && (installed_at == 0 || updated_at > installed_at)
}

#[cfg(test)]
mod tests {
    use super::{is_outdated, ItemFlags, ModState};

    #[test]
    fn outdated_follows_the_disk_and_workshop_timestamps() {
        let cases = [
            (0, 0, false),
            (0, 1_700_000_000, true),
            (1_700_000_000, 0, false),
            (1_700_000_000, 1_700_000_001, true),
            (1_700_000_000, 1_700_000_000, false),
            (1_700_000_001, 1_700_000_000, false),
        ];
        for (installed_at, updated_at, expected) in cases {
            assert_eq!(
                is_outdated(installed_at, updated_at),
                expected,
                "installed_at={installed_at} updated_at={updated_at}"
            );
        }
    }

    /// Pinned against Steam's wire values — renumbering these silently
    /// corrupts every mod-state reading in the app.
    #[test]
    fn flag_values_match_steam() {
        assert_eq!(ItemFlags::NONE, 0);
        assert_eq!(ItemFlags::SUBSCRIBED, 1);
        assert_eq!(ItemFlags::LEGACY_ITEM, 2);
        assert_eq!(ItemFlags::INSTALLED, 4);
        assert_eq!(ItemFlags::NEEDS_UPDATE, 8);
        assert_eq!(ItemFlags::DOWNLOADING, 16);
        assert_eq!(ItemFlags::DOWNLOAD_PENDING, 32);
    }

    /// Bit combinations Steam actually reports. Order matters: downloading
    /// wins outright (content on disk is in flux), then not-subscribed
    /// outranks installed, then needs-update outranks installed.
    #[test]
    fn steam_flags_map_to_the_mod_state_they_describe() {
        let cases: [(u32, ModState); 9] = [
            (
                ItemFlags::SUBSCRIBED | ItemFlags::INSTALLED,
                ModState::Ready,
            ),
            (
                ItemFlags::SUBSCRIBED | ItemFlags::INSTALLED | ItemFlags::NEEDS_UPDATE,
                ModState::NeedsUpdate,
            ),
            (
                ItemFlags::SUBSCRIBED
                    | ItemFlags::INSTALLED
                    | ItemFlags::NEEDS_UPDATE
                    | ItemFlags::DOWNLOADING,
                ModState::Downloading,
            ),
            (
                ItemFlags::SUBSCRIBED | ItemFlags::DOWNLOAD_PENDING,
                ModState::Downloading,
            ),
            (ItemFlags::SUBSCRIBED, ModState::NotInstalled),
            (ItemFlags::NONE, ModState::NotSubscribed),
            // `LEGACY_ITEM` occupies bit 2, not content on disk.
            (
                ItemFlags::SUBSCRIBED | ItemFlags::LEGACY_ITEM,
                ModState::NotInstalled,
            ),
            // Straight after an unsubscribe: subscription gone, folder not
            // deleted yet, and Steam may not have cleared NEEDS_UPDATE either.
            (ItemFlags::INSTALLED, ModState::NotSubscribed),
            (
                ItemFlags::INSTALLED | ItemFlags::NEEDS_UPDATE,
                ModState::NotSubscribed,
            ),
        ];
        for (bits, expected) in cases {
            assert_eq!(ModState::from_bits(bits), expected, "bits {bits}");
            assert_eq!(
                ModState::from_bits(bits).is_ready(),
                expected == ModState::Ready,
                "bits {bits}"
            );
        }
    }

    #[test]
    fn workshop_id_zero_is_not_a_workshop_item() {
        assert!(!ModState::is_workshop_id(0));
        assert!(ModState::is_workshop_id(1559212036));
        // Ids above u32::MAX are valid Workshop ids and must not be excluded.
        assert!(ModState::is_workshop_id(u64::from(u32::MAX) + 1));
    }
}
