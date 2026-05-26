use serde::{Deserialize, Serialize};

use super::categories::{classify, ToolCategory};
use super::session_cache::SessionCache;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    AutoAllow,
    AllowOnce,
    AllowSession,
    Deny,
}

pub struct PermissionEngine {
    cache: SessionCache,
}

#[derive(Debug, Serialize, Clone)]
pub struct PermissionPrompt {
    pub call_id: String,
    pub lane_id: String,
    pub tool: String,
    pub category: ToolCategory,
    pub reason: String,
}

pub enum EvalResult {
    Allowed(PermissionDecision),
    NeedsPrompt(PermissionPrompt),
}

impl PermissionEngine {
    pub fn new() -> Self {
        Self {
            cache: SessionCache::new(),
        }
    }

    pub fn evaluate(&self, lane_id: &str, tool: &str, call_id: &str, reason: &str) -> EvalResult {
        let category = classify(tool);

        if category.auto_allow() {
            return EvalResult::Allowed(PermissionDecision::AutoAllow);
        }

        if let Some(cached) = self.cache.get(lane_id, tool) {
            if cached == PermissionDecision::AllowSession {
                return EvalResult::Allowed(cached);
            }
        }

        EvalResult::NeedsPrompt(PermissionPrompt {
            call_id: call_id.to_string(),
            lane_id: lane_id.to_string(),
            tool: tool.to_string(),
            category,
            reason: reason.to_string(),
        })
    }

    pub fn record_decision(
        &mut self,
        lane_id: &str,
        tool: &str,
        decision: PermissionDecision,
    ) {
        if decision == PermissionDecision::AllowSession {
            self.cache.set(lane_id, tool, decision);
        }
    }

    pub fn clear_lane_cache(&mut self, lane_id: &str) {
        self.cache.clear_lane(lane_id);
    }
}
