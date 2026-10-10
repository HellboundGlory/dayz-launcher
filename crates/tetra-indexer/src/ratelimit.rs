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
            // client is mid-quota, drop the one idle longest rather than
            // resetting everyone.
            buckets.retain(|_, b| {
                projected_tokens(b, now, self.per_sec, self.capacity) < self.capacity
            });
            if buckets.len() >= MAX_TRACKED {
                let oldest = buckets
                    .iter()
                    .min_by_key(|(_, b)| b.last)
                    .map(|(key, _)| key.clone());
                if let Some(oldest) = oldest {
                    buckets.remove(&oldest);
                }
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
    let tokens = projected_tokens(bucket, now, per_sec, capacity);
    bucket.last = now;
    tokens
}

/// Tokens `bucket` would hold at `now`, without touching it — used by the
/// eviction sweep, which must not spend the refill it is reading.
fn projected_tokens(bucket: &Bucket, now: Instant, per_sec: f64, capacity: f64) -> f64 {
    let elapsed = now.saturating_duration_since(bucket.last).as_secs_f64();
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
    fn a_full_map_evicts_the_idle_bucket_and_keeps_the_rest() {
        let limiter = RateLimiter::new(60);
        let t0 = Instant::now();
        for i in 0..MAX_TRACKED {
            let key = format!("10.{}.{}", i / 256, i % 256);
            assert!(limiter
                .check_at(&key, t0 + Duration::from_micros(i as u64))
                .is_ok());
        }
        let victim = "10.0.0";
        let survivor = format!("10.{}.{}", (MAX_TRACKED - 1) / 256, (MAX_TRACKED - 1) % 256);

        // A brand-new client at an instant where nothing has refilled: the one
        // client that has been idle longest makes room for it.
        assert!(limiter
            .check_at("203.0.113.9", t0 + Duration::from_millis(10))
            .is_ok());

        let buckets = limiter
            .buckets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(buckets.len(), MAX_TRACKED);
        assert!(buckets.get(victim).is_none(), "idle bucket made room");
        // The tracked clients kept their spent quota instead of being reset.
        let kept = buckets.get(&survivor).expect("tracked client kept");
        assert!(kept.tokens < limiter.capacity);
    }

    #[test]
    fn a_sweep_keeps_the_tokens_a_waited_bucket_earned() {
        let limiter = RateLimiter::new(60);
        let t0 = Instant::now();

        let patient = "203.0.113.7";
        for _ in 0..60 {
            assert!(limiter.check_at(patient, t0).is_ok());
        }
        assert!(limiter.check_at(patient, t0).is_err());

        // Fill the map so the next unseen key runs the eviction sweep.
        for i in 0..MAX_TRACKED - 1 {
            assert!(limiter
                .check_at(&format!("10.{}.{}", i / 256, i % 256), t0)
                .is_ok());
        }

        let t1 = t0 + Duration::from_secs(5);
        assert!(limiter.check_at("198.51.100.4", t1).is_ok());

        // Five seconds of refill are banked; the sweep must not discard them.
        assert!(limiter.check_at(patient, t1).is_ok());
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
