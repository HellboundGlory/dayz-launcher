//! Which servers the list and its footer count: those that answered in the
//! last day under a real name, plus favourites and played servers.

mod common;

use common::key;
use tetra_core::unix_now;
use tetra_registry::{Registry, ServerFilter, ServerRow, SortDir, SortKey};

const DAY: i64 = 86_400;

/// A row that answered `age_secs` ago under `name`.
fn answered(last_octet: u8, name: &str, age_secs: i64) -> ServerRow {
    ServerRow {
        key: key(last_octet),
        name: name.into(),
        map: "chernarusplus".into(),
        players: 3,
        max_players: 60,
        responded: true,
        responded_at: Some(unix_now() - age_secs),
        ..Default::default()
    }
}

/// A row that never answered: an address and nothing else.
fn silent(last_octet: u8) -> ServerRow {
    ServerRow {
        key: key(last_octet),
        ..Default::default()
    }
}

#[tokio::test]
async fn only_recent_named_favourite_or_played_servers_are_listed() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    writer
        .upsert_servers(vec![
            answered(1, "Survivor Haven", 3600),
            answered(2, "Survivor Haven", 25 * 3600),
            answered(3, "EXAMPLE NAME", 3600),
            silent(4),
            silent(5),
            ServerRow {
                last_played: Some(unix_now() - 3 * DAY),
                ..silent(6)
            },
        ])
        .await
        .expect("write");
    writer.set_favourite(key(5), true).await.expect("favourite");

    let reader = registry.reader().expect("reader");
    let listed = |filter: &ServerFilter| {
        let rows = reader
            .page(filter, SortKey::Name, SortDir::Asc, 0, 100)
            .expect("page");
        let mut octets: Vec<u8> = rows.iter().map(|r| r.key.ip.octets()[3]).collect();
        octets.sort();
        octets
    };

    assert_eq!(listed(&ServerFilter::default()), vec![1, 2, 3, 4, 5, 6]);

    let hiding = ServerFilter {
        hide_stale: true,
        ..Default::default()
    };
    assert_eq!(listed(&hiding), vec![1, 5, 6]);
    assert_eq!(reader.count(&hiding).expect("count"), 3);
    assert_eq!(reader.counts().expect("counts"), (3, 1));

    let by_address = ServerFilter {
        hide_stale: true,
        search: Some("203.0.113.2".into()),
        ..Default::default()
    };
    assert_eq!(listed(&by_address), vec![2]);
}
