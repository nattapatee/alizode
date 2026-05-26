use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub cwd: String,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateWorkspace {
    pub name: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lane {
    pub id: String,
    pub workspace_id: String,
    pub agent_kind: String,
    pub protocol: String,
    pub model: String,
    pub is_main: bool,
    pub status: String,
    pub cwd: String,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateLane {
    pub workspace_id: String,
    pub agent_kind: String,
    pub model: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneEvent {
    pub workspace_id: String,
    pub lane_id: String,
    pub seq: u64,
    pub ts: i64,
    pub kind: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub workspace_id: String,
    pub namespace: String,
    pub key: String,
    pub value: serde_json::Value,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerMessage {
    pub id: String,
    pub workspace_id: String,
    pub from_lane: String,
    pub to_lane: String,
    pub request: String,
    pub reply: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub replied_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    pub id: String,
    pub workspace_id: String,
    pub lane_id: String,
    pub tool: String,
    pub detail: String,
    pub status: String,
    pub decision: Option<String>,
    pub created_at: i64,
    pub decided_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewRequest {
    pub id: String,
    pub workspace_id: String,
    pub from_lane: String,
    pub to_lane: String,
    pub file_path: String,
    pub diff: String,
    pub instructions: String,
    pub verdict: Option<String>,
    pub comments: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub replied_at: Option<i64>,
}
