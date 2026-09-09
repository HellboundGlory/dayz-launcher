//! Shard plan for Steam's `GetServerList`.
//!
//! One request returns at most ~10,000 rows however high `limit` is, and DayZ
//! advertises ~273,000 addresses, so the list can only be read by asking for
//! disjoint slices of it. A cell that comes back at the cap is subdivided on
//! the next unused axis; the order of the axes is the measured one, cheapest
//! useful split first.

pub const APP_ID: u32 = 221_100;

/// What to ask for per request. The API ignores anything larger.
pub const REQUEST_LIMIT: usize = 10_000;

/// A response this close to the cap is truncated, not complete — the observed
/// ceiling wobbles between 9,999 and 10,000 rows.
pub const CAP_THRESHOLD: usize = 9_900;

/// Leading characters `name_match` splits on, the last resort axis.
const NAME_PREFIXES: &str = "abcdefghijklmnopqrstuvwxyz0123456789";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Population {
    /// Steam's `empty\1`: at least one player.
    Populated,
    /// Steam's `noplayers\1`: nobody on it. Exact complement of the above.
    Vacant,
}

#[derive(Debug, Clone, Copy)]
pub enum Axis {
    Population,
    /// `gametagsand` / `gametagsnor` on one keyword — exact complements.
    Tag(&'static str),
    /// `map` has no negation, so this axis carves one map out and leaves the
    /// rest to the axes after it.
    Map(&'static str),
    NameMatch,
}

/// Split order, as measured against the live list: population first (it is
/// one exact cut through the middle), then the tags that divide the vacant
/// half most evenly, then the six maps that carry real servers, then the
/// remaining tags, then name prefixes.
pub const AXES: &[Axis] = &[
    Axis::Population,
    Axis::Tag("shard123ABC"),
    Axis::Tag("shardABC123"),
    Axis::Tag("etm2.000000"),
    Axis::Tag("entm18.000000"),
    Axis::Tag("mod"),
    Axis::Tag("lqs0"),
    Axis::Tag("etm12.000000"),
    Axis::Tag("entm1.000000"),
    Axis::Tag("no3rd"),
    Axis::Tag("allowedFilePatching"),
    Axis::Tag("isDLC"),
    Axis::Tag("privHive"),
    Axis::Map("chernarusplus"),
    Axis::Map("enoch"),
    Axis::Map("namalsk"),
    Axis::Map("deerisle"),
    Axis::Map("sakhal"),
    Axis::Map("banov"),
    Axis::Tag("lqs1"),
    Axis::Tag("lqs2"),
    Axis::Tag("lqs3"),
    Axis::Tag("etm6.000000"),
    Axis::Tag("entm12.000000"),
    Axis::Tag("etm24.000000"),
    Axis::Tag("entm24.000000"),
    Axis::Tag("external"),
    Axis::Tag("battleye"),
    Axis::Tag("etm1.000000"),
    Axis::Tag("entm2.000000"),
    Axis::Tag("etm4.000000"),
    Axis::Tag("entm4.000000"),
    Axis::NameMatch,
];

/// One request's worth of the list: the constraints that define it, plus how
/// far down [`AXES`] it has already been cut.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Shard {
    pub population: Option<Population>,
    pub and_tags: Vec<&'static str>,
    pub nor_tags: Vec<&'static str>,
    pub map: Option<&'static str>,
    pub name_prefix: Option<char>,
    /// Index into [`AXES`] of the first axis this cell may still split on.
    pub next_axis: usize,
}

impl Shard {
    /// The backslash-delimited filter string this cell sends to Steam.
    pub fn filter(&self) -> String {
        let mut f = format!("\\appid\\{APP_ID}");
        match self.population {
            Some(Population::Populated) => f.push_str("\\empty\\1"),
            Some(Population::Vacant) => f.push_str("\\noplayers\\1"),
            None => {}
        }
        if !self.and_tags.is_empty() {
            f.push_str("\\gametagsand\\");
            f.push_str(&self.and_tags.join(","));
        }
        if !self.nor_tags.is_empty() {
            f.push_str("\\gametagsnor\\");
            f.push_str(&self.nor_tags.join(","));
        }
        if let Some(map) = self.map {
            f.push_str("\\map\\");
            f.push_str(map);
        }
        if let Some(c) = self.name_prefix {
            f.push_str("\\name_match\\");
            f.push(c);
            f.push('*');
        }
        f
    }

    /// Children covering this cell, cut on the next unused axis. Empty when
    /// every axis is spent — that cell stays truncated and is reported.
    pub fn split(&self) -> Vec<Shard> {
        let Some(axis) = AXES.get(self.next_axis).copied() else {
            return Vec::new();
        };
        match axis {
            Axis::Population => vec![
                self.advanced_with(|c| c.population = Some(Population::Populated)),
                self.advanced_with(|c| c.population = Some(Population::Vacant)),
            ],
            Axis::Tag(tag) => vec![
                self.advanced_with(|c| c.and_tags.push(tag)),
                self.advanced_with(|c| c.nor_tags.push(tag)),
            ],
            Axis::Map(map) => {
                // No `notmap` filter exists, so the residual carries no map
                // constraint. It is known-capped (it is this cell), so it is
                // cut again here rather than costing a repeat request.
                let mut out = vec![self.advanced_with(|c| c.map = Some(map))];
                out.extend(self.advanced_with(|_| {}).split());
                out
            }
            Axis::NameMatch => NAME_PREFIXES
                .chars()
                .map(|c| self.advanced_with(|s| s.name_prefix = Some(c)))
                .collect(),
        }
    }

    fn advanced_with(&self, f: impl FnOnce(&mut Shard)) -> Shard {
        let mut child = self.clone();
        child.next_axis = self.next_axis + 1;
        f(&mut child);
        child
    }
}

/// The full crawl's starting cells: the population axis is always worth
/// spending, so it is applied up front instead of costing an unsplit request.
pub fn roots() -> Vec<Shard> {
    Shard::default().split()
}

/// The hot crawl: every populated server, which fits in one request.
pub fn hot() -> Shard {
    Shard {
        population: Some(Population::Populated),
        next_axis: 1,
        ..Shard::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roots_are_exact_complements() {
        let roots = roots();
        assert_eq!(roots.len(), 2);
        assert_eq!(roots[0].filter(), "\\appid\\221100\\empty\\1");
        assert_eq!(roots[1].filter(), "\\appid\\221100\\noplayers\\1");
    }

    #[test]
    fn a_capped_cell_cuts_on_the_next_unused_axis() {
        let vacant = &roots()[1];
        let kids = vacant.split();
        // The axis after population is the first tag, and its two children
        // are the same cell with the tag required and forbidden.
        assert_eq!(
            kids.iter().map(|k| k.filter()).collect::<Vec<_>>(),
            vec![
                "\\appid\\221100\\noplayers\\1\\gametagsand\\shard123ABC",
                "\\appid\\221100\\noplayers\\1\\gametagsnor\\shard123ABC",
            ]
        );
        assert!(kids.iter().all(|k| k.next_axis == vacant.next_axis + 1));

        // Cutting again spends the next axis, not the one already used.
        let grandkids = kids[0].split();
        assert_eq!(
            grandkids[0].filter(),
            "\\appid\\221100\\noplayers\\1\\gametagsand\\shard123ABC,shardABC123"
        );
        assert_eq!(
            grandkids[1].filter(),
            "\\appid\\221100\\noplayers\\1\\gametagsand\\shard123ABC\\gametagsnor\\shardABC123"
        );
    }

    #[test]
    fn a_map_axis_carves_a_map_out_and_keeps_cutting_the_rest() {
        let cell = Shard {
            population: Some(Population::Vacant),
            next_axis: 13,
            ..Shard::default()
        };
        let kids = cell.split();
        // chernarusplus..banov, then the residual's own next cut.
        assert_eq!(
            kids[0].filter(),
            "\\appid\\221100\\noplayers\\1\\map\\chernarusplus"
        );
        assert_eq!(
            kids[5].filter(),
            "\\appid\\221100\\noplayers\\1\\map\\banov"
        );
        assert_eq!(
            kids[6].filter(),
            "\\appid\\221100\\noplayers\\1\\gametagsand\\lqs1"
        );
        assert_eq!(kids.len(), 8);
    }

    #[test]
    fn the_last_axis_leaves_nothing_to_cut() {
        let leaf = Shard {
            next_axis: AXES.len() - 1,
            ..Shard::default()
        };
        let kids = leaf.split();
        assert_eq!(kids.len(), 36);
        assert_eq!(kids[0].filter(), "\\appid\\221100\\name_match\\a*");
        assert!(kids[0].split().is_empty());
    }
}
