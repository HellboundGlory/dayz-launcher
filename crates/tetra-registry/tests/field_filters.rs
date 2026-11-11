//! The version, time-of-day and BattlEye filters, read off the columns the
//! probe wrote for them.

mod common;

use tetra_registry::{Registry, ServerFilter, ServerRow, SortDir, SortKey, TimeOfDay};

fn row(octet: u8, name: &str) -> ServerRow {
    ServerRow {
        key: common::key(octet),
        game_port: 2302,
        name: name.into(),
        map: "chernarusplus".into(),
        players: 10,
        max_players: 60,
        ping_ms: 30,
        responded: true,
        ..Default::default()
    }
}

fn names_where(registry: &Registry, filter: &ServerFilter) -> Vec<String> {
    registry
        .reader()
        .expect("reader")
        .page(filter, SortKey::Name, SortDir::Asc, 0, 50)
        .expect("page")
        .into_iter()
        .map(|r| r.name)
        .collect()
}

#[tokio::test]
async fn version_filter_matches_on_dotted_parts() {
    let registry = Registry::open_in_memory().expect("registry");
    registry
        .writer()
        .upsert_servers(vec![
            ServerRow {
                version: Some("1.29.161000".into()),
                ..row(1, "Full")
            },
            ServerRow {
                version: Some("1.29".into()),
                ..row(2, "Short")
            },
            ServerRow {
                version: Some("1.28.160555".into()),
                ..row(3, "Older")
            },
            row(4, "Unknown"),
        ])
        .await
        .expect("servers");

    let cases: &[(&str, &[&str])] = &[
        ("1.29.161000", &["Full", "Short"]),
        ("1.29", &["Full", "Short"]),
        ("1.2", &[]),
        ("1.28.160555", &["Older"]),
        ("1.29.999999", &["Short"]),
        ("1..2", &["Full", "Older", "Short", "Unknown"]),
        ("a b", &["Full", "Older", "Short", "Unknown"]),
        ("", &["Full", "Older", "Short", "Unknown"]),
        (
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            &["Full", "Older", "Short", "Unknown"],
        ),
        ("1.2%", &["Full", "Older", "Short", "Unknown"]),
    ];
    for (value, expected) in cases {
        let filter = ServerFilter {
            version: Some((*value).into()),
            ..Default::default()
        };
        assert_eq!(
            names_where(&registry, &filter),
            *expected,
            "version: {value}"
        );
    }
}

#[tokio::test]
async fn time_of_day_filter_uses_the_in_game_clock() {
    let registry = Registry::open_in_memory().expect("registry");
    let clocked = |octet: u8, name: &str, time: &str| ServerRow {
        keywords: Some(format!("mod,battleye,{time}")),
        ..row(octet, name)
    };
    registry
        .writer()
        .upsert_servers(vec![
            clocked(1, "Before Dawn", "05:30"),
            clocked(2, "Dawn", "06:00"),
            clocked(3, "Noon", "12:00"),
            clocked(4, "Dusk", "19:59"),
            clocked(5, "Nightfall", "20:00"),
            clocked(6, "Midnight", "00:00"),
            ServerRow {
                keywords: None,
                ..row(7, "Untimed")
            },
        ])
        .await
        .expect("servers");

    let day = ServerFilter {
        time_of_day: Some(TimeOfDay::Day),
        ..Default::default()
    };
    assert_eq!(names_where(&registry, &day), ["Dawn", "Dusk", "Noon"]);

    let night = ServerFilter {
        time_of_day: Some(TimeOfDay::Night),
        ..Default::default()
    };
    assert_eq!(
        names_where(&registry, &night),
        ["Before Dawn", "Midnight", "Nightfall"]
    );

    assert_eq!(names_where(&registry, &ServerFilter::default()).len(), 7);
}

#[tokio::test]
async fn battleye_filter_splits_on_the_keyword() {
    let registry = Registry::open_in_memory().expect("registry");
    registry
        .writer()
        .upsert_servers(vec![
            ServerRow {
                keywords: Some("battleye".into()),
                ..row(1, "Protected")
            },
            ServerRow {
                keywords: Some("mod".into()),
                ..row(2, "Open")
            },
        ])
        .await
        .expect("servers");

    let battleye_on = ServerFilter {
        battleye: Some(true),
        ..Default::default()
    };
    assert_eq!(names_where(&registry, &battleye_on), ["Protected"]);

    let battleye_off = ServerFilter {
        battleye: Some(false),
        ..Default::default()
    };
    assert_eq!(names_where(&registry, &battleye_off), ["Open"]);

    assert_eq!(
        names_where(&registry, &ServerFilter::default()),
        ["Open", "Protected"]
    );
}
