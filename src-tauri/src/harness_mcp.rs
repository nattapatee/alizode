use axum::{
    extract::{Path, State as AxumState},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::oneshot;

use crate::store::db::Database;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize)]
pub struct McpLaneStats {
    pub lane_label: String,
    pub initialize_count: u64,
    pub tools_list_count: u64,
    pub tools_call_count: u64,
    pub last_method: String,
    pub last_seen_at: u64,
}

pub struct HarnessMcpState {
    pub port: std::sync::Mutex<u16>,
    pub shutdown_tx: std::sync::Mutex<Option<oneshot::Sender<()>>>,
    harness_id: String,
    db: Arc<tokio::sync::Mutex<Database>>,
    pending_replies: std::sync::Mutex<std::collections::HashMap<String, oneshot::Sender<Value>>>,
    mcp_stats: std::sync::Mutex<std::collections::HashMap<String, McpLaneStats>>,
}

impl HarnessMcpState {
    pub fn new(db: Arc<tokio::sync::Mutex<Database>>) -> Self {
        Self {
            port: std::sync::Mutex::new(0),
            shutdown_tx: std::sync::Mutex::new(None),
            harness_id: format!("hm-{}", Uuid::new_v4()),
            db,
            pending_replies: std::sync::Mutex::new(std::collections::HashMap::new()),
            mcp_stats: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn get_port(&self) -> u16 {
        *self.port.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn get_harness_id(&self) -> &str {
        &self.harness_id
    }

    fn register_reply(&self, id: String) -> oneshot::Receiver<Value> {
        let (tx, rx) = oneshot::channel();
        let mut map = self.pending_replies.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(id, tx);
        rx
    }

    fn drop_reply(&self, id: &str) {
        let mut map = self.pending_replies.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(id);
    }

    pub fn complete_reply(&self, id: &str, value: Value) -> bool {
        let sender = {
            let mut map = self.pending_replies.lock().unwrap_or_else(|e| e.into_inner());
            map.remove(id)
        };
        match sender {
            Some(tx) => tx.send(value).is_ok(),
            None => false,
        }
    }
}

struct ServerState {
    app_handle: AppHandle,
    harness: Arc<HarnessMcpState>,
}

async fn handle_mcp(
    AxumState(state): AxumState<Arc<ServerState>>,
    Path(lane_id): Path<String>,
    Json(request): Json<Value>,
) -> axum::response::Response {
    handle_mcp_core(&state, &lane_id, request).await
}

async fn handle_mcp_scoped(
    AxumState(state): AxumState<Arc<ServerState>>,
    Path((harness_id, lane_id)): Path<(String, String)>,
    Json(request): Json<Value>,
) -> axum::response::Response {
    if harness_id != state.harness.get_harness_id() {
        return StatusCode::FORBIDDEN.into_response();
    }
    handle_mcp_core(&state, &lane_id, request).await
}

async fn handle_mcp_core(
    state: &ServerState,
    lane_id: &str,
    request: Value,
) -> axum::response::Response {
    let id = request.get("id").cloned();
    let method = request.get("method").and_then(|v| v.as_str()).unwrap_or("");

    if id.is_none() && method == "notifications/initialized" {
        return StatusCode::ACCEPTED.into_response();
    }

    {
        let mut stats = state.harness.mcp_stats.lock().unwrap_or_else(|e| e.into_inner());
        let entry = stats.entry(lane_id.to_string()).or_insert_with(|| McpLaneStats {
            lane_label: lane_id.to_string(),
            initialize_count: 0,
            tools_list_count: 0,
            tools_call_count: 0,
            last_method: String::new(),
            last_seen_at: 0,
        });
        match method {
            "initialize" => entry.initialize_count += 1,
            "tools/list" => entry.tools_list_count += 1,
            "tools/call" => entry.tools_call_count += 1,
            _ => {}
        }
        entry.last_method = method.to_string();
        entry.last_seen_at = now_ms();
        let _ = state.app_handle.emit("acp-harness-mcp-touched", &serde_json::json!({
            "laneId": lane_id,
            "method": method,
            "at": entry.last_seen_at,
        }));
    }

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": {
                "name": "alizode-harness",
                "version": env!("CARGO_PKG_VERSION"),
            },
        })),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or(Value::Null);
            handle_tool_call(state, lane_id, params).await
        }
        "" => Err(json!({ "code": -32600, "message": "Missing method" })),
        other => Err(json!({ "code": -32601, "message": format!("Method not found: {other}") })),
    };

    match (id, result) {
        (Some(id), Ok(result)) => {
            Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })).into_response()
        }
        (Some(id), Err(error)) => {
            Json(json!({ "jsonrpc": "2.0", "id": id, "error": error })).into_response()
        }
        (None, Ok(_)) => StatusCode::ACCEPTED.into_response(),
        (None, Err(error)) => Json(json!({ "jsonrpc": "2.0", "error": error })).into_response(),
    }
}

async fn handle_tool_call(
    state: &ServerState,
    lane_id: &str,
    params: Value,
) -> Result<Value, Value> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| json!({ "code": -32602, "message": "tools/call missing params.name" }))?;
    let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

    let outcome = match name {
        "memory_get" => memory_get(&state.harness, &arguments).await,
        "memory_set" => memory_set(&state.harness, lane_id, &arguments).await,
        "memory_list" => memory_list(&state.harness, &arguments).await,
        "peer_send" => peer_send(state, lane_id, &arguments).await,
        "peer_list" => peer_list(state).await,
        "peer_reply" => peer_reply(state, lane_id, &arguments).await,
        "peer_cancel" => peer_cancel(state, lane_id),
        "review_request" => review_request(state, lane_id, &arguments).await,
        "review_reply" => review_reply(state, lane_id, &arguments).await,
        other => Err(format!("Unknown tool: {other}")),
    };

    let is_error = outcome.is_err();
    let text = match outcome {
        Ok(value) => serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
        Err(message) => message,
    };
    Ok(json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error,
    }))
}

fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "memory_get",
            "description": "Get a value from workspace shared memory",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": { "type": "string" },
                    "namespace": { "type": "string" },
                    "key": { "type": "string" }
                },
                "required": ["workspace_id", "namespace", "key"]
            }
        }),
        json!({
            "name": "memory_set",
            "description": "Set a value in workspace shared memory",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": { "type": "string" },
                    "namespace": { "type": "string" },
                    "key": { "type": "string" },
                    "value": { "type": "string" }
                },
                "required": ["workspace_id", "namespace", "key", "value"]
            }
        }),
        json!({
            "name": "memory_list",
            "description": "List all keys in a memory namespace",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": { "type": "string" },
                    "namespace": { "type": "string" }
                },
                "required": ["workspace_id", "namespace"]
            }
        }),
        json!({
            "name": "peer_list",
            "description": "List all active lanes in the workspace",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "peer_send",
            "description": "Send a message to another lane and wait for their reply. Use peer_reply to respond to received messages.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "to_lane": { "description": "Target lane ID", "type": "string" },
                    "message": { "type": "string" }
                },
                "required": ["to_lane", "message"]
            }
        }),
        json!({
            "name": "peer_reply",
            "description": "Reply to a peer message and close the conversation (done:true)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "to_lane": { "description": "Lane ID of the original sender", "type": "string" },
                    "envelope_id": { "description": "Original message envelope ID", "type": "string" },
                    "reply": { "type": "string" }
                },
                "required": ["to_lane", "envelope_id", "reply"]
            }
        }),
        json!({
            "name": "peer_cancel",
            "description": "Clear stale in-flight peer conversations for this lane. Use when peer_send fails with peer_in_flight error.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }),
        json!({
            "name": "review_request",
            "description": "Request a code review from another lane",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "to_lane": { "description": "Target lane ID", "type": "string" },
                    "note": { "description": "Review instructions", "type": "string" }
                },
                "required": ["to_lane"]
            }
        }),
        json!({
            "name": "review_reply",
            "description": "Reply to a review request",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "packet_id": { "description": "Review request ID", "type": "string" },
                    "summary": { "type": "string" },
                    "findings": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["packet_id", "summary"]
            }
        }),
    ]
}

fn required_string(args: &Value, field: &str) -> Result<String, String> {
    args.get(field)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("missing required field: {field}"))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn rand_suffix() -> String {
    format!("{:08x}", rand_u32())
}

fn rand_u32() -> u32 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    std::time::SystemTime::now().hash(&mut h);
    std::thread::current().id().hash(&mut h);
    h.finish() as u32
}

const BUS_REPLY_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(2500);

async fn memory_get(harness: &HarnessMcpState, args: &Value) -> Result<Value, String> {
    let ws = required_string(args, "workspace_id")?;
    let ns = required_string(args, "namespace")?;
    let key = required_string(args, "key")?;
    let db = harness.db.lock().await;
    let entry = db.memory_get(&ws, &ns, &key).map_err(|e| e.to_string())?;
    match entry {
        Some(e) => Ok(json!({ "key": e.key, "value": e.value })),
        None => Ok(json!({ "key": key, "value": null })),
    }
}

async fn memory_set(harness: &HarnessMcpState, _lane_id: &str, args: &Value) -> Result<Value, String> {
    let ws = required_string(args, "workspace_id")?;
    let ns = required_string(args, "namespace")?;
    let key = required_string(args, "key")?;
    let value = required_string(args, "value")?;
    let db = harness.db.lock().await;
    db.memory_set(&ws, &ns, &key, &value).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

async fn memory_list(harness: &HarnessMcpState, args: &Value) -> Result<Value, String> {
    let ws = required_string(args, "workspace_id")?;
    let ns = required_string(args, "namespace")?;
    let db = harness.db.lock().await;
    let entries = db.memory_list(&ws, &ns).map_err(|e| e.to_string())?;
    let keys: Vec<&str> = entries.iter().map(|e| e.key.as_str()).collect();
    Ok(json!({ "keys": keys }))
}

async fn peer_send(state: &ServerState, from_lane: &str, args: &Value) -> Result<Value, String> {
    let to_lane = required_string(args, "to_lane")?;
    let message = required_string(args, "message")?;
    let done = args.get("_done").and_then(|v| v.as_bool()).unwrap_or(false);
    if to_lane.trim().is_empty() {
        return Err("to_lane must be non-empty".to_string());
    }
    let envelope_id = format!("env-{}-{}", now_ms(), rand_suffix());
    let envelope = json!({
        "id": envelope_id,
        "fromLaneId": from_lane,
        "toLaneId": to_lane,
        "message": message,
        "done": done,
        "sentAt": now_ms(),
        "requestId": envelope_id,
        "harnessId": state.harness.get_harness_id(),
    });
    let rx = state.harness.register_reply(envelope_id.clone());
    state.app_handle.emit("acp-inter-lane-message", &envelope)
        .map_err(|e| format!("emit failed: {e}"))?;
    match tokio::time::timeout(BUS_REPLY_TIMEOUT, rx).await {
        Ok(Ok(value)) => {
            if value.get("delivered").and_then(|v| v.as_bool()).unwrap_or(false) {
                Ok(value)
            } else {
                let reason = value.get("reason").and_then(|v| v.as_str()).unwrap_or("delivery_failed");
                Err(format!("peer_send failed: {reason}"))
            }
        }
        Ok(Err(_)) => Err("peer_send: frontend coordinator did not respond".to_string()),
        Err(_) => {
            state.harness.drop_reply(&envelope_id);
            Err("peer_send: frontend reply timed out".to_string())
        }
    }
}

async fn peer_list(state: &ServerState) -> Result<Value, String> {
    let request_id = format!("plist-{}-{}", now_ms(), rand_suffix());
    let rx = state.harness.register_reply(request_id.clone());
    state.app_handle.emit("acp-peer-list-requested", &json!({ "requestId": request_id, "harnessId": state.harness.get_harness_id() }))
        .map_err(|e| format!("emit failed: {e}"))?;
    match tokio::time::timeout(BUS_REPLY_TIMEOUT, rx).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err("peer_list: frontend coordinator did not respond".to_string()),
        Err(_) => {
            state.harness.drop_reply(&request_id);
            Err("peer_list: frontend reply timed out".to_string())
        }
    }
}

async fn peer_reply(state: &ServerState, from_lane: &str, args: &Value) -> Result<Value, String> {
    let to_lane = required_string(args, "to_lane")?;
    let envelope_id = required_string(args, "envelope_id")?;
    let reply = required_string(args, "reply")?;
    let ui_payload = json!({
        "envelopeId": envelope_id,
        "fromLaneId": from_lane,
        "toLaneId": to_lane,
        "reply": reply,
        "sentAt": now_ms(),
        "harnessId": state.harness.get_harness_id(),
    });
    let _ = state.app_handle.emit("acp-peer-reply", &ui_payload);
    let send_args = json!({
        "to_lane": to_lane,
        "message": reply,
        "_done": true,
    });
    peer_send(state, from_lane, &send_args).await
}

fn peer_cancel(state: &ServerState, lane_id: &str) -> Result<Value, String> {
    use tauri::Manager;
    let app_state = state.app_handle.state::<crate::AppState>();
    let mut coord = app_state.coordinator.lock().unwrap();
    coord.cancel_conversations_for(lane_id);
    Ok(json!({ "cleared": true, "lane_id": lane_id }))
}

async fn review_request(state: &ServerState, from_lane: &str, args: &Value) -> Result<Value, String> {
    let to_lane = required_string(args, "to_lane")?;
    let note = args.get("note").and_then(|v| v.as_str()).map(|s| s.to_string());
    let packet_id = format!("rev-{}-{}", now_ms(), rand_suffix());
    let payload = json!({
        "packetId": packet_id,
        "fromLaneId": from_lane,
        "toLaneId": to_lane,
        "note": note,
        "sentAt": now_ms(),
        "requestId": packet_id,
        "harnessId": state.harness.get_harness_id(),
    });
    let rx = state.harness.register_reply(packet_id.clone());
    state.app_handle.emit("acp-review-requested", &payload)
        .map_err(|e| format!("emit failed: {e}"))?;
    match tokio::time::timeout(BUS_REPLY_TIMEOUT, rx).await {
        Ok(Ok(value)) => {
            if value.get("delivered").and_then(|v| v.as_bool()).unwrap_or(false) {
                Ok(value)
            } else {
                let reason = value.get("reason").and_then(|v| v.as_str()).unwrap_or("delivery_failed");
                Err(format!("review_request failed: {reason}"))
            }
        }
        Ok(Err(_)) => Err("review_request: frontend coordinator did not respond".to_string()),
        Err(_) => {
            state.harness.drop_reply(&packet_id);
            Err("review_request: frontend reply timed out".to_string())
        }
    }
}

async fn review_reply(state: &ServerState, from_lane: &str, args: &Value) -> Result<Value, String> {
    let packet_id = required_string(args, "packet_id")?;
    let summary = args.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let findings = args.get("findings").cloned().unwrap_or_else(|| json!([]));
    let request_id = format!("revreply-{}-{}", now_ms(), rand_suffix());
    let payload = json!({
        "packetId": packet_id,
        "fromLaneId": from_lane,
        "summary": summary,
        "findings": findings,
        "requestId": request_id,
        "sentAt": now_ms(),
        "harnessId": state.harness.get_harness_id(),
    });
    let rx = state.harness.register_reply(request_id.clone());
    state.app_handle.emit("acp-review-reply-requested", &payload)
        .map_err(|e| format!("emit failed: {e}"))?;
    match tokio::time::timeout(BUS_REPLY_TIMEOUT, rx).await {
        Ok(Ok(value)) => {
            if value.get("delivered").and_then(|v| v.as_bool()).unwrap_or(false) {
                Ok(value)
            } else {
                let reason = value.get("reason").and_then(|v| v.as_str()).unwrap_or("delivery_failed");
                Err(format!("review_reply failed: {reason}"))
            }
        }
        Ok(Err(_)) => Err("review_reply: frontend coordinator did not respond".to_string()),
        Err(_) => {
            state.harness.drop_reply(&request_id);
            Err("review_reply: frontend reply timed out".to_string())
        }
    }
}

pub fn start(app_handle: AppHandle, harness: Arc<HarnessMcpState>) {
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                eprintln!("[harness-mcp] failed to create runtime: {e}");
                return;
            }
        };

        rt.block_on(async move {
            let shared = Arc::new(ServerState {
                app_handle: app_handle.clone(),
                harness: harness.clone(),
            });

            let app = Router::new()
                .route("/mcp/lane/{lane_id}", post(handle_mcp))
                .route("/mcp/harness/{harness_id}/lane/{lane_id}", post(handle_mcp_scoped))
                .with_state(shared);

            let addr = SocketAddr::from(([127, 0, 0, 1], 0));
            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("[harness-mcp] failed to bind: {e}");
                    return;
                }
            };

            let actual_port = match listener.local_addr() {
                Ok(a) => a.port(),
                Err(e) => {
                    eprintln!("[harness-mcp] failed to get port: {e}");
                    return;
                }
            };

            if let Ok(mut p) = harness.port.lock() {
                *p = actual_port;
            }

            eprintln!("[harness-mcp] listening on 127.0.0.1:{actual_port}");

            let _ = app_handle.emit("harness-mcp-ready", actual_port);

            let (tx, rx) = oneshot::channel::<()>();
            if let Ok(mut stx) = harness.shutdown_tx.lock() {
                *stx = Some(tx);
            }

            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await
                .unwrap_or_else(|e| {
                    eprintln!("[harness-mcp] server error: {e}");
                    if let Ok(mut p) = harness.port.lock() {
                        *p = 0;
                    }
                });
        });
    });
}

#[tauri::command]
pub async fn harness_mcp_port(
    harness: tauri::State<'_, Arc<HarnessMcpState>>,
) -> Result<u16, String> {
    Ok(harness.get_port())
}

#[tauri::command]
pub async fn harness_id(
    harness: tauri::State<'_, Arc<HarnessMcpState>>,
) -> Result<String, String> {
    Ok(harness.get_harness_id().to_string())
}

#[tauri::command]
pub async fn harness_mcp_bridge_descriptor(
    state: tauri::State<'_, crate::AppState>,
    workspace_id: String,
    lane_id: String,
) -> Result<Value, String> {
    let db_path = state.data_dir.join("alizode.db");
    let bridge = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("no parent dir")?
        .join("alizode-mcp");
    Ok(json!({
        "name": "alizode-harness",
        "type": "stdio",
        "command": bridge.to_string_lossy(),
        "args": [
            "--workspace-id", workspace_id,
            "--lane-id", lane_id,
            "--db-path", db_path.to_string_lossy(),
        ],
        "env": [],
    }))
}

#[tauri::command]
pub async fn harness_mcp_reply(
    harness: tauri::State<'_, Arc<HarnessMcpState>>,
    request_id: String,
    value: Value,
) -> Result<bool, String> {
    Ok(harness.complete_reply(&request_id, value))
}

#[tauri::command]
pub async fn list_harness_mcp_stats(
    harness: tauri::State<'_, Arc<HarnessMcpState>>,
) -> Result<Vec<McpLaneStats>, String> {
    let stats = harness.mcp_stats.lock().unwrap_or_else(|e| e.into_inner());
    Ok(stats.values().cloned().collect())
}
