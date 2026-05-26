use crate::AppState;
use crate::store::models::MemoryEntry;
use tauri::State;

#[tauri::command]
pub async fn memory_get(
    state: State<'_, AppState>,
    workspace_id: String,
    namespace: String,
    key: String,
) -> Result<Option<MemoryEntry>, String> {
    let db = state.db.lock().await;
    db.memory_get(&workspace_id, &namespace, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn memory_set(
    state: State<'_, AppState>,
    workspace_id: String,
    namespace: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.memory_set(&workspace_id, &namespace, &key, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn memory_list(
    state: State<'_, AppState>,
    workspace_id: String,
    namespace: String,
) -> Result<Vec<MemoryEntry>, String> {
    let db = state.db.lock().await;
    db.memory_list(&workspace_id, &namespace)
        .map_err(|e| e.to_string())
}
