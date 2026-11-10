//! Countries reach a row from its address, survive a refresh, and sort A to Z by name.

use std::net::Ipv4Addr;
use tetra_core::PingKind;
use tetra_registry::{Registry, ServerFilter, ServerKey, ServerRow, SortDir, SortKey};

fn row(ip: Ipv4Addr, country_code: Option<&str>) -> ServerRow {
    ServerRow {
        key: ServerKey {
            ip,
            query_port: 27016,
        },
        game_port: 2302,
        name: "Server".into(),
        map: "chernarusplus".into(),
        players: 1,
        max_players: 60,
        bots: 0,
        ping_ms: 20,
        ping_kind: PingKind::Measured,
        locked: false,
        vac: true,
        version: None,
        keywords: None,
        description: None,
        mod_count: None,
        last_played: None,
        responded: true,
        responded_at: None,
        country_code: country_code.map(str::to_string),
    }
}

async fn country_of(registry: &Registry, ip: Ipv4Addr) -> Option<String> {
    let key = ServerKey {
        ip,
        query_port: 27016,
    };
    let row = registry
        .reader()
        .expect("reader")
        .get(key)
        .expect("get")
        .expect("row present");
    row.country_code
}

#[tokio::test]
async fn a_written_row_takes_its_country_from_the_address() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    let public = Ipv4Addr::new(88, 198, 1, 1);
    let private = Ipv4Addr::new(192, 168, 1, 1);
    let named = Ipv4Addr::new(1, 1, 1, 1);

    writer
        .upsert_servers(vec![
            row(public, None),
            row(private, None),
            row(named, Some("FR")),
        ])
        .await
        .expect("rows");

    assert_eq!(country_of(&registry, public).await.as_deref(), Some("DE"));
    assert_eq!(
        country_of(&registry, private).await,
        None,
        "a private address has no country"
    );
    assert_eq!(
        country_of(&registry, named).await.as_deref(),
        Some("FR"),
        "an explicit country is not overwritten by the address"
    );
}

#[tokio::test]
async fn a_refresh_with_no_country_leaves_the_stored_one_alone() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    // A private address has no country of its own, so nothing replaces what is stored.
    let private = Ipv4Addr::new(192, 168, 1, 1);
    writer
        .upsert_servers(vec![row(private, Some("AT"))])
        .await
        .expect("first");
    writer
        .upsert_servers(vec![row(private, None)])
        .await
        .expect("refresh");

    assert_eq!(country_of(&registry, private).await.as_deref(), Some("AT"));
}

#[tokio::test]
async fn sorting_by_country_reads_a_to_z_with_countryless_rows_last() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    let germany = Ipv4Addr::new(88, 198, 1, 1);
    let austria = Ipv4Addr::new(88, 198, 1, 2);
    let united_states = Ipv4Addr::new(88, 198, 1, 3);
    // Reserved, so it has no country, but not private, so the whole list shows it.
    let no_country = Ipv4Addr::new(240, 0, 0, 1);

    writer
        .upsert_servers(vec![
            row(germany, Some("DE")),
            row(austria, Some("AT")),
            row(united_states, Some("US")),
            row(no_country, None),
        ])
        .await
        .expect("rows");

    let reader = registry.reader().expect("reader");
    for (dir, expected) in [
        (SortDir::Asc, ["AT", "DE", "US", ""]),
        (SortDir::Desc, ["US", "DE", "AT", ""]),
    ] {
        let got: Vec<String> = reader
            .page(&ServerFilter::default(), SortKey::Country, dir, 0, 10)
            .expect("page")
            .into_iter()
            .map(|r| r.country_code.unwrap_or_default())
            .collect();
        assert_eq!(got, expected, "{dir:?}");
    }
}

/// A database written before countries were real holds region codes, which now mean something
/// else. Reopening replaces each with the country of its address.
#[tokio::test]
async fn a_region_code_saved_by_the_old_schema_becomes_a_real_country() {
    let dir = std::env::temp_dir().join(format!("tetra-countries-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    let path = dir.join("registry.sqlite");
    let public = Ipv4Addr::new(88, 198, 1, 1);

    {
        let registry = Registry::open(&path).expect("registry");
        registry
            .writer()
            .upsert_servers(vec![row(public, None)])
            .await
            .expect("row");
    }
    {
        let conn = rusqlite::Connection::open(&path).expect("open");
        conn.execute_batch(
            "UPDATE servers SET country_code = 'EU';
             ALTER TABLE servers DROP COLUMN country_order;
             ALTER TABLE servers DROP COLUMN online_checked_at;
             DROP TRIGGER servers_drop_mods;
             PRAGMA user_version = 8;",
        )
        .expect("downgrade");
    }

    let registry = Registry::open(&path).expect("reopen");
    assert_eq!(country_of(&registry, public).await.as_deref(), Some("DE"));

    let _ = std::fs::remove_dir_all(&dir);
}

/// Timing for a real registry: a start looks up every row it finds without a country.
#[tokio::test]
#[ignore = "slow: writes 100,000 rows; run with --ignored --nocapture"]
async fn backfilling_a_hundred_thousand_rows_is_quick() {
    let dir = std::env::temp_dir().join(format!("tetra-backfill-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    let path = dir.join("registry.sqlite");

    {
        let registry = Registry::open(&path).expect("registry");
        let rows = (0..100_000u32)
            .map(|n| {
                let ip = Ipv4Addr::new(88, 198, 1 + (n / 50_000) as u8, 1);
                ServerRow {
                    key: ServerKey {
                        ip,
                        query_port: (1 + n % 50_000) as u16,
                    },
                    ..row(ip, None)
                }
            })
            .collect();
        registry.writer().upsert_servers(rows).await.expect("rows");
    }

    let conn = rusqlite::Connection::open(&path).expect("open");
    conn.execute_batch(
        "UPDATE servers SET country_code = NULL, country_order = NULL; PRAGMA user_version = 8;",
    )
    .expect("clear");
    let started = std::time::Instant::now();
    let updated = tetra_registry::schema::backfill_countries(&conn).expect("backfill");
    println!("backfilled {updated} rows in {:?}", started.elapsed());
    assert_eq!(updated, 100_000);

    let _ = std::fs::remove_dir_all(&dir);
}
