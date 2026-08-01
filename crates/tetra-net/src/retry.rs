use crate::config::ProbeConfig;
use crate::error::NetError;
use std::net::SocketAddr;

/// Run `op` until it succeeds or the attempt budget is spent.
///
/// Only transport failures are retried. A parse failure means the server
/// answered with something we cannot read, and it will answer with the same
/// thing next time — retrying would spend the budget and delay the error
/// without ever changing it.
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
    let mut backoff = config.backoff;

    for attempt in 1..=attempts {
        match op().await {
            Ok(v) => return Ok(v),
            Err(NetError::Core(e)) => return Err(NetError::Core(e)),
            Err(NetError::NoResponse { .. }) | Err(NetError::Io(_)) => {
                if attempt < attempts {
                    tokio::time::sleep(backoff).await;
                    backoff = backoff.saturating_mul(2);
                }
            }
        }
    }

    Err(NetError::NoResponse { addr, attempts })
}
