//! Paging the server list: walking every page with an offset gives the same
//! rows as one unpaged list, and `count` matches the filter it was given.

use std::net::Ipv4Addr;
use std::time::Instant;
use tetra_registry::{Registry, ServerFilter, ServerKey, ServerRow, SortDir, SortKey};

fn row(n: u8, name: &str, players: i32) -> ServerRow {
    ServerRow {
        key: ServerKey {
            ip: Ipv4Addr::new(203, 0, 113, n),
            query_port: 27016,
        },
        name: name.into(),
        map: "chernarusplus".into(),
        players,
        max_players: 60,
        responded: true,
        ..Default::default()
    }
}

#[tokio::test]
async fn pages_concatenate_to_the_unpaged_list_in_every_order() {
    let registry = Registry::open_in_memory().expect("registry");
    // Ties on players and name are the point: only the address keeps the order stable.
    let rows = (1..=12u8)
        .map(|n| {
            let name = if n % 2 == 0 { "Even" } else { "Odd" };
            row(n, name, i32::from(n % 3) * 10)
        })
        .collect();
    registry
        .writer()
        .upsert_servers(rows)
        .await
        .expect("servers");
    let reader = registry.reader().expect("reader");

    let hide_empty = ServerFilter {
        hide_empty: true,
        ..Default::default()
    };
    let cases = [
        (ServerFilter::default(), SortKey::Players, SortDir::Desc, 5),
        (ServerFilter::default(), SortKey::Name, SortDir::Asc, 4),
        (ServerFilter::default(), SortKey::Ping, SortDir::Asc, 1),
        (hide_empty.clone(), SortKey::Players, SortDir::Desc, 3),
    ];
    for (filter, sort, dir, page_size) in cases {
        let unpaged = reader
            .list(&filter, sort, dir, 1_000)
            .expect("unpaged list");
        let mut paged = Vec::new();
        let mut offset = 0;
        loop {
            let page = reader
                .page(&filter, sort, dir, offset, page_size)
                .expect("page");
            if page.is_empty() {
                break;
            }
            paged.extend(page);
            offset += page_size;
        }
        assert_eq!(paged, unpaged, "{sort:?} {dir:?} in pages of {page_size}");
        assert_eq!(reader.count(&filter).expect("count"), unpaged.len());
    }

    assert_eq!(reader.count(&ServerFilter::default()).expect("count"), 12);
    assert_eq!(reader.count(&hide_empty).expect("count"), 8);
}

fn timed<T>(label: &str, work: impl FnOnce() -> T) -> T {
    let started = Instant::now();
    let out = work();
    println!("{label}: {:?}", started.elapsed());
    out
}

#[tokio::test]
#[ignore = "slow: seeds 90,000 rows; run with --ignored --nocapture"]
async fn paging_a_registry_of_ninety_thousand_servers() {
    let registry = Registry::open_in_memory().expect("registry");
    let rows = (0..90_000u32)
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
    registry
        .writer()
        .upsert_servers(rows)
        .await
        .expect("servers");
    let reader = registry.reader().expect("reader");
    let filter = ServerFilter::default();
    let (sort, dir) = (SortKey::Players, SortDir::Desc);

    let total = timed("count", || reader.count(&filter).expect("count"));
    assert_eq!(total, 90_000);

    let first = timed("page at offset 0", || {
        reader.page(&filter, sort, dir, 0, 200).expect("page")
    });
    assert_eq!(first.len(), 200);

    let late = timed("page at offset 89000", || {
        reader.page(&filter, sort, dir, 89_000, 200).expect("page")
    });
    assert_eq!(late.len(), 200);

    let keys: Vec<ServerKey> = (0..300u32)
        .map(|n| ServerKey {
            ip: Ipv4Addr::from(0x0A00_0000 + n * 300),
            query_port: 27016,
        })
        .collect();
    let found = timed("get_many for 300 keys", || {
        reader.get_many(&keys).expect("get_many")
    });
    assert_eq!(found.len(), 300);
}
