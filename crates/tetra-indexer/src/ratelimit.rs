//! Per-client token bucket.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

/// Ceiling on tracked clients, so a spray of distinct source addresses can't
/// grow the map without bound.
const MAX_TRACKED: usize = 8_192;

struct Bucket {
    tokens: f64,
    last: Instant,
}

pub struct RateLimiter {
    capacity: f64,
    per_sec: f64,
    buckets: Mutex<HashMap<String, Bucket>>,
}

impl RateLimiter {
    /// `per_min` requests per client per minute, refilled continuously rather
    /// than in steps, so a client that waits is served immediately.
    pub fn new(per_min: u32) -> Self {
        let capacity = f64::from(per_min.max(1));
        Self {
            capacity,
            per_sec: capacity / 60.0,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn check(&self, client: &str) -> Result<(), u64> {
        self.check_at(client, Instant::now())
    }

    /// `Err(secs)` is how long until one token exists — the `Retry-After`.
    /// `now` is a parameter so the window is testable without sleeping.
    pub fn check_at(&self, client: &str, now: Instant) -> Result<(), u64> {
        let mut buckets = self
            .buckets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if buckets.len() >= MAX_TRACKED && !buckets.contains_key(client) {
            // A full bucket is indistinguishable from a client that has never
            // been seen, so forgetting it costs nothing. If every tracked
            // client is mid-quota there is nothing safe to evict, and a reset
            // beats an unbounded map.
            buckets.retain(|_, b| refill(b, now, self.per_sec, self.capacity) < self.capacity);
            if buckets.len() >= MAX_TRACKED {
                buckets.clear();
            }
        }

        let bucket = buckets.entry(client.to_string()).or_insert(Bucket {
            tokens: self.capacity,
            last: now,
        });
        let tokens = refill(bucket, now, self.per_sec, self.capacity);
        if tokens >= 1.0 {
            bucket.tokens = tokens - 1.0;
            Ok(())
        } else {
            bucket.tokens = tokens;
            Err((((1.0 - tokens) / self.per_sec).ceil() as u64).max(1))
        }
    }
}

fn refill(bucket: &mut Bucket, now: Instant, per_sec: f64, capacity: f64) -> f64 {
    let elapsed = now.saturating_duration_since(bucket.last).as_secs_f64();
    bucket.last = now;
    (bucket.tokens + elapsed * per_sec).min(capacity)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn over_quota_is_refused_and_recovers_as_the_window_slides() {
        let limiter = RateLimiter::new(60);
        let t0 = Instant::now();
        for _ in 0..60 {
            assert!(limiter.check_at("1.2.3.4", t0).is_ok());
        }
        let retry_after = limiter.check_at("1.2.3.4", t0).expect_err("61st refused");
        assert_eq!(retry_after, 1);

        // Still refused a fraction of a token later.
        assert!(limiter
            .check_at("1.2.3.4", t0 + Duration::from_millis(500))
            .is_err());
        // One token's worth of time later it is served again, but only once.
        let t1 = t0 + Duration::from_secs(1);
        assert!(limiter.check_at("1.2.3.4", t1).is_ok());
        assert!(limiter.check_at("1.2.3.4", t1).is_err());
        // A full window restores the whole allowance.
        let t2 = t0 + Duration::from_secs(120);
        for _ in 0..60 {
            assert!(limiter.check_at("1.2.3.4", t2).is_ok());
        }
        assert!(limiter.check_at("1.2.3.4", t2).is_err());
    }

    #[test]
    fn one_greedy_client_does_not_spend_anothers_quota() {
        let limiter = RateLimiter::new(2);
        let t0 = Instant::now();
        assert!(limiter.check_at("1.2.3.4", t0).is_ok());
        assert!(limiter.check_at("1.2.3.4", t0).is_ok());
        assert!(limiter.check_at("1.2.3.4", t0).is_err());
        assert!(limiter.check_at("5.6.7.8", t0).is_ok());
    }
}
