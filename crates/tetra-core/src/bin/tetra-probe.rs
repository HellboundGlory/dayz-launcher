//! CLI probe tool — query a single server and print what it answers.
//!
//! ```text
//! cargo run --example tetra-probe -- 127.0.0.1:2302 info
//! cargo run --example tetra-probe -- 127.0.0.1:2302 rules
//! ```

use std::net::SocketAddr;
use std::time::Duration;
use tetra_core::a2s::dayz::parse_dayz_rules;
use tetra_core::a2s::info::parse_info;
use tetra_core::net::{query_info_raw, query_rules_raw};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: tetra-probe <ip:port> <info|rules>");
        std::process::exit(1);
    }

    let addr: SocketAddr = args[1].parse().expect("invalid address");
    let timeout = Duration::from_secs(5);

    match args[2].as_str() {
        "info" => {
            let raw = query_info_raw(addr, timeout).expect("query_info_raw failed");
            let info = parse_info(&raw).expect("parse_info failed");
            println!("{info:#?}");
        }
        "rules" => {
            let raw = query_rules_raw(addr, timeout).expect("query_rules_raw failed");
            let payload = parse_dayz_rules(&raw).expect("parse_dayz_rules failed");
            println!("{payload:#?}");
        }
        other => {
            eprintln!("unknown command: {other}");
            std::process::exit(1);
        }
    }
}