use once_cell::sync::Lazy;
use std::sync::{Arc, Mutex};
use tracing::subscriber::set_global_default;
use tracing_log::LogTracer;
use tracing_subscriber::{
    fmt::{self, format::FmtSpan},
    layer::SubscriberExt,
    EnvFilter, Registry,
};

// Global storage for captured logs
static CAPTURED_LOGS: Lazy<Arc<Mutex<Vec<String>>>> =
    Lazy::new(|| Arc::new(Mutex::new(Vec::new())));

// Initialize the tracing subscriber
pub fn init_tracing() {
    // Only initialize once
    static INITIALIZED: Lazy<bool> = Lazy::new(|| {
        // Create a custom layer that captures logs
        let fmt_layer = fmt::Layer::default()
            .with_span_events(FmtSpan::CLOSE)
            .with_writer(move || LogCaptureWriter::new(Arc::clone(&CAPTURED_LOGS)));

        // Set up the subscriber with an environment filter
        let subscriber = Registry::default()
            .with(
                EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| EnvFilter::new("solana=debug")),
            )
            .with(fmt_layer);

        // Set the subscriber as the global default
        set_global_default(subscriber).expect("Failed to set tracing subscriber");

        // Bridge from log to tracing
        LogTracer::init().expect("Failed to initialize log tracer");

        true
    });

    let _ = *INITIALIZED;
}

// Clear captured logs
pub fn clear_logs() {
    let mut logs = CAPTURED_LOGS.lock().unwrap();
    logs.clear();
}

// Get captured logs
pub fn get_logs() -> Vec<String> {
    let logs = CAPTURED_LOGS.lock().unwrap();
    logs.clone()
}

// Get logs containing a specific string
pub fn get_logs_containing(pattern: &str) -> Vec<String> {
    let logs = CAPTURED_LOGS.lock().unwrap();
    logs.iter()
        .filter(|log| log.contains(pattern))
        .cloned()
        .collect()
}

// Check if logs contain a specific string
pub fn logs_contain(pattern: &str) -> bool {
    let logs = CAPTURED_LOGS.lock().unwrap();
    logs.iter().any(|log| log.contains(pattern))
}

// Custom writer that captures logs
struct LogCaptureWriter {
    logs: Arc<Mutex<Vec<String>>>,
}

impl LogCaptureWriter {
    fn new(logs: Arc<Mutex<Vec<String>>>) -> Self {
        Self { logs }
    }
}

impl std::io::Write for LogCaptureWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if let Ok(log) = std::str::from_utf8(buf) {
            let log = log.trim().to_string();
            if !log.is_empty() {
                let mut logs = self.logs.lock().unwrap();
                logs.push(log);
            }
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
