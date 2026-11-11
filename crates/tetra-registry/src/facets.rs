//! Counts for the filter menu: how many servers each map, version, country and
//! mod would give, how many the whole filter matches, and the rows the search
//! box offers while text is typed.
//!
//! Every label here comes from servers, so lists are capped and never fed back
//! into SQL; the only text in a statement is a fixed literal or the `WHERE`
//! clause `filter::where_clause` builds.

use crate::error::RegistryError;
use crate::filter::{self, clean_version, escape_like, version_prefixes, ModMatch, ServerFilter};
use rusqlite::types::Value;
use rusqlite::Connection;
use std::collections::{BTreeMap, HashMap, HashSet};
use tetra_core::classify::maps::display_name;

/// Longest list a facet returns; the menu's popup scrolls, and the distinct
/// values are written by servers, so the count is attacker-sized.
const MAX_MAP_ROWS: usize = 300;
const MAX_VERSION_ROWS: usize = 100;
const MAX_COUNTRY_ROWS: usize = 300;
const MAX_MOD_ROWS: usize = 50;

/// Workshop ids a mod row carries. A server declaring more than this is rare,
/// and the filter takes ids rather than names, so a cut is a narrower pick.
const MAX_MOD_IDS: usize = 20;

/// Longest map or mod label returned; both come from servers.
const MAX_LABEL_CHARS: usize = 80;

/// Candidate names the mod suggestion query reads before the word test.
const MOD_SUGGESTION_SCAN: usize = 500;

/// Groups a suggestion counts ids for, after the word test keeps them.
const MOD_SUGGESTION_GROUPS: usize = 20;

/// Ids of one name that are counted before the widest are kept. Real mods
/// have a handful; a server-made name with thousands would otherwise cost a
/// counting statement per 500.
const MAX_MOD_ID_CANDIDATES: usize = 200;

/// Workshop ids one statement may bind to count servers: with the filter's own
/// binds this stays well under SQLite's limit of 32766.
const ID_COUNT_CHUNK: usize = 500;

const SUGGESTED_MAPS: usize = 3;
const SUGGESTED_MODS: usize = 4;
const SUGGESTED_VERSIONS: usize = 2;

/// Longest typed text a suggestion is asked about.
const MAX_TEXT_CHARS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct FacetCount {
    pub name: String,
    pub count: usize,
    /// The filter values the row stands for: map keys, Workshop ids, or the
    /// label itself for versions and countries.
    pub values: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Facets {
    /// Servers the whole filter matches.
    pub total: usize,
    pub maps: Vec<FacetCount>,
    pub versions: Vec<FacetCount>,
    pub countries: Vec<FacetCount>,
    pub mods: Vec<FacetCount>,
    /// Servers on the installed version, when the caller knows it.
    pub same_as_mine: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SuggestionKind {
    Map,
    Mod,
    Version,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Suggestion {
    pub kind: SuggestionKind,
    pub label: String,
    pub count: usize,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Facet {
    Maps,
    Versions,
    Countries,
    Mods,
}

/// The filter with one facet's own fields cleared, so a list does not count
/// itself out: a picked map still shows the other maps with their counts.
pub(crate) fn without(filter: &ServerFilter, facet: Facet) -> ServerFilter {
    let mut out = filter.clone();
    match facet {
        Facet::Maps => out.maps.clear(),
        Facet::Versions => out.version = None,
        Facet::Countries => out.countries.clear(),
        Facet::Mods => {
            out.mod_ids.clear();
            out.mod_ids_exclude.clear();
            out.mod_match = ModMatch::Any;
        }
    }
    out
}

/// `where_sql` with one more condition, which is safe because every clause in
/// [`filter::where_clause`] is joined with `AND`.
fn and_where(where_sql: &str, cond: &str) -> String {
    if where_sql.is_empty() {
        format!("WHERE {cond}")
    } else {
        format!("{where_sql} AND {cond}")
    }
}

pub(crate) fn map_counts(
    conn: &Connection,
    filter: &ServerFilter,
) -> Result<Vec<FacetCount>, RegistryError> {
    let (where_sql, binds) = filter::where_clause(filter);
    let sql = format!(
        "SELECT map_normalised, MIN(map_raw), COUNT(*) FROM servers {} GROUP BY map_normalised",
        and_where(&where_sql, "map_normalised <> ''")
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let counted = stmt
        .query_map(rusqlite::params_from_iter(binds), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)? as usize,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // Engine keys that share a display name are one row to the player.
    let mut merged: BTreeMap<String, (usize, Vec<String>)> = BTreeMap::new();
    for (key, raw, count) in counted {
        let entry = merged.entry(display_name(&raw)).or_default();
        entry.0 += count;
        entry.1.push(key);
    }
    let mut rows: Vec<FacetCount> = merged
        .into_iter()
        .map(|(name, (count, mut values))| {
            values.sort();
            FacetCount {
                name: truncate_label(name),
                count,
                values,
            }
        })
        .collect();
    sort_by_count_then_name(&mut rows);
    rows.truncate(MAX_MAP_ROWS);
    Ok(rows)
}

/// Which versions a version list offers.
#[derive(Clone, Copy)]
pub(crate) enum VersionRows {
    /// The current game build and the one before, for the filter menu.
    GameBuilds,
    /// Every clean version, for matching typed text.
    All,
}

pub(crate) fn version_counts(
    conn: &Connection,
    filter: &ServerFilter,
    offered: VersionRows,
) -> Result<Vec<FacetCount>, RegistryError> {
    let (where_sql, binds) = filter::where_clause(filter);
    let sql = format!(
        "SELECT version, COUNT(*) FROM servers {} \
         GROUP BY version ORDER BY COUNT(*) DESC, version",
        and_where(&where_sql, "version IS NOT NULL")
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let stored = stmt
        .query_map(rusqlite::params_from_iter(binds), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as usize))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    // Only offer values the version filter accepts. The count is what picking
    // the row returns, so it follows the filter's own rule: "1.29" includes
    // "1.29.100", and a row's count can exceed the servers stored with exactly
    // that string.
    let names = match offered {
        VersionRows::GameBuilds => current_and_previous_build(&stored),
        VersionRows::All => distinct_clean_versions(&stored),
    };
    let mut rows: Vec<FacetCount> = names
        .into_iter()
        .map(|name| FacetCount {
            values: vec![name.clone()],
            name,
            count: 0,
        })
        .collect();

    let lowered: Vec<String> = stored.iter().map(|(v, _)| v.to_ascii_lowercase()).collect();
    for row in &mut rows {
        let prefixes = version_prefixes(&row.name);
        let dotted = format!("{}.", row.name.to_ascii_lowercase());
        row.count = stored
            .iter()
            .zip(&lowered)
            .filter(|((version, _), lower)| {
                prefixes.contains(version) || lower.starts_with(&dotted)
            })
            .map(|((_, count), _)| *count)
            .sum();
    }
    rows.sort_by(|a, b| newest_first(&a.name, &b.name));
    Ok(rows)
}

fn distinct_clean_versions(stored: &[(String, usize)]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    stored
        .iter()
        .filter_map(|(v, _)| clean_version(v))
        .filter(|name| seen.insert(name.clone()))
        .take(MAX_VERSION_ROWS)
        .collect()
}

/// A game build as `1.<minor>.<build>`; anything else a server reports is its own text.
fn game_build(version: &str) -> Option<(u32, u64)> {
    let mut parts = version.trim().split('.');
    let (major, minor, build) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || major != "1" {
        return None;
    }
    Some((minor.parse().ok()?, build.parse().ok()?))
}

/// The build most servers run (the newer one on a tie), and the most-run build older
/// than it from the same or the previous minor version.
fn current_and_previous_build(stored: &[(String, usize)]) -> Vec<String> {
    let mut builds: Vec<(&str, usize, u32, u64)> = stored
        .iter()
        .filter_map(|(v, count)| {
            clean_version(v)
                .and(game_build(v))
                .map(|(m, b)| (v.as_str(), *count, m, b))
        })
        .collect();
    builds.sort_by(|a, b| b.1.cmp(&a.1).then(b.3.cmp(&a.3)));
    let Some(&(current, _, minor, build)) = builds.first() else {
        return Vec::new();
    };
    let previous = builds
        .iter()
        .find(|&&(_, _, m, b)| b < build && m <= minor && m >= minor.saturating_sub(1));
    std::iter::once(current)
        .chain(previous.map(|&(v, ..)| v))
        .map(|v| v.trim().to_string())
        .collect()
}

pub(crate) fn country_counts(
    conn: &Connection,
    filter: &ServerFilter,
) -> Result<Vec<FacetCount>, RegistryError> {
    let (where_sql, binds) = filter::where_clause(filter);
    let sql = format!(
        "SELECT country_code, COUNT(*) FROM servers {} GROUP BY country_code",
        and_where(
            &where_sql,
            "country_code IS NOT NULL AND country_code <> ''"
        )
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let counted = stmt
        .query_map(rusqlite::params_from_iter(binds), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as usize))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut rows: Vec<FacetCount> = counted
        .into_iter()
        .map(|(name, count)| FacetCount {
            values: vec![name.clone()],
            name,
            count,
        })
        .collect();
    sort_by_count_then_name(&mut rows);
    rows.truncate(MAX_COUNTRY_ROWS);
    Ok(rows)
}

pub(crate) fn mod_counts(
    conn: &Connection,
    filter: &ServerFilter,
) -> Result<Vec<FacetCount>, RegistryError> {
    mods_named_like(conn, filter, None, MAX_MOD_ROWS)
}

/// Mods grouped by name across Workshop ids, with the ids behind each name.
/// `word_start` narrows the scan for a suggestion before the word test runs.
///
/// A row's `count` is what picking it returns: every server declaring any of
/// the ids in `values`. That is not the servers that spelled the name that
/// way — one Workshop id can be declared under two names, and one name under
/// two ids — so the name grouping only supplies the label and the ids.
fn mods_named_like(
    conn: &Connection,
    filter: &ServerFilter,
    word_start: Option<&str>,
    limit: usize,
) -> Result<Vec<FacetCount>, RegistryError> {
    let (where_sql, filter_binds) = filter::where_clause(filter);
    let mut binds: Vec<Value> = Vec::new();
    let mut sql = String::from(
        "SELECT MIN(sm.name), GROUP_CONCAT(DISTINCT sm.workshop_id) \
         FROM server_mods sm WHERE sm.name <> ''",
    );
    if let Some(text) = word_start {
        // Narrow to names a word of which starts with the text, so a common
        // letter cannot fill the scan with mid-word matches. A word start
        // always contains the text, so the substring test first keeps the
        // separator tests off rows that cannot match. This covers the common
        // separators only; the final rule is applied in Rust.
        let escaped = escape_like(text);
        binds.push(Value::Text(format!("%{escaped}%")));
        let mut parts = vec!["sm.name LIKE ? ESCAPE '\\'".to_string()];
        binds.push(Value::Text(format!("{escaped}%")));
        for separator in [' ', '-', '_', '[', '(', '.', '/'] {
            parts.push("sm.name LIKE ? ESCAPE '\\'".to_string());
            binds.push(Value::Text(format!(
                "%{}{escaped}%",
                escape_like(&separator.to_string())
            )));
        }
        sql.push_str(&format!(
            " AND sm.name LIKE ? ESCAPE '\\' AND ({})",
            parts.join(" OR ")
        ));
    }
    // Inside the subquery `name`, `ip` and `query_port` are the servers table's,
    // so the shared clause keeps its meaning.
    sql.push_str(&format!(
        " AND (sm.ip || ':' || sm.query_port) IN \
         (SELECT ip || ':' || query_port FROM servers {where_sql}) \
         GROUP BY sm.name COLLATE NOCASE \
         ORDER BY COUNT(DISTINCT sm.ip || ':' || sm.query_port) DESC, 1 LIMIT ?"
    ));
    binds.extend(filter_binds);
    binds.push(Value::Integer(i64::try_from(limit).unwrap_or(i64::MAX)));

    let mut stmt = conn.prepare_cached(&sql)?;
    let grouped = stmt
        .query_map(rusqlite::params_from_iter(binds), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    let mut groups: Vec<(String, Vec<u64>)> = grouped
        .into_iter()
        .map(|(name, ids)| (truncate_label(name), workshop_ids(&ids)))
        .filter(|(_, ids)| !ids.is_empty())
        .collect();
    for (_, ids) in &mut groups {
        ids.truncate(MAX_MOD_ID_CANDIDATES);
    }
    if let Some(text) = word_start {
        let lower = text.to_ascii_lowercase();
        groups.retain(|(name, _)| matches_word_start(name, &lower));
        groups.truncate(MOD_SUGGESTION_GROUPS);
    }

    let mut wanted: Vec<u64> = groups
        .iter()
        .flat_map(|(_, ids)| ids.iter().copied())
        .collect();
    wanted.sort_unstable();
    wanted.dedup();
    let id_servers = id_server_counts(conn, filter, &wanted)?;
    for (_, ids) in &mut groups {
        keep_widest_ids(ids, &id_servers);
    }

    let mut rows = Vec::with_capacity(groups.len());
    for (name, ids) in groups {
        let values: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
        let count = match ids.as_slice() {
            [id] => id_servers.get(id).copied().unwrap_or(0),
            _ => servers_declaring(conn, filter, &values)?,
        };
        rows.push(FacetCount {
            name,
            count,
            values,
        });
    }
    sort_by_count_then_name(&mut rows);
    Ok(rows)
}

/// How many servers under `filter` declare each of `ids`. A server naming an
/// id twice counts once. Chunked because each id is a bound parameter.
fn id_server_counts(
    conn: &Connection,
    filter: &ServerFilter,
    ids: &[u64],
) -> Result<HashMap<u64, usize>, RegistryError> {
    let mut counts = HashMap::with_capacity(ids.len());
    if ids.is_empty() {
        return Ok(counts);
    }
    let (where_sql, filter_binds) = filter::where_clause(filter);
    for chunk in ids.chunks(ID_COUNT_CHUNK) {
        let holes = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT sm.workshop_id, COUNT(DISTINCT sm.ip || ':' || sm.query_port) \
             FROM server_mods sm \
             WHERE sm.workshop_id IN ({holes}) \
             AND (sm.ip || ':' || sm.query_port) IN \
             (SELECT ip || ':' || query_port FROM servers {where_sql}) \
             GROUP BY sm.workshop_id"
        );
        let mut binds: Vec<Value> = chunk.iter().map(|&id| Value::Integer(id as i64)).collect();
        binds.extend(filter_binds.iter().cloned());
        let mut stmt = conn.prepare_cached(&sql)?;
        let found = stmt
            .query_map(rusqlite::params_from_iter(binds), |r| {
                Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as usize))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        counts.extend(found);
    }
    Ok(counts)
}

/// Cuts `ids` to [`MAX_MOD_IDS`], keeping the ids carried by the most servers
/// so a cut drops the least. `id_servers` decides the order.
fn keep_widest_ids(ids: &mut Vec<u64>, id_servers: &HashMap<u64, usize>) {
    ids.sort_unstable_by(|a, b| {
        let broad = |id: &u64| id_servers.get(id).copied().unwrap_or(0);
        broad(b).cmp(&broad(a)).then_with(|| a.cmp(b))
    });
    ids.truncate(MAX_MOD_IDS);
    ids.sort_unstable();
}

/// Servers under `filter` declaring any of `ids` — the count applying those
/// ids to the mod-free filter returns.
fn servers_declaring(
    conn: &Connection,
    filter: &ServerFilter,
    ids: &[String],
) -> Result<usize, RegistryError> {
    let mut picked = filter.clone();
    picked.mod_ids = ids.iter().filter_map(|id| id.parse().ok()).collect();
    crate::reader::count(conn, &picked)
}

/// The ids in a `GROUP_CONCAT` result. Workshop ids are stored as `i64`, so a
/// value at or past 2^63 comes back negative and reads back the same way.
fn workshop_ids(concatenated: &Option<String>) -> Vec<u64> {
    let mut ids: Vec<u64> = concatenated
        .as_deref()
        .unwrap_or_default()
        .split(',')
        .filter_map(|id| id.parse::<i64>().ok())
        .map(|id| id as u64)
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

/// A label taken from a server, cut to [`MAX_LABEL_CHARS`].
fn truncate_label(label: String) -> String {
    label.chars().take(MAX_LABEL_CHARS).collect()
}

fn sort_by_count_then_name(rows: &mut [FacetCount]) {
    rows.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
}

/// Newest version first: dotted parts compared as numbers, a part that is not
/// a number counting as 0, then by text.
fn newest_first(a: &str, b: &str) -> std::cmp::Ordering {
    let parts = |v: &str| -> Vec<u64> { v.split('.').map(|p| p.parse().unwrap_or(0)).collect() };
    let (a_parts, b_parts) = (parts(a), parts(b));
    let len = a_parts.len().max(b_parts.len());
    for i in 0..len {
        let (x, y) = (
            a_parts.get(i).copied().unwrap_or(0),
            b_parts.get(i).copied().unwrap_or(0),
        );
        if x != y {
            return y.cmp(&x);
        }
    }
    a.cmp(b)
}

/// Up to 3 maps, 4 mods and 2 versions for `text`, in that order. Each count is
/// taken with the typed text and the kind's own filter removed, so a row is
/// counted by the rest of the filter alone.
pub(crate) fn suggestions(
    conn: &Connection,
    filter: &ServerFilter,
    text: &str,
) -> Result<Vec<Suggestion>, RegistryError> {
    let text: String = text.trim().chars().take(MAX_TEXT_CHARS).collect();
    if text.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let lower = text.to_ascii_lowercase();
    let base = ServerFilter {
        search: None,
        ..filter.clone()
    };
    let mut out = Vec::new();

    for row in map_counts(conn, &without(&base, Facet::Maps))?
        .into_iter()
        .filter(|row| matches_word_start(&row.name, &lower))
        .take(SUGGESTED_MAPS)
    {
        out.push(Suggestion {
            kind: SuggestionKind::Map,
            label: row.name,
            count: row.count,
            values: row.values,
        });
    }

    if base.modded != Some(false) {
        // `mods_named_like` already applies the word test for a suggestion.
        for row in mods_named_like(
            conn,
            &without(&base, Facet::Mods),
            Some(&text),
            MOD_SUGGESTION_SCAN,
        )?
        .into_iter()
        .take(SUGGESTED_MODS)
        {
            out.push(Suggestion {
                kind: SuggestionKind::Mod,
                label: row.name,
                count: row.count,
                values: row.values,
            });
        }
    }

    if text.starts_with(|c: char| c.is_ascii_digit()) {
        let mut rows: Vec<FacetCount> =
            version_counts(conn, &without(&base, Facet::Versions), VersionRows::All)?
                .into_iter()
                .filter(|row| row.name.to_ascii_lowercase().starts_with(&lower))
                .collect();
        sort_by_count_then_name(&mut rows);
        for row in rows.into_iter().take(SUGGESTED_VERSIONS) {
            out.push(Suggestion {
                kind: SuggestionKind::Version,
                label: row.name,
                count: row.count,
                values: row.values,
            });
        }
    }

    Ok(out)
}

/// Whether `text_lower` starts a word of `label` — at its beginning or right
/// after a character that is not a letter or digit. ASCII-lowercased, as the
/// search SQL compares.
fn matches_word_start(label: &str, text_lower: &str) -> bool {
    let lower = label.to_ascii_lowercase();
    lower.starts_with(text_lower)
        || lower
            .char_indices()
            .any(|(i, c)| !c.is_alphanumeric() && lower[i + c.len_utf8()..].starts_with(text_lower))
}
