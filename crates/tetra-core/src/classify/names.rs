//! Classification of a server's display name: is it a hoster's default, and
//! is it written in a script the player can read? Neither is a judgement of
//! quality — both are opt-in/opt-out UI filters. See .ai-notes for rationale.

/// Hosting-company substrings, matched case-insensitively anywhere in the name.
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

/// Separators that can introduce a trailing "who hosts this" credit — a bare
/// space does not count.
const ATTRIBUTION_SEPARATORS: &[&str] = &[" - ", " – ", " — ", " | ", " · ", " by "];

/// Words that carry identity, once digits are dropped.
fn distinctive_words(text: &str) -> usize {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|token| {
            let word: String = token.chars().filter(|c| c.is_alphabetic()).collect();
            !word.is_empty() && !FILLER_WORDS.contains(&word.as_str())
        })
        .count()
}

/// Whether this fragment is a hosting credit and nothing else — the company's
/// name, a domain suffix, and filler.
fn is_only_a_hosting_credit(tail: &str) -> bool {
    let mut stripped = tail.to_string();
    let mut had_marker = false;
    for marker in HOST_MARKERS {
        if stripped.contains(marker) {
            had_marker = true;
            stripped = stripped.replace(marker, " ");
        }
    }
    had_marker && distinctive_words(&stripped) == 0
}

/// Drop a trailing hosting credit, if the name ends in one — takes the
/// rightmost qualifying separator, so multiple pipes in the admin's own name
/// are left alone.
fn strip_trailing_attribution(lower: &str) -> &str {
    let mut cut: Option<usize> = None;
    for sep in ATTRIBUTION_SEPARATORS {
        let mut from = 0;
        while let Some(offset) = lower[from..].find(sep) {
            let at = from + offset;
            if is_only_a_hosting_credit(&lower[at + sep.len()..]) && cut.is_none_or(|c| at > c) {
                cut = Some(at);
            }
            from = at + sep.len();
        }
    }
    match cut {
        Some(at) => lower[..at].trim_end_matches(|c: char| !c.is_alphanumeric()),
        None => lower,
    }
}

/// Whether this name carries a hosting company's branding, or was never set —
/// a hoster's name anywhere in it, or nothing distinctive typed at all, minus
/// a trailing hosting credit (which doesn't count against the admin's own
/// name). Behind `hide_placeholder_servers`. See .ai-notes for the full case
/// breakdown.
pub fn is_placeholder_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    if lower.is_empty() {
        return false;
    }

    let body = strip_trailing_attribution(&lower);
    // Nothing but a credit — "- by nitrado.net" and not a word besides.
    if body.is_empty() {
        return true;
    }

    if HOST_MARKERS.iter().any(|marker| body.contains(marker)) {
        return true;
    }

    // A name with no letters at all ("★★★", "[24/7]") is somebody's decoration,
    // not a default, so it needs at least one letter to qualify as filler-only.
    distinctive_words(body) == 0 && body.chars().any(|c| c.is_alphabetic())
}

/// Non-Latin letter, by script block. Covers only scripts seen on real DayZ
/// servers; anything unrecognised counts as neither Latin nor non-Latin.
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

/// Scripts that are never decoration in an English name — one character
/// settles it, no ratio involved. Cyrillic/Greek excluded on purpose since
/// those do get used decoratively; see `is_cyrillic_or_greek_word` instead.
fn decisive_non_latin(ch: char) -> bool {
    matches!(ch,
        // CJK ideographs, kana, Hangul.
        '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' | '\u{F900}'..='\u{FAFF}'
        | '\u{3040}'..='\u{309F}' | '\u{30A0}'..='\u{30FF}'
        | '\u{1100}'..='\u{11FF}' | '\u{AC00}'..='\u{D7AF}'
        // Hebrew, Arabic, Thai.
        | '\u{0590}'..='\u{05FF}' | '\u{0600}'..='\u{06FF}' | '\u{0E00}'..='\u{0E7F}'
    )
}

/// Share of a name's letters that must be non-Latin before it stops counting
/// as readable-in-English. Not 50% — a Latin region tag (`[RU]`, `[CN]`) would
/// drag a wholly non-Latin name back under a half-share otherwise.
const NON_LATIN_SHARE: f32 = 0.30;

/// Whether the name is written in Latin script — script, not language. See
/// `is_english_name` for the language question. Names with no letters at all
/// count as Latin.
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

// ─── Language, as distinct from script ───────────────────────────────────────
// Offline and lexical, not an API/model — see .ai-notes for why. Three
// explicit signals, cheapest first, each tunable by editing a list.

/// Bracketed tags that mark an audience without implying a language, or that
/// imply English — a name carrying one is not judged by its other tags.
const ENGLISH_REGION_TAGS: &[&str] = &[
    "eu", "us", "usa", "uk", "gb", "na", "au", "aus", "ca", "nz", "en", "eng", "english", "int",
    "intl", "world", "global", "asia", "sea", "oce",
];

/// Bracketed tags that mark a server as addressing a non-English audience.
/// Two-letter codes included only where unambiguous as a bracket tag —
/// `[IT]`, `[IS]`, `[ID]`, `[CO]`, `[AT]` read as ordinary words and are left
/// out. `at`/`by`/`sa` also removed; see .ai-notes.
const FOREIGN_REGION_TAGS: &[&str] = &[
    "ger", "de", "deu", "ru", "rus", "ua", "ukr", "kz", "br", "bra", "pt", "por", "fr", "fra",
    "es", "esp", "mx", "ar", "cl", "pe", "ve", "pl", "pol", "cz", "cze", "sk", "svk", "nl", "ned",
    "nld", "tr", "tur", "ro", "rou", "hu", "hun", "gr", "grc", "bg", "rs", "srb", "hr", "si", "lt",
    "lv", "ee", "fi", "se", "swe", "dk", "dnk", "cn", "chn", "jp", "jpn", "kr", "kor", "th", "vn",
    "tw", "hk", "il", "ir",
];

/// Letters that effectively do not occur in English words — kept separate
/// from `latin_letter`, which counts these as Latin (readable, just not
/// English).
fn foreign_letter(ch: char) -> bool {
    matches!(
        ch,
        'ä' | 'ö'
            | 'ü'
            | 'ß'
            | 'à'
            | 'á'
            | 'â'
            | 'ã'
            | 'å'
            | 'æ'
            | 'ç'
            | 'è'
            | 'é'
            | 'ê'
            | 'ë'
            | 'ì'
            | 'í'
            | 'î'
            | 'ï'
            | 'ñ'
            | 'ò'
            | 'ó'
            | 'ô'
            | 'õ'
            | 'ø'
            | 'ù'
            | 'ú'
            | 'û'
            | 'ý'
            | 'ÿ'
            | 'ł'
            | 'ż'
            | 'ź'
            | 'ś'
            | 'ć'
            | 'ń'
            | 'ę'
            | 'ą'
            | 'č'
            | 'š'
            | 'ž'
            | 'ř'
            | 'ě'
            | 'ů'
            | 'ő'
            | 'ű'
            | 'ğ'
            | 'ş'
            | 'ı'
            | 'đ'
            | 'ħ'
    )
}

/// Whole words that mark a name as non-English. Matched as a complete token,
/// never a substring (`der` inside `Wanderer` shouldn't count). Words that
/// are also English (`die`, `den`, `war`, `gut`, `hat`, `arm`, `band`, `not`,
/// `sie`) are deliberately absent.
const FOREIGN_WORDS: &[&str] = &[
    // German
    "der",
    "des",
    "aber",
    "ist",
    "sein",
    "und",
    "mit",
    "für",
    "fuer",
    "ohne",
    "kein",
    "keine",
    "nicht",
    "sind",
    "auch",
    "noch",
    "schon",
    "immer",
    "sehr",
    "mehr",
    "viel",
    "wieder",
    "gegen",
    "unser",
    "unsere",
    "euer",
    "deutsch",
    "deutsche",
    "deutschen",
    "deutscher",
    "deutschland",
    "spielen",
    "spieler",
    "freunde",
    "freundliche",
    "zocker",
    "zockern",
    "zockerfreunde",
    "suchti",
    "suchtis",
    "gemeinsam",
    "leicht",
    "gemacht",
    "letzte",
    "zuflucht",
    "ueberleben",
    "leben",
    "welt",
    "waffen",
    "bauen",
    "handel",
    "freiheit",
    "jaeger",
    "gebirgsjaeger",
    "wald",
    "dorf",
    "stadt",
    "haus",
    "nacht",
    "blut",
    "feuer",
    "wasser",
    "brot",
    "bier",
    "wurst",
    "mett",
    "zwiebelmett",
    "gurke",
    "gurken",
    "guerkchen",
    "gurkchen",
    "sterben",
    "kiste",
    "rappelkiste",
    "bude",
    "senfbude",
    "bande",
    "republik",
    "bananenrepublik",
    // Spanish, Portuguese and Latin American — `terra`/`solo`/`duo`/`trio`
    // deliberately absent, see .ai-notes.
    "latam",
    "arg",
    "uruguay",
    "paraguay",
    "venezuela",
    "colombia",
    "ecuador",
    "bolivia",
    "chile",
    "zona",
    "zonas",
    "realista",
    "realistas",
    "bastardos",
    "prueba",
    "pruebas",
    "infierno",
    "muerto",
    "retorno",
    "isla",
    "tierra",
    "hispano",
    "hispana",
    "misiones",
    "mundo",
    "sangre",
    "noche",
    "ciudad",
    "pueblo",
    "gente",
    "grupo",
    "reglas",
    "nueva",
    "nuevo",
    "mejor",
    "hermanos",
    "guerreros",
    "supervivientes",
    "silencio",
    "gloria",
    "coronados",
    "temporada",
    "aventura",
    "armas",
    "sobrevive",
    "sobrevivir",
    "juego",
    "juegos",
    "seguro",
    "libre",
    "reino",
    "norte",
    "unidos",
    "familia",
    "hogar",
    "otros",
    "muy",
    "todos",
    "entre",
    "morra",
    "honra",
    "risco",
    "ilha",
    "morte",
    "sangue",
    "noite",
    "cidade",
    "regras",
    "sobreviventes",
    "jogo",
    "jogos",
    "melhores",
    "galera",
    "irmaos",
    "missoes",
    "diversao",
    "oficial",
    "selvagem",
    "silenciosa",
    "restrita",
    "copains",
    "servidor",
    "servidores",
    "español",
    "espanol",
    "espanha",
    "sobrevivencia",
    "supervivencia",
    "jugadores",
    "jugar",
    "amigos",
    "muerte",
    "vida",
    "comunidad",
    "comunidade",
    "brasil",
    "brasileiro",
    "brasileiros",
    "português",
    "portugues",
    "jogadores",
    "jogar",
    "sobreviver",
    "guerra",
    "nosso",
    "nossa",
    "melhor",
    // French — `il` and `noc` left out (Illinois, network ops centre)
    "les",
    "votre",
    "serveur",
    "français",
    "francais",
    "francophone",
    "communauté",
    "communaute",
    "joueurs",
    "jouer",
    "survie",
    "guerre",
    "amis",
    "nouveau",
    "monde",
    "avec",
    "sans",
    "pour",
    "vous",
    "nous",
    // Polish and Czech
    "serwer",
    "polski",
    "polska",
    "gracze",
    "graczy",
    "przetrwanie",
    "wojna",
    "przyjaciele",
    "tylko",
    "serwery",
    "cesky",
    "ceska",
    "hraci",
    "prezit",
    // Italian
    "tutti",
    "regole",
    "ultimo",
    "giocatori",
    "sopravvivenza",
    "italiano",
    "italiani",
    "guerra",
    // Turkish
    "turk",
    "turkce",
    "sunucu",
    "oyuncu",
    "oyuncular",
    "hayatta",
];

/// Characters that separate several tags sharing one bracket, e.g. `[CZ/SK]`.
const TAG_SEPARATORS: &[char] = &['|', '/', ',', '-', '+', ' ', '\\', '&', ';', ':'];

/// The bracketed tags in a name, lowercased and split into their parts —
/// `[GER][PvE]` yields `ger`, `pve`; `[CZ/SK]` yields `cz`, `sk`. Splitting
/// compound brackets matters a lot in practice; see .ai-notes.
fn bracket_tags(lower: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let mut current: Option<String> = None;
    for ch in lower.chars() {
        match ch {
            '[' | '(' | '{' => current = Some(String::new()),
            ']' | ')' | '}' => {
                if let Some(tag) = current.take() {
                    for part in tag.split(TAG_SEPARATORS) {
                        let part = part.trim();
                        if !part.is_empty() {
                            tags.push(part.to_string());
                        }
                    }
                }
            }
            _ => {
                if let Some(buf) = current.as_mut() {
                    buf.push(ch);
                }
            }
        }
    }
    tags
}

/// Whether a token is *mostly* Cyrillic or Greek — a Russian/Greek word
/// rather than a Latin word wearing one exotic character. Catches names that
/// pad themselves under the `NON_LATIN_SHARE` ratio; see .ai-notes.
fn is_cyrillic_or_greek_word(token: &str) -> bool {
    let mut exotic = 0usize;
    let mut total = 0usize;
    for ch in token.chars() {
        if matches!(ch, '\u{0400}'..='\u{052F}' | '\u{0370}'..='\u{03FF}') {
            exotic += 1;
            total += 1;
        } else if ch.is_alphabetic() {
            total += 1;
        }
    }
    total > 0 && exotic * 2 > total
}

/// Whether the name reads as English. Five disqualifying tests: non-Latin
/// script, a whole Cyrillic/Greek word, a bracketed foreign tag (waived by an
/// English audience tag), a non-English letter, or a whole `FOREIGN_WORDS`
/// word. Ambiguous names (no lexical signal either way) default to English —
/// see .ai-notes for the false-negative rate and reasoning.
pub fn is_english_name(name: &str) -> bool {
    // One Han character, kana, Hangul, Hebrew, Arabic or Thai glyph is enough,
    // however much ASCII surrounds it.
    if name.chars().any(decisive_non_latin) {
        return false;
    }
    if !is_latin_name(name) {
        return false;
    }

    let lower = name.to_lowercase();

    // A whole Cyrillic or Greek *word*, which the name-wide ratio can miss when
    // the rest of the name is Latin padding.
    if lower
        .split(|c: char| !c.is_alphanumeric())
        .any(is_cyrillic_or_greek_word)
    {
        return false;
    }

    let tags = bracket_tags(&lower);
    let claims_english_audience = tags
        .iter()
        .any(|t| ENGLISH_REGION_TAGS.contains(&t.as_str()));
    if !claims_english_audience
        && tags
            .iter()
            .any(|t| FOREIGN_REGION_TAGS.contains(&t.as_str()))
    {
        return false;
    }

    // `lower` only: `foreign_letter` lists lowercase forms, and `Ä` folds to `ä`.
    if lower.chars().any(foreign_letter) {
        return false;
    }

    // Whole tokens only. A substring test would read `der` out of `Wanderer`.
    !lower
        .split(|c: char| !c.is_alphanumeric())
        .any(|token| FOREIGN_WORDS.contains(&token))
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// Real, populated servers — hiding them is the point, not an accident.
    #[test]
    fn a_hoster_name_in_the_body_is_enough() {
        for name in [
            "4Netplayers Purgatorio [ESP]",
            "GRAGOLL nitrado.net",
            "TonyRoma68 nitrado.net gameserver",
            "Nitrado Zombieland PVE",
            "nitrado.net gameserver back again",
            "4Netplayers GayZ",
        ] {
            assert!(
                is_placeholder_name(name),
                "{name:?} carries hoster branding and should be hidden"
            );
        }
    }

    #[test]
    fn a_trailing_hosting_credit_is_not_branding() {
        for name in [
            "Stoned and Afraid PVE - By Pingperfect.com",
            "ISA | Bitterroot 365 | No Bases - By Pingperfect.com",
            "Bullwark DeerIsle - By Pingperfect.com",
            "Papaws Livonia by HostHavoc.com",
            "ForzaDinamo by GTXGaming.co.uk",
            "SaltysEnochPVE - GTXGaming.co.uk",
            "Cold  realism  Winter @ Chernarus by 4Netplayers",
            "UK-INSANITY-PVE-STALKER-RETURN 2 CHERNO2035- By Pingperfect.com",
        ] {
            assert!(
                !is_placeholder_name(name),
                "{name:?} is a real name with a hosting credit appended"
            );
        }
    }

    /// The exemption must not rescue a name that was filler to begin with.
    #[test]
    fn stripping_a_credit_does_not_rescue_a_filler_name() {
        for name in [
            "DayZ Server by HostHavoc.com",
            "DayZ Standalone - By Pingperfect.com",
            "- by nitrado.net",
        ] {
            assert!(
                is_placeholder_name(name),
                "{name:?} has no name of its own once the credit is gone"
            );
        }
    }

    /// Only a marked-off clause is a credit — a bare trailing space stays hidden.
    #[test]
    fn a_bare_trailing_hoster_is_not_a_credit() {
        assert!(is_placeholder_name("GRAGOLL nitrado.net"));
        assert!(is_placeholder_name("SuperLunatics Nitrado Server"));
    }

    #[test]
    fn trailing_digits_do_not_make_a_name() {
        assert!(is_placeholder_name("4Netplayers DayZ Server15831672"));
        assert!(is_placeholder_name("nitrado.net gameserver 2"));
    }

    /// Only *known* hosters are branding — extending the filter means
    /// extending `HOST_MARKERS`.
    #[test]
    fn an_unlisted_hoster_is_just_another_word() {
        assert!(!is_placeholder_name("Hosted by SomeNewHost.io"));
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

    /// The case the 30% threshold exists for.
    #[test]
    fn a_latin_region_tag_does_not_rescue_a_non_latin_name() {
        assert!(!is_latin_name("[RU] Русский сервер PVE"));
        assert!(!is_latin_name("[CN] 生存服务器 官方"));
    }

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

    // ─── Language ────────────────────────────────────────────────────────────

    /// The report that prompted the language rule: German servers showing
    /// under ENGLISH ONLY because German is Latin script.
    #[test]
    fn latin_script_is_not_the_same_as_english() {
        for name in [
            "[GER][PvE] Zockerfreunde | Chiemsee | Trader | Helis | Cars",
            "[GER] Zockersuchtis | Fresh Wiped 01.08.2026",
            "[EU] Gebirgsjäger |Banov|PVP/PVE-Zones|Loot+/Stamina+|Rules!",
            "Zwiebelmett mit Guerkchen GER|MAPLINK|PVE/PVP|Trader|MMG|Helis|",
            "- Letzte Zuflucht | Deutsch German | Untergrundbase | Safe Base",
        ] {
            assert!(is_latin_name(name), "{name:?} is Latin script");
            assert!(!is_english_name(name), "{name:?} is not English");
        }
    }

    /// A bracketed language/country tag is enough on its own, even when every
    /// other word is English.
    #[test]
    fn a_language_tag_settles_it() {
        for name in [
            "[BR] THE KINGZ | FULL PVE | SEASON 1",
            "[RU] FIDA | PVE | NO MODS",
            "[UA] Ukrainian Stalker Project RP test",
            "(ESP)Los Desahuciados RP-PVE-PVP",
            "[PL]SPRZYMIERZENI PvE Strefy PvP",
        ] {
            assert!(
                !is_english_name(name),
                "{name:?} tags a non-English audience"
            );
        }
    }

    #[test]
    fn an_audience_tag_waives_the_language_tag() {
        assert!(is_english_name("[EU] Survivor Haven | PVE | Loot+"));
        assert!(is_english_name("[US] Wasteland | 1PP | High Loot"));
        // Waived, but the umlaut still condemns it — the signals are
        // independent, and this one is German whatever its tag says.
        assert!(!is_english_name("[EU] Gebirgsjäger |Cherno|PVP"));
    }

    /// The ones a careless word list would eat: `Wanderer` contains "der",
    /// `Bandit` contains "band".
    #[test]
    fn english_names_survive() {
        for name in [
            "Survivor Haven | PVE | Loot+",
            "The Wanderer | Chernarus | 1PP",
            "Bandit Country | PVP | High Loot",
            "[EU] BLOOD & BANDAGES|1.5X LOOT|CLUSTER",
            "DayZ Chernarus 1PP",
            "Wasteland ★ PVP ★ High Loot",
            "Deer Isle Nights",
        ] {
            assert!(is_english_name(name), "{name:?} is an English name");
        }
    }

    /// Substring matches fail silently — the server just stops appearing.
    #[test]
    fn a_foreign_word_inside_an_english_word_does_not_count() {
        // "und" inside "Thunder", "mit" inside "Summit", "vida" inside "Vidal".
        for name in ["Thunder Ridge PVP", "Summit Survival", "Vidal Heights RP"] {
            assert!(
                is_english_name(name),
                "{name:?} was caught by a substring, not a word"
            );
        }
    }

    #[test]
    fn non_latin_names_are_still_not_english() {
        for name in ["生存服务器", "Русский сервер", "[RU] Русский сервер PVE"]
        {
            assert!(!is_english_name(name), "{name:?}");
        }
    }

    /// One Han character settles it, whatever the ratio.
    #[test]
    fn a_single_han_character_is_decisive() {
        for name in [
            "[TN]#鹿岛/PVE Deerisle QQ群703109220",
            "BX公益服|PVP仿官|Vanilla+",
            "PVE服",
            "[Lake]Vanilla/HighLoot/한국어",
        ] {
            assert!(!is_english_name(name), "{name:?} contains CJK/Hangul");
        }
        assert!(
            is_latin_name("BX公益服|PVP仿官|Vanilla+"),
            "the script test is unchanged; the language test is what catches it"
        );
    }

    /// None of these carry a bracketed language tag the tag rule could see.
    #[test]
    fn spanish_and_portuguese_are_not_english() {
        for name in [
            "🌵 LATAMDESERT | FULL PVE + 4 ZONAS PVP | AUTOS REALISTAS |",
            "El server de prueba jonyep",
            "| Latam | Arg | Chile | BASTARDOS | BBP | 6 Man Party | PVP |",
            "PelotaZ || Airborne 2 - Morra com Honra || AI Combat ||",
            "INFIERNO MUERTO: La isla sin retorno [ARG].",
            "Scars PVE - Entre por sua conta e risco.",
        ] {
            assert!(!is_english_name(name), "{name:?}");
        }
    }

    /// Every one of these was visible under ENGLISH ONLY before `bracket_tags`
    /// split compound tags like `[CZ/SK]`.
    #[test]
    fn several_tags_can_share_one_bracket() {
        for name in [
            "[CZ/SK] Bolted.cz | Chernarus PVP/PVE - WIPE 3/7",
            "[CZ-SK] Usvit nemrtvych PVE / PVP zone",
            "Project-Z (GER/PVE)",
            "(PVE-GER) Haicatraz",
            "[GER HKD] LootIsland PVE|Fresh Wipe 08 April|Synced|Quest|Trade",
            "DeerIsle PVE [FR-QC]",
            "[PVE-Fr] CocoDayZ",
            "[RU/PVE] UNION STALKER | Mutants | Artefacts | X5 Loot",
            "[BR/3PP] +18 Deathmatch | 20MM | .50Cal",
            "[UA-PVE] MKASGaming",
            "Andes Cloud Dayz [ES-AR]",
            "Baltic Chernarus [LT-LV-EE] 1PP | Extended Vanilla | Cars+",
            "[SG/TH] Intelligent DayZ | Hardcore AI Camps | Zombie Horde",
        ] {
            assert!(
                !is_english_name(name),
                "{name:?} tags a non-English audience"
            );
        }
    }

    /// The waiver has to see `en` as a split part of `[GER/EN]`, not merely a
    /// whole bracket — worth ~30 servers on a real registry.
    #[test]
    fn a_bilingual_tag_still_waives() {
        for name in [
            "[GER/EN] TagZ PVE/PVP Trader/Base+/AI/Quests/more",
            "[RU|EN|EU] REQUIEM  PVP LOOT+|EVENTS discord.gg/SnzeUez",
            "[PL/EN] Almost Vanilla x1.5 1PP  WIPED 20.02",
            "[ES,EN] Sakhal 1PP | Traders | Levels | Jobs | Home | Clans",
            "[DE/EN] Hungerland | Survival PvE Hard | AI | Skills | BaseBuil",
            "[SK/EN] Krajina Nemrtvych | Trader | Mutants | Loot 1,5x | Cars",
        ] {
            assert!(
                is_english_name(name),
                "{name:?} advertises an English audience"
            );
        }
    }

    /// `[SA]` is the sharpest case: in DayZ it means Standalone, not South Africa.
    #[test]
    fn splitting_tags_does_not_resurrect_ambiguous_country_codes() {
        for name in [
            "Forgotten Jungle (Enter At Own Risk) Terje Skills",
            "[EU] Antoria Official Server (By Vlad and Mr Crumpet)",
            "[SA] Chernarus Vanilla | 1PP",
            "[US] Wasteland (Built By The Community)",
        ] {
            assert!(
                is_english_name(name),
                "{name:?} is English — at/by/sa are not country tags here"
            );
        }
    }

    /// A Russian name padded with Latin map/mode tags can sail under the 30%
    /// ratio cut while being plainly Russian.
    #[test]
    fn a_cyrillic_word_beats_the_ratio() {
        for name in [
            "!*ВДАЛИ от ЖЁН Chernarus*! 1 [PVE] [vk.com/vdzh_pve]",
            "Выживание Chernarus PVE Trader Helis Cars Airdrop Loot",
        ] {
            assert!(!is_english_name(name), "{name:?} contains Cyrillic words");
        }
    }

    /// ...and the case that kept Cyrillic off the decisive-character list must
    /// still survive: a Latin word wearing one Cyrillic letter is not a Russian
    /// word, because it is not *mostly* Cyrillic.
    #[test]
    fn a_decorative_cyrillic_letter_is_not_a_cyrillic_word() {
        assert!(is_english_name("Чernarus Survival — English Community"));
        assert!(is_english_name("ЯED Zone PVP | High Loot"));
    }

    /// `é` used to be missing from `foreign_letter` while `è`/`ê`/`ë` were present.
    #[test]
    fn e_acute_is_a_foreign_letter() {
        for name in [
            "Québec Vanilla",
            "Serv Privé",
            "Révélation 13",
            "EXIL | PvP | Moddé | Trader | Missions | Vehicles | Events",
            "Infection Z | PHASE DE TEST | Testeurs recherchés !",
        ] {
            assert!(!is_english_name(name), "{name:?} carries an acute e");
        }
    }

    /// Words a careless list would have added: `solo`/`duo`/`trio` are DayZ
    /// jargon, `terra`/`il`/`noc`/`diversion` are ordinary English words too.
    #[test]
    fn dayz_jargon_and_english_lookalikes_are_not_foreign_words() {
        for name in [
            "Decay | EU | Solo/Duo/Trio | A Balanced Modded Experience",
            "Rearmed US2 | Solo Duo Trio",
            "DSS Terra Incognita PVE Missions Drop Quests",
            "Terra Nova | Vanilla+ | 1PP",
            "NOC_SERVER",
            "Northern IL Survivors | PVP",
            "A Welcome Diversion | PVE",
        ] {
            assert!(is_english_name(name), "{name:?} is English");
        }
    }
}
