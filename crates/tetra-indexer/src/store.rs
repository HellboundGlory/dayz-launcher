//! Turning crawled Steam rows into registry rows, including the same-IP
//! fanout cap.

use crate::steam::SteamServer;
use std::collections::{HashMap, HashSet};
use std::net::Ipv4Addr;
use tetra_registry::{ServerKey, ServerRow, Writer};
use tokio::sync::mpsc;

/// Rows per `upsert_servers` call. One transaction each, so batches want to
/// be large; large enough that the writer channel is never the bottleneck.
const WRITE_BATCH: usize = 3_000;

#[derive(Debug, Default)]
pub struct IngestStats {
    pub seen: usize,
    pub written: usize,
    /// Rows dropped by the same-IP cap.
    pub capped: usize,
    /// Distinct IPs the cap judged to be advert farms.
    pub farm_ips: usize,
    /// Rows whose address wasn't usable.
    pub unusable: usize,
}

#[derive(Debug, Default)]
pub struct CapStats {
    pub dropped: usize,
    pub farm_ips: usize,
}

/// Advert farms publish thousands of ports on one IP — 88 IPs accounted for
/// 186,179 of 273,091 measured addresses, all empty, none joinable. An IP
/// over `cap` keeps only the listings with a player on them: population is
/// the one claim a farm never makes. `cap == 0` disables the rule.
///
/// This is a property of the listing *set*, not of a row, which is why it
/// lives here rather than in `tetra_core::classify`.
pub fn apply_per_ip_cap(rows: Vec<SteamServer>, cap: usize) -> (Vec<SteamServer>, CapStats) {
    if cap == 0 {
        return (rows, CapStats::default());
    }
    let mut per_ip: HashMap<Ipv4Addr, usize> = HashMap::new();
    for row in &rows {
        if let Some(sock) = row.socket() {
            *per_ip.entry(*sock.ip()).or_insert(0) += 1;
        }
    }
    let farms: HashSet<Ipv4Addr> = per_ip
        .into_iter()
        .filter(|&(_, n)| n > cap)
        .map(|(ip, _)| ip)
        .collect();
    if farms.is_empty() {
        return (rows, CapStats::default());
    }
    let before = rows.len();
    let kept: Vec<SteamServer> = rows
        .into_iter()
        .filter(|row| row.players > 0 || row.socket().is_none_or(|sock| !farms.contains(sock.ip())))
        .collect();
    let stats = CapStats {
        dropped: before - kept.len(),
        farm_ips: farms.len(),
    };
    (kept, stats)
}

/// A Steam row as the registry stores it. `responded` is false and `ping_ms`
/// zero on purpose: this is somebody else's advertisement, not our probe, so
/// the writer's guards must keep it away from measured live fields.
fn to_row(row: SteamServer) -> Option<ServerRow> {
    let sock = row.socket()?;
    Some(ServerRow {
        key: ServerKey {
            ip: *sock.ip(),
            query_port: sock.port(),
        },
        game_port: row.gameport,
        name: row.name,
        map: row.map,
        players: row.players,
        max_players: row.max_players,
        bots: row.bots,
        ping_ms: 0,
        locked: false,
        vac: row.secure,
        version: row.version,
        keywords: row.gametype,
        description: None,
        // Owned exclusively by `upsert_server_mods`.
        mod_count: None,
        last_played: None,
        responded: false,
        country_code: None,
    })
}

/// Drain a crawl into the registry.
///
/// With the same-IP cap on, the whole crawl has to be held before anything
/// can be written — whether an IP is a farm is only knowable once its last
/// port has arrived. With the cap off, rows are written as they stream in.
pub async fn ingest(
    writer: Writer,
    cap: usize,
    mut rx: mpsc::Receiver<Vec<SteamServer>>,
) -> IngestStats {
    let mut stats = IngestStats::default();

    if cap == 0 {
        let mut batch: Vec<ServerRow> = Vec::with_capacity(WRITE_BATCH);
        while let Some(rows) = rx.recv().await {
            stats.seen += rows.len();
            for row in rows {
                match to_row(row) {
                    Some(r) => batch.push(r),
                    None => stats.unusable += 1,
                }
                if batch.len() >= WRITE_BATCH {
                    flush(&writer, std::mem::take(&mut batch), &mut stats).await;
                    batch.reserve(WRITE_BATCH);
                }
            }
        }
        flush(&writer, batch, &mut stats).await;
        return stats;
    }

    let mut held: Vec<SteamServer> = Vec::new();
    while let Some(rows) = rx.recv().await {
        stats.seen += rows.len();
        held.extend(rows);
    }
    let (kept, cap_stats) = apply_per_ip_cap(held, cap);
    stats.capped = cap_stats.dropped;
    stats.farm_ips = cap_stats.farm_ips;

    let mut batch: Vec<ServerRow> = Vec::with_capacity(WRITE_BATCH);
    for row in kept {
        match to_row(row) {
            Some(r) => batch.push(r),
            None => stats.unusable += 1,
        }
        if batch.len() >= WRITE_BATCH {
            flush(&writer, std::mem::take(&mut batch), &mut stats).await;
            batch.reserve(WRITE_BATCH);
        }
    }
    flush(&writer, batch, &mut stats).await;
    stats
}

async fn flush(writer: &Writer, batch: Vec<ServerRow>, stats: &mut IngestStats) {
    if batch.is_empty() {
        return;
    }
    let n = batch.len();
    match writer.upsert_servers(batch).await {
        Ok(written) => stats.written += written,
        Err(e) => tracing::warn!(rows = n, error = %e, "write batch failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(addr: &str, players: i32) -> SteamServer {
        SteamServer {
            addr: addr.to_string(),
            gameport: 2302,
            name: "advert".to_string(),
            map: "chernarusplus".to_string(),
            players,
            max_players: 127,
            bots: 0,
            version: None,
            gametype: None,
            secure: true,
        }
    }

    #[test]
    fn a_farm_ip_keeps_only_its_populated_listing() {
        let cap = 50;
        let mut rows: Vec<SteamServer> = (0..cap + 5)
            .map(|i| row(&format!("1.2.3.4:{}", 27000 + i), 0))
            .collect();
        rows.push(row("1.2.3.4:29000", 7));
        // A neighbouring IP that stays under the cap is untouched.
        rows.push(row("5.6.7.8:27016", 0));

        let (kept, stats) = apply_per_ip_cap(rows.clone(), cap);
        assert_eq!(stats.farm_ips, 1);
        assert_eq!(stats.dropped, cap + 5);
        let addrs: Vec<&str> = kept.iter().map(|r| r.addr.as_str()).collect();
        assert_eq!(addrs, vec!["1.2.3.4:29000", "5.6.7.8:27016"]);

        let (all, stats) = apply_per_ip_cap(rows, 0);
        assert_eq!(all.len(), cap + 7);
        assert_eq!(stats.dropped, 0);
        assert_eq!(stats.farm_ips, 0);
    }

    #[test]
    fn a_steam_row_never_claims_to_be_a_measurement() {
        let stored = to_row(row("92.234.193.223:27016", 3)).unwrap();
        assert_eq!(stored.key.query_port, 27016);
        assert_eq!(stored.game_port, 2302);
        assert!(!stored.responded);
        assert_eq!(stored.ping_ms, 0);
        assert!(stored.mod_count.is_none());
        assert!(to_row(row("not-an-address", 0)).is_none());
    }
}
