//! Which servers a filter lets through by address: an explicit list of keys,
//! and the rule that keeps servers on a local network out of All servers.

mod common;

use std::net::Ipv4Addr;
use tetra_registry::{Registry, ServerFilter, ServerKey, ServerRow, SortDir, SortKey};

fn row(ip: [u8; 4], name: &str) -> ServerRow {
    ServerRow {
        key: ServerKey {
            ip: Ipv4Addr::from(ip),
            query_port: 27016,
        },
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

fn names(registry: &Registry, filter: &ServerFilter) -> Vec<String> {
    let mut names: Vec<String> = registry
        .reader()
        .expect("reader")
        .page(filter, SortKey::Name, SortDir::Asc, 0, 50)
        .expect("page")
        .into_iter()
        .map(|r| r.name)
        .collect();
    names.sort();
    names
}

fn count(registry: &Registry, filter: &ServerFilter) -> usize {
    registry
        .reader()
        .expect("reader")
        .count(filter)
        .expect("count")
}

#[tokio::test]
async fn an_explicit_key_list_lists_exactly_those_servers() {
    let registry = Registry::open_in_memory().expect("registry");
    let a = common::key(1);
    let c = common::key(3);
    registry
        .writer()
        .upsert_servers(vec![
            row([203, 0, 113, 1], "A"),
            row([203, 0, 113, 2], "B"),
            row([203, 0, 113, 3], "C"),
        ])
        .await
        .expect("servers");

    let none = ServerFilter::default();
    assert_eq!(names(&registry, &none), vec!["A", "B", "C"]);

    let empty = ServerFilter {
        only: Some(Vec::new()),
        ..Default::default()
    };
    assert!(names(&registry, &empty).is_empty());
    assert_eq!(count(&registry, &empty), 0);

    let two = ServerFilter {
        only: Some(vec![a, c]),
        ..Default::default()
    };
    assert_eq!(names(&registry, &two), vec!["A", "C"]);
    assert_eq!(count(&registry, &two), 2);
}

#[tokio::test]
async fn a_key_list_combines_with_the_other_filters() {
    let registry = Registry::open_in_memory().expect("registry");
    let a = common::key(1);
    let b = common::key(2);
    registry
        .writer()
        .upsert_servers(vec![
            ServerRow {
                players: 60,
                ..row([203, 0, 113, 1], "Full")
            },
            ServerRow {
                players: 0,
                ..row([203, 0, 113, 2], "Quiet")
            },
        ])
        .await
        .expect("servers");

    let filter = ServerFilter {
        only: Some(vec![a, b]),
        hide_empty: true,
        ..Default::default()
    };
    assert_eq!(names(&registry, &filter), vec!["Full"]);
}

#[tokio::test]
async fn a_server_on_a_local_network_is_kept_out_of_the_whole_list() {
    let registry = Registry::open_in_memory().expect("registry");
    let lan = ServerKey {
        ip: Ipv4Addr::new(192, 168, 1, 5),
        query_port: 27016,
    };
    let vpn = ServerKey {
        ip: Ipv4Addr::new(172, 20, 0, 1),
        query_port: 27016,
    };
    registry
        .writer()
        .upsert_servers(vec![
            row([40, 160, 57, 146], "Public"),
            row([192, 168, 1, 5], "Lan"),
            row([172, 20, 0, 1], "Vpn"),
            row([172, 32, 0, 1], "Nearby but public"),
        ])
        .await
        .expect("servers");

    assert_eq!(
        names(&registry, &ServerFilter::default()),
        vec!["Nearby but public", "Public"]
    );
    assert_eq!(count(&registry, &ServerFilter::default()), 2);

    let favourites = ServerFilter {
        favourites_only: true,
        ..Default::default()
    };
    registry
        .writer()
        .set_favourite(lan, true)
        .await
        .expect("favourite");
    assert_eq!(names(&registry, &favourites), vec!["Lan"]);

    let only_lan = ServerFilter {
        only: Some(vec![lan]),
        ..Default::default()
    };
    assert_eq!(names(&registry, &only_lan), vec!["Lan"]);

    let recent = ServerFilter {
        recent_only: true,
        ..Default::default()
    };
    registry.writer().mark_played(vpn).await.expect("played");
    assert_eq!(names(&registry, &recent), vec!["Vpn"]);
}

#[tokio::test]
async fn a_lan_list_shows_a_server_still_on_its_default_name() {
    let registry = Registry::open_in_memory().expect("registry");
    let home = ServerKey {
        ip: Ipv4Addr::new(192, 168, 1, 9),
        query_port: 27016,
    };
    registry
        .writer()
        .upsert_servers(vec![row([192, 168, 1, 9], "EXAMPLE NAME")])
        .await
        .expect("servers");

    let lan = ServerFilter {
        only: Some(vec![home]),
        hide_stale: true,
        ..Default::default()
    };
    assert_eq!(names(&registry, &lan), vec!["EXAMPLE NAME"]);
}

#[tokio::test]
async fn typing_a_private_address_into_search_still_finds_it() {
    let registry = Registry::open_in_memory().expect("registry");
    registry
        .writer()
        .upsert_servers(vec![row([192, 168, 1, 5], "Lan")])
        .await
        .expect("servers");

    for search in ["192.168.1.5", "192.168.1.5:27016"] {
        let filter = ServerFilter {
            search: Some(search.into()),
            ..Default::default()
        };
        assert_eq!(names(&registry, &filter), vec!["Lan"], "{search}");
    }
}

#[tokio::test]
async fn the_footer_total_leaves_out_servers_on_a_local_network() {
    let registry = Registry::open_in_memory().expect("registry");
    registry
        .writer()
        .upsert_servers(vec![
            row([40, 160, 57, 146], "Public"),
            row([10, 0, 0, 7], "Lan"),
        ])
        .await
        .expect("servers");

    assert_eq!(
        registry.reader().expect("reader").counts().expect("counts"),
        (1, 1)
    );
}
