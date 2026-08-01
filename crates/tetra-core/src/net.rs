use crate::a2s::packet::{classify_packet, reassemble_split, PacketKind};
use crate::error::CoreError;
use std::net::{SocketAddr, UdpSocket};
use std::time::Duration;

const HEADER: [u8; 4] = [0xff, 0xff, 0xff, 0xff];
const A2S_INFO: u8 = 0x54;
const A2S_RULES: u8 = 0x56;
const INFO_PAYLOAD: &[u8] = b"Source Engine Query\0";

fn request(
    addr: SocketAddr,
    kind: u8,
    payload: &[u8],
    timeout: Duration,
) -> Result<Vec<u8>, CoreError> {
    let sock = UdpSocket::bind("0.0.0.0:0")?;
    sock.set_read_timeout(Some(timeout))?;
    sock.set_write_timeout(Some(timeout))?;
    sock.connect(addr)?;

    let mut packet = Vec::with_capacity(payload.len() + 5);
    packet.extend_from_slice(&HEADER);
    packet.push(kind);
    packet.extend_from_slice(payload);
    sock.send(&packet)?;

    let mut buf = [0u8; 4096];
    let n = sock.recv(&mut buf)?;
    let mut first = buf[..n].to_vec();

    if let PacketKind::Challenge(challenge) = classify_packet(&first)? {
        let mut retry = Vec::with_capacity(payload.len() + 9);
        retry.extend_from_slice(&HEADER);
        retry.push(kind);
        if kind == A2S_INFO {
            retry.extend_from_slice(payload);
        }
        retry.extend_from_slice(&challenge);
        sock.send(&retry)?;
        let n = sock.recv(&mut buf)?;
        first = buf[..n].to_vec();
    }

    let mut packets = vec![first];
    if let PacketKind::Split { total, .. } = classify_packet(&packets[0])? {
        while packets.len() < total as usize {
            let n = sock.recv(&mut buf)?;
            packets.push(buf[..n].to_vec());
        }
    }

    Ok(reassemble_split(&packets)?)
}

/// Fetch a raw A2S_INFO response body, ready for `a2s::info::parse_info`.
pub fn query_info_raw(addr: SocketAddr, timeout: Duration) -> Result<Vec<u8>, CoreError> {
    let body = request(addr, A2S_INFO, INFO_PAYLOAD, timeout)?;
    let mut out = HEADER.to_vec();
    out.extend_from_slice(&body);
    Ok(out)
}

/// Fetch a raw A2S_RULES response body, ready for `a2s::rules::parse_rules`.
pub fn query_rules_raw(addr: SocketAddr, timeout: Duration) -> Result<Vec<u8>, CoreError> {
    let body = request(addr, A2S_RULES, &HEADER, timeout)?;
    let mut out = HEADER.to_vec();
    out.extend_from_slice(&body);
    Ok(out)
}