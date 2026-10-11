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
                        reason: format!("packets disagree on total: expected {}, got {}", total, t),
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
    fn classifies_packet_kinds() {
        let cases: &[(&str, Vec<u8>, PacketKind)] = &[
            (
                "single",
                vec![0xff, 0xff, 0xff, 0xff, 0x49, 0x01],
                PacketKind::Single,
            ),
            (
                "challenge",
                vec![0xff, 0xff, 0xff, 0xff, 0x41, 0xde, 0xad, 0xbe, 0xef],
                PacketKind::Challenge([0xde, 0xad, 0xbe, 0xef]),
            ),
            (
                "split",
                split_packet(3, 1, b"xyz"),
                PacketKind::Split {
                    id: 1234,
                    total: 3,
                    index: 1,
                },
            ),
            (
                "split answering another request",
                split_packet_id(0xdead_beef, 2, 0, b"AA"),
                PacketKind::Split {
                    id: 0xdead_beef,
                    total: 2,
                    index: 0,
                },
            ),
        ];
        for (name, packet, expected) in cases {
            assert_eq!(classify_packet(packet).unwrap(), *expected, "{name}");
        }
    }

    type Reassembly = (&'static str, Vec<Vec<u8>>, &'static [u8]);
    type Rejection = (&'static str, Vec<Vec<u8>>, fn(&ParseError) -> bool);

    #[test]
    fn reassembles_split_packets() {
        let cases: &[Reassembly] = &[
            (
                "in index order",
                vec![
                    split_packet(3, 2, b"CCC"),
                    split_packet(3, 0, b"AAA"),
                    split_packet(3, 1, b"BBB"),
                ],
                b"AAABBBCCC",
            ),
            (
                "a single packet yields its own body",
                vec![vec![0xff, 0xff, 0xff, 0xff, 0x45, 0x02, 0x00]],
                &[0x45, 0x02, 0x00],
            ),
            (
                "stripping an embedded response header",
                vec![
                    split_packet(2, 0, &[0xff, 0xff, 0xff, 0xff, 0x45, b'A', b'B']),
                    split_packet(2, 1, b"CCC"),
                ],
                b"\x45ABCCC",
            ),
            (
                "leaving a payload that carries no header",
                vec![split_packet(2, 0, b"AAA"), split_packet(2, 1, b"BBB")],
                b"AAABBB",
            ),
        ];
        for (name, packets, expected) in cases {
            assert_eq!(reassemble_split(packets).unwrap(), *expected, "{name}");
        }
    }

    #[test]
    fn rejects_malformed_split_sets() {
        let cases: Vec<Rejection> = vec![
            (
                "an incomplete set",
                vec![split_packet(3, 0, b"AAA"), split_packet(3, 1, b"BBB")],
                |e| matches!(e, ParseError::IncompleteSplit { have: 2, total: 3 }),
            ),
            (
                "a duplicate index",
                vec![
                    split_packet(3, 0, b"AAA"),
                    split_packet(3, 0, b"AAA"),
                    split_packet(3, 2, b"CCC"),
                ],
                |e| matches!(e, ParseError::MalformedSplit { .. }),
            ),
            (
                "an index out of range",
                vec![
                    split_packet(3, 0, b"AAA"),
                    split_packet(3, 1, b"BBB"),
                    split_packet(3, 5, b"CCC"),
                ],
                |e| matches!(e, ParseError::MalformedSplit { .. }),
            ),
            (
                "disagreeing totals",
                vec![
                    split_packet(3, 0, b"AAA"),
                    split_packet(2, 1, b"BBB"),
                    split_packet(3, 2, b"CCC"),
                ],
                |e| matches!(e, ParseError::MalformedSplit { .. }),
            ),
            (
                "a stray single packet inside the set",
                vec![
                    split_packet(3, 0, b"AAA"),
                    split_packet(3, 1, b"BBB"),
                    vec![0xff, 0xff, 0xff, 0xff, 0x45, 0x02, 0x00],
                    split_packet(3, 2, b"CCC"),
                ],
                |e| matches!(e, ParseError::MalformedSplit { .. }),
            ),
            (
                "a lone challenge packet",
                vec![vec![0xff, 0xff, 0xff, 0xff, 0x41, 0xde, 0xad, 0xbe, 0xef]],
                |e| matches!(e, ParseError::MalformedSplit { .. }),
            ),
            ("a total of zero", vec![split_packet(0, 0, b"")], |e| {
                matches!(e, ParseError::MalformedSplit { .. })
            }),
            (
                "fragments from different requests",
                vec![
                    split_packet_id(1000, 2, 0, b"AAA"),
                    split_packet_id(2000, 2, 1, b"BBB"),
                ],
                |e| {
                    matches!(
                        e,
                        ParseError::SplitIdMismatch {
                            expected: 1000,
                            found: 2000
                        }
                    )
                },
            ),
            (
                "a compressed payload",
                vec![
                    split_packet_id(1000, 2, 0, b"AAA"),
                    split_packet_id(0x8000_0001, 2, 1, b"BBB"),
                ],
                |e| matches!(e, ParseError::CompressedSplit { id: 0x8000_0001 }),
            ),
        ];
        for (name, packets, expected) in cases {
            let err = reassemble_split(&packets).expect_err(name);
            assert!(expected(&err), "{name}: {err}");
        }
    }
}
