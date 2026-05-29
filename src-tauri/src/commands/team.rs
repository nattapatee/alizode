use crate::AppState;
use crate::store::models::{
    CreateTeamInput, CreateTeamMemberInput, CreateTeamResult, Team, TeamPreset,
    TeamPresetWithMembers,
};
use tauri::State;

#[tauri::command]
pub async fn team_create(
    state: State<'_, AppState>,
    input: CreateTeamInput,
) -> Result<CreateTeamResult, String> {
    let db = state.db.lock().await;
    db.create_team(&input).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn team_list(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<Team>, String> {
    let db = state.db.lock().await;
    db.list_teams(&workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn team_delete(
    state: State<'_, AppState>,
    team_id: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.delete_team(&team_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn team_presets_list(
    state: State<'_, AppState>,
) -> Result<Vec<TeamPresetWithMembers>, String> {
    let db = state.db.lock().await;
    db.list_team_presets().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn team_preset_save(
    state: State<'_, AppState>,
    name: String,
    members: Vec<CreateTeamMemberInput>,
) -> Result<TeamPreset, String> {
    let db = state.db.lock().await;
    db.save_team_preset(&name, &members).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn team_preset_delete(
    state: State<'_, AppState>,
    preset_id: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.delete_team_preset(&preset_id).map_err(|e| e.to_string())
}
