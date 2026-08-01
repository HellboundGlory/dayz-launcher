use crate::error::SteamError;
use crate::rows::GameServerRow;
use crate::source::{Filters, ServerListSource};
use std::collections::HashSet;

/// A way of splitting one over-full server-list request into narrower ones.
pub trait SubdivisionAxis: Send + Sync {
    fn name(&self) -> &'static str;
    fn split(&self, filters: &Filters, depth: usize) -> Option<Vec<Filters>>;
}

/// Split by the first character of the server name.
pub struct NamePrefixAxis {
    pub alphabet: Vec<char>,
}

impl Default for NamePrefixAxis {
    fn default() -> Self {
        let mut alphabet: Vec<char> = ('0'..='9').collect();
        alphabet.extend('a'..='z');
        Self { alphabet }
    }
}

impl SubdivisionAxis for NamePrefixAxis {
    fn name(&self) -> &'static str {
        "name_match"
    }

    fn split(&self, filters: &Filters, depth: usize) -> Option<Vec<Filters>> {
        if depth > 0 || filters.contains_key("name_match") {
            return None;
        }
        Some(
            self.alphabet
                .iter()
                .map(|c| {
                    let mut f = filters.clone();
                    f.insert("name_match".into(), format!("{c}*"));
                    f
                })
                .collect(),
        )
    }
}

/// Split by exact DayZ build number.
pub struct VersionAxis {
    pub versions: Vec<i32>,
}

impl SubdivisionAxis for VersionAxis {
    fn name(&self) -> &'static str {
        "version_match"
    }

    fn split(&self, filters: &Filters, depth: usize) -> Option<Vec<Filters>> {
        if depth > 0 || filters.contains_key("version_match") || self.versions.is_empty() {
            return None;
        }
        Some(
            self.versions
                .iter()
                .map(|v| {
                    let mut f = filters.clone();
                    f.insert("version_match".into(), v.to_string());
                    f
                })
                .collect(),
        )
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct DiscoveryStats {
    pub requests: usize,
    pub rows_seen: usize,
    pub unique: usize,
    /// Shards that returned exactly `cap` rows, so were probably truncated.
    pub capped_shards: usize,
}

pub struct Discovery<'a> {
    source: &'a dyn ServerListSource,
    cap: usize,
    max_depth: usize,
}

impl<'a> Discovery<'a> {
    pub fn new(source: &'a dyn ServerListSource, cap: usize) -> Self {
        Self {
            source,
            cap,
            max_depth: 2,
        }
    }

    pub fn with_max_depth(mut self, depth: usize) -> Self {
        self.max_depth = depth;
        self
    }

    /// Tier 1: every populated server, in one request.
    pub fn populated(&self) -> Result<(Vec<GameServerRow>, DiscoveryStats), SteamError> {
        let mut filters = Filters::new();
        filters.insert("empty".into(), "1".into());
        self.collect(vec![filters], None)
    }

    /// Tier 2: one request per map, for the map dropdown and map-filtered views.
    pub fn by_maps(
        &self,
        maps: &[&str],
    ) -> Result<(Vec<GameServerRow>, DiscoveryStats), SteamError> {
        let shards = maps
            .iter()
            .map(|m| {
                let mut f = Filters::new();
                f.insert("map".into(), (*m).to_string());
                f
            })
            .collect();
        self.collect(shards, None)
    }

    /// Tier 3: empty servers, subdividing any shard that comes back at the cap.
    pub fn empty_servers(
        &self,
        axis: &dyn SubdivisionAxis,
    ) -> Result<(Vec<GameServerRow>, DiscoveryStats), SteamError> {
        let mut filters = Filters::new();
        filters.insert("noplayers".into(), "1".into());
        self.collect(vec![filters], Some(axis))
    }

    fn collect(
        &self,
        shards: Vec<Filters>,
        axis: Option<&dyn SubdivisionAxis>,
    ) -> Result<(Vec<GameServerRow>, DiscoveryStats), SteamError> {
        let mut stats = DiscoveryStats::default();
        let mut seen: HashSet<(std::net::Ipv4Addr, u16)> = HashSet::new();
        let mut out: Vec<GameServerRow> = Vec::new();

        let mut queue: Vec<(Filters, usize)> = shards.into_iter().map(|f| (f, 0)).collect();

        while let Some((filters, depth)) = queue.pop() {
            let rows = self.source.internet_list(&filters)?;
            stats.requests += 1;
            stats.rows_seen += rows.len();

            let truncated = rows.len() >= self.cap;
            if truncated {
                stats.capped_shards += 1;
            }

            for row in rows {
                if seen.insert((row.ip, row.query_port)) {
                    out.push(row);
                }
            }

            if truncated && depth < self.max_depth {
                if let Some(axis) = axis {
                    if let Some(children) = axis.split(&filters, depth) {
                        queue.extend(children.into_iter().map(|f| (f, depth + 1)));
                    }
                }
            }
        }

        stats.unique = out.len();
        Ok((out, stats))
    }
}

/// Keep one row per `(ip, query_port)`, first occurrence wins.
pub fn dedup(rows: Vec<GameServerRow>) -> Vec<GameServerRow> {
    let mut seen = HashSet::new();
    rows.into_iter()
        .filter(|r| seen.insert((r.ip, r.query_port)))
        .collect()
}