//! The counts shown beside each filter row, and the search box's suggestions.

mod common;

use common::key;
use tetra_core::a2s::dayz::ServerMod;
use tetra_registry::{
    FacetCount, ModMatch, Registry, ServerFilter, ServerKey, ServerRow, Suggestion, SuggestionKind,
};

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
            listed(key(1), "Alpha", "chernarusplus", Some("1.29.100"), "EU", 10),
            listed(key(2), "Bravo", "chernarusplus", Some("1.29.100"), "EU", 0),
            listed(key(3), "Charlie", "chernarusplus", Some("1.28.50"), "NA", 5),
            listed(key(4), "Delta", "enoch", Some("1.29.100"), "EU", 20),
            listed(key(5), "Echo", "livonia", Some("1.29.100"), "NA", 0),
            listed(key(6), "Foxtrot", "namalsk", Some("1.28.50"), "OC", 7),
            listed(key(7), "Golf", "chernarusplusgloom", None, "EU", 3),
            listed(key(8), "Hotel", "DeerIsle", Some("1.29.100"), "AS", 2),
        ])
        .await
        .expect("servers");
    writer
        .upsert_server_mods(
            key(1),
            mods(&[("Expansion Core", 1), ("Community Framework", 2)]),
        )
        .await
        .expect("mods 1");
    writer
        .upsert_server_mods(key(2), mods(&[("Community Framework", 2)]))
        .await
        .expect("mods 2");
    writer
        .upsert_server_mods(key(3), mods(&[("Expansion Core", 11)]))
        .await
        .expect("mods 3");
    writer
        .upsert_server_mods(key(5), mods(&[("Expansion Core", 1)]))
        .await
        .expect("mods 5");
    writer
        .upsert_server_mods(key(6), mods(&[("Namalsk Survival", 30)]))
        .await
        .expect("mods 6");
    writer
        .upsert_server_mods(key(8), mods(&[("community framework", 2)]))
        .await
        .expect("mods 8");
}

/// A server as the app lists it: answered now, named `name` unless blank.
fn listed(
    key: ServerKey,
    name: &str,
    map: &str,
    version: Option<&str>,
    country: &str,
    players: i32,
) -> ServerRow {
    ServerRow {
        key,
        game_port: 2302,
        name: name.into(),
        map: map.into(),
        players,
        max_players: 60,
        version: version.map(str::to_string),
        country_code: Some(country.into()),
        ping_ms: 30,
        responded: true,
        ..Default::default()
    }
}

/// Answers spread across two names and two ids, two overlapping version
/// strings, a long map label, and a stale, an unnamed and a favourite server.
async fn contract_seed(registry: &Registry) {
    let long_map = "x".repeat(120);
    let long_mod = "y".repeat(120);
    let long_version = format!("1.29.{}", "9".repeat(40));
    let writer = registry.writer();
    writer
        .upsert_servers(vec![
            listed(key(1), "Alpha", "chernarusplus", Some("1.29"), "EU", 10),
            listed(key(2), "Bravo", "chernarusplus", Some("1.29.100"), "EU", 0),
            listed(
                key(3),
                "Charlie",
                "chernarusplus",
                Some("1.29.100"),
                "NA",
                5,
            ),
            listed(key(4), "Delta", "enoch", Some("1.29.100"), "EU", 20),
            listed(key(5), "Echo", "livonia", Some("1.28.50"), "NA", 0),
            listed(key(6), "Foxtrot", "namalsk", Some("1.28.50"), "OC", 7),
            ServerRow {
                responded_at: Some(tetra_core::unix_now() - 3 * 86_400),
                ..listed(key(7), "Golf", "chernarusplus", Some("1.29.100"), "EU", 3)
            },
            listed(key(8), "", "chernarusplus", Some("1.29.100"), "EU", 2),
            ServerRow {
                responded_at: Some(tetra_core::unix_now() - 3 * 86_400),
                ..listed(key(9), "Hotel", "deerisle", Some("1.29.100"), "AS", 2)
            },
            listed(key(10), "India", &long_map, Some("1.29.100"), "EU", 1),
            listed(
                key(11),
                "Juliet",
                "chernarusplus",
                Some("1.29.100"),
                "EU",
                1,
            ),
            listed(key(12), "Kilo", "chernarusplus", Some("1.29.100"), "EU", 1),
            listed(key(13), "Lima", "enoch", Some("1.29.rc1"), "EU", 1),
            listed(key(14), "Mike", "enoch", Some("1.29.RC1.5"), "EU", 1),
            listed(key(15), "November", "enoch", Some("1.29.1_a"), "EU", 1),
            listed(key(16), "Oscar", "enoch", Some(&long_version), "EU", 1),
            listed(key(17), "Papa", "enoch", Some("1.29.100"), "EU", 1),
        ])
        .await
        .expect("servers");
    writer
        .upsert_server_mods(key(1), mods(&[("CF", 2), ("Expansion Core", 1)]))
        .await
        .expect("mods 1");
    writer
        .upsert_server_mods(key(2), mods(&[("Community Framework", 2)]))
        .await
        .expect("mods 2");
    writer
        .upsert_server_mods(key(3), mods(&[("Expansion Core", 11)]))
        .await
        .expect("mods 3");
    writer
        .upsert_server_mods(key(5), mods(&[("Expansion Core", 1)]))
        .await
        .expect("mods 5");
    writer
        .upsert_server_mods(key(6), mods(&[("Namalsk Survival", 30)]))
        .await
        .expect("mods 6");
    // A name with more ids than a row carries: 1025 is the one Kilo shares, so
    // it must survive the cut and the 20 kept ids must be the widest.
    let wide: Vec<(&str, u64)> = (0..25).map(|i| ("Wide Mod", 1001 + i)).collect();
    writer
        .upsert_server_mods(key(11), mods(&wide))
        .await
        .expect("mods 11");
    writer
        .upsert_server_mods(
            key(12),
            mods(&[
                ("Wide Mod", 1025),
                (&long_mod, 7),
                ("Big Id Mod", u64::MAX - 5),
                ("100%_Real", 8),
                ("100xxReal", 9),
            ]),
        )
        .await
        .expect("mods 12");
    // More ids than one counting statement binds.
    let names: Vec<String> = (0..30).map(|i| format!("Pack {i}")).collect();
    let many: Vec<(&str, u64)> = names
        .iter()
        .enumerate()
        .flat_map(|(i, name)| (0..20).map(move |j| (name.as_str(), 5000 + (i * 20 + j) as u64)))
        .collect();
    writer
        .upsert_server_mods(key(17), mods(&many))
        .await
        .expect("mods 17");
    writer.set_favourite(key(9), true).await.expect("favourite");
}

/// Picking a row must return the count the row shows: apply its values to the
/// filter the list was built for and count.
#[tokio::test]
async fn every_row_counts_what_picking_it_returns() {
    let registry = Registry::open_in_memory().expect("registry");
    contract_seed(&registry).await;
    let reader = registry.reader().expect("reader");

    let production = ServerFilter {
        hide_stale: true,
        hide_unnamed: true,
        ..Default::default()
    };

    let empty = ServerFilter::default();
    for filter in [
        &empty,
        &production,
        &ServerFilter {
            maps: vec!["chernarusplus".into()],
            search: Some("chernarus".into()),
            ..production.clone()
        },
    ] {
        let facets = reader.facets(filter, None).expect("facets");
        for row in &facets.maps {
            let picked = ServerFilter {
                maps: row.values.clone(),
                ..filter.clone()
            };
            assert_eq!(
                reader.count(&picked).expect("count"),
                row.count,
                "map {}",
                row.name
            );
        }
        for row in &facets.versions {
            let picked = ServerFilter {
                version: Some(row.values[0].clone()),
                ..filter.clone()
            };
            assert_eq!(
                reader.count(&picked).expect("count"),
                row.count,
                "version {}",
                row.name
            );
        }
        for row in &facets.countries {
            let picked = ServerFilter {
                countries: row.values.clone(),
                ..filter.clone()
            };
            assert_eq!(
                reader.count(&picked).expect("count"),
                row.count,
                "country {}",
                row.name
            );
        }
        for row in &facets.mods {
            let picked = ServerFilter {
                mod_ids: row.values.iter().filter_map(|id| id.parse().ok()).collect(),
                mod_match: ModMatch::Any,
                ..filter.clone()
            };
            assert_eq!(
                reader.count(&picked).expect("count"),
                row.count,
                "mod {}",
                row.name
            );
        }
        for (text, expected) in [
            ("wide", "Wide Mod"),
            ("big", "Big Id Mod"),
            ("100%_", "100%_Real"),
        ] {
            let found = reader.suggestions(filter, text).expect("suggestions");
            assert!(
                found.iter().any(|row| row.label == expected),
                "{text:?} did not suggest {expected}: {:?}",
                found.iter().map(|row| &row.label).collect::<Vec<_>>()
            );
            for row in found {
                let picked = match row.kind {
                    SuggestionKind::Map => ServerFilter {
                        maps: row.values.clone(),
                        ..filter.clone()
                    },
                    SuggestionKind::Mod => ServerFilter {
                        mod_ids: row.values.iter().filter_map(|id| id.parse().ok()).collect(),
                        mod_match: ModMatch::Any,
                        ..filter.clone()
                    },
                    SuggestionKind::Version => ServerFilter {
                        version: Some(row.values[0].clone()),
                        ..filter.clone()
                    },
                };
                assert_eq!(
                    reader.count(&picked).expect("count"),
                    row.count,
                    "suggestion {} for {text:?}",
                    row.label
                );
            }
        }
    }

    for my_version in ["1.29", "1.29.100", "1.28.50"] {
        let shown = reader
            .facets(&production, Some(my_version))
            .expect("facets")
            .same_as_mine;
        let picked = ServerFilter {
            version: Some(my_version.into()),
            ..production.clone()
        };
        assert_eq!(
            shown,
            Some(reader.count(&picked).expect("count")),
            "same as mine {my_version}"
        );
    }

    // Server-written labels are cut on the way out.
    let long = reader.facets(&production, None).expect("facets");
    for row in long.maps.iter().chain(&long.mods) {
        assert!(
            row.name.chars().count() <= 80,
            "label over 80 chars: {}",
            row.name
        );
    }
    let cut = "y".repeat(80);
    assert_eq!(values_of(&long.mods, &cut).len(), 1);

    let all = reader.facets(&empty, None).expect("facets");
    let wide = values_of(&all.mods, "Wide Mod");
    assert_eq!(wide.len(), 20, "a row carries 20 ids");
    assert!(wide.contains(&"1025".to_string()), "kept {wide:?}");
    assert_eq!(
        named(&all.mods)
            .iter()
            .find(|(n, _)| n == "Wide Mod")
            .unwrap()
            .1,
        2
    );

    let big = (u64::MAX - 5).to_string();
    assert_eq!(values_of(&all.mods, "Big Id Mod"), strings(&[&big]));

    // `_` is a LIKE wildcard: unescaped, `100%_` would also match `100xxReal`.
    let percent = reader.suggestions(&empty, "100%_").expect("suggestions");
    let labels: Vec<&str> = percent.iter().map(|row| row.label.as_str()).collect();
    assert_eq!(labels, ["100%_Real"]);
}

/// A word-start match past a full scan of mid-word matches still surfaces.
#[tokio::test]
async fn a_mod_suggestion_finds_word_starts_past_other_matches() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    writer
        .upsert_servers(vec![listed(
            key(1),
            "Alpha",
            "chernarusplus",
            Some("1.29.100"),
            "EU",
            1,
        )])
        .await
        .expect("servers");
    // Enough names containing "nam" mid-word, all sorting before the real
    // one, to fill any bounded prefilter that scans substrings.
    let filler: Vec<(String, u64)> = (0..600).map(|i| (format!("Anam{i}"), 1000 + i)).collect();
    let mut declared: Vec<(&str, u64)> = filler
        .iter()
        .map(|(name, id)| (name.as_str(), *id))
        .collect();
    declared.push(("Namalsk Survival", 30));
    writer
        .upsert_server_mods(key(1), mods(&declared))
        .await
        .expect("mods");

    let found = registry
        .reader()
        .expect("reader")
        .suggestions(&ServerFilter::default(), "nam")
        .expect("suggestions");
    assert!(
        found.iter().any(|row| row.label == "Namalsk Survival"),
        "word start crowded out: {:?}",
        found.iter().map(|row| &row.label).collect::<Vec<_>>()
    );
}

/// A word start is also anything after `-`, `_`, `[`, `(`, `.` or `/`.
#[tokio::test]
async fn a_mod_suggestion_finds_word_starts_after_punctuation() {
    let filler: Vec<(String, u64)> = (0..600).map(|i| (format!("Mudexp{i}"), 1000 + i)).collect();
    // Each label sorts after the filler, so only the separator test can keep it
    // inside the names read.
    for label in [
        "Zz-Expansion",
        "Zz_Expansion",
        "Zz[Expansion",
        "Zz(Expansion",
        "Zz.Expansion",
        "Zz/Expansion",
    ] {
        let registry = Registry::open_in_memory().expect("registry");
        let writer = registry.writer();
        writer
            .upsert_servers(vec![listed(
                key(1),
                "Alpha",
                "chernarusplus",
                Some("1.29.100"),
                "EU",
                1,
            )])
            .await
            .expect("servers");
        let mut declared: Vec<(&str, u64)> = filler
            .iter()
            .map(|(name, id)| (name.as_str(), *id))
            .collect();
        declared.push((label, 30));
        writer
            .upsert_server_mods(key(1), mods(&declared))
            .await
            .expect("mods");

        let found = registry
            .reader()
            .expect("reader")
            .suggestions(&ServerFilter::default(), "exp")
            .expect("suggestions");
        assert!(
            found.iter().any(|row| row.label == label),
            "{label} crowded out"
        );
    }
}

#[tokio::test]
async fn the_version_list_offers_the_current_build_and_the_one_before() {
    let registry = Registry::open_in_memory().expect("registry");
    let versions = [
        "1.30.164289",
        "1.30.164289",
        "1.30.164289",
        "1.30.164200",
        "1.30.164200",
        "1.29.163709",
        "2636",
        "2026.04.29",
        "2.22.154089",
        "1.64.164250",
        "1.64.164250",
    ];
    let rows = versions
        .iter()
        .enumerate()
        .map(|(n, v)| {
            listed(
                key(n as u8 + 1),
                "Server",
                "chernarusplus",
                Some(v),
                "EU",
                1,
            )
        })
        .collect();
    registry
        .writer()
        .upsert_servers(rows)
        .await
        .expect("servers");

    let facets = registry
        .reader()
        .expect("reader")
        .facets(&ServerFilter::default(), None)
        .expect("facets");

    assert_eq!(
        named(&facets.versions),
        pairs(&[("1.30.164289", 3), ("1.30.164200", 2)])
    );
}

#[tokio::test]
async fn a_tie_for_most_servers_offers_the_newer_build_as_current() {
    let registry = Registry::open_in_memory().expect("registry");
    let versions = [
        "1.29.163709",
        "1.29.163709",
        "1.30.164289",
        "1.30.164289",
        "1.4294967295.1",
    ];
    let rows = versions
        .iter()
        .enumerate()
        .map(|(n, v)| {
            listed(
                key(n as u8 + 1),
                "Server",
                "chernarusplus",
                Some(v),
                "EU",
                1,
            )
        })
        .collect();
    registry
        .writer()
        .upsert_servers(rows)
        .await
        .expect("servers");

    let facets = registry
        .reader()
        .expect("reader")
        .facets(&ServerFilter::default(), None)
        .expect("facets");

    assert_eq!(
        named(&facets.versions),
        pairs(&[("1.30.164289", 2), ("1.29.163709", 2)])
    );
}

fn pairs(items: &[(&str, usize)]) -> Vec<(String, usize)> {
    items
        .iter()
        .map(|&(name, count)| (name.to_string(), count))
        .collect()
}

fn named(rows: &[FacetCount]) -> Vec<(String, usize)> {
    rows.iter()
        .map(|row| (row.name.clone(), row.count))
        .collect()
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| item.to_string()).collect()
}

fn values_of<'a>(rows: &'a [FacetCount], name: &str) -> &'a [String] {
    &rows
        .iter()
        .find(|row| row.name == name)
        .unwrap_or_else(|| panic!("no row named {name}"))
        .values
}

#[tokio::test]
async fn every_list_counts_the_filter_without_its_own_part() {
    let registry = Registry::open_in_memory().expect("registry");
    seed(&registry).await;
    let reader = registry.reader().expect("reader");

    let facets = |filter: &ServerFilter| reader.facets(filter, None).expect("facets");
    let none = facets(&ServerFilter::default());

    assert_eq!(none.total, 8);
    assert_eq!(
        named(&none.maps),
        pairs(&[
            ("Chernarus", 3),
            ("Livonia", 2),
            ("Chernarus (Gloom)", 1),
            ("Deer Isle", 1),
            ("Namalsk", 1),
        ])
    );
    assert_eq!(
        values_of(&none.maps, "Livonia"),
        strings(&["enoch", "livonia"])
    );
    assert_eq!(
        named(&none.versions),
        pairs(&[("1.29.100", 5), ("1.28.50", 2)])
    );
    assert_eq!(
        named(&none.countries),
        pairs(&[("EU", 4), ("NA", 2), ("AS", 1), ("OC", 1)])
    );
    assert_eq!(
        named(&none.mods),
        pairs(&[
            ("Community Framework", 3),
            ("Expansion Core", 3),
            ("Namalsk Survival", 1),
        ])
    );
    assert_eq!(
        values_of(&none.mods, "Community Framework"),
        strings(&["2"])
    );
    assert_eq!(
        values_of(&none.mods, "Expansion Core"),
        strings(&["1", "11"])
    );
    assert_eq!(values_of(&none.mods, "Namalsk Survival"), strings(&["30"]));

    let by_map = ServerFilter {
        maps: vec!["chernarusplus".into()],
        ..Default::default()
    };
    let picked = facets(&by_map);
    assert_eq!(picked.total, 3);
    assert_eq!(named(&picked.maps), named(&none.maps));
    assert_eq!(
        named(&picked.versions),
        pairs(&[("1.29.100", 2), ("1.28.50", 1)])
    );
    assert_eq!(named(&picked.countries), pairs(&[("EU", 2), ("NA", 1)]));
    assert_eq!(
        named(&picked.mods),
        pairs(&[("Community Framework", 2), ("Expansion Core", 2)])
    );

    let by_version = ServerFilter {
        version: Some("1.28.50".into()),
        ..Default::default()
    };
    let versioned = facets(&by_version);
    assert_eq!(versioned.total, 2);
    assert_eq!(named(&versioned.versions), named(&none.versions));
    assert_eq!(
        named(&versioned.maps),
        pairs(&[("Chernarus", 1), ("Namalsk", 1)])
    );

    let by_country = ServerFilter {
        countries: vec!["NA".into()],
        ..Default::default()
    };
    let country = facets(&by_country);
    assert_eq!(country.total, 2);
    assert_eq!(named(&country.countries), named(&none.countries));
    assert_eq!(
        named(&country.maps),
        pairs(&[("Chernarus", 1), ("Livonia", 1)])
    );

    let by_mod = ServerFilter {
        mod_ids: vec![2],
        ..Default::default()
    };
    let modded = facets(&by_mod);
    assert_eq!(modded.total, 3);
    assert_eq!(named(&modded.mods), named(&none.mods));
    assert_eq!(
        named(&modded.maps),
        pairs(&[("Chernarus", 2), ("Deer Isle", 1)])
    );

    let by_map_with_players = ServerFilter {
        maps: vec!["chernarusplus".into()],
        hide_empty: true,
        ..Default::default()
    };
    let busy = facets(&by_map_with_players);
    assert_eq!(busy.total, 2);
    assert_eq!(
        named(&busy.maps),
        pairs(&[
            ("Chernarus", 2),
            ("Chernarus (Gloom)", 1),
            ("Deer Isle", 1),
            ("Livonia", 1),
            ("Namalsk", 1),
        ])
    );

    let by_name_search = ServerFilter {
        search: Some("alpha".into()),
        ..Default::default()
    };
    let alpha = facets(&by_name_search);
    assert_eq!(alpha.total, 1);
    assert_eq!(
        named(&alpha.mods),
        pairs(&[("Community Framework", 1), ("Expansion Core", 1)])
    );

    let by_mod_search = ServerFilter {
        search: Some("expansion".into()),
        ..Default::default()
    };
    let expansion = facets(&by_mod_search);
    assert_eq!(expansion.total, 3);
    assert_eq!(
        named(&expansion.mods),
        pairs(&[("Expansion Core", 3), ("Community Framework", 1)])
    );
    assert_eq!(
        named(&expansion.maps),
        pairs(&[("Chernarus", 2), ("Livonia", 1)])
    );

    let default_filter = ServerFilter::default();
    assert_eq!(none.same_as_mine, None);
    assert_eq!(
        reader
            .facets(&by_map, Some("1.29"))
            .expect("facets")
            .same_as_mine,
        Some(2)
    );
    assert_eq!(
        reader
            .facets(&default_filter, Some("1.29.100"))
            .expect("facets")
            .same_as_mine,
        Some(5)
    );
    assert_eq!(
        reader
            .facets(&default_filter, Some("a b"))
            .expect("facets")
            .same_as_mine,
        None
    );
}

fn suggestions_for(
    reader: &tetra_registry::Reader,
    filter: &ServerFilter,
    text: &str,
) -> Vec<Suggestion> {
    reader.suggestions(filter, text).expect("suggestions")
}

type Expected = (SuggestionKind, String, usize);

fn summaries(rows: &[Suggestion]) -> Vec<Expected> {
    rows.iter()
        .map(|row| (row.kind, row.label.clone(), row.count))
        .collect()
}

#[tokio::test]
async fn suggestions_complete_what_was_typed() {
    use SuggestionKind::{Map, Mod, Version};

    let registry = Registry::open_in_memory().expect("registry");
    seed(&registry).await;
    let reader = registry.reader().expect("reader");

    let vanilla = ServerFilter {
        modded: Some(false),
        ..Default::default()
    };
    let typed_search = ServerFilter {
        search: Some("nam".into()),
        ..Default::default()
    };
    let map_picked = ServerFilter {
        maps: vec!["namalsk".into()],
        ..Default::default()
    };
    let hide_empty = ServerFilter {
        hide_empty: true,
        ..Default::default()
    };

    let long_text = "a".repeat(200);
    let nam = [
        (Map, "Namalsk".to_string(), 1),
        (Mod, "Namalsk Survival".to_string(), 1),
    ];
    let cases: Vec<(ServerFilter, &str, Vec<Expected>)> = vec![
        (ServerFilter::default(), "nam", nam.to_vec()),
        (
            vanilla.clone(),
            "nam",
            vec![(Map, "Namalsk".to_string(), 1)],
        ),
        (typed_search, "nam", nam.to_vec()),
        (ServerFilter::default(), "NAM", nam.to_vec()),
        (ServerFilter::default(), "  nam  ", nam.to_vec()),
        (
            ServerFilter::default(),
            "isle",
            vec![(Map, "Deer Isle".to_string(), 1)],
        ),
        (
            ServerFilter::default(),
            "deer is",
            vec![(Map, "Deer Isle".to_string(), 1)],
        ),
        (ServerFilter::default(), "eer", vec![]),
        (
            ServerFilter::default(),
            "core",
            vec![(Mod, "Expansion Core".to_string(), 3)],
        ),
        (ServerFilter::default(), "ore", vec![]),
        (
            ServerFilter::default(),
            "co",
            vec![
                (Mod, "Community Framework".to_string(), 3),
                (Mod, "Expansion Core".to_string(), 3),
            ],
        ),
        (
            ServerFilter::default(),
            "chern",
            vec![
                (Map, "Chernarus".to_string(), 3),
                (Map, "Chernarus (Gloom)".to_string(), 1),
            ],
        ),
        (
            map_picked,
            "chern",
            vec![
                (Map, "Chernarus".to_string(), 3),
                (Map, "Chernarus (Gloom)".to_string(), 1),
            ],
        ),
        (
            ServerFilter::default(),
            "livonia",
            vec![(Map, "Livonia".to_string(), 2)],
        ),
        (hide_empty, "livonia", vec![(Map, "Livonia".to_string(), 1)]),
        (
            ServerFilter::default(),
            "1.2",
            vec![
                (Version, "1.29.100".to_string(), 5),
                (Version, "1.28.50".to_string(), 2),
            ],
        ),
        (
            ServerFilter::default(),
            "1.29",
            vec![(Version, "1.29.100".to_string(), 5)],
        ),
        (ServerFilter::default(), "29", vec![]),
        (ServerFilter::default(), "nam1", vec![]),
        (ServerFilter::default(), "c", vec![]),
        (ServerFilter::default(), "", vec![]),
        (ServerFilter::default(), "   ", vec![]),
        (ServerFilter::default(), "co%", vec![]),
        (ServerFilter::default(), "_o", vec![]),
        (ServerFilter::default(), long_text.as_str(), vec![]),
    ];
    for (filter, text, expected) in cases {
        assert_eq!(
            summaries(&suggestions_for(&reader, &filter, text)),
            expected,
            "text: {text:?}"
        );
    }

    let livonia = suggestions_for(&reader, &ServerFilter::default(), "livonia");
    assert_eq!(livonia[0].values, strings(&["enoch", "livonia"]));

    let capped = Registry::open_in_memory().expect("capped registry");
    let writer = capped.writer();
    let maps = ["zz One", "zz Two", "zz Three", "zz Four", "zz Five"];
    writer
        .upsert_servers(
            maps.iter()
                .enumerate()
                .map(|(i, map)| {
                    listed(
                        key(i as u8 + 20),
                        &format!("S{i}"),
                        map,
                        Some("7.1"),
                        "EU",
                        1,
                    )
                })
                .collect(),
        )
        .await
        .expect("capped servers");
    writer
        .upsert_server_mods(
            key(20),
            mods(&[
                ("qq Alpha", 1),
                ("qq Bravo", 2),
                ("qq Charlie", 3),
                ("qq Delta", 4),
                ("qq Echo", 5),
                ("qq Foxtrot", 6),
            ]),
        )
        .await
        .expect("capped mods");
    writer
        .upsert_servers(vec![
            listed(key(30), "V7.2", "zz One", Some("7.2"), "EU", 1),
            listed(key(31), "V7.3", "zz One", Some("7.3"), "EU", 1),
        ])
        .await
        .expect("more servers");

    let capped_reader = capped.reader().expect("reader");
    let nothing = ServerFilter::default();
    assert_eq!(suggestions_for(&capped_reader, &nothing, "zz").len(), 3);
    assert_eq!(suggestions_for(&capped_reader, &nothing, "qq").len(), 4);
    assert_eq!(suggestions_for(&capped_reader, &nothing, "7.").len(), 2);
}

fn timed<T>(label: &str, work: impl FnOnce() -> T) -> T {
    let started = std::time::Instant::now();
    let out = work();
    println!("{label}: {:?}", started.elapsed());
    out
}

#[tokio::test]
#[ignore = "slow: seeds ~27,000 servers with mods; run with --ignored --nocapture"]
async fn counting_the_lists_for_twenty_seven_thousand_servers() {
    const SERVERS: u32 = 27_000;
    const MODS_PER_SERVER: u32 = 15;
    const MOD_NAMES: u32 = 300;

    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();
    let maps = [
        "chernarusplus",
        "enoch",
        "livonia",
        "namalsk",
        "deerisle",
        "sakhal",
    ];
    let versions = ["1.29.100", "1.28.50", "1.27.30", "1.26.10"];
    let countries = ["EU", "NA", "AS", "OC", "SA"];
    let rows = (0..SERVERS)
        .map(|n| ServerRow {
            key: ServerKey {
                ip: std::net::Ipv4Addr::from(0xCB00_7100u32 + n),
                query_port: 27016,
            },
            name: format!("Server {n}"),
            map: maps[(n as usize) % maps.len()].into(),
            version: Some(versions[(n as usize / 3) % versions.len()].into()),
            country_code: Some(countries[(n as usize) % countries.len()].into()),
            players: (n % 60) as i32,
            max_players: 60,
            responded: true,
            ..Default::default()
        })
        .collect();
    writer.upsert_servers(rows).await.expect("servers");

    for n in 0..SERVERS {
        let mods: Vec<ServerMod> = (0..MODS_PER_SERVER)
            .map(|j| {
                let id = (n * 7 + j * 13) % MOD_NAMES + 1;
                ServerMod {
                    workshop_id: u64::from(id),
                    name: format!("Mod {id}"),
                    hash: None,
                }
            })
            .collect();
        writer
            .upsert_server_mods(
                ServerKey {
                    ip: std::net::Ipv4Addr::from(0xCB00_7100u32 + n),
                    query_port: 27016,
                },
                mods,
            )
            .await
            .expect("mods");
    }

    let reader = registry.reader().expect("reader");
    let default_filter = ServerFilter::default();
    let searched = ServerFilter {
        search: Some("chernarus".into()),
        ..Default::default()
    };

    let all = timed("facets, no filter", || {
        reader
            .facets(&default_filter, Some("1.29.100"))
            .expect("facets")
    });
    assert_eq!(all.total, SERVERS as usize);
    assert_eq!(
        all.maps.iter().map(|row| row.count).sum::<usize>(),
        SERVERS as usize
    );
    assert!((1..=2).contains(&all.versions.len()));
    assert_eq!(
        all.countries.iter().map(|row| row.count).sum::<usize>(),
        SERVERS as usize
    );
    let on_mine = (0..SERVERS)
        .filter(|n| versions[(*n as usize / 3) % versions.len()] == "1.29.100")
        .count();
    assert_eq!(all.same_as_mine, Some(on_mine));

    let found = timed("facets, search chernarus", || {
        reader.facets(&searched, None).expect("facets")
    });
    let on_chernarus = (0..SERVERS)
        .filter(|n| maps[(*n as usize) % maps.len()] == "chernarusplus")
        .count();
    assert_eq!(found.total, on_chernarus);

    let picked = ServerFilter {
        maps: vec!["chernarusplus".into(), "enoch".into()],
        hide_empty: true,
        ..Default::default()
    };
    let narrowed = timed("facets, two maps and hide_empty", || {
        reader.facets(&picked, None).expect("facets")
    });
    let two_maps_busy = (0..SERVERS)
        .filter(|n| {
            picked
                .maps
                .contains(&maps[(*n as usize) % maps.len()].to_string())
                && n % 60 != 0
        })
        .count();
    assert_eq!(narrowed.total, two_maps_busy);

    let suggested = timed("suggestions, nam", || {
        reader
            .suggestions(&default_filter, "nam")
            .expect("suggestions")
    });
    assert!(suggested.iter().any(|row| row.label == "Namalsk"));
}
