use thiserror::Error;

/// Eleven failure surfaces for the pre-launch mod gate (spec §5.6).
///
/// Every branch in the gate state machine that can refuse to start DayZ
/// produces a distinct variant here, so the UI can tell the user exactly
/// what went wrong and what action (if any) might fix it.
#[derive(Debug, Error)]
pub enum GateError {
    #[error("server at {0} did not respond to the launch-time A2S_RULES query")]
    ServerUnreachable(String),

    #[error("server at {0} refused the A2S_RULES query (challenge loop)")]
    RulesQueryRefused(String),

    #[error("server at {0} returned unreadable A2S_RULES")]
    RulesUnreadable(String),

    #[error("Steam is not running; it is required for mod verification")]
    SteamNotRunning,

    #[error("DayZ is not installed in the Steam library")]
    DayzNotInstalled,

    #[error("required mod '{0}' has been removed from the Steam Workshop")]
    ModRemoved(String),

    #[error("required mod '{0}' could not be resolved (not found on Workshop)")]
    ModUnresolvable(String),

    #[error("download of mod '{0}' has stalled (no progress for too long)")]
    DownloadStalled(String),

    #[error("not enough disk space for required mods")]
    InsufficientDiskSpace,

    #[error("mod '{name}' is outdated: server requires {required}, installed is {installed}")]
    VersionMismatch {
        name: String,
        required: String,
        installed: String,
    },

    #[error("Steam is in offline mode; mod sync requires an online connection")]
    SteamOffline,

    #[error("launch process error: {0}")]
    Launch(#[from] std::io::Error),
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("invalid dzsa:// URI: {0}")]
    InvalidUri(String),
    #[error("failed to access Windows registry: {0}")]
    Registry(#[from] std::io::Error),
}