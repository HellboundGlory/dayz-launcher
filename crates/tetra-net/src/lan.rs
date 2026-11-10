//! Finding the DayZ servers on the networks this PC is attached to.
//!
//! The scan sends an A2S_INFO request as a broadcast to every broadcast
//! address of this PC's own subnets and listens for answers. Only a reply from
//! a private, link-local or loopback address is accepted — that check is the
//! trust boundary, since anyone on the network can answer a broadcast.

use crate::error::NetError;
use crate::query::{A2S_INFO, HEADER, INFO_PAYLOAD};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;
use tokio::net::UdpSocket;

/// Most servers one scan reports; a chatty network must not fill the list.
pub const MAX_LAN_SERVERS: usize = 64;

/// Most subnet broadcasts one scan sends to. A PC with more interfaces than
/// this is not one whose answers a player wants.
const MAX_TARGETS: usize = 16;

/// Datagrams one socket reads before it stops listening, so a peer that keeps
/// answering cannot hold the scan open.
const MAX_DATAGRAMS: usize = 256;

/// The query ports a DayZ server on a local network is likely to listen on.
/// 27016 is Steam's default query port and its neighbours cover several
/// servers on one PC; 2303-2310 is the game port + 1 convention for the
/// default 2302-2309 range.
pub const LAN_PORTS: [u16; 14] = [
    27015, 27016, 27017, 27018, 27019, 27020, 2303, 2304, 2305, 2306, 2307, 2308, 2309, 2310,
];

/// One IPv4 address of this PC, as much of it as the scan needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LanInterface {
    pub ip: Ipv4Addr,
    pub broadcast: Option<Ipv4Addr>,
    pub prefix_len: u8,
    pub up: bool,
    pub loopback: bool,
    pub point_to_point: bool,
}

/// One subnet's broadcast: the local address to send from, and where to send.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LanTarget {
    pub local: Ipv4Addr,
    pub dest: Ipv4Addr,
}

/// This PC's IPv4 addresses. The only untested part of the scan — everything
/// else works on [`LanInterface`], which a test can build.
pub fn local_interfaces() -> std::io::Result<Vec<LanInterface>> {
    Ok(if_addrs::get_if_addrs()?
        .into_iter()
        .filter_map(|interface| match &interface.addr {
            if_addrs::IfAddr::V4(v4) => Some(LanInterface {
                ip: v4.ip,
                broadcast: v4.broadcast,
                prefix_len: v4.prefixlen,
                up: interface.is_oper_up(),
                loopback: interface.is_loopback(),
                point_to_point: interface.is_p2p(),
            }),
            if_addrs::IfAddr::V6(_) => None,
        })
        .collect())
}

/// The broadcast address of every interface worth scanning. An interface is
/// skipped when it cannot carry a broadcast, and when its own address is
/// public: a broadcast must never leave the local network.
pub fn broadcast_targets(interfaces: &[LanInterface]) -> Vec<LanTarget> {
    interfaces
        .iter()
        .filter(|i| {
            i.up && !i.loopback
                && !i.point_to_point
                && i.broadcast.is_some()
                && i.prefix_len <= 30
                && (i.ip.is_private() || i.ip.is_link_local())
        })
        .take(MAX_TARGETS)
        // Worked out from the prefix: Windows can report the host address as
        // the broadcast when a host route is listed first.
        .map(|i| LanTarget {
            local: i.ip,
            dest: Ipv4Addr::from(u32::from(i.ip) | (u32::MAX >> i.prefix_len)),
        })
        .collect()
}

/// Whether a reply came from a network this PC is on. A datagram from a public
/// address is dropped, whatever it says.
pub fn is_lan_source(addr: SocketAddr) -> bool {
    let IpAddr::V4(ip) = addr.ip() else {
        return false;
    };
    addr.port() != 0 && (ip.is_private() || ip.is_link_local() || ip.is_loopback())
}

/// A server on this PC answers once per local address it can be reached on.
/// Keep one reply per port, preferring the address the caller listed first.
pub fn collapse_own_server(found: Vec<SocketAddr>, own_ips: &[Ipv4Addr]) -> Vec<SocketAddr> {
    let rank = |addr: &SocketAddr| match addr.ip() {
        IpAddr::V4(ip) => own_ips.iter().position(|own| *own == ip),
        IpAddr::V6(_) => None,
    };

    let mut kept: Vec<SocketAddr> = Vec::with_capacity(found.len());
    for addr in found {
        if rank(&addr).is_none() {
            kept.push(addr);
            continue;
        }
        match kept
            .iter()
            .position(|k| k.port() == addr.port() && rank(k).is_some())
        {
            Some(at) if rank(&kept[at]) > rank(&addr) => kept[at] = addr,
            Some(_) => {}
            None => kept.push(addr),
        }
    }
    kept
}

/// Ask every target's subnet for servers on `ports` and collect the addresses
/// that answered. All targets listen at once, on one deadline. A target that
/// cannot send is skipped rather than failing the scan.
pub async fn broadcast_scan(
    targets: &[LanTarget],
    ports: &[u16],
    listen: Duration,
) -> Vec<SocketAddr> {
    let mut tasks = Vec::with_capacity(targets.len());
    for target in targets {
        let target = *target;
        let ports = ports.to_vec();
        tasks.push(tokio::spawn(async move {
            scan_target(target, &ports, listen).await
        }));
    }

    let mut found: Vec<SocketAddr> = Vec::new();
    for task in tasks {
        for addr in task.await.unwrap_or_default() {
            if !found.contains(&addr) {
                found.push(addr);
            }
        }
    }
    found.truncate(MAX_LAN_SERVERS);
    found
}

/// One interface's socket, empty when it cannot be bound or sent from.
async fn scan_target(target: LanTarget, ports: &[u16], listen: Duration) -> Vec<SocketAddr> {
    let Ok(sock) = UdpSocket::bind(SocketAddr::from((target.local, 0))).await else {
        return Vec::new();
    };
    if sock.set_broadcast(true).is_err() {
        return Vec::new();
    }

    let packet = info_request();
    for &port in ports {
        if sock
            .send_to(&packet, SocketAddr::from((target.dest, port)))
            .await
            .is_err()
        {
            return Vec::new();
        }
    }

    let deadline = tokio::time::Instant::now() + listen;
    let mut answers = Vec::new();
    let mut buf = [0u8; 65_536];
    for _ in 0..MAX_DATAGRAMS {
        let Some(remaining) = deadline.checked_duration_since(tokio::time::Instant::now()) else {
            break;
        };
        if remaining.is_zero() {
            break;
        }
        let Ok(received) = tokio::time::timeout(remaining, sock.recv_from(&mut buf)).await else {
            break;
        };
        // Windows reports an ICMP "port unreachable" from an earlier send as a
        // receive error; skip it and keep listening.
        let Ok((n, source)) = received else {
            continue;
        };
        if is_lan_source(source) && is_a2s_answer(&buf[..n]) {
            answers.push(source);
        }
    }
    answers
}

/// The request `query.rs` sends for A2S_INFO, ready to go out as a broadcast.
fn info_request() -> Vec<u8> {
    let mut packet = Vec::with_capacity(INFO_PAYLOAD.len() + 5);
    packet.extend_from_slice(&HEADER);
    packet.push(A2S_INFO);
    packet.extend_from_slice(INFO_PAYLOAD);
    packet
}

/// Whether a datagram is a plain A2S answer rather than junk: the single-packet
/// header, then info (`0x49`) or a challenge (`0x41`).
fn is_a2s_answer(datagram: &[u8]) -> bool {
    datagram.len() >= 5 && datagram.starts_with(&HEADER) && matches!(datagram[4], 0x49 | 0x41)
}

/// Find the DayZ servers answering on the networks this PC is attached to.
pub async fn scan_lan() -> Result<Vec<SocketAddr>, NetError> {
    let interfaces = local_interfaces()?;
    let targets = broadcast_targets(&interfaces);
    let found = broadcast_scan(&targets, &LAN_PORTS, Duration::from_millis(1500)).await;

    // This PC's own addresses, the interfaces first and loopback last, so a
    // server it runs is represented by the address another PC would reach.
    let (loopback, others): (Vec<&LanInterface>, Vec<&LanInterface>) =
        interfaces.iter().filter(|i| i.up).partition(|i| i.loopback);
    let own: Vec<Ipv4Addr> = others.iter().chain(&loopback).map(|i| i.ip).collect();

    Ok(collapse_own_server(found, &own))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn iface(ip: [u8; 4], broadcast: Option<[u8; 4]>, prefix_len: u8) -> LanInterface {
        LanInterface {
            ip: Ipv4Addr::from(ip),
            broadcast: broadcast.map(Ipv4Addr::from),
            prefix_len,
            up: true,
            loopback: false,
            point_to_point: false,
        }
    }

    #[test]
    fn only_a_broadcastable_private_interface_gets_a_target() {
        let cases: &[(&str, LanInterface, Option<Ipv4Addr>)] = &[
            (
                "private /24",
                iface([192, 168, 1, 5], Some([192, 168, 1, 255]), 24),
                Some(Ipv4Addr::new(192, 168, 1, 255)),
            ),
            (
                "down",
                LanInterface {
                    up: false,
                    ..iface([192, 168, 1, 5], Some([192, 168, 1, 255]), 24)
                },
                None,
            ),
            (
                "loopback",
                LanInterface {
                    loopback: true,
                    ..iface([127, 0, 0, 1], Some([127, 0, 0, 1]), 8)
                },
                None,
            ),
            (
                "point to point",
                LanInterface {
                    point_to_point: true,
                    ..iface([10, 8, 0, 2], Some([10, 8, 0, 2]), 24)
                },
                None,
            ),
            (
                "no broadcast address",
                iface([192, 168, 1, 5], None, 24),
                None,
            ),
            ("/31", iface([10, 0, 0, 1], Some([10, 0, 0, 1]), 31), None),
            (
                "public",
                iface([8, 8, 8, 8], Some([8, 8, 8, 255]), 24),
                None,
            ),
            (
                "carrier grade NAT",
                iface([100, 64, 0, 5], Some([100, 64, 0, 255]), 24),
                None,
            ),
            (
                "broadcast reported as its own address",
                iface([192, 168, 1, 5], Some([192, 168, 1, 5]), 24),
                Some(Ipv4Addr::new(192, 168, 1, 255)),
            ),
            (
                "link local",
                iface([169, 254, 1, 7], Some([169, 254, 1, 255]), 24),
                Some(Ipv4Addr::new(169, 254, 1, 255)),
            ),
        ];
        for (name, interface, expected) in cases {
            let targets = broadcast_targets(std::slice::from_ref(interface));
            assert_eq!(targets.len(), expected.is_some() as usize, "case: {name}");
            if let Some(dest) = expected {
                assert_eq!(targets[0].dest, *dest, "case: {name}");
                assert_eq!(targets[0].local, interface.ip, "case: {name}");
            }
        }
    }

    #[test]
    fn more_than_sixteen_scan_worthy_interfaces_are_cut_to_sixteen() {
        let interfaces: Vec<LanInterface> = (0..20u8)
            .map(|n| iface([192, 168, n + 1, 5], Some([192, 168, n + 1, 255]), 24))
            .collect();
        assert_eq!(broadcast_targets(&interfaces).len(), MAX_TARGETS);
    }

    #[test]
    fn only_a_private_link_local_or_loopback_source_is_believed() {
        let cases: &[(&str, SocketAddr, bool)] = &[
            ("10/8", "10.1.2.3:27016".parse().unwrap(), true),
            ("192.168/16", "192.168.0.9:2302".parse().unwrap(), true),
            ("172.16/12", "172.16.5.5:27016".parse().unwrap(), true),
            ("link local", "169.254.1.1:27016".parse().unwrap(), true),
            ("loopback", "127.0.0.1:27016".parse().unwrap(), true),
            (
                "172.32/16 is public",
                "172.32.0.1:27016".parse().unwrap(),
                false,
            ),
            ("a public address", "8.8.8.8:27016".parse().unwrap(), false),
            (
                "carrier grade NAT",
                "100.64.0.1:27016".parse().unwrap(),
                false,
            ),
            ("unspecified", "0.0.0.0:27016".parse().unwrap(), false),
            ("broadcast", "255.255.255.255:27016".parse().unwrap(), false),
            ("multicast", "224.0.0.1:27016".parse().unwrap(), false),
            ("IPv6", "[::1]:27016".parse().unwrap(), false),
            ("port zero", "127.0.0.1:0".parse().unwrap(), false),
        ];
        for (name, addr, expected) in cases {
            assert_eq!(is_lan_source(*addr), *expected, "case: {name}");
        }
    }

    fn addrs(list: &[&str]) -> Vec<SocketAddr> {
        list.iter()
            .map(|a| a.parse().expect("test address"))
            .collect()
    }

    fn own(list: &[&str]) -> Vec<Ipv4Addr> {
        list.iter()
            .map(|a| a.parse().expect("test address"))
            .collect()
    }

    #[test]
    fn a_server_on_this_pc_is_listed_once() {
        let found = addrs(&[
            "192.168.1.5:27016",
            "10.8.0.2:27016",
            "127.0.0.1:27016",
            "192.168.1.9:27016",
        ]);
        let kept = collapse_own_server(found, &own(&["192.168.1.5", "10.8.0.2", "127.0.0.1"]));
        assert_eq!(kept, addrs(&["192.168.1.5:27016", "192.168.1.9:27016"]));
    }

    #[test]
    fn two_ports_on_this_pc_stay_two_servers() {
        let found = addrs(&["10.8.0.2:27016", "10.8.0.2:2303"]);
        let kept = collapse_own_server(found, &own(&["10.8.0.2"]));
        assert_eq!(kept, addrs(&["10.8.0.2:27016", "10.8.0.2:2303"]));
    }

    #[test]
    fn the_first_listed_local_address_represents_this_pc() {
        let found = addrs(&["127.0.0.1:27016", "10.8.0.2:27016"]);
        let kept = collapse_own_server(found, &own(&["10.8.0.2", "127.0.0.1"]));
        assert_eq!(kept, addrs(&["10.8.0.2:27016"]));
    }

    #[test]
    fn nothing_is_merged_when_this_pc_has_no_known_address() {
        let found = addrs(&["192.168.1.5:27016", "10.8.0.2:27016"]);
        let kept = collapse_own_server(found, &[]);
        assert_eq!(kept, addrs(&["192.168.1.5:27016", "10.8.0.2:27016"]));
    }

    /// A UDP fixture that answers every request with `reply`.
    async fn fixture(reply: Vec<u8>) -> (u16, tokio::task::JoinHandle<()>) {
        let sock = UdpSocket::bind("127.0.0.1:0").await.expect("bind fixture");
        let port = sock.local_addr().expect("local addr").port();
        let handle = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            while let Ok((_, client)) = sock.recv_from(&mut buf).await {
                if sock.send_to(&reply, client).await.is_err() {
                    return;
                }
            }
        });
        (port, handle)
    }

    fn loopback_target() -> Vec<LanTarget> {
        vec![LanTarget {
            local: Ipv4Addr::LOCALHOST,
            dest: Ipv4Addr::LOCALHOST,
        }]
    }

    #[tokio::test]
    async fn a_broadcast_scan_finds_a_server_that_answers_with_info_or_a_challenge() {
        let cases: &[(&str, Vec<u8>)] = &[
            ("info", vec![0xff, 0xff, 0xff, 0xff, 0x49, 17]),
            ("challenge", vec![0xff, 0xff, 0xff, 0xff, 0x41, 1, 2, 3, 4]),
        ];
        for (name, reply) in cases {
            let (port, server) = fixture(reply.clone()).await;
            let found =
                broadcast_scan(&loopback_target(), &[port], Duration::from_millis(300)).await;
            assert_eq!(
                found,
                addrs(&[&format!("127.0.0.1:{port}")]),
                "case: {name}"
            );
            server.abort();
        }
    }

    #[tokio::test]
    async fn a_server_answering_twice_is_found_once() {
        let sock = UdpSocket::bind("127.0.0.1:0").await.expect("bind fixture");
        let port = sock.local_addr().expect("local addr").port();
        let server = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            while let Ok((_, client)) = sock.recv_from(&mut buf).await {
                for _ in 0..2 {
                    let _ = sock
                        .send_to(&[0xff, 0xff, 0xff, 0xff, 0x49, 17], client)
                        .await;
                }
            }
        });

        let found = broadcast_scan(&loopback_target(), &[port], Duration::from_millis(300)).await;
        assert_eq!(found.len(), 1);
        server.abort();
    }

    #[tokio::test]
    async fn a_reply_that_is_not_an_a2s_answer_is_ignored() {
        let cases: &[(&str, Vec<u8>)] = &[
            ("junk bytes", vec![0x00, 0x01, 0x02]),
            ("short", vec![0xff, 0xff, 0xff, 0xff]),
            (
                "a rules answer is not an info answer",
                vec![0xff, 0xff, 0xff, 0xff, 0x45, 0],
            ),
        ];
        for (name, reply) in cases {
            let (port, server) = fixture(reply.clone()).await;
            let found =
                broadcast_scan(&loopback_target(), &[port], Duration::from_millis(100)).await;
            assert!(found.is_empty(), "case: {name}");
            server.abort();
        }
    }

    #[tokio::test]
    async fn a_silent_network_gives_nothing_when_the_window_closes() {
        let port = {
            let sock = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind");
            sock.local_addr().expect("local addr").port()
        };
        let started = std::time::Instant::now();
        let found = broadcast_scan(&loopback_target(), &[port], Duration::from_millis(100)).await;
        assert!(found.is_empty());
        assert!(
            started.elapsed() < Duration::from_millis(400),
            "the scan must give up at its deadline, not per read"
        );
    }

    #[tokio::test]
    async fn a_server_that_keeps_answering_does_not_extend_the_listen_window() {
        let sock = UdpSocket::bind("127.0.0.1:0").await.expect("bind fixture");
        let port = sock.local_addr().expect("local addr").port();
        let server = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            let Ok((_, client)) = sock.recv_from(&mut buf).await else {
                return;
            };
            // Junk every 5 ms, long past the window: an unlimited per-read
            // timeout would keep reading these for seconds.
            for _ in 0..100 {
                if sock.send_to(&[0x00, 0x01, 0x02], client).await.is_err() {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        });

        let started = std::time::Instant::now();
        let found = broadcast_scan(&loopback_target(), &[port], Duration::from_millis(100)).await;
        let elapsed = started.elapsed();
        assert!(found.is_empty());
        assert!(
            elapsed < Duration::from_millis(400),
            "a chatty peer held the scan for {elapsed:?}"
        );

        server.abort();
    }
}
