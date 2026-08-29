use crate::config::ProbeConfig;
use crate::error::NetError;
use crate::query::EXCHANGE_TIMEOUT_MULTIPLIER;
use std::net::SocketAddr;

/// Run `op` until it succeeds or the attempt budget is spent.
///
/// Only transport failures are retried. A parse failure means the server
/// answered with something we cannot read, and it will answer with the same
/// thing next time — retrying would spend the budget and delay the error
/// without ever changing it.
///
/// The whole chain — every attempt and every backoff sleep between them — is
/// bounded by a hard deadline, independent of `op` itself. `query::request`
/// already bounds each individual attempt (`timeout * EXCHANGE_TIMEOUT_MULTIPLIER`),
/// so under today's defaults this ceiling is redundant; it exists as the
/// backstop that keeps one address's probe bounded even if a future change
/// raises `attempts` without anyone re-deriving what that does to the worst
/// case, and it is computed from `attempts` rather than a second hand-picked
/// constant so the two can never quietly disagree.
pub async fn with_retries<F, Fut, T>(
    addr: SocketAddr,
    config: &ProbeConfig,
    mut op: F,
) -> Result<T, NetError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, NetError>>,
{
    let attempts = config.attempts.max(1);
    let deadline = config
        .timeout
        .saturating_mul(EXCHANGE_TIMEOUT_MULTIPLIER)
        .saturating_mul(attempts)
        + config.backoff.saturating_mul(attempts);

    let chain = async {
        let mut backoff = config.backoff;

        for attempt in 1..=attempts {
            match op().await {
                Ok(v) => return Ok(v),
                Err(NetError::Core(e)) => return Err(NetError::Core(e)),
                Err(NetError::NoResponse { .. })
                | Err(NetError::ExchangeTimedOut { .. })
                | Err(NetError::Io(_)) => {
                    if attempt < attempts {
                        tokio::time::sleep(backoff).await;
                        backoff = backoff.saturating_mul(2);
                    }
                }
            }
        }

        Err(NetError::NoResponse { addr, attempts })
    };

    tokio::time::timeout(deadline, chain)
        .await
        .unwrap_or(Err(NetError::NoResponse { addr, attempts }))
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

    /// The backstop this ceiling exists to be: even an `op` that hangs
    /// indefinitely (a peer holding a connection open in a way
    /// `query::request`'s own deadline somehow didn't catch, or simply a
    /// future that never resolves) must not make one address's probe run
    /// forever. Without this wrapper, a single pathological attempt would
    /// block every remaining attempt behind it and the caller's `.await`
    /// with it.
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

    /// The deadline scales with `attempts` rather than being a fixed number,
    /// so raising the attempt count (a config change, not a code change)
    /// cannot silently start truncating legitimate retries before they get
    /// to run.
    #[tokio::test]
    async fn more_attempts_are_given_more_time_before_the_ceiling_trips() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let calls = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&calls);

        let result: Result<(), NetError> = with_retries(addr(), &config(3), move || {
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
            3,
            "all 3 configured attempts should run — the deadline must not cut the chain short"
        );
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
