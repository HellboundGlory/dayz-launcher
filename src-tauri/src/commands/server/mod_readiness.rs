use crate::state::AppState;
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::State;
use tetra_steam::workshop::ModState;

use super::{blocking_read, prober, reader, server_key};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ServerModReadiness {
    pub stale: bool,
    pub mods: Vec<ModReadinessEntry>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ModReadinessEntry {
    pub workshop_id: String,
    pub name: String,
    pub state: ModState,
    /// File size in bytes: None if already ready or unknown.
    pub size_bytes: Option<u64>,
    /// True if this size is an upper bound (ADR-0021: mod needs update).
    pub size_is_upper_bound: bool,
    pub preview_url: Option<String>,
    pub is_unique: bool,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct UniqueModsSummary {
    pub count: usize,
    pub total_size_bytes: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct UnsubscribeOutcome {
    pub count: usize,
    pub total_size_bytes: u64,
}

pub(crate) fn build_mod_readiness_entries(
    mods: Vec<tetra_core::a2s::dayz::ServerMod>,
    unique_ids: &HashSet<u64>,
    state_map: &HashMap<u64, ModState>,
    cache: &HashMap<u64, tetra_registry::rows::WorkshopCacheRow>,
    progress_map: &HashMap<u64, (u64, u64)>,
) -> Vec<ModReadinessEntry> {
    mods.into_iter()
        .map(|m| {
            let workshop_id_num = m.workshop_id;
            let workshop_id = workshop_id_num.to_string();
            let is_workshop = ModState::is_workshop_id(workshop_id_num);

            let state = if !is_workshop {
                ModState::NotOnWorkshop
            } else {
                state_map
                    .get(&workshop_id_num)
                    .copied()
                    .unwrap_or(ModState::NotSubscribed)
            };

            let cached = cache.get(&workshop_id_num);
            let cached_size = cached.map(|c| c.file_size).filter(|&size| size > 0);

            let (size_bytes, size_is_upper_bound) = match state {
                ModState::Ready => (None, false),
                ModState::NeedsUpdate => (cached_size, true),
                _ => (cached_size, false),
            };

            let preview_url = cached.and_then(|c| c.preview_url.clone());
            let is_unique = unique_ids.contains(&workshop_id_num);

            let (downloaded_bytes, total_bytes) = progress_map
                .get(&workshop_id_num)
                .map(|&(d, t)| (Some(d), Some(t)))
                .unwrap_or((None, None));

            ModReadinessEntry {
                workshop_id,
                name: m.name,
                state,
                size_bytes,
                size_is_upper_bound,
                preview_url,
                is_unique,
                downloaded_bytes,
                total_bytes,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn server_mod_readiness(
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
) -> Result<ServerModReadiness, String> {
    server_mod_readiness_impl(&state, addr, query_port).await
}

pub(crate) async fn server_mod_readiness_impl(
    state: &AppState,
    addr: String,
    query_port: u16,
) -> Result<ServerModReadiness, String> {
    let key = server_key(&addr, query_port)?;

    let (server_row, mods, unique_ids, initial_cache) = blocking_read(state, move |reader| {
        let server_row = reader.get(key).map_err(|e| e.to_string())?;
        let mods = reader.mods_for(key).map_err(|e| e.to_string())?;
        let unique_ids: HashSet<u64> = reader
            .unique_mods_for(key)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        let valid_ids: Vec<u64> = mods
            .iter()
            .map(|m| m.workshop_id)
            .filter(|&id| ModState::is_workshop_id(id))
            .collect();
        let cache = reader
            .get_workshop_cache(&valid_ids, 24 * 3600)
            .map_err(|e| e.to_string())?;
        Ok((server_row, mods, unique_ids, cache))
    })
    .await?;

    let stale = server_row.map(|s| !s.online).unwrap_or(true);

    let valid_ids: Vec<u64> = mods
        .iter()
        .map(|m| m.workshop_id)
        .filter(|&id| ModState::is_workshop_id(id))
        .collect();

    let steam = {
        let guard = state.steam.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(Arc::clone)
    };

    let (state_map, progress_map) = if let Some(ref steam_handle) = steam {
        let ids_states = valid_ids.clone();
        let handle_states = Arc::clone(steam_handle);
        let states_res =
            tokio::task::spawn_blocking(move || handle_states.mod_states(&ids_states)).await;
        let state_map: HashMap<u64, ModState> = match states_res {
            Ok(Ok(list)) => list.into_iter().collect(),
            _ => HashMap::new(),
        };

        let ids_prog = valid_ids.clone();
        let handle_prog = Arc::clone(steam_handle);
        let prog_res =
            tokio::task::spawn_blocking(move || handle_prog.download_progress(&ids_prog)).await;
        let progress_map: HashMap<u64, (u64, u64)> = match prog_res {
            Ok(Ok(list)) => list.into_iter().map(|(id, d, t)| (id, (d, t))).collect(),
            _ => HashMap::new(),
        };

        (state_map, progress_map)
    } else {
        (HashMap::new(), HashMap::new())
    };

    let cache = resolve_workshop_cache(state, &valid_ids, initial_cache).await?;

    let mod_entries =
        build_mod_readiness_entries(mods, &unique_ids, &state_map, &cache, &progress_map);

    Ok(ServerModReadiness {
        stale,
        mods: mod_entries,
    })
}

pub(crate) async fn resolve_workshop_cache(
    state: &AppState,
    valid_ids: &[u64],
    mut cache: HashMap<u64, tetra_registry::rows::WorkshopCacheRow>,
) -> Result<HashMap<u64, tetra_registry::rows::WorkshopCacheRow>, String> {
    let missing: Vec<u64> = valid_ids
        .iter()
        .copied()
        .filter(|id| !cache.contains_key(id))
        .collect();

    if !missing.is_empty() {
        let steam = {
            let guard = state.steam.lock().map_err(|e| e.to_string())?;
            guard.as_ref().map(Arc::clone)
        };
        if let Some(ref steam_handle) = steam {
            if let Ok(reader_fresh) = reader(state) {
                let writer_opt = {
                    let guard = state.registry.lock().map_err(|e| e.to_string())?;
                    guard.as_ref().map(|r| r.writer())
                };
                if let Some(writer) = writer_opt {
                    let handle = Arc::clone(steam_handle);
                    let missing_ids = missing.clone();
                    let fetched = tokio::task::spawn_blocking(move || {
                        handle.workshop_details_cached(&missing_ids, &reader_fresh, &writer)
                    })
                    .await;
                    if let Ok(Ok(rows)) = fetched {
                        for row in rows {
                            cache.insert(row.workshop_id, row);
                        }
                    }
                }
            }
        }
    }

    let still_missing: Vec<u64> = valid_ids
        .iter()
        .copied()
        .filter(|id| !cache.contains_key(id))
        .collect();
    if !still_missing.is_empty() {
        if let Ok(older) = blocking_read(state, move |reader| {
            reader
                .get_workshop_cache(&still_missing, u64::MAX)
                .map_err(|e| e.to_string())
        })
        .await
        {
            for (id, row) in older {
                cache.entry(id).or_insert(row);
            }
        }
    }

    Ok(cache)
}

#[tauri::command]
pub async fn check_server_mods(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
) -> Result<ServerModReadiness, String> {
    check_server_mods_impl(Some(&app), &state, addr, query_port).await
}

pub(crate) async fn check_server_mods_impl(
    // `None` in tests, which have no live `AppHandle` to log through.
    app: Option<&tauri::AppHandle>,
    state: &AppState,
    addr: String,
    query_port: u16,
) -> Result<ServerModReadiness, String> {
    let key = server_key(&addr, query_port)?;
    let query_addr = SocketAddr::from((key.ip, key.query_port));

    let prober = prober(state)?;

    let rules = prober.rules_unqueued(query_addr).await.map_err(|e| {
        if matches!(e, tetra_net::NetError::ExchangeTimedOut { .. }) {
            format!(
                "{query_addr} started answering but stopped responding \
                 part-way through its mod list. Try again in a moment."
            )
        } else {
            format!(
                "Could not read the mod list from {query_addr}. \
                 The server may be offline or behind a firewall."
            )
        }
    })?;
    let declared = rules.mods;

    let writer = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(|r| r.writer())
    };
    if let Some(writer) = writer {
        let log = |msg: String| {
            if let Some(app) = app {
                crate::log::log_line(app, "refresh", &msg);
            }
        };
        if let Err(e) = writer.upsert_server_mods(key, declared).await {
            log(format!(
                "check_server_mods: storing the mod list failed: {e}"
            ));
        }
        if let Err(e) = writer.set_online(vec![key], true).await {
            log(format!(
                "check_server_mods: marking the server online failed: {e}"
            ));
        }
    }

    let mut readiness = server_mod_readiness_impl(state, addr, query_port).await?;
    readiness.stale = false;
    Ok(readiness)
}

#[tauri::command]
pub async fn get_unique_mods_summary(
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
) -> Result<UniqueModsSummary, String> {
    get_unique_mods_summary_impl(&state, addr, query_port).await
}

pub(crate) async fn get_unique_mods_summary_impl(
    state: &AppState,
    addr: String,
    query_port: u16,
) -> Result<UniqueModsSummary, String> {
    let key = server_key(&addr, query_port)?;
    let (unique_mods, initial_cache) = blocking_read(state, move |reader| {
        let unique_mods = reader.unique_mods_for(key).map_err(|e| e.to_string())?;
        let valid_ids: Vec<u64> = unique_mods
            .iter()
            .map(|(id, _)| *id)
            .filter(|&id| ModState::is_workshop_id(id))
            .collect();
        let cache = reader
            .get_workshop_cache(&valid_ids, 24 * 3600)
            .map_err(|e| e.to_string())?;
        Ok((unique_mods, cache))
    })
    .await?;

    let valid_ids: Vec<u64> = unique_mods
        .iter()
        .map(|(id, _)| *id)
        .filter(|&id| ModState::is_workshop_id(id))
        .collect();

    let cache = resolve_workshop_cache(state, &valid_ids, initial_cache).await?;

    let count = unique_mods.len();
    let total_size_bytes: u64 = valid_ids
        .iter()
        .filter_map(|id| cache.get(id).map(|c| c.file_size))
        .sum();

    Ok(UniqueModsSummary {
        count,
        total_size_bytes,
    })
}

#[tauri::command]
pub async fn unsubscribe_unique_mods(
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
) -> Result<UnsubscribeOutcome, String> {
    unsubscribe_unique_mods_impl(&state, addr, query_port).await
}

pub(crate) async fn unsubscribe_unique_mods_impl(
    state: &AppState,
    addr: String,
    query_port: u16,
) -> Result<UnsubscribeOutcome, String> {
    let key = server_key(&addr, query_port)?;
    let (unique_mods, initial_cache) = blocking_read(state, move |reader| {
        let unique_mods = reader.unique_mods_for(key).map_err(|e| e.to_string())?;
        let valid_ids: Vec<u64> = unique_mods
            .iter()
            .map(|(id, _)| *id)
            .filter(|&id| ModState::is_workshop_id(id))
            .collect();
        let cache = reader
            .get_workshop_cache(&valid_ids, 24 * 3600)
            .map_err(|e| e.to_string())?;
        Ok((unique_mods, cache))
    })
    .await?;

    let valid_ids: Vec<u64> = unique_mods
        .iter()
        .map(|(id, _)| *id)
        .filter(|&id| ModState::is_workshop_id(id))
        .collect();

    if valid_ids.is_empty() {
        return Ok(UnsubscribeOutcome {
            count: 0,
            total_size_bytes: 0,
        });
    }

    let cache = resolve_workshop_cache(state, &valid_ids, initial_cache).await?;

    let steam = {
        let guard = state.steam.lock().map_err(|e| e.to_string())?;
        Arc::clone(
            guard
                .as_ref()
                .ok_or("Steam is not connected. Start Steam and restart the launcher.")?,
        )
    };

    let ids_to_unsub = valid_ids.clone();
    let results = tokio::task::spawn_blocking(move || steam.unsubscribe_all(&ids_to_unsub))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|e| format!("Steam request failed: {e}"))?;

    let succeeded_ids: Vec<u64> = results
        .into_iter()
        .filter(|r| r.error.is_none())
        .map(|r| r.workshop_id)
        .collect();

    let total_size_bytes: u64 = succeeded_ids
        .iter()
        .filter_map(|id| cache.get(id).map(|c| c.file_size))
        .sum();

    Ok(UnsubscribeOutcome {
        count: succeeded_ids.len(),
        total_size_bytes,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_mod_readiness_mixed_states_mapping() {
        use std::collections::{HashMap, HashSet};
        use tetra_core::a2s::dayz::ServerMod;
        use tetra_registry::rows::WorkshopCacheRow;
        use tetra_steam::workshop::ModState;

        let mods = vec![
            ServerMod {
                workshop_id: 100,
                name: "Ready Mod".into(),
            },
            ServerMod {
                workshop_id: 200,
                name: "Not Installed Mod".into(),
            },
            ServerMod {
                workshop_id: 300,
                name: "Needs Update Mod".into(),
            },
            ServerMod {
                workshop_id: 400,
                name: "Downloading Mod".into(),
            },
            ServerMod {
                workshop_id: 0,
                name: "Server Mod".into(),
            },
        ];

        let mut unique_ids = HashSet::new();
        unique_ids.insert(200);

        let mut state_map = HashMap::new();
        state_map.insert(100, ModState::Ready);
        state_map.insert(200, ModState::NotInstalled);
        state_map.insert(300, ModState::NeedsUpdate);
        state_map.insert(400, ModState::Downloading);

        let mut cache = HashMap::new();
        cache.insert(
            100,
            WorkshopCacheRow {
                workshop_id: 100,
                title: "Ready Mod".into(),
                file_size: 50_000_000,
                preview_url: Some("https://example.com/100.png".into()),
                time_updated: 1000,
                cached_at: 1000,
            },
        );
        cache.insert(
            200,
            WorkshopCacheRow {
                workshop_id: 200,
                title: "Not Installed Mod".into(),
                file_size: 100_000_000,
                preview_url: None,
                time_updated: 1000,
                cached_at: 1000,
            },
        );
        cache.insert(
            300,
            WorkshopCacheRow {
                workshop_id: 300,
                title: "Needs Update Mod".into(),
                file_size: 150_000_000,
                preview_url: None,
                time_updated: 1000,
                cached_at: 1000,
            },
        );
        cache.insert(
            400,
            WorkshopCacheRow {
                workshop_id: 400,
                title: "Downloading Mod".into(),
                file_size: 80_000_000,
                preview_url: None,
                time_updated: 1000,
                cached_at: 1000,
            },
        );

        let mut progress_map = HashMap::new();
        progress_map.insert(400, (20_000_000, 80_000_000));

        let entries = super::build_mod_readiness_entries(
            mods,
            &unique_ids,
            &state_map,
            &cache,
            &progress_map,
        );

        assert_eq!(entries.len(), 5);

        // Ready: size_bytes is None, size_is_upper_bound is false
        let e100 = &entries[0];
        assert_eq!(e100.workshop_id, "100");
        assert_eq!(e100.state, ModState::Ready);
        assert_eq!(e100.size_bytes, None);
        assert!(!e100.size_is_upper_bound);
        assert_eq!(e100.preview_url, Some("https://example.com/100.png".into()));
        assert!(!e100.is_unique);

        // NotInstalled: full size, size_is_upper_bound is false
        let e200 = &entries[1];
        assert_eq!(e200.workshop_id, "200");
        assert_eq!(e200.state, ModState::NotInstalled);
        assert_eq!(e200.size_bytes, Some(100_000_000));
        assert!(!e200.size_is_upper_bound);
        assert!(e200.is_unique);

        // NeedsUpdate: upper bound size, size_is_upper_bound is true
        let e300 = &entries[2];
        assert_eq!(e300.workshop_id, "300");
        assert_eq!(e300.state, ModState::NeedsUpdate);
        assert_eq!(e300.size_bytes, Some(150_000_000));
        assert!(e300.size_is_upper_bound);

        // Downloading: live progress present
        let e400 = &entries[3];
        assert_eq!(e400.workshop_id, "400");
        assert_eq!(e400.state, ModState::Downloading);
        assert_eq!(e400.size_bytes, Some(80_000_000));
        assert_eq!(e400.downloaded_bytes, Some(20_000_000));
        assert_eq!(e400.total_bytes, Some(80_000_000));

        // Non-workshop (id 0)
        let e0 = &entries[4];
        assert_eq!(e0.workshop_id, "0");
        assert_eq!(e0.state, ModState::NotOnWorkshop);
        assert_eq!(e0.size_bytes, None);
        assert!(!e0.size_is_upper_bound);
    }

    #[test]
    fn test_mod_readiness_missing_sizes_reported_as_none() {
        use std::collections::{HashMap, HashSet};
        use tetra_core::a2s::dayz::ServerMod;
        use tetra_registry::rows::WorkshopCacheRow;
        use tetra_steam::workshop::ModState;

        let mods = vec![
            ServerMod {
                workshop_id: 100,
                name: "Uncached Mod".into(),
            },
            ServerMod {
                workshop_id: 200,
                name: "Zero Size Update Mod".into(),
            },
            ServerMod {
                workshop_id: 300,
                name: "Zero Size Not Installed Mod".into(),
            },
        ];

        let unique_ids = HashSet::new();
        let mut state_map = HashMap::new();
        state_map.insert(100, ModState::NotInstalled);
        state_map.insert(200, ModState::NeedsUpdate);
        state_map.insert(300, ModState::NotInstalled);

        let mut cache = HashMap::new();
        cache.insert(
            200,
            WorkshopCacheRow {
                workshop_id: 200,
                title: "Zero Size Update Mod".into(),
                file_size: 0,
                preview_url: None,
                time_updated: 1000,
                cached_at: 1000,
            },
        );
        cache.insert(
            300,
            WorkshopCacheRow {
                workshop_id: 300,
                title: "Zero Size Not Installed Mod".into(),
                file_size: 0,
                preview_url: None,
                time_updated: 1000,
                cached_at: 1000,
            },
        );

        let progress_map = HashMap::new();
        let entries = super::build_mod_readiness_entries(
            mods,
            &unique_ids,
            &state_map,
            &cache,
            &progress_map,
        );

        assert_eq!(entries[0].size_bytes, None);
        assert!(!entries[0].size_is_upper_bound);

        assert_eq!(entries[1].size_bytes, None);
        assert!(entries[1].size_is_upper_bound);

        assert_eq!(entries[2].size_bytes, None);
        assert!(!entries[2].size_is_upper_bound);
    }

    #[tokio::test]
    async fn test_offline_server_results_in_stale_true() {
        use std::net::Ipv4Addr;
        use tetra_registry::{Registry, ServerKey, ServerRow};

        let registry = Registry::open_in_memory().expect("open registry");
        let writer = registry.writer();

        let online_key = ServerKey {
            ip: Ipv4Addr::new(192, 0, 2, 1),
            query_port: 27016,
        };
        let offline_key = ServerKey {
            ip: Ipv4Addr::new(192, 0, 2, 2),
            query_port: 27016,
        };

        writer
            .upsert_servers(vec![
                ServerRow {
                    key: online_key,
                    name: "Online Server".into(),
                    responded: true,
                    ..Default::default()
                },
                ServerRow {
                    key: offline_key,
                    name: "Offline Server".into(),
                    responded: false,
                    ..Default::default()
                },
            ])
            .await
            .expect("upsert servers");
        writer
            .set_online(vec![offline_key], false)
            .await
            .expect("set offline");

        let app_state = crate::state::AppState::new();
        *app_state.registry.lock().unwrap() = Some(registry);

        let res_online = super::server_mod_readiness_impl(&app_state, "192.0.2.1".into(), 27016)
            .await
            .expect("readiness online");
        assert!(!res_online.stale);

        let res_offline = super::server_mod_readiness_impl(&app_state, "192.0.2.2".into(), 27016)
            .await
            .expect("readiness offline");
        assert!(res_offline.stale);

        let res_unknown = super::server_mod_readiness_impl(&app_state, "192.0.2.99".into(), 27016)
            .await
            .expect("readiness unknown");
        assert!(res_unknown.stale);
    }

    #[tokio::test]
    async fn test_uniqueness_flag_matches_unique_mods_for() {
        use std::net::Ipv4Addr;
        use tetra_core::a2s::dayz::ServerMod;
        use tetra_registry::{Registry, ServerKey, ServerRow};

        let registry = Registry::open_in_memory().expect("open registry");
        let writer = registry.writer();

        let cared_key = ServerKey {
            ip: Ipv4Addr::new(198, 51, 100, 1),
            query_port: 27016,
        };
        let target_key = ServerKey {
            ip: Ipv4Addr::new(198, 51, 100, 2),
            query_port: 27016,
        };

        writer
            .upsert_servers(vec![
                ServerRow {
                    key: cared_key,
                    name: "Cared Favourite Server".into(),
                    responded: true,
                    ..Default::default()
                },
                ServerRow {
                    key: target_key,
                    name: "Target Server".into(),
                    responded: true,
                    ..Default::default()
                },
            ])
            .await
            .expect("upsert servers");

        writer
            .set_favourite(cared_key, true)
            .await
            .expect("set favourite");

        writer
            .upsert_server_mods(
                cared_key,
                vec![ServerMod {
                    workshop_id: 1001,
                    name: "Shared Mod".into(),
                }],
            )
            .await
            .expect("upsert cared mods");

        writer
            .upsert_server_mods(
                target_key,
                vec![
                    ServerMod {
                        workshop_id: 1001,
                        name: "Shared Mod".into(),
                    },
                    ServerMod {
                        workshop_id: 2002,
                        name: "Unique Mod".into(),
                    },
                ],
            )
            .await
            .expect("upsert target mods");

        let app_state = crate::state::AppState::new();
        *app_state.registry.lock().unwrap() = Some(registry);

        let res = super::server_mod_readiness_impl(&app_state, "198.51.100.2".into(), 27016)
            .await
            .expect("readiness");

        let mod1 = res.mods.iter().find(|m| m.workshop_id == "1001").unwrap();
        let mod2 = res.mods.iter().find(|m| m.workshop_id == "2002").unwrap();

        assert!(
            !mod1.is_unique,
            "mod 1001 is on a favourite server, not unique"
        );
        assert!(mod2.is_unique, "mod 2002 is unique to target server");
    }

    fn make_dayz_rules_packet(mods: &[(u64, &str)]) -> Vec<u8> {
        let mut packed = vec![
            0x02, // protocol
            0x00,
            0x00,
            0x00,             // flags
            mods.len() as u8, // mod_count
        ];
        for (wid, name) in mods {
            packed.extend_from_slice(&[0x11, 0x22, 0x33, 0x44]);
            let id_u32 = *wid as u32;
            packed.push(4);
            packed.extend_from_slice(&id_u32.to_le_bytes());
            packed.push(name.len() as u8);
            packed.extend_from_slice(name.as_bytes());
        }
        packed.push(0);
        packed.push(0);

        let mut escaped = Vec::new();
        for b in packed {
            match b {
                0x00 => escaped.extend_from_slice(&[0x01, 0x02]),
                0x01 => escaped.extend_from_slice(&[0x01, 0x01]),
                0xff => escaped.extend_from_slice(&[0x01, 0x03]),
                other => escaped.push(other),
            }
        }

        let mut packet = vec![0xff, 0xff, 0xff, 0xff, 0x45];
        packet.extend_from_slice(&1u16.to_le_bytes());
        packet.extend_from_slice(&[1, 1, 0]);
        packet.extend_from_slice(&escaped);
        packet.push(0);
        packet
    }

    #[tokio::test]
    async fn test_check_server_mods_updates_registry_and_queues_zero_downloads() {
        use std::net::Ipv4Addr;
        use std::sync::Arc;
        use tetra_core::a2s::dayz::ServerMod;
        use tetra_registry::{Registry, ServerKey, ServerRow};
        use tetra_steam::{Command, SteamHandle};
        use tokio::net::UdpSocket;

        let server_sock = UdpSocket::bind("127.0.0.1:0")
            .await
            .expect("bind server socket");
        let server_addr = server_sock.local_addr().expect("local addr");

        let packet = make_dayz_rules_packet(&[(2002, "New Updated Mod")]);
        let server_task = tokio::spawn(async move {
            let mut buf = [0u8; 1024];
            if let Ok((_len, client_addr)) = server_sock.recv_from(&mut buf).await {
                let _ = server_sock.send_to(&packet, client_addr).await;
            }
        });

        let registry = Registry::open_in_memory().expect("open registry");
        let writer = registry.writer();

        let key = ServerKey {
            ip: match server_addr.ip() {
                std::net::IpAddr::V4(ip) => ip,
                _ => Ipv4Addr::new(127, 0, 0, 1),
            },
            query_port: server_addr.port(),
        };

        writer
            .upsert_servers(vec![ServerRow {
                key,
                name: "Test Server".into(),
                responded: true,
                ..Default::default()
            }])
            .await
            .expect("upsert server");

        writer
            .upsert_server_mods(
                key,
                vec![ServerMod {
                    workshop_id: 1001,
                    name: "Old Mod".into(),
                }],
            )
            .await
            .expect("upsert old mod");

        let reader = registry.reader().expect("reader");

        let app_state = crate::state::AppState::new();
        *app_state.registry.lock().unwrap() = Some(registry);

        let prober = tetra_net::Prober::new(tetra_net::ProbeConfig {
            max_in_flight: 4,
            timeout: std::time::Duration::from_secs(2),
            ..Default::default()
        });
        *app_state.prober.lock().unwrap() = Some(prober);

        let (tx, rx) = std::sync::mpsc::channel();
        let steam_handle = SteamHandle::new_mock(tx);
        *app_state.steam.lock().unwrap() = Some(Arc::new(steam_handle));

        let mock_thread = std::thread::spawn(move || {
            while let Ok(cmd) = rx.recv() {
                match cmd {
                    Command::UGCItemStates(ids, ack) => {
                        let res = ids.into_iter().map(|id| (id, 0u32)).collect();
                        let _ = ack.send(Ok(res));
                    }
                    Command::UGCDownloadInfo(_ids, ack) => {
                        let _ = ack.send(Ok(Vec::new()));
                    }
                    Command::UGCRefreshStale(..) | Command::UGCSubscribe(..) => {
                        panic!("check_server_mods must queue 0 downloads");
                    }
                    _ => {}
                }
            }
        });

        let res =
            super::check_server_mods_impl(None, &app_state, key.ip.to_string(), key.query_port)
                .await
                .expect("check_server_mods");

        assert!(!res.stale);
        assert_eq!(res.mods.len(), 1);
        assert_eq!(res.mods[0].workshop_id, "2002");
        assert_eq!(res.mods[0].name, "New Updated Mod");

        let current_mods = reader.mods_for(key).expect("mods");
        assert_eq!(current_mods.len(), 1);
        assert_eq!(current_mods[0].workshop_id, 2002);

        drop(app_state);
        let _ = mock_thread.join();

        server_task.abort();
    }

    /// The confirmation dialog's figures and the unsubscribe must agree on
    /// which mods are unique, and a shared mod must never be unsubscribed.
    #[tokio::test]
    async fn test_unique_mods_confirmation_figures_match_unique_rows() {
        use std::net::Ipv4Addr;
        use std::sync::Arc;
        use tetra_core::a2s::dayz::ServerMod;
        use tetra_registry::rows::WorkshopCacheRow;
        use tetra_registry::{Registry, ServerKey, ServerRow};
        use tetra_steam::{Command, MutationResult, SteamHandle};

        let registry = Registry::open_in_memory().expect("open registry");
        let writer = registry.writer();

        let fav_key = ServerKey {
            ip: Ipv4Addr::new(198, 51, 100, 30),
            query_port: 27016,
        };
        let target_key = ServerKey {
            ip: Ipv4Addr::new(198, 51, 100, 40),
            query_port: 27016,
        };

        writer
            .upsert_servers(vec![
                ServerRow {
                    key: fav_key,
                    name: "Fav Server".into(),
                    responded: true,
                    ..Default::default()
                },
                ServerRow {
                    key: target_key,
                    name: "Target Server".into(),
                    responded: true,
                    ..Default::default()
                },
            ])
            .await
            .expect("upsert servers");

        writer
            .set_favourite(fav_key, true)
            .await
            .expect("set favourite");

        writer
            .upsert_server_mods(
                fav_key,
                vec![ServerMod {
                    workshop_id: 103,
                    name: "Shared Mod 103".into(),
                }],
            )
            .await
            .expect("upsert fav mods");

        writer
            .upsert_server_mods(
                target_key,
                vec![
                    ServerMod {
                        workshop_id: 101,
                        name: "Unique Mod 101".into(),
                    },
                    ServerMod {
                        workshop_id: 102,
                        name: "Unique Mod 102".into(),
                    },
                    ServerMod {
                        workshop_id: 103,
                        name: "Shared Mod 103".into(),
                    },
                ],
            )
            .await
            .expect("upsert target mods");

        let now = crate::unix_now() as u64;

        writer
            .upsert_workshop_cache(vec![
                WorkshopCacheRow {
                    workshop_id: 101,
                    title: "Unique Mod 101".into(),
                    file_size: 50_000_000,
                    preview_url: None,
                    time_updated: now,
                    cached_at: now as i64,
                },
                WorkshopCacheRow {
                    workshop_id: 102,
                    title: "Unique Mod 102".into(),
                    file_size: 75_000_000,
                    preview_url: None,
                    time_updated: now,
                    cached_at: now as i64,
                },
                WorkshopCacheRow {
                    workshop_id: 103,
                    title: "Shared Mod 103".into(),
                    file_size: 100_000_000,
                    preview_url: None,
                    time_updated: now,
                    cached_at: now as i64,
                },
            ])
            .await
            .expect("upsert cache");

        let app_state = crate::state::AppState::new();
        *app_state.registry.lock().unwrap() = Some(registry);

        let (tx, rx) = std::sync::mpsc::channel();
        let steam_handle = SteamHandle::new_mock(tx);
        *app_state.steam.lock().unwrap() = Some(Arc::new(steam_handle));

        std::thread::spawn(move || {
            while let Ok(cmd) = rx.recv() {
                match cmd {
                    Command::UGCUnsubscribe(ids, ack) => {
                        assert_eq!(ids.len(), 2, "only the unique mods: {ids:?}");
                        assert!(ids.contains(&101) && ids.contains(&102), "{ids:?}");
                        assert!(!ids.contains(&103), "the shared mod must not be touched");
                        let res = ids
                            .into_iter()
                            .map(|id| MutationResult {
                                workshop_id: id,
                                error: None,
                            })
                            .collect();
                        let _ = ack.send(Ok(res));
                    }
                    Command::UGCQueryDetails(_ids, ack) => {
                        let _ = ack.send(Ok(Vec::new()));
                    }
                    _ => {}
                }
            }
        });

        let summary =
            super::get_unique_mods_summary_impl(&app_state, "198.51.100.40".into(), 27016)
                .await
                .expect("summary");

        assert_eq!(summary.count, 2, "2 unique mods (101 and 102)");
        assert_eq!(
            summary.total_size_bytes, 125_000_000,
            "50MB + 75MB = 125MB for unique mods"
        );

        let outcome =
            super::unsubscribe_unique_mods_impl(&app_state, "198.51.100.40".into(), 27016)
                .await
                .expect("outcome");

        assert_eq!(outcome.count, summary.count);
        assert_eq!(outcome.total_size_bytes, summary.total_size_bytes);
    }
}
