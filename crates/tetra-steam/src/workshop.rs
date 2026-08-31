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

/// Whether the Workshop holds a newer version than the copy on disk. Both zero
/// guards fail safe ("assume current"); see `.ai-notes/crates/tetra-steam/src/workshop.rs.md`.
pub fn is_stale(installed_at: u32, updated_at: u32) -> bool {
    installed_at != 0 && updated_at != 0 && updated_at > installed_at
}

#[cfg(test)]
mod tests {
    use super::{is_stale, ItemFlags, ModState};

    #[test]
    fn a_workshop_copy_newer_than_the_disk_copy_is_stale() {
        assert!(is_stale(1_700_000_000, 1_700_000_001));
    }

    #[test]
    fn an_up_to_date_or_newer_local_copy_is_not_stale() {
        assert!(!is_stale(1_700_000_000, 1_700_000_000));
        // Local ahead of the Workshop should never happen, but if clocks or
        // Steam disagree it is not a reason to re-download.
        assert!(!is_stale(1_700_000_001, 1_700_000_000));
    }

    #[test]
    fn an_unanswered_workshop_query_is_not_stale() {
        assert!(!is_stale(1_700_000_000, 0));
    }

    #[test]
    fn an_uninstalled_item_is_not_stale() {
        assert!(!is_stale(0, 1_700_000_000));
        assert!(!is_stale(0, 0));
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

    #[test]
    fn a_subscribed_and_installed_mod_is_ready() {
        let bits = ItemFlags::SUBSCRIBED | ItemFlags::INSTALLED;
        assert_eq!(ModState::from_bits(bits), ModState::Ready);
        assert!(ModState::from_bits(bits).is_ready());
    }

    /// A naive `INSTALLED`-first check would call this ready, and DayZ would
    /// join with stale content.
    #[test]
    fn an_installed_mod_needing_update_is_not_ready() {
        let bits = ItemFlags::SUBSCRIBED | ItemFlags::INSTALLED | ItemFlags::NEEDS_UPDATE;
        assert_eq!(ModState::from_bits(bits), ModState::NeedsUpdate);
        assert!(!ModState::from_bits(bits).is_ready());
    }

    /// Downloading co-occurs with INSTALLED and NEEDS_UPDATE during an update,
    /// and must win — the content on disk is in flux.
    #[test]
    fn downloading_outranks_every_other_bit() {
        let updating = ItemFlags::SUBSCRIBED
            | ItemFlags::INSTALLED
            | ItemFlags::NEEDS_UPDATE
            | ItemFlags::DOWNLOADING;
        assert_eq!(ModState::from_bits(updating), ModState::Downloading);

        let queued = ItemFlags::SUBSCRIBED | ItemFlags::DOWNLOAD_PENDING;
        assert_eq!(ModState::from_bits(queued), ModState::Downloading);
    }

    #[test]
    fn subscribed_without_content_is_not_installed() {
        assert_eq!(
            ModState::from_bits(ItemFlags::SUBSCRIBED),
            ModState::NotInstalled
        );
    }

    #[test]
    fn workshop_id_zero_is_not_a_workshop_item() {
        assert!(!ModState::is_workshop_id(0));
        assert!(ModState::is_workshop_id(1559212036));
        // Ids above u32::MAX are valid Workshop ids and must not be excluded.
        assert!(ModState::is_workshop_id(u64::from(u32::MAX) + 1));
    }

    #[test]
    fn no_bits_is_not_subscribed() {
        assert_eq!(
            ModState::from_bits(ItemFlags::NONE),
            ModState::NotSubscribed
        );
    }

    /// `LEGACY_ITEM` occupies bit 2. Under the old (wrong) constants that bit
    /// was called `INSTALLED`, so a legacy-only item reported as ready.
    #[test]
    fn a_legacy_only_item_is_not_treated_as_installed() {
        let bits = ItemFlags::SUBSCRIBED | ItemFlags::LEGACY_ITEM;
        assert_eq!(ModState::from_bits(bits), ModState::NotInstalled);
        assert!(!ModState::from_bits(bits).is_ready());
    }

    /// Straight after an unsubscribe: subscription gone, folder not deleted yet.
    /// Must read as `NotSubscribed`, not `Ready`.
    #[test]
    fn installed_but_unsubscribed_reads_as_not_subscribed() {
        assert_eq!(
            ModState::from_bits(ItemFlags::INSTALLED),
            ModState::NotSubscribed
        );
        assert!(!ModState::from_bits(ItemFlags::INSTALLED).is_ready());

        // Same during the gap where Steam has not yet cleared NEEDS_UPDATE.
        assert_eq!(
            ModState::from_bits(ItemFlags::INSTALLED | ItemFlags::NEEDS_UPDATE),
            ModState::NotSubscribed
        );
    }
}
