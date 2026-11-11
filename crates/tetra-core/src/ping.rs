/// Where a server's `ping_ms` came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PingKind {
    /// A reply to an ICMP echo, or a ping this client measured some other way.
    #[default]
    Measured,
    /// Derived from A2S reply times when the server does not answer pings.
    Estimated,
    /// An estimate from a DDoS protection service that answered without the
    /// challenge the game server itself would have sent.
    Protected,
}

impl PingKind {
    pub fn to_db(self) -> i64 {
        match self {
            PingKind::Measured => 0,
            PingKind::Estimated => 1,
            PingKind::Protected => 2,
        }
    }

    /// Anything unrecognised reads as [`PingKind::Measured`], so a value from a
    /// newer build still renders as an ordinary number.
    pub fn from_db(value: i64) -> PingKind {
        match value {
            1 => PingKind::Estimated,
            2 => PingKind::Protected,
            _ => PingKind::Measured,
        }
    }
}
