use crate::core::agent_registry::{detect_agents, AgentInfo};

#[tauri::command]
pub fn agent_list() -> Vec<AgentInfo> {
    detect_agents()
}
