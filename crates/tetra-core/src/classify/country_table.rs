//! The packed IPv4-to-country table the launcher reads at compile time.
//!
//! A record holds the first address of its range and the country that covers it up to the byte
//! before the next record's start, so the table has no end fields and no gaps.

use std::net::Ipv4Addr;
use thiserror::Error;

/// First four bytes of the file.
pub const MAGIC: [u8; 4] = *b"TGEO";
/// Bytes per record: a `u32` range start, then the country code.
pub const RECORD_LEN: usize = 6;
/// Bytes before the first record: the magic and the record count.
const HEADER_LEN: usize = MAGIC.len() + 4;

/// Stands for a range that belongs to no country: reserved, private, or unassigned.
const NO_COUNTRY: [u8; 2] = *b"ZZ";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TableError {
    #[error("not a country table")]
    Magic,
    #[error("table has no records")]
    Empty,
    #[error("table is {0} bytes, too short for a header")]
    Header(usize),
    #[error("table is {len} bytes, header says {count} records")]
    Length { len: usize, count: usize },
    #[error("first range starts at {0}, not at 0")]
    FirstStart(u32),
    #[error("range {index} starts at {start}, not after {previous}")]
    StartOrder {
        index: usize,
        start: u32,
        previous: u32,
    },
    #[error("range {0} has a country code that is not two capital letters")]
    Code(usize),
}

/// A two-letter ISO 3166-1 code read out of the table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Country([u8; 2]);

impl Country {
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0).expect("a code from the table is two capital letters")
    }
}

/// A parsed table over the bytes it was built from.
#[derive(Debug, Clone, Copy)]
pub struct CountryTable<'a> {
    records: &'a [[u8; RECORD_LEN]],
}

impl<'a> CountryTable<'a> {
    pub fn parse(bytes: &'a [u8]) -> Result<CountryTable<'a>, TableError> {
        if bytes.get(..MAGIC.len()) != Some(&MAGIC) {
            return Err(TableError::Magic);
        }
        let header = bytes
            .get(..HEADER_LEN)
            .ok_or(TableError::Header(bytes.len()))?;
        let count = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
        if count == 0 {
            return Err(TableError::Empty);
        }
        let body = &bytes[HEADER_LEN..];
        // 6-byte records are not aligned, so they are read out of the bytes rather than cast.
        let (records, rest) = body.as_chunks::<RECORD_LEN>();
        if !rest.is_empty() || records.len() != count {
            return Err(TableError::Length {
                len: bytes.len(),
                count,
            });
        }

        let table = CountryTable { records };
        let mut previous: Option<u32> = None;
        for (index, record) in table.records.iter().enumerate() {
            let (record_start, record_code) = (start(record), code(record));
            if !record_code.iter().all(u8::is_ascii_uppercase) {
                return Err(TableError::Code(index));
            }
            match previous {
                None if record_start != 0 => return Err(TableError::FirstStart(record_start)),
                None => {}
                Some(previous) if record_start <= previous => {
                    return Err(TableError::StartOrder {
                        index,
                        start: record_start,
                        previous,
                    })
                }
                Some(_) => {}
            }
            previous = Some(record_start);
        }
        Ok(table)
    }

    /// How many ranges the table holds.
    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// The country of `ip`, or `None` for a range that belongs to no country.
    pub fn lookup(&self, ip: Ipv4Addr) -> Option<Country> {
        let ip = u32::from(ip);
        let index = self
            .records
            .partition_point(|record| start(record) <= ip)
            .checked_sub(1)?;
        let code = code(&self.records[index]);
        (code != NO_COUNTRY).then_some(Country(code))
    }
}

/// The first address of a record.
fn start(record: &[u8; RECORD_LEN]) -> u32 {
    u32::from_le_bytes([record[0], record[1], record[2], record[3]])
}

/// The country code of a record.
fn code(record: &[u8; RECORD_LEN]) -> [u8; 2] {
    [record[4], record[5]]
}

/// ISO codes ordered by their English short name, which is how the list sorts by country.
///
/// Written by hand from the English short names. The registry stores a code's position here in
/// `country_order`, so a new country goes in name order, and a change to this list needs a
/// migration that clears `country_order` so the backfill writes it again.
pub const COUNTRY_ORDER: &[&str] = &[
    "AF", "AX", "AL", "DZ", "AS", "AD", "AO", "AI", "AQ", "AG", "AR", "AM", "AW", "AU", "AT", "AZ",
    "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BJ", "BM", "BT", "BO", "BA", "BW", "BV", "BR", "IO",
    "VG", "BN", "BG", "BF", "BI", "KH", "CM", "CA", "CV", "BQ", "KY", "CF", "TD", "CL", "CN", "CO",
    "KM", "CG", "CD", "CK", "CR", "CI", "HR", "CU", "CW", "CY", "CZ", "DK", "DJ", "DM", "DO", "EC",
    "EG", "SV", "GQ", "ER", "EE", "SZ", "ET", "FK", "FO", "FJ", "FI", "FR", "GF", "PF", "GA", "GM",
    "GE", "DE", "GH", "GI", "GR", "GL", "GD", "GP", "GU", "GT", "GG", "GN", "GW", "GY", "HT", "HM",
    "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE", "IM", "IL", "IT", "JM", "JP", "JE", "JO",
    "KZ", "KE", "KI", "XK", "KW", "KG", "LA", "LV", "LB", "LS", "LR", "LY", "LI", "LT", "LU", "MO",
    "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MQ", "MR", "MU", "YT", "MX", "FM", "MD", "MC", "MN",
    "ME", "MS", "MA", "MZ", "MM", "NA", "NR", "NP", "NL", "NC", "NZ", "NI", "NE", "NG", "NU", "KP",
    "MK", "MP", "NO", "OM", "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH", "PN", "PL", "PT", "PR",
    "QA", "RE", "RO", "RU", "RW", "WS", "SM", "ST", "SA", "SN", "RS", "SC", "SL", "SG", "SX", "SK",
    "SI", "SB", "SO", "ZA", "GS", "KR", "SS", "ES", "LK", "BL", "SH", "KN", "LC", "MF", "PM", "VC",
    "SD", "SR", "SJ", "SE", "CH", "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK", "TO", "TT", "TN",
    "TR", "TM", "TC", "TV", "UM", "VI", "UG", "UA", "AE", "GB", "US", "UY", "UZ", "VU", "VA", "VE",
    "VN", "WF", "YE", "ZM", "ZW",
];

/// A code's position in [`COUNTRY_ORDER`], or `None` for anything not listed.
pub fn country_order(code: &str) -> Option<i64> {
    COUNTRY_ORDER
        .iter()
        .position(|known| *known == code)
        .map(|index| index as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(records: &[(u32, [u8; 2])]) -> Vec<u8> {
        let mut bytes = MAGIC.to_vec();
        bytes.extend_from_slice(&(records.len() as u32).to_le_bytes());
        for (start, code) in records {
            bytes.extend_from_slice(&start.to_le_bytes());
            bytes.extend_from_slice(code);
        }
        bytes
    }

    fn ip(text: &str) -> Ipv4Addr {
        text.parse().expect("test address")
    }

    #[test]
    fn lookup_answers_the_range_each_address_falls_in() {
        let bytes = table(&[
            (0, *b"ZZ"),
            (u32::from(ip("0.0.0.10")), *b"DE"),
            (u32::from(ip("0.0.0.20")), *b"ZZ"),
            (u32::from(ip("0.0.0.30")), *b"US"),
        ]);
        let parsed = CountryTable::parse(&bytes).expect("parse");

        let cases = [
            ("start of the reserved front", "0.0.0.0", None),
            ("last of the reserved front", "0.0.0.9", None),
            ("first of Germany", "0.0.0.10", Some("DE")),
            ("last of Germany", "0.0.0.19", Some("DE")),
            ("reserved middle", "0.0.0.20", None),
            ("first of the United States", "0.0.0.30", Some("US")),
            ("last address in the table", "255.255.255.255", Some("US")),
        ];
        for (name, address, expected) in cases {
            let got = parsed.lookup(ip(address)).map(|c| c.as_str().to_string());
            assert_eq!(got.as_deref(), expected, "{name}");
        }
    }

    #[test]
    fn parse_refuses_a_body_that_breaks_the_format() {
        let good = table(&[(0, *b"ZZ"), (10, *b"DE")]);

        let mut lowercase = good.clone();
        *lowercase.last_mut().expect("last byte") = b'e';

        let mut not_a_letter = good.clone();
        *not_a_letter.last_mut().expect("last byte") = b'1';

        let mut later_start = good.clone();
        later_start[HEADER_LEN..HEADER_LEN + 4].copy_from_slice(&7u32.to_le_bytes());

        let mut same_start = good.clone();
        same_start[HEADER_LEN + RECORD_LEN..HEADER_LEN + RECORD_LEN + 4]
            .copy_from_slice(&0u32.to_le_bytes());

        let mut wrong_count = good.clone();
        wrong_count[4] = 3;

        let cases: [(&str, Vec<u8>, TableError); 8] = [
            ("no records", table(&[]), TableError::Empty),
            ("bad magic", b"NOPE".to_vec(), TableError::Magic),
            (
                "too short for the magic",
                b"TGE".to_vec(),
                TableError::Magic,
            ),
            (
                "no room for the count",
                b"TGEO\0\0".to_vec(),
                TableError::Header(6),
            ),
            (
                "truncated body",
                good[..good.len() - 1].to_vec(),
                TableError::Length {
                    len: good.len() - 1,
                    count: 2,
                },
            ),
            (
                "count does not match the length",
                wrong_count,
                TableError::Length {
                    len: good.len(),
                    count: 3,
                },
            ),
            (
                "first start is not 0",
                later_start,
                TableError::FirstStart(7),
            ),
            (
                "starts do not increase",
                same_start,
                TableError::StartOrder {
                    index: 1,
                    start: 0,
                    previous: 0,
                },
            ),
        ];
        for (name, bytes, expected) in cases {
            assert_eq!(CountryTable::parse(&bytes).unwrap_err(), expected, "{name}");
        }

        assert_eq!(
            CountryTable::parse(&lowercase).unwrap_err(),
            TableError::Code(1),
            "lowercase code"
        );
        assert_eq!(
            CountryTable::parse(&not_a_letter).unwrap_err(),
            TableError::Code(1),
            "non-letter code"
        );
    }

    #[test]
    fn the_order_list_is_in_english_name_order() {
        let position = |code| COUNTRY_ORDER.iter().position(|c| *c == code);
        assert_eq!(country_order("DE").unwrap(), position("DE").unwrap() as i64);
        assert!(country_order("AT") < country_order("DE"));
        assert!(country_order("DE") < country_order("US"));
        assert_eq!(country_order("ZZ"), None);
        assert_eq!(country_order(""), None);
    }
}
