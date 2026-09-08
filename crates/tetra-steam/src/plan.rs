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
    "shardABC123",
    "no3rd",
    "allowedFilePatching",
    "mod",
    "isDLC",
    "privHive",
];

/// How many tag splits deep a pass may go: 2^3 cells per population half, so
/// up to 16 requests for a browser of ~30k servers. Each level re-asks for
/// every server in the branch, so depth is bought with discovery time.
pub const MAX_TAG_DEPTH: usize = 3;

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
    /// Human-readable shard identity for logs and progress events.
    pub label: String,
}

impl Shard {
    /// The two halves every pass starts from. Disjoint and total: a server has
    /// players or it doesn't.
    pub fn population_halves() -> Vec<Shard> {
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
                    label: key.to_string(),
                }
            })
            .collect()
    }

    /// The two complementary halves of this shard, or `None` once no axis is
    /// left. Only worth calling on a shard that hit [`LIST_CAP`].
    pub fn subdivide(&self) -> Option<Vec<Shard>> {
        let depth = self.and_tags.len() + self.nor_tags.len();
        let tag = *TAG_AXES.get(depth)?;
        if depth >= MAX_TAG_DEPTH {
            return None;
        }

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
    fn subdivision_stops_at_max_depth() {
        let mut shard = Shard::population_halves()[1].clone();
        for _ in 0..MAX_TAG_DEPTH {
            shard = shard.subdivide().expect("axis available")[0].clone();
        }
        assert!(
            shard.subdivide().is_none(),
            "depth {MAX_TAG_DEPTH} must be the last split"
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
