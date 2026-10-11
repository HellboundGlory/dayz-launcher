//! Filtering the server list by Workshop mod — the "Filter by mod" modal's
//! backing query — and the "Seen on servers" mod pool it's populated from.

use std::net::Ipv4Addr;
use tetra_core::a2s::dayz::ServerMod;
use tetra_registry::filter::ModMatch;
use tetra_registry::{Registry, ServerFilter, ServerKey, ServerRow, SortDir, SortKey};

fn key(last_octet: u8, query_port: u16) -> ServerKey {
    ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, last_octet),
        query_port,
    }
}

fn row(key: ServerKey, name: &str) -> ServerRow {
    ServerRow {
        key,
        game_port: 2302,
        name: name.into(),
        map: "chernarusplus".into(),
        players: 10,
        max_players: 60,
        ping_ms: 30,
        responded: true,
        ..Default::default()
    }
}

fn dayz_mod(workshop_id: u64, name: &str) -> ServerMod {
    ServerMod {
        workshop_id,
        name: name.into(),
    }
}

async fn build_three_servers(registry: &Registry) -> [ServerKey; 3] {
    let writer = registry.writer();
    let cf = key(10, 27016);
    let trader = key(11, 27016);
    let vanilla = key(12, 27016);

    writer
        .upsert_servers(vec![
            row(cf, "CF Only"),
            row(trader, "CF + Trader"),
            row(vanilla, "Vanilla"),
        ])
        .await
        .expect("upsert servers");

    writer
        .upsert_server_mods(cf, vec![dayz_mod(1, "Community Framework")])
        .await
        .expect("mods for cf");
    writer
        .upsert_server_mods(
            trader,
            vec![
                dayz_mod(1, "Community Framework"),
                dayz_mod(2, "Trader Plus"),
            ],
        )
        .await
        .expect("mods for trader");
    // `vanilla` gets no server_mods rows at all.

    [cf, trader, vanilla]
}

async fn list(registry: &Registry, filter: &ServerFilter) -> Vec<String> {
    let reader = registry.reader().expect("reader");
    reader
        .list(filter, SortKey::Name, SortDir::Asc, 10)
        .expect("list")
        .into_iter()
        .map(|r| r.name)
        .collect()
}

struct FilterCase {
    name: &'static str,
    filter: ServerFilter,
    expected: &'static [&'static str],
}

#[tokio::test]
async fn mod_filters_select_the_expected_servers() {
    let cases = [
        FilterCase {
            name: "no filter keeps every server",
            filter: ServerFilter::default(),
            expected: &["CF + Trader", "CF Only", "Vanilla"],
        },
        FilterCase {
            name: "any match keeps servers declaring one id",
            filter: ServerFilter {
                mod_ids: vec![2],
                mod_match: ModMatch::Any,
                ..Default::default()
            },
            expected: &["CF + Trader"],
        },
        FilterCase {
            name: "any match unions across ids",
            filter: ServerFilter {
                mod_ids: vec![1, 2],
                mod_match: ModMatch::Any,
                ..Default::default()
            },
            expected: &["CF + Trader", "CF Only"],
        },
        FilterCase {
            name: "all match requires every id on one server",
            filter: ServerFilter {
                mod_ids: vec![1, 2],
                mod_match: ModMatch::All,
                ..Default::default()
            },
            expected: &["CF + Trader"],
        },
        FilterCase {
            name: "all match drops a server missing a mod",
            filter: ServerFilter {
                mod_ids: vec![1],
                mod_match: ModMatch::All,
                ..Default::default()
            },
            expected: &["CF + Trader", "CF Only"],
        },
        FilterCase {
            name: "exclude drops every declaring server",
            filter: ServerFilter {
                mod_ids_exclude: vec![1],
                ..Default::default()
            },
            expected: &["Vanilla"],
        },
        FilterCase {
            name: "exclude keeps mod-free servers",
            filter: ServerFilter {
                mod_ids_exclude: vec![1, 2],
                ..Default::default()
            },
            expected: &["Vanilla"],
        },
        FilterCase {
            name: "exclude wins over a matching include",
            filter: ServerFilter {
                mod_ids: vec![2],
                mod_match: ModMatch::Any,
                mod_ids_exclude: vec![1],
                ..Default::default()
            },
            expected: &[],
        },
    ];

    let registry = Registry::open_in_memory().expect("registry");
    build_three_servers(&registry).await;
    for case in cases {
        assert_eq!(
            list(&registry, &case.filter).await,
            case.expected,
            "case: {}",
            case.name
        );
    }
}

#[tokio::test]
async fn known_mods_rank_by_server_count_and_honour_the_limit() {
    let registry = Registry::open_in_memory().expect("registry");
    build_three_servers(&registry).await;

    let reader = registry.reader().expect("reader");
    let known = reader.known_mods(10).expect("known_mods");
    assert_eq!(known.len(), 2, "vanilla contributes no rows");
    assert_eq!(known[0], (1, "Community Framework".to_string(), 2));
    assert_eq!(known[1], (2, "Trader Plus".to_string(), 1));

    let limited = reader.known_mods(1).expect("known_mods");
    assert_eq!(limited.len(), 1);
    assert_eq!(
        limited[0].0, 1,
        "the most-declared mod wins the single slot"
    );
}
