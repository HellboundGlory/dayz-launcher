//! Upsert semantics: which writes are allowed to overwrite live data.
//!
//! These exist because a partial write silently destroyed real rows in
//! production. A refresh wrote a full `ServerRow` for each server, then a
//! second pass wrote another `ServerRow` carrying *only* a `mod_count` — every
//! other field left at `Default`. The `ON CONFLICT` clause assigned those
//! defaults unconditionally, so a successful mod probe blanked the name and
//! zeroed the player counts of the very server it had just measured. 1426 of
//! 4735 rows in the shipped database were corrupted this way.

use std::net::Ipv4Addr;
use tetra_core::a2s::dayz::ServerMod;
use tetra_registry::{Registry, ServerFilter, ServerKey, ServerRow, SortDir, SortKey};

fn key() -> ServerKey {
    ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, 10),
        query_port: 27016,
    }
}

/// A fully-populated row as a successful A2S_INFO probe would produce.
fn live_row() -> ServerRow {
    ServerRow {
        key: key(),
        game_port: 2302,
        name: "Survivor Haven".into(),
        map: "chernarusplus".into(),
        players: 42,
        max_players: 60,
        bots: 0,
        ping_ms: 35,
        locked: false,
        vac: true,
        version: Some("1.28".into()),
        // A modded community server: `privHive` is what keeps a sharded server
        // from counting as an official Bohemia one.
        keywords: Some("mod,battleye,shard0,privHive,no3rd".into()),
        description: None,
        mod_count: None,
        last_played: None,
        responded: true,
        country_code: None,
    }
}

async fn fetch(registry: &Registry) -> tetra_registry::ServerListRow {
    let reader = registry.reader().expect("reader");
    let rows = reader
        .list(
            &ServerFilter::default(),
            SortKey::Players,
            SortDir::Desc,
            10,
        )
        .expect("list");
    rows.into_iter().next().expect("one row")
}

#[tokio::test]
async fn a_non_responding_row_does_not_blank_a_live_one() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer.upsert_servers(vec![live_row()]).await.expect("live");

    // The shape that caused the corruption: everything Default except the key.
    writer
        .upsert_servers(vec![ServerRow {
            key: key(),
            responded: false,
            ..Default::default()
        }])
        .await
        .expect("partial");

    let row = fetch(&registry).await;
    assert_eq!(row.name, "Survivor Haven", "name was blanked");
    assert_eq!(row.players, 42, "player count was zeroed");
    assert_eq!(row.max_players, 60, "max players was zeroed");
    assert_eq!(row.map_display, "Chernarus", "map was blanked");
    assert!(row.vac, "vac flag was cleared");
}

#[tokio::test]
async fn a_responding_row_does_overwrite_a_live_one() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer.upsert_servers(vec![live_row()]).await.expect("live");
    writer
        .upsert_servers(vec![ServerRow {
            name: "Renamed Server".into(),
            players: 7,
            ..live_row()
        }])
        .await
        .expect("second live");

    let row = fetch(&registry).await;
    assert_eq!(row.name, "Renamed Server");
    assert_eq!(row.players, 7);
}

/// Emptying out is a real measurement, not missing data, so a responding row
/// must be able to write zero players. This is why the guard keys on
/// `responded` rather than on the values being zero.
#[tokio::test]
async fn a_responding_row_may_write_zero_players() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer.upsert_servers(vec![live_row()]).await.expect("live");
    writer
        .upsert_servers(vec![ServerRow {
            players: 0,
            ..live_row()
        }])
        .await
        .expect("emptied");

    assert_eq!(fetch(&registry).await.players, 0);
}

#[tokio::test]
async fn mod_probe_sets_mod_count_without_touching_live_fields() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer.upsert_servers(vec![live_row()]).await.expect("live");
    writer
        .upsert_server_mods(
            key(),
            vec![
                ServerMod {
                    workshop_id: 1559212036,
                    name: "CF".into(),
                },
                ServerMod {
                    workshop_id: 2545327648,
                    name: "Dabs Framework".into(),
                },
            ],
        )
        .await
        .expect("mods");

    let row = fetch(&registry).await;
    assert_eq!(row.mod_count, Some(2));
    assert_eq!(row.name, "Survivor Haven");
    assert_eq!(row.players, 42);
}

/// A server that answers the rules query with no mods is *known* vanilla.
/// That has to be distinguishable from never-probed, which is what the mods
/// column in the UI keys off — showing "—" for both is what made modded
/// servers look mod-free.
#[tokio::test]
async fn an_empty_mod_list_records_zero_rather_than_leaving_null() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer.upsert_servers(vec![live_row()]).await.expect("live");
    assert_eq!(fetch(&registry).await.mod_count, None, "unprobed is NULL");

    writer
        .upsert_server_mods(key(), vec![])
        .await
        .expect("empty mods");

    assert_eq!(fetch(&registry).await.mod_count, Some(0));
}

#[tokio::test]
async fn an_info_refresh_does_not_clear_an_existing_mod_count() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer.upsert_servers(vec![live_row()]).await.expect("live");
    writer
        .upsert_server_mods(
            key(),
            vec![ServerMod {
                workshop_id: 1559212036,
                name: "CF".into(),
            }],
        )
        .await
        .expect("mods");

    // A later info-only refresh carries `mod_count: None`.
    writer
        .upsert_servers(vec![live_row()])
        .await
        .expect("refresh");

    assert_eq!(fetch(&registry).await.mod_count, Some(1));
}

#[tokio::test]
async fn favourite_persists_and_survives_a_refresh() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer.upsert_servers(vec![live_row()]).await.expect("live");
    assert!(!fetch(&registry).await.favourite);

    writer.set_favourite(key(), true).await.expect("favourite");
    assert!(fetch(&registry).await.favourite);

    writer
        .upsert_servers(vec![live_row()])
        .await
        .expect("refresh");
    assert!(
        fetch(&registry).await.favourite,
        "a refresh must not clear the favourite flag"
    );

    writer
        .set_favourite(key(), false)
        .await
        .expect("unfavourite");
    assert!(!fetch(&registry).await.favourite);
}

#[tokio::test]
async fn classification_flags_reach_the_list_row() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    writer.upsert_servers(vec![live_row()]).await.expect("live");

    let row = fetch(&registry).await;
    assert!(row.modded, "keywords declared mods");
    assert!(row.battleye, "keywords declared battleye");
    assert!(row.first_person, "keywords declared no3rd");
    assert!(!row.official);
    assert_eq!(row.version.as_deref(), Some("1.28"));
}

/// Never-probed servers must be first in line for the next refresh.
///
/// Ordering refresh targets by `players DESC` starves them: a server that has
/// never answered has `players = 0`, so it sorts to the very bottom, and once
/// the registry outgrows the probe window it would never be probed again — nor
/// healed from the Steam side, since rows that fail Steam's own query arrive
/// with `responded = false` and the upsert guard ignores them.
#[tokio::test]
async fn refresh_priority_puts_never_probed_servers_first() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    let busy = ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, 20),
        query_port: 27016,
    };
    let never_probed = ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, 21),
        query_port: 27016,
    };

    writer
        .upsert_servers(vec![
            ServerRow {
                key: busy,
                name: "Busy".into(),
                players: 60,
                responded: true,
                ..live_row()
            },
            // Straight off Steam's `failed` callback: no name, no players,
            // never answered anything.
            ServerRow {
                key: never_probed,
                responded: false,
                ..Default::default()
            },
        ])
        .await
        .expect("rows");

    let reader = registry.reader().expect("reader");

    let by_players = reader
        .list(
            &ServerFilter::default(),
            SortKey::Players,
            SortDir::Desc,
            10,
        )
        .expect("list");
    assert_eq!(
        by_players[0].key, busy,
        "sanity: by players the busy server leads"
    );

    let by_priority = reader
        .list(
            &ServerFilter::default(),
            SortKey::RefreshPriority,
            SortDir::Desc,
            10,
        )
        .expect("list");
    assert_eq!(
        by_priority[0].key, never_probed,
        "the never-probed server must be refreshed first"
    );
    assert_eq!(by_priority[1].key, busy);
}

/// `counts()` folds what used to be two separate scans — a `count()` plus an
/// ad-hoc `SELECT COUNT(*) ... WHERE players > 0` written at the command layer
/// through a `raw()` connection escape hatch — into one statement inside the
/// crate that owns the SQL.
#[tokio::test]
async fn counts_reports_total_and_populated_separately() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    let empty = ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, 30),
        query_port: 27016,
    };
    let full = ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, 31),
        query_port: 27016,
    };

    writer
        .upsert_servers(vec![
            // Populated, from `live_row`'s 42 players.
            live_row(),
            ServerRow {
                key: empty,
                name: "Empty".into(),
                players: 0,
                ..live_row()
            },
            ServerRow {
                key: full,
                name: "Full".into(),
                players: 60,
                ..live_row()
            },
        ])
        .await
        .expect("rows");

    let reader = registry.reader().expect("reader");
    assert_eq!(reader.counts().expect("counts"), (3, 2));
}

#[tokio::test]
async fn counts_are_zero_on_an_untouched_registry() {
    let registry = Registry::open_in_memory().expect("registry");
    let reader = registry.reader().expect("reader");
    assert_eq!(reader.counts().expect("counts"), (0, 0));
}

/// The browser's noise filters, end to end through the SQL.
///
/// These run against `tetra_is_placeholder` / `tetra_is_english`, registered as
/// SQLite functions on every read connection — so this also proves the
/// registration actually happens, which a unit test of the classifier cannot.
#[tokio::test]
async fn name_filters_hide_noise_and_keep_real_servers() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    let named = |n: u8, name: &str| ServerRow {
        key: ServerKey {
            ip: Ipv4Addr::new(203, 0, 113, n),
            query_port: 27016,
        },
        name: name.into(),
        ..live_row()
    };

    writer
        .upsert_servers(vec![
            named(40, "Survivor Haven | PVE"),
            named(41, "nitrado.net gameserver"),
            named(42, "Hosted by GTXGaming.co.uk"),
            // Hoster branding plus a real name. Hidden all the same — the
            // filter is "no hoster names in my list", not "no unnamed servers".
            named(43, "4Netplayers Purgatorio [ESP]"),
            named(44, "Русский сервер PVE"),
            named(45, "生存服务器"),
            // Latin script, but not English — the case that prompted the
            // language rule. Caught by its bracket tag.
            named(47, "[GER][PvE] Zockerfreunde | Trader | Helis"),
            // Never answered a probe, so no name was ever written.
            ServerRow {
                key: ServerKey {
                    ip: Ipv4Addr::new(203, 0, 113, 46),
                    query_port: 27016,
                },
                responded: false,
                ..Default::default()
            },
        ])
        .await
        .expect("rows");

    let reader = registry.reader().expect("reader");
    let names = |f: &ServerFilter| -> Vec<String> {
        let mut v: Vec<String> = reader
            .list(f, SortKey::Name, SortDir::Asc, 50)
            .expect("list")
            .into_iter()
            .map(|r| r.name)
            .collect();
        v.sort();
        v
    };

    assert_eq!(
        names(&ServerFilter::default()).len(),
        8,
        "no filter shows all"
    );

    let hidden = ServerFilter {
        hide_unnamed: true,
        hide_placeholder: true,
        ..Default::default()
    };
    let kept = names(&hidden);
    assert!(kept.contains(&"Survivor Haven | PVE".to_string()));
    assert!(
        !kept.contains(&"4Netplayers Purgatorio [ESP]".to_string()),
        "a hoster name anywhere in the string is hidden, named or not"
    );
    assert!(!kept.iter().any(|n| n.contains("nitrado")));
    assert!(!kept.iter().any(|n| n.contains("GTXGaming")));
    assert!(!kept.iter().any(|n| n.is_empty()), "unnamed row survived");
    // The non-English names are untouched by these two filters.
    assert_eq!(kept.len(), 4, "kept: {kept:?}");

    let english = ServerFilter {
        english_names: Some(true),
        ..Default::default()
    };
    let kept = names(&english);
    assert!(!kept.iter().any(|n| n.contains('Р') || n.contains('生')));
    assert!(
        !kept.iter().any(|n| n.contains("Zockerfreunde")),
        "a [GER]-tagged server is Latin script but not English: {kept:?}"
    );
    assert!(kept.contains(&"Survivor Haven | PVE".to_string()));

    // Inverted, for a player who wants exactly those servers. The unnamed row
    // must not be swept in — it has nothing to read either way.
    let not_english = ServerFilter {
        english_names: Some(false),
        ..Default::default()
    };
    let kept = names(&not_english);
    // Cyrillic, Chinese, the [GER] tag — and `4Netplayers Purgatorio [ESP]`,
    // which this filter alone does not hide (it is `hide_placeholder`'s job)
    // and whose [ESP] tag makes it non-English.
    assert_eq!(kept.len(), 4, "kept: {kept:?}");
    assert!(kept.iter().all(|n| !n.is_empty()));
    assert!(
        kept.iter().any(|n| n.contains("Zockerfreunde")),
        "inverting the tag is how someone finds the German servers: {kept:?}"
    );
}

#[tokio::test]
async fn favourites_and_recent_filters_select_the_right_rows() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    let other = ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, 11),
        query_port: 27016,
    };
    writer
        .upsert_servers(vec![
            live_row(),
            ServerRow {
                key: other,
                name: "Second".into(),
                ..live_row()
            },
        ])
        .await
        .expect("two rows");

    writer.set_favourite(key(), true).await.expect("favourite");
    writer.mark_played(other).await.expect("played");

    let reader = registry.reader().expect("reader");

    let favs = reader
        .list(
            &ServerFilter {
                favourites_only: true,
                ..Default::default()
            },
            SortKey::Players,
            SortDir::Desc,
            10,
        )
        .expect("favourites");
    assert_eq!(favs.len(), 1);
    assert_eq!(favs[0].name, "Survivor Haven");

    let recent = reader
        .list(
            &ServerFilter {
                recent_only: true,
                ..Default::default()
            },
            SortKey::Players,
            SortDir::Desc,
            10,
        )
        .expect("recent");
    assert_eq!(recent.len(), 1);
    assert_eq!(recent[0].name, "Second");
    assert!(recent[0].last_played.is_some());
}
