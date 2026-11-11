//! The index replication boundary: the rows `export` hands the indexer, and
//! what `upsert_server_mods_bulk` writes back.

mod common;

use common::key;
use tetra_core::a2s::dayz::ServerMod;
use tetra_registry::{Registry, ServerKey, ServerRow};

const MOD_A: u64 = 1_111_111_111;
const MOD_B: u64 = 2_222_222_222;

fn row(k: ServerKey) -> ServerRow {
    ServerRow {
        key: k,
        game_port: 2302,
        name: format!("Server {}", k.ip),
        map: "chernarusplus".into(),
        players: 1,
        responded: true,
        ..Default::default()
    }
}

fn mods(entries: &[(u64, &str)]) -> Vec<ServerMod> {
    entries
        .iter()
        .map(|&(workshop_id, name)| ServerMod {
            workshop_id,
            name: name.into(),
            hash: None,
        })
        .collect()
}

/// A server that answered A2S_RULES exports `Some(mod_ids)` — `Some(vec![])`
/// when it declares none — while one never probed exports `None`. The
/// distinction is what tells a consumer "no mods" from "unknown".
#[tokio::test]
async fn export_separates_never_probed_from_no_mods_and_interns_names() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    let (probed, unprobed) = (key(1), key(2));
    writer
        .upsert_servers(vec![row(probed), row(unprobed)])
        .await
        .expect("servers");
    writer
        .upsert_server_mods(probed, mods(&[(MOD_A, "Mod A"), (MOD_B, "Mod B")]))
        .await
        .expect("mods");

    let reader = registry.reader().expect("reader");
    let export = reader.export().expect("export");
    let find = |k| {
        export
            .rows
            .iter()
            .find(|r| r.key == k)
            .expect("exported row")
    };

    assert_eq!(find(probed).mod_ids, Some(vec![MOD_A, MOD_B]));
    assert_eq!(find(unprobed).mod_ids, None);

    // Each name ships once, keyed by workshop id.
    assert_eq!(
        export.mod_names.get(&MOD_A).map(String::as_str),
        Some("Mod A")
    );
    assert_eq!(
        export.mod_names.get(&MOD_B).map(String::as_str),
        Some("Mod B")
    );
}

#[tokio::test]
async fn a_bulk_write_replaces_mods_and_an_empty_list_records_zero() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    let k = key(1);
    writer.upsert_servers(vec![row(k)]).await.expect("servers");
    writer
        .upsert_server_mods(k, mods(&[(MOD_A, "Mod A")]))
        .await
        .expect("mods");

    writer
        .upsert_server_mods_bulk(vec![(k, Vec::new())])
        .await
        .expect("bulk");

    let reader = registry.reader().expect("reader");
    let export = reader.export().expect("export");
    let exported = export.rows.iter().find(|r| r.key == k).expect("row");
    assert_eq!(
        exported.mod_ids,
        Some(vec![]),
        "an empty bulk list is an answered probe with no mods, not `None`"
    );
    assert!(export.mod_names.is_empty());
    assert_eq!(reader.get(k).expect("get").expect("row").mod_count, Some(0));
}

/// The online verdict travels with the time it was written, so a consumer can
/// weigh it against a probe of its own.
#[tokio::test]
async fn export_carries_the_online_verdict_with_its_check_time() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    let (checked, unchecked) = (key(1), key(2));
    writer
        .upsert_servers(vec![row(checked), row(unchecked)])
        .await
        .expect("servers");
    // `unchecked` is attempted but gets no verdict, as when a sweep suppresses
    // its offline marks.
    writer
        .mark_probe_attempt(vec![checked, unchecked])
        .await
        .expect("attempt");
    writer
        .record_online(vec![checked], false)
        .await
        .expect("verdict");

    let export = registry.reader().expect("reader").export().expect("export");
    let find = |k| export.rows.iter().find(|r| r.key == k).expect("row");

    let now = tetra_core::unix_now();
    assert_eq!(find(checked).online, Some(false));
    assert!(find(checked)
        .online_checked_at
        .is_some_and(|t| (now - 5..=now).contains(&t)));
    assert_eq!(find(unchecked).online_checked_at, None);
}
