/// Everything derivable from the A2S keywords string.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Keywords {
    pub in_game_time: Option<String>,
    /// A shard token with no `privHive`/`external` marker indicates a
    /// Bohemia official server.
    pub official: bool,
    pub first_person_only: bool,
    pub modded: bool,
    pub battleye: bool,
    pub shard: Option<String>,
    /// `etm` — daytime acceleration multiplier.
    pub day_multiplier: Option<f32>,
    /// `entm` — nighttime acceleration multiplier.
    pub night_multiplier: Option<f32>,
}

fn is_clock(token: &str) -> bool {
    let Some((h, m)) = token.split_once(':') else {
        return false;
    };
    if h.is_empty() || m.len() != 2 {
        return false;
    };
    let (Ok(h), Ok(m)) = (h.parse::<u32>(), m.parse::<u32>()) else {
        return false;
    };
    h < 24 && m < 60
}

pub fn parse_keywords(raw: &str) -> Keywords {
    let mut k = Keywords::default();
    let mut private_hive = false;

    for token in raw.split(',').map(str::trim).filter(|t| !t.is_empty()) {
        match token {
            "battleye" => k.battleye = true,
            "no3rd" => k.first_person_only = true,
            "mod" => k.modded = true,
            "privHive" | "external" => private_hive = true,
            _ => {
                if let Some(rest) = token.strip_prefix("shard") {
                    k.shard = Some(rest.to_string());
                } else if let Some(rest) = token.strip_prefix("entm") {
                    k.night_multiplier = rest.parse().ok();
                } else if let Some(rest) = token.strip_prefix("etm") {
                    k.day_multiplier = rest.parse().ok();
                } else if is_clock(token) {
                    k.in_game_time = Some(token.to_string());
                }
            }
        }
    }

    k.official = k.shard.is_some() && !private_hive;
    k
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_a_modded_community_server() {
        let k = parse_keywords(
            "battleye,no3rd,external,privHive,shardABC123,lqs0,etm4.000000,entm6.000000,mod,15:39",
        );
        assert_eq!(k.in_game_time.as_deref(), Some("15:39"));
        assert!(!k.official);
        assert!(k.first_person_only);
        assert!(k.modded);
        assert!(k.battleye);
        assert_eq!(k.shard.as_deref(), Some("ABC123"));
        assert_eq!(k.day_multiplier, Some(4.0));
        assert_eq!(k.night_multiplier, Some(6.0));
    }

    #[test]
    fn classifies_an_official_server() {
        let k = parse_keywords("battleye,no3rd,shard001,lqs0,etm4.200000,entm4.000000,13:23");
        assert_eq!(k.in_game_time.as_deref(), Some("13:23"));
        assert!(k.official);
        assert!(!k.modded);
        assert_eq!(k.shard.as_deref(), Some("001"));
        assert_eq!(k.day_multiplier, Some(4.2));
    }

    #[test]
    fn third_person_server_is_not_first_person_only() {
        let k = parse_keywords("battleye,external,privHive,shardABC123,lqs0,12:00");
        assert!(!k.first_person_only);
        assert!(!k.official);
    }

    #[test]
    fn tolerates_missing_and_empty_fields() {
        let k = parse_keywords("");
        assert_eq!(k.in_game_time, None);
        assert!(!k.official && !k.modded && !k.battleye);

        let k = parse_keywords("battleye");
        assert!(k.battleye);
        assert_eq!(k.in_game_time, None);
    }

    #[test]
    fn only_a_real_clock_is_read_as_time() {
        assert_eq!(parse_keywords("battleye,9:99").in_game_time, None);
        assert_eq!(parse_keywords("battleye,25:00").in_game_time, None);
        assert_eq!(
            parse_keywords("battleye,00:00").in_game_time.as_deref(),
            Some("00:00")
        );
        assert_eq!(
            parse_keywords("battleye,23:59").in_game_time.as_deref(),
            Some("23:59")
        );
    }
}