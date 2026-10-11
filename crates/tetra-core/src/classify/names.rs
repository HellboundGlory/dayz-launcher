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

    fn assert_names(cases: &[(&str, &[&str])], check: fn(&str) -> bool, expected: bool) {
        for (case, names) in cases {
            for name in *names {
                assert_eq!(check(name), expected, "{case}: {name:?}");
            }
        }
    }

    #[test]
    fn placeholder_names_are_hidden() {
        assert_names(
            &[
                (
                    "a hoster's default name",
                    &[
                        "nitrado.net gameserver",
                        "Hosted by GTXGaming.co.uk",
                        "DayZ Server by HostHavoc.com",
                        "4Netplayers DayZ Server",
                    ],
                ),
                (
                    "nothing but filler",
                    &[
                        "EXAMPLE NAME",
                        "TEST",
                        "  dayz server  ",
                        "DayZ Standalone Server",
                        "New Server",
                    ],
                ),
                // Real, populated servers — hiding them is the point, not an accident.
                (
                    "a hoster's branding inside an otherwise real name",
                    &[
                        "4Netplayers Purgatorio [ESP]",
                        "TonyRoma68 nitrado.net gameserver",
                        "Nitrado Zombieland PVE",
                        "nitrado.net gameserver back again",
                        "4Netplayers GayZ",
                    ],
                ),
                // The credit exemption must not rescue a name that was filler to begin with.
                (
                    "a trailing credit that leaves no name of its own",
                    &[
                        "DayZ Server by HostHavoc.com",
                        "DayZ Standalone - By Pingperfect.com",
                        "- by nitrado.net",
                    ],
                ),
                // Only a marked-off clause is a credit; a bare trailing space stays hidden.
                (
                    "a bare trailing hoster is branding, not a credit",
                    &["GRAGOLL nitrado.net", "SuperLunatics Nitrado Server"],
                ),
                (
                    "trailing digits do not make a name",
                    &[
                        "4Netplayers DayZ Server15831672",
                        "nitrado.net gameserver 2",
                    ],
                ),
            ],
            is_placeholder_name,
            true,
        );
    }

    #[test]
    fn distinctive_names_are_kept() {
        assert_names(
            &[
                (
                    "one distinctive word",
                    &[
                        "Testosterone Wasteland",
                        "Bob's DayZ Server",
                        "The Test Kitchen | PVE",
                        "Server 51 | Chernarus",
                    ],
                ),
                (
                    "a trailing hosting credit",
                    &[
                        "Stoned and Afraid PVE - By Pingperfect.com",
                        "ISA | Bitterroot 365 | No Bases - By Pingperfect.com",
                        "Bullwark DeerIsle - By Pingperfect.com",
                        "Papaws Livonia by HostHavoc.com",
                        "ForzaDinamo by GTXGaming.co.uk",
                        "SaltysEnochPVE - GTXGaming.co.uk",
                        "Cold  realism  Winter @ Chernarus by 4Netplayers",
                        "UK-INSANITY-PVE-STALKER-RETURN 2 CHERNO2035- By Pingperfect.com",
                    ],
                ),
                // Only the markers in `HOST_MARKERS` count.
                ("an unlisted hoster", &["Hosted by SomeNewHost.io"]),
                // Missing, not default — `hide_unnamed` covers it instead.
                ("an empty name", &["", "   "]),
            ],
            is_placeholder_name,
            false,
        );
    }

    #[test]
    fn latin_names_are_recognised() {
        assert_names(
            &[
                (
                    "ordinary English",
                    &[
                        "Survivor Haven | PVE | Loot+",
                        "[US] BLOOD & BANDAGES|1.5X LOOT|CLUSTER",
                        "Sérvidor Español",
                        "DayZ Chernarus 1PP",
                    ],
                ),
                // One Cyrillic letter does not condemn an English name.
                (
                    "a decorative character",
                    &[
                        "Чernarus Survival — English Community",
                        "Wasteland ★ PVP ★ High Loot",
                    ],
                ),
                // Nothing in it to be unreadable.
                ("no letters at all", &["[24/7]", "★★★", "1.28", ""]),
                // Latin script is not the same as English.
                (
                    "German written in Latin script",
                    &[
                        "[GER][PvE] Zockerfreunde | Chiemsee | Trader | Helis | Cars",
                        "[GER] Zockersuchtis | Fresh Wiped 01.08.2026",
                        "[EU] Gebirgsjäger |Banov|PVP/PVE-Zones|Loot+/Stamina+|Rules!",
                        "Zwiebelmett mit Guerkchen GER|MAPLINK|PVE/PVP|Trader|MMG|Helis|",
                        "- Letzte Zuflucht | Deutsch German | Untergrundbase | Safe Base",
                    ],
                ),
                // The script ratio stays as it is; the language rule is what catches this.
                (
                    "a mostly Latin name wearing CJK tags",
                    &["BX公益服|PVP仿官|Vanilla+"],
                ),
            ],
            is_latin_name,
            true,
        );
    }

    #[test]
    fn non_latin_names_are_not_recognised() {
        assert_names(
            &[
                (
                    "wholly non-Latin",
                    &["生存服务器", "Русский сервер", "생존 서버", "サバイバル鯖"],
                ),
                // The case the 30% threshold exists for.
                (
                    "a Latin region tag does not rescue it",
                    &["[RU] Русский сервер PVE", "[CN] 生存服务器 官方"],
                ),
            ],
            is_latin_name,
            false,
        );
    }

    #[test]
    fn non_english_names_are_rejected() {
        assert_names(
            &[
                // A bracketed language tag settles it even when every other word is English.
                (
                    "a language tag",
                    &[
                        "[BR] THE KINGZ | FULL PVE | SEASON 1",
                        "[RU] FIDA | PVE | NO MODS",
                        "[UA] Ukrainian Stalker Project RP test",
                        "(ESP)Los Desahuciados RP-PVE-PVP",
                        "[PL]SPRZYMIERZENI PvE Strefy PvP",
                    ],
                ),
                // German servers were shown under ENGLISH ONLY before this rule.
                (
                    "Latin script is not the same as English",
                    &[
                        "[GER][PvE] Zockerfreunde | Chiemsee | Trader | Helis | Cars",
                        "[GER] Zockersuchtis | Fresh Wiped 01.08.2026",
                        "[EU] Gebirgsjäger |Banov|PVP/PVE-Zones|Loot+/Stamina+|Rules!",
                        "Zwiebelmett mit Guerkchen GER|MAPLINK|PVE/PVP|Trader|MMG|Helis|",
                        "- Letzte Zuflucht | Deutsch German | Untergrundbase | Safe Base",
                        // Waived by its `[EU]` tag, but the umlaut still condemns it.
                        "[EU] Gebirgsjäger |Cherno|PVP",
                    ],
                ),
                // All of these were visible under ENGLISH ONLY before compound tags like
                // `[CZ/SK]` were split.
                (
                    "several tags sharing one bracket",
                    &[
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
                    ],
                ),
                // None of these carry a bracketed tag the tag rule could see.
                (
                    "Spanish or Portuguese with no tag",
                    &[
                        "🌵 LATAMDESERT | FULL PVE + 4 ZONAS PVP | AUTOS REALISTAS |",
                        "El server de prueba jonyep",
                        "| Latam | Arg | Chile | BASTARDOS | BBP | 6 Man Party | PVP |",
                        "PelotaZ || Airborne 2 - Morra com Honra || AI Combat ||",
                        "INFIERNO MUERTO: La isla sin retorno [ARG].",
                        "Scars PVE - Entre por sua conta e risco.",
                    ],
                ),
                // Latin map/mode tags can sail a Russian name under the 30% ratio cut.
                (
                    "a Cyrillic word under a padded Latin name",
                    &[
                        "!*ВДАЛИ от ЖЁН Chernarus*! 1 [PVE] [vk.com/vdzh_pve]",
                        "Выживание Chernarus PVE Trader Helis Cars Airdrop Loot",
                    ],
                ),
                // `é` was missing from `foreign_letter` while `è`/`ê`/`ë` were present.
                (
                    "an acute e",
                    &[
                        "Québec Vanilla",
                        "Serv Privé",
                        "Révélation 13",
                        "EXIL | PvP | Moddé | Trader | Missions | Vehicles | Events",
                        "Infection Z | PHASE DE TEST | Testeurs recherchés !",
                    ],
                ),
                (
                    "non-Latin script",
                    &["生存服务器", "Русский сервер", "[RU] Русский сервер PVE"],
                ),
                // One Han character settles it, whatever the ratio.
                (
                    "a single Han or Hangul character",
                    &[
                        "[TN]#鹿岛/PVE Deerisle QQ群703109220",
                        "BX公益服|PVP仿官|Vanilla+",
                        "PVE服",
                        "[Lake]Vanilla/HighLoot/한국어",
                    ],
                ),
            ],
            is_english_name,
            false,
        );
    }

    #[test]
    fn english_names_are_accepted() {
        assert_names(
            &[
                // `Wanderer` contains "der" and `Bandit` contains "band".
                (
                    "plain English",
                    &[
                        "Survivor Haven | PVE | Loot+",
                        "The Wanderer | Chernarus | 1PP",
                        "Bandit Country | PVP | High Loot",
                        "[EU] BLOOD & BANDAGES|1.5X LOOT|CLUSTER",
                        "DayZ Chernarus 1PP",
                        "Wasteland ★ PVP ★ High Loot",
                        "Deer Isle Nights",
                    ],
                ),
                (
                    "an audience tag waiving the language tag",
                    &[
                        "[EU] Survivor Haven | PVE | Loot+",
                        "[US] Wasteland | 1PP | High Loot",
                    ],
                ),
                // "und" in `Thunder`, "mit" in `Summit`, "vida" in `Vidal`: a substring
                // match fails silently, the server just stops appearing.
                (
                    "a foreign substring inside a longer word",
                    &["Thunder Ridge PVP", "Summit Survival", "Vidal Heights RP"],
                ),
                // The waiver has to see `en` as a split part of `[GER/EN]`, not a whole bracket.
                (
                    "a bilingual tag",
                    &[
                        "[GER/EN] TagZ PVE/PVP Trader/Base+/AI/Quests/more",
                        "[RU|EN|EU] REQUIEM  PVP LOOT+|EVENTS discord.gg/SnzeUez",
                        "[PL/EN] Almost Vanilla x1.5 1PP  WIPED 20.02",
                        "[ES,EN] Sakhal 1PP | Traders | Levels | Jobs | Home | Clans",
                        "[DE/EN] Hungerland | Survival PvE Hard | AI | Skills | BaseBuil",
                        "[SK/EN] Krajina Nemrtvych | Trader | Mutants | Loot 1,5x | Cars",
                    ],
                ),
                // `[SA]` means Standalone in DayZ, not South Africa; `at`, `by` and `sa`
                // are not country tags here.
                (
                    "ambiguous country codes",
                    &[
                        "Forgotten Jungle (Enter At Own Risk) Terje Skills",
                        "[EU] Antoria Official Server (By Vlad and Mr Crumpet)",
                        "[SA] Chernarus Vanilla | 1PP",
                        "[US] Wasteland (Built By The Community)",
                    ],
                ),
                // A Latin word wearing one Cyrillic letter is not a Cyrillic word.
                (
                    "one decorative Cyrillic letter",
                    &[
                        "Чernarus Survival — English Community",
                        "ЯED Zone PVP | High Loot",
                    ],
                ),
                // `solo`/`duo`/`trio` are DayZ jargon; `terra`/`il`/`noc`/`diversion` are
                // ordinary English words too.
                (
                    "DayZ jargon and English lookalikes",
                    &[
                        "Decay | EU | Solo/Duo/Trio | A Balanced Modded Experience",
                        "Rearmed US2 | Solo Duo Trio",
                        "DSS Terra Incognita PVE Missions Drop Quests",
                        "Terra Nova | Vanilla+ | 1PP",
                        "NOC_SERVER",
                        "Northern IL Survivors | PVP",
                        "A Welcome Diversion | PVE",
                    ],
                ),
            ],
            is_english_name,
            true,
        );
    }
}
