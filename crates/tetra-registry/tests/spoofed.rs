//! Spoofed listings must never reach the table: the DayZ master list carries
//! several times more fabricated servers than real ones, and they are not
//! joinable. See `tetra_core::classify::fake`.

mod common;

use common::key;
use tetra_core::a2s::dayz::ServerMod;
use tetra_registry::{Registry, ServerFilter, ServerKey, ServerRow, SortDir, SortKey};

const MOD_ID: u64 = 1_547_879_389;

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
        responded_at: None,
        country_code: None,
    }
}

fn names(registry: &Registry) -> Vec<String> {
    let reader = registry.reader().expect("reader");
    reader
        .page(
            &ServerFilter::default(),
            SortKey::Players,
            SortDir::Desc,
            0,
            50,
        )
        .expect("page")
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
async fn a_row_that_starts_lying_is_dropped_with_its_mods() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    let k = key(10);

    writer
        .upsert_servers(vec![row(k, "Survivor Haven", 42, 60, 0)])
        .await
        .expect("honest write");
    writer
        .upsert_server_mods(
            k,
            vec![ServerMod {
                workshop_id: MOD_ID,
                name: "Some Mod".into(),
            }],
        )
        .await
        .expect("mods");

    let reader = registry.reader().expect("reader");
    assert_eq!(names(&registry).len(), 1);
    assert_eq!(reader.known_mods(50).expect("known").len(), 1);

    // Same address, now reporting a mirrored bot count.
    writer
        .upsert_servers(vec![row(k, "Survivor Haven", 60, 60, 60)])
        .await
        .expect("spoofed write");

    assert!(
        names(&registry).is_empty(),
        "a listing that turns spoofed must not linger"
    );
    assert!(
        reader.mods_for(k).expect("mods_for").is_empty(),
        "mod rows of a dropped server must go with it"
    );
    assert!(
        reader.known_mods(50).expect("known").is_empty(),
        "a phantom mod must not linger in the Seen-on-servers pool"
    );

    // The refresh probes rules right after INFO, so the dropped server's mods
    // arrive again; they must not be written without a server row.
    writer
        .upsert_server_mods(
            k,
            vec![ServerMod {
                workshop_id: MOD_ID,
                name: "Some Mod".into(),
            }],
        )
        .await
        .expect("late rules write");
    assert!(reader.known_mods(50).expect("known").is_empty());
}
