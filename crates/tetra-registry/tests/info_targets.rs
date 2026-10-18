//! The info sweep's probe order: least recently probed first, among servers
//! Steam listed within the window.

use rusqlite::{params, Connection};
use std::net::Ipv4Addr;
use std::path::Path;
use tetra_registry::{Registry, ServerKey, ServerRow};

const DAY: i64 = 86_400;

fn key(last_octet: u8) -> ServerKey {
    ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, last_octet),
        query_port: 27016,
    }
}

/// Sets how long ago a row was last listed and last probed, in seconds.
/// A `None` probe age leaves the row never probed.
fn age(path: &Path, key: ServerKey, last_seen_age: i64, probe_age: Option<i64>) {
    let conn = Connection::open(path).expect("open");
    conn.execute(
        "UPDATE servers SET last_seen = unixepoch() - ?3, last_probe_attempt = unixepoch() - ?4
         WHERE ip = ?1 AND query_port = ?2",
        params![key.ip.to_string(), key.query_port, last_seen_age, probe_age],
    )
    .expect("age row");
}

#[tokio::test]
async fn least_recently_probed_first_and_stale_rows_are_left_out() {
    let dir = std::env::temp_dir().join(format!("tetra-info-targets-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    let path = dir.join("registry.sqlite");

    let registry = Registry::open(&path).expect("registry");
    let rows = (10..=13)
        .map(|octet| ServerRow {
            key: key(octet),
            ..ServerRow::default()
        })
        .collect();
    registry.writer().upsert_servers(rows).await.expect("write");
    age(&path, key(11), 0, Some(600));
    age(&path, key(12), 0, Some(60));
    age(&path, key(13), 2 * DAY, None);

    let reader = registry.reader().expect("reader");
    let targets: Vec<ServerKey> = reader
        .info_targets(10, DAY)
        .expect("info targets")
        .into_iter()
        .map(|(key, _)| key)
        .collect();
    assert_eq!(targets, vec![key(10), key(11), key(12)]);

    std::fs::remove_dir_all(&dir).expect("cleanup");
}
