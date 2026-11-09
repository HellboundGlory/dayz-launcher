//! Searching the list with several words: every word must match somewhere on a
//! server — its name, description, map, address or a mod it declares.

mod common;

use common::key;
use std::net::Ipv4Addr;
use tetra_core::a2s::dayz::ServerMod;
use tetra_registry::{Registry, ServerFilter, ServerKey, ServerRow, SortDir, SortKey};

fn row(key: ServerKey, name: &str, map: &str) -> ServerRow {
    ServerRow {
        key,
        game_port: 2302,
        name: name.into(),
        map: map.into(),
        players: 10,
        max_players: 60,
        ping_ms: 30,
        responded: true,
        ..Default::default()
    }
}

fn mods(list: &[(&str, u64)]) -> Vec<ServerMod> {
    list.iter()
        .map(|&(name, workshop_id)| ServerMod {
            workshop_id,
            name: name.into(),
            hash: None,
        })
        .collect()
}

async fn seed(registry: &Registry) {
    let writer = registry.writer();
    writer
        .upsert_servers(vec![
            row(key(1), "Alpha", "namalsk"),
            row(key(2), "Bravo Expansion", "chernarusplus"),
            row(key(3), "Charlie", "enoch"),
            row(key(4), "100%_Real", "chernarusplus"),
            row(
                ServerKey {
                    ip: Ipv4Addr::new(10, 0, 0, 5),
                    query_port: 2302,
                },
                "Echo",
                "chernarusplus",
            ),
        ])
        .await
        .expect("servers");
    writer
        .upsert_server_mods(key(1), mods(&[("Expansion Core", 1)]))
        .await
        .expect("mods a");
    writer
        .upsert_server_mods(key(3), mods(&[("Community Framework", 2)]))
        .await
        .expect("mods c");
}

fn names_matching(registry: &Registry, text: &str) -> Vec<String> {
    let filter = ServerFilter {
        search: Some(text.into()),
        ..Default::default()
    };
    registry
        .reader()
        .expect("reader")
        .page(&filter, SortKey::Name, SortDir::Asc, 0, 50)
        .expect("page")
        .into_iter()
        .map(|r| r.name)
        .collect()
}

#[tokio::test]
async fn every_search_word_must_match_somewhere() {
    let cases: &[(&str, &[&str])] = &[
        ("namalsk expansion", &["Alpha"]),
        ("expansion namalsk", &["Alpha"]),
        ("expansion", &["Alpha", "Bravo Expansion"]),
        ("namalsk nonsense", &[]),
        ("livonia", &["Charlie"]),
        ("framework community", &["Charlie"]),
        ("%", &["100%_Real"]),
        ("_Real", &["100%_Real"]),
        ("10.0.0", &["Echo"]),
        ("10.0.0.5:2302", &["Echo"]),
        ("  alpha   ", &["Alpha"]),
        // Words past the eighth are ignored.
        (
            "alpha alpha alpha alpha alpha alpha alpha alpha nonsense",
            &["Alpha"],
        ),
        (
            "",
            &["100%_Real", "Alpha", "Bravo Expansion", "Charlie", "Echo"],
        ),
        (
            "   ",
            &["100%_Real", "Alpha", "Bravo Expansion", "Charlie", "Echo"],
        ),
    ];

    let registry = Registry::open_in_memory().expect("registry");
    seed(&registry).await;
    for (text, expected) in cases {
        assert_eq!(names_matching(&registry, text), *expected, "search: {text}");
    }
}

#[tokio::test]
async fn a_row_says_which_mod_the_search_matched() {
    let registry = Registry::open_in_memory().expect("registry");
    seed(&registry).await;
    let reader = registry.reader().expect("reader");

    let by_mod = |text: &str| {
        let filter = ServerFilter {
            search: Some(text.into()),
            ..Default::default()
        };
        reader
            .page(&filter, SortKey::Name, SortDir::Asc, 0, 50)
            .expect("page")
            .into_iter()
            .map(|r| (r.name, r.matched_mod))
            .collect::<Vec<_>>()
    };

    assert_eq!(
        by_mod("namalsk expansion"),
        [("Alpha".to_string(), Some("Expansion Core".to_string()))]
    );
    assert_eq!(by_mod("alpha"), [("Alpha".to_string(), None)]);
    assert_eq!(
        by_mod("NAMALSK EXPANSION"),
        [("Alpha".to_string(), Some("Expansion Core".to_string()))]
    );
    assert_eq!(
        by_mod("expansion"),
        [
            ("Alpha".to_string(), Some("Expansion Core".to_string())),
            ("Bravo Expansion".to_string(), None),
        ]
    );
}

fn timed<T>(label: &str, work: impl FnOnce() -> T) -> T {
    let started = std::time::Instant::now();
    let out = work();
    println!("{label}: {:?}", started.elapsed());
    out
}

#[tokio::test]
#[ignore = "slow: seeds ~27,000 servers with mods; run with --ignored --nocapture"]
async fn searching_a_registry_of_twenty_seven_thousand_servers() {
    const SERVERS: u32 = 27_000;
    const MODS_PER_SERVER: u32 = 15;

    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    let rows = (0..SERVERS)
        .map(|n| ServerRow {
            key: ServerKey {
                ip: Ipv4Addr::from(0x0A00_0000 + n),
                query_port: 27016,
            },
            name: format!("Server {n}"),
            map: "chernarusplus".into(),
            players: (n % 60) as i32,
            max_players: 60,
            responded: true,
            ..Default::default()
        })
        .collect();
    writer.upsert_servers(rows).await.expect("servers");

    // Every server declares the same 15 mods; two of them carry a search word,
    // so a mod hit is the only way a row can match either word.
    let mods: Vec<ServerMod> = (0..MODS_PER_SERVER)
        .map(|m| ServerMod {
            workshop_id: u64::from(m) + 1,
            name: format!("Filler Mod {m}"),
            hash: None,
        })
        .chain([
            ServerMod {
                workshop_id: 9_998,
                name: "Namalsk Islands".into(),
                hash: None,
            },
            ServerMod {
                workshop_id: 9_999,
                name: "Expansion Core".into(),
                hash: None,
            },
        ])
        .collect();
    for n in 0..SERVERS {
        writer
            .upsert_server_mods(
                ServerKey {
                    ip: Ipv4Addr::from(0x0A00_0000 + n),
                    query_port: 27016,
                },
                mods.clone(),
            )
            .await
            .expect("mods");
    }

    let reader = registry.reader().expect("reader");
    let filter = ServerFilter {
        search: Some("namalsk expansion".into()),
        ..Default::default()
    };

    let total = timed("count", || reader.count(&filter).expect("count"));
    assert_eq!(total, SERVERS as usize);

    let page = timed("page", || {
        reader
            .page(&filter, SortKey::Players, SortDir::Desc, 0, 200)
            .expect("page")
    });
    assert_eq!(page.len(), 200);
}
