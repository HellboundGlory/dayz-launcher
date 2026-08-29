use crate::error::NetError;
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::time::Duration;
use tetra_core::a2s::dayz::{parse_dayz_rules, PackedPayload};
use tetra_core::a2s::info::{parse_info, ServerInfo};
use tetra_core::a2s::packet::{classify_packet, reassemble_split, PacketKind};
use tetra_core::CoreError;
use tokio::net::UdpSocket;

const HEADER: [u8; 4] = [0xff, 0xff, 0xff, 0xff];
const A2S_INFO: u8 = 0x54;
const A2S_RULES: u8 = 0x56;
const INFO_PAYLOAD: &[u8] = b"Source Engine Query\0";

/// Ceiling on one whole exchange (challenge round trip and split reassembly
/// included), as a multiple of the per-datagram `timeout`.
///
/// `recv_once`'s timeout is per read, and it resets on every individual
/// datagram — so without an outer bound, a server that answers a
/// split-response header (up to 255 fragments, an up-to-`total * 2 + 8` read
/// budget) and then trickles one datagram just under each `timeout` can hold
/// the exchange open for as long as it likes, along with whatever
/// concurrency permit acquired it. Eight timeouts is generous slack for a
/// real multi-fragment reply while still bounding the worst case to minutes
/// rather than the roughly `total * 2 + 8` reads (up to 518) the retry loop
/// alone would otherwise allow. `retry::with_retries` layers a matching
/// per-address ceiling on top, scaled to the configured attempt count.
pub(crate) const EXCHANGE_TIMEOUT_MULTIPLIER: u32 = 8;

/// One request/response exchange on a socket of its own, bounded by
/// [`EXCHANGE_TIMEOUT_MULTIPLIER`] regardless of how the inner reads behave.
async fn request(
    addr: SocketAddr,
    kind: u8,
    payload: &[u8],
    timeout: Duration,
) -> Result<Vec<u8>, NetError> {
    let deadline = timeout.saturating_mul(EXCHANGE_TIMEOUT_MULTIPLIER);
    match tokio::time::timeout(deadline, request_inner(addr, kind, payload, timeout)).await {
        Ok(result) => result,
        Err(_) => Err(NetError::ExchangeTimedOut { addr }),
    }
}

/// The socket is bound here and dropped at the end of the function. That is the
/// load-bearing detail: the challenge is bound to the source port, and a
/// dedicated port per query means fragments from two concurrent queries to the
/// same server can never arrive on the same socket.
async fn request_inner(
    addr: SocketAddr,
    kind: u8,
    payload: &[u8],
    timeout: Duration,
) -> Result<Vec<u8>, NetError> {
    let sock = UdpSocket::bind("0.0.0.0:0").await?;
    sock.connect(addr).await?;

    let mut packet = Vec::with_capacity(payload.len() + 5);
    packet.extend_from_slice(&HEADER);
    packet.push(kind);
    packet.extend_from_slice(payload);
    sock.send(&packet).await?;

    // Sized for the largest possible single A2S datagram (65507 bytes), not
    // the common case. A `recv` into a buffer smaller than the datagram
    // silently truncates it — a 4 KiB buffer loses the tail of any RULES
    // response larger than that (a big mod list arrives as one ~4 KB+
    // datagram), which then fails to parse and reads as "could not read the
    // mod list". Split responses are unaffected (each fragment is small); this
    // covers the single-datagram path.
    let mut buf = vec![0u8; 65536];
    let mut first = recv_once(&sock, &mut buf, timeout).await?;

    if let PacketKind::Challenge(challenge) = classify_packet(&first).map_err(CoreError::from)? {
        let mut retry = Vec::with_capacity(payload.len() + 9);
        retry.extend_from_slice(&HEADER);
        retry.push(kind);
        if kind == A2S_INFO {
            retry.extend_from_slice(payload);
        }
        retry.extend_from_slice(&challenge);
        sock.send(&retry).await?;
        first = recv_once(&sock, &mut buf, timeout).await?;
    }

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

    Ok(reassemble_split(&packets).map_err(CoreError::from)?)
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

pub async fn query_info_raw(addr: SocketAddr, timeout: Duration) -> Result<Vec<u8>, NetError> {
    request(addr, A2S_INFO, INFO_PAYLOAD, timeout).await
}

pub async fn query_rules_raw(addr: SocketAddr, timeout: Duration) -> Result<Vec<u8>, NetError> {
    request(addr, A2S_RULES, &[0xff, 0xff, 0xff, 0xff], timeout).await
}

pub async fn query_info(addr: SocketAddr, timeout: Duration) -> Result<ServerInfo, NetError> {
    let raw = query_info_raw(addr, timeout).await?;
    Ok(parse_info(&raw).map_err(CoreError::from)?)
}

pub async fn query_rules(addr: SocketAddr, timeout: Duration) -> Result<PackedPayload, NetError> {
    let raw = query_rules_raw(addr, timeout).await?;
    Ok(parse_dayz_rules(&raw).map_err(CoreError::from)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split_header(id: u32, total: u8, index: u8, body: &[u8]) -> Vec<u8> {
        let mut v = vec![0xff, 0xff, 0xff, 0xfe];
        v.extend_from_slice(&id.to_le_bytes());
        v.push(total);
        v.push(index);
        v.extend_from_slice(&1248u16.to_le_bytes());
        v.extend_from_slice(body);
        v
    }

    /// A single-packet response — used here purely as "junk" the reassembly
    /// loop's `_ => continue` arm silently discards, the same shape a
    /// keepalive-spamming peer would send to reset `recv_once`'s per-read
    /// timeout without ever completing the exchange.
    fn junk_single_packet() -> Vec<u8> {
        vec![0xff, 0xff, 0xff, 0xff, 0x49, 0x00]
    }

    /// The bug `EXCHANGE_TIMEOUT_MULTIPLIER` exists to close: before it,
    /// `recv_once`'s per-datagram timeout reset on every successful read, so
    /// a peer that announces a split response and then keeps the exchange
    /// alive by sending one throwaway datagram just under each `timeout` —
    /// never actually completing reassembly — could hold it (and whatever
    /// concurrency permit acquired it) open for as long as it kept doing
    /// that. The fix bounds the *whole* exchange regardless of how many
    /// individual reads keep succeeding.
    #[tokio::test]
    async fn a_peer_that_keeps_resetting_the_read_timeout_cannot_hold_the_exchange_open() {
        let server = UdpSocket::bind("127.0.0.1:0")
            .await
            .expect("bind fake server");
        let server_addr = server.local_addr().expect("local addr");

        let responder = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            // The client's initial A2S_RULES request.
            let (_, client) = server.recv_from(&mut buf).await.expect("recv request");

            // Announce a 3-fragment split response...
            let header = split_header(1234, 3, 0, b"AAA");
            let _ = server.send_to(&header, client).await;

            // ...then never send fragments 1 or 2. Instead, keep sending junk
            // well inside each `timeout` window, for far longer than the
            // exchange deadline should allow, so a regression here would
            // make this test visibly hang rather than pass by accident.
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
