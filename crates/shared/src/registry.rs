use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub name: String,
    pub pid: u32,
    pub started: u64,
    pub last_seen: u64,
    pub alive: bool,
}

fn registry_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("registry")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn write_entry(data_dir: &Path, name: &str, started: u64) -> AppResult<()> {
    let dir = registry_dir(data_dir);
    std::fs::create_dir_all(&dir)?;
    let entry = ServiceInfo {
        name: name.to_string(),
        pid: std::process::id(),
        started,
        last_seen: now_secs(),
        alive: true,
    };
    let path = dir.join(format!("{name}.json"));
    let tmp = dir.join(format!(".{name}.tmp"));
    std::fs::write(&tmp, serde_json::to_vec(&entry)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

pub fn register_service(data_dir: &Path, name: &str) -> AppResult<()> {
    write_entry(data_dir, name, now_secs())
}

pub fn spawn_heartbeat(data_dir: PathBuf, name: &'static str) {
    let started = now_secs();
    let _ = write_entry(&data_dir, name, started);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        loop {
            interval.tick().await;
            if let Err(error) = write_entry(&data_dir, name, started) {
                tracing::warn!(service = name, error = %error, "registry heartbeat failed");
            }
        }
    });
}

pub fn read_services(data_dir: &Path) -> Vec<ServiceInfo> {
    let dir = registry_dir(data_dir);
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(mut info) = serde_json::from_slice::<ServiceInfo>(&bytes) else {
            continue;
        };
        let fresh = now_secs().saturating_sub(info.last_seen) <= 90;
        let proc_alive = Path::new(&format!("/proc/{}", info.pid)).exists();
        let in_container = Path::new("/.dockerenv").exists();
        // In Docker each service has its own PID namespace, so /proc/<pid> from
        // another container is not visible. Fresh heartbeat is authoritative there.
        info.alive = fresh && (in_container || proc_alive);
        out.push(info);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}
