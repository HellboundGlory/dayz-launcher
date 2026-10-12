pub mod dayz;
pub mod info;
pub mod packet;
pub mod rules;

use crate::error::ParseError;

/// Drop the 4-byte `FF FF FF FF` single-packet header when the buffer carries it.
pub(crate) fn strip_single_header(buf: &[u8]) -> &[u8] {
    if buf.len() >= 4 && buf[0..4] == [0xff, 0xff, 0xff, 0xff] {
        &buf[4..]
    } else {
        buf
    }
}

/// The response without its single-packet header, checked to start with `kind`.
pub(crate) fn expect_kind(buf: &[u8], kind: u8) -> Result<&[u8], ParseError> {
    let buf = strip_single_header(buf);
    match buf.first() {
        None => Err(ParseError::Truncated {
            offset: 0,
            needed: 1,
            have: 0,
        }),
        Some(&b) if b == kind => Ok(buf),
        Some(&b) => Err(ParseError::BadHeader(b)),
    }
}

/// Bytes up to the next NUL, with `pos` left just past it.
pub(crate) fn take_cstr<'a>(buf: &'a [u8], pos: &mut usize) -> Result<&'a [u8], ParseError> {
    let start = *pos;
    let end = buf
        .get(start..)
        .and_then(|s| s.iter().position(|&b| b == 0))
        .ok_or(ParseError::UnterminatedString(start))?
        + start;
    *pos = end + 1;
    Ok(&buf[start..end])
}
