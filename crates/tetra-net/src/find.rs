//! Finding one server from what a player typed: a host name or an IP, with or
//! without a port.

use crate::prober::Prober;
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use tetra_core::a2s::info::ServerInfo;

/// The port a DayZ server listens for players on by default.
pub const DEFAULT_GAME_PORT: u16 = 2302;

/// Steam's default DayZ query port.
pub const DEFAULT_QUERY_PORT: u16 = 27016;

/// Every port worth trying, in the order they are tried: the one typed (or the
/// default game port) and its neighbours, then the rest.
pub fn candidate_ports(typed: Option<u16>) -> Vec<u16> {
    let base = typed.unwrap_or(DEFAULT_GAME_PORT);
    let mut ports = Vec::with_capacity(6);
    for step in [0u16, 1, 2, 3, 100] {
        if let Some(port) = base.checked_add(step) {
            if !ports.contains(&port) {
                ports.push(port);
            }
        }
    }
    if !ports.contains(&DEFAULT_QUERY_PORT) {
        ports.push(DEFAULT_QUERY_PORT);
    }
    ports
}

/// A server that answered, with what it said about itself.
#[derive(Debug, Clone)]
pub struct Answer {
    pub addr: SocketAddr,
    pub info: ServerInfo,
}

/// How much a reply looks like the server the player meant: lower is better.
/// `0` is a server reporting the port the player is after, `1` a server on a
/// port the player typed, `2` anything else that answered.
fn rank(addr: SocketAddr, info: &ServerInfo, wanted: u16, typed: bool) -> u8 {
    if info.game_port == Some(wanted) {
        0
    } else if typed && addr.port() == wanted {
        1
    } else {
        2
    }
}

/// Probe `targets` and keep the best answer. Ties go to the target listed
/// first, so the caller's order is the preference. Returns as soon as a server
/// reports the wanted port.
pub async fn find_among(
    prober: &Prober,
    targets: Vec<SocketAddr>,
    wanted: u16,
    typed: bool,
) -> Option<Answer> {
    let order: HashMap<SocketAddr, usize> = targets
        .iter()
        .enumerate()
        .map(|(position, addr)| (*addr, position))
        .collect();

    let mut rx = prober.refresh(targets);
    let mut best: Option<(u8, usize, Answer)> = None;
    while let Some(outcome) = rx.recv().await {
        let Ok(info) = outcome.result else {
            continue;
        };
        let found = rank(outcome.addr, &info, wanted, typed);
        let position = order[&outcome.addr];
        let answer = Answer {
            addr: outcome.addr,
            info,
        };
        if best.as_ref().is_none_or(|(best_rank, best_position, _)| {
            (found, position) < (*best_rank, *best_position)
        }) {
            best = Some((found, position, answer));
        }
        if found == 0 {
            break;
        }
    }
    best.map(|(_, _, answer)| answer)
}

/// Probe `ips` on every candidate port for `typed` and keep the best answer.
pub async fn find_server_at(
    prober: &Prober,
    ips: &[Ipv4Addr],
    typed: Option<u16>,
) -> Option<Answer> {
    let mut targets = Vec::new();
    for ip in ips {
        for port in candidate_ports(typed) {
            targets.push(SocketAddr::from((*ip, port)));
        }
    }
    find_among(
        prober,
        targets,
        typed.unwrap_or(DEFAULT_GAME_PORT),
        typed.is_some(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ProbeConfig;
    use crate::prober::Prober;
    use std::time::Duration;
    use tokio::net::UdpSocket;

    fn impatient() -> ProbeConfig {
        ProbeConfig {
            timeout: Duration::from_millis(30),
            attempts: 1,
            backoff: Duration::from_millis(1),
            max_in_flight: 32,
        }
    }

    fn loopback(port: u16) -> SocketAddr {
        SocketAddr::from((Ipv4Addr::LOCALHOST, port))
    }

    fn free_port() -> u16 {
        let sock = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind");
        sock.local_addr().expect("local addr").port()
    }

    #[test]
    fn candidate_ports_start_at_the_typed_port_and_end_with_the_query_port() {
        let typed_port_cases: &[(Option<u16>, &[u16])] = &[
            (Some(2302), &[2302, 2303, 2304, 2305, 2402, 27016]),
            (None, &[2302, 2303, 2304, 2305, 2402, 27016]),
            (Some(27016), &[27016, 27017, 27018, 27019, 27116]),
            (Some(65534), &[65534, 65535, 27016]),
            (Some(65535), &[65535, 27016]),
        ];
        for (typed, expected) in typed_port_cases {
            assert_eq!(candidate_ports(*typed), *expected, "typed {typed:?}");
        }
    }

    /// An A2S_INFO reply, with the extra-data flag and game port when given.
    fn info_reply(name: &str, game_port: Option<u16>) -> Vec<u8> {
        let mut v = vec![0xff, 0xff, 0xff, 0xff, 0x49, 17];
        for s in [name, "chernarusplus", "dayz", "DayZ"] {
            v.extend_from_slice(s.as_bytes());
            v.push(0);
        }
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&[0, 60, 0, b'd', b'l', 0, 1]);
        v.extend_from_slice(b"1.28\0");
        match game_port {
            Some(port) => {
                v.push(0x80);
                v.extend_from_slice(&port.to_le_bytes());
            }
            None => v.push(0),
        }
        v
    }

    /// Answers every request with `reply`, on whatever port it was given.
    async fn fixture(port: u16, reply: Vec<u8>) -> tokio::task::JoinHandle<()> {
        let sock = UdpSocket::bind(loopback(port)).await.expect("bind fixture");
        tokio::spawn(async move {
            let mut buf = [0u8; 64];
            while let Ok((_, client)) = sock.recv_from(&mut buf).await {
                let _ = sock.send_to(&reply, client).await;
            }
        })
    }

    #[tokio::test]
    async fn typing_the_game_port_finds_the_server_on_its_query_port() {
        let query = free_port();
        let other = free_port();
        let dead = free_port();
        let a = fixture(query, info_reply("Wanted", Some(2302))).await;
        let b = fixture(other, info_reply("Neighbour", Some(2303))).await;

        let prober = Prober::new(impatient());
        let answer = find_among(
            &prober,
            vec![loopback(dead), loopback(other), loopback(query)],
            2302,
            true,
        )
        .await
        .expect("the server reporting the game port answers");

        assert_eq!(answer.addr, loopback(query));
        assert_eq!(answer.info.name, "Wanted");

        a.abort();
        b.abort();
    }

    #[tokio::test]
    async fn a_reply_from_the_typed_port_wins_over_any_other() {
        let typed_port = free_port();
        let other = free_port();
        let a = fixture(typed_port, info_reply("Typed", None)).await;
        let b = fixture(other, info_reply("Other", None)).await;

        let prober = Prober::new(impatient());
        let answer = find_among(
            &prober,
            vec![loopback(other), loopback(typed_port)],
            typed_port,
            true,
        )
        .await
        .expect("an answer");

        assert_eq!(answer.addr, loopback(typed_port));
        assert_eq!(answer.info.name, "Typed");

        a.abort();
        b.abort();
    }

    #[tokio::test]
    async fn a_server_reporting_no_game_port_still_answers_when_it_is_the_only_one() {
        let port = free_port();
        let fixture = fixture(port, info_reply("Silent about its port", None)).await;

        let prober = Prober::new(impatient());
        let answer = find_among(
            &prober,
            vec![loopback(free_port()), loopback(port)],
            2302,
            false,
        )
        .await
        .expect("an answer");

        assert_eq!(answer.addr, loopback(port));

        fixture.abort();
    }

    #[tokio::test]
    async fn nothing_answering_gives_nothing() {
        let prober = Prober::new(impatient());
        let answer = find_among(
            &prober,
            vec![loopback(free_port()), loopback(free_port())],
            2302,
            true,
        )
        .await;
        assert!(answer.is_none());
    }

    #[tokio::test]
    async fn an_address_and_a_typed_port_become_the_target_list() {
        let port = free_port();
        let fixture = fixture(port, info_reply("Typed port", Some(2302))).await;
        let prober = Prober::new(impatient());

        let answer = find_server_at(&prober, &[Ipv4Addr::LOCALHOST], Some(port))
            .await
            .expect("the typed port answers");

        assert_eq!(answer.addr, loopback(port));
        assert_eq!(answer.info.game_port, Some(2302));

        fixture.abort();
    }
}
