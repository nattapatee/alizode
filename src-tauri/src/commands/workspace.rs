use crate::AppState;
use crate::store::models::{Workspace, CreateWorkspace};
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

