# Alizode — Multi-Agent ACP Harness (Desktop)

> Tauri + xterm.js desktop application that orchestrates multiple AI coding agents
> (Claude Code, Codex, Cursor) via ACP, with a custom in-process MCP server enabling
> inter-agent peer messaging, shared memory, and review workflows.

---

## 1. Vision

A terminal-styled cockpit where one **main agent** chats with the user, and any
number of **side agents** sit in their own tabs. The main agent can delegate
tasks (e.g. "review this code with Codex") via a `peer_send` MCP tool; the user
can switch to any side tab to spectate the live conversation, and replies route
back into the main thread automatically.

### Core Capabilities (v1)

- Multiple agent lanes per workspace (Claude, Codex, Cursor, ...).
- Native ACP transport where the agent supports it; **Zed ACP** spec as fallback wrapper.
- Custom MCP server (Rust, in-process Tauri sidecar) exposing:
  - `peer_send(target, message) -> reply` (synchronous, wait for reply)
  - `peer_list()` — enumerate active lanes
  - `memory_get / memory_set / memory_list` — per-workspace SQLite-backed
  - `review_request / review_reply` — structured code review handoff
- Built-in permission policy: in-app MCP tools (peer/memory/review) auto-allow; external/risky tools (bash, write_file, network) always popup.
- Tabs = workspaces (cwd + agent set). Switching tabs keeps every agent **alive in the background**.
- Manual session start/resume per agent (button + slash command).
- **macOS first.** Windows/Linux in phase 2.

### Out of Scope (v1)

- Real PTY rendering for agents (v1 renders structured ACP JSON as styled THOUGHT/AGENT/TOOL blocks). PTY mode = v2.
- Cloud sync, multi-user collaboration, account system.
- Auto-resume on launch (state starts blank; user resumes explicitly).
- Model dropdown per lane (model set at lane creation, not switched live).

---

## 2. Reference UX (from screenshot)

```
+----------------------------------------------------------------+
| ~/p/tli-api-service   [01] [02] [03 acp harness] [04]          |  workspace tabs
+-------+--------------------------------------------------------+
|       | Cursor-1  IDLE  [mcp 1] [perms unverified]  8.0%/1.5G  |  lane header
| L     | cursor · sess 5e71c0da · tli-api-service · 1 tool      |
| A     | SYS  starting Cursor-1 ...                             |
| N     | SYS  connected to Cursor-1.                            |
| E     | ← Claude-1   Hello from Claude-1 👋                    |  peer-in
| S     | THOUGHT  The user is forwarding an inter-lane message  |  agent thought
|       | AGENT    Replying to Claude-1's greeting via peer ...  |
| Claude-1 | TOOL  ✓ MCP: TOOL                          100ms    |  tool call
| Codex-1  | PERM  peer_send  krypton-harness-memory   AUTO-ALLOW|  perm line
| Cursor-1 | Claude-1 →  Hello Claude-1 — Auto here on ...       |  peer-out
+-------+--------------------------------------------------------+
| MEMORY: 5/5 ~/Project/tli-api-service on wk-j                  |  status bar
| Cursor-1 :                                                ?HELP|
+----------------------------------------------------------------+
```

Visual language: monospace, neon palette, low-chrome, terminal feel. Each lane = scrollback of structured event records (not a raw PTY in v1).

---

## 3. Architecture

```
+--------------------------- Tauri App (alizode) ----------------------------+
|                                                                            |
|  +----------------------- WebView (xterm.js + React) -------------------+  |
|  |  WorkspaceTabs  LaneList  LaneView (scrollback)  StatusBar           |  |
|  |        |            |           |                                    |  |
|  |        +-- Tauri commands / event bridge --+                         |  |
|  +--------------------------------------+-----+-------------------------+  |
|                                         |                                  |
|  +----------------------- Rust Core (tauri::AppHandle) -----------------+  |
|  |   WorkspaceMgr  -->  LaneMgr  -->  AgentProcess (per lane)           |  |
|  |        |               |                |                            |  |
|  |        |               |                +-- ACP client (stdio JSON)  |  |
|  |        |               |                +-- stdin/stdout pipes       |  |
|  |        |               +--> McpServer (in-process, per workspace)    |  |
|  |        |                       - peer_send / peer_list               |  |
|  |        |                       - memory_get/set/list                 |  |
|  |        |                       - review_request / review_reply       |  |
|  |        +--> PermissionEngine  (static category table, session cache) |  |
|  |        +--> SqliteStore  (memory, event log, sessions)               |  |
|  +----------------------------------------------------------------------+  |
+----------------------------------------------------------------------------+
        |                                |                          |
        v                                v                          v
   `claude --acp`                  `codex --acp` *            `cursor-agent --acp` *
   (native ACP)                    (Zed-wrapped if absent)   (Zed-wrapped if absent)
```

\* If vendor exposes a native protocol use it directly, else spawn under a Zed ACP shim.

### 3.1 Layers

| Layer       | Stack                                            | Responsibility                              |
|-------------|--------------------------------------------------|---------------------------------------------|
| UI shell    | React + TS + Vite + Tailwind + xterm.js          | tabs, lanes, scrollback, input, animations  |
| IPC         | `@tauri-apps/api` invoke/event                   | UI ↔ core commands & event stream           |
| Core        | Rust (Tauri 2.x)                                 | lifecycle, supervision, routing             |
| ACP client  | Rust `serde_json` over child stdio               | speak ACP per lane                          |
| MCP server  | Rust `rmcp` (in-process, stdio per spawn)        | expose peer/memory/review tools to agents   |
| Storage     | `rusqlite` (per-workspace `.alizode/state.db`)   | memory, event log, sessions                 |
| Permissions | Rust (static category table)                     | classify tool, raise popups, session cache  |

### 3.2 Why this transport choice

For **best performance**, MCP server runs **in the Rust core** (Tauri sidecar). Each agent gets an MCP stdio connection over a piped channel. No Node process, no HTTP hop, no cross-language JSON re-encoding. Target: `peer_send` round-trip p50 < 2 ms.

---

## 4. Data Model

### 4.1 Domain entities

```
Workspace
  id: uuid
  name: string                # display label (e.g. "03 ACP HARNESS")
  cwd: path
  config_path: path           # ./.alizode/workspace.toml

Lane
  id: string                  # e.g. "Claude-1"
  workspace_id: uuid
  agent_kind: enum(Claude|Codex|Cursor|Custom)
  protocol: enum(NativeAcp|ZedAcpWrapped)
  binary_path: path
  model: string               # set at lane creation
  cwd: path
  status: enum(Idle|Running|Waiting|Error|Stopped)
  pid: optional<i32>
  is_main: bool               # one main lane per workspace

LaneEvent                     # rendered as scrollback rows
  lane_id
  seq: u64
  ts: datetime
  kind: enum(Sys|UserIn|AgentText|Thought|ToolCall|ToolResult|
             PeerIn|PeerOut|PermPrompt|PermDecision|Error)
  payload: json

MemoryEntry
  workspace_id
  namespace: string           # lane-id or "shared"
  key: string
  value: json
  updated_at

PeerMessage
  id: uuid
  workspace_id
  from_lane: string
  to_lane: string
  request: text
  reply: optional<text>
  status: enum(Pending|Delivered|Replied|TimedOut|Failed)
  created_at, replied_at
```

### 4.2 SQLite schema (sketch)

```sql
CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT, cwd TEXT, created_at INTEGER);

CREATE TABLE lanes (id TEXT, workspace_id TEXT, agent_kind TEXT,
  protocol TEXT, model TEXT, is_main INTEGER, PRIMARY KEY (id, workspace_id));

CREATE TABLE lane_events (workspace_id TEXT, lane_id TEXT, seq INTEGER,
  ts INTEGER, kind TEXT, payload TEXT);
CREATE INDEX idx_lane_events_lookup ON lane_events(workspace_id, lane_id, seq);

CREATE TABLE memory (workspace_id TEXT, namespace TEXT, key TEXT,
  value TEXT, updated_at INTEGER, PRIMARY KEY(workspace_id, namespace, key));

CREATE TABLE peer_messages (id TEXT PRIMARY KEY, workspace_id TEXT,
  from_lane TEXT, to_lane TEXT, request TEXT, reply TEXT, status TEXT,
  created_at INTEGER, replied_at INTEGER);
```

Datetime/date format: stored as `INTEGER` unix epoch milliseconds (UTC); rendered in UI as ISO-8601 local-tz.

---

## 5. ACP Integration

### 5.1 Protocol selection

Per agent kind on lane creation:

1. Probe binary capabilities (e.g. `claude --acp --version`).
2. If native ACP-like protocol → use directly.
3. Else launch through a **Zed ACP shim** (Agent Client Protocol JSON-RPC over stdio) wrapping the vendor CLI.

### 5.2 ACP client trait (Rust sketch)

```rust
pub trait AcpClient: Send {
    fn send_user_text(&mut self, text: &str) -> anyhow::Result<()>;
    fn next_event(&mut self) -> anyhow::Result<AcpEvent>;
    fn cancel(&mut self) -> anyhow::Result<()>;
    fn shutdown(&mut self) -> anyhow::Result<()>;
}

pub enum AcpEvent {
    AgentText(String),
    Thought(String),
    ToolCall { name: String, input: serde_json::Value, call_id: String },
    ToolResult { call_id: String, output: serde_json::Value, ms: u64 },
    PermissionRequest { tool: String, reason: String, call_id: String },
    SessionStart { session_id: String },
    SessionEnd { reason: String },
    Error(String),
}
```

### 5.3 MCP advertised to the agent

When a lane spawns, alizode advertises one MCP server (`krypton-harness-memory`) over stdio rooted in the Rust core. Tool set: `peer_send`, `peer_list`, `memory_get`, `memory_set`, `memory_list`, `review_request`, `review_reply`. Schemas via `rmcp` declarative attrs.

---

## 6. Inter-Agent Workflow (spectatable delegation)

User sits in **main lane** (e.g. Claude-1). User says:

> "Review the code with Codex."

```
User ----> Claude-1 (input)
Claude-1            (thinking)
Claude-1 calls      peer_send(target="Codex-1", message="Please review src/auth.ts ...")
PermissionEngine    matches rule: peer_send within workspace -> AUTO-ALLOW
McpServer           routes to Codex-1 inbox; LaneEvent(PeerIn) appended on Codex-1.
                    Codex-1 tab now visibly active. User can switch and spectate.
Codex-1             reads / reviews; emits text + tool calls
Codex-1 returns     via review_reply or normal reply path
McpServer           returns reply to Claude-1's pending peer_send
Claude-1            renders "Here is Codex's review: ..." in main lane
```

Invariants:

- `peer_send` is **synchronous from the caller's perspective**: the MCP call does not return until peer publishes reply or timeout fires (default 5 min, configurable).
- Spectating is free: Codex-1's tab always shows live events. Switching tabs never pauses any lane.
- Replies persisted in `peer_messages` so user can scroll the delegated thread later.

### Sequence diagram

```
User       Claude-1            McpServer        Codex-1
 |  prompt   |                     |               |
 |---------->|                     |               |
 |           |  peer_send(Codex-1) |               |
 |           |-------------------->|               |
 |           |                     |  deliver req  |
 |           |                     |-------------->|
 |           |                     |               | think/tool/...
 |           |                     |   reply       |
 |           |                     |<--------------|
 |           |   reply returned    |               |
 |           |<--------------------|               |
 |  render   |                     |               |
 |<----------|                     |               |
```

---

## 7. Permission Model (Hardcoded Categories)

### 7.1 Policy

No user-editable rules file in v1. Permission decision is a function of the tool's **category**:

| Category    | Tools                                                          | Decision      |
|-------------|----------------------------------------------------------------|---------------|
| `in_app`    | `peer_send`, `peer_list`, `memory_*`, `review_request`, `review_reply` | **auto-allow** |
| `read_only` | agent's own filesystem read tools (read_file, glob, grep)      | auto-allow    |
| `mutating`  | `write_file`, `edit_file`, `apply_patch`, `delete_file`        | **prompt every call** |
| `shell`     | `bash`, `run_command`, `execute`                               | **prompt every call** |
| `network`   | `fetch`, `http_request`, anything that opens a socket          | **prompt every call** |
| `unknown`   | tool not classified in the table above                         | **prompt every call** |

Rationale: keep harness traffic friction-free, force user-in-the-loop for every side-effectful action. Simple, predictable, no config drift.

### 7.2 Evaluation

1. Tool call arrives at MCP server (in-app tools) or via ACP `PermissionRequest` (agent's own tools).
2. PermissionEngine looks up category in the static table.
3. `auto-allow` → run immediately, record `PermDecision(auto_allow)` event.
4. `prompt` → emit `PermissionRequest` to UI, block until user responds. Modal:
   ```
   Codex-1 wants to run  bash  with `git push`.
   [Allow once]  [Allow for session]  [Deny]
   ```
5. `Allow for session` caches the decision keyed by `(lane_id, tool, normalized_args_hash)` in-memory only; cleared on lane stop or app quit.

### 7.3 UI surface

Lane header badge reflects last decision:
- `auto-allow` (green dot) — last tool call was in-app and auto-allowed.
- `prompted` (amber dot) — at least one external tool call this session went through a prompt.
- `denied` (red dot) — user denied a tool call recently.

No config reload command needed (no config). v2 may add a rules.toml escape hatch if users demand it (tracked in Phase 8 backlog).

---

## 8. Tabs, Workspaces, Lifecycle

### 8.1 Tabs

Top bar holds **workspace** tabs (not lane tabs). Each workspace owns:
- a cwd
- a set of lanes (Claude-1, Codex-1, Cursor-1, ...)
- one **main lane** flag
- its own permissions + memory db

Switching tabs is UI focus only; all agents in all workspaces continue running. Status bar shows aggregate "alive lanes" count.

### 8.2 Lane lifecycle

```
        start              attach             cancel             shutdown
 [None] -------> [Booting] -------> [Idle] -------> [Idle]     [Stopped]
                                      | input            ^
                                      v                  |
                                  [Running]              |
                                      |                  |
                                      +------------------+
                                          (idle on reply)
```

Commands / buttons:

- `/start <agent-kind>` — create lane
- `/resume <lane-id>` — re-attach existing session (uses ACP session_id)
- `/stop <lane-id>` — graceful shutdown
- `/kill <lane-id>` — SIGKILL
- `/main <lane-id>` — promote to main
- `/peer <lane-id> <message>` — manual peer_send from user
- `/perm clear-cache` — drop session "allow for session" cache

### 8.3 State persistence

Launch starts **blank**. Lanes resumable manually via command/button. Sessions stored in SQLite (lane id, agent kind, session_id, last seq). A "Recent sessions" panel surfaces resume buttons.

---

## 9. UI / Frontend

### 9.1 Stack

- React 19, TypeScript, Vite
- Tailwind for layout, CSS variables for neon palette
- `xterm.js` powers lane scrollback **for rendering only** (we feed pre-formatted ANSI lines; no PTY in v1)
- `framer-motion` for tab transitions and event row enter animations

### 9.2 Components

```
src/
├── components/
│   ├── workspace-tabs/
│   ├── lane-list/
│   ├── lane-view/
│   │    ├── LaneView.tsx
│   │    ├── EventRow.tsx          # SYS, AGENT, THOUGHT, TOOL, PERM, PEER
│   │    ├── LaneHeader.tsx
│   │    └── PermissionBadge.tsx
│   ├── command-bar/
│   ├── permission-modal/
│   ├── peer-message-toast/        # top-right overlay (see screenshot)
│   └── status-bar/
├── hooks/
│   ├── useLaneStream.ts           # subscribe to Tauri events for one lane
│   ├── useWorkspace.ts
│   └── useKeyboardCommands.ts
├── lib/
│   ├── acp-events.ts              # types mirroring Rust enum
│   ├── ansi.ts                    # color tokens
│   └── format.ts                  # ms, bytes, percent
└── styles/
    ├── tokens.css
    ├── lanes.css
    └── global.css
```

### 9.3 Keyboard model

- `Cmd+T` new lane in current workspace
- `Cmd+Shift+T` new workspace
- `Cmd+[` / `Cmd+]` switch lanes
- `Cmd+1..9` switch workspace
- `Cmd+K` command palette
- `Esc` cancel current lane action

### 9.4 Rendering rules

- Compositor-friendly motion only (transform/opacity).
- No layout-bound animations.
- Reduced-motion respected.
- xterm.js scrollback capped at 5,000 lines per lane; older events stay on disk.

---

## 10. Tauri Core Modules

```
src-tauri/
├── src/
│   ├── main.rs                       # tauri::Builder, plugin wiring
│   ├── commands/                     # #[tauri::command] handlers
│   │   ├── workspace.rs
│   │   ├── lane.rs
│   │   ├── memory.rs
│   │   └── permission.rs
│   ├── core/
│   │   ├── workspace_mgr.rs
│   │   ├── lane_mgr.rs
│   │   ├── agent_process.rs          # spawn + supervise child
│   │   ├── acp/
│   │   │   ├── mod.rs
│   │   │   ├── native_claude.rs
│   │   │   ├── zed_shim.rs
│   │   │   └── events.rs
│   │   └── mcp_server.rs             # rmcp tools impl
│   ├── permission/
│   │   ├── engine.rs                 # classify + decide
│   │   ├── categories.rs             # static tool→category table
│   │   ├── session_cache.rs          # (lane_id, tool, args_hash) -> Decision
│   │   └── prompt.rs                 # send to UI, await reply
│   ├── store/
│   │   ├── db.rs                     # rusqlite
│   │   ├── memory.rs
│   │   ├── events.rs
│   │   └── peer.rs
│   └── util/
│       ├── error.rs
│       └── ids.rs
└── tauri.conf.json
```

Tauri commands exposed to UI:

```
workspace_list()                          -> [Workspace]
workspace_create(name, cwd)               -> Workspace
lane_list(workspace_id)                   -> [Lane]
lane_create(workspace_id, kind, model)    -> Lane
lane_send_user(lane_id, text)             -> ()
lane_cancel(lane_id)                      -> ()
lane_resume(lane_id, session_id)          -> Lane
lane_stop(lane_id)                        -> ()
lane_set_main(lane_id)                    -> ()
peer_send_manual(from_lane, to_lane, msg) -> peer_message_id
permission_decide(call_id, decision)      -> ()
permission_clear_session_cache(lane_id)   -> ()
memory_get / memory_set / memory_list     -> ...
```

Events emitted to UI:

```
lane://event            payload: LaneEvent
permission://prompt     payload: PermissionRequest
lane://status           payload: LaneStatusChange
peer://toast            payload: PeerToast       (top-right overlay)
```

---

## 11. Security & Sandboxing

- Child processes inherit a scrubbed env (allowlist of `PATH`, `HOME`, `LANG`, `TERM`, plus per-agent secrets from platform keychain).
- Working dir pinned to workspace cwd; agent cannot chdir outside unless user explicitly approves via the permission popup.
- MCP server validates all tool inputs against rmcp-generated schemas.
- Secrets (e.g. `ANTHROPIC_API_KEY`) stored in macOS Keychain via `keyring` crate; never in plain config.
- Renderer is CSP-locked; Tauri allowlist is minimum needed (shell.open denied, fs:write scoped to `.alizode/`).
- SQLite db per workspace under `.alizode/state.db`, file perms 0600.

---

## 12. Testing Strategy

- **Rust unit**: permission rule matching, MCP tool handlers, ACP event parser, peer router (deadlock + timeout).
- **Integration**: fake ACP agent binary (Rust test fixture) emitting scripted event sequence; assert lane state and DB writes.
- **Frontend unit**: vitest + react-testing-library for event row renderers and command parser.
- **E2E**: Playwright + Tauri WebDriver — golden flow: start workspace, spawn Claude lane, ask it to `peer_send` Codex, observe reply, validate badge + memory persistence.
- **Visual regression**: screenshot lane view at 1440x900.
- **Performance budget**: `peer_send` p50 < 2 ms; UI event append < 16 ms.

---

## 13. Performance Targets

| Metric                            | Target          |
|-----------------------------------|-----------------|
| App cold start                    | < 800 ms        |
| Lane spawn (binary warm)          | < 250 ms        |
| `peer_send` p50 / p99 in-app      | < 2 ms / < 10 ms|
| ACP event → UI render            | < 16 ms         |
| Memory query p50                  | < 0.5 ms        |
| Idle CPU (3 idle lanes)           | < 1%            |
| Idle RAM (3 idle lanes, app only) | < 250 MB        |

---

## 14. Roadmap

### Phase 0 — Scaffold (3–5 days)

- Tauri 2 + Vite + React + Tailwind skeleton
- Workspace + lane data model + SQLite migration runner
- Empty UI shell: tabs + lane list + status bar
- CI: lint, type-check, cargo build, vitest

### Phase 1 — One agent, one lane (1 week)

- Spawn `claude --acp`, attach stdio
- Native Claude ACP client, event stream → UI
- Manual user input → agent
- Lane scrollback with SYS/AGENT/THOUGHT/TOOL rows

### Phase 2 — MCP harness + memory (1 week)

- In-process MCP server with `memory_*` tools
- Per-workspace SQLite memory store
- Permissions engine v1: static category table + popup + session cache
- Permission badge in lane header (auto-allow / prompted / denied)

### Phase 3 — Multiple lanes + peer_send (1 week)

- Lane manager, multiple concurrent ACP clients
- `peer_send` / `peer_list` MCP tools
- Synchronous routing with timeout + retries
- Spectatable peer flow + top-right toast

### Phase 4 — Codex + Cursor adapters (1 week)

- Detect native protocol; otherwise Zed ACP shim
- Per-agent capability matrix
- Model selection at lane creation

### Phase 5 — Main agent + delegation UX (3–5 days)

- `is_main` flag, "main" badge in lane list
- `peer_send` calls from main lane render inline ("Codex-1 → ..."), Codex lane shows full reasoning trace
- `review_request` / `review_reply` higher-level tools

### Phase 6 — Polish + ship macOS (3–5 days)

- Code-signed, notarized `.dmg`
- Onboarding (detect installed agent binaries, prompt for missing)
- Quickstart docs

### Phase 7 — Windows + Linux (later)

- Windows: PTY via ConPTY for v2, MSI bundle, code signing
- Linux: AppImage + deb, Wayland xterm.js quirks

### Phase 8 — v2 stretch

- Real PTY rendering mode for full-fidelity agent UIs
- Cloud sync (encrypted backup)
- Multi-user shared workspace (CRDT event log)
- Recording + replay of agent sessions
- Optional `permissions.toml` escape hatch for power users (override category defaults)

---

## 15. Open Questions

1. **Workspace naming** — auto from cwd basename, or always user-named?
2. **Default main agent** — Claude, or last used per workspace?
3. **Peer timeout default** — 5 min ok? Should `peer_send` ever support async/fire-and-forget too?
4. **Bundled agents** — confirm v1 requires user to pre-install `claude`/`codex`/`cursor` binaries (auto-detect on PATH) rather than bundle?
5. **Telemetry** — local-only logs by default; opt-in remote crash reporting later?
6. **Theme** — single neon dark theme v1, or also a light theme at launch?

---

## 16. Glossary

- **ACP** — Agent Client Protocol; Zed's open spec for stdio/JSON-RPC chat between host and AI coding agent.
- **MCP** — Model Context Protocol; Anthropic's spec for exposing tools to an agent over a JSON-RPC channel.
- **Lane** — one running agent process inside a workspace tab.
- **Workspace** — one cwd + the set of lanes attached to it.
- **Main lane** — the lane the user types into; delegates to side lanes via `peer_send`.
- **Auto-allow** — harness skips the permission popup because the tool falls into a low-risk category (`in_app` or `read_only`). External / mutating / shell / network tools never auto-allow in v1.
