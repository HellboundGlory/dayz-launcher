//! Minimal offline IP-to-region lookup.
//!
//! Maps IPv4 addresses to broad region codes (EU, NA, AS, OC, SA)
//! matching the launcher's region filter dropdown.
//!
//! Uses a baked-in table of `/8` prefixes covering DayZ server-hosting
//! networks. No external database, no async I/O, no extra crate dependencies.
//!
//! # Why an array
//!
//! This was a `LazyLock<HashMap<(u8, u8), &str>>` populated by ~200 nested
//! `for b2 in 0..=255` loops — roughly 50,000 entries, every one of which
//! mapped a whole `/8` and so ignored the second octet entirely. The map was
//! several hundred kilobytes of heap built on first use, hashed a tuple on
//! every lookup, and encoded no information an array indexed by the first
//! octet does not. `REGIONS` is 256 entries resolved at compile time.
//!
//! Prefix order is still load-bearing: the original inserted some octets twice
//! and relied on the later write winning (`194` is listed under Oceania and
//! again under Germany, and resolves to EU; `200` under Oceania and again under
//! South America, and resolves to SA). `build_table` applies the blocks in the
//! same order for the same reason, and the tests below pin the overlaps.

use std::net::Ipv4Addr;

/// Region codes used by the filter dropdown and stored in the registry.
pub const REGION_OCEANIA: &str = "OC";
pub const REGION_ASIA: &str = "AS";
pub const REGION_EUROPE: &str = "EU";
pub const REGION_NORTH_AMERICA: &str = "NA";
pub const REGION_SOUTH_AMERICA: &str = "SA";

/// First-octet blocks per region, applied in this order.
///
/// Several octets appear in more than one list. That is inherited, not
/// accidental, and the later block wins — see the module note and the
/// `overlapping_prefixes_resolve_to_the_last_block` test.
const OCEANIA: &[u8] = &[
    1, 27, 58, 60, 61, 101, 103, 106, 110, 111, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122,
    123, 124, 125, 126, 144, 147, 149, 150, 153, 155, 167, 168, 175, 180, 194, 200, 202, 203, 210,
    211, 218, 219, 220, 221,
];
const ASIA: &[u8] = &[14, 36, 39, 42, 43, 49, 59, 112, 133, 182, 183, 222, 223];
const EUROPE: &[u8] = &[
    51, 54, 178, 5, 88, 176, 185, 188, 193, 194, 195, 212, 217, 31, 57, 77, 80, 81, 82, 83, 90,
    109, 128, 129, 135, 2, 25, 86, 130, 131, 37, 79, 89, 91, 94, 95, 46, 78, 85, 92, 93, 84, 62,
    87, 136, 141, 145,
];
const NORTH_AMERICA: &[u8] = &[
    3, 4, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28, 29, 30, 32, 33,
    34, 35, 38, 40, 44, 45, 47, 48, 50, 52, 55, 56, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74,
    75, 76, 96, 97, 98, 99, 100, 104, 107, 108, 137, 138, 139, 140, 142, 143, 144, 146, 147, 148,
    149, 152, 155, 156, 157, 158, 159, 160, 161, 162, 164, 165, 166, 167, 168, 169, 170, 172, 173,
    174, 192, 198, 199, 204, 205, 206, 207, 208, 209, 216, 132,
];
const SOUTH_AMERICA: &[u8] = &[177, 179, 186, 187, 189, 190, 191, 200, 201];
/// Resolved at compile time: 256 entries, indexed by the first octet.
static REGIONS: [Option<&str>; 256] = build_table();

const fn build_table() -> [Option<&'static str>; 256] {
    let mut table = [None; 256];
    table = assign(table, OCEANIA, REGION_OCEANIA);
    table = assign(table, ASIA, REGION_ASIA);
    table = assign(table, EUROPE, REGION_EUROPE);
    table = assign(table, NORTH_AMERICA, REGION_NORTH_AMERICA);
    table = assign(table, SOUTH_AMERICA, REGION_SOUTH_AMERICA);
    table
}

const fn assign(
    mut table: [Option<&'static str>; 256],
    octets: &[u8],
    region: &'static str,
) -> [Option<&'static str>; 256] {
    let mut i = 0;
    while i < octets.len() {
        table[octets[i] as usize] = Some(region);
        i += 1;
    }
    table
}

/// True for addresses that are not globally routable, so cannot belong to any
/// geographic region.
///
/// This has to be checked *before* the table lookup, not after. Every table
/// entry is a whole `/8` — both `172` and `192` map wholesale to North America —
/// which quietly swallows `172.16.0.0/12` and `192.168.0.0/16`. A LAN server
/// would otherwise be labelled NA and get caught by the region filter.
fn is_non_routable(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || ip.is_unspecified()
        // Carrier-grade NAT, 100.64.0.0/10 (`is_shared` is still unstable).
        || (a == 100 && (64..=127).contains(&b))
        // Reserved for future use, 240.0.0.0/4 (`is_reserved` is unstable).
        || a >= 240
}

/// Return the region code (EU, NA, AS, OC, SA) for an IPv4 address,
/// or `None` if the IP cannot be mapped.
pub fn region_code(ip: Ipv4Addr) -> Option<&'static str> {
    if is_non_routable(ip) {
        return None;
    }
    REGIONS[ip.octets()[0] as usize]
}

/// Legacy alias matching the old `country_code` API.
pub fn country_code(ip: Ipv4Addr) -> Option<&'static str> {
    region_code(ip)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn hetzner_is_eu() {
        assert_eq!(
            region_code(Ipv4Addr::new(88, 198, 1, 1)),
            Some(REGION_EUROPE)
        );
    }

    #[test]
    fn ovh_france_is_eu() {
        assert_eq!(
            region_code(Ipv4Addr::new(51, 38, 100, 1)),
            Some(REGION_EUROPE)
        );
        assert_eq!(
            region_code(Ipv4Addr::new(178, 33, 0, 1)),
            Some(REGION_EUROPE)
        );
    }

    #[test]
    fn ovh_uk_is_eu() {
        // 51.254.46.15 — OVH UK
        assert_eq!(
            region_code(Ipv4Addr::new(51, 254, 46, 15)),
            Some(REGION_EUROPE)
        );
    }

    #[test]
    fn us_is_na() {
        assert_eq!(
            region_code(Ipv4Addr::new(4, 2, 2, 2)),
            Some(REGION_NORTH_AMERICA)
        );
        assert_eq!(
            region_code(Ipv4Addr::new(8, 8, 8, 8)),
            Some(REGION_NORTH_AMERICA)
        );
    }

    #[test]
    fn au_is_oc() {
        assert_eq!(region_code(Ipv4Addr::new(1, 1, 1, 1)), Some(REGION_OCEANIA));
    }

    #[test]
    fn br_is_sa() {
        assert_eq!(
            region_code(Ipv4Addr::new(177, 54, 0, 1)),
            Some(REGION_SOUTH_AMERICA)
        );
    }

    #[test]
    fn cn_is_as() {
        assert_eq!(region_code(Ipv4Addr::new(14, 0, 0, 1)), Some(REGION_ASIA));
        assert_eq!(
            region_code(Ipv4Addr::new(223, 255, 0, 1)),
            Some(REGION_ASIA)
        );
    }

    #[test]
    fn loopback_is_none() {
        assert_eq!(region_code(Ipv4Addr::new(127, 0, 0, 1)), None);
    }

    #[test]
    fn private_is_none() {
        assert_eq!(region_code(Ipv4Addr::new(192, 168, 1, 1)), None);
        assert_eq!(region_code(Ipv4Addr::new(10, 0, 0, 1)), None);
        assert_eq!(region_code(Ipv4Addr::new(172, 16, 0, 1)), None);
    }

    /// The private guard must not swallow the routable remainder of the same
    /// `/8`: 172.16/12 is private but 172.217/16 (Google) is not, and both sit
    /// under the blanket `172.x -> NA` table entry.
    #[test]
    fn public_addresses_in_a_partly_private_slash_8_still_resolve() {
        assert_eq!(
            region_code(Ipv4Addr::new(172, 217, 0, 1)),
            Some(REGION_NORTH_AMERICA)
        );
        assert_eq!(
            region_code(Ipv4Addr::new(192, 30, 0, 1)),
            Some(REGION_NORTH_AMERICA)
        );
    }

    /// Nine `/8`s are claimed by two region blocks. The table is built by
    /// applying the blocks in order and letting the later one win, which
    /// reproduces what the old insert-ordered `HashMap` resolved to. Reordering
    /// the blocks in `build_table` silently moves these servers between regions,
    /// so they are pinned rather than left to the reader to infer.
    #[test]
    fn overlapping_prefixes_resolve_to_the_last_block() {
        // Oceania, then Germany.
        assert_eq!(
            region_code(Ipv4Addr::new(194, 1, 1, 1)),
            Some(REGION_EUROPE)
        );
        // Oceania, then South America.
        assert_eq!(
            region_code(Ipv4Addr::new(200, 1, 1, 1)),
            Some(REGION_SOUTH_AMERICA)
        );
        // Oceania, then the United States block.
        for octet in [144, 147, 149, 155, 167, 168] {
            assert_eq!(
                region_code(Ipv4Addr::new(octet, 1, 1, 1)),
                Some(REGION_NORTH_AMERICA),
                "{octet}.x should resolve to NA"
            );
        }
        // Claimed only by Oceania, so unaffected by any later block.
        for octet in [150, 153, 175, 180, 202, 203, 210, 211] {
            assert_eq!(
                region_code(Ipv4Addr::new(octet, 1, 1, 1)),
                Some(REGION_OCEANIA),
                "{octet}.x should stay OC"
            );
        }
    }

    /// The lookup ignores every octet but the first, so a `/8` must answer the
    /// same for its whole range. This is what makes the array equivalent to the
    /// `(first, second)`-keyed map it replaced, whose entries were all blanket
    /// `/8`s written out 256 times each.
    #[test]
    fn the_second_octet_never_changes_the_answer() {
        for second in [0u8, 1, 64, 128, 200, 255] {
            assert_eq!(
                region_code(Ipv4Addr::new(88, second, 1, 1)),
                Some(REGION_EUROPE)
            );
        }
    }

    #[test]
    fn other_non_routable_ranges_are_none() {
        assert_eq!(region_code(Ipv4Addr::new(169, 254, 1, 1)), None); // link-local
        assert_eq!(region_code(Ipv4Addr::new(100, 64, 0, 1)), None); // CGNAT
        assert_eq!(region_code(Ipv4Addr::new(0, 0, 0, 0)), None); // unspecified
        assert_eq!(region_code(Ipv4Addr::new(255, 255, 255, 255)), None); // broadcast
    }
}
