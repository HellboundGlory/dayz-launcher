//! CLI probe tool — query a single server and print what it answers.
//!
//! ```text
//! cargo run -p tetra-net --bin tetra-probe -- 127.0.0.1:2302 info
//! cargo run -p tetra-net --bin tetra-probe -- 127.0.0.1:2302 rules
//! ```
//!
//! Drives the same `tetra_net` transport the launcher uses, so results match
//! what the app sees.

use std::net::SocketAddr;
use std::process::ExitCode;
use std::time::Duration;
use tetra_net::{query_info, query_rules};

const TIMEOUT: Duration = Duration::from_secs(5);

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let (Some(target), Some(command)) = (args.get(1), args.get(2)) else {
        eprintln!("usage: tetra-probe <ip:port> <info|rules>");
        return ExitCode::FAILURE;
    };

    let addr: SocketAddr = match target.parse() {
        Ok(addr) => addr,
        Err(e) => {
            eprintln!("invalid address {target:?}: {e}");
            return ExitCode::FAILURE;
        }
    };

    let outcome = match command.as_str() {
        "info" => query_info(addr, TIMEOUT).await.map(|v| println!("{v:#?}")),
        "rules" => query_rules(addr, TIMEOUT).await.map(|v| println!("{v:#?}")),
        other => {
            eprintln!("unknown command {other:?}; expected `info` or `rules`");
            return ExitCode::FAILURE;
        }
    };

    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{command} query to {addr} failed: {e}");
            ExitCode::FAILURE
        }
    }
}
