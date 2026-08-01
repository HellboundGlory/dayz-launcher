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
        let start = self.pos;
        let end = self.buf[start..]
            .iter()
            .position(|&b| b == 0)
            .ok_or(ParseError::UnterminatedString(start))?
            + start;
        let s = String::from_utf8_lossy(&self.buf[start..end]).into_owned();
        self.pos = end + 1;
        Ok(s)
    }
}

/// Decode an A2S_INFO response, with or without the 4-byte single-packet header.
pub fn parse_info(buf: &[u8]) -> Result<ServerInfo, ParseError> {
    let body = if buf.len() >= 5 && buf[0..4] == [0xff, 0xff, 0xff, 0xff] {
        &buf[4..]
    } else {
        buf
    };
    if body.is_empty() {
        return Err(ParseError::Truncated {
            offset: 0,
            needed: 1,
            have: 0,
        });
    }
    if body[0] != 0x49 {
        return Err(ParseError::BadHeader(body[0]));
    }

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