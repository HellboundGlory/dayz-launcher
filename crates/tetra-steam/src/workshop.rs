/// Steam's `EItemState` bit values, and the classification the launcher derives
/// from them.
///
/// A `WorkshopSource` trait plus a `FakeWorkshop` in-process double used to live
/// here, alongside `WorkshopId`/`Resolution`/`UgcDetails`/`InstallInfo`. Their
/// only consumer was `tetra_launch::gate::Gate`, an earlier design of the
/// pre-launch check that the launcher never called — `commands::launch` verifies
/// mods against `SteamHandle` directly. Both are gone; what remains is the part
/// that is actually load-bearing.
pub struct ItemFlags(pub u32);

/// Steam's `EItemState` bitmask.
///
/// These mirror `steamworks::ugc::ItemState` (verified against steamworks
/// 0.13.1, `src/ugc.rs:416`) and must not be renumbered. `LEGACY_ITEM` is
/// listed even though nothing reads it: omitting it is precisely how this went
/// wrong before. The original values skipped it and so shifted every flag above
/// `SUBSCRIBED` down one bit, which made an `INSTALLED` item (4) read as
/// `NEEDS_UPDATE`, and a merely-legacy item (2) read as `INSTALLED`.
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
    /// Installed but Steam has a newer version. Spec §5.2 calls this out as
    /// "the case that breaks other launchers" — it must not count as ready.
    NeedsUpdate,
    Downloading,
    /// Subscribed but the content is not on disk yet.
    NotInstalled,
    /// No bits set.
    ///
    /// Steam returns `NONE` both for "a real item you never subscribed to" and
    /// for "this integer is not a workshop item at all", and the two cannot be
    /// told apart from `item_state`. The name stays neutral for that reason —
    /// it must never be presented as "invalid" or "removed from the Workshop".
    NotSubscribed,
    /// The server declared this mod with workshop id `0`.
    ///
    /// DayZ servers list server-side and locally-installed mods alongside
    /// Workshop ones, and those carry no Workshop id. There is nothing to
    /// subscribe to, download, or verify, so these are excluded from every
    /// Steam call and never block a launch.
    ///
    /// Passing id `0` to Steam is not harmless: `download_item(0)` queues a
    /// phantom transfer that shows up in the Steam client and survives until
    /// Steam is restarted.
    NotOnWorkshop,
}

impl ModState {
    /// Classify a raw `EItemState` bitmask.
    ///
    /// Order matters, because the bits co-occur:
    ///
    /// - **Downloading wins outright.** An item mid-update carries
    ///   `INSTALLED | NEEDS_UPDATE | DOWNLOADING` at once, and the content on
    ///   disk is in flux.
    /// - **Not-subscribed outranks installed.** Steam clears `SUBSCRIBED` as
    ///   soon as an unsubscribe is acknowledged but leaves `INSTALLED` set until
    ///   it gets round to deleting the folder, so the two disagree for a while.
    ///   Reporting that window as `Ready` told users their mods were still
    ///   installed right after they had removed them. It is also the honest
    ///   reading: content Steam is about to delete is not something to launch
    ///   against.
    /// - Only then does `NEEDS_UPDATE` outrank `INSTALLED`, so a stale mod is
    ///   never called ready (spec §5.2's "case that breaks other launchers").
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

    /// Whether this id is a Workshop item Steam can act on at all.
    ///
    /// The single gate every subscribe/unsubscribe/download path must pass ids
    /// through — Steam accepts id `0` and then misbehaves rather than erroring.
    pub fn is_workshop_id(workshop_id: u64) -> bool {
        workshop_id != 0
    }

    /// Whether DayZ can be launched against this mod as-is.
    pub fn is_ready(self) -> bool {
        matches!(self, Self::Ready)
    }
}

/// Whether the Workshop holds a newer version of an item than the copy on disk.
///
/// This exists because [`ModState::NEEDS_UPDATE`](ItemFlags::NEEDS_UPDATE) is
/// not a fact about the Workshop — it is a fact about what the *Steam client
/// last noticed*. The client learns an item changed when something queries its
/// details; until then `item_state` reports a stale mod as installed and
/// current, the launch gate passes it, and the server refuses the connection
/// for an out-of-date mod list. Asking the Workshop directly and comparing
/// timestamps is the check that does not depend on Steam having got round to it.
///
/// Both zero guards are load-bearing, and they fail in the safe direction —
/// "assume current" rather than "force a re-download":
///
/// - `installed_at == 0` means Steam reported no install time, which happens
///   for an item that is not on disk at all. There is nothing to compare, and
///   the mod is already blocked by its own state.
/// - `updated_at == 0` means the Workshop query returned nothing for this id —
///   the item is private, removed, or the query failed. Treating an absent
///   answer as "newer" would re-download every mod on every join the moment
///   Steam's backend had a bad minute.
///
/// **The comparison is only meaningful if the two numbers name the same event,
/// and that is not something a unit test can establish** — both sides come from
/// Steam. Measured against a live client over 50 subscribed, up-to-date items:
/// `GetItemInstallInfo`'s timestamp and `SteamUGCDetails_t::m_rtimeUpdated`
/// agreed *exactly*, to the second, on all 50. Both are Unix epoch seconds for
/// "when this item was last updated". Had they been different quantities, every
/// mod would read as stale and a join would re-download a whole server's mod
/// set — which is why this was checked against Steam rather than assumed.
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

    /// The failure mode this guard exists to prevent: a Workshop query that
    /// answers for nothing must not read as "everything is out of date", or a
    /// momentary Steam backend problem re-downloads a 90-mod server.
    #[test]
    fn an_unanswered_workshop_query_is_not_stale() {
        assert!(!is_stale(1_700_000_000, 0));
    }

    /// Nothing on disk to compare against. The mod is blocked by its own state
    /// already; calling it stale as well would queue a redundant download.
    #[test]
    fn an_uninstalled_item_is_not_stale() {
        assert!(!is_stale(0, 1_700_000_000));
        assert!(!is_stale(0, 0));
    }

    /// Pinned against `steamworks::ugc::ItemState` (0.13.1, src/ugc.rs:416).
    /// These are Steam's wire values; a "tidy-up" that renumbers them silently
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

    /// The case spec §5.2 says breaks other launchers: the item is installed,
    /// so a naive `INSTALLED`-first check calls it ready and DayZ then joins
    /// with stale content.
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

    /// DayZ servers list server-side and locally-installed mods with a Workshop
    /// id of 0. These must never reach Steam: `download_item(0)` is accepted
    /// and queues a phantom transfer that persists in the Steam client until it
    /// is restarted, and `item_state(0)` reports an empty state that renders as
    /// "not subscribed" — inviting the user to subscribe to something that does
    /// not exist. 175 servers in a 5,000-server sample declare at least one.
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

    /// The state Steam reports in the window straight after an unsubscribe: the
    /// subscription is gone but the folder has not been deleted yet.
    ///
    /// This must read as `NotSubscribed`. Treating it as `Ready` (on the
    /// grounds that the files are still on disk) meant the details panel showed
    /// every mod as installed immediately after the user unsubscribed from
    /// them, and offered no way to re-subscribe because nothing looked missing.
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
