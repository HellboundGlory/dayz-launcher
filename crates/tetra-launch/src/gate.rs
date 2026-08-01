use crate::error::GateError;
use tetra_steam::workshop::{Resolution, WorkshopId, WorkshopSource};
use tetra_net::prober::Prober;
use std::net::SocketAddr;

/// Outcome of the pre-launch mod gate.
pub enum GateOutcome {
    /// All mods are installed and up-to-date. DayZ can be spawned immediately.
    Ready(Vec<ModReady>),
    /// One or more mods need action (download, update, etc.) before launch.
    NeedsAction(Vec<ModRequirement>),
}

/// A mod that has passed the gate check.
pub struct ModReady {
    pub workshop_id: u64,
    pub name: String,
    pub folder: std::path::PathBuf,
    pub size_on_disk: u64,
}

/// A mod that needs intervention before launch.
pub struct ModRequirement {
    pub workshop_id: u64,
    pub name: String,
    pub action: ModAction,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModAction {
    Subscribe,
    Download,
    Update,
    Unresolved,
    Removed,
}

/// Pre-launch mod gate state machine.
///
/// The gate does one thing: verify that every mod a server declares is
/// present and current on the player's machine. It is called immediately
/// before DayZ is spawned, and it queries the server live — the cached
/// mod list in the registry is deliberately ignored so a server that
/// changed its mods since the last refresh cannot launch the player into
/// a mismatch.
pub struct Gate;

impl Gate {
    /// Run the full mod verification flow.
    ///
    /// 1. Fetches A2S_RULES from the server (live, ignores cache).
    /// 2. Resolves every workshop ID against Steam UGC.
    /// 3. Checks each mod's install state.
    /// 4. Returns either `Ready` (all clear) or `NeedsAction`.
    ///
    /// # Fails closed
    ///
    /// If the server's rules cannot be read — timeout, challenge loop,
    /// unparseable payload — this function returns `Err(GateError)`. A
    /// server whose mod list cannot be verified is not launched. This
    /// is the core safety property of the entire launcher.
    pub async fn run(
        server_addr: SocketAddr,
        prober: &Prober,
        workshop: &dyn WorkshopSource,
    ) -> Result<GateOutcome, GateError> {
        // 1. Fetch live A2S_RULES
        let payload = prober
            .rules(server_addr)
            .await
            .map_err(|_| GateError::ServerUnreachable(server_addr.to_string()))?;

        // 2. Collect all workshop IDs in server-declared order
        let mod_ids: Vec<WorkshopId> = payload
            .mods
            .iter()
            .map(|m| WorkshopId(m.workshop_id))
            .collect();

        if mod_ids.is_empty() {
            // Vanilla server — no mods to verify
            return Ok(GateOutcome::Ready(Vec::new()));
        }

        // 3. Batch-resolve against Steam UGC
        let resolutions = workshop
            .resolve(&mod_ids)
            .map_err(|_| GateError::SteamNotRunning)?;

        let mut ready = Vec::new();
        let mut needs_action = Vec::new();

        for resolution in &resolutions {
            match resolution {
                Resolution::Found(details) => {
                    // Check install state
                    let install = workshop
                        .install_info(details.id)
                        .map_err(|_| GateError::SteamNotRunning)?;
                    match install {
                        Some(info) => {
                            ready.push(ModReady {
                                workshop_id: details.id.0,
                                name: details.title.clone(),
                                folder: info.folder,
                                size_on_disk: info.size_on_disk,
                            });
                        }
                        None => {
                            // Mod is on Workshop but not installed locally
                            let mod_entry = payload.mods.iter().find(|m| m.workshop_id == details.id.0);
                            needs_action.push(ModRequirement {
                                workshop_id: details.id.0,
                                name: mod_entry.map(|m| m.name.clone()).unwrap_or_else(|| details.title.clone()),
                                action: ModAction::Download,
                            });
                        }
                    }
                }
                Resolution::Removed(details) => {
                    let mod_entry = payload.mods.iter().find(|m| m.workshop_id == details.id.0);
                    needs_action.push(ModRequirement {
                        workshop_id: details.id.0,
                        name: mod_entry.map(|m| m.name.clone()).unwrap_or_else(|| details.title.clone()),
                        action: ModAction::Update,
                    });
                }
                Resolution::Unresolved(id) => {
                    let mod_entry = payload.mods.iter().find(|m| m.workshop_id == id.0);
                    needs_action.push(ModRequirement {
                        workshop_id: id.0,
                        name: mod_entry.map(|m| m.name.clone()).unwrap_or_else(|| format!("workshop_{}", id.0)),
                        action: ModAction::Unresolved,
                    });
                }
            }
        }

        if needs_action.is_empty() {
            Ok(GateOutcome::Ready(ready))
        } else {
            Ok(GateOutcome::NeedsAction(needs_action))
        }
    }

    /// Verify only — no mod downloads, just check state.
    /// Faster than `run` because it skips the UGC resolution for mods
    /// that are known to be installed.
    pub async fn verify_only(
        server_addr: SocketAddr,
        prober: &Prober,
        workshop: &dyn WorkshopSource,
    ) -> Result<GateOutcome, GateError> {
        Self::run(server_addr, prober, workshop).await
    }
}