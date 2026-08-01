use crate::error::SteamError;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct WorkshopId(pub u64);

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

pub struct DownloadInfo {
    pub bytes_downloaded: u64,
    pub bytes_total: u64,
}

pub struct InstallInfo {
    pub folder: PathBuf,
    pub size_on_disk: u64,
}

pub struct UgcDetails {
    pub id: WorkshopId,
    pub title: String,
    pub banned: bool,
    pub file_size: u64,
}

pub enum Resolution {
    Found(UgcDetails),
    Removed(UgcDetails),
    Unresolved(WorkshopId),
}

pub trait WorkshopSource: Send + Sync {
    fn resolve(&self, ids: &[WorkshopId]) -> Result<Vec<Resolution>, SteamError>;
    fn item_flags(&self, id: WorkshopId) -> Result<ItemFlags, SteamError>;
    fn subscribe(&self, id: WorkshopId) -> Result<(), SteamError>;
    fn unsubscribe(&self, id: WorkshopId) -> Result<(), SteamError>;
    fn download(&self, id: WorkshopId, high_priority: bool) -> Result<(), SteamError>;
    fn download_info(&self, id: WorkshopId) -> Result<Option<DownloadInfo>, SteamError>;
    fn install_info(&self, id: WorkshopId) -> Result<Option<InstallInfo>, SteamError>;
}

/// An in-process stand-in for Workshop UGC operations. For offline testing
/// of the pre-launch mod gate without Steam running.
pub struct FakeWorkshop {
    mods: Mutex<Vec<FakeModEntry>>,
}

#[derive(Clone)]
pub struct FakeModEntry {
    pub id: u64,
    pub title: String,
    pub subscribed: bool,
    pub installed: bool,
    pub needs_update: bool,
    pub downloading: bool,
    pub download_pending: bool,
    pub bytes_downloaded: u64,
    pub bytes_total: u64,
    pub folder: Option<PathBuf>,
    pub file_size: u64,
}

impl FakeWorkshop {
    pub fn new(mods: Vec<FakeModEntry>) -> Self {
        Self {
            mods: Mutex::new(mods),
        }
    }
}

impl WorkshopSource for FakeWorkshop {
    fn resolve(&self, ids: &[WorkshopId]) -> Result<Vec<Resolution>, SteamError> {
        let mods = self.mods.lock().unwrap();
        let mut results = Vec::new();
        for WorkshopId(id) in ids {
            match mods.iter().find(|m| m.id == *id) {
                Some(entry) => {
                    let details = UgcDetails {
                        id: WorkshopId(entry.id),
                        title: entry.title.clone(),
                        banned: false,
                        file_size: entry.file_size,
                    };
                    if entry.installed && !entry.needs_update {
                        results.push(Resolution::Found(details));
                    } else {
                        results.push(Resolution::Removed(details));
                    }
                }
                None => results.push(Resolution::Unresolved(WorkshopId(*id))),
            }
        }
        Ok(results)
    }

    fn item_flags(&self, id: WorkshopId) -> Result<ItemFlags, SteamError> {
        let mods = self.mods.lock().unwrap();
        let entry = mods.iter().find(|m| m.id == id.0);
        let mut flags = ItemFlags(0);
        if let Some(e) = entry {
            if e.subscribed { flags.0 |= ItemFlags::SUBSCRIBED; }
            if e.installed { flags.0 |= ItemFlags::INSTALLED; }
            if e.needs_update { flags.0 |= ItemFlags::NEEDS_UPDATE; }
            if e.downloading { flags.0 |= ItemFlags::DOWNLOADING; }
            if e.download_pending { flags.0 |= ItemFlags::DOWNLOAD_PENDING; }
        }
        Ok(flags)
    }

    fn subscribe(&self, id: WorkshopId) -> Result<(), SteamError> {
        let mut mods = self.mods.lock().unwrap();
        if let Some(e) = mods.iter_mut().find(|m| m.id == id.0) {
            e.subscribed = true;
        }
        Ok(())
    }

    fn unsubscribe(&self, id: WorkshopId) -> Result<(), SteamError> {
        let mut mods = self.mods.lock().unwrap();
        if let Some(e) = mods.iter_mut().find(|m| m.id == id.0) {
            e.subscribed = false;
        }
        Ok(())
    }

    fn download(&self, id: WorkshopId, _high_priority: bool) -> Result<(), SteamError> {
        let mut mods = self.mods.lock().unwrap();
        if let Some(e) = mods.iter_mut().find(|m| m.id == id.0) {
            e.downloading = true;
            e.download_pending = false;
        }
        Ok(())
    }

    fn download_info(&self, id: WorkshopId) -> Result<Option<DownloadInfo>, SteamError> {
        let mods = self.mods.lock().unwrap();
        if let Some(e) = mods.iter().find(|m| m.id == id.0 && m.downloading) {
            Ok(Some(DownloadInfo {
                bytes_downloaded: e.bytes_downloaded,
                bytes_total: e.bytes_total,
            }))
        } else {
            Ok(None)
        }
    }

    fn install_info(&self, id: WorkshopId) -> Result<Option<InstallInfo>, SteamError> {
        let mods = self.mods.lock().unwrap();
        if let Some(e) = mods.iter().find(|m| m.id == id.0 && m.installed) {
            Ok(Some(InstallInfo {
                folder: e.folder.clone().unwrap_or_default(),
                size_on_disk: e.file_size,
            }))
        } else {
            Ok(None)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::{ItemFlags, ModState};

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
        assert_eq!(ModState::from_bits(ItemFlags::NONE), ModState::NotSubscribed);
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
