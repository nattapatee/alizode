use crate::AppState;
use crate::permission::engine::PermissionDecision;
use tauri::State;

#[tauri::command]
pub async fn permission_decide(
    state: State<'_, AppState>,
    call_id: String,
    lane_id: String,
    tool: String,
    decision: String,
) -> Result<(), String> {
    let perm_decision = match decision.as_str() {
        "allow_once" => PermissionDecision::AllowOnce,
        "allow_session" => PermissionDecision::AllowSession,
        "deny" => PermissionDecision::Deny,
        _ => return Err(format!("unknown decision: {}", decision)),
    };

    {
        let mut engine = state.permissions.lock().await;
        engine.record_decision(&lane_id, &tool, perm_decision);
    }

    {
        let db = state.db.lock().await;
        db.decide_permission_request(&call_id, &decision)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn permission_clear_cache(
    state: State<'_, AppState>,
    lane_id: String,
) -> Result<(), String> {
    let mut engine = state.permissions.lock().await;
    engine.clear_lane_cache(&lane_id);
    Ok(())
}
