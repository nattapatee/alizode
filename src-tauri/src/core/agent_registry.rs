use serde::{Deserialize, Serialize};
use std::process::Command;

use super::acp::cached_login_env;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentKind {
    Claude,
    Codex,
    Gemini,
    OpenCode,
    Cursor,
    Custom,
}

impl AgentKind {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "claude" => Self::Claude,
            "codex" => Self::Codex,
            "gemini" => Self::Gemini,
            "opencode" => Self::OpenCode,
            "cursor" => Self::Cursor,
            _ => Self::Custom,
        }
    }

    pub fn id(&self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::OpenCode => "opencode",
            Self::Cursor => "cursor",
            Self::Custom => "custom",
        }
    }

    pub fn binary_name(&self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "antigravity",
            Self::OpenCode => "opencode",
            Self::Cursor => "cursor",
            Self::Custom => "echo",
        }
    }

    pub fn default_model(&self) -> &'static str {
        match self {
            Self::Claude => "sonnet",
            Self::Codex => "codex-mini",
            Self::Gemini => "gemini-2.5-pro",
            Self::OpenCode => "sonnet",
            Self::Cursor => "cursor",
            Self::Custom => "default",
        }
    }

    pub fn supports_mcp_config_file(&self) -> bool {
        matches!(self, Self::Claude)
    }

    pub fn supports_mcp_cli_register(&self) -> bool {
        matches!(self, Self::Codex)
    }

    pub fn protocol(&self) -> &'static str {
        match self {
            Self::Claude | Self::Codex | Self::Gemini | Self::OpenCode => "NativeAcp",
            Self::Cursor | Self::Custom => "ZedAcpWrapped",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentInfo {
    pub kind: String,
    pub binary: String,
    pub available: bool,
    pub protocol: String,
    pub default_model: String,
}

pub fn detect_agents() -> Vec<AgentInfo> {
    let kinds = [
        AgentKind::Claude,
        AgentKind::Codex,
        AgentKind::Gemini,
        AgentKind::OpenCode,
        AgentKind::Cursor,
    ];

    kinds.iter().map(|kind| {
        let binary = kind.binary_name();
        let available = is_on_path(binary);
        AgentInfo {
            kind: kind.id().to_string(),
            binary: binary.to_string(),
            available,
            protocol: kind.protocol().to_string(),
            default_model: kind.default_model().to_string(),
        }
    }).collect()
}

fn is_on_path(binary: &str) -> bool {
    Command::new("/usr/bin/which")
        .arg(binary)
        .envs(cached_login_env().iter())
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
