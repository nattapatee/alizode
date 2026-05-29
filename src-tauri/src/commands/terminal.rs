use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

pub struct TerminalSession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub type TerminalStore = Arc<Mutex<HashMap<String, TerminalSession>>>;

pub fn new_store() -> TerminalStore {
    Arc::new(Mutex::new(HashMap::new()))
}

fn resolve_cwd(cwd: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    if cwd.is_empty() || cwd == "~" {
        home
    } else if cwd.starts_with("~/") {
        format!("{}{}", home, &cwd[1..])
    } else {
        cwd.to_string()
    }
}

fn login_env(shell: &str) -> Vec<(String, String)> {
    let output = std::process::Command::new(shell)
        .args(["-l", "-c", "/usr/bin/env -0"])
        .output();
    let Ok(out) = output else { return vec![] };
    if !out.status.success() {
        return vec![];
    }
    String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter_map(|entry| {
            let (k, v) = entry.split_once('=')?;
            Some((k.to_string(), v.to_string()))
        })
        .collect()
}

#[tauri::command]
pub async fn terminal_spawn(
    app: AppHandle,
    store: tauri::State<'_, TerminalStore>,
    id: String,
    cwd: String,
) -> Result<(), String> {
    {
        let map = store.lock().await;
        if map.contains_key(&id) {
            return Ok(());
        }
    }

    let resolved_cwd = resolve_cwd(&cwd);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;

    let shell = if std::path::Path::new("/usr/local/bin/fish").exists() {
        "/usr/local/bin/fish".to_string()
    } else if std::path::Path::new("/opt/homebrew/bin/fish").exists() {
        "/opt/homebrew/bin/fish".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    };
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.cwd(&resolved_cwd);

    for (k, v) in login_env(&shell) {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn: {e}"))?;
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("writer: {e}"))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("reader: {e}"))?;

    let event_name = format!("terminal-output-{id}");
    let app_handle = app.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(&event_name, &data);
                }
            }
        }
        let _ = app_handle.emit(
            &event_name,
            "\r\n\x1b[90m[process exited]\x1b[0m\r\n",
        );
    });

    store.lock().await.insert(
        id,
        TerminalSession {
            master: pair.master,
            writer,
            _child: child,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn terminal_write(
    store: tauri::State<'_, TerminalStore>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut map = store.lock().await;
    let session = map.get_mut(&id).ok_or("terminal not found")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("flush: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn terminal_resize(
    store: tauri::State<'_, TerminalStore>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = store.lock().await;
    let session = map.get(&id).ok_or("terminal not found")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn terminal_kill(
    store: tauri::State<'_, TerminalStore>,
    id: String,
) -> Result<(), String> {
    let mut map = store.lock().await;
    if let Some(mut session) = map.remove(&id) {
        let _ = session._child.kill();
    }
    Ok(())
}
