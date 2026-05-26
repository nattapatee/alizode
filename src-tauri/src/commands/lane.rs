use crate::AppState;
use crate::store::models::{CreateLane, Lane, LaneEvent};
use tauri::State;

#[tauri::command]
pub async fn lane_list(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<Lane>, String> {
    let db = state.db.lock().await;
    db.list_lanes(&workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lane_create(
    state: State<'_, AppState>,
    workspace_id: String,
    agent_kind: String,
    model: String,
    cwd: String,
) -> Result<Lane, String> {
    let db = state.db.lock().await;
    let input = CreateLane {
        workspace_id,
        agent_kind,
        model,
        cwd,
    };
    db.create_lane(&input).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lane_send_user(
    state: State<'_, AppState>,
    lane_id: String,
    text: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    let lane = db
        .get_lane(&lane_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "lane not found".to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let payload = serde_json::json!({ "text": text });
    db.insert_lane_event(
        &lane.workspace_id,
        &lane_id,
        ts,
        "UserIn",
        &serde_json::to_string(&payload).unwrap_or_default(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lane_delete(
    state: State<'_, AppState>,
    workspace_id: String,
    lane_id: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.delete_lane(&workspace_id, &lane_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lane_stop(
    state: State<'_, AppState>,
    workspace_id: String,
    lane_id: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.update_lane_status(&workspace_id, &lane_id, "Stopped")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lane_set_main(
    state: State<'_, AppState>,
    workspace_id: String,
    lane_id: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.set_lane_main(&workspace_id, &lane_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lane_update_model(
    state: State<'_, AppState>,
    workspace_id: String,
    lane_id: String,
    model: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.update_lane_model(&workspace_id, &lane_id, &model)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lane_events(
    state: State<'_, AppState>,
    workspace_id: String,
    lane_id: String,
) -> Result<Vec<LaneEvent>, String> {
    let db = state.db.lock().await;
    db.list_lane_events(&workspace_id, &lane_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lane_export_session(
    state: State<'_, AppState>,
    workspace_id: String,
    lane_id: String,
) -> Result<String, String> {
    let db = state.db.lock().await;
    let events = db
        .list_lane_events(&workspace_id, &lane_id)
        .map_err(|e| e.to_string())?;
    let mut lines = Vec::with_capacity(events.len());
    for event in &events {
        let line = serde_json::json!({
            "seq": event.seq,
            "ts": event.ts,
            "kind": event.kind,
            "payload": event.payload,
        });
        lines.push(serde_json::to_string(&line).unwrap_or_default());
    }
    Ok(lines.join("\n"))
}
