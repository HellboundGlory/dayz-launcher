//! Turns a DB-IP country CSV into the packed IPv4 range table `tetra-core` reads.

use std::io::BufRead;
use tetra_core::classify::country_table::{MAGIC, RECORD_LEN};

#[derive(Debug, PartialEq, Eq)]
pub enum BuildError {
    Line { line: usize, problem: Problem },
    Read(String),
    NoRows,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Problem {
    Fields,
    Address(&'static str),
    Code,
    Reversed,
    Overlap,
}

impl BuildError {
    fn line(line: usize, problem: Problem) -> BuildError {
        BuildError::Line { line, problem }
    }
}

impl std::fmt::Display for BuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BuildError::Line { line, problem } => write!(f, "line {line}: {problem}"),
            BuildError::Read(message) => write!(f, "{message}"),
            BuildError::NoRows => write!(f, "no IPv4 rows"),
        }
    }
}

impl std::fmt::Display for Problem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Problem::Fields => write!(f, "expected start,end,code"),
            Problem::Address(which) => write!(f, "{which} is not an IPv4 address"),
            Problem::Code => write!(f, "country code is not two capital letters"),
            Problem::Reversed => write!(f, "range ends before it starts"),
            Problem::Overlap => write!(f, "range starts before the previous one ends"),
        }
    }
}

impl std::error::Error for BuildError {}

/// A row of the CSV that covers part of the IPv4 space.
struct Row {
    start: u32,
    end: u32,
    code: [u8; 2],
}

/// Encode the IPv4 rows of a DB-IP country CSV as the packed table.
pub fn build(csv: impl BufRead) -> Result<Vec<u8>, BuildError> {
    let mut records: Vec<(u32, [u8; 2])> = Vec::new();
    // A record only starts where the country changes.
    let mut push = |start: u32, code: [u8; 2]| {
        if records.last().map(|(_, last)| *last) != Some(code) {
            records.push((start, code));
        }
    };
    let mut rows = 0usize;
    let mut next = 0u64;
    for (index, line) in csv.lines().enumerate() {
        let line = line.map_err(|e| BuildError::Read(e.to_string()))?;
        let number = index + 1;
        let Some(row) = parse_row(&line).map_err(|p| BuildError::line(number, p))? else {
            continue;
        };
        if (row.start as u64) < next {
            return Err(BuildError::line(number, Problem::Overlap));
        }
        if (row.start as u64) > next {
            push(next as u32, *b"ZZ");
        }
        push(row.start, row.code);
        rows += 1;
        next = row.end as u64 + 1;
    }
    if rows == 0 {
        return Err(BuildError::NoRows);
    }
    if next <= u32::MAX as u64 {
        push(next as u32, *b"ZZ");
    }

    let mut bytes = Vec::with_capacity(8 + records.len() * RECORD_LEN);
    bytes.extend_from_slice(&MAGIC);
    bytes.extend_from_slice(&(records.len() as u32).to_le_bytes());
    for (start, code) in records {
        bytes.extend_from_slice(&start.to_le_bytes());
        bytes.extend_from_slice(&code);
    }
    Ok(bytes)
}

/// [`build`] over a gzip file, reading every member of it.
pub fn build_gz(gzipped: impl std::io::Read) -> Result<Vec<u8>, BuildError> {
    build(std::io::BufReader::new(flate2::read::MultiGzDecoder::new(
        gzipped,
    )))
}

/// One CSV line, or `None` for a blank line and for IPv6.
fn parse_row(line: &str) -> Result<Option<Row>, Problem> {
    let line = line.trim();
    if line.is_empty() {
        return Ok(None);
    }
    let mut fields = line.split(',');
    let (Some(start), Some(end), Some(code), None) =
        (fields.next(), fields.next(), fields.next(), fields.next())
    else {
        return Err(Problem::Fields);
    };
    if start.contains(':') || end.contains(':') {
        return Ok(None);
    }
    let start = address(start).ok_or(Problem::Address("start"))?;
    let end = address(end).ok_or(Problem::Address("end"))?;
    let [first, second] = code.as_bytes() else {
        return Err(Problem::Code);
    };
    if !first.is_ascii_uppercase() || !second.is_ascii_uppercase() {
        return Err(Problem::Code);
    }
    if start > end {
        return Err(Problem::Reversed);
    }
    Ok(Some(Row {
        start,
        end,
        code: [*first, *second],
    }))
}

fn address(text: &str) -> Option<u32> {
    let ip: std::net::Ipv4Addr = text.trim().parse().ok()?;
    Some(u32::from(ip))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use tetra_core::classify::country_table::CountryTable;

    fn addresses(table: &CountryTable<'_>, list: &[&str]) -> Vec<Option<String>> {
        list.iter()
            .map(|address| {
                let ip = address.parse().expect("test address");
                table.lookup(ip).map(|c| c.as_str().to_string())
            })
            .collect()
    }

    const CSV: &str = "\
0.0.0.0,0.0.0.9,ZZ
0.0.0.10,0.0.0.19,DE
2001::,2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff,US

0.0.0.20,0.0.0.29,DE
0.0.0.40,0.0.0.49,FR
";

    #[test]
    fn rows_encode_to_a_table_that_reads_back() {
        let bytes = build(Cursor::new(CSV)).expect("build");
        let table = CountryTable::parse(&bytes).expect("parse");

        let expected = vec![
            Some("DE".to_string()),
            Some("DE".to_string()),
            None,
            Some("FR".to_string()),
        ];
        let got = addresses(&table, &["0.0.0.10", "0.0.0.19", "0.0.0.30", "0.0.0.40"]);
        assert_eq!(got, expected);
        assert_eq!(
            addresses(&table, &["0.0.0.9", "0.0.0.40"]),
            vec![None, Some("FR".to_string())],
            "the front stays reserved; the tail runs to the last address"
        );

        // The IPv6 line is dropped and the two German rows merge into one record, so
        // that is the front, Germany, the gap after it, France and the tail.
        assert_eq!(table.len(), 5, "records: {}", table.len());
    }

    #[test]
    fn a_gzipped_csv_encodes_to_the_same_bytes() {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(CSV.as_bytes()).expect("compress");
        let gzipped = encoder.finish().expect("finish");

        let plain = build(Cursor::new(CSV)).expect("plain");
        let decoded = std::io::BufReader::new(flate2::read::GzDecoder::new(Cursor::new(gzipped)));
        assert_eq!(build(decoded).expect("gzip"), plain);
    }

    #[test]
    fn a_bad_row_fails_with_its_line_number() {
        let cases: &[(&str, usize, Problem)] = &[
            ("0.0.0.0,x,DE\n", 1, Problem::Address("end")),
            ("not-an-ip,0.0.0.9,DE\n", 1, Problem::Address("start")),
            ("0.0.0.0,0.0.0.9,DEU\n", 1, Problem::Code),
            ("0.0.0.0,0.0.0.9,de\n", 1, Problem::Code),
            ("0.0.0.0,0.0.0.9\n", 1, Problem::Fields),
            ("0.0.0.9,0.0.0.0,DE\n", 1, Problem::Reversed),
            (
                "0.0.0.0,0.0.0.9,DE\n0.0.0.9,0.0.0.19,DE\n",
                2,
                Problem::Overlap,
            ),
            (
                "0.0.0.10,0.0.0.19,DE\n0.0.0.0,0.0.0.9,FR\n",
                2,
                Problem::Overlap,
            ),
        ];
        for (csv, line, problem) in cases {
            assert_eq!(
                build(Cursor::new(csv)).unwrap_err(),
                BuildError::line(*line, *problem),
                "{csv:?}"
            );
        }
    }

    #[test]
    fn reserved_neighbours_share_one_record() {
        let cases: &[(&str, usize)] = &[
            ("0.0.0.0,0.0.0.9,ZZ\n0.0.0.20,0.0.0.29,DE\n", 3),
            ("0.0.0.0,0.0.0.9,DE\n0.0.0.10,255.255.255.254,ZZ\n", 2),
        ];
        for (csv, records) in cases {
            let bytes = build(Cursor::new(*csv)).expect("build");
            let table = CountryTable::parse(&bytes).expect("parse");
            assert_eq!(table.len(), *records, "{csv:?}");
        }
    }

    #[test]
    fn a_csv_with_no_ipv4_rows_is_refused() {
        for csv in ["", "\n", "2001::,2001::ff,US\n"] {
            assert_eq!(build(Cursor::new(csv)), Err(BuildError::NoRows), "{csv:?}");
        }
    }

    #[test]
    fn only_an_ipv6_address_skips_a_line() {
        let csv = "1.0.0.0,1.0.0.255,AU\nfoo:bar\n";
        assert_eq!(
            build(Cursor::new(csv)),
            Err(BuildError::Line {
                line: 2,
                problem: Problem::Fields
            })
        );
    }

    #[test]
    fn every_gzip_member_is_read() {
        let mut gzipped = Vec::new();
        for part in CSV.split_inclusive("0.0.0.20") {
            let mut encoder =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            encoder.write_all(part.as_bytes()).expect("compress");
            gzipped.extend(encoder.finish().expect("finish"));
        }
        let plain = build(Cursor::new(CSV)).expect("plain");
        assert_eq!(build_gz(Cursor::new(gzipped)).expect("gzip"), plain);
    }
}
