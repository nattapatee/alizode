# Plan: Convert alizode-mcp from stdio to HTTP MCP Server

## Why

ACP `session/new` only accepts MCP server types: `http`, `sse`, `acp`. Our stdio binary can't be injected into agent sessions. Krypton solved this by embedding an HTTP MCP server in the Tauri app — we copy that pattern.

## Architecture (Krypton pattern)

```
Tauri App (main process)
  HTTP MCP Server (axum, 127.0.0.1:{random_port})
    POST /mcp/lane/:lane_id
      initialize -> protocol handshake
      tools/list -> tool definitions
      tools/call -> execute tool
        memory_get, memory_set, memory_list
        peer_send, peer_list, peer_reply
        review_request, review_reply

  ACP spawn -> session/new
    mcpServers: [{ type: "http", url: "http://127.0.0.1:{port}/mcp/lane/{lane_id}" }]

  SQLite DB (shared state, same as now)
```

Each lane gets a unique HTTP URL. No separate binary. No .mcp.json. No global config hack.

## Files to Create/Modify

### 1. NEW: src-tauri/src/harness_mcp.rs (~350 lines)

HTTP MCP server using axum. Copied from Krypton hook_server.rs pattern but simplified (no hook events, no persistence file — we use SQLite).

### 2. MODIFY: src-tauri/Cargo.toml

Add axum dep and tokio "net" feature.

### 3. MODIFY: src-tauri/src/lib.rs

Add mod harness_mcp, create Arc, managed state, start server in setup.

### 4. MODIFY: src-tauri/src/core/acp.rs

Remove stdio filter hack from acp_session_new and acp_session_restore.

### 5. MODIFY: src/hooks/useWorkspace.ts

Replace mcp_bridge_descriptor + load_project_mcp_servers with HTTP URL builder.

### 6. MODIFY: src-tauri/src/commands/workspace.rs

Remove mcp_bridge_descriptor, load_project_mcp_servers, translate_mcp_server, expand_env_var.

### 7. CLEANUP

Remove alizode-mcp from ~/.claude.json global config. Keep mcp_bridge.rs binary for standalone use.

## Tool Mapping (stdio binary to HTTP handler)

| Stdio Tool | HTTP Handler | Notes |
|---|---|---|
| alizode_bash | DROP | agents have own bash via ACP |
| alizode_write | DROP | agents have own file write via ACP |
| alizode_edit | DROP | agents have own file edit via ACP |
| memory_get | memory_get | SQLite memory table |
| memory_set | memory_set | SQLite memory table |
| memory_list | memory_list | SQLite memory table |
| peer_send | peer_send | Tauri event to frontend to target lane |
| peer_list | peer_list | Tauri event to frontend to lane registry |
| peer_reply | peer_reply | Tauri event to frontend to source lane |
| review_request | review_request | Tauri event to frontend to target lane |
| review_reply | review_reply | Tauri event to frontend to source lane |

## Build Order

1. Add axum dep to Cargo.toml
2. Create harness_mcp.rs with HTTP server + tool handlers
3. Wire into lib.rs (managed state + startup)
4. Add harness_mcp_port Tauri command
5. Update useWorkspace.ts to use HTTP MCP descriptor
6. Remove stdio filter from acp.rs
7. Clean up workspace.rs (remove dead code)
8. Test: start app, create Claude lane, verify tools visible, peer_send to Codex
