//! CLI probe tool — query a single server and print what it answers.
//!
//! ```text
//! cargo run -p tetra-net --bin tetra-probe -- 127.0.0.1:2302 info
//! cargo run -p tetra-net --bin tetra-probe -- 127.0.0.1:2302 rules
//! ```
//!
//! Runs the same transport the launcher itself uses. It previously drove a
//! second, synchronous copy of the A2S request logic that lived in
//! `tetra_core::net`, and that copy had drifted: it never checked that split
//! fragments belonged to the request it had issued, and its reassembly loop
//! could block forever on a server that announced more fragments than it sent.
//! Debugging a server with a tool that parses differently from the app is worse
//! than having no tool, so the duplicate is gone and this drives `tetra_net`.

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

    // Reported rather than panicked on. An unreachable server is the ordinary
    // outcome of pointing this at something, not a bug in the tool, and the old
    // `.expect("query_info_raw failed")` buried the actual cause in a backtrace.
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
