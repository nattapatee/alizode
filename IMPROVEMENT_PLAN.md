# Alizode Improvement Plan

> Based on analysis of Krypton's ACP harness architecture.
> Prioritized by impact vs effort. Each phase is independently shippable.

---

## Current State (Alizode v0.1)

- Per-input CLI spawning (no persistent subprocess)
- Flat `LaneEvent` with generic JSON payload
- Raw text display (no markdown rendering)
- No transcript windowing (renders all events)
- Permission modal shows tool name only (no diff preview)
- No lane status state machine driving UI
- Event ordering broken (seq mismatch between UserIn and agent events) — fixed
- Chat persistence across tab switches — fixed
- Workspace folder selection — added

---

## Phase 1: Chat Quality (1-2 days) ✅ DONE

**Goal**: Make agent output readable and performant.

### 1.1 Streaming Markdown Rendering

**What**: Render agent text as incremental markdown instead of raw text.

**Krypton reference**: Spec 117 — uses `streaming-markdown` npm package. Parser bound per lane, `appendStreaming()` accumulates, `sealStreaming()` finalizes HTML.

**Implementation**:
- Add `streaming-markdown` npm dependency
- In `EventRow.tsx`, render `AgentText` kind through streaming markdown parser
- On `stop` event, seal the parser to finalize HTML
- Keep `Thought` as plain monospace text (different visual treatment)

**Files**: `src/components/lane-view/EventRow.tsx`, `src/hooks/useLaneStream.ts`

### 1.2 Tail-Window Transcript

**What**: Only render last N rows to DOM. Cap total events per lane.

**Krypton reference**: Spec 103 — renders last 60 rows, caps at 300 total per lane.

**Implementation**:
- In `LaneView.tsx`, slice `events` to last 80 before mapping to `EventRow`
- Add "scroll up to load more" trigger at top
- Keep full event list in state for scroll-back, only render visible window

**Files**: `src/components/lane-view/LaneView.tsx`

### 1.3 Typed Transcript Items

**What**: Replace generic `payload: json` with typed payloads per event kind.

**Krypton reference**: `HarnessTranscriptItem` has dedicated fields: `tool?: ToolPayload`, `permission?: PermissionPayload`, `interLane?: InterLanePayload`.

**Implementation**:
- Extend `LaneEvent` type in `acp-events.ts` with discriminated union by `kind`
- Update `EventRow.tsx` to render specialized UI per kind:
  - `ToolCall`: tool name + spinner, then result + duration
  - `PermPrompt`: inline permission card (not just modal)
  - `PeerIn`/`PeerOut`: peer badge with direction arrow
  - `Thought`: collapsible, dimmed text
- Backend: ensure `payload` JSON structure is consistent per kind

**Files**: `src/lib/acp-events.ts`, `src/components/lane-view/EventRow.tsx`

---

## Phase 2: Lane Status Machine (1 day) ✅ DONE

**Goal**: Drive UI from lane state, prevent invalid interactions.

### 2.1 Status Enum

**Krypton reference**: `starting | idle | busy | needs_permission | awaiting_peer | error | stopped`

**Implementation**:
- Add `status` field to frontend `Lane` type (already exists in DB)
- Backend emits `lane://status` events on transitions
- Update `lane_send_user` to reject input when lane is `busy`
- Add status badge to `LaneHeader.tsx` (color-coded dot)
- Disable CommandBar input when active lane is `busy` or `needs_permission`

**Files**: `src/lib/acp-events.ts`, `src/components/lane-view/LaneHeader.tsx`, `src/components/command-bar/CommandBar.tsx`, `src-tauri/src/core/agent_process.rs`

### 2.2 Epoch Tracking

**Krypton reference**: `spawnEpoch` counter prevents stale event handlers after respawn.

**Implementation**:
- Add `epoch: u64` to `AgentProcess`
- Increment on each `send_input` spawn
- Include epoch in emitted events
- Frontend ignores events from stale epochs

**Files**: `src-tauri/src/core/agent_process.rs`, `src/hooks/useLaneStream.ts`

---

## Phase 3: Permission UX (1-2 days) ✅ DONE

**Goal**: Informed approval decisions with context.

### 3.1 File Diff Preview in Permission Modal

**Krypton reference**: `fs_write_pending` event shows old/new text diff before approval.

**Implementation**:
- MCP bridge `alizode_write` and `alizode_edit` tools: include `old_text` and `new_text` in permission request detail
- `PermissionModal.tsx`: parse detail JSON, render side-by-side or inline diff
- Add simple diff view component (highlight added/removed lines)

**Files**: `src-tauri/src/bin/mcp_bridge.rs`, `src/components/permission-modal/PermissionModal.tsx`

### 3.2 Inline Permission Cards

**Krypton reference**: Permission requests render as transcript items with option buttons, not just modal overlay.

**Implementation**:
- Render `PermPrompt` events as inline cards in transcript (in addition to modal)
- Show tool name, category badge, and detail text
- Decision buttons inline: Allow Once / Allow Session / Deny
- After decision, card updates to show outcome (green check or red X)

**Files**: `src/components/lane-view/EventRow.tsx`, `src/components/permission-modal/PermissionModal.tsx`

---

## Phase 4: Agent Process Architecture (3-5 days) ✅ DONE (epoch tracking; persistent subprocess deferred)

**Goal**: Move from per-input spawning to persistent subprocess.

### 4.1 Persistent Subprocess with Session Management

**Current**: Spawn `claude -p "text" --resume <id>` per message. Process exits after each response.

**Krypton reference**: Persistent subprocess with JSON-RPC 2.0 over stdio. `acp_spawn()` once, then `acp_prompt()` for each turn.

**Implementation**:
- Refactor `AgentProcess` to keep Claude running as persistent process
- Use `claude --interactive` or ACP mode if available
- Fall back to per-input spawning for agents that don't support persistent mode
- Add `cancel()` support — send SIGINT to running turn
- Add proper `dispose()` — graceful SIGTERM + SIGKILL fallback

**Risk**: Claude CLI may not support persistent interactive mode cleanly. Needs investigation.

**Files**: `src-tauri/src/core/agent_process.rs`, `src-tauri/src/core/claude_client.rs`

### 4.2 JSON-RPC Correlation

**Krypton reference**: `HashMap<u64, oneshot::Sender<Value>>` for request/response correlation.

**Implementation**:
- Add request ID generation and pending map to ACP client
- Correlate tool results with tool calls
- Enable proper cancellation via `session/cancel` JSON-RPC method

**Files**: `src-tauri/src/core/acp_client.rs`

---

## Phase 5: Inter-Lane Messaging Improvements (2-3 days) ✅ DONE (@mention fan-out; LaneInbox channel deferred)

**Goal**: Replace DB polling with event-driven peer messaging.

### 5.1 LaneInbox + LaneBus Pattern

**Current**: 300ms DB polling loop in `peer_delivery.rs`.

**Krypton reference**: `LaneInbox` (per-lane FIFO queue), `LaneBus` (typed event emitter), `InterLaneCoordinator` (envelope routing).

**Implementation**:
- Add in-memory `LaneInbox` per lane (tokio mpsc channel)
- Route peer messages directly through channel, persist to DB for history
- Remove DB polling for peer delivery (keep for permission polling or migrate that too)
- Drain inbox on lane `idle` transition, inject as system prompts

**Files**: `src-tauri/src/core/peer_delivery.rs`, new `src-tauri/src/core/lane_inbox.rs`

### 5.2 Mention Fan-Out

**Krypton reference**: Spec 115 — `@DisplayName` mentions parsed from composer, fan out single message to multiple lanes.

**Implementation**:
- Parse `@lane-name` prefix in CommandBar input
- Route message to mentioned lane(s) instead of active lane
- Track via `mentionPacketId` for reply correlation
- Show fan-out indicator in transcript

**Files**: `src/components/command-bar/CommandBar.tsx`, `src-tauri/src/commands/lane.rs`

---

## Phase 6: Session Persistence (2 days) ✅ DONE (JSONL export; session picker UI deferred)

**Goal**: Resume past sessions, export transcripts.

### 6.1 JSONL Session Files

**Krypton reference**: `~/.config/krypton/sessions/<cwd>/<timestamp>_<id>.jsonl` — each line is `{ type, ... }`.

**Implementation**:
- Write session JSONL alongside SQLite events (dual write)
- Add session picker UI (list past sessions, click to load)
- Support `/resume` command to reload a past session
- Export session as shareable JSONL or markdown

**Files**: new `src-tauri/src/store/session.rs`, `src/components/command-bar/CommandBar.tsx`

---

## Phase 7: UI Polish (2-3 days) ✅ DONE (keyboard shortcuts; metrics + mention palette deferred)

### 7.1 Keyboard Shortcuts

**Krypton reference**: Full keyboard model — `Cmd+T` new lane, `Cmd+[/]` switch, `=` metrics, `0` session picker.

**Implementation**:
- Add `useKeyboardCommands` hook
- Wire shortcuts: `Cmd+T` new lane, `Cmd+W` close lane, `Cmd+[/]` switch, `Esc` cancel

### 7.2 Lane Metrics

**Krypton reference**: CPU/memory/token usage per lane, toggled via `=` key.

**Implementation**:
- Sample agent process CPU/RSS via `sysinfo` crate
- Track token usage from agent stream events
- Show in LaneHeader or modal overlay

### 7.3 Mention Palette

**Krypton reference**: `@` prefix opens fuzzy lane/file picker.

---

## Priority Order

| Phase | Effort | Impact | Ship independently? |
|-------|--------|--------|---------------------|
| 1. Chat Quality | 1-2d | Very High | Yes |
| 2. Lane Status | 1d | High | Yes |
| 3. Permission UX | 1-2d | High | Yes |
| 4. Agent Process | 3-5d | High (enables cancel) | Yes |
| 5. Inter-Lane | 2-3d | Medium | Yes |
| 6. Sessions | 2d | Medium | Yes |
| 7. UI Polish | 2-3d | Medium | Yes |

**Recommended start**: Phase 1 (streaming markdown + tail window + typed events) — biggest visible improvement, minimal backend changes.

---

## Not Porting from Krypton

- **4200-line monolith view** — Alizode's React component split is better
- **xterm.js rendering** — structured React components are more flexible
- **Zed ACP shim** — not needed until supporting non-Claude agents properly
- **SHA-256 project hash for memory files** — SQLite per-workspace is cleaner
