use std::time::{SystemTime, UNIX_EPOCH};
use tetra_registry::rows::WorkshopCacheRow;
use tetra_registry::Registry;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

#[tokio::test]
async fn workshop_cache_fresh_and_stale_and_upsert() {
    let registry = Registry::open_in_memory().expect("open registry");
    let writer = registry.writer();
    let reader = registry.reader().expect("reader");

    let current = now();

    let fresh_item = WorkshopCacheRow {
        workshop_id: 1001,
        title: "Fresh Mod".into(),
        file_size: 50_000_000,
        preview_url: Some("https://example.com/fresh.jpg".into()),
        time_updated: (current - 3600) as u64,
        cached_at: current - 3600,
    };

    let stale_item = WorkshopCacheRow {
        workshop_id: 1002,
        title: "Stale Mod".into(),
        file_size: 10_000_000,
        preview_url: None,
        time_updated: (current - 100_000) as u64,
        cached_at: current - 100_000,
    };

    writer
        .upsert_workshop_cache(vec![fresh_item.clone(), stale_item.clone()])
        .await
        .expect("upsert");

    // Fresh items within max_age (86400s) are returned.
    let cached = reader
        .get_workshop_cache(&[1001, 1002], 86_400)
        .expect("get cache");
    assert_eq!(cached.len(), 1);
    assert_eq!(cached.get(&1001), Some(&fresh_item));
    // Items older than max_age are excluded.
    assert_eq!(cached.get(&1002), None);

    // Items older than max_age are included when window is wide enough.
    let all = reader
        .get_workshop_cache(&[1001, 1002], 200_000)
        .expect("get cache");
    assert_eq!(all.len(), 2);

    // Upserting overwrites existing records.
    let updated_item = WorkshopCacheRow {
        workshop_id: 1001,
        title: "Fresh Mod Updated".into(),
        file_size: 60_000_000,
        preview_url: Some("https://example.com/fresh_updated.jpg".into()),
        time_updated: current as u64,
        cached_at: current,
    };
    writer
        .upsert_workshop_cache(vec![updated_item.clone()])
        .await
        .expect("upsert overwrite");

    let updated_cache = reader
        .get_workshop_cache(&[1001], 86_400)
        .expect("get cache");
    assert_eq!(updated_cache.get(&1001), Some(&updated_item));
}

#[test]
fn workshop_cache_blocking_upsert() {
    let registry = Registry::open_in_memory().expect("open registry");
    let writer = registry.writer();
    let reader = registry.reader().expect("reader");

    let current = now();
    let item = WorkshopCacheRow {
        workshop_id: 2001,
        title: "Blocking Mod".into(),
        file_size: 12345,
        preview_url: None,
        time_updated: current as u64,
        cached_at: current,
    };

    writer
        .upsert_workshop_cache_blocking(vec![item.clone()])
        .expect("blocking upsert");

    let cached = reader.get_workshop_cache(&[2001], 60).expect("get cache");
    assert_eq!(cached.get(&2001), Some(&item));
}
