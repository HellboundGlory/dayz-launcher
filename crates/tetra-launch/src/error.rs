use thiserror::Error;

/// Failure starting a child process.
///
/// This was `GateError`, an eleven-variant enum enumerating every way the
/// pre-launch mod gate could refuse to start DayZ (spec §5.6). Ten of those
/// variants were only ever constructed by `gate::Gate`, a design the launcher
/// never adopted — `commands::launch` runs the gate itself and reports blockers
/// as grouped, user-facing prose via `describe_blockers`. With `Gate` removed,
/// spawning is all this crate can still fail at, so the type says that and
/// nothing more.
#[derive(Debug, Error)]
pub enum SpawnError {
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
