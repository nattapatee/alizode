use crate::AppState;
use crate::core::acp::cached_login_env;
use crate::store::models::{Workspace, CreateWorkspace};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use tauri::State;

#[tauri::command]
pub async fn workspace_list(state: State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    let db = state.db.lock().await;
    db.list_workspaces().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_create(
    state: State<'_, AppState>,
    name: String,
    cwd: String,
) -> Result<Workspace, String> {
    let db = state.db.lock().await;
    let input = CreateWorkspace { name, cwd };
    db.create_workspace(&input).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_update_cwd(
    state: State<'_, AppState>,
    workspace_id: String,
    cwd: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.update_workspace_cwd(&workspace_id, &cwd)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_rename(
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.update_workspace_name(&workspace_id, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_delete(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.delete_workspace(&workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_bridge_descriptor(
    state: State<'_, AppState>,
    workspace_id: String,
    lane_id: String,
) -> Result<Value, String> {
    let bridge_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("no parent dir")?
        .join("alizode-mcp")
        .to_string_lossy()
        .to_string();

    let db_path = state
        .data_dir
        .join("alizode.db")
        .to_string_lossy()
        .to_string();

    Ok(json!({
        "name": "alizode-mcp",
        "type": "stdio",
        "command": bridge_path,
        "args": [
            "--db-path", db_path,
            "--workspace-id", workspace_id,
            "--lane-id", lane_id
        ],
        "env": []
    }))
}

fn expand_env_var(input: &str, env: &HashMap<String, String>) -> Option<String> {
    let mut out = String::new();
    let mut i = 0;
    let bytes = input.as_bytes();
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'$' && bytes[i + 1] == b'{' {
            let start = i + 2;
            if let Some(close) = input[start..].find('}') {
                let expr = &input[start..start + close];
                let (name, fallback) = match expr.find(":-") {
                    Some(pos) => (&expr[..pos], Some(&expr[pos + 2..])),
                    None => (expr, None),
                };
                match (env.get(name), fallback) {
                    (Some(v), _) if !v.is_empty() => out.push_str(v),
                    (_, Some(fb)) => out.push_str(fb),
                    _ => return None,
                }
                i = start + close + 1;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    Some(out)
}

fn translate_mcp_server(
    name: &str,
    server: &Value,
    env: &HashMap<String, String>,
) -> Option<Value> {
    let server_type = server.get("type").and_then(|v| v.as_str()).unwrap_or("stdio");
    match server_type {
        "stdio" => {
            let command = server.get("command")?.as_str()?;
            let command = expand_env_var(command, env)?;
            let args: Vec<String> = server
                .get("args")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.as_str().and_then(|s| expand_env_var(s, env)))
                        .collect()
                })
                .unwrap_or_default();
            let env_pairs: Vec<Value> = server
                .get("env")
                .and_then(|v| v.as_object())
                .map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| {
                            let val = v.as_str().and_then(|s| expand_env_var(s, env))?;
                            Some(json!({"name": k, "value": val}))
                        })
                        .collect()
                })
                .unwrap_or_default();
            Some(json!({
                "name": name,
                "type": "stdio",
                "command": command,
                "args": args,
                "env": env_pairs
            }))
        }
        "http" | "sse" => {
            let url = server.get("url")?.as_str()?;
            let url = expand_env_var(url, env)?;
            let headers: Vec<Value> = server
                .get("headers")
                .and_then(|v| v.as_object())
                .map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| {
                            let val = v.as_str().and_then(|s| expand_env_var(s, env))?;
                            Some(json!({"name": k, "value": val}))
                        })
                        .collect()
                })
                .unwrap_or_default();
            Some(json!({
                "name": name,
                "type": server_type,
                "url": url,
                "headers": headers
            }))
        }
        _ => None,
    }
}

#[tauri::command]
pub async fn load_project_mcp_servers(cwd: String) -> Result<Vec<Value>, String> {
    let path = Path::new(&cwd).join(".mcp.json");
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Ok(vec![]),
    };
    let parsed: Value = serde_json::from_str(&content).map_err(|e| {
        format!(".mcp.json parse error: {e}")
    })?;
    let servers = match parsed.get("mcpServers").and_then(|v| v.as_object()) {
        Some(s) => s,
        None => return Ok(vec![]),
    };
    let env = cached_login_env().clone();
    let mut result = Vec::new();
    for (name, server) in servers {
        if let Some(desc) = translate_mcp_server(name, server, &env) {
            result.push(desc);
        }
    }
    Ok(result)
}
