//! Classification of a server's display name, for the browser's noise filters.
//!
//! Two questions, both answered from the name alone:
//!
//! - Is this a *placeholder* — a hosting company's default name that the admin
//!   never changed, or a literal template string?
//! - Is the name written in a script the player can read?
//!
//! Neither is a judgement about server quality. A default-named server can be
//! busy (52 of the 75 `nitrado.net gameserver` rows in a real 8,649-server
//! registry had players on them), and a Chinese-named server is only "noise" to
//! someone who cannot read Chinese. Both filters are therefore opt-out /
//! opt-in preferences in the UI, never unconditional.

/// Substrings that identify a hosting company's default server name.
///
/// Matched case-insensitively anywhere in the name, because the observed
/// variants wrap the default rather than replace it — `nitrado.net gameserver`,
/// `TonyRoma68 nitrado.net gameserver`, `DayZ Server by HostHavoc.com`.
const HOST_MARKERS: &[&str] = &[
    "nitrado",
    "gtxgaming",
    "gtx gaming",
    "hosthavoc",
    "host havoc",
    "pingperfect",
    "ping perfect",
    "4netplayers",
    "g-portal",
    "gportal",
    "zap-hosting",
    "zaphosting",
    "fragnet",
    "survivalservers",
    "indifferent broccoli",
];

/// Words that carry no identity — filler around a default name.
///
/// A name built only from these (plus a hoster marker and any digits) tells the
/// player nothing that distinguishes one server from the next, which is the
/// whole complaint.
const FILLER_WORDS: &[&str] = &[
    "dayz",
    "day",
    "z",
    "server",
    "servers",
    "gameserver",
    "gameservers",
    "game",
    "standalone",
    "hosted",
    "hosting",
    "by",
    "the",
    "a",
    "of",
    "and",
    "com",
    "net",
    "org",
    "co",
    "uk",
    "www",
    "example",
    "name",
    "test",
    "new",
    "my",
    "standard",
    "unnamed",
    "default",
    "official",
];

/// Whether this name looks like nobody ever set one.
///
/// The rule is "nothing distinctive survives", not "contains a hoster's name".
/// A substring test on the marker alone is too blunt: it flags
/// `4Netplayers Purgatorio [ESP]` and `GRAGOLL nitrado.net`, which are real
/// servers whose admins kept the hoster prefix and then named the thing. Both
/// are perfectly identifiable in a list, and hiding them is not what was asked
/// for. So the marker is stripped and what remains is examined — if every word
/// left is filler or digits, there was never a name here.
///
/// An empty name is deliberately *not* a placeholder: that is a server this
/// launcher has never had a reply from, so the name is missing rather than
/// default. It has its own filter — see `ServerFilter::hide_unnamed`.
pub fn is_placeholder_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    if lower.is_empty() {
        return false;
    }

    // Remove any hoster marker first, so "hosted by gtxgaming.co.uk" is judged
    // on "hosted by co uk" rather than on the company's name.
    let mut stripped = lower.clone();
    let mut had_marker = false;
    for marker in HOST_MARKERS {
        if stripped.contains(marker) {
            had_marker = true;
            stripped = stripped.replace(marker, " ");
        }
    }

    // Words, with digits dropped — "server15831672" is still just "server".
    let mut distinctive = 0usize;
    for token in stripped.split(|c: char| !c.is_alphanumeric()) {
        let word: String = token.chars().filter(|c| c.is_alphabetic()).collect();
        if word.is_empty() || FILLER_WORDS.contains(&word.as_str()) {
            continue;
        }
        distinctive += 1;
    }

    if distinctive > 0 {
        return false;
    }
    // Nothing distinctive left. That is a placeholder if it came from a known
    // hoster, or if it was filler from the start ("DayZ Server", "TEST").
    had_marker || !lower.chars().all(|c| !c.is_alphabetic())
}

/// Non-Latin letter, by script block.
///
/// Deliberately covers only scripts seen on real DayZ servers plus the obvious
/// neighbours. Anything unrecognised counts as neither Latin nor non-Latin and
/// simply does not affect the ratio.
fn non_latin_letter(ch: char) -> bool {
    matches!(ch,
        // CJK ideographs — Chinese, and Japanese written in kanji.
        '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' | '\u{F900}'..='\u{FAFF}'
        // Japanese kana.
        | '\u{3040}'..='\u{309F}' | '\u{30A0}'..='\u{30FF}'
        // Korean.
        | '\u{1100}'..='\u{11FF}' | '\u{AC00}'..='\u{D7AF}'
        // Cyrillic.
        | '\u{0400}'..='\u{052F}'
        // Greek, Hebrew, Arabic, Thai.
        | '\u{0370}'..='\u{03FF}' | '\u{0590}'..='\u{05FF}'
        | '\u{0600}'..='\u{06FF}' | '\u{0E00}'..='\u{0E7F}'
    )
}

/// Latin letter, including the accented ranges — `Sérvidor` is still Latin.
fn latin_letter(ch: char) -> bool {
    ch.is_ascii_alphabetic() || matches!(ch, '\u{00C0}'..='\u{024F}')
}

/// Share of a name's letters that must be non-Latin before it stops counting
/// as readable-in-English.
///
/// Not 50%: a great many non-English servers front their name with a Latin
/// region tag — `[RU] Русский сервер`, `[CN] 生存服务器` — which would drag a
/// wholly Russian or Chinese name back under a half-share and leave it visible.
/// At a third, those are caught while a Latin name carrying one decorative
/// character is not.
const NON_LATIN_SHARE: f32 = 0.30;

/// Whether the name reads as English/Latin script.
///
/// Names with no letters at all (`"[24/7]"`, `"★★★"`, pure punctuation) count
/// as Latin: there is nothing to be unreadable, and hiding them under a
/// language filter would surprise.
pub fn is_latin_name(name: &str) -> bool {
    let mut latin = 0usize;
    let mut other = 0usize;
    for ch in name.chars() {
        if non_latin_letter(ch) {
            other += 1;
        } else if latin_letter(ch) {
            latin += 1;
        }
    }
    let total = latin + other;
    if total == 0 {
        return true;
    }
    (other as f32 / total as f32) < NON_LATIN_SHARE
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Names observed verbatim in a real 8,649-server registry. Every one of
    /// these is the hosting company's default with nothing added.
    #[test]
    fn catches_the_hoster_defaults_seen_in_the_wild() {
        for name in [
            "nitrado.net gameserver",
            "Hosted by GTXGaming.co.uk",
            "DayZ Server by HostHavoc.com",
            "4Netplayers DayZ Server",
            "EXAMPLE NAME",
        ] {
            assert!(
                is_placeholder_name(name),
                "{name:?} should be a placeholder"
            );
        }
    }

    #[test]
    fn filler_only_names_are_placeholders() {
        for name in [
            "TEST",
            "  dayz server  ",
            "DayZ Standalone Server",
            "New Server",
        ] {
            assert!(is_placeholder_name(name), "{name:?} carries no identity");
        }
    }

    #[test]
    fn one_distinctive_word_is_enough_to_keep_a_name() {
        for name in [
            "Testosterone Wasteland",
            "Bob's DayZ Server",
            "The Test Kitchen | PVE",
            "Server 51 | Chernarus",
        ] {
            assert!(!is_placeholder_name(name), "{name:?} is a real name");
        }
    }

    /// The false positives that a plain substring match on the hoster produced.
    /// These admins kept the hosting company's prefix and then named the
    /// server; the name identifies it perfectly well and must survive.
    #[test]
    fn a_hoster_prefix_does_not_condemn_a_named_server() {
        for name in [
            "4Netplayers Purgatorio [ESP]",
            "GRAGOLL nitrado.net",
            "TonyRoma68 nitrado.net gameserver",
            "Nitrado Zombieland PVE",
        ] {
            assert!(
                !is_placeholder_name(name),
                "{name:?} has a real name attached and must stay visible"
            );
        }
    }

    /// Digits carry no identity — a serial number appended to a default name
    /// is still a default name.
    #[test]
    fn trailing_digits_do_not_make_a_name() {
        assert!(is_placeholder_name("4Netplayers DayZ Server15831672"));
        assert!(is_placeholder_name("nitrado.net gameserver 2"));
    }

    /// A deliberate, documented miss.
    ///
    /// `nitrado.net gameserver back again` is in the real data and is morally a
    /// default name, but "back again" is words a human typed, and the rule this
    /// module is built on is "anything the admin actually wrote survives".
    /// Catching it would mean stripping arbitrary trailing phrases, which is how
    /// a filter starts eating real names. One row out of 8,649 is the right side
    /// to err on: showing a server that could have been hidden costs a line of
    /// list, hiding one that should not have been costs a server you cannot find.
    #[test]
    fn typed_words_survive_even_next_to_a_default_name() {
        assert!(!is_placeholder_name("nitrado.net gameserver back again"));
    }

    #[test]
    fn an_empty_name_is_not_a_placeholder() {
        // Missing, not default — `hide_unnamed` covers it instead.
        assert!(!is_placeholder_name(""));
        assert!(!is_placeholder_name("   "));
    }

    #[test]
    fn ordinary_english_names_are_latin() {
        for name in [
            "Survivor Haven | PVE | Loot+",
            "[US] BLOOD & BANDAGES|1.5X LOOT|CLUSTER",
            "Sérvidor Español",
            "DayZ Chernarus 1PP",
        ] {
            assert!(is_latin_name(name), "{name:?} should read as Latin");
        }
    }

    #[test]
    fn wholly_non_latin_names_are_not() {
        for name in ["生存服务器", "Русский сервер", "생존 서버", "サバイバル鯖"]
        {
            assert!(!is_latin_name(name), "{name:?} should not read as Latin");
        }
    }

    /// The case the 30% threshold exists for: a Latin region tag on the front
    /// of an otherwise entirely non-Latin name.
    #[test]
    fn a_latin_region_tag_does_not_rescue_a_non_latin_name() {
        assert!(!is_latin_name("[RU] Русский сервер PVE"));
        assert!(!is_latin_name("[CN] 生存服务器 官方"));
    }

    /// ...and the converse: an English name wearing one decorative character
    /// must stay visible.
    #[test]
    fn a_decorative_character_does_not_condemn_an_english_name() {
        assert!(is_latin_name("Чernarus Survival — English Community"));
        assert!(is_latin_name("Wasteland ★ PVP ★ High Loot"));
    }

    #[test]
    fn names_with_no_letters_count_as_latin() {
        for name in ["[24/7]", "★★★", "1.28", ""] {
            assert!(is_latin_name(name), "{name:?} has nothing to be unreadable");
        }
    }
}
