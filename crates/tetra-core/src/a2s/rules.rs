use crate::a2s::{expect_kind, take_cstr};
use crate::error::ParseError;

/// Raw A2S_RULES key/value pairs, in the order the server sent them.
///
/// Values are `Vec<u8>` rather than `String` because DayZ's packed mod payload
/// travels through this type as arbitrary binary, not text.
pub type RulePairs = Vec<(Vec<u8>, Vec<u8>)>;

/// Decode an A2S_RULES response into raw key/value byte pairs.
///
/// Keys are returned as bytes, not strings: DayZ smuggles a binary payload
/// through this structure using two-byte keys that are not valid UTF-8.
pub fn parse_rules(buf: &[u8]) -> Result<RulePairs, ParseError> {
    let buf = expect_kind(buf, 0x45)?;
    let mut pos = 1usize;
    if pos + 2 > buf.len() {
        return Err(ParseError::Truncated {
            offset: pos,
            needed: 2,
            have: buf.len() - pos,
        });
    }
    let count = u16::from_le_bytes([buf[pos], buf[pos + 1]]) as usize;
    pos += 2;

    // Each pair needs at least two NUL bytes, so a tiny body cannot carry a
    // count-sized set; don't size the vector from the packet's count alone.
    let remaining = buf.len().saturating_sub(pos);
    let mut out = Vec::with_capacity(count.min(remaining / 2));
    for _ in 0..count {
        let key = take_cstr(buf, &mut pos)?.to_vec();
        let value = take_cstr(buf, &mut pos)?.to_vec();
        out.push((key, value));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_two_pairs() {
        let mut body = vec![0x45, 0x02, 0x00];
        body.extend_from_slice(b"mod_id\0 12345\0name\0Some Mod\0");
        assert_eq!(
            parse_rules(&body),
            Ok(vec![
                (b"mod_id".to_vec(), b" 12345".to_vec()),
                (b"name".to_vec(), b"Some Mod".to_vec()),
            ])
        );
    }

    #[test]
    fn rejects_a_count_larger_than_the_pairs_present() {
        let body = vec![0x45, 0x05, 0x00, b'a', 0, b'b', 0];
        assert_eq!(parse_rules(&body), Err(ParseError::UnterminatedString(7)));
    }

    #[test]
    fn rejects_a_missing_header() {
        assert_eq!(
            parse_rules(&[0x44, 0x00, 0x00]),
            Err(ParseError::BadHeader(0x44))
        );
    }

    #[test]
    fn rejects_a_bare_single_packet_header() {
        assert_eq!(
            parse_rules(&[0xff, 0xff, 0xff, 0xff]),
            Err(ParseError::Truncated {
                offset: 0,
                needed: 1,
                have: 0,
            })
        );
    }
}
