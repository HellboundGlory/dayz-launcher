//! Minimal offline IP-to-region lookup.
//!
//! Maps IPv4 addresses to broad region codes (EU, NA, AS, OC, SA)
//! matching the launcher's region filter dropdown.
//!
//! Uses a baked-in table of /8 and /16 prefixes covering DayZ
//! server-hosting networks. No external database, no async I/O,
//! no extra crate dependencies.

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::LazyLock;

/// Region codes used by the filter dropdown and stored in the registry.
pub const REGION_OCEANIA: &str = "OC";
pub const REGION_ASIA: &str = "AS";
pub const REGION_EUROPE: &str = "EU";
pub const REGION_NORTH_AMERICA: &str = "NA";
pub const REGION_SOUTH_AMERICA: &str = "SA";

/// Lookup: `(first_byte, second_byte)` → region code.
static HOSTING_MAP: LazyLock<HashMap<(u8, u8), &'static str>> = LazyLock::new(|| {
    let mut m = HashMap::new();

    // ── Oceania ──────────────────────────────────────────────────

    for b2 in 0..=255u8 {
        m.insert((1, b2), REGION_OCEANIA);
        m.insert((27, b2), REGION_OCEANIA);
        m.insert((58, b2), REGION_OCEANIA);
        m.insert((60, b2), REGION_OCEANIA);
        m.insert((61, b2), REGION_OCEANIA);
        m.insert((101, b2), REGION_OCEANIA);
        m.insert((103, b2), REGION_OCEANIA);
        m.insert((106, b2), REGION_OCEANIA);
        m.insert((110, b2), REGION_OCEANIA);
        m.insert((111, b2), REGION_OCEANIA);
        m.insert((113, b2), REGION_OCEANIA);
        m.insert((114, b2), REGION_OCEANIA);
        m.insert((115, b2), REGION_OCEANIA);
        m.insert((116, b2), REGION_OCEANIA);
        m.insert((117, b2), REGION_OCEANIA);
        m.insert((118, b2), REGION_OCEANIA);
        m.insert((119, b2), REGION_OCEANIA);
        m.insert((120, b2), REGION_OCEANIA);
        m.insert((121, b2), REGION_OCEANIA);
        m.insert((122, b2), REGION_OCEANIA);
        m.insert((123, b2), REGION_OCEANIA);
        m.insert((124, b2), REGION_OCEANIA);
        m.insert((125, b2), REGION_OCEANIA);
        m.insert((126, b2), REGION_OCEANIA);
        m.insert((144, b2), REGION_OCEANIA);
        m.insert((147, b2), REGION_OCEANIA);
        m.insert((149, b2), REGION_OCEANIA);
        m.insert((150, b2), REGION_OCEANIA);
        m.insert((153, b2), REGION_OCEANIA);
        m.insert((155, b2), REGION_OCEANIA);
        m.insert((167, b2), REGION_OCEANIA);
        m.insert((168, b2), REGION_OCEANIA);
        m.insert((175, b2), REGION_OCEANIA);
        m.insert((180, b2), REGION_OCEANIA);
        m.insert((194, b2), REGION_OCEANIA);
        m.insert((200, b2), REGION_OCEANIA);
        m.insert((202, b2), REGION_OCEANIA);
        m.insert((203, b2), REGION_OCEANIA);
        m.insert((210, b2), REGION_OCEANIA);
        m.insert((211, b2), REGION_OCEANIA);
        m.insert((218, b2), REGION_OCEANIA);
        m.insert((219, b2), REGION_OCEANIA);
        m.insert((220, b2), REGION_OCEANIA);
        m.insert((221, b2), REGION_OCEANIA);
    }

    // ── Asia ─────────────────────────────────────────────────────

    for b2 in 0..=255u8 {
        m.insert((14, b2), REGION_ASIA);
        m.insert((36, b2), REGION_ASIA);
        m.insert((39, b2), REGION_ASIA);
        m.insert((42, b2), REGION_ASIA);
        m.insert((43, b2), REGION_ASIA);
        m.insert((49, b2), REGION_ASIA);
        m.insert((59, b2), REGION_ASIA);
        m.insert((112, b2), REGION_ASIA);
        m.insert((133, b2), REGION_ASIA);
        m.insert((182, b2), REGION_ASIA);
        m.insert((183, b2), REGION_ASIA);
        m.insert((222, b2), REGION_ASIA);
        m.insert((223, b2), REGION_ASIA);
    }

    // ── Europe ───────────────────────────────────────────────────

    // OVH & wide EU hosting ranges — must come early to cover large blocks
    for b2 in 0..=255u8 {
        m.insert((51, b2), REGION_EUROPE);   // OVH France/UK
        m.insert((54, b2), REGION_EUROPE);   // OVH / AWS EU
        m.insert((178, b2), REGION_EUROPE);  // OVH
    }
    // Germany (Hetzner + others)
    for b2 in 0..=255u8 {
        m.insert((5, b2), REGION_EUROPE);
        m.insert((88, b2), REGION_EUROPE);
        m.insert((176, b2), REGION_EUROPE);
        m.insert((185, b2), REGION_EUROPE);
        m.insert((188, b2), REGION_EUROPE);
        m.insert((193, b2), REGION_EUROPE);
        m.insert((194, b2), REGION_EUROPE);
        m.insert((195, b2), REGION_EUROPE);
        m.insert((212, b2), REGION_EUROPE);
        m.insert((217, b2), REGION_EUROPE);
    }
    // France
    for b2 in 0..=255u8 {
        m.insert((31, b2), REGION_EUROPE);
        m.insert((57, b2), REGION_EUROPE);
        m.insert((77, b2), REGION_EUROPE);
        m.insert((80, b2), REGION_EUROPE);
        m.insert((81, b2), REGION_EUROPE);
        m.insert((82, b2), REGION_EUROPE);
        m.insert((83, b2), REGION_EUROPE);
        m.insert((90, b2), REGION_EUROPE);
        m.insert((109, b2), REGION_EUROPE);
        m.insert((128, b2), REGION_EUROPE);
        m.insert((129, b2), REGION_EUROPE);
        m.insert((135, b2), REGION_EUROPE);   // additional FR / misc EU
    }
    // United Kingdom
    for b2 in 0..=255u8 {
        m.insert((2, b2), REGION_EUROPE);
        m.insert((25, b2), REGION_EUROPE);
        m.insert((86, b2), REGION_EUROPE);
        m.insert((130, b2), REGION_EUROPE);
        m.insert((131, b2), REGION_EUROPE);
    }
    // Poland
    for b2 in 0..=255u8 {
        m.insert((37, b2), REGION_EUROPE);
        m.insert((79, b2), REGION_EUROPE);
        m.insert((89, b2), REGION_EUROPE);
        m.insert((91, b2), REGION_EUROPE);
        m.insert((94, b2), REGION_EUROPE);
        m.insert((95, b2), REGION_EUROPE);
    }
    // Russia
    for b2 in 0..=255u8 {
        m.insert((46, b2), REGION_EUROPE);
        m.insert((78, b2), REGION_EUROPE);
        m.insert((85, b2), REGION_EUROPE);
        m.insert((92, b2), REGION_EUROPE);
        m.insert((93, b2), REGION_EUROPE);
    }
    // Sweden
    for b2 in 0..=255u8 {
        m.insert((84, b2), REGION_EUROPE);
    }
    // Finland
    for b2 in 0..=255u8 {
        m.insert((62, b2), REGION_EUROPE);
        m.insert((87, b2), REGION_EUROPE);
    }
    // Netherlands
    for b2 in 0..=255u8 {
        m.insert((136, b2), REGION_EUROPE);
        m.insert((141, b2), REGION_EUROPE);
        m.insert((145, b2), REGION_EUROPE);
    }

    // ── North America ────────────────────────────────────────────

    // United States
    for b2 in 0..=255u8 {
        m.insert((3, b2), REGION_NORTH_AMERICA);
        m.insert((4, b2), REGION_NORTH_AMERICA);
        m.insert((6, b2), REGION_NORTH_AMERICA);
        m.insert((7, b2), REGION_NORTH_AMERICA);
        m.insert((8, b2), REGION_NORTH_AMERICA);
        m.insert((9, b2), REGION_NORTH_AMERICA);
        m.insert((11, b2), REGION_NORTH_AMERICA);
        m.insert((12, b2), REGION_NORTH_AMERICA);
        m.insert((13, b2), REGION_NORTH_AMERICA);
        m.insert((15, b2), REGION_NORTH_AMERICA);
        m.insert((16, b2), REGION_NORTH_AMERICA);
        m.insert((17, b2), REGION_NORTH_AMERICA);
        m.insert((18, b2), REGION_NORTH_AMERICA);
        m.insert((19, b2), REGION_NORTH_AMERICA);
        m.insert((20, b2), REGION_NORTH_AMERICA);
        m.insert((21, b2), REGION_NORTH_AMERICA);
        m.insert((22, b2), REGION_NORTH_AMERICA);
        m.insert((23, b2), REGION_NORTH_AMERICA);
        m.insert((24, b2), REGION_NORTH_AMERICA);
        m.insert((26, b2), REGION_NORTH_AMERICA);
        m.insert((28, b2), REGION_NORTH_AMERICA);
        m.insert((29, b2), REGION_NORTH_AMERICA);
        m.insert((30, b2), REGION_NORTH_AMERICA);
        m.insert((32, b2), REGION_NORTH_AMERICA);
        m.insert((33, b2), REGION_NORTH_AMERICA);
        m.insert((34, b2), REGION_NORTH_AMERICA);
        m.insert((35, b2), REGION_NORTH_AMERICA);
        m.insert((38, b2), REGION_NORTH_AMERICA);
        m.insert((40, b2), REGION_NORTH_AMERICA);
        m.insert((44, b2), REGION_NORTH_AMERICA);
        m.insert((45, b2), REGION_NORTH_AMERICA);
        m.insert((47, b2), REGION_NORTH_AMERICA);
        m.insert((48, b2), REGION_NORTH_AMERICA);
        m.insert((50, b2), REGION_NORTH_AMERICA);
        m.insert((52, b2), REGION_NORTH_AMERICA);
        m.insert((55, b2), REGION_NORTH_AMERICA);
        m.insert((56, b2), REGION_NORTH_AMERICA);
        m.insert((63, b2), REGION_NORTH_AMERICA);
        m.insert((64, b2), REGION_NORTH_AMERICA);
        m.insert((65, b2), REGION_NORTH_AMERICA);
        m.insert((66, b2), REGION_NORTH_AMERICA);
        m.insert((67, b2), REGION_NORTH_AMERICA);
        m.insert((68, b2), REGION_NORTH_AMERICA);
        m.insert((69, b2), REGION_NORTH_AMERICA);
        m.insert((70, b2), REGION_NORTH_AMERICA);
        m.insert((71, b2), REGION_NORTH_AMERICA);
        m.insert((72, b2), REGION_NORTH_AMERICA);
        m.insert((73, b2), REGION_NORTH_AMERICA);
        m.insert((74, b2), REGION_NORTH_AMERICA);
        m.insert((75, b2), REGION_NORTH_AMERICA);
        m.insert((76, b2), REGION_NORTH_AMERICA);
        m.insert((96, b2), REGION_NORTH_AMERICA);
        m.insert((97, b2), REGION_NORTH_AMERICA);
        m.insert((98, b2), REGION_NORTH_AMERICA);
        m.insert((99, b2), REGION_NORTH_AMERICA);
        m.insert((100, b2), REGION_NORTH_AMERICA);
        m.insert((104, b2), REGION_NORTH_AMERICA);
        m.insert((107, b2), REGION_NORTH_AMERICA);
        m.insert((108, b2), REGION_NORTH_AMERICA);
        m.insert((137, b2), REGION_NORTH_AMERICA);
        m.insert((138, b2), REGION_NORTH_AMERICA);
        m.insert((139, b2), REGION_NORTH_AMERICA);
        m.insert((140, b2), REGION_NORTH_AMERICA);
        m.insert((142, b2), REGION_NORTH_AMERICA);
        m.insert((143, b2), REGION_NORTH_AMERICA);
        m.insert((144, b2), REGION_NORTH_AMERICA);
        m.insert((146, b2), REGION_NORTH_AMERICA);
        m.insert((147, b2), REGION_NORTH_AMERICA);
        m.insert((148, b2), REGION_NORTH_AMERICA);
        m.insert((149, b2), REGION_NORTH_AMERICA);
        m.insert((152, b2), REGION_NORTH_AMERICA);
        m.insert((155, b2), REGION_NORTH_AMERICA);
        m.insert((156, b2), REGION_NORTH_AMERICA);
        m.insert((157, b2), REGION_NORTH_AMERICA);
        m.insert((158, b2), REGION_NORTH_AMERICA);
        m.insert((159, b2), REGION_NORTH_AMERICA);
        m.insert((160, b2), REGION_NORTH_AMERICA);
        m.insert((161, b2), REGION_NORTH_AMERICA);
        m.insert((162, b2), REGION_NORTH_AMERICA);
        m.insert((164, b2), REGION_NORTH_AMERICA);
        m.insert((165, b2), REGION_NORTH_AMERICA);
        m.insert((166, b2), REGION_NORTH_AMERICA);
        m.insert((167, b2), REGION_NORTH_AMERICA);
        m.insert((168, b2), REGION_NORTH_AMERICA);
        m.insert((169, b2), REGION_NORTH_AMERICA);
        m.insert((170, b2), REGION_NORTH_AMERICA);
        m.insert((172, b2), REGION_NORTH_AMERICA);
        m.insert((173, b2), REGION_NORTH_AMERICA);
        m.insert((174, b2), REGION_NORTH_AMERICA);
        m.insert((192, b2), REGION_NORTH_AMERICA);
        m.insert((198, b2), REGION_NORTH_AMERICA);
        m.insert((199, b2), REGION_NORTH_AMERICA);
        m.insert((204, b2), REGION_NORTH_AMERICA);
        m.insert((205, b2), REGION_NORTH_AMERICA);
        m.insert((206, b2), REGION_NORTH_AMERICA);
        m.insert((207, b2), REGION_NORTH_AMERICA);
        m.insert((208, b2), REGION_NORTH_AMERICA);
        m.insert((209, b2), REGION_NORTH_AMERICA);
        m.insert((216, b2), REGION_NORTH_AMERICA);
    }
    // Canada
    for b2 in 0..=255u8 {
        m.insert((132, b2), REGION_NORTH_AMERICA);
    }

    // ── South America ────────────────────────────────────────────

    for b2 in 0..=255u8 {
        m.insert((177, b2), REGION_SOUTH_AMERICA);
        m.insert((179, b2), REGION_SOUTH_AMERICA);
        m.insert((186, b2), REGION_SOUTH_AMERICA);
        m.insert((187, b2), REGION_SOUTH_AMERICA);
        m.insert((189, b2), REGION_SOUTH_AMERICA);
        m.insert((190, b2), REGION_SOUTH_AMERICA);
        m.insert((191, b2), REGION_SOUTH_AMERICA);
        m.insert((200, b2), REGION_SOUTH_AMERICA);
        m.insert((201, b2), REGION_SOUTH_AMERICA);
    }

    m
});

/// True for addresses that are not globally routable, so cannot belong to any
/// geographic region.
///
/// This has to be checked *before* the table lookup, not after. The table is
/// keyed on the first two octets and several entries are blanket `/8`s — both
/// `172.x` and `192.x` are mapped wholesale to North America — which quietly
/// swallows `172.16.0.0/12` and `192.168.0.0/16`. A LAN server would otherwise
/// be labelled NA and get caught by the region filter.
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
    let octets = ip.octets();
    HOSTING_MAP.get(&(octets[0], octets[1])).copied()
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
        assert_eq!(region_code(Ipv4Addr::new(88, 198, 1, 1)), Some(REGION_EUROPE));
    }

    #[test]
    fn ovh_france_is_eu() {
        assert_eq!(region_code(Ipv4Addr::new(51, 38, 100, 1)), Some(REGION_EUROPE));
        assert_eq!(region_code(Ipv4Addr::new(178, 33, 0, 1)), Some(REGION_EUROPE));
    }

    #[test]
    fn ovh_uk_is_eu() {
        // 51.254.46.15 — OVH UK
        assert_eq!(region_code(Ipv4Addr::new(51, 254, 46, 15)), Some(REGION_EUROPE));
    }

    #[test]
    fn us_is_na() {
        assert_eq!(region_code(Ipv4Addr::new(4, 2, 2, 2)), Some(REGION_NORTH_AMERICA));
        assert_eq!(region_code(Ipv4Addr::new(8, 8, 8, 8)), Some(REGION_NORTH_AMERICA));
    }

    #[test]
    fn au_is_oc() {
        assert_eq!(region_code(Ipv4Addr::new(1, 1, 1, 1)), Some(REGION_OCEANIA));
    }

    #[test]
    fn br_is_sa() {
        assert_eq!(region_code(Ipv4Addr::new(177, 54, 0, 1)), Some(REGION_SOUTH_AMERICA));
    }

    #[test]
    fn cn_is_as() {
        assert_eq!(region_code(Ipv4Addr::new(14, 0, 0, 1)), Some(REGION_ASIA));
        assert_eq!(region_code(Ipv4Addr::new(223, 255, 0, 1)), Some(REGION_ASIA));
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

    #[test]
    fn other_non_routable_ranges_are_none() {
        assert_eq!(region_code(Ipv4Addr::new(169, 254, 1, 1)), None); // link-local
        assert_eq!(region_code(Ipv4Addr::new(100, 64, 0, 1)), None); // CGNAT
        assert_eq!(region_code(Ipv4Addr::new(0, 0, 0, 0)), None); // unspecified
        assert_eq!(region_code(Ipv4Addr::new(255, 255, 255, 255)), None); // broadcast
    }
}