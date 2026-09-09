//! Spoofed listings must never reach the table: the DayZ master list carries
//! several times more fabricated servers than real ones, and they are not
//! joinable. See `tetra_core::classify::fake`.

use std::net::Ipv4Addr;
use tetra_registry::{Registry, ServerFilter, ServerKey, ServerRow, SortDir, SortKey};

fn key(last_octet: u8) -> ServerKey {
    ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, last_octet),
        query_port: 27016,
    }
}

fn row(key: ServerKey, name: &str, players: i32, max_players: i32, bots: i32) -> ServerRow {
    ServerRow {
        key,
        game_port: 2302,
        name: name.into(),
        map: "chernarusplus".into(),
        players,
        max_players,
        bots,
        ping_ms: 35,
        locked: false,
        vac: true,
        version: Some("1.28".into()),
        keywords: Some("mod,battleye,privHive,lqs0".into()),
        description: None,
        mod_count: None,
        last_played: None,
        responded: true,
        country_code: None,
    }
}

fn names(registry: &Registry) -> Vec<String> {
    let reader = registry.reader().expect("reader");
    reader
        .list(
            &ServerFilter::default(),
            SortKey::Players,
            SortDir::Desc,
            50,
        )
        .expect("list")
        .into_iter()
        .map(|r| r.name)
        .collect()
}

#[tokio::test]
async fn spoofed_rows_are_dropped_and_honest_ones_kept() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer
        .upsert_servers(vec![
            row(key(10), "Survivor Haven", 42, 60, 0),
            // Mirrored bot count: the signature of an inflated listing.
            row(key(11), "[-]Gliqury |3PP|Part", 196, 200, 196),
            // Counts saturated at a u8.
            row(key(12), "RU CHAMPIONS", 255, 255, 0),
            // Name padded with control characters.
            row(key(13), &"\u{1}".repeat(40), 3, 60, 0),
            // More players than slots.
            row(key(14), "Over Capacity", 61, 60, 0),
        ])
        .await
        .expect("write");

    assert_eq!(names(&registry), vec!["Survivor Haven".to_string()]);
}

#[tokio::test]
async fn a_row_that_starts_lying_is_removed() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer
        .upsert_servers(vec![row(key(10), "Survivor Haven", 42, 60, 0)])
        .await
        .expect("honest write");
    assert_eq!(names(&registry).len(), 1);

    // Same address, now reporting a mirrored bot count.
    writer
        .upsert_servers(vec![row(key(10), "Survivor Haven", 60, 60, 60)])
        .await
        .expect("spoofed write");

    assert!(
        names(&registry).is_empty(),
        "a listing that turns spoofed must not linger"
    );
}

#[tokio::test]
async fn an_unresolved_master_row_is_not_mistaken_for_a_spoof() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    // What Steam hands over for a server it could not reach itself: structural
    // zeroes, no name. Those rows are the backlog `resolve_unlisted` works
    // through, so dropping them would be a regression.
    let mut unresolved = row(key(20), "", 0, 0, 0);
    unresolved.responded = false;
    unresolved.keywords = None;
    writer
        .upsert_servers(vec![unresolved])
        .await
        .expect("write");

    let reader = registry.reader().expect("reader");
    assert_eq!(reader.unresolved(10, 0).expect("unresolved").len(), 1);
}
