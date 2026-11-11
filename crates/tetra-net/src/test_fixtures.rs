//! Reply builders shared by the query and prober tests.

/// A successful A2S_INFO response a fake server can send back.
pub(crate) fn info_response() -> Vec<u8> {
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

pub(crate) fn challenge_response() -> Vec<u8> {
    vec![0xff, 0xff, 0xff, 0xff, 0x41, 0xde, 0xad, 0xbe, 0xef]
}
