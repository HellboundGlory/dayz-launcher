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

#[tokio::test]
async fn no_mod_filter_returns_every_server() {
    let registry = Registry::open_in_memory().expect("registry");
    build_three_servers(&registry).await;

    let names = list(&registry, &ServerFilter::default()).await;
    assert_eq!(names, vec!["CF + Trader", "CF Only", "Vanilla"]);
}

#[tokio::test]
async fn any_match_returns_servers_declaring_at_least_one_selected_mod() {
    let registry = Registry::open_in_memory().expect("registry");
    build_three_servers(&registry).await;

    let filter = ServerFilter {
        mod_ids: vec![2],
        mod_match: ModMatch::Any,
        ..Default::default()
    };
    assert_eq!(list(&registry, &filter).await, vec!["CF + Trader"]);
}

#[tokio::test]
async fn any_match_unions_across_multiple_selected_mods() {
    let registry = Registry::open_in_memory().expect("registry");
    build_three_servers(&registry).await;

    let filter = ServerFilter {
        mod_ids: vec![1, 2],
        mod_match: ModMatch::Any,
        ..Default::default()
    };
    assert_eq!(list(&registry, &filter).await, vec!["CF + Trader", "CF Only"]);
}

#[tokio::test]
async fn all_match_requires_every_selected_mod_on_the_same_server() {
    let registry = Registry::open_in_memory().expect("registry");
    build_three_servers(&registry).await;

    let filter = ServerFilter {
        mod_ids: vec![1, 2],
        mod_match: ModMatch::All,
        ..Default::default()
    };
    assert_eq!(list(&registry, &filter).await, vec!["CF + Trader"]);
}

#[tokio::test]
async fn a_server_with_no_mods_never_matches() {
    let registry = Registry::open_in_memory().expect("registry");
    build_three_servers(&registry).await;

    let filter = ServerFilter {
        mod_ids: vec![1],
        mod_match: ModMatch::All,
        ..Default::default()
    };
    let names = list(&registry, &filter).await;
    assert!(!names.contains(&"Vanilla".to_string()));
}

#[tokio::test]
async fn known_mods_ranks_by_server_count_descending() {
    let registry = Registry::open_in_memory().expect("registry");
    build_three_servers(&registry).await;

    let reader = registry.reader().expect("reader");
    let known = reader.known_mods(10).expect("known_mods");

    assert_eq!(known.len(), 2, "vanilla contributes no rows");
    assert_eq!(known[0], (1, "Community Framework".to_string(), 2));
    assert_eq!(known[1], (2, "Trader Plus".to_string(), 1));
}

#[tokio::test]
async fn known_mods_respects_the_limit() {
    let registry = Registry::open_in_memory().expect("registry");
    build_three_servers(&registry).await;

    let reader = registry.reader().expect("reader");
    let known = reader.known_mods(1).expect("known_mods");
    assert_eq!(known.len(), 1);
    assert_eq!(known[0].0, 1, "the most-declared mod wins the single slot");
}
