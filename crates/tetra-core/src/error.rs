use thiserror::Error;

/// Failure decoding a raw A2S response.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ParseError {
    #[error("response truncated: needed {needed} bytes at offset {offset}, have {have}")]
    Truncated {
        offset: usize,
        needed: usize,
        have: usize,
    },
    #[error("unexpected response header 0x{0:02x}")]
    BadHeader(u8),
    #[error("string at offset {0} is not valid UTF-8")]
    BadUtf8(usize),
    #[error("unterminated string starting at offset {0}")]
    UnterminatedString(usize),
    #[error("split packet set is incomplete: have {have} of {total}")]
    IncompleteSplit { have: usize, total: usize },
    #[error("malformed split packet set: {reason}")]
    MalformedSplit { reason: String },
    #[error("split fragments belong to different requests: expected id {expected}, found {found}")]
    SplitIdMismatch { expected: u32, found: u32 },
    #[error("split payload for request {id} is compressed; decompression is not implemented")]
    CompressedSplit { id: u32 },
}

/// Failure decoding Bohemia's packed payload inside A2S_RULES.
///
/// `Unrecognised` is deliberately fatal. Emitting a partial mod list would
/// hand plausible-looking but wrong workshop IDs to the subscription logic.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum PackedError {
    #[error("no packed chunks present in rules response")]
    NoChunks,
    #[error("chunk {index} missing from a set of {total}")]
    MissingChunk { index: u8, total: u8 },
    #[error("payload does not match the known layout: {reason}")]
    Unrecognised { reason: String },
}

#[derive(Debug, Error)]
pub enum CoreError {
    #[error(transparent)]
    Parse(#[from] ParseError),
    #[error(transparent)]
    Packed(#[from] PackedError),
    #[error("network: {0}")]
    Io(#[from] std::io::Error),
}