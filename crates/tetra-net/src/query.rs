use crate::error::NetError;
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tetra_core::a2s::dayz::{parse_dayz_rules, PackedPayload};
use tetra_core::a2s::info::{parse_info, ServerInfo};
use tetra_core::a2s::packet::{classify_packet, reassemble_split, PacketKind};
use tetra_core::CoreError;
use tokio::net::UdpSocket;

pub(crate) const HEADER: [u8; 4] = [0xff, 0xff, 0xff, 0xff];
pub(crate) const A2S_INFO: u8 = 0x54;
const A2S_RULES: u8 = 0x56;
pub(crate) const INFO_PAYLOAD: &[u8] = b"Source Engine Query\0";

/// Ceiling on one whole exchange (challenge round trip + split reassembly),
/// as a multiple of the per-datagram `timeout` — bounds a peer that keeps
/// resetting `recv_once`'s per-read timeout without ever completing.
pub(crate) const EXCHANGE_TIMEOUT_MULTIPLIER: u32 = 8;

/// The payload of one exchange plus how long the reply that answered it took.
#[derive(Debug, Clone)]
struct Exchange {
    payload: Vec<u8>,
    /// Time from the final request to its first datagram — the challenge round
    /// trip is excluded.
    reply_time: Duration,
    /// Whether the server demanded a challenge echo before answering.
    challenged: bool,
}

/// One request/response exchange on a socket of its own, bounded by
/// [`EXCHANGE_TIMEOUT_MULTIPLIER`] regardless of how the inner reads behave.
async fn request(
    addr: SocketAddr,
    kind: u8,
    payload: &[u8],
    timeout: Duration,
) -> Result<Exchange, NetError> {
    let deadline = timeout.saturating_mul(EXCHANGE_TIMEOUT_MULTIPLIER);
    match tokio::time::timeout(deadline, request_inner(addr, kind, payload, timeout)).await {
        Ok(result) => result,
        Err(_) => Err(NetError::ExchangeTimedOut { addr }),
    }
}

/// Socket is bound here and dropped at the end — a dedicated port per query
/// means fragments from two concurrent queries can never collide.
async fn request_inner(
    addr: SocketAddr,
    kind: u8,
    payload: &[u8],
    timeout: Duration,
) -> Result<Exchange, NetError> {
    let sock = UdpSocket::bind("0.0.0.0:0").await?;
    sock.connect(addr).await?;

    let mut packet = Vec::with_capacity(payload.len() + 5);
    packet.extend_from_slice(&HEADER);
    packet.push(kind);
    packet.extend_from_slice(payload);
    let mut started = Instant::now();
    sock.send(&packet).await?;

    // Sized for the largest possible single A2S datagram (65507 bytes) — a
    // smaller buffer would silently truncate a big single-datagram reply
    // (e.g. a large mod list) rather than error.
    let mut buf = vec![0u8; 65536];
    let mut first = recv_once(&sock, &mut buf, timeout).await?;
    let mut challenged = false;

    if let PacketKind::Challenge(challenge) = classify_packet(&first).map_err(CoreError::from)? {
        challenged = true;
        let mut retry = Vec::with_capacity(payload.len() + 9);
        retry.extend_from_slice(&HEADER);
        retry.push(kind);
        if kind == A2S_INFO {
            retry.extend_from_slice(payload);
        }
        retry.extend_from_slice(&challenge);
        // The challenge round trip is a server's own price of admission, not
        // the trip being measured, so the clock restarts here.
        started = Instant::now();
        sock.send(&retry).await?;
        first = recv_once(&sock, &mut buf, timeout).await?;
    }
    let reply_time = started.elapsed();

    let mut packets = vec![first];
    if let PacketKind::Split { id, total, index } =
        classify_packet(&packets[0]).map_err(CoreError::from)?
    {
        let mut seen: BTreeMap<u8, Vec<u8>> = BTreeMap::new();
        seen.insert(index, packets.pop().expect("just pushed"));

        let mut budget = (total as usize).saturating_mul(2).saturating_add(8);

        while seen.len() < total as usize {
            if budget == 0 {
                return Err(NetError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "too many datagrams while reassembling a split response",
                )));
            }
            budget -= 1;

            let datagram = recv_once(&sock, &mut buf, timeout).await?;
            match classify_packet(&datagram) {
                Ok(PacketKind::Split {
                    id: fragment_id,
                    total: fragment_total,
                    index: fragment_index,
                }) if fragment_id == id && fragment_total == total => {
                    seen.insert(fragment_index, datagram);
                }
                Ok(PacketKind::Challenge(_)) => {
                    return Err(NetError::Io(std::io::Error::new(
                        std::io::ErrorKind::ConnectionAborted,
                        "server re-issued a challenge mid-reassembly",
                    )))
                }
                _ => continue,
            }
        }

        packets = seen.into_values().collect();
    }

    Ok(Exchange {
        payload: reassemble_split(&packets).map_err(CoreError::from)?,
        reply_time,
        challenged,
    })
}

async fn recv_once(
    sock: &UdpSocket,
    buf: &mut [u8],
    timeout: Duration,
) -> Result<Vec<u8>, NetError> {
    let n = tokio::time::timeout(timeout, sock.recv(buf))
        .await
        .map_err(|_| std::io::Error::from(std::io::ErrorKind::TimedOut))??;
    Ok(buf[..n].to_vec())
}

/// One A2S_INFO answer with how long the answering reply took and whether the
/// server demanded a challenge first.
#[derive(Debug, Clone)]
pub struct TimedInfo {
    pub info: ServerInfo,
    pub reply_time: Duration,
    pub challenged: bool,
}

pub async fn query_info_raw(addr: SocketAddr, timeout: Duration) -> Result<Vec<u8>, NetError> {
    Ok(request(addr, A2S_INFO, INFO_PAYLOAD, timeout)
        .await?
        .payload)
}

pub async fn query_rules_raw(addr: SocketAddr, timeout: Duration) -> Result<Vec<u8>, NetError> {
    Ok(request(addr, A2S_RULES, &[0xff, 0xff, 0xff, 0xff], timeout)
        .await?
        .payload)
}

pub async fn query_info(addr: SocketAddr, timeout: Duration) -> Result<ServerInfo, NetError> {
    Ok(query_info_timed(addr, timeout).await?.info)
}

/// [`query_info`] with the timing of the reply that answered, for estimating a
/// ping from a server that does not answer pings.
pub async fn query_info_timed(addr: SocketAddr, timeout: Duration) -> Result<TimedInfo, NetError> {
    let exchange = request(addr, A2S_INFO, INFO_PAYLOAD, timeout).await?;
    Ok(TimedInfo {
        info: parse_info(&exchange.payload).map_err(CoreError::from)?,
        reply_time: exchange.reply_time,
        challenged: exchange.challenged,
    })
}

pub async fn query_rules(addr: SocketAddr, timeout: Duration) -> Result<PackedPayload, NetError> {
    let raw = query_rules_raw(addr, timeout).await?;
    Ok(parse_dayz_rules(&raw).map_err(CoreError::from)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A successful A2S_INFO response.
    fn info_response() -> Vec<u8> {
        let mut v = vec![0xff, 0xff, 0xff, 0xff, 0x49, 17];
        for s in ["Test", "chernarusplus", "dayz", "DayZ"] {
            v.extend_from_slice(s.as_bytes());
            v.push(0);
        }
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&[0, 60, 0, b'd', b'l', 0, 1]);
        v.extend_from_slice(b"1.0\0");
        v
    }

    fn challenge_response() -> Vec<u8> {
        vec![0xff, 0xff, 0xff, 0xff, 0x41, 0xde, 0xad, 0xbe, 0xef]
    }

    /// The challenge round trip is the server's cost of answering, not the
    /// trip being measured, so it must not land in `reply_time`.
    #[tokio::test]
    async fn a_challenged_reply_is_timed_from_the_second_request() {
        let server = UdpSocket::bind("127.0.0.1:0")
            .await
            .expect("bind fake server");
        let addr = server.local_addr().expect("local addr");

        let responder = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            let (_, client) = server.recv_from(&mut buf).await.expect("first request");
            tokio::time::sleep(Duration::from_millis(80)).await;
            let _ = server.send_to(&challenge_response(), client).await;

            let (_, client) = server
                .recv_from(&mut buf)
                .await
                .expect("challenged request");
            tokio::time::sleep(Duration::from_millis(40)).await;
            let _ = server.send_to(&info_response(), client).await;
        });

        let timed = query_info_timed(addr, Duration::from_millis(500))
            .await
            .expect("the fake answers");

        assert!(timed.challenged, "the server demanded a challenge");
        assert!(
            timed.reply_time >= Duration::from_millis(40),
            "reply_time {:?} is under the 40ms the server waited",
            timed.reply_time
        );
        let whole_exchange = Duration::from_millis(80 + 40);
        assert!(
            timed.reply_time < whole_exchange - Duration::from_millis(20),
            "reply_time {:?} should exclude the 80ms challenge wait of the {whole_exchange:?} exchange",
            timed.reply_time
        );

        responder.abort();
    }

    #[tokio::test]
    async fn an_unchallenged_reply_is_timed_from_the_first_request() {
        let server = UdpSocket::bind("127.0.0.1:0")
            .await
            .expect("bind fake server");
        let addr = server.local_addr().expect("local addr");

        let responder = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            let (_, client) = server.recv_from(&mut buf).await.expect("request");
            let _ = server.send_to(&info_response(), client).await;
        });

        let timed = query_info_timed(addr, Duration::from_millis(500))
            .await
            .expect("the fake answers");
        assert!(!timed.challenged, "an immediate answer needs no challenge");
        assert_eq!(timed.info.name, "Test");

        responder.abort();
    }

    fn split_header(id: u32, total: u8, index: u8, body: &[u8]) -> Vec<u8> {
        let mut v = vec![0xff, 0xff, 0xff, 0xfe];
        v.extend_from_slice(&id.to_le_bytes());
        v.push(total);
        v.push(index);
        v.extend_from_slice(&1248u16.to_le_bytes());
        v.extend_from_slice(body);
        v
    }

    /// Junk the reassembly loop's `_ => continue` arm silently discards —
    /// what a keepalive-spamming peer would send to reset `recv_once`'s
    /// per-read timeout without completing the exchange.
    fn junk_single_packet() -> Vec<u8> {
        vec![0xff, 0xff, 0xff, 0xff, 0x49, 0x00]
    }

    #[tokio::test]
    async fn a_peer_that_keeps_resetting_the_read_timeout_cannot_hold_the_exchange_open() {
        let server = UdpSocket::bind("127.0.0.1:0")
            .await
            .expect("bind fake server");
        let server_addr = server.local_addr().expect("local addr");

        let responder = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            let (_, client) = server.recv_from(&mut buf).await.expect("recv request");

            // Announce a 3-fragment split response, then never send fragments
            // 1/2 — just junk well inside each timeout window, well past the
            // exchange deadline, so a regression here hangs instead of passing.
            let header = split_header(1234, 3, 0, b"AAA");
            let _ = server.send_to(&header, client).await;

            for _ in 0..150 {
                tokio::time::sleep(Duration::from_millis(10)).await;
                let _ = server.send_to(&junk_single_packet(), client).await;
            }
        });

        let timeout = Duration::from_millis(30);
        let started = std::time::Instant::now();
        let result = query_rules_raw(server_addr, timeout).await;
        let elapsed = started.elapsed();

        assert!(
            result.is_err(),
            "an exchange that never completes reassembly must not succeed"
        );
        let bound = timeout * (EXCHANGE_TIMEOUT_MULTIPLIER * 2);
        assert!(
            elapsed < bound,
            "exchange ran for {elapsed:?}, expected to give up within roughly {bound:?}"
        );

        responder.abort();
    }
}
