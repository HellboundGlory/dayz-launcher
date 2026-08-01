use crate::error::PackedError;

/// Reverse Bohemia's escaping. Only `0x01` introduces an escape:
/// `0x01 0x01` -> `0x01`, `0x01 0x02` -> `0x00`, `0x01 0x03` -> `0xFF`.
///
/// `0x00` is escaped because A2S_RULES values are NUL-terminated C strings:
/// it is the one byte that cannot appear literally. Confirmed against 48
/// real-server fixtures: 37/48 end their concatenated payload in `01 02`,
/// and decoding that pair as `0x00` (an empty description) makes every one
/// of them consume the buffer exactly. `0x01 0x03 -> 0xFF` is confirmed the
/// same way: three independently-captured, independently-named mods
/// (DayZ-Expansion-Licensed, DayZ-Expansion-Bundle, SFP) each carry a
/// `01 03` pair inside their workshop ID, and decoding it as `0xFF`
/// reproduces each mod's real, verified Steam Workshop ID exactly; decoding
/// it as `0x03` does not match any of them.
fn unescape(src: &[u8]) -> Result<Vec<u8>, PackedError> {
    let mut out = Vec::with_capacity(src.len());
    let mut i = 0;
    while i < src.len() {
        if src[i] == 0x01 {
            if i + 1 >= src.len() {
                return Err(PackedError::Unrecognised {
                    reason: "trailing escape byte 0x01 at end of chunk".to_string(),
                });
            }
            i += 1;
            match src[i] {
                0x01 => out.push(0x01),
                0x02 => out.push(0x00),
                0x03 => out.push(0xFF),
                unknown => {
                    return Err(PackedError::Unrecognised {
                        reason: format!(
                            "unknown escape sequence 0x01 0x{:02x} at offset {}",
                            unknown,
                            i - 1
                        ),
                    });
                }
            }
        } else {
            out.push(src[i]);
        }
        i += 1;
    }
    Ok(out)
}

/// Collect the two-byte-keyed chunks from a rules set, order them and
/// concatenate their raw values, THEN unescape the whole buffer once.
///
/// Key byte 0 is the 1-based chunk index; key byte 1 is the total count.
///
/// Bohemia escapes the payload before chunking it: the escaped byte stream is
/// split into fixed-size pieces without regard to escape-pair boundaries. That
/// means a `0x01` escape marker can legitimately be the last byte of one chunk
/// while the byte it escapes is the first byte of the next. Unescaping each
/// chunk in isolation cannot see across that boundary and would misread a
/// mid-payload escape pair as a dangling trailing marker, rejecting a
/// perfectly healthy payload. Concatenate first, unescape once.
pub fn reassemble_chunks(rules: &[(Vec<u8>, Vec<u8>)]) -> Result<Vec<u8>, PackedError> {
    let mut chunks: Vec<(u8, u8, &Vec<u8>)> = rules
        .iter()
        .filter(|(k, _)| k.len() == 2)
        .map(|(k, v)| (k[0], k[1], v))
        .collect();

    if chunks.is_empty() {
        return Err(PackedError::NoChunks);
    }
    chunks.sort_by_key(|(index, _, _)| *index);

    // Validation: all chunks must have the same total
    let total = chunks[0].1;
    for (_, chunk_total, _) in &chunks {
        if *chunk_total != total {
            return Err(PackedError::Unrecognised {
                reason: "chunks have disagreeing total counts".to_string(),
            });
        }
    }

    // Validation: total must be >= 1
    if total == 0 {
        return Err(PackedError::Unrecognised {
            reason: "total chunk count is 0".to_string(),
        });
    }

    // Validation: all indices must be in 1..=total
    for (index, _, _) in &chunks {
        if *index < 1 || *index > total {
            return Err(PackedError::Unrecognised {
                reason: format!("chunk index {} is not in range 1..={}", index, total),
            });
        }
    }

    // Validation: no duplicate indices
    for i in 0..chunks.len() {
        for j in (i + 1)..chunks.len() {
            if chunks[i].0 == chunks[j].0 {
                return Err(PackedError::Unrecognised {
                    reason: format!("duplicate chunk index {}", chunks[i].0),
                });
            }
        }
    }

    // Validation: every index in 1..=total must be present
    for expected in 1..=total {
        if !chunks.iter().any(|(index, _, _)| *index == expected) {
            return Err(PackedError::MissingChunk {
                index: expected,
                total,
            });
        }
    }

    // Concatenate the ordered raw (still-escaped) chunk values first, then
    // unescape the whole buffer once.
    let mut escaped = Vec::new();
    for (_, _, value) in &chunks {
        escaped.extend_from_slice(value);
    }
    let out = unescape(&escaped)?;
    Ok(out)
}

use crate::a2s::rules::parse_rules;

/// One workshop mod required by a server. Position in `PackedPayload::mods`
/// is the server's declared load order and must be preserved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerMod {
    pub workshop_id: u64,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackedPayload {
    pub protocol: u8,
    pub mods: Vec<ServerMod>,
    pub signing_keys: Vec<String>,
    pub description: String,
}

struct P<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> P<'a> {
    fn u8(&mut self) -> Result<u8, PackedError> {
        let v = *self
            .b
            .get(self.i)
            .ok_or_else(|| PackedError::Unrecognised {
                reason: format!("ran out of bytes at offset {}", self.i),
            })?;
        self.i += 1;
        Ok(v)
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], PackedError> {
        let s = self
            .b
            .get(self.i..self.i + n)
            .ok_or_else(|| PackedError::Unrecognised {
                reason: format!(
                    "needed {n} bytes at offset {}, have {}",
                    self.i,
                    self.b.len() - self.i.min(self.b.len())
                ),
            })?;
        self.i += n;
        Ok(s)
    }

    fn lp_string(&mut self, what: &str) -> Result<String, PackedError> {
        let len = self.u8()? as usize;
        let raw = self.take(len)?;
        std::str::from_utf8(raw)
            .map(str::to_owned)
            .map_err(|_| PackedError::Unrecognised {
                reason: format!("{what} at offset {} is not valid UTF-8", self.i - len),
            })
    }
}

/// Decode the reassembled packed payload.
///
/// Validation is strict and every failure is fatal. A speculative parse of an
/// unknown layout produces workshop IDs that look real, and the subscription
/// logic downstream cannot tell them apart from genuine ones.
pub fn parse_packed(payload: &[u8]) -> Result<PackedPayload, PackedError> {
    let mut p = P { b: payload, i: 0 };

    let protocol = p.u8()?;
    if protocol != 2 {
        return Err(PackedError::Unrecognised {
            reason: format!("unsupported packed protocol version {protocol}"),
        });
    }
    // Flags byte (1 byte) + DLC mask (2 bytes little-endian)
    let flags = p.take(3)?;
    let flag_bits = flags[0];
    let dlc_mask = u16::from_le_bytes([flags[1], flags[2]]);
    if dlc_mask != 0 {
        return Err(PackedError::Unrecognised {
            reason: format!(
                "dlc mask {dlc_mask:#06x} is non-zero, so a DLC block precedes the mod list \
                 and this parser cannot read it (no such specimen has ever been captured)"
            ),
        });
    }

    let description_may_be_absent = flag_bits & 0x08 != 0;
    let mod_count = p.u8()? as usize;

    let mut mods = Vec::with_capacity(mod_count);
    for n in 0..mod_count {
        let _hash = p.take(4)?;
        let id_len = p.u8()?;
        let workshop_id = match id_len {
            1 => p.u8()? as u64,
            2 => {
                let b = p.take(2)?;
                u16::from_le_bytes([b[0], b[1]]) as u64
            }
            4 => {
                let b = p.take(4)?;
                u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as u64
            }
            other => {
                return Err(PackedError::Unrecognised {
                    reason: format!("mod {n} has invalid steam id length {other}"),
                })
            }
        };
        let name = p.lp_string(&format!("mod {n} name"))?;
        mods.push(ServerMod { workshop_id, name });
    }

    let key_count = p.u8()? as usize;
    let mut signing_keys = Vec::with_capacity(key_count);
    for n in 0..key_count {
        signing_keys.push(p.lp_string(&format!("signing key {n}"))?);
    }

    // Description may be absent only when flags permit AND buffer ends here.
    let description = if description_may_be_absent && p.i == payload.len() {
        String::new()
    } else {
        p.lp_string("description")?
    };

    // Exact consumption guard
    if p.i != payload.len() {
        return Err(PackedError::Unrecognised {
            reason: format!("{} trailing bytes after description", payload.len() - p.i),
        });
    }

    Ok(PackedPayload {
        protocol,
        mods,
        signing_keys,
        description,
    })
}

/// Convenience entry point: raw A2S_RULES response to decoded payload.
pub fn parse_dayz_rules(response: &[u8]) -> Result<PackedPayload, PackedError> {
    let rules = parse_rules(response).map_err(|e| PackedError::Unrecognised {
        reason: format!("rules response did not decode: {e}"),
    })?;
    let payload = reassemble_chunks(&rules)?;
    parse_packed(&payload)
}

#[cfg(test)]
mod tests {
    use super::{parse_packed, reassemble_chunks, unescape};
    use crate::error::PackedError;

    fn pair(k: &[u8], v: &[u8]) -> (Vec<u8>, Vec<u8>) {
        (k.to_vec(), v.to_vec())
    }

    #[test]
    fn orders_chunks_by_index_not_by_total() {
        let rules = vec![
            pair(&[3, 3], b"CCC"),
            pair(&[1, 3], b"AAA"),
            pair(&[2, 3], b"BBB"),
            pair(b"island", b"chernarusplus"),
        ];
        assert_eq!(reassemble_chunks(&rules).unwrap(), b"AAABBBCCC");
    }

    #[test]
    fn applies_the_three_escape_sequences() {
        let rules = vec![pair(
            &[1, 1],
            &[0xAA, 0x01, 0x01, 0x01, 0x02, 0x01, 0x03, 0xBB],
        )];
        assert_eq!(
            reassemble_chunks(&rules).unwrap(),
            vec![0xAA, 0x01, 0x00, 0xFF, 0xBB]
        );
    }

    #[test]
    fn unescape_maps_0x01_0x02_to_nul() {
        assert_eq!(
            unescape(&[0xAA, 0x01, 0x02, 0xBB]).unwrap(),
            vec![0xAA, 0x00, 0xBB]
        );
    }

    #[test]
    fn unescape_maps_0x01_0x03_to_0xff() {
        assert_eq!(
            unescape(&[0xAA, 0x01, 0x03, 0xBB]).unwrap(),
            vec![0xAA, 0xFF, 0xBB]
        );
    }

    #[test]
    fn unescapes_an_escape_pair_that_straddles_a_chunk_boundary() {
        let rules = vec![pair(&[1, 2], &[0xAA, 0x01]), pair(&[2, 2], &[0x02, 0xBB])];
        assert_eq!(reassemble_chunks(&rules).unwrap(), vec![0xAA, 0x00, 0xBB]);
    }

    #[test]
    fn rejects_a_missing_chunk() {
        let rules = vec![pair(&[1, 3], b"AAA"), pair(&[3, 3], b"CCC")];
        assert_eq!(
            reassemble_chunks(&rules),
            Err(PackedError::MissingChunk { index: 2, total: 3 })
        );
    }

    #[test]
    fn rejects_a_rules_set_with_no_chunks() {
        let rules = vec![pair(b"island", b"chernarusplus")];
        assert_eq!(reassemble_chunks(&rules), Err(PackedError::NoChunks));
    }

    #[test]
    fn rejects_unknown_escape_byte() {
        let rules = vec![pair(&[1, 1], &[0x01, 0x05])];
        assert!(matches!(
            reassemble_chunks(&rules),
            Err(PackedError::Unrecognised { .. })
        ));
    }

    #[test]
    fn rejects_dangling_trailing_escape_marker() {
        let rules = vec![pair(&[1, 1], &[0xAA, 0x01])];
        assert!(matches!(
            reassemble_chunks(&rules),
            Err(PackedError::Unrecognised { .. })
        ));
    }

    #[test]
    fn rejects_disagreeing_totals() {
        let rules = vec![
            pair(&[1, 3], b"AAA"),
            pair(&[2, 4], b"BBB"),
            pair(&[3, 3], b"CCC"),
        ];
        assert!(matches!(
            reassemble_chunks(&rules),
            Err(PackedError::Unrecognised { .. })
        ));
    }

    #[test]
    fn rejects_index_exceeding_total() {
        let rules = vec![
            pair(&[1, 3], b"AAA"),
            pair(&[2, 3], b"BBB"),
            pair(&[3, 3], b"CCC"),
            pair(&[4, 3], b"DDD"),
        ];
        assert!(matches!(
            reassemble_chunks(&rules),
            Err(PackedError::Unrecognised { .. })
        ));
    }

    #[test]
    fn rejects_duplicate_index() {
        let rules = vec![
            pair(&[1, 3], b"AAA"),
            pair(&[1, 3], b"AAA_DUP"),
            pair(&[2, 3], b"BBB"),
            pair(&[3, 3], b"CCC"),
        ];
        assert!(matches!(
            reassemble_chunks(&rules),
            Err(PackedError::Unrecognised { .. })
        ));
    }

    #[test]
    fn rejects_index_zero() {
        let rules = vec![
            pair(&[0, 3], b"ZERO"),
            pair(&[1, 3], b"AAA"),
            pair(&[2, 3], b"BBB"),
            pair(&[3, 3], b"CCC"),
        ];
        assert!(matches!(
            reassemble_chunks(&rules),
            Err(PackedError::Unrecognised { .. })
        ));
    }

    #[test]
    fn rejects_total_zero() {
        let rules = vec![pair(&[1, 0], b"AAA")];
        assert!(matches!(
            reassemble_chunks(&rules),
            Err(PackedError::Unrecognised { .. })
        ));
    }

    #[test]
    fn rejects_id_len_three_as_uncharacterised_rather_than_aliasing_to_u32() {
        let payload = vec![
            0x02, // protocol
            0x00, 0x00, 0x00, // flags
            0x01, // mod_count
            0x00, 0x00, 0x00, 0x00, // hash
            0x03, // id_len = 3
            0xAA, 0xBB, 0xCC, // filler
            0x04, b't', b'e', b's', b't', // name
        ];
        let err = parse_packed(&payload).expect_err("id_len 3 is uncharacterised");
        assert!(
            err.to_string().contains("invalid steam id length 3"),
            "must reject id_len 3 explicitly: {err}"
        );
    }

    #[test]
    fn escaped_nul_in_workshop_id_decodes_to_the_correct_value() {
        let decoded: Vec<u8> = {
            let mut v = vec![
                0x02, // protocol
                0x00, 0x00, 0x00, // flags = 0, dlc_mask = 0
                0x01, // mod_count
                0x11, 0x22, 0x33, 0x44, // hash
                0x04, // id_len = 4
            ];
            v.extend_from_slice(&[0x00, 0x11, 0x22, 0x33]);
            v.push(4);
            v.extend_from_slice(b"test");
            v.push(0); // key_count = 0
            v.push(0); // description length = 0
            v
        };

        fn escape_for_wire(bytes: &[u8]) -> Vec<u8> {
            let mut out = Vec::new();
            for &b in bytes {
                match b {
                    0x00 => out.extend_from_slice(&[0x01, 0x02]),
                    0x01 => out.extend_from_slice(&[0x01, 0x01]),
                    other => out.push(other),
                }
            }
            out
        }

        let wire = escape_for_wire(&decoded);
        let rules = vec![pair(&[1, 1], &wire)];
        let payload = reassemble_chunks(&rules).expect("wire-escaped payload should reassemble");
        assert_eq!(payload, decoded);

        let parsed = parse_packed(&payload).expect("payload should parse");
        assert_eq!(parsed.mods.len(), 1);
        assert_eq!(parsed.mods[0].workshop_id, 0x33221100);
        assert_eq!(parsed.mods[0].name, "test");
    }

    fn payload_with(flag_bits: u8, tail: &[u8]) -> Vec<u8> {
        let mut v = vec![0x02, flag_bits, 0x00, 0x00, 0x00, 0x01, 0x04];
        v.extend_from_slice(b"dayz");
        v.extend_from_slice(tail);
        v
    }

    #[test]
    fn a_flagged_payload_may_end_after_the_signing_keys() {
        let p = parse_packed(&payload_with(0x08, &[])).expect("bit 3 permits absent description");
        assert_eq!(p.description, "");
        assert_eq!(p.signing_keys, vec!["dayz".to_string()]);
    }

    #[test]
    fn the_same_payload_without_the_flag_is_still_rejected() {
        let err = parse_packed(&payload_with(0x00, &[]))
            .expect_err("without bit 3 an absent description is truncation");
        assert!(err.to_string().contains("ran out of bytes"));
    }

    #[test]
    fn a_flagged_payload_that_does_carry_a_description_still_parses_it() {
        let p = parse_packed(&payload_with(0x08, &[0x02, b'h', b'i'])).expect("should parse");
        assert_eq!(p.description, "hi");
    }

    #[test]
    fn a_flagged_payload_with_trailing_junk_is_still_rejected() {
        assert!(parse_packed(&payload_with(0x08, &[0x05, 0xAA])).is_err());
        let err = parse_packed(&payload_with(0x08, &[0x00, 0xAA]))
            .expect_err("a trailing byte after a valid description must be rejected");
        assert!(err.to_string().contains("trailing"));
    }

    #[test]
    fn a_non_zero_dlc_mask_is_rejected_rather_than_misparsed() {
        let mut v = payload_with(0x08, &[]);
        v[2] = 0x01;
        let err = parse_packed(&v).expect_err("a non-zero dlc mask must not be ignored");
        assert!(err.to_string().contains("dlc mask"));
    }
}
