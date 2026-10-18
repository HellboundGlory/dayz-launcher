use std::net::Ipv4Addr;
use tetra_registry::ServerKey;

/// A server on the test network, on the default query port.
pub fn key(last_octet: u8) -> ServerKey {
    ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, last_octet),
        query_port: 27016,
    }
}
