//! The index replication boundary: the rows `export`/`export_one` hand the
//! indexer, and what `upsert_server_mods_bulk` writes back.

use std::net::Ipv4Addr;
use tetra_core::a2s::dayz::ServerMod;
use tetra_registry::{Registry, ServerKey, ServerRow};

const MOD_A: u64 = 1_111_111_111;
const MOD_B: u64 = 2_222_222_222;

fn key(n: u8) -> ServerKey {
    ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, n),
        query_port: 27016,
    }
}

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
    let export = reader.export(0).expect("export");
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

    // export_one must agree with the bulk row for each key.
    for k in [probed, unprobed] {
        let one = reader.export_one(k).expect("export_one").expect("row");
        assert_eq!(one.key, find(k).key);
        assert_eq!(one.name, find(k).name);
        assert_eq!(one.mod_ids, find(k).mod_ids);
    }
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
    let export = reader.export(0).expect("export");
    let exported = export.rows.iter().find(|r| r.key == k).expect("row");
    assert_eq!(
        exported.mod_ids,
        Some(vec![]),
        "an empty bulk list is an answered probe with no mods, not `None`"
    );
    assert!(export.mod_names.is_empty());
    assert_eq!(reader.get(k).expect("get").expect("row").mod_count, Some(0));
}
