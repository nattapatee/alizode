use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCategory {
    InApp,
    ReadOnly,
    Mutating,
    Shell,
    Network,
    Unknown,
}

impl ToolCategory {
    pub fn auto_allow(&self) -> bool {
        matches!(self, Self::InApp | Self::ReadOnly)
    }
}

pub fn classify(tool_name: &str) -> ToolCategory {
    let name = tool_name.to_lowercase();
    match name.as_str() {
        "peer_send" | "peer_list" | "memory_get" | "memory_set" | "memory_list"
        | "review_request" | "review_reply" => ToolCategory::InApp,

        "read_file" | "read" | "glob" | "grep" | "list_files" | "search"
        | "list_directory" | "get_file" => ToolCategory::ReadOnly,

        "write_file" | "edit_file" | "write" | "edit" | "apply_patch" | "delete_file"
        | "create_file" | "rename_file" | "move_file" => ToolCategory::Mutating,

        "bash" | "run_command" | "execute" | "shell" | "terminal" | "subprocess" => {
            ToolCategory::Shell
        }

        "fetch" | "http_request" | "curl" | "web_request" | "download" | "upload" => {
            ToolCategory::Network
        }

        _ => ToolCategory::Unknown,
    }
}
