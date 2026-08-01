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
    let mut pos = 0usize;
    if buf.len() >= 4 && buf[0..4] == [0xff, 0xff, 0xff, 0xff] {
        pos = 4;
    }
    if pos >= buf.len() {
        return Err(ParseError::Truncated {
            offset: pos,
            needed: 1,
            have: 0,
        });
    }
    if buf[pos] == 0x45 {
        pos += 1;
    } else {
        return Err(ParseError::BadHeader(buf[pos]));
    }
    if pos + 2 > buf.len() {
        return Err(ParseError::Truncated {
            offset: pos,
            needed: 2,
            have: buf.len() - pos,
        });
    }
    let count = u16::from_le_bytes([buf[pos], buf[pos + 1]]) as usize;
    pos += 2;

    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let key = take_cstr(buf, &mut pos)?;
        let value = take_cstr(buf, &mut pos)?;
        out.push((key, value));
    }
    Ok(out)
}

fn take_cstr(buf: &[u8], pos: &mut usize) -> Result<Vec<u8>, ParseError> {
    let start = *pos;
    let end = buf
        .get(start..)
        .and_then(|s| s.iter().position(|&b| b == 0))
        .ok_or(ParseError::UnterminatedString(start))?
        + start;
    *pos = end + 1;
    Ok(buf[start..end].to_vec())
}
