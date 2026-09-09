//! Telling a real DayZ server from a spoofed listing.
//!
//! The DayZ master list is full of servers that publish a fabricated player
//! count so they sort to the top of a browser ordered by players. They are not
//! joinable and they outnumber the real thing: of 195,659 rows one pass
//! collected, only 34,137 came from a server that answered honestly.
//!
//! The tell is `bots`. DayZ has no bot slots, so a real server reports zero
//! — verified against official Bohemia servers and community ones alike —
//! while a spoofer mirrors its fake player count into `bots` too (162,392 of
//! the 162,466 rows with a nonzero `bots` had `bots == players`). The rest of
//! the checks catch the same servers by their other lies: counts saturated at
//! a `u8`, more players than slots, and names built from control characters.

/// Highest player/slot count DayZ can actually run. Anything at or above the
/// `u8` ceiling is a saturated sentinel, not a measurement.
const IMPOSSIBLE_COUNT: i32 = 255;

/// Whether a server-list row came from a spoofed listing rather than a real
/// DayZ server. Rows that fail this are neither stored nor shown.
pub fn is_fake_listing(name: &str, players: i32, max_players: i32, bots: i32) -> bool {
    // DayZ reports no bots; a spoofer copies its inflated count into the field.
    if bots > 0 {
        return true;
    }
    if players >= IMPOSSIBLE_COUNT || max_players >= IMPOSSIBLE_COUNT {
        return true;
    }
    // Queue length is published separately (the `lqs` keyword), so a row can
    // never legitimately hold more players than it has slots.
    if max_players > 0 && players > max_players {
        return true;
    }
    // Padding a name with control characters is how these listings make
    // themselves wide in a browser; no real server name contains them.
    name.chars().any(|c| c.is_control())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_real_server_is_kept() {
        // Requiem PVE, as it answers A2S_INFO.
        assert!(!is_fake_listing("NEW | Requiem PVE | 300k Start", 3, 70, 0));
        // An official server, empty.
        assert!(!is_fake_listing("4181 | EUROPE - DE", 0, 60, 0));
        // A master-list row Steam couldn't resolve carries structural zeroes.
        assert!(!is_fake_listing("", 0, 0, 0));
    }

    #[test]
    fn a_mirrored_bot_count_is_the_giveaway() {
        assert!(is_fake_listing("[-]Gliqury |3PP|Part", 196, 200, 196));
        assert!(is_fake_listing("[-]Ivrochaso |PVE|St", 126, 127, 126));
    }

    #[test]
    fn saturated_counts_are_not_measurements() {
        assert!(is_fake_listing("RU CHAMPIONS", 255, 255, 0));
        assert!(is_fake_listing("filled to the brim", 60, 255, 0));
    }

    #[test]
    fn more_players_than_slots_is_impossible() {
        assert!(is_fake_listing("over capacity", 61, 60, 0));
        // A full server is not over capacity.
        assert!(!is_fake_listing("full house", 60, 60, 0));
    }

    #[test]
    fn control_characters_in_a_name_are_padding() {
        assert!(is_fake_listing(&"\u{1}".repeat(68), 0, 60, 0));
        assert!(is_fake_listing("Tropic Thunder\t1PP", 1, 20, 0));
    }
}
