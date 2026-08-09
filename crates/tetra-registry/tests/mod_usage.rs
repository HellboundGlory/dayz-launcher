//! The Mods tab's registry aggregation: which servers declare which mods,
//! computed against the "cared about" set of favourites + recently played.
//!
//! These power the two headline features of the Mods tab: the "needed by N
//! servers" number (the honest blast radius of an unsubscribe) and the
//! unique-per-server selection that lets James prune a server's exclusive mods
//! without breaking another favourite or recent one.

use std::net::Ipv4Addr;
use tetra_core::a2s::dayz::ServerMod;
use tetra_registry::{Registry, ServerKey, ServerRow};

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

/// Dabs Framework and CF are real DayZ mod list entries used elsewhere in the
/// tests; A/B here are opaque but must be Workshop-shaped ids (nonzero).
const MOD_A: u64 = 1_111_111_111;
const MOD_B: u64 = 2_222_222_222;
const MOD_C: u64 = 3_333_333_333;

#[tokio::test]
async fn usage_counts_every_server_and_the_cared_subset() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    let (s1, s2, s3) = (key(1), key(2), key(3));
    writer
        .upsert_servers(vec![row(s1), row(s2), row(s3)])
        .await
        .expect("servers");

    // s1 (favourite) and s2 both list A and B; s3 (played) lists A only.
    for (k, ks) in [
        (s1, vec![MOD_A, MOD_B]),
        (s2, vec![MOD_A, MOD_B]),
        (s3, vec![MOD_A, MOD_C]),
    ] {
        writer
            .upsert_server_mods(
                k,
                ks.into_iter()
                    .map(|id| ServerMod {
                        workshop_id: id,
                        name: id.to_string(),
                    })
                    .collect(),
            )
            .await
            .expect("mods");
    }
    writer.set_favourite(s1, true).await.expect("fav");
    writer.mark_played(s3).await.expect("played");

    let reader = registry.reader().expect("reader");
    let mut usage = std::collections::HashMap::new();
    for (id, total, cared) in reader.mod_usage(&[MOD_A, MOD_B, MOD_C]).expect("usage") {
        usage.insert(id, (total, cared));
    }

    // The needed-by count is favourites-only: s1 is the one favourite, so A
    // and B each count 1 regardless of s2/s3.
    assert_eq!(usage[&MOD_A], (3, 1));
    assert_eq!(usage[&MOD_B], (2, 1));
    assert_eq!(usage[&MOD_C], (1, 0));

    assert!(reader.mod_usage(&[]).expect("empty").is_empty());
}

#[tokio::test]
async fn cared_servers_are_favourites_plus_played_in_order() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    writer
        .upsert_servers(vec![row(key(1)), row(key(2)), row(key(3))])
        .await
        .expect("servers");

    writer.set_favourite(key(1), true).await.expect("fav");
    writer.mark_played(key(3)).await.expect("played");

    let reader = registry.reader().expect("reader");
    let cared = reader.cared_servers().expect("cared");
    let keys: Vec<ServerKey> = cared.into_iter().map(|(k, _)| k).collect();
    assert!(keys.contains(&key(1)));
    assert!(keys.contains(&key(3)));
    assert!(!keys.contains(&key(2)));
}

#[tokio::test]
async fn unique_mods_are_those_no_other_cared_server_declares() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    let (s1, s2) = (key(1), key(2));
    writer
        .upsert_servers(vec![row(s1), row(s2), row(key(3))])
        .await
        .expect("servers");
    for (k, ks) in [(s1, vec![MOD_A, MOD_B]), (s2, vec![MOD_B, MOD_C])] {
        writer
            .upsert_server_mods(
                k,
                ks.into_iter()
                    .map(|id| ServerMod {
                        workshop_id: id,
                        name: id.to_string(),
                    })
                    .collect(),
            )
            .await
            .expect("mods");
    }
    writer.set_favourite(s1, true).await.expect("fav");

    let reader = registry.reader().expect("reader");

    // The universe is favourites + recently played, and only s1 is cared — so
    // s2's copy of B doesn't stop B counting as unique to s1. Unsubscribing it
    // would still break s2 if it were ever joined, but s2 is not a server being
    // reasoned about: that's the deal the favourites+recent universe makes.
    let s1_unique: Vec<u64> = reader
        .unique_mods_for(s1)
        .expect("unique")
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert_eq!(s1_unique, vec![MOD_A, MOD_B]);

    // s2 isn't cared, but the tool runs against any key and still compares to
    // the cared set: A and B are on s1 (cared), so only C is unique to s2.
    let s2_unique: Vec<u64> = reader
        .unique_mods_for(s2)
        .expect("unique")
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert_eq!(s2_unique, vec![MOD_C]);
}

#[tokio::test]
async fn servers_needing_only_lists_favourites_in_played_order() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    let (s1, s2) = (key(1), key(2));
    writer
        .upsert_servers(vec![row(s1), row(s2)])
        .await
        .expect("servers");
    for k in [s1, s2] {
        writer
            .upsert_server_mods(
                k,
                vec![ServerMod {
                    workshop_id: MOD_A,
                    name: MOD_A.to_string(),
                }],
            )
            .await
            .expect("mods");
    }
    writer.set_favourite(s1, true).await.expect("fav");
    writer.mark_played(s2).await.expect("played");

    let reader = registry.reader().expect("reader");
    // servers_needing is scoped to favourites — s2 being played is not enough.
    let needing = reader.servers_needing(MOD_A).expect("needing");
    let keys: Vec<ServerKey> = needing.into_iter().map(|(k, _, _)| k).collect();
    assert_eq!(keys, vec![s1]);
    assert!(reader.servers_needing(MOD_C).expect("none").is_empty());
}
