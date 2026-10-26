//! Process entry point: read config once, start JSON logs, serve the router.

use nimbytes_server::{composition, http};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = composition::Config::from_env()?;
    composition::init_logging();
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    tracing::info!(addr = %config.bind_addr, "listening");
    axum::serve(listener, http::router())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// Resolves on Ctrl-C or SIGTERM (`docker compose down`), so in-flight requests finish.
async fn shutdown_signal() {
    tokio::select! {
        () = ctrl_c() => {},
        () = terminate() => {},
    }
    tracing::info!("shutting down");
}

/// Resolves on Ctrl-C; logs and stays pending if the handler cannot be installed.
async fn ctrl_c() {
    if let Err(err) = tokio::signal::ctrl_c().await {
        tracing::error!(%err, "ctrl-c handler failed");
        std::future::pending::<()>().await;
    }
}

/// Resolves on SIGTERM; logs and stays pending if the handler cannot be installed.
async fn terminate() {
    use tokio::signal::unix::{SignalKind, signal};
    match signal(SignalKind::terminate()) {
        Ok(mut sig) => {
            sig.recv().await;
        }
        Err(err) => {
            tracing::error!(%err, "SIGTERM handler failed");
            std::future::pending::<()>().await;
        }
    }
}
