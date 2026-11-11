use super::probe::{probe_info, probe_rules};
use super::{prober, registry_writer};
use crate::state::AppState;
use tauri::State;
use tetra_net::lan::{self, MAX_LAN_SERVERS};

/// Ask every network this PC is on for DayZ servers, then probe the ones that
/// answered so the list can show them like any other server. Returns the
/// `"ip:query_port"` addresses that answered, ready to go into the list filter.
#[tauri::command]
pub async fn scan_lan(
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<Vec<String>, String> {
    let found = lan::scan_lan()
        .await
        .map_err(|_| "Could not read the network interfaces".to_string())?;
    if found.is_empty() {
        return Ok(Vec::new());
    }

    let writer = registry_writer(&state).await?;
    let prober = prober(&state)?;
    let info = probe_info(&prober, found, &writer, &window, false).await;

    let addrs = info
        .rules_candidates
        .iter()
        .take(MAX_LAN_SERVERS)
        .map(|(key, _)| format!("{}:{}", key.ip, key.query_port))
        .collect();

    // Mod lists, so a LAN server is as ready to join as any other row.
    probe_rules(&prober, info.rules_candidates, &writer).await;

    Ok(addrs)
}
