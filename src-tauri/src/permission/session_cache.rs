use std::collections::HashMap;

use super::engine::PermissionDecision;

pub struct SessionCache {
    entries: HashMap<(String, String), PermissionDecision>,
}

impl SessionCache {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    pub fn get(&self, lane_id: &str, tool: &str) -> Option<PermissionDecision> {
        self.entries
            .get(&(lane_id.to_string(), tool.to_string()))
            .copied()
    }

    pub fn set(&mut self, lane_id: &str, tool: &str, decision: PermissionDecision) {
        self.entries
            .insert((lane_id.to_string(), tool.to_string()), decision);
    }

    pub fn clear_lane(&mut self, lane_id: &str) {
        self.entries.retain(|k, _| k.0 != lane_id);
    }

    pub fn clear_all(&mut self) {
        self.entries.clear();
    }
}
