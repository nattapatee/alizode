// Alizode — ACP (Agent Client Protocol) backend.
//
// Ported from Krypton's acp.rs. Spawns an external agent subprocess and speaks
// newline-delimited JSON-RPC 2.0 over its stdio. One AcpClient per harness-side
// session. The Rust side acts as JSON-RPC client AND handles inbound requests
// (fs/read_text_file, fs/write_text_file, session/request_permission).

use log::{debug, info, warn};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

// ─── Built-in backends ─────────────────────────────────────────────

#[derive(Debug, Clone)]
struct AcpBackend {
    command: String,
    args: Vec<String>,
    display_name: String,
}

fn builtin_backends() -> Vec<(&'static str, AcpBackend)> {
    vec![
        (
            "claude",
            AcpBackend {
                command: "npx".to_string(),
                args: vec![
                    "-y".to_string(),
                    "@agentclientprotocol/claude-agent-acp".to_string(),
                ],
                display_name: "Claude".to_string(),
            },
        ),
        (
            "gemini",
            AcpBackend {
                command: "antigravity".to_string(),
                args: vec!["--experimental-acp".to_string()],
                display_name: "Gemini".to_string(),
            },
        ),
        (
            "codex",
            AcpBackend {
                command: "codex-acp".to_string(),
                args: vec![],
                display_name: "Codex".to_string(),
            },
        ),
        (
            "opencode",
            AcpBackend {
                command: "opencode".to_string(),
                args: vec!["acp".to_string()],
                display_name: "OpenCode".to_string(),
            },
        ),
        (
            "pi-acp",
            AcpBackend {
                command: "pi-acp".to_string(),
                args: vec![],
                display_name: "Pi".to_string(),
            },
        ),
        (
            "droid",
            AcpBackend {
                command: "droid".to_string(),
                args: vec![
                    "exec".to_string(),
                    "--output-format".to_string(),
                    "acp".to_string(),
                ],
                display_name: "Droid".to_string(),
            },
        ),
        (
            "cursor",
            AcpBackend {
                command: "cursor-agent".to_string(),
                args: vec!["acp".to_string()],
                display_name: "Cursor".to_string(),
            },
        ),
    ]
}

fn resolve_backend(id: &str) -> Option<AcpBackend> {
    builtin_backends()
        .into_iter()
        .find(|(bid, _)| *bid == id)
        .map(|(_, b)| b)
}

static CACHED_LOGIN_ENV: OnceLock<HashMap<String, String>> = OnceLock::new();

/// Capture the user's login-shell environment once by spawning
/// `$SHELL -lc '/usr/bin/env -0'` and parsing NUL-separated output.
/// macOS GUI apps don't inherit env vars set in shell rc files.
pub(crate) fn cached_login_env() -> &'static HashMap<String, String> {
    CACHED_LOGIN_ENV.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let output = std::process::Command::new(&shell)
            .args(["-l", "-c", "/usr/bin/env -0"])
            .output();
        let mut map = HashMap::new();
        if let Ok(out) = output {
            for entry in out.stdout.split(|&b| b == 0) {
                if entry.is_empty() {
                    continue;
                }
                if let Ok(s) = std::str::from_utf8(entry) {
                    if let Some((k, v)) = s.split_once('=') {
                        map.insert(k.to_string(), v.to_string());
                    }
                }
            }
        }
        map
    })
}

#[tauri::command]
pub async fn acp_login_env() -> Result<HashMap<String, String>, String> {
    Ok(cached_login_env().clone())
}


// ─── Public types exposed to the frontend ──────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct AcpBackendDescriptor {
    pub id: String,
    pub display_name: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentInitInfo {
    pub agent_protocol_version: i64,
    pub auth_methods: Vec<Value>,
    pub agent_capabilities: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentSessionInfo {
    pub session_id: String,
    pub config_options: Vec<Value>,
    pub models: Value,
}

// ─── AcpClient ─────────────────────────────────────────────────────

struct AcpClient {
    alizode_session: u64,
    backend_id: String,
    #[allow(dead_code)]
    display_name: String,
    stdin: Mutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    perm_pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    fs_write_pending: Mutex<HashMap<u64, FsWriteCtx>>,
    next_id: AtomicU64,
    agent_capabilities: RwLock<Option<Value>>,
    acp_session_id: RwLock<Option<String>>,
    stderr_buf: Mutex<String>,
    child: Mutex<Option<Child>>,
    child_pid: AtomicU32,
    cwd: RwLock<Option<String>>,
    mcp_servers: RwLock<Vec<Value>>,
    model_override: RwLock<Option<String>>,
    disposed: std::sync::atomic::AtomicBool,
}

impl AcpClient {
    fn new(alizode_session: u64, backend_id: String, display_name: String) -> Self {
        Self {
            alizode_session,
            backend_id,
            display_name,
            stdin: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            perm_pending: Mutex::new(HashMap::new()),
            fs_write_pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            agent_capabilities: RwLock::new(None),
            acp_session_id: RwLock::new(None),
            stderr_buf: Mutex::new(String::new()),
            child: Mutex::new(None),
            child_pid: AtomicU32::new(0),
            cwd: RwLock::new(None),
            mcp_servers: RwLock::new(Vec::new()),
            model_override: RwLock::new(None),
            disposed: std::sync::atomic::AtomicBool::new(false),
        }
    }

    fn next_request_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_request_id();
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(id, tx);
        }
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        self.write_line(&payload).await?;
        match rx.await {
            Ok(v) => {
                if let Some(err) = v.get("error") {
                    Err(format!("{method} failed: {err}"))
                } else {
                    Ok(v.get("result").cloned().unwrap_or(Value::Null))
                }
            }
            Err(_) => Err(format!("{method}: subprocess closed before reply")),
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let payload = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        self.write_line(&payload).await
    }

    async fn write_line(&self, value: &Value) -> Result<(), String> {
        let mut text = serde_json::to_string(value).map_err(|e| format!("serialize: {e}"))?;
        text.push('\n');
        let mut guard = self.stdin.lock().await;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| "ACP stdin closed".to_string())?;
        stdin
            .write_all(text.as_bytes())
            .await
            .map_err(|e| format!("write: {e}"))?;
        stdin.flush().await.map_err(|e| format!("flush: {e}"))?;
        Ok(())
    }

    async fn reply(&self, id: Value, result: Result<Value, Value>) -> Result<(), String> {
        let payload = match result {
            Ok(v) => json!({"jsonrpc": "2.0", "id": id, "result": v}),
            Err(e) => json!({"jsonrpc": "2.0", "id": id, "error": e}),
        };
        self.write_line(&payload).await
    }

    fn event_name(&self) -> String {
        format!("acp-event-{}", self.alizode_session)
    }

    fn emit_event(&self, app: &AppHandle, payload: Value) {
        if self.disposed.load(Ordering::Relaxed) {
            return;
        }
        let _ = app.emit(&self.event_name(), &payload);
    }

    async fn append_stderr(&self, chunk: &str) {
        let mut buf = self.stderr_buf.lock().await;
        buf.push_str(chunk);
        if buf.len() > 64 * 1024 {
            let drop = buf.len() - 64 * 1024;
            *buf = buf[drop..].to_string();
        }
    }

    async fn stderr_snapshot(&self) -> String {
        self.stderr_buf.lock().await.clone()
    }
}

fn client_session_cwd(client: &AcpClient) -> Option<String> {
    client.cwd.read().ok().and_then(|g| g.clone()).or_else(|| {
        std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string())
    })
}

fn client_mcp_servers(client: &AcpClient) -> Vec<Value> {
    client
        .mcp_servers
        .read()
        .map(|g| g.clone())
        .unwrap_or_default()
}

fn set_client_session_id(client: &AcpClient, session_id: &str) {
    if let Ok(mut g) = client.acp_session_id.write() {
        *g = Some(session_id.to_string());
    }
}

// ─── FsWrite context ──────────────────────────────────────────────

struct FsWriteCtx {
    reply: oneshot::Sender<Result<Value, Value>>,
    path: String,
    new_content: String,
}

// ─── Reader task ───────────────────────────────────────────────────

async fn run_reader<R>(client: Arc<AcpClient>, app: AppHandle, mut reader: BufReader<R>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => {
                info!("[acp:{}] subprocess stdout closed", client.alizode_session);
                break;
            }
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let value: Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(err) => {
                        debug!(
                            "[acp:{}] dropping non-JSON line ({err}): {}",
                            client.alizode_session,
                            &trimmed[..trimmed.len().min(200)]
                        );
                        continue;
                    }
                };
                dispatch_message(&client, &app, value).await;
            }
            Err(err) => {
                warn!("[acp:{}] read error: {err}", client.alizode_session);
                break;
            }
        }
    }
    finalize_disconnect(&client, &app).await;
}

async fn dispatch_message(client: &Arc<AcpClient>, app: &AppHandle, value: Value) {
    let has_id = value.get("id").is_some();
    let has_method = value.get("method").is_some();

    if has_id && has_method {
        let id = value.get("id").cloned().unwrap_or(Value::Null);
        let method = value
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        let params = value.get("params").cloned().unwrap_or(Value::Null);
        let c = client.clone();
        let a = app.clone();
        tokio::spawn(async move {
            handle_inbound_request(c, a, id, method, params).await;
        });
        return;
    }

    if has_id {
        let id = value.get("id").and_then(|v| v.as_u64()).unwrap_or(u64::MAX);
        let mut pending = client.pending.lock().await;
        if let Some(tx) = pending.remove(&id) {
            let _ = tx.send(value);
        } else {
            debug!("[acp:{}] response for unknown id {id}", client.alizode_session);
        }
        return;
    }

    if has_method {
        let method = value
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        let params = value.get("params").cloned().unwrap_or(Value::Null);
        handle_notification(client, app, &method, params);
    } else {
        debug!("[acp:{}] dropping malformed message", client.alizode_session);
    }
}

async fn validate_fs_path(client: &Arc<AcpClient>, raw_path: &str) -> Result<(), Value> {
    if raw_path.is_empty() {
        return Err(json!({ "code": -32602, "message": "Empty path" }));
    }
    let cwd_opt = match client.cwd.read() {
        Ok(g) => g.clone(),
        Err(_) => return Ok(()),
    };
    let Some(cwd) = cwd_opt else {
        return Ok(());
    };
    let root = match std::fs::canonicalize(&cwd) {
        Ok(p) => p,
        Err(_) => return Ok(()),
    };
    let candidate = std::path::PathBuf::from(raw_path);
    let abs = if candidate.is_absolute() {
        candidate
    } else {
        root.join(&candidate)
    };
    let mut probe = abs.clone();
    let resolved = loop {
        match std::fs::canonicalize(&probe) {
            Ok(p) => {
                let suffix = abs
                    .strip_prefix(&probe)
                    .unwrap_or(std::path::Path::new(""));
                break p.join(suffix);
            }
            Err(_) => match probe.parent() {
                Some(parent) => probe = parent.to_path_buf(),
                None => break abs.clone(),
            },
        }
    };
    if !resolved.starts_with(&root) {
        return Err(json!({
            "code": -32602,
            "message": format!("Path outside project root: {}", raw_path),
        }));
    }
    Ok(())
}

fn emit_fs_activity(
    client: &Arc<AcpClient>,
    app: &AppHandle,
    method: &str,
    path: &str,
    ok: bool,
    error: Option<&str>,
) {
    let mut payload = json!({
        "type": "fs_activity",
        "method": method,
        "path": path,
        "ok": ok,
    });
    if let Some(msg) = error {
        if let Some(map) = payload.as_object_mut() {
            map.insert("error".to_string(), json!(msg));
        }
    }
    client.emit_event(app, payload);
}

async fn handle_inbound_request(
    client: Arc<AcpClient>,
    app: AppHandle,
    id: Value,
    method: String,
    params: Value,
) {
    match method.as_str() {
        "fs/read_text_file" => {
            let path = params
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if let Err(err) = validate_fs_path(&client, &path).await {
                let msg = err
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("path scope")
                    .to_string();
                emit_fs_activity(&client, &app, "read", &path, false, Some(&msg));
                let _ = client.reply(id, Err(err)).await;
                return;
            }
            let result = match std::fs::read_to_string(&path) {
                Ok(content) => {
                    emit_fs_activity(&client, &app, "read", &path, true, None);
                    Ok(json!({ "content": content }))
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    debug!("[acp:{}] fs/read_text_file: not found, returning empty", client.alizode_session);
                    emit_fs_activity(&client, &app, "read", &path, true, None);
                    Ok(json!({ "content": "" }))
                }
                Err(e) => {
                    let msg = format!("{e}");
                    emit_fs_activity(&client, &app, "read", &path, false, Some(&msg));
                    Err(json!({ "code": -32000, "message": format!("fs/read_text_file: {e}") }))
                }
            };
            let _ = client.reply(id, result).await;
        }
        "fs/write_text_file" => {
            let path = params
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let content = params
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if let Err(err) = validate_fs_path(&client, &path).await {
                let msg = err
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("path scope")
                    .to_string();
                emit_fs_activity(&client, &app, "write", &path, false, Some(&msg));
                let _ = client.reply(id, Err(err)).await;
                return;
            }
            let old_text = std::fs::read_to_string(&path).unwrap_or_default();
            let request_id = id.as_u64().unwrap_or(0);
            let (tx, rx) = oneshot::channel::<Result<Value, Value>>();
            {
                let mut pending = client.fs_write_pending.lock().await;
                pending.insert(
                    request_id,
                    FsWriteCtx {
                        reply: tx,
                        path: path.clone(),
                        new_content: content.clone(),
                    },
                );
            }
            client.emit_event(
                &app,
                json!({
                    "type": "fs_write_pending",
                    "requestId": request_id,
                    "path": path,
                    "oldText": old_text,
                    "newText": content,
                }),
            );
            let outcome = rx.await;
            let result: Result<Value, Value> = match outcome {
                Ok(decision) => decision,
                Err(_) => Err(json!({
                    "code": -32000,
                    "message": "fs/write_text_file: decision channel dropped"
                })),
            };
            match &result {
                Ok(_) => emit_fs_activity(&client, &app, "write", &path, true, None),
                Err(err) => {
                    let msg = err
                        .get("message")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| "write failed".to_string());
                    emit_fs_activity(&client, &app, "write", &path, false, Some(&msg));
                }
            }
            let _ = client.reply(id, result).await;
        }
        "session/request_permission" => {
            let request_id = id.as_u64().unwrap_or(0);
            let (tx, rx) = oneshot::channel();
            {
                let mut perm = client.perm_pending.lock().await;
                perm.insert(request_id, tx);
            }
            client.emit_event(
                &app,
                json!({
                    "type": "permission_request",
                    "requestId": request_id,
                    "params": params,
                }),
            );
            match rx.await {
                Ok(outcome) => {
                    let _ = client
                        .reply(id, Ok(json!({ "outcome": outcome })))
                        .await;
                }
                Err(_) => {
                    let _ = client
                        .reply(
                            id,
                            Ok(json!({ "outcome": { "outcome": "cancelled" } })),
                        )
                        .await;
                }
            }
        }
        other => {
            debug!("[acp:{}] unknown inbound method: {other}", client.alizode_session);
            let _ = client
                .reply(
                    id,
                    Err(json!({
                        "code": -32601,
                        "message": format!("Method not found: {other}")
                    })),
                )
                .await;
        }
    }
}

fn handle_notification(
    client: &Arc<AcpClient>,
    app: &AppHandle,
    method: &str,
    params: Value,
) {
    match method {
        "session/update" => {
            let update_kind = params
                .get("update")
                .and_then(|u| u.get("sessionUpdate"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let update = params.get("update").cloned().unwrap_or(Value::Null);
            match update_kind {
                "agent_message_chunk" | "user_message_chunk" | "agent_thought_chunk"
                | "tool_call" | "tool_call_update" | "plan" | "usage_update"
                | "available_commands_update" | "current_mode_update"
                | "session_info_update" => {
                    client.emit_event(
                        app,
                        json!({
                            "type": "session_update",
                            "kind": update_kind,
                            "update": update,
                        }),
                    );
                }
                other => {
                    debug!(
                        "[acp:{}] dropping session/update kind {other}",
                        client.alizode_session
                    );
                }
            }
        }
        other => {
            debug!(
                "[acp:{}] dropping notification {other}",
                client.alizode_session
            );
        }
    }
}

async fn finalize_disconnect(client: &Arc<AcpClient>, app: &AppHandle) {
    {
        let mut pending = client.pending.lock().await;
        pending.clear();
    }
    {
        let mut perm = client.perm_pending.lock().await;
        perm.clear();
    }
    {
        let mut writes = client.fs_write_pending.lock().await;
        writes.clear();
    }
    if !client.disposed.load(Ordering::Relaxed) {
        client.emit_event(
            app,
            json!({
                "type": "stop",
                "stopReason": "cancelled",
                "reason": "subprocess exited",
            }),
        );
    }
}

// ─── Stderr task ───────────────────────────────────────────────────

async fn run_stderr_capture<R>(client: Arc<AcpClient>, mut reader: BufReader<R>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {
                debug!("[acp:{}] stderr: {}", client.alizode_session, line.trim_end());
                client.append_stderr(&line).await;
            }
            Err(_) => break,
        }
    }
}

// ─── Registry ──────────────────────────────────────────────────────

pub struct AcpRegistry {
    next_session: AtomicU64,
    clients: RwLock<HashMap<u64, Arc<AcpClient>>>,
}

impl AcpRegistry {
    pub fn new() -> Self {
        Self {
            next_session: AtomicU64::new(1),
            clients: RwLock::new(HashMap::new()),
        }
    }

    fn allocate_session(&self) -> u64 {
        self.next_session.fetch_add(1, Ordering::Relaxed)
    }

    fn get(&self, session: u64) -> Option<Arc<AcpClient>> {
        self.clients.read().ok()?.get(&session).cloned()
    }

    fn insert(&self, session: u64, client: Arc<AcpClient>) {
        if let Ok(mut map) = self.clients.write() {
            map.insert(session, client);
        }
    }

    fn remove(&self, session: u64) -> Option<Arc<AcpClient>> {
        self.clients.write().ok()?.remove(&session)
    }

    fn drain(&self) -> Vec<(u64, Arc<AcpClient>)> {
        match self.clients.write() {
            Ok(mut map) => map.drain().collect(),
            Err(_) => Vec::new(),
        }
    }
}

impl Default for AcpRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Tauri commands ────────────────────────────────────────────────

#[tauri::command]
pub fn acp_list_backends() -> Result<Vec<AcpBackendDescriptor>, String> {
    let mut out: Vec<AcpBackendDescriptor> = builtin_backends()
        .iter()
        .map(|(id, b)| AcpBackendDescriptor {
            id: (*id).to_string(),
            display_name: b.display_name.clone(),
            command: b.command.clone(),
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
pub async fn acp_spawn(
    backend_id: String,
    cwd: Option<String>,
    model: Option<String>,
    mcp_servers: Option<Vec<Value>>,
    app: AppHandle,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<u64, String> {
    let mut backend = resolve_backend(&backend_id)
        .ok_or_else(|| format!("Unknown ACP backend: {backend_id}"))?;

    let display_name = if backend.display_name.is_empty() {
        backend_id.clone()
    } else {
        backend.display_name.clone()
    };

    if let Some(ref m) = model {
        if backend_id == "gemini" {
            backend.args.push("--model".to_string());
            backend.args.push(m.clone());
        } else if backend_id == "droid" {
            backend.args.push("-m".to_string());
            backend.args.push(m.clone());
        }
    }

    let mut cmd = Command::new("/usr/bin/env");
    cmd.arg(&backend.command);
    cmd.args(&backend.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    cmd.envs(cached_login_env().iter());
    let cwd = cwd.map(|d| {
        if d.starts_with('~') {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
            d.replacen('~', &home, 1)
        } else {
            d
        }
    });
    if let Some(d) = cwd.as_ref() {
        cmd.current_dir(d);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to spawn {} {}: {e}. {}",
            backend.command,
            backend.args.join(" "),
            startup_hint(&backend_id, &e.to_string())
        )
    })?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "child stdin missing".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "child stdout missing".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "child stderr missing".to_string())?;

    let session = registry.allocate_session();
    let client = Arc::new(AcpClient::new(session, backend_id, display_name));
    if let Some(pid) = child.id() {
        client.child_pid.store(pid, Ordering::Relaxed);
    }
    if let Ok(mut g) = client.cwd.write() {
        *g = cwd;
    }
    if let Ok(mut g) = client.mcp_servers.write() {
        *g = mcp_servers.unwrap_or_default();
    }
    if let Ok(mut g) = client.model_override.write() {
        *g = model;
    }
    {
        let mut g = client.stdin.lock().await;
        *g = Some(stdin);
    }
    {
        let mut g = client.child.lock().await;
        *g = Some(child);
    }
    registry.insert(session, client.clone());

    let reader_client = client.clone();
    let reader_app = app.clone();
    tokio::spawn(async move {
        let buf = BufReader::new(stdout);
        run_reader(reader_client, reader_app, buf).await;
    });
    let stderr_client = client.clone();
    tokio::spawn(async move {
        let buf = BufReader::new(stderr);
        run_stderr_capture(stderr_client, buf).await;
    });

    Ok(session)
}

#[tauri::command]
pub async fn acp_initialize(
    session: u64,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<AgentInitInfo, String> {
    let client = registry
        .get(session)
        .ok_or_else(|| format!("Unknown ACP session: {session}"))?;

    let init_params = json!({
        "protocolVersion": 1,
        "clientCapabilities": {
            "fs": { "readTextFile": true, "writeTextFile": true },
            "terminal": false,
        },
        "clientInfo": { "name": "alizode", "version": env!("CARGO_PKG_VERSION") },
    });

    let init = match tokio::time::timeout(
        Duration::from_secs(30),
        client.request("initialize", init_params),
    )
    .await
    {
        Ok(Ok(init)) => init,
        Ok(Err(e)) => {
            let stderr = client.stderr_snapshot().await;
            return Err(format!(
                "{e}. {}",
                startup_hint(&client.backend_id, &stderr)
            ));
        }
        Err(_) => {
            let stderr = client.stderr_snapshot().await;
            return Err(format!(
                "ACP initialize timed out after 30s. {}",
                startup_hint(&client.backend_id, &stderr)
            ));
        }
    };

    let proto = init
        .get("protocolVersion")
        .and_then(|v| v.as_i64())
        .unwrap_or(1);
    let auth_methods = init
        .get("authMethods")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let capabilities = init
        .get("agentCapabilities")
        .cloned()
        .unwrap_or(Value::Null);

    if let Ok(mut g) = client.agent_capabilities.write() {
        *g = Some(capabilities.clone());
    }

    Ok(AgentInitInfo {
        agent_protocol_version: proto,
        auth_methods,
        agent_capabilities: capabilities,
    })
}

#[tauri::command]
pub async fn acp_set_mcp_servers(
    session: u64,
    mcp_servers: Vec<Value>,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<(), String> {
    let client = registry
        .get(session)
        .ok_or_else(|| format!("Unknown ACP session: {session}"))?;
    if let Ok(mut g) = client.mcp_servers.write() {
        *g = mcp_servers;
    }
    Ok(())
}

#[tauri::command]
pub async fn acp_session_new(
    session: u64,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<AgentSessionInfo, String> {
    let client = registry
        .get(session)
        .ok_or_else(|| format!("Unknown ACP session: {session}"))?;

    let session_cwd = client_session_cwd(&client);
    let mcp_servers = client_mcp_servers(&client);

    let new_session = tokio::time::timeout(
        Duration::from_secs(30),
        client.request(
            "session/new",
            json!({
                "cwd": session_cwd,
                "mcpServers": mcp_servers,
            }),
        ),
    )
    .await
    .map_err(|_| "session/new timed out".to_string())??;

    let acp_session_id = new_session
        .get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "session/new: missing sessionId".to_string())?
        .to_string();
    set_client_session_id(&client, &acp_session_id);

    let config_options = new_session
        .get("configOptions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let models = new_session
        .get("models")
        .cloned()
        .unwrap_or(Value::Null);

    if client.backend_id == "opencode" {
        set_opencode_default_model(&client, &acp_session_id).await.ok();
    }

    Ok(AgentSessionInfo {
        session_id: acp_session_id,
        config_options,
        models,
    })
}

#[tauri::command]
pub async fn acp_session_list(
    session: u64,
    cwd: Option<String>,
    cursor: Option<String>,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<Value, String> {
    let client = registry
        .get(session)
        .ok_or_else(|| format!("Unknown ACP session: {session}"))?;
    let mut params = serde_json::Map::new();
    if let Some(cwd) = cwd {
        params.insert("cwd".to_string(), json!(cwd));
    }
    if let Some(cursor) = cursor {
        params.insert("cursor".to_string(), json!(cursor));
    }
    client.request("session/list", Value::Object(params)).await
}

const OPENCODE_DEFAULT_MODEL: &str = "kimi 2.6 max";

async fn set_opencode_default_model(
    client: &AcpClient,
    acp_session_id: &str,
) -> Result<(), String> {
    let model = client
        .model_override
        .read()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_else(|| OPENCODE_DEFAULT_MODEL.to_string());

    let result = tokio::time::timeout(
        Duration::from_secs(10),
        client.request(
            "session/set_config_option",
            json!({
                "sessionId": acp_session_id,
                "configId": "model",
                "value": &model,
            }),
        ),
    )
    .await
    .map_err(|_| "session/set_config_option timed out".to_string())?;

    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("set_config_option failed: {e}")),
    }
}

async fn acp_session_restore(
    client: Arc<AcpClient>,
    method: &str,
    session_id: String,
) -> Result<AgentSessionInfo, String> {
    set_client_session_id(&client, &session_id);
    let session_cwd = client_session_cwd(&client);
    let mcp_servers = client_mcp_servers(&client);
    client
        .request(
            method,
            json!({
                "sessionId": &session_id,
                "cwd": session_cwd,
                "mcpServers": mcp_servers,
            }),
        )
        .await?;
    Ok(AgentSessionInfo {
        session_id,
        config_options: Vec::new(),
        models: Value::Null,
    })
}

#[tauri::command]
pub async fn acp_session_resume(
    session: u64,
    session_id: String,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<AgentSessionInfo, String> {
    let client = registry
        .get(session)
        .ok_or_else(|| format!("Unknown ACP session: {session}"))?;
    acp_session_restore(client, "session/resume", session_id).await
}

#[tauri::command]
pub async fn acp_session_load(
    session: u64,
    session_id: String,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<AgentSessionInfo, String> {
    let client = registry
        .get(session)
        .ok_or_else(|| format!("Unknown ACP session: {session}"))?;
    acp_session_restore(client, "session/load", session_id).await
}

#[tauri::command]
pub async fn acp_prompt(
    session: u64,
    blocks: Value,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<Value, String> {
    let client = registry
        .get(session)
        .ok_or_else(|| format!("Unknown ACP session: {session}"))?;
    let acp_session_id = client
        .acp_session_id
        .read()
        .ok()
        .and_then(|g| g.clone())
        .ok_or_else(|| "session not initialized".to_string())?;
    client
        .request(
            "session/prompt",
            json!({ "sessionId": acp_session_id, "prompt": blocks }),
        )
        .await
}

#[tauri::command]
pub async fn acp_set_config_option(
    session: u64,
    config_id: String,
    value: String,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<Value, String> {
    let client = registry
        .get(session)
        .ok_or_else(|| format!("Unknown ACP session: {session}"))?;
    let acp_session_id = client
        .acp_session_id
        .read()
        .ok()
        .and_then(|g| g.clone())
        .ok_or_else(|| "session not initialized".to_string())?;
    tokio::time::timeout(
        Duration::from_secs(10),
        client.request(
            "session/set_config_option",
            json!({
                "sessionId": acp_session_id,
                "configId": config_id,
                "value": value,
            }),
        ),
    )
    .await
    .map_err(|_| "set_config_option timed out".to_string())?
}

#[tauri::command]
pub async fn acp_cancel(
    session: u64,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<(), String> {
    let client = registry
        .get(session)
        .ok_or_else(|| format!("Unknown ACP session: {session}"))?;
    let acp_session_id = match client.acp_session_id.read().ok().and_then(|g| g.clone()) {
        Some(s) => s,
        None => return Ok(()),
    };
    client
        .notify("session/cancel", json!({ "sessionId": acp_session_id }))
        .await
}

#[tauri::command]
pub async fn acp_permission_response(
    session: u64,
    request_id: u64,
    option_id: Option<String>,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<(), String> {
    let client = registry
        .get(session)
        .ok_or_else(|| format!("Unknown ACP session: {session}"))?;
    let mut perm = client.perm_pending.lock().await;
    if let Some(tx) = perm.remove(&request_id) {
        let outcome = match option_id {
            Some(opt) => json!({ "outcome": "selected", "optionId": opt }),
            None => json!({ "outcome": "cancelled" }),
        };
        let _ = tx.send(outcome);
    }
    Ok(())
}

#[tauri::command]
pub async fn acp_fs_write_response(
    session: u64,
    request_id: u64,
    accept: bool,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<(), String> {
    let client = registry
        .get(session)
        .ok_or_else(|| format!("Unknown ACP session: {session}"))?;
    let ctx = {
        let mut pending = client.fs_write_pending.lock().await;
        pending.remove(&request_id)
    };
    let Some(ctx) = ctx else {
        return Ok(());
    };
    let outcome: Result<Value, Value> = if accept {
        if let Some(parent) = std::path::Path::new(&ctx.path).parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                let _ = ctx.reply.send(Err(
                    json!({ "code": -32000, "message": format!("mkdir: {e}") }),
                ));
                return Ok(());
            }
        }
        match std::fs::write(&ctx.path, &ctx.new_content) {
            Ok(_) => Ok(json!({})),
            Err(e) => Err(json!({ "code": -32000, "message": format!("write: {e}") })),
        }
    } else {
        Err(json!({ "code": -32000, "message": "User rejected the write" }))
    };
    let _ = ctx.reply.send(outcome);
    Ok(())
}

#[tauri::command]
pub async fn acp_dispose(
    session: u64,
    registry: State<'_, Arc<AcpRegistry>>,
) -> Result<(), String> {
    let Some(client) = registry.remove(session) else {
        return Ok(());
    };
    dispose_client(&client).await;
    Ok(())
}

pub async fn dispose_all(registry: &AcpRegistry) {
    let drained = registry.drain();
    for (_session, client) in drained {
        dispose_client(&client).await;
    }
}

async fn dispose_client(client: &AcpClient) {
    client.disposed.store(true, Ordering::Relaxed);
    client.child_pid.store(0, Ordering::Relaxed);
    {
        let mut g = client.stdin.lock().await;
        *g = None;
    }
    let mut child_guard = client.child.lock().await;
    if let Some(mut child) = child_guard.take() {
        #[cfg(unix)]
        {
            if let Some(pid) = child.id() {
                // SAFETY: pid is a valid process group leader (process_group(0) on spawn).
                // Negative pid signals the entire process group.
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGTERM);
                }
            }
        }
        let wait_result = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
        if wait_result.is_err() {
            #[cfg(unix)]
            {
                if let Some(pid) = child.id() {
                    // SAFETY: same as above — escalate to SIGKILL after timeout.
                    unsafe {
                        libc::kill(-(pid as i32), libc::SIGKILL);
                    }
                }
            }
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
    }
}

// ─── Helpers ───────────────────────────────────────────────────────

fn startup_hint(backend_id: &str, stderr: &str) -> String {
    let s = stderr.to_lowercase();
    if s.contains("/login") || s.contains("not authenticated") {
        return "Run `claude /login` in a terminal, then retry.".to_string();
    }
    if s.contains("gemini auth") || s.contains("please authenticate") {
        return "Run `antigravity auth login` in a terminal, then retry.".to_string();
    }
    if s.contains("npm err") || s.contains("enoent") {
        return "Check network or install the adapter: \
                `npm i -g @agentclientprotocol/claude-agent-acp`."
            .to_string();
    }
    if stderr.is_empty() {
        format!("Adapter `{backend_id}` failed to start.")
    } else {
        let tail: String = stderr
            .chars()
            .rev()
            .take(2048)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        tail
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_backends_returns_all() {
        let backends = acp_list_backends().unwrap();
        assert!(backends.len() >= 7);
        assert!(backends.iter().any(|b| b.id == "claude"));
        assert!(backends.iter().any(|b| b.id == "codex"));
        assert!(backends.iter().any(|b| b.id == "cursor"));
    }

    #[test]
    fn resolve_unknown_backend_returns_none() {
        assert!(resolve_backend("nonexistent").is_none());
    }

    #[test]
    fn startup_hint_suggests_login_for_auth_errors() {
        let hint = startup_hint("claude", "not authenticated");
        assert!(hint.contains("claude /login"));
    }
}
