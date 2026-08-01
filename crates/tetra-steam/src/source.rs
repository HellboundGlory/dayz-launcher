use crate::error::SteamError;
use crate::rows::GameServerRow;
use std::collections::BTreeMap;

/// Steam server-list filter keys and values.
pub type Filters = BTreeMap<String, String>;

/// Blocking by design. The Steam client's callback pump is single-threaded and
/// not async; async callers wrap these in `tokio::task::spawn_blocking`.
///
/// `history_list` has no consumer yet — the RECENT tab currently filters on the
/// registry's own `last_played`, and sourcing it from Steam's history instead is
/// a tracked backlog item. It stays on the trait because that is the command the
/// actor already implements, not as speculative surface.
pub trait ServerListSource: Send + Sync {
    fn internet_list(&self, filters: &Filters) -> Result<Vec<GameServerRow>, SteamError>;
    fn history_list(&self) -> Result<Vec<GameServerRow>, SteamError>;
}
