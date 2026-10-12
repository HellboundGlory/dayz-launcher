use crate::a2s::{expect_kind, take_cstr};
use crate::error::ParseError;

/// Decoded A2S_INFO response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerInfo {
    pub protocol: u8,
    pub name: String,
    pub map: String,
    pub folder: String,
    pub game: String,
    pub app_id: u16,
    pub players: u8,
    pub max_players: u8,
    pub bots: u8,
    pub server_type: u8,
    pub environment: u8,
    /// 0 = public, 1 = password protected. DayZ calls these "locked".
    pub visibility: u8,
    pub vac: u8,
    pub version: String,
    pub game_port: Option<u16>,
    pub steam_id: Option<u64>,
    pub keywords: Option<String>,
    pub game_id: Option<u64>,
}

/// Cursor that refuses to read past the end of the buffer.
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    fn need(&self, n: usize) -> Result<(), ParseError> {
        if self.pos + n > self.buf.len() {
            return Err(ParseError::Truncated {
                offset: self.pos,
                needed: n,
                have: self.buf.len().saturating_sub(self.pos),
            });
        }
        Ok(())
    }

    fn u8(&mut self) -> Result<u8, ParseError> {
        self.need(1)?;
        let v = self.buf[self.pos];
        self.pos += 1;
        Ok(v)
    }

    fn u16(&mut self) -> Result<u16, ParseError> {
        self.need(2)?;
        let v = u16::from_le_bytes([self.buf[self.pos], self.buf[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }

    fn u64(&mut self) -> Result<u64, ParseError> {
        self.need(8)?;
        let mut a = [0u8; 8];
        a.copy_from_slice(&self.buf[self.pos..self.pos + 8]);
        self.pos += 8;
        Ok(u64::from_le_bytes(a))
    }

    /// Null-terminated string. DayZ server names contain arbitrary user input,
    /// so invalid UTF-8 is replaced rather than rejected — a mangled name is
    /// still a usable row, whereas a hard error would hide the server entirely.
    fn cstr(&mut self) -> Result<String, ParseError> {
        let raw = take_cstr(self.buf, &mut self.pos)?;
        Ok(String::from_utf8_lossy(raw).into_owned())
    }
}

/// Decode an A2S_INFO response, with or without the 4-byte single-packet header.
pub fn parse_info(buf: &[u8]) -> Result<ServerInfo, ParseError> {
    let body = expect_kind(buf, 0x49)?;

    let mut r = Reader::new(&body[1..]);
    let protocol = r.u8()?;
    let name = r.cstr()?;
    let map = r.cstr()?;
    let folder = r.cstr()?;
    let game = r.cstr()?;
    let app_id = r.u16()?;
    let players = r.u8()?;
    let max_players = r.u8()?;
    let bots = r.u8()?;
    let server_type = r.u8()?;
    let environment = r.u8()?;
    let visibility = r.u8()?;
    let vac = r.u8()?;
    let version = r.cstr()?;

    let mut info = ServerInfo {
        protocol,
        name,
        map,
        folder,
        game,
        app_id,
        players,
        max_players,
        bots,
        server_type,
        environment,
        visibility,
        vac,
        version,
        game_port: None,
        steam_id: None,
        keywords: None,
        game_id: None,
    };

    // The extra data field is optional; its absence is not an error.
    let edf = match r.u8() {
        Ok(v) => v,
        Err(_) => return Ok(info),
    };
    if edf & 0x80 != 0 {
        info.game_port = Some(r.u16()?);
    }
    if edf & 0x10 != 0 {
        info.steam_id = Some(r.u64()?);
    }
    if edf & 0x40 != 0 {
        // Spectator port then spectator name; neither is useful to us.
        let _ = r.u16()?;
        let _ = r.cstr()?;
    }
    if edf & 0x20 != 0 {
        info.keywords = Some(r.cstr()?);
    }
    if edf & 0x01 != 0 {
        info.game_id = Some(r.u64()?);
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body() -> Vec<u8> {
        let mut b = vec![0x49, 17];
        b.extend_from_slice(b"Server\0");
        b.extend_from_slice(b"chernarusplus\0");
        b.extend_from_slice(b"dayz\0");
        b.extend_from_slice(b"DayZ\0");
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&[5, 60, 0, 0, 1, 0, 0]);
        b.extend_from_slice(b"1.0\0");
        b
    }

    fn info() -> ServerInfo {
        ServerInfo {
            protocol: 17,
            name: "Server".into(),
            map: "chernarusplus".into(),
            folder: "dayz".into(),
            game: "DayZ".into(),
            app_id: 1,
            players: 5,
            max_players: 60,
            bots: 0,
            server_type: 0,
            environment: 1,
            visibility: 0,
            vac: 0,
            version: "1.0".into(),
            game_port: None,
            steam_id: None,
            keywords: None,
            game_id: None,
        }
    }

    #[test]
    fn decodes_a_body_without_extra_data() {
        for prefix in [&[][..], &[0xff, 0xff, 0xff, 0xff][..]] {
            let mut packet = prefix.to_vec();
            packet.extend_from_slice(&body());
            assert_eq!(parse_info(&packet), Ok(info()));
        }
    }

    #[test]
    fn decodes_the_extra_data_fields() {
        let mut cases: Vec<(Vec<u8>, ServerInfo)> = Vec::new();

        let mut b = vec![0x80];
        b.extend_from_slice(&27015u16.to_le_bytes());
        let mut e = info();
        e.game_port = Some(27015);
        cases.push((b, e));

        let mut b = vec![0x10];
        b.extend_from_slice(&76561198000000000u64.to_le_bytes());
        let mut e = info();
        e.steam_id = Some(76561198000000000);
        cases.push((b, e));

        // Spectator port and name are parsed and discarded.
        let mut b = vec![0x40];
        b.extend_from_slice(&27016u16.to_le_bytes());
        b.extend_from_slice(b"Spectator\0");
        cases.push((b, info()));

        let mut b = vec![0x20];
        b.extend_from_slice(b"hardcore\0");
        let mut e = info();
        e.keywords = Some("hardcore".into());
        cases.push((b, e));

        let mut b = vec![0x01];
        b.extend_from_slice(&123456789u64.to_le_bytes());
        let mut e = info();
        e.game_id = Some(123456789);
        cases.push((b, e));

        let mut b = vec![0xf1];
        b.extend_from_slice(&27015u16.to_le_bytes());
        b.extend_from_slice(&76561198000000000u64.to_le_bytes());
        b.extend_from_slice(&27016u16.to_le_bytes());
        b.extend_from_slice(b"Spectator\0");
        b.extend_from_slice(b"hardcore\0");
        b.extend_from_slice(&123456789u64.to_le_bytes());
        let mut e = info();
        e.game_port = Some(27015);
        e.steam_id = Some(76561198000000000);
        e.keywords = Some("hardcore".into());
        e.game_id = Some(123456789);
        cases.push((b, e));

        for (suffix, expected) in cases {
            let mut packet = body();
            packet.extend_from_slice(&suffix);
            assert_eq!(parse_info(&packet), Ok(expected), "suffix {suffix:?}");
        }
    }

    #[test]
    fn rejects_a_body_truncated_mid_field() {
        let mut packet = vec![0x49, 17];
        packet.extend_from_slice(b"Server\0chernarusplus\0dayz\0DayZ\0");
        packet.push(0x01);
        assert!(matches!(
            parse_info(&packet),
            Err(ParseError::Truncated { .. })
        ));
    }

    #[test]
    fn rejects_a_name_without_a_nul() {
        let mut packet = vec![0x49, 17];
        packet.extend_from_slice(b"Server");
        assert!(matches!(
            parse_info(&packet),
            Err(ParseError::UnterminatedString(_))
        ));
    }

    #[test]
    fn replaces_invalid_utf8_in_a_name() {
        let mut packet = body();
        packet[2..8].copy_from_slice(&[0xff, 0xfe, b'A', b'B', b'C', 0x80]);
        let decoded = parse_info(&packet).unwrap();
        assert_eq!(decoded.name, "\u{fffd}\u{fffd}ABC\u{fffd}");
        assert_eq!(decoded.map, "chernarusplus");
    }

    #[test]
    fn rejects_a_wrong_header() {
        let mut packet = body();
        packet[0] = 0x45;
        assert_eq!(parse_info(&packet), Err(ParseError::BadHeader(0x45)));
    }

    #[test]
    fn rejects_a_bare_single_packet_header() {
        assert_eq!(
            parse_info(&[0xff, 0xff, 0xff, 0xff]),
            Err(ParseError::Truncated {
                offset: 0,
                needed: 1,
                have: 0,
            })
        );
    }
}
