//! Which master-list requests one discovery pass is made of.
//!
//! Steam answers a single `RequestInternetServerList` with at most
//! [`LIST_CAP`] rows and silently drops the rest, so asking once — the launcher
//! used to ask once, with `empty=1` — can only ever see a slice of the DayZ
//! browser. A pass therefore asks for disjoint slices and subdivides any slice
//! that comes back at the cap.
//!
//! Both split axes are exact complements, so the union of a shard's children
//! is the shard itself:
//! - population: `empty=1` (has players) against `noplayers=1` (has none);
//! - tags: `gametagsand=T` (declares `T`) against `gametagsnor=T` (doesn't).
//!
//! Steam paces each request by pinging the servers it lists (~80 rows/s) but
//! paces concurrent requests independently, so the plan is *pre-expanded*: it
//! starts at the cells a pass would otherwise discover one truncation at a
//! time, and every cell is asked at once. Interior requests are pure waste,
//! since their rows are re-listed by their children, so pre-expansion skips
//! them entirely.

use crate::source::Filters;

/// Rows Steam will return for one list request before it truncates. Measured
/// against the live DayZ master (every over-full request answers with exactly
/// 10,000 rows); Valve documents no figure.
pub const LIST_CAP: usize = 10_000;

/// A2S keyword tokens to split an over-full shard on, in the order they're
/// used. Chosen from the tokens DayZ servers actually publish, most evenly
/// split first — an axis that lands 99/1 wastes a request. Nothing breaks if a
/// token stops being published: the two children stay complementary, one just
/// ends up empty and the other inherits the parent's rows.
const TAG_AXES: &[&str] = &[
    // The two shard tokens are near-complements of each other (a server
    // publishes one or the other), which makes them the two most balanced
    // cuts available: 65/35 and 34/66 of the live browser.
    "shard123ABC",
    "shardABC123",
    // Day/night-length tokens. Published verbatim, so they filter exactly:
    // measured 40% and 28% of the browser respectively.
    "etm2.000000",
    "entm18.000000",
    "mod",
    "lqs0",
    "etm12.000000",
    "entm1.000000",
    "no3rd",
    "allowedFilePatching",
    "isDLC",
    "privHive",
];

/// How many tag splits deep a pass may go before it switches to the map axis.
pub const MAX_TAG_DEPTH: usize = 8;

/// Tag splits each population half starts from, before anything is known to be
/// truncated. Asymmetric: every measured truncation is in the quiet half, and
/// Steam only serves ~100 list requests a session, so depth goes where the
/// servers are. See .ai-notes/crates/tetra-steam/src/plan.rs.md.
const PRESPLIT_POPULATED: usize = 3;
const PRESPLIT_QUIET: usize = 6;

/// Maps to split a still-truncated cell by, in descending share of the live
/// browser. `map` is the one non-tag filter DayZ servers answer honestly
/// (`region` is 255 for practically all of them, and `secure`/`password` are
/// ignored outright), so it is what's left once the tag axes are spent.
///
/// Unlike the tag axes these are not complementary: a server on none of these
/// maps is only covered by the truncated parent's own sample.
const MAP_AXES: &[&str] = &[
    "chernarusplus",
    "enoch",
    "namalsk",
    "deerisle",
    "sakhal",
    "banov",
];

/// One master-list request, and what it may be split into if it comes back at
/// [`LIST_CAP`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shard {
    /// Steam filter keys for this request.
    pub filters: Filters,
    /// Tags this shard requires and forbids — the path taken through
    /// [`TAG_AXES`], which is also how many axes are left.
    and_tags: Vec<&'static str>,
    nor_tags: Vec<&'static str>,
    /// Whether this shard is already pinned to one map, i.e. the map axis is
    /// spent as well.
    mapped: bool,
    /// Human-readable shard identity for logs and progress events.
    pub label: String,
}

impl Shard {
    /// Every request a pass starts with: the population halves, pre-expanded
    /// [`PRESPLIT_POPULATED`] and [`PRESPLIT_QUIET`] tag splits deep
    /// respectively. Disjoint and total, so no row is
    /// listed twice and nothing is missed.
    pub fn plan() -> Vec<Shard> {
        // Index order is the one `population_halves` documents and its test
        // pins: populated first, then quiet.
        let depths = [PRESPLIT_POPULATED, PRESPLIT_QUIET];
        Self::population_halves()
            .into_iter()
            .zip(depths)
            .flat_map(|(half, depth)| Self::pre_expand(half, depth))
            .collect()
    }

    /// One half, split `depth` tag axes deep, without asking Steam anything.
    fn pre_expand(half: Shard, depth: usize) -> Vec<Shard> {
        let mut cells = vec![half];
        for _ in 0..depth {
            cells = cells
                .iter()
                .flat_map(|cell| cell.subdivide().unwrap_or_else(|| vec![cell.clone()]))
                .collect();
        }
        cells
    }

    /// The two halves every pass starts from. Disjoint and total: a server has
    /// players or it doesn't.
    fn population_halves() -> Vec<Shard> {
        // Populated first: it's the smaller half and the one a player is most
        // likely looking at, so the table fills with joinable servers while
        // the empty half is still streaming.
        ["empty", "noplayers"]
            .into_iter()
            .map(|key| {
                let mut filters = Filters::new();
                filters.insert(key.into(), "1".into());
                Shard {
                    filters,
                    and_tags: Vec::new(),
                    nor_tags: Vec::new(),
                    mapped: false,
                    label: key.to_string(),
                }
            })
            .collect()
    }

    /// The pieces this shard splits into, or `None` once no axis is left.
    /// Only worth calling on a shard that hit [`LIST_CAP`].
    ///
    /// Tag axes come first and are exact complements; once they're spent the
    /// map axis takes over, which is a partition of the maps DayZ actually
    /// runs rather than of the whole shard.
    pub fn subdivide(&self) -> Option<Vec<Shard>> {
        let depth = self.and_tags.len() + self.nor_tags.len();
        // Tags first, then one map split, then whatever tag axes are left:
        // pinning a map is what brings the big vanilla-map cells under the
        // cap, but on its own it isn't enough for Chernarus.
        if depth >= MAX_TAG_DEPTH.min(TAG_AXES.len()) {
            return self.split_by_map().or_else(|| self.split_by_tag(depth));
        }
        self.split_by_tag(depth)
    }

    /// The two complementary halves either side of the next tag axis.
    fn split_by_tag(&self, depth: usize) -> Option<Vec<Shard>> {
        let tag = *TAG_AXES.get(depth)?;

        let child = |and_tags: Vec<&'static str>, nor_tags: Vec<&'static str>| {
            let mut filters = self.filters.clone();
            if !and_tags.is_empty() {
                filters.insert("gametagsand".into(), and_tags.join(","));
            }
            if !nor_tags.is_empty() {
                filters.insert("gametagsnor".into(), nor_tags.join(","));
            }
            let label = format!(
                "{}+{}{tag}",
                self.label,
                if and_tags.len() > self.and_tags.len() {
                    ""
                } else {
                    "!"
                }
            );
            Shard {
                filters,
                and_tags,
                nor_tags,
                mapped: self.mapped,
                label,
            }
        };

        let mut with = self.and_tags.clone();
        with.push(tag);
        let mut without = self.nor_tags.clone();
        without.push(tag);

        Some(vec![
            child(with, self.nor_tags.clone()),
            child(self.and_tags.clone(), without),
        ])
    }

    /// One child per [`MAP_AXES`] entry, or `None` if this shard is already
    /// pinned to a map.
    fn split_by_map(&self) -> Option<Vec<Shard>> {
        if self.mapped {
            return None;
        }
        Some(
            MAP_AXES
                .iter()
                .map(|map| {
                    let mut filters = self.filters.clone();
                    filters.insert("map".into(), (*map).into());
                    Shard {
                        filters,
                        and_tags: self.and_tags.clone(),
                        nor_tags: self.nor_tags.clone(),
                        mapped: true,
                        label: format!("{}+map={map}", self.label),
                    }
                })
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filters_of(shard: &Shard) -> Vec<(String, String)> {
        shard
            .filters
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    #[test]
    fn population_halves_are_disjoint_and_cover_the_browser() {
        let halves = Shard::population_halves();
        assert_eq!(halves.len(), 2);
        // Populated half first: it streams while the (much larger) empty half
        // is still being pulled.
        assert_eq!(
            filters_of(&halves[0]),
            vec![("empty".to_string(), "1".to_string())]
        );
        assert_eq!(
            filters_of(&halves[1]),
            vec![("noplayers".to_string(), "1".to_string())]
        );
    }

    #[test]
    fn subdivision_splits_on_tag_presence() {
        let empty_half = &Shard::population_halves()[1];
        let children = empty_half.subdivide().expect("first axis");

        assert_eq!(children.len(), 2);
        // Both keep the parent's predicate, and one requires the tag while the
        // other forbids it — no server can land in both, none in neither.
        for child in &children {
            assert_eq!(
                child.filters.get("noplayers").map(String::as_str),
                Some("1")
            );
        }
        assert_eq!(
            children[0].filters.get("gametagsand").map(String::as_str),
            Some(TAG_AXES[0])
        );
        assert!(!children[0].filters.contains_key("gametagsnor"));
        assert_eq!(
            children[1].filters.get("gametagsnor").map(String::as_str),
            Some(TAG_AXES[0])
        );
        assert!(!children[1].filters.contains_key("gametagsand"));
    }

    #[test]
    fn nested_subdivision_accumulates_both_tag_lists() {
        let root = &Shard::population_halves()[1];
        let level1 = root.subdivide().expect("level 1");
        // Take the "requires tag 0" branch and split it again.
        let level2 = level1[0].subdivide().expect("level 2");

        assert_eq!(
            level2[0].filters.get("gametagsand").map(String::as_str),
            Some(format!("{},{}", TAG_AXES[0], TAG_AXES[1]).as_str())
        );
        assert_eq!(
            level2[1].filters.get("gametagsand").map(String::as_str),
            Some(TAG_AXES[0])
        );
        assert_eq!(
            level2[1].filters.get("gametagsnor").map(String::as_str),
            Some(TAG_AXES[1])
        );
    }

    #[test]
    fn subdivision_falls_back_to_map_then_to_the_last_tags() {
        let mut shard = Shard::population_halves()[1].clone();
        for _ in 0..MAX_TAG_DEPTH {
            shard = shard.subdivide().expect("axis available")[0].clone();
        }
        // The tag budget is spent, so the next split is by map, once.
        let mapped = shard.subdivide().expect("map axis");
        assert_eq!(mapped.len(), MAP_AXES.len());
        assert_eq!(
            mapped[0].filters.get("map").map(String::as_str),
            Some(MAP_AXES[0])
        );
        // The parent's predicate is kept, so the cell only narrows.
        assert_eq!(
            mapped[0].filters.get("noplayers").map(String::as_str),
            Some("1")
        );

        // A mapped cell that still caps keeps going on the leftover tag axes,
        // which is what the deep vanilla-map cells need.
        let mut deep = mapped[0].clone();
        for _ in MAX_TAG_DEPTH..TAG_AXES.len() {
            let children = deep.subdivide().expect("leftover tag axis");
            assert_eq!(children.len(), 2);
            assert_eq!(
                children[0].filters.get("map").map(String::as_str),
                Some(MAP_AXES[0])
            );
            deep = children[0].clone();
        }
        assert!(deep.subdivide().is_none(), "every axis is spent");
    }

    #[test]
    fn the_plan_is_pre_expanded_to_distinct_cells() {
        let cells = Shard::plan();
        assert_eq!(
            cells.len(),
            2usize.pow(PRESPLIT_POPULATED as u32) + 2usize.pow(PRESPLIT_QUIET as u32)
        );

        // Every cell is a distinct filter set: a duplicate would be a whole
        // request's worth of rows pulled twice.
        let mut seen: Vec<Vec<(String, String)>> = cells
            .iter()
            .map(|c| {
                let mut f = filters_of(c);
                f.sort();
                f
            })
            .collect();
        seen.sort();
        let count = seen.len();
        seen.dedup();
        assert_eq!(seen.len(), count, "plan repeats a request");

        // And every cell still carries a population predicate plus the full
        // tag path, so the union is the whole browser.
        for cell in &cells {
            // The half a cell came from decides how deep it was pre-expanded:
            // the quiet half is where every measured truncation was.
            let depth = if cell.filters.contains_key("empty") {
                PRESPLIT_POPULATED
            } else if cell.filters.contains_key("noplayers") {
                PRESPLIT_QUIET
            } else {
                panic!("{} lost its population half", cell.label);
            };
            assert_eq!(cell.and_tags.len() + cell.nor_tags.len(), depth);
        }

        // The plan has to leave the pass room to subdivide what still caps.
        assert!(
            cells.len() < crate::LIST_REQUEST_BUDGET,
            "plan alone would spend the request quota"
        );
    }

    #[test]
    fn labels_identify_the_branch() {
        let root = &Shard::population_halves()[1];
        let level1 = root.subdivide().expect("level 1");
        assert_eq!(level1[0].label, format!("noplayers+{}", TAG_AXES[0]));
        assert_eq!(level1[1].label, format!("noplayers+!{}", TAG_AXES[0]));
    }
}
