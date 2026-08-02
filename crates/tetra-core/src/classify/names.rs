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

/// Substrings that identify a hosting company.
///
/// Matched case-insensitively anywhere in the name. This list is the entire
/// reach of condition 1 in `is_placeholder_name` — a hoster absent from here is
/// invisible to the filter, so adding a company is how the filter grows.
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

/// Separators that can introduce a trailing "who hosts this" credit.
///
/// Only these — a bare space does not count. `GRAGOLL nitrado.net` has to stay
/// hidden, and the difference between it and `Papaws Livonia by HostHavoc.com`
/// is precisely that the latter marks the credit off as its own clause.
const ATTRIBUTION_SEPARATORS: &[&str] = &[" - ", " – ", " — ", " | ", " · ", " by "];

/// Words that carry identity, once digits are dropped.
///
/// `server15831672` reduces to `server`, which is filler, so a serial number
/// appended to a default name still counts as nothing.
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

/// Drop a trailing hosting credit, if the name ends in one.
///
/// Takes the *rightmost* qualifying separator, so
/// `ISA | Bitterroot 365 | No Bases - By Pingperfect.com` loses only the
/// Pingperfect clause and keeps both pipes in the admin's own name.
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

/// Whether this name carries a hosting company's branding, or was never set.
///
/// Two independent conditions, either of which is enough:
///
/// 1. **A hoster's name appears anywhere in it.** A plain substring test, by
///    deliberate choice. This hides `4Netplayers Purgatorio [ESP]` and
///    `GRAGOLL nitrado.net` — servers whose admins kept the hoster's name as
///    part of their own. An earlier version went to some length to keep those
///    visible ("nothing distinctive survives"), but the ask is to be rid of
///    hoster branding in the list, not merely of unnamed servers.
/// 2. **Nothing distinctive was ever typed** — every word is filler or digits,
///    so `DayZ Standalone Server`, `TEST` and `EXAMPLE NAME` qualify without
///    any hoster involved.
///
/// The one exemption is a *trailing hosting credit*: `Stoned and Afraid PVE -
/// By Pingperfect.com` is a name its admin chose in full, with the company's
/// name appended after a separator. Those are dropped before either condition
/// runs, so the server is judged on the part its admin wrote. Whether the
/// hoster or the admin appended it cannot be known from the string, but a name
/// that still reads perfectly with the credit removed is not branding — and
/// `DayZ Server by HostHavoc.com` is caught anyway, by condition 2, because
/// what remains is filler.
///
/// All of it is behind a setting the player can turn off
/// (`hide_placeholder_servers`), on by default.
///
/// An empty name is deliberately *not* a placeholder: that is a server this
/// launcher has never had a reply from, so the name is missing rather than
/// default. It has its own filter — see `ServerFilter::hide_unnamed`.
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

/// Scripts that are never decoration in an English name — one character settles
/// it, with no ratio involved.
///
/// The ratio test alone is not enough for these. `[TN]#鹿岛/PVE Deerisle
/// QQ群703109220` is three Han characters against fifteen Latin letters (17%)
/// and `BX公益服|PVP仿官|Vanilla+` is 29% — both sail under a 30% cut while being
/// plainly Chinese servers. Padding a name with ASCII mod tags and a QQ group
/// number is exactly what drags the share down, so the share is the wrong
/// question for these scripts.
///
/// Cyrillic and Greek are deliberately *not* here: `Ч` and `Я` do get used
/// decoratively in English names (`Чernarus Survival — English Community`), so
/// one character cannot settle it. They are caught a word at a time instead —
/// see `is_cyrillic_or_greek_word`.
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
/// as readable-in-English.
///
/// Not 50%: a great many non-English servers front their name with a Latin
/// region tag — `[RU] Русский сервер`, `[CN] 生存服务器` — which would drag a
/// wholly Russian or Chinese name back under a half-share and leave it visible.
/// At a third, those are caught while a Latin name carrying one decorative
/// character is not.
const NON_LATIN_SHARE: f32 = 0.30;

/// Whether the name is written in Latin script.
///
/// Script, not language — `[GER] Zockerfreunde` is Latin and so is
/// `Sérvidor Español`. For "would an English speaker want this in their list",
/// see `is_english_name`, which uses this as its first test.
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

// ─── Language, as distinct from script ───────────────────────────────────────
//
// `is_latin_name` answers "can I read the characters". It says yes to
// `[GER][PvE] Zockerfreunde | Trader | Helis`, which is the complaint that
// prompted all of this: the tag says ENGLISH ONLY and a German server is not
// English.
//
// Detection is entirely offline and entirely lexical. Two roads were not taken:
//
// - **A translation or language-detection API.** The classifier runs over every
//   row on every filter change — thousands of calls per keystroke — so it would
//   mean latency, cost, rate limits, and posting the player's server list to a
//   third party from a desktop app.
// - **Trigram language identification** (`whatlang`, `lingua`). Those are
//   trained on sentences. A DayZ name is a handful of tokens made mostly of
//   bracket tags, mod names and English loanwords — `PvE`, `Trader`, `Helis`
//   sit inside German names — and the models are unreliable in both directions
//   on input that short, with a confidence score that cannot be debugged.
//
// So: three explicit signals, cheapest first, each one inspectable and each one
// tunable by editing a list.

/// Bracketed tags that mark an audience without implying a language, or that
/// imply English. A name carrying one of these is not judged by its tags.
///
/// Since `bracket_tags` splits, these match a *part* of a bracket — which is
/// the whole point: `[GER/EN]`, `[RU/EN]` and `[PL/EN]` are bilingual servers
/// advertising an English presence, and roughly 30 of them stay visible only
/// because `en` is reachable here.
///
/// `en` is also a Romance function word, so `[FR] Serveur (En construction)`
/// waives its own French tag. That is tolerated deliberately: measured over a
/// real registry it happens once against ~30 correct waivers, and the one case
/// is caught by its accents anyway.
const ENGLISH_REGION_TAGS: &[&str] = &[
    "eu", "us", "usa", "uk", "gb", "na", "au", "aus", "ca", "nz", "en", "eng", "english", "int",
    "intl", "world", "global", "asia", "sea", "oce",
];

/// Bracketed tags that mark a server as addressing a non-English audience.
///
/// Two-letter codes are included only where they are unambiguous as a bracket
/// tag. `[IT]`, `[IS]`, `[ID]`, `[CO]` and `[AT]` are left out because each
/// reads as an ordinary word or abbreviation and none appears in real data
/// often enough to be worth the false positives.
///
/// `at`, `by` and `sa` were removed once `bracket_tags` began splitting
/// compound tags. Before the split each could only match a whole bracket, which
/// is rare; after it, `(Enter At Own Risk)`, `(Hostet by ACEVontex)` and DayZ's
/// own `[SA]` for *Standalone* all yield those tokens. Measured over a real
/// 6,785-name registry the three matched four names between them, of which two
/// were plainly English — so they cost more than they earn and are gone.
const FOREIGN_REGION_TAGS: &[&str] = &[
    "ger", "de", "deu", "ru", "rus", "ua", "ukr", "kz", "br", "bra", "pt", "por", "fr", "fra",
    "es", "esp", "mx", "ar", "cl", "pe", "ve", "pl", "pol", "cz", "cze", "sk", "svk", "nl", "ned",
    "nld", "tr", "tur", "ro", "rou", "hu", "hun", "gr", "grc", "bg", "rs", "srb", "hr", "si", "lt",
    "lv", "ee", "fi", "se", "swe", "dk", "dnk", "cn", "chn", "jp", "jpn", "kr", "kor", "th", "vn",
    "tw", "hk", "il", "ir",
];

/// Letters that effectively do not occur in English words.
///
/// `Gebirgsjäger` is caught here without any word list. Kept separate from
/// `latin_letter`, which deliberately counts these as Latin — `Sérvidor` is
/// readable, it is just not English, and those are different questions.
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
            // `é` was missing while `è`, `ê` and `ë` were all present — the
            // commonest accented letter in French, Spanish and Portuguese, and
            // the gap let `Québec Vanilla` and `Serv Privé` through.
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

/// Whole words that mark a name as non-English.
///
/// Every entry is matched as a **complete token**, never a substring: `der`
/// inside `Wanderer` must not make an English name German. Words that are also
/// English (`die`, `den`, `war`, `gut`, `hat`, `arm`, `band`, `not`, `sie`)
/// are deliberately absent, whatever they mean in the other language — a false
/// positive hides a server the player wanted, which is the expensive direction.
const FOREIGN_WORDS: &[&str] = &[
    // German
    //
    // `die`, `den`, `war`, `gut`, `hat`, `arm`, `band` and `not` are absent on
    // purpose: each is also an English word, and a false positive hides a
    // server the player wanted.
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
    // Spanish, Portuguese and Latin American
    //
    // `terra` is deliberately absent — `Terra Incognita` and `Terra Nova` are
    // English server names. So are `solo`, `duo` and `trio`: those are DayZ
    // group-size jargon that English servers use constantly, and adding them
    // would have hidden several dozen. `diversion` and `autos` are ordinary
    // English words too.
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
    // French
    //
    // `il` is left out — it is Illinois in American server names. So is `noc`,
    // which is a network operations centre.
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

/// Characters that separate several tags sharing one bracket.
///
/// `[CZ/SK]`, `[EU|FR]`, `[FR-QC]`, `[GER HKD]` and `(GER/PVE)` are all one
/// bracket carrying two or more tags.
const TAG_SEPARATORS: &[char] = &['|', '/', ',', '-', '+', ' ', '\\', '&', ';', ':'];

/// The bracketed tags in a name, lowercased and split into their parts.
///
/// `[GER][PvE]` yields `ger`, `pve`; `[CZ/SK]` yields `cz`, `sk`.
///
/// The split matters more than it looks. Without it a compound bracket is one
/// opaque string — `"cz/sk"` matches nothing in either tag list — and a
/// measurement over a real 6,785-name registry found **65 non-English servers
/// visible under ENGLISH ONLY for this reason alone**, mostly Czech, German,
/// Russian and Brazilian. It was the single largest cause of misses, and no
/// amount of adding words to `FOREIGN_WORDS` would have touched it.
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

/// Whether a token is *mostly* Cyrillic or Greek — that is, a Russian or Greek
/// word rather than a Latin word wearing one exotic character.
///
/// This exists because the `NON_LATIN_SHARE` ratio is measured over the whole
/// name, and a name can pad itself under the threshold while still being
/// plainly Russian: `!*ВДАЛИ от ЖЁН Chernarus*! 1 [PVE] [vk.com/vdzh_pve]` is
/// ten Cyrillic letters against twenty-four Latin — 29% against a 30% cut —
/// because the map name, the mode tag and a VK URL are all Latin.
///
/// Counting *words* instead settles it without touching the decorative case
/// that kept Cyrillic and Greek on the ratio in the first place:
/// `Чernarus Survival — English Community` has no majority-Cyrillic token, and
/// the name above has three.
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

/// Whether the name reads as English.
///
/// Five tests, any one of which disqualifies:
///
/// 1. Not Latin script at all — `生存服务器`, `Русский сервер`.
/// 2. A whole Cyrillic or Greek word, however much Latin padding surrounds it.
/// 3. A bracketed language or country tag — `[GER]`, `[RU]`, `[BR]`, and since
///    tags are split, `[CZ/SK]` and `[EU|FR]` too. Waived if the name also
///    carries an audience tag like `[EU]` or `[US]`, per the rule asked for:
///    hide tagged servers *that do not say EU or US*.
/// 4. A letter English does not use — `Gebirgsjäger`, `Québec`, `Español`.
/// 5. A whole word from `FOREIGN_WORDS` — the only signal that reaches
///    `Zwiebelmett mit Guerkchen` once its umlaut has been spelled out.
///
/// **What this cannot do**, and it is worth stating because it bounds the whole
/// approach: a third of visible names carry no lexical signal in either
/// direction. `Nexora`, `GigaChad`, `Tranquility`, `DoHar2026` are proper nouns
/// and invented compounds that belong to no language, and neither a denylist
/// nor an allowlist can sort them. Measured over a real registry that middle is
/// 1,776 of 5,450 names. They are treated as English, because the filter is
/// opt-out and under-hiding is the cheaper error — hiding a server the player
/// wanted is silent and unrecoverable, while a foreign name they can see is
/// merely untidy.
///
/// `Zockersuchtis` — a single invented German compound with no umlaut and no
/// listed stem — lives in that middle and is a known, accepted miss.
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

    /// A hoster's name woven into the name itself is enough, even when the
    /// admin went on to name the server properly.
    ///
    /// These are real, populated servers, and hiding them is the point rather
    /// than an accident: the filter is "no hoster branding in my list", not "no
    /// unnamed servers". `hide_placeholder_servers` turns it off.
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

    /// A name its admin chose in full, with the hosting company credited after
    /// a separator. All of these are real and populated; the credit is the only
    /// hoster text in them, so the server is judged on the rest.
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

    /// The exemption must not rescue a name that was filler to begin with:
    /// strip the credit from `DayZ Server by HostHavoc.com` and "dayz server"
    /// is what is left, which is still nothing.
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

    /// Only a marked-off clause is a credit. A hoster's name trailing after a
    /// plain space is part of the name, and stays hidden — the whole reason the
    /// separator list exists.
    #[test]
    fn a_bare_trailing_hoster_is_not_a_credit() {
        assert!(is_placeholder_name("GRAGOLL nitrado.net"));
        assert!(is_placeholder_name("SuperLunatics Nitrado Server"));
    }

    /// Digits carry no identity — a serial number appended to a default name
    /// is still a default name.
    #[test]
    fn trailing_digits_do_not_make_a_name() {
        assert!(is_placeholder_name("4Netplayers DayZ Server15831672"));
        assert!(is_placeholder_name("nitrado.net gameserver 2"));
    }

    /// The limit of condition 1: only *known* hosters are branding. An unknown
    /// company's name reads as a distinctive word and keeps the server visible,
    /// so extending the filter means extending `HOST_MARKERS`.
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

    // ─── Language ────────────────────────────────────────────────────────────

    /// The report that prompted the language rule: German servers were showing
    /// under ENGLISH ONLY because German is written in Latin script.
    ///
    /// All five are verbatim from a real registry, and each is caught by a
    /// different signal — bracket tag, umlaut, and word list respectively.
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

    /// A bracketed language or country tag is enough on its own, even when
    /// every other word is English. `[BR] THE KINGZ | FULL PVE` is a
    /// Portuguese-speaking community advertising in English.
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

    /// ...but an audience tag waives the tag test, which is the rule as asked
    /// for: hide language-tagged servers *that do not say EU or US*.
    #[test]
    fn an_audience_tag_waives_the_language_tag() {
        assert!(is_english_name("[EU] Survivor Haven | PVE | Loot+"));
        assert!(is_english_name("[US] Wasteland | 1PP | High Loot"));
        // Waived, but the umlaut still condemns it — the signals are
        // independent, and this one is German whatever its tag says.
        assert!(!is_english_name("[EU] Gebirgsjäger |Cherno|PVP"));
    }

    /// Ordinary English names must survive every signal. These are the ones a
    /// careless word list would eat: `Wanderer` contains "der", `Denmark`
    /// contains "den", `Bandit` contains "band".
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

    /// Whole tokens only. This is the specific failure a substring match would
    /// produce, and it is worth its own test because it is silent — the server
    /// simply stops appearing.
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

    /// Non-Latin script is still the first test, so nothing regressed for the
    /// scripts the filter already handled.
    #[test]
    fn non_latin_names_are_still_not_english() {
        for name in ["生存服务器", "Русский сервер", "[RU] Русский сервер PVE"]
        {
            assert!(!is_english_name(name), "{name:?}");
        }
    }

    /// One Han character settles it, whatever the ratio.
    ///
    /// Both of these were reported slipping through: padded with ASCII mod
    /// tags, a QQ group number and a domain, they come to 17% and 29% non-Latin
    /// against a 30% cut. `is_latin_name` still calls them Latin — that is the
    /// script question and it is answered correctly — but they are not English.
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

    /// Spanish and Portuguese, from real reports. None of these carries a
    /// bracketed language tag the tag rule could have seen.
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

    /// Several tags sharing one bracket. Every one of these was visible under
    /// ENGLISH ONLY because `[CZ/SK]` was matched as the single opaque string
    /// `"cz/sk"`, which is in neither tag list.
    ///
    /// Verbatim from a real registry, where this one parser gap accounted for
    /// 65 visible non-English servers — more than any word-list gap.
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

    /// A server advertising an English audience alongside its own language
    /// stays visible. The waiver has to see `en` as a *split part* of
    /// `[GER/EN]`, not merely as a whole bracket.
    ///
    /// This is load-bearing and worth roughly 30 servers on a real registry.
    /// It is also exactly what the plausible-looking "only split the foreign
    /// side" "fix" would break — `ger` would fire on `[GER/EN]` and hide the
    /// bilingual servers an English speaker most wants to see. Hence the test.
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

    /// Splitting tags made three country codes reachable that never fired
    /// before, and each read as an ordinary English word. All three are out of
    /// `FOREIGN_REGION_TAGS`; these are the names that proved they had to be.
    ///
    /// `[SA]` is the sharpest of them: in DayZ it means *Standalone*.
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

    /// The ratio test measures the whole name, so a Russian name padded with a
    /// Latin map name, a mode tag and a URL can sail under 30% while being
    /// plainly Russian. This one is 10 Cyrillic to 24 Latin — 29%.
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

    /// `é` was absent from `foreign_letter` while `è`, `ê` and `ë` were all
    /// present — the commonest accented letter in French, Spanish and
    /// Portuguese, and every one of these was visible because of it.
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

    /// The words a careless list would have added, and the servers they would
    /// have cost.
    ///
    /// `solo`, `duo` and `trio` are DayZ group-size jargon that English servers
    /// use constantly — adding them as Spanish/Italian words would have hidden
    /// several dozen English servers. `terra` reads as Latin American but
    /// `Terra Incognita` and `Terra Nova` are English names, `il` is Illinois,
    /// `noc` is a network operations centre, and `diversion` is just English.
    /// Each was found by probing the real registry, not by guessing.
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
