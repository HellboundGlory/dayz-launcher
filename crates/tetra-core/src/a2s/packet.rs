use crate::error::ParseError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PacketKind {
    Single,
    /// `id` identifies the query this fragment answers. Fragments from
    /// different requests must never be joined — see `reassemble_split`.
    Split {
        id: u32,
        total: u8,
        index: u8,
    },
    /// Server demands the challenge be echoed back before it will answer.
    Challenge([u8; 4]),
}

pub fn classify_packet(buf: &[u8]) -> Result<PacketKind, ParseError> {
    if buf.len() < 5 {
        return Err(ParseError::Truncated {
            offset: 0,
            needed: 5,
            have: buf.len(),
        });
    }
    match &buf[0..4] {
        [0xff, 0xff, 0xff, 0xff] => {
            if buf[4] == 0x41 {
                if buf.len() < 9 {
                    return Err(ParseError::Truncated {
                        offset: 5,
                        needed: 4,
                        have: buf.len() - 5,
                    });
                }
                Ok(PacketKind::Challenge([buf[5], buf[6], buf[7], buf[8]]))
            } else {
                Ok(PacketKind::Single)
            }
        }
        [0xff, 0xff, 0xff, 0xfe] => {
            if buf.len() < 12 {
                return Err(ParseError::Truncated {
                    offset: 4,
                    needed: 8,
                    have: buf.len() - 4,
                });
            }
            let id = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]);
            Ok(PacketKind::Split {
                id,
                total: buf[8],
                index: buf[9],
            })
        }
        _ => Err(ParseError::BadHeader(buf[0])),
    }
}

/// Join a set of datagrams into one response body.
///
/// A single-packet response yields its body directly. A split set must be
/// complete; a gap means the response is unusable, not merely shorter.
pub fn reassemble_split(packets: &[Vec<u8>]) -> Result<Vec<u8>, ParseError> {
    use std::collections::HashSet;

    if packets.is_empty() {
        return Err(ParseError::Truncated {
            offset: 0,
            needed: 1,
            have: 0,
        });
    }
    if let PacketKind::Single = classify_packet(&packets[0])? {
        return Ok(packets[0][4..].to_vec());
    }

    let mut parts: Vec<(u8, &[u8])> = Vec::with_capacity(packets.len());
    let mut total = 0u8;
    let mut expected_id: Option<u32> = None;
    let mut seen_indices = HashSet::new();

    for p in packets {
        match classify_packet(p)? {
            PacketKind::Split {
                id,
                total: t,
                index,
            } => {
                // The high bit flags a bzip2-compressed payload. Reject before
                // touching the body: a compressed body parsed as plain bytes
                // yields fabricated workshop IDs, which is the failure mode
                // this crate exists to prevent.
                if id & 0x8000_0000 != 0 {
                    return Err(ParseError::CompressedSplit { id });
                }
                match expected_id {
                    None => expected_id = Some(id),
                    Some(want) if want != id => {
                        return Err(ParseError::SplitIdMismatch {
                            expected: want,
                            found: id,
                        });
                    }
                    Some(_) => {}
                }

                // Set or validate total
                if total == 0 {
                    if t == 0 {
                        return Err(ParseError::MalformedSplit {
                            reason: "total is 0".to_string(),
                        });
                    }
                    total = t;
                } else if t != total {
                    return Err(ParseError::MalformedSplit {
                        reason: format!(
                            "packets disagree on total: expected {}, got {}",
                            total, t
                        ),
                    });
                }

                // Validate index range
                if index >= total {
                    return Err(ParseError::MalformedSplit {
                        reason: format!("index {} out of range for total {}", index, total),
                    });
                }

                // Check for duplicate index
                if !seen_indices.insert(index) {
                    return Err(ParseError::MalformedSplit {
                        reason: format!("duplicate index {}", index),
                    });
                }

                parts.push((index, &p[12..]));
            }
            _ => {
                // Not a split packet (e.g., Challenge or Single)
                return Err(ParseError::MalformedSplit {
                    reason: "expected a split packet".to_string(),
                });
            }
        }
    }

    // Check completeness
    if parts.len() != total as usize {
        return Err(ParseError::IncompleteSplit {
            have: parts.len(),
            total: total as usize,
        });
    }

    parts.sort_by_key(|(index, _)| *index);

    let mut out = Vec::new();
    for (_, body) in parts {
        out.extend_from_slice(body);
    }

    // Most servers embed the original `FF FF FF FF` response header at the
    // start of the reassembled split payload (fragment 0's body begins with
    // it), but not all do. Strip it only when present so the split path
    // yields the same "type byte + body" shape as the single-packet path.
    if out.starts_with(&[0xff, 0xff, 0xff, 0xff]) {
        out.drain(0..4);
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split_packet_id(id: u32, total: u8, index: u8, body: &[u8]) -> Vec<u8> {
        let mut v = vec![0xff, 0xff, 0xff, 0xfe];
        v.extend_from_slice(&id.to_le_bytes());
        v.push(total);
        v.push(index);
        v.extend_from_slice(&1248u16.to_le_bytes());
        v.extend_from_slice(body);
        v
    }

    fn split_packet(total: u8, index: u8, body: &[u8]) -> Vec<u8> {
        split_packet_id(1234, total, index, body)
    }

    #[test]
    fn recognises_a_single_packet() {
        let p = vec![0xff, 0xff, 0xff, 0xff, 0x49, 0x01];
        assert_eq!(classify_packet(&p).unwrap(), PacketKind::Single);
    }

    #[test]
    fn recognises_a_challenge() {
        let p = vec![0xff, 0xff, 0xff, 0xff, 0x41, 0xde, 0xad, 0xbe, 0xef];
        assert_eq!(
            classify_packet(&p).unwrap(),
            PacketKind::Challenge([0xde, 0xad, 0xbe, 0xef])
        );
    }

    #[test]
    fn recognises_a_split_packet() {
        let p = split_packet(3, 1, b"xyz");
        assert_eq!(
            classify_packet(&p).unwrap(),
            PacketKind::Split {
                id: 1234,
                total: 3,
                index: 1
            }
        );
    }

    #[test]
    fn reassembles_split_packets_in_index_order() {
        let packets = vec![
            split_packet(3, 2, b"CCC"),
            split_packet(3, 0, b"AAA"),
            split_packet(3, 1, b"BBB"),
        ];
        assert_eq!(reassemble_split(&packets).unwrap(), b"AAABBBCCC");
    }

    #[test]
    fn rejects_an_incomplete_split_set() {
        let packets = vec![split_packet(3, 0, b"AAA"), split_packet(3, 1, b"BBB")];
        assert_eq!(
            reassemble_split(&packets),
            Err(ParseError::IncompleteSplit { have: 2, total: 3 })
        );
    }

    #[test]
    fn a_single_packet_reassembles_to_its_own_body() {
        let packets = vec![vec![0xff, 0xff, 0xff, 0xff, 0x45, 0x02, 0x00]];
        assert_eq!(reassemble_split(&packets).unwrap(), vec![0x45, 0x02, 0x00]);
    }

    #[test]
    fn rejects_duplicate_indices() {
        let packets = vec![
            split_packet(3, 0, b"AAA"),
            split_packet(3, 0, b"AAA"),
            split_packet(3, 2, b"CCC"),
        ];
        assert!(matches!(
            reassemble_split(&packets),
            Err(ParseError::MalformedSplit { .. })
        ));
    }

    #[test]
    fn rejects_index_out_of_range() {
        let packets = vec![
            split_packet(3, 0, b"AAA"),
            split_packet(3, 1, b"BBB"),
            split_packet(3, 5, b"CCC"),
        ];
        assert!(matches!(
            reassemble_split(&packets),
            Err(ParseError::MalformedSplit { .. })
        ));
    }

    #[test]
    fn rejects_disagreeing_totals() {
        let packets = vec![
            split_packet(3, 0, b"AAA"),
            split_packet(2, 1, b"BBB"),
            split_packet(3, 2, b"CCC"),
        ];
        assert!(matches!(
            reassemble_split(&packets),
            Err(ParseError::MalformedSplit { .. })
        ));
    }

    #[test]
    fn rejects_stray_single_packet_in_split_set() {
        let packets = vec![
            split_packet(3, 0, b"AAA"),
            split_packet(3, 1, b"BBB"),
            vec![0xff, 0xff, 0xff, 0xff, 0x45, 0x02, 0x00],
            split_packet(3, 2, b"CCC"),
        ];
        assert!(matches!(
            reassemble_split(&packets),
            Err(ParseError::MalformedSplit { .. })
        ));
    }

    #[test]
    fn rejects_lone_challenge_packet() {
        let packets = vec![vec![
            0xff, 0xff, 0xff, 0xff, 0x41, 0xde, 0xad, 0xbe, 0xef,
        ]];
        assert!(matches!(
            reassemble_split(&packets),
            Err(ParseError::MalformedSplit { .. })
        ));
    }

    #[test]
    fn rejects_total_of_zero() {
        let mut v = vec![0xff, 0xff, 0xff, 0xfe];
        v.extend_from_slice(&1234u32.to_le_bytes());
        v.push(0); // total = 0
        v.push(0); // index = 0
        v.extend_from_slice(&1248u16.to_le_bytes());
        v.extend_from_slice(b"");
        let packets = vec![v];
        assert!(matches!(
            reassemble_split(&packets),
            Err(ParseError::MalformedSplit { .. })
        ));
    }

    #[test]
    fn strips_an_embedded_response_header_when_present() {
        let packets = vec![
            split_packet(2, 0, &[0xff, 0xff, 0xff, 0xff, 0x45, b'A', b'B']),
            split_packet(2, 1, b"CCC"),
        ];
        assert_eq!(reassemble_split(&packets).unwrap(), b"\x45ABCCC");
    }

    #[test]
    fn leaves_the_payload_untouched_when_no_header_is_embedded() {
        let packets = vec![split_packet(2, 0, b"AAA"), split_packet(2, 1, b"BBB")];
        assert_eq!(reassemble_split(&packets).unwrap(), b"AAABBB");
    }

    #[test]
    fn exposes_the_request_id() {
        let p = split_packet_id(0xdead_beef, 2, 0, b"AA");
        assert_eq!(
            classify_packet(&p).unwrap(),
            PacketKind::Split {
                id: 0xdead_beef,
                total: 2,
                index: 0
            }
        );
    }

    #[test]
    fn rejects_fragments_from_different_requests() {
        let packets = vec![
            split_packet_id(1000, 2, 0, b"AAA"),
            split_packet_id(2000, 2, 1, b"BBB"),
        ];
        assert_eq!(
            reassemble_split(&packets),
            Err(ParseError::SplitIdMismatch {
                expected: 1000,
                found: 2000
            })
        );
    }

    #[test]
    fn rejects_a_compressed_split_payload() {
        let packets = vec![
            split_packet_id(1000, 2, 0, b"AAA"),
            split_packet_id(0x8000_0001, 2, 1, b"BBB"),
        ];
        assert_eq!(
            reassemble_split(&packets),
            Err(ParseError::CompressedSplit { id: 0x8000_0001 })
        );
    }
}