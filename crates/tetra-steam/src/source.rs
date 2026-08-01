use crate::error::SteamError;
use crate::rows::GameServerRow;
use std::collections::BTreeMap;
use std::sync::Mutex;

/// Steam server-list filter keys and values.
pub type Filters = BTreeMap<String, String>;

/// Blocking by design. The Steam client's callback pump is single-threaded and
/// not async; async callers wrap these in `tokio::task::spawn_blocking`.
pub trait ServerListSource: Send + Sync {
    fn internet_list(&self, filters: &Filters) -> Result<Vec<GameServerRow>, SteamError>;
    fn history_list(&self) -> Result<Vec<GameServerRow>, SteamError>;
}

/// An in-process stand-in for Steam.
pub struct FakeSource {
    universe: Vec<GameServerRow>,
    cap: usize,
    calls: Mutex<Vec<Filters>>,
}

impl FakeSource {
    pub fn new(universe: Vec<GameServerRow>, cap: usize) -> Self {
        Self {
            universe,
            cap,
            calls: Mutex::new(Vec::new()),
        }
    }

    pub fn calls(&self) -> Vec<Filters> {
        self.calls.lock().unwrap().clone()
    }

    fn matches(row: &GameServerRow, filters: &Filters) -> bool {
        filters.iter().all(|(k, v)| match k.as_str() {
            "map" => row.map == *v,
            "empty" => v != "1" || row.players > 0,
            "noplayers" => v != "1" || row.players == 0,
            "secure" => v != "1" || row.vac,
            "full" => v != "1" || row.players < row.max_players,
            "version_match" => row.server_version.to_string() == *v,
            "name_match" => match v.strip_suffix('*') {
                Some(prefix) => row.name.starts_with(prefix),
                None => row.name == *v,
            },
            "gamedir" | "appid" => true,
            _ => true,
        })
    }
}

impl ServerListSource for FakeSource {
    fn internet_list(&self, filters: &Filters) -> Result<Vec<GameServerRow>, SteamError> {
        self.calls.lock().unwrap().push(filters.clone());
        let rows: Vec<GameServerRow> = self
            .universe
            .iter()
            .filter(|r| Self::matches(r, filters))
            .take(self.cap)
            .cloned()
            .collect();
        Ok(rows)
    }

    fn history_list(&self) -> Result<Vec<GameServerRow>, SteamError> {
        Ok(Vec::new())
    }
}