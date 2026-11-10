//! Offline IPv4-to-country lookup.
//!
//! The data is DB-IP IP to Country Lite (https://db-ip.com), CC BY 4.0, converted to a compact
//! range table. A monthly refresh is rare: download `dbip-country-lite-YYYY-MM.csv.gz` from
//! https://download.db-ip.com/free/ into any scratch folder and run
//! `cargo run -p tetra-tools -- geoip-table <csv.gz> crates/tetra-core/data/country-ipv4.bin`.

use crate::classify::country_table::{Country, CountryTable};
use std::net::Ipv4Addr;
use std::sync::OnceLock;

/// Parsed once on first use. A table that fails to parse leaves every lookup without a country.
static TABLE: OnceLock<Option<CountryTable<'static>>> = OnceLock::new();

/// The country an IPv4 address belongs to, or `None` for reserved and private ranges.
pub fn country_code(ip: Ipv4Addr) -> Option<Country> {
    let table = TABLE
        .get_or_init(|| CountryTable::parse(include_bytes!("../../data/country-ipv4.bin")).ok());
    table.as_ref()?.lookup(ip)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_table_answers_known_addresses() {
        let cases: &[(&str, &str, Option<&str>)] = &[
            ("google dns", "8.8.8.8", Some("US")),
            ("cloudflare", "1.1.1.1", Some("AU")),
            ("hetzner", "88.198.1.1", Some("DE")),
            ("another google range", "172.217.0.1", Some("US")),
            ("loopback", "127.0.0.1", None),
            ("private class c", "192.168.1.1", None),
            ("private class a", "10.0.0.1", None),
            ("carrier-grade nat", "100.64.0.1", None),
            ("unspecified", "0.0.0.0", None),
            ("broadcast", "255.255.255.255", None),
        ];
        for (name, address, expected) in cases {
            let ip: Ipv4Addr = address.parse().expect("test address");
            let got = country_code(ip).map(|c| c.as_str().to_string());
            assert_eq!(got.as_deref(), *expected, "{name} ({address})");
        }
    }

    #[test]
    fn every_country_in_the_shipped_table_has_a_sort_position() {
        use crate::classify::country_table::{country_order, RECORD_LEN};
        let bytes = include_bytes!("../../data/country-ipv4.bin");
        let missing: std::collections::BTreeSet<String> = bytes[8..]
            .chunks(RECORD_LEN)
            .map(|record| String::from_utf8_lossy(&record[4..]).into_owned())
            .filter(|code| code != "ZZ" && country_order(code).is_none())
            .collect();
        assert!(missing.is_empty(), "not in COUNTRY_ORDER: {missing:?}");
    }
}
