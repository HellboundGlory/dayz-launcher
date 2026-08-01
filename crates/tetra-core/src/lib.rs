#![forbid(unsafe_code)]

pub mod a2s;
pub mod classify;
pub mod error;
pub mod net;

pub use a2s::rules::RulePairs;
pub use error::{CoreError, PackedError, ParseError};

/// Absolute path to a committed test fixture.
///
/// Fixtures live at the workspace root so later crates can use the same
/// captures.
pub fn fixture_path(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/a2s")
        .join(name)
}