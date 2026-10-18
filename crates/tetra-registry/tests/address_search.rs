//! Typed addresses: the search box matches an IP or IP:port, and the reader finds
//! one server by address.

use std::net::Ipv4Addr;
use tetra_registry::{Registry, ServerFilter, ServerKey, ServerRow, SortDir, SortKey};

fn row(ip: Ipv4Addr, query_port: u16, game_port: u16, name: &str) -> ServerRow {
    ServerRow {
        key: ServerKey { ip, query_port },
        game_port,
        name: name.into(),
        map: "chernarusplus".into(),
        players: 10,
        max_players: 60,
        ping_ms: 30,
        responded: true,
        ..Default::default()
    }
}

fn names_matching(registry: &Registry, text: &str) -> Vec<String> {
    let filter = ServerFilter {
        search: Some(text.into()),
        ..Default::default()
    };
    registry
        .reader()
        .expect("reader")
        .page(&filter, SortKey::Name, SortDir::Asc, 0, 10)
        .expect("page")
        .into_iter()
        .map(|r| r.name)
        .collect()
}

#[tokio::test]
async fn address_search_and_lookup_match_ip_and_ports() {
    let host = Ipv4Addr::new(40, 160, 57, 146);
    let elsewhere = Ipv4Addr::new(203, 0, 113, 9);
    let registry = Registry::open_in_memory().expect("registry");
    registry
        .writer()
        .upsert_servers(vec![
            row(host, 2403, 2402, "Game Port Pair"),
            row(host, 2303, 2302, "Older Pair"),
            row(elsewhere, 2402, 2401, "Query Match"),
            row(elsewhere, 2401, 2402, "Game Match"),
        ])
        .await
        .expect("upsert servers");

    let cases: &[(&str, &[&str])] = &[
        ("40.160.57.146", &["Game Port Pair", "Older Pair"]),
        ("40.160.57.146:2402", &["Game Port Pair"]),
        ("40.160.57.146:2403", &["Game Port Pair"]),
        ("40.160.57.146:9999", &[]),
        ("Older", &["Older Pair"]),
    ];
    for (text, expected) in cases {
        assert_eq!(names_matching(&registry, text), *expected, "search: {text}");
    }

    let reader = registry.reader().expect("reader");
    let by_query = reader
        .find_by_address(elsewhere, 2402)
        .expect("lookup")
        .map(|r| r.name);
    assert_eq!(by_query.as_deref(), Some("Query Match"));
    let by_game = reader
        .find_by_address(host, 2402)
        .expect("lookup")
        .map(|r| r.name);
    assert_eq!(by_game.as_deref(), Some("Game Port Pair"));
    assert!(reader
        .find_by_address(host, 9999)
        .expect("lookup")
        .is_none());
}
