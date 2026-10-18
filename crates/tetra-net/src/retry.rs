use crate::config::ProbeConfig;
use crate::error::NetError;
use crate::query::EXCHANGE_TIMEOUT_MULTIPLIER;
use std::future::Future;
use std::net::SocketAddr;
use std::time::Duration;

/// What a failed attempt means for the rest of the chain.
#[derive(Debug, PartialEq)]
pub enum Verdict {
    /// Try again after this delay. `None` waits the current backoff; a delay
    /// given by the failure never waits less than the backoff.
    Retry(Option<Duration>),
    Fatal,
}

/// Run `op` until it succeeds, the `attempts` budget is spent or `classify`
/// calls a failure fatal. Waits `base` before the second attempt, doubling
/// after each wait.
pub async fn retry_backoff<T, E, F, Fut, C>(
    attempts: u32,
    base: Duration,
    mut op: F,
    classify: C,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    C: Fn(&E) -> Verdict,
{
    let mut backoff = base;
    let mut attempt = 1;
    loop {
        let err = match op().await {
            Ok(value) => return Ok(value),
            Err(err) => err,
        };
        let delay = match classify(&err) {
            Verdict::Fatal => return Err(err),
            Verdict::Retry(delay) => delay.map_or(backoff, |d| d.max(backoff)),
        };
        if attempt >= attempts {
            return Err(err);
        }
        tokio::time::sleep(delay).await;
        backoff = backoff.saturating_mul(2);
        attempt += 1;
    }
}

/// Run `op` until it succeeds or the attempt budget is spent. Only transport
/// failures are retried — a parse failure means the server answered with
/// something unreadable, and it'll answer the same way again.
pub async fn with_retries<F, Fut, T>(
    addr: SocketAddr,
    config: &ProbeConfig,
    op: F,
) -> Result<T, NetError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, NetError>>,
{
    let attempts = config.attempts.max(1);
    // The loop sleeps backoff, 2*backoff, ... before every attempt but the
    // last, so the chain's total sleep is backoff * (2^(attempts-1) - 1).
    let sleeps = 1u32
        .checked_shl(attempts - 1)
        .map(|v| v - 1)
        .unwrap_or(u32::MAX);
    let deadline = config
        .timeout
        .saturating_mul(EXCHANGE_TIMEOUT_MULTIPLIER)
        .saturating_mul(attempts)
        .saturating_add(config.backoff.saturating_mul(sleeps));

    let chain = retry_backoff(attempts, config.backoff, op, |err| match err {
        NetError::Core(_) => Verdict::Fatal,
        _ => Verdict::Retry(None),
    });

    match tokio::time::timeout(deadline, chain).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(err @ NetError::Core(_))) => Err(err),
        Ok(Err(_)) | Err(_) => Err(NetError::NoResponse { addr, attempts }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn config(attempts: u32) -> ProbeConfig {
        ProbeConfig {
            timeout: Duration::from_millis(20),
            attempts,
            backoff: Duration::from_millis(1),
            max_in_flight: 4,
        }
    }

    fn addr() -> SocketAddr {
        "127.0.0.1:1".parse().unwrap()
    }

    /// An `op` that hangs forever must not make the whole chain hang forever.
    #[tokio::test]
    async fn the_whole_chain_is_bounded_even_if_one_attempt_never_returns() {
        let started = std::time::Instant::now();
        let result: Result<(), NetError> = with_retries(addr(), &config(3), || async {
            tokio::time::sleep(Duration::from_secs(600)).await;
            Ok(())
        })
        .await;
        let elapsed = started.elapsed();

        assert!(result.is_err(), "a hung attempt must not read as success");
        assert!(
            elapsed < Duration::from_secs(5),
            "with_retries did not respect its own deadline: took {elapsed:?}"
        );
    }

    /// Deadline scales with `attempts` and budgets the backoff the loop
    /// actually sleeps, so raising either can't truncate legitimate retries.
    #[tokio::test]
    async fn every_configured_attempt_runs_before_the_deadline_trips() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let cases = [
            (config(3), 3),
            (
                ProbeConfig {
                    timeout: Duration::from_millis(1),
                    attempts: 4,
                    // The backoff outgrows the per-attempt timeout, so the
                    // deadline has to cover the sleeps as well.
                    backoff: Duration::from_millis(30),
                    max_in_flight: 4,
                },
                4,
            ),
        ];

        for (config, expected_calls) in cases {
            let calls = Arc::new(AtomicUsize::new(0));
            let counted = Arc::clone(&calls);

            let result: Result<(), NetError> = with_retries(addr(), &config, move || {
                let counted = Arc::clone(&counted);
                async move {
                    counted.fetch_add(1, Ordering::SeqCst);
                    Err(NetError::NoResponse {
                        addr: addr(),
                        attempts: 1,
                    })
                }
            })
            .await;

            assert!(result.is_err());
            assert_eq!(
                calls.load(Ordering::SeqCst),
                expected_calls,
                "every attempt should run: {config:?}"
            );
        }
    }

    /// A parse failure (`NetError::Core`) is never retried — the server
    /// answered with something unreadable, and it will answer with the same
    /// thing again. This must return immediately, not wait for the deadline.
    #[tokio::test]
    async fn a_core_error_is_not_retried() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let calls = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&calls);

        let started = std::time::Instant::now();
        let result: Result<(), NetError> = with_retries(addr(), &config(5), move || {
            let counted = Arc::clone(&counted);
            async move {
                counted.fetch_add(1, Ordering::SeqCst);
                Err(NetError::Core(tetra_core::CoreError::Parse(
                    tetra_core::ParseError::BadHeader(0),
                )))
            }
        })
        .await;

        assert!(matches!(result, Err(NetError::Core(_))));
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "a parse failure must not be retried"
        );
        assert!(started.elapsed() < Duration::from_millis(500));
    }
}
