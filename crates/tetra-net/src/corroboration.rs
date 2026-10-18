/// Below this many probes a miss is written as offline unconditionally: too
/// few data points to tell "down" from "our uplink hiccuped" by ratio.
const MIN_BATCH_FOR_OFFLINE_CORROBORATION: usize = 8;

/// Share of a batch that must fail before a miss is read as our own network
/// rather than the server being down.
const OFFLINE_CORROBORATION_THRESHOLD: f64 = 0.4;

/// Whether a batch of probes failed widely enough that its misses point at our
/// own network, so none of them should be written as offline.
pub fn offline_marks_suppressed(answered: usize, failed: usize) -> bool {
    let total = answered + failed;
    total >= MIN_BATCH_FOR_OFFLINE_CORROBORATION
        && (failed as f64 / total as f64) > OFFLINE_CORROBORATION_THRESHOLD
}

#[cfg(test)]
mod tests {
    use super::offline_marks_suppressed;

    #[test]
    fn offline_marks_need_eight_probes_and_a_failure_share_above_the_threshold() {
        // Fewer than eight probes: the misses are trusted and marked offline.
        assert!(!offline_marks_suppressed(0, 7));
        // Eight probes, most failed: suppressed.
        assert!(offline_marks_suppressed(3, 5));
        // Exactly 0.4 failed is not above the threshold.
        assert!(!offline_marks_suppressed(6, 4));
        // Just above 0.4 is.
        assert!(offline_marks_suppressed(599, 401));
        // Only failures still suppress once the batch is big enough.
        assert!(offline_marks_suppressed(0, 8));
    }
}
