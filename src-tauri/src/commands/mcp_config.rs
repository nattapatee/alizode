use std::path::PathBuf;

#[tauri::command]
pub async fn read_mcp_config_file(path: String) -> Result<Option<String>, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&p)
        .map(Some)
        .map_err(|e| format!("failed to read {path}: {e}"))
}
