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

/// One request/response exchange on a socket of its own.
///
/// The socket is bound here and dropped at the end of the function. That is the
/// load-bearing detail: the challenge is bound to the source port, and a
/// dedicated port per query means fragments from two concurrent queries to the
/// same server can never arrive on the same socket.
async fn request(
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
