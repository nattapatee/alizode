# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Alizode

Multi-agent AI coding harness — a Tauri 2.x desktop app (Rust backend + React 19 frontend) that orchestrates multiple AI coding agents (Claude, Codex, Gemini, OpenCode, Cursor, Custom) in parallel "lanes" within workspaces. Inspired by [Krypton](https://github.com/wk-j/krypton), an Electron-based ACP harness. Agents can communicate via peer messaging, share memory, request code reviews, and have their tool usage gated by a permission system. Runtime config options (model, effort, mode) can be changed per-lane via slash commands.

## Build & Dev Commands

```bash
# Full Tauri dev (starts Vite + Rust, hot-reloads both)
pnpm tauri dev

# Frontend only
pnpm dev              # Vite dev server at localhost:1420
pnpm build            # tsc + vite build
pnpm typecheck        # tsc --noEmit

# Frontend tests
pnpm test             # vitest run
pnpm test:watch       # vitest watch

# Rust backend (run from src-tauri/)
cargo check           # fast compile check
cargo test            # unit tests
cargo clippy -- -D warnings
cargo fmt             # format
```

CI runs: `pnpm typecheck` + `pnpm test` (frontend), `cargo check` + `cargo test` + `cargo clippy -D warnings` (backend).

## Architecture

### Two-process model

1. **Tauri app** (`src-tauri/src/main.rs` -> `lib.rs`): Manages state (`AppState`), SQLite DB, ACP registry, permission engine. Exposes Tauri commands to the frontend.
2. **MCP bridge** (`src-tauri/src/bin/mcp_bridge.rs`): Separate binary spawned per-lane as an MCP server for the agent. Provides custom tools (`alizode_bash`, `alizode_write`, `alizode_edit`, `peer_send`, `peer_reply`, `memory_get`, `memory_set`, `request_review`). Communicates with the Tauri app via shared SQLite DB (WAL mode).

### ACP-based agent spawning (persistent subprocess)

Agents spawn via ACP (Agent Client Protocol) JSON-RPC over stdio. Each lane gets a persistent ACP subprocess managed by `AcpClient` in `src/lib/acp-client.ts` (frontend) and `AcpRegistry` in `core/acp.rs` (Rust). Lifecycle: `acp_spawn` → `acp_initialize` → `acp_session_new` → `acp_prompt` per turn.

**Supported backends** (configured in `core/acp.rs::default_backends()`):

| Backend | Command |
|---------|---------|
| Claude | `npx -y @agentclientprotocol/claude-agent-acp` |
| Codex | `npx -y @agentclientprotocol/codex-acp` |
| Gemini | `gemini --experimental-acp` |
| OpenCode | `opencode acp` |
| Pi | `pi-acp` |
| Droid | `droid exec --acp` |

**Runtime config options**: Backends that support `session/set_config_option` (e.g., Claude) expose config options (model, effort, mode) from `session/new`. These are stored on `AcpClient.configOptions` and changed via `AcpClient.setConfigOption()` → Tauri `acp_set_config_option` command → JSON-RPC `session/set_config_option`. Frontend slash commands `/model`, `/effort`, `/mode` open the `ConfigPicker` with the relevant option.

**macOS GUI PATH fix**: `cached_login_env()` in `acp.rs` spawns `$SHELL -l -c '/usr/bin/env -0'` once via `OnceLock` to capture the full login shell environment. All ACP subprocesses inherit this env. Binary lookup uses `/usr/bin/env` wrapper to resolve shebangs. Tilde `~` in cwd is expanded to `$HOME` before use.

### Permission flow (ACP-mediated)

ACP `permission_request` event → frontend `PermissionModal` renders → user decides → `acp_permission_response` sends decision back to ACP subprocess → tool executes or denies. FS write operations show old/new diff in `FsWriteModal`.

### Event system

ACP events stream through `AcpClient.onEvent()` in the frontend. Events are stored in a **module-level Map** (`allEvents`) keyed by composite `workspaceId:laneId` — each lane permanently owns its transcript (Krypton pattern). No swap-on-switch. DB hydration from `lane_events` table fills empty lanes on first view. Event kinds: `UserIn`, `AgentText`, `Thought`, `ToolCall`, `ToolResult`, `PermPrompt`, `Sys`, `Error`.

### Rust module layout

- `core/acp.rs` -- ACP registry, client lifecycle, JSON-RPC spawn/initialize/prompt/cancel/dispose
- `core/inter_lane.rs` -- inter-lane coordinator for peer messaging and status machine
- `core/lane_bus.rs` -- in-memory pub/sub for lane events
- `core/lane_inbox.rs` -- per-lane message inbox
- `store/db.rs` -- SQLite via rusqlite, all DB operations
- `store/models.rs` -- Rust structs matching DB tables
- `permission/` -- engine, categories, session cache for tool permission evaluation
- `commands/` -- Tauri IPC commands (workspace, lane, agent, memory, permission, inter_lane)

### Frontend

React 19 + Tailwind + Vite. Single-page app with workspace tabs (double-click to rename), lane list sidebar, lane chat view, agent stage portal, and built-in code editor.

**Character registry** (`src/lib/characters.ts`): Defines agent personas with `name`, `model`, `accent` color, `portrait` (PNG), `video` (MP4), `chibi` (PNG), and personality text. `CHAR_BY_ID` lookup, `SELECTABLE` filters out library-only and IDE-only characters. Video portraits play in Stage panel with speed: idle 0.7x, thinking 1.2x, talking 2x.

Key hooks:
- `useWorkspace` — workspace/lane CRUD, ACP client management (`getOrSpawnClient`), workspace rename
- `useLaneStream` — per-lane event Map with epoch guards, DB hydration, stale-handler prevention

Key components:
- `WorkspaceTabs` — workspace tab bar with inline rename (double-click)
- `LaneList` — lane sidebar with create/delete
- `LaneView` / `EventRow` / `AgentTextBlock` — chat view with processing/transmitting status indicators
- `CommandBar` — input with `/commands` and `@lane` mention routing
- `Stage` — right-side agent portal with animated MP4 video portraits (playback speed varies by status)
- `AgentPicker` — character selection grid with video preview on hover
- `EditorView` — CodeMirror 6 code editor with Atom One Dark theme, file tree sidebar, undo/redo
- `PermissionModal` / `FsWriteModal` — ACP permission UI
- `SessionPicker` / `ModelPicker` — session management and model selection
- `ConfigPicker` — generic ACP config option picker (model, effort, mode) powered by `session/set_config_option`

### SQLite schema (7 tables)

`workspaces`, `lanes`, `lane_events`, `memory`, `peer_messages`, `review_requests`, `permission_requests`. Migrations in `src-tauri/migrations/001_init.sql`.

## Reference Project: Krypton

Alizode's architecture is informed by `/Users/tee/src/krypton`, an Electron-based ACP harness. See `IMPROVEMENT_PLAN.md` for the phased adoption roadmap.

### Key Krypton files to study

| Pattern | Krypton path |
|---------|-------------|
| Transcript types | `src/renderer/acp/types.ts` |
| ACP client (JSON-RPC, persistent subprocess) | `src/renderer/acp/client.ts` |
| Harness view (4200-line monolith — study patterns, don't copy structure) | `src/renderer/acp/acp-harness-view.ts` |
| Inter-lane coordinator | `src/renderer/acp/inter-lane.ts` |
| Rust ACP spawn/session | `crates/acp/src/acp.rs` |
| JSONL session persistence | `src/renderer/acp/session.ts` |
| Mention parsing + fan-out | `src/renderer/acp/mention-parse.ts` |

### Patterns adopted from Krypton

- ✅ **Persistent subprocess**: `acp_spawn()` once, then `acp_prompt()` per turn
- ✅ **Epoch tracking**: `epochRef` counter prevents stale event handlers after lane switch
- ✅ **Per-lane transcript ownership**: module-level `allEvents` Map, no swap-on-switch
- ✅ **LaneInbox/LaneBus**: in-memory channels for inter-lane messaging
- ✅ **FS write review**: `FsWriteModal` shows old/new diff in permission modal
- ✅ **Mention fan-out**: `@lane-id` in composer routes message to target lane
- ✅ **cached_login_env()**: captures login shell env for macOS GUI PATH resolution

### Patterns still to adopt

- **Streaming markdown** (Spec 117): `streaming-markdown` npm package, per-lane parser, `appendStreaming()`/`sealStreaming()`
- **Tail-window rendering** (Spec 103): render last 60 rows, cap 300 total per lane
- **Lane status machine**: `starting | idle | busy | needs_permission | awaiting_peer | error | stopped`

### What NOT to copy

- 4200-line monolith view — Alizode's React component split is better
- xterm.js rendering — structured React components are more flexible
- SHA-256 project hash for memory files — SQLite per-workspace is cleaner

## Key Conventions

- **Workspace-scoped**: All data is scoped by `workspace_id`. Events, lanes, memory, peer messages all require workspace context.
- **Lane IDs**: Auto-generated as `{agent_kind}-{n}` (e.g., `claude-1`). First lane per workspace auto-promoted to `is_main`.
- **DB as IPC**: The MCP bridge (separate process) and Tauri app share state via SQLite WAL-mode DB. No direct process communication.
- **Tokio Mutex**: All shared state (`db`, `processes`, `permissions`) wrapped in `Arc<tokio::sync::Mutex<T>>` -- use `try_lock()` in poll loops to avoid starvation.
