# ACP Migration Design — Alizode → Krypton Architecture

> Replaces per-input CLI spawning and DB-mediated IPC with Krypton's
> persistent ACP subprocess model (JSON-RPC 2.0 over stdio).

---

## 1. Architectural Gap Summary

| Dimension | Alizode (current) | Krypton (target) |
|-----------|-------------------|-------------------|
| Claude spawn | `claude -p "text" --resume <id>` per message | `npx -y @agentclientprotocol/claude-agent-acp` persistent subprocess |
| Protocol | Raw `--stream-json` stdout parsing | JSON-RPC 2.0 newline-delimited over stdio |
| Agent lifecycle | Kill + respawn each turn | `initialize` → `session/new` → `session/prompt` (many) → `dispose` |
| Request correlation | None (one response per spawn) | `AtomicU64` counter + `HashMap<u64, oneshot::Sender<Value>>` |
| Permission flow | MCP bridge → DB insert → 300ms poll → UI modal → DB update → bridge poll | Inbound `session/request_permission` → oneshot channel → UI → reply |
| FS write approval | MCP bridge `alizode_write` tool | Inbound `fs/write_text_file` → diff preview → user accept/reject → reply |
| Inter-lane messaging | DB polling in `peer_delivery.rs` (300ms loop) | `LaneBus` + `LaneInbox` + `InterLaneCoordinator` (in-memory, event-driven) |
| Multi-agent | `AgentKind` enum with separate client impls | `AcpBackend` registry — all agents share same JSON-RPC protocol |
| Session management | `--resume <session_id>` CLI flag | `session/list`, `session/resume`, `session/load` JSON-RPC methods |
| Process cleanup | `child.kill()` | `process_group(0)` + SIGTERM to `-pid` (kills adapter + MCP grandchildren) |
| I/O model | `std::process` + blocking `BufReader` in threads | `tokio::process` + `AsyncBufReadExt` — fully async |

---

## 2. ACP Protocol Spec (JSON-RPC 2.0)

### 2.1 Message Classification

```
has id + has method → Inbound request (agent asks harness to do something)
has id + no method → Response (to our earlier request)
no id + has method → Notification (streaming updates)
```

### 2.2 Lifecycle Methods (harness → agent)

| Method | Type | Purpose |
|--------|------|---------|
| `initialize` | request | Handshake. Sends `protocolVersion`, `clientCapabilities`, `clientInfo`. Returns agent capabilities. |
| `session/new` | request | Create new session. Sends `cwd`, `mcpServers`. Returns `sessionId`. |
| `session/prompt` | request | Send user turn. Sends `sessionId`, `prompt` (ContentBlock[]). Returns `stopReason`. |
| `session/cancel` | notification | Cancel current turn. Sends `sessionId`. |
| `session/list` | request | List past sessions. Sends optional `cwd`, `cursor`. |
| `session/resume` | request | Resume a past session. Sends `sessionId`, `cwd`, `mcpServers`. |
| `session/load` | request | Read-only load (no continuation). Same params as resume. |

### 2.3 Inbound Requests (agent → harness)

| Method | Purpose |
|--------|---------|
| `fs/read_text_file` | Agent wants to read a file. Harness reads and returns content. |
| `fs/write_text_file` | Agent wants to write a file. Harness shows diff preview, waits for user approval. |
| `session/request_permission` | Agent needs permission for a tool. Harness shows modal, returns user decision. |

### 2.4 Notifications (agent → harness)

Method: `session/update`. Payload has `update.sessionUpdate` discriminator:

| sessionUpdate kind | Maps to |
|-------------------|---------|
| `agent_message_chunk` | Streaming agent text |
| `agent_thought_chunk` | Streaming thought/thinking |
| `tool_call` | Tool invocation start (name, status, content) |
| `tool_call_update` | Tool progress update (status change, partial output) |
| `plan` | Agent plan entries with priorities and statuses |
| `usage_update` | Token/cost metrics |
| `available_commands_update` | Slash commands the agent supports |
| `current_mode_update` | Agent mode changed |

### 2.5 Content Types

```typescript
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name?: string }

type StopReason = 'end_turn' | 'max_tokens' | 'cancelled' | 'refusal'

type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

type PermissionOption = {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}
```

---

## 3. Built-in ACP Backends

Matching Krypton's `builtin_backends()`:

| id | command | args | display_name |
|----|---------|------|-------------|
| `claude` | `npx` | `-y @agentclientprotocol/claude-agent-acp` | Claude |
| `gemini` | `gemini` | `--experimental-acp` | Gemini |
| `codex` | `codex-acp` | (none) | Codex |
| `opencode` | `opencode` | `acp` | OpenCode |
| `cursor` | `cursor-agent` | `acp` | Cursor |
| `droid` | `droid` | `exec --output-format acp` | Droid |
| `pi-acp` | `pi-acp` | (none) | Pi |

All backends speak the same JSON-RPC 2.0 protocol. No per-agent parsing code needed.

---

## 4. Rust Backend Design

### 4.1 New Module: `core/acp.rs`

Port of Krypton's `src-tauri/src/acp.rs`. Single file (~800 lines). Contains:

**`AcpBackend`** — command, args, display_name for each built-in agent.

**`AcpClient`** — one per lane:
```rust
struct AcpClient {
    session_id: u64,              // Harness-assigned session number
    backend_id: String,
    stdin: Mutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,     // Request correlation
    perm_pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    fs_write_pending: Mutex<HashMap<u64, FsWriteCtx>>,
    next_id: AtomicU64,
    agent_capabilities: RwLock<Option<Value>>,
    acp_session_id: RwLock<Option<String>>,
    stderr_buf: Mutex<String>,
    child: Mutex<Option<Child>>,
    child_pid: AtomicU32,
    cwd: RwLock<Option<String>>,
    mcp_servers: RwLock<Vec<Value>>,
    disposed: AtomicBool,
}
```

Key methods:
- `request(method, params) → Result<Value>` — send JSON-RPC request, await response via oneshot
- `notify(method, params) → Result<()>` — send JSON-RPC notification (no response)
- `reply(id, result) → Result<()>` — respond to inbound request from agent
- `write_line(value) → Result<()>` — serialize + newline + write to stdin

**`AcpRegistry`** — manages all live AcpClient sessions:
```rust
pub struct AcpRegistry {
    next_session: AtomicU64,
    clients: RwLock<HashMap<u64, Arc<AcpClient>>>,
}
```

**`run_reader()`** — async task reading stdout line-by-line:
```rust
async fn run_reader(client: Arc<AcpClient>, app: AppHandle, reader: BufReader<ChildStdout>) {
    // For each line: parse JSON, call dispatch_message()
}
```

**`dispatch_message()`** — JSON-RPC message router:
```rust
async fn dispatch_message(client: &Arc<AcpClient>, app: &AppHandle, value: Value) {
    let has_id = value.get("id").is_some();
    let has_method = value.get("method").is_some();

    if has_id && has_method {
        // Inbound request: fs/read, fs/write, permission
        handle_inbound_request(client, app, id, method, params).await;
    } else if has_id {
        // Response to our request: resolve pending oneshot
        pending.remove(&id).send(value);
    } else if has_method {
        // Notification: session/update → emit to frontend
        handle_notification(client, app, method, params);
    }
}
```

**`handle_inbound_request()`** — three handlers:
- `fs/read_text_file` → validate path scope → `std::fs::read_to_string` → reply
- `fs/write_text_file` → validate path → read old content → emit `fs_write_pending` event → park on oneshot → user decision → write or deny → reply
- `session/request_permission` → emit `permission_request` event → park on oneshot → user decision → reply

**`handle_notification()`** — forward `session/update` to frontend:
```rust
fn handle_notification(client, app, method, params) {
    if method == "session/update" {
        // Extract update kind, emit as Tauri event
        client.emit_event(app, json!({
            "type": "session_update",
            "kind": update_kind,
            "update": update,
        }));
    }
}
```

**Process group isolation:**
```rust
#[cfg(unix)]
cmd.process_group(0);  // Own process group

// On dispose:
unsafe { libc::kill(-(pid as i32), libc::SIGTERM); }
// 2s timeout, then SIGKILL
```

### 4.2 New Module: `core/lane_bus.rs`

Port of Krypton's `lane-bus.ts`. Typed event emitter for lane lifecycle:

```rust
pub enum LaneBusEvent {
    Status { lane_id: String, prev: LaneStatus, next: LaneStatus, at: i64 },
    Spawned { lane_id: String },
    Closed { lane_id: String, display_name: String },
}

pub struct LaneBus {
    handlers: RwLock<Vec<Box<dyn Fn(&LaneBusEvent) + Send + Sync>>>,
}
```

### 4.3 New Module: `core/lane_inbox.rs`

Port of Krypton's `lane-inbox.ts`. Per-lane FIFO queue:

```rust
pub struct LaneInbox {
    lane_id: String,
    queue: Vec<InterLaneEnvelope>,
}

impl LaneInbox {
    pub fn push(&mut self, env: InterLaneEnvelope) { ... }
    pub fn drain(&mut self) -> Vec<InterLaneEnvelope> { ... }
    pub fn depth(&self) -> usize { ... }
}
```

### 4.4 New Module: `core/inter_lane.rs`

Port of Krypton's `inter-lane.ts`. Envelope routing coordinator:

```rust
pub struct InterLaneCoordinator {
    bus: Arc<LaneBus>,
    host: Arc<dyn LaneHost>,
    inboxes: Mutex<HashMap<String, LaneInbox>>,
    pending: Mutex<HashMap<String, Vec<PendingSend>>>,
    cancelled_pairs: Mutex<HashSet<String>>,
}
```

Key methods:
- `deliver(env) → DeliveryResult` — push to inbox, drain if idle
- `deliver_mention_fan_out(requester, targets, body) → MentionFanOutResult`
- `on_lane_stop(lane_id) → Option<LaneStatus>` — returns `awaiting_peer` if pending
- `cancel_conversations_for(lane_id)` — tombstone + notify peers
- `on_lane_closed(lane_id, display_name)` — cleanup bookkeeping

### 4.5 Tauri Commands (new)

```rust
// ACP lifecycle
acp_list_backends() → Vec<AcpBackendDescriptor>
acp_spawn(backend_id, cwd, mcp_servers) → u64  // session number
acp_initialize(session) → AgentInitInfo
acp_set_mcp_servers(session, mcp_servers)
acp_session_new(session) → AgentSessionInfo
acp_prompt(session, blocks) → Value  // stopReason + usage
acp_cancel(session)
acp_dispose(session)

// Session management
acp_session_list(session, cwd, cursor) → Value
acp_session_resume(session, session_id) → AgentSessionInfo
acp_session_load(session, session_id) → AgentSessionInfo

// Permission + FS write responses (from frontend)
acp_permission_response(session, request_id, option_id)
acp_fs_write_response(session, request_id, accept)

// Metrics
acp_get_lane_metrics(registry) → Vec<AcpLaneMetrics>
```

---

## 5. Frontend Changes

### 5.1 New: `src/lib/acp-client.ts`

Port of Krypton's `src/acp/client.ts`. TypeScript class wrapping Tauri commands:

```typescript
class AcpClient {
  private session: number;

  static async spawn(backendId: string, cwd: string, mcpServers?): Promise<AcpClient>;
  async initialize(): Promise<AgentInfo>;
  async prompt(blocks: ContentBlock[]): Promise<StopReason>;
  async cancel(): Promise<void>;
  async dispose(): Promise<void>;
  async respondPermission(requestId: number, optionId: string | null): void;
  async respondFsWrite(requestId: number, accept: boolean): void;
  async listSessions(cwd: string): Promise<SessionListResult>;
  async resumeSession(sessionId: string): Promise<AgentSessionInfo>;
  onEvent(cb: (e: AcpEvent) => void): () => void;
}
```

### 5.2 New: `src/lib/acp-types.ts`

Port of Krypton's `src/acp/types.ts`. All ACP wire types:
- `ContentBlock`, `ToolCall`, `ToolCallUpdate`, `PlanEntry`
- `PermissionOption`, `StopReason`, `UsageInfo`
- `AcpEvent` discriminated union
- `AcpBackendDescriptor`, `AcpMcpServerDescriptor`
- `InterLaneEnvelope`, `LaneSummary`, `LaneBusEvent`

### 5.3 Updated: `src/hooks/useLaneStream.ts`

Replace `lane://event` listener with `acp-event-<session>` listener:
- Subscribe via `AcpClient.onEvent()`
- Map `AcpEvent` types to transcript items:
  - `message_chunk` → streaming markdown
  - `thought_chunk` → collapsible thought
  - `tool_call` / `tool_call_update` → tool card with status
  - `permission_request` → inline permission card
  - `fs_write_pending` → diff preview modal
  - `plan` → plan display
  - `usage` → metrics update
  - `stop` → turn complete

### 5.4 Updated: `src/hooks/useWorkspace.ts`

- `createLane` → `AcpClient.spawn(backendId, cwd, mcpServers)` + `initialize()` + `sessionNew()`
- `deleteLane` → `AcpClient.dispose()`
- Store `AcpClient` per lane (in ref or context)

### 5.5 Updated: Command flow

**Before** (per-input):
```
CommandBar → lane_send_user → AgentProcess.send_input()
  → spawn `claude -p` → parse stdout → emit lane://event → EventRow
```

**After** (persistent):
```
CommandBar → AcpClient.prompt([{type:'text', text}])
  → JSON-RPC session/prompt → adapter processes → session/update notifications
  → acp-event-<session> → AcpClient.onEvent → transcript items
  → prompt() resolves with stopReason
```

### 5.6 New: `src/components/diff-preview/DiffPreview.tsx`

For `fs_write_pending` events. Shows old vs new text with highlighted changes.
User clicks Accept or Reject → `AcpClient.respondFsWrite(requestId, accept)`.

### 5.7 Updated: `src/components/permission-modal/PermissionModal.tsx`

Now renders `PermissionOption[]` from ACP protocol instead of simple allow/deny.
Calls `AcpClient.respondPermission(requestId, optionId)`.

---

## 6. Inter-Lane Messaging Architecture

### 6.1 Current (DB polling — remove)

```
Lane A MCP tool peer_send → INSERT peer_messages → 300ms poll loop
→ deliver_pending() → Lane B process.send_input() → emit PeerIn event
```

### 6.2 Target (in-memory, event-driven — like Krypton)

```
Lane A prompt → agent calls peer_send MCP tool → LaneHost.deliver(envelope)
→ InterLaneCoordinator.deliver()
  → push to LaneInbox(B)
  → if B is idle: drain → composePrompt() → enqueueSystemPrompt(B)
  → if B is busy: stays in inbox, drained on next idle transition
→ LaneBus emits lane:status → coordinator.onBus() → drain if idle
```

### 6.3 LaneHost Interface

Bridge between coordinator and harness:
```rust
trait LaneHost: Send + Sync {
    fn list_lanes(&self) -> Vec<LaneSummary>;
    fn get_lane(&self, lane_id: &str) -> Option<LaneInfo>;
    fn set_lane_status(&self, lane_id: &str, next: LaneStatus);
    fn enqueue_system_prompt(&self, lane_id: &str, text: &str);
    fn append_inter_lane_row(&self, lane_id: &str, direction: Direction, ...);
    fn append_system_notice(&self, lane_id: &str, text: &str);
}
```

---

## 7. MCP Server Injection

### 7.1 Current (config file per lane — remove)

`write_mcp_config()` writes a JSON file pointing to `alizode-mcp` binary.
Claude CLI reads it via `--mcp-config` flag.

### 7.2 Target (protocol-level injection)

MCP servers passed in `session/new` params:
```json
{
  "method": "session/new",
  "params": {
    "cwd": "/path/to/project",
    "mcpServers": [
      {
        "name": "alizode",
        "type": "stdio",
        "command": "/path/to/alizode-mcp",
        "args": ["--workspace-id", "ws1", "--lane-id", "claude-1"],
        "env": []
      }
    ]
  }
}
```

The MCP bridge binary (`alizode-mcp`) stays — it still provides custom tools
(`peer_send`, `memory_get`, etc.). But instead of being configured via a JSON
file, it's injected directly through the ACP protocol.

---

## 8. Database Changes

### 8.1 Tables to keep (pure persistence)

- `workspaces` — unchanged
- `lanes` — add `backend_id TEXT`, `acp_session_id TEXT` columns
- `lane_events` — unchanged (still persist transcript)
- `memory` — unchanged
- `review_requests` — unchanged

### 8.2 Tables to deprecate (no longer IPC)

- `peer_messages` — replaced by in-memory `LaneInbox` + `InterLaneCoordinator`
- `permission_requests` — replaced by in-process oneshot channels

These tables can remain for migration/rollback but won't be written to.

---

## 9. Implementation Phases

### Phase A: ACP Client Core (3-4 days)

**Create:**
- `core/acp.rs` — AcpClient, AcpRegistry, reader task, dispatch, request/reply
- Built-in backend definitions (claude, codex, gemini, cursor, opencode, droid)
- Process group isolation (`process_group(0)`, SIGTERM/SIGKILL)
- Tauri commands: `acp_spawn`, `acp_initialize`, `acp_session_new`, `acp_prompt`, `acp_cancel`, `acp_dispose`
- Stderr capture (64KB rolling buffer)

**Acceptance:**
- Can spawn claude-agent-acp, initialize, session/new, prompt, get streaming events, dispose
- Request correlation works (multiple concurrent requests don't cross)
- Process group cleanup kills adapter + MCP grandchildren

### Phase B: Inbound Request Handlers (2 days)

**Create:**
- `fs/read_text_file` handler with path scope validation
- `fs/write_text_file` handler with diff preview (old/new text → frontend → accept/reject)
- `session/request_permission` handler (park on oneshot → frontend → respond)
- Tauri commands: `acp_permission_response`, `acp_fs_write_response`

**Frontend:**
- `DiffPreview.tsx` component
- Update `PermissionModal` to use ACP `PermissionOption[]`

**Acceptance:**
- Agent can read files (auto-approved by harness)
- Agent write requests show diff preview, user can accept/reject
- Permission requests render with proper options (allow_once, allow_always, etc.)

### Phase C: Session Management (1-2 days)

**Create:**
- Tauri commands: `acp_session_list`, `acp_session_resume`, `acp_session_load`
- Session picker UI component
- `/resume` slash command

**Acceptance:**
- Can list past sessions for a project
- Can resume a session and continue conversation
- Can load a session read-only

### Phase D: Frontend ACP Client (2-3 days)

**Create:**
- `src/lib/acp-client.ts` — TypeScript wrapper class
- `src/lib/acp-types.ts` — all wire types
- Update `useLaneStream` to use AcpClient events
- Update `useWorkspace` to spawn/dispose via AcpClient
- Update `CommandBar` to use `AcpClient.prompt()`
- Map all `session/update` kinds to transcript items

**Acceptance:**
- Full chat flow works through ACP (spawn → initialize → prompt → streaming → stop)
- Tool calls render with status progression (pending → in_progress → completed)
- Plan entries display
- Usage/cost metrics surface

### Phase E: Inter-Lane Messaging (2-3 days)

**Create:**
- `core/lane_bus.rs` — typed event emitter
- `core/lane_inbox.rs` — per-lane FIFO queue
- `core/inter_lane.rs` — envelope routing coordinator
- `LaneHost` trait implementation bridging coordinator to harness
- Mention fan-out (`@lane-name` from CommandBar → multi-lane delivery)
- Pending tracking + `awaiting_peer` status
- Cancel/close cleanup with peer notification

**Acceptance:**
- Lane A can peer_send to Lane B
- Messages drain on idle transition
- `@mention` fan-out routes to multiple lanes
- Cancelling a conversation notifies peers
- Closing a lane notifies peers with pending sends

### Phase F: Cleanup + Polish (1-2 days)

**Remove:**
- `core/agent_process.rs` — replaced by `core/acp.rs`
- `core/claude_client.rs` — no longer needed (was for `--stream-json` parsing)
- `core/codex_client.rs` — replaced by `codex-acp` backend
- `core/generic_client.rs` — replaced by unified ACP protocol
- `core/acp_client.rs` (trait) — replaced by AcpClient struct
- `core/acp_events.rs` — replaced by ACP protocol events
- `core/peer_delivery.rs` — replaced by LaneBus + InterLaneCoordinator
- `bin/mcp_bridge.rs` — keep binary, remove config file generation

**Update:**
- `core/mod.rs` — new module declarations
- `lib.rs` — `AppState` gets `AcpRegistry` instead of `processes: HashMap<String, AgentProcess>`
- `commands/lane.rs` — use AcpRegistry instead of AgentProcess
- `agent_registry.rs` — simplify to backend descriptors only

**Acceptance:**
- No code references old agent_process or client modules
- `cargo clippy` clean
- All existing features work through ACP

---

## 10. AppState Changes

### Before
```rust
pub struct AppState {
    pub data_dir: PathBuf,
    pub db: Arc<Mutex<Database>>,
    pub processes: Arc<Mutex<HashMap<String, AgentProcess>>>,
    pub permissions: Arc<Mutex<PermissionEngine>>,
}
```

### After
```rust
pub struct AppState {
    pub data_dir: PathBuf,
    pub db: Arc<Mutex<Database>>,
    pub acp: Arc<AcpRegistry>,
    pub lane_bus: Arc<LaneBus>,
    pub coordinator: Arc<Mutex<InterLaneCoordinator>>,
}
```

`PermissionEngine` is removed — permissions are now handled in-process via
ACP `session/request_permission` inbound requests (no DB round-trip).

---

## 11. Risk Assessment

| Risk | Mitigation |
|------|------------|
| `claude-agent-acp` not installed on user machine | Catch spawn error, show install hint like Krypton: `npm i -g @agentclientprotocol/claude-agent-acp` |
| ACP adapter hangs on `initialize` | 30s timeout (matching Krypton), surface stderr to user |
| Process group signal not available on Windows | `#[cfg(unix)]` guard; on Windows fall back to `child.kill()` |
| MCP bridge still needed for custom tools | Keep `alizode-mcp` binary, inject via `session/new` mcpServers param |
| Breaking change for existing sessions | `--resume` is a Claude CLI flag, not ACP; ACP has `session/resume` method. Old sessions won't carry over. |
| Concurrent stdin writes from multiple tasks | `Mutex<ChildStdin>` ensures serialization |

---

## 12. Dependencies

### Rust crates (new)
- `libc` — process group signals (already likely in tree via tokio)
- `tokio` — already used; need `tokio::process::Command` instead of `std::process`

### npm packages (new)
- None required at build time
- Runtime: `@agentclientprotocol/claude-agent-acp` installed via `npx -y` on first use

### Binaries expected on PATH
- `npx` (for claude-agent-acp)
- `codex-acp` (optional, for Codex support)
- `gemini` (optional, for Gemini support)
- `cursor-agent` (optional, for Cursor support)
