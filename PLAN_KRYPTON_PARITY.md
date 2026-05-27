# Plan: Krypton Parity — Chat Flow, MCP Tools, ACP

Alizode feature parity with Krypton across chat flow, custom MCP tools, and ACP protocol.

**Krypton repo:** `/Users/tee/src/krypton`
**Alizode repo:** `/Users/tee/src/alizode`

---

## Phase 1: Chat Flow

### 1.1 Streaming Markdown (Spec 117)

**Goal:** Agent text streams as live-rendered markdown, not plain text.

**Krypton reference:**
- Import: `krypton/src/acp/acp-harness-view.ts:9` — `import * as smd from 'streaming-markdown'`
- Per-lane fields: `acp-harness-view.ts:335-337` — `streamingMarkdownParser`, `streamingMarkdownBody`, `streamingMarkdownItemId`
- Per-item field: `acp-harness-view.ts:106` — `streamingMarkdownWritten?: number`
- Init: `acp-harness-view.ts:5145-5165` — `initLaneStreamingMarkdown(lane, item, body)`
- RAF delta write: `acp-harness-view.ts:5172-5198` — `updateStreamingAssistantMarkdownBody(body, item, lane)`
- Seal: `acp-harness-view.ts:4005-4058` — `sealAssistantStreamingMarkdown` (Branch A: parser active, Branch B: background/offscreen)
- Safe renderer: `acp-harness-view.ts:5122-5139` — `makeSafeRenderer(body)` wraps `smd.default_renderer`, allowlists URLs
- Event routing: `acp-harness-view.ts:1975-1990` — `message_chunk` -> `appendStreaming`, `stop/error/tool_call` -> `sealStreaming`
- Parser guard on window slide: `acp-harness-view.ts:3105-3113`

**Key invariant:** `parser_write` is ONLY called from `updateStreamingAssistantMarkdownBody` and `sealAssistantStreamingMarkdown` — never from `appendStreaming`. `appendStreaming` only accumulates text into `item.text`.

**Changes:**

| File | Change |
|------|--------|
| `package.json` | Add `streaming-markdown` dependency |
| `src/lib/acp-events.ts` | Add `markdownHtml?: string`, `streamingMarkdownWritten?: number` to `LaneEvent` type |
| `src/hooks/useLaneStream.ts` | Add `streamingMarkdownParser`, `streamingMarkdownBody`, `streamingMarkdownItemId` per-lane fields. `appendStreaming()` only accumulates text. New `sealStreaming()` export. |
| `src/components/lane-view/EventRow.tsx` | `AgentTextBlock` renders `markdownHtml` when present (sealed), otherwise binds to streaming parser root element via ref. Safe renderer wrapping `smd.default_renderer()` with URL allowlist. |
| `src/components/lane-view/StreamingMarkdown.tsx` | **New file.** React component wrapping `smd.Parser` lifecycle. Accepts `text` prop, manages RAF-only delta writes. Calls `parser_end` on unmount or seal signal. |

**Event routing:**
- `AgentText` chunks -> `appendStreaming()` (accumulate only)
- `Thought` chunks -> plain text append (no smd)
- `ToolCall`, `ToolResult`, `Error`, stop -> `sealStreaming()` first, then process

**Safe renderer:** Wrap `smd.default_renderer(root)`. Intercept `set_attr` — allowlist `http/https/mailto` for `HREF`, `http/https` for `SRC`. All else -> `'#'`.

### 1.2 Tail-Window Rendering (Spec 103)

**Goal:** Only render last N rows in DOM. Cap total stored events at 300 per lane.

**Krypton reference:**
- Constants: `acp-harness-view.ts:389-391` — `TRANSCRIPT_WINDOW_STEP = 60`, `TRANSCRIPT_WINDOW_DEFAULT = 60`, `HIDDEN_INDICATOR_ID`
- Hard cap (300): `acp-harness-view.ts:3868-3889` — `lane.transcript.push(item)`, shift oldest if > 300
- Window slice: `acp-harness-view.ts:3084-3099` — `start = Math.max(0, total - windowSize)`, prepend hidden indicator
- Expand (Ctrl+H): `acp-harness-view.ts:3044-3052` — `+= TRANSCRIPT_WINDOW_STEP`, wrap to default at max
- Lane field: `acp-harness-view.ts:434` — `transcriptWindow: TRANSCRIPT_WINDOW_DEFAULT`
- Parser guard: `acp-harness-view.ts:3105-3113` — tear down smd parser if row slides out of window

**Constants:**
```
TRANSCRIPT_WINDOW_STEP    = 60
TRANSCRIPT_WINDOW_DEFAULT = 60
TRANSCRIPT_MAX            = 300
```

**Changes:**

| File | Change |
|------|--------|
| `src/hooks/useLaneStream.ts` | Add `transcriptWindow: number` per lane (default 60). On `pushEvent()`: if lane events > 300, shift oldest. Export `expandTranscriptWindow(key)` and `resetTranscriptWindow(key)`. |
| `src/components/lane-view/LaneView.tsx` | Slice events: `events.slice(Math.max(0, events.length - transcriptWindow))`. Prepend hidden-row indicator: `"^ {n} earlier rows hidden"`. |
| `src/components/lane-view/LaneView.tsx` | Add "Show more" button or `Ctrl+H` keybinding calling `expandTranscriptWindow`. |

**Streaming parser guard:** If streaming assistant row slides out of window, tear down parser immediately (call `parser_end`, null out lane fields).

### 1.3 Lane Status Machine (7 states)

**Goal:** Replace binary `turnActive` with full status machine matching Krypton.

**Krypton reference:**
- Type: `krypton/src/acp/types.ts:200-207` — `HarnessLaneStatus` (7 states)
- Status event: `krypton/src/acp/types.ts:241-246` — `LaneStatusEvent { prev, next, at }`
- Centralized setter: `acp-harness-view.ts:569-577` — `setLaneStatus(lane, next)` emits bus event on change
- Guards: `acp-harness-view.ts:2077-2081` — prompt blocked unless `idle` or `awaiting_peer`
- Transitions: `acp-harness-view.ts:704` (idle->awaiting_peer), `:714` (->busy), `:725` (->error), `:1904` (starting->idle), `:2091` (idle->busy), `:2199` (->error), `:2202` (busy->idle/awaiting), `:2238` (busy->needs_permission), `:2257` (needs_permission->busy)

**Alizode current state:**
- `HarnessLaneStatus` type already exists at `src/lib/acp-types.ts:169-176` (all 7 states)
- `LaneStatus` (different!) at `src/lib/acp-events.ts:14` — `"Idle" | "Running" | "Waiting" | "Error" | "Stopped"` (PascalCase, 5 states, for DB persistence)
- `turnActive: boolean` at `src/hooks/useLaneStream.ts:147` — needs replacement

**States:** `starting | idle | busy | needs_permission | awaiting_peer | error | stopped`

**Transitions:**

| From | To | Trigger |
|------|----|---------|
| `starting` | `idle` | spawn + session/new succeed |
| `starting` | `error` | spawn fails |
| `idle` | `busy` | user submits prompt |
| `idle` | `awaiting_peer` | peer_send delivered, pending > 0 |
| `busy` | `needs_permission` | permission_request event |
| `busy` | `error` | prompt throws / error event |
| `busy` | `idle` | stop event, coordinator says idle |
| `busy` | `awaiting_peer` | stop event, coordinator says awaiting |
| `needs_permission` | `busy` | all permissions resolved |
| `awaiting_peer` | `idle` | coordinator delivers inbox |
| `awaiting_peer` | `busy` | system prompt enqueued from peer |
| `*` | `starting` | lane restart / session resume |
| `*` | `stopped` | lane closed |

**Changes:**

| File | Change |
|------|--------|
| `src/lib/acp-types.ts` | `HarnessLaneStatus` already exists. Add `LaneStatusEvent` interface: `{ laneId, prev, next, at }`. |
| `src/hooks/useLaneStream.ts` | Replace `turnActive: boolean` with `laneStatus: HarnessLaneStatus` per lane. Centralized `setLaneStatus(key, next)` emits custom event on change. Expose status via hook return. Map to DB `LaneStatus` on transitions. |
| `src/hooks/useWorkspace.ts` | `getOrSpawnClient` sets `starting` -> `idle` or `error`. |
| `src/App.tsx` | `handleCommand` sets `busy` before prompt, reads coordinator result for next status. |
| `src/hooks/useHarnessCoordinator.ts` | `drainPromptCycle` sets `busy` -> reads `on_stop` -> sets result status. |
| `src/components/lane-list/LaneList.tsx` | Status indicator shows all 7 states with distinct colors/icons. |
| `src/components/lane-view/LaneHeader.tsx` | Display current status badge. |

---

## Phase 2: Custom MCP Tools

### 2.1 Review Packet with Git State

**Goal:** `review_request` sends full git diff, patch hunks, untracked files, command summaries — not just text.

**Krypton reference:**
- Types: `krypton/src/acp/types.ts:259-322` — `ReviewDiffstatEntry` (:259), `ReviewPatchHunk` (:266), `ReviewUntrackedExcerpt` (:273), `ReviewCommandSummary` (:278), `ReviewToolSummary` (:285), `ReviewPacket` (:303)
- Constants: `krypton/src/acp/review.ts:15-22` — all size caps
- Packet builder: `krypton/src/acp/review.ts:46` — `buildPacket()`
- Reviewer prompt: `krypton/src/acp/review.ts:65` — `composeReviewerPrompt()`
- Reply validation: `krypton/src/acp/review.ts:169` — `validateReply()`
- Signal assembly: `acp-harness-view.ts:862-922` — `assembleReviewSignals()` walks transcript
- Frontend flow: `acp-harness-view.ts:801-946,958-959` — collect git state -> assemble signals -> build packet -> deliver
- Rust git collection: `krypton/src-tauri/src/hook_server.rs:858-1000+` — `collect_git_state(cwd)` shells out to git

**Krypton constants:**
```
TOTAL_PATCH_CAP       = 40_960 bytes
PER_FILE_HUNK_CAP     = 8_192 bytes
UNTRACKED_HEAD_LINES  = 40
UNTRACKED_HEAD_BYTES  = 4_096
INTENT_CAP            = 2_000 chars
COMMAND_RESULT_TAIL   = 400
SUMMARY_CAP           = 600
CONCERN_CAP           = 200
```

**Changes:**

| File | Change |
|------|--------|
| `src-tauri/src/commands/review.rs` | **New file.** Port `collect_git_state()` from Krypton's `hook_server.rs:858-1000`. Runs `git status --porcelain=v1`, `git rev-parse HEAD`, `git diff --cached`, `git diff HEAD --numstat`, per-file `git diff HEAD -- <path>` (capped). Returns `ReviewGitState` struct. |
| `src-tauri/src/commands/mod.rs` | Add `pub mod review;` |
| `src-tauri/src/lib.rs` | Register `acp_collect_review_git_state` Tauri command. |
| `src/lib/review.ts` | **New file.** Port from Krypton `review.ts` (307 lines). Types + `buildReviewPacket()` + `composeReviewerPrompt()` + `validateReply()`. Self-contained, no Krypton DOM deps. |
| `src/hooks/useHarnessCoordinator.ts` | `acp-review-requested` handler: call `invoke('acp_collect_review_git_state', { cwd })`, then `assembleReviewSignals(events)`, then `buildReviewPacket()`, deliver full packet via `inter_lane_deliver`. |

**`assembleReviewSignals` logic:** Walk lane events since last review. Collect `UserIn` text as `intent` (cap 2000 chars), `ToolCall` of kind `execute` as `commands` (tail 400 chars of result), per-tool-kind counts as `toolSummary`.

### 2.2 `.mcp.json` Project Loading

**Goal:** Agents get project-defined MCP servers from `.mcp.json` in workspace cwd.

**Krypton reference:**
- Module: `krypton/src/acp/mcp-bridge.ts` (262 lines) — self-contained, no DOM deps, portable
- `${VAR}` expand: `mcp-bridge.ts:55-92` — `expand(input, env)`, handles `${VAR}` and `${VAR:-default}`
- Batch expand: `mcp-bridge.ts:94` — `expandAll(values, env)`, returns null if any required var missing
- Login env: `mcp-bridge.ts:39-49` — `loginEnvPromise`, memoized `invoke('acp_login_env')`
- Load: `mcp-bridge.ts:180-230` — `loadProjectMcpServers(projectDir)`, reads via `invoke('read_mcp_config_file')`
- Filter: `mcp-bridge.ts:233-246` — `filterByCapability(servers, caps)`, stdio always retained
- Dedup: `mcp-bridge.ts:249-262` — `dedupeByName(a, b)`, first-occurrence-wins
- Import in harness: `acp-harness-view.ts:75-77` — `loadProjectMcpServers`, `filterByCapability`, `dedupeByName`

**Changes:**

| File | Change |
|------|--------|
| `src-tauri/src/commands/mcp_config.rs` | **New file.** `read_mcp_config_file` Tauri command: reads `{cwd}/.mcp.json`, returns `Option<String>`. |
| `src-tauri/src/commands/mod.rs` | Add `pub mod mcp_config;` |
| `src-tauri/src/lib.rs` | Register `read_mcp_config_file` command. |
| `src/lib/mcp-bridge.ts` | **New file.** Port from Krypton `mcp-bridge.ts` (262 lines). Self-contained, no DOM deps. |
| `src/hooks/useWorkspace.ts` | In `getOrSpawnClient` and `createLane`: after getting harness MCP descriptor, call `loadProjectMcpServers(cwd)` then `filterByCapability` then `dedupeByName(projectServers, [harnessDescriptor])`. Pass merged list to `client.initialize()`. |

**`${VAR}` expansion:** Parse `${VAR}` and `${VAR:-default}`. Login env from `invoke('acp_login_env')` (already exists). If required var unset, skip that server entry entirely.

### 2.3 MCP Stats Monitoring

**Goal:** Track per-lane MCP tool usage (initialize, list, call counts) and display in UI.

**Krypton reference:**
- Rust struct: `krypton/src-tauri/src/hook_server.rs:466-475` — `McpLaneStatsEntry { lane_label, initialize_count, tools_list_count, tools_call_count, last_method, last_seen_at }`
- Rust storage: `hook_server.rs:162` — `mcp_stats: Mutex<HashMap<String, HashMap<String, McpLaneStats>>>`
- TS type: `krypton/src/acp/types.ts:168-175` — `HarnessMcpLaneStats`
- Event-driven refresh: `acp-harness-view.ts:1781-1782` — listens to `acp-harness-mcp-touched` event
- Display: `acp-harness-view.ts:478` — `mcpStatsByLane` Map, `renderMcpChip()` at :6024
- Harness-view field: `acp-harness-view.ts:237` — `mcp?: HarnessMcpLaneStats | null` on lane summary

**Changes:**

| File | Change |
|------|--------|
| `src-tauri/src/harness_mcp.rs` | Add `McpLaneStats` struct: `{ lane_label, initialize_count, tools_list_count, tools_call_count, last_method, last_seen_at }`. Increment in request handler per method. Add `list_harness_mcp_stats` Tauri command. Emit `acp-harness-mcp-touched` event on each request. |
| `src-tauri/src/lib.rs` | Register `list_harness_mcp_stats` command. |
| `src/lib/acp-types.ts` | Add `HarnessMcpLaneStats` interface. |
| `src/hooks/useMcpStats.ts` | **New hook.** Subscribe to `acp-harness-mcp-touched` event. On event, call `invoke('list_harness_mcp_stats')`. Expose `mcpStatsByLane: Map<string, HarnessMcpLaneStats>`. |
| `src/components/lane-list/LaneList.tsx` | Show MCP chip per lane (init/list/call counts). |
| `src/components/lane-view/LaneHeader.tsx` | Show last method + timestamp in header. |

**Event-driven refresh:** No polling. Frontend refreshes stats only when `acp-harness-mcp-touched` fires.

### 2.4 Harness ID Scoping

**Goal:** Prevent cross-window event leakage when multiple Alizode instances run.

**Krypton reference:**
- Fields: `acp-harness-view.ts:471-473` — `harnessMemoryId`, `harnessMemoryPort`, `harnessMemoryWarning`
- Type: `krypton/src/acp/types.ts:163-166` — `HarnessMemorySession { harnessId, hookPort }`
- Generation: `acp-harness-view.ts:1772-1785` — `initializeHarnessMemory()`, calls `invoke('create_harness_memory')`
- Rust generation: `krypton/src-tauri/src/hook_server.rs:256-258` — `create_harness_memory()`, `hm-{seq}` format
- Guard pattern: `acp-harness-view.ts:743-744` — `if (!this.harnessMemoryId || env.harnessId !== this.harnessMemoryId) return;`
- All guarded listeners: `:743`, `:775`, `:806`, `:849` — inter-lane, memory, MCP events all filtered
- MCP URL with harness: `acp-harness-view.ts:1924-1930` — `http://127.0.0.1:${port}/mcp/harness/${harness}/lane/${laneLabel}`
- Race guard: `acp-harness-view.ts:740-742` — uninit harness must not consume replies

**Changes:**

| File | Change |
|------|--------|
| `src-tauri/src/harness_mcp.rs` | Generate UUID `harness_id` at startup. Include in all emitted Tauri events (`acp-inter-lane-message`, `acp-peer-list-requested`, `acp-review-requested`, `acp-review-reply-requested`, `acp-harness-mcp-touched`). Add `harness_id` to `HarnessMcpState`. Export `harness_id()` Tauri command. |
| `src-tauri/src/lib.rs` | Register `harness_id` command. |
| `src/hooks/useHarnessCoordinator.ts` | On mount, fetch `harnessId = await invoke('harness_id')`. Every event listener: `if (e.payload.harnessId !== harnessId) return;` guard. |
| `src/hooks/useMcpStats.ts` | Same guard on `acp-harness-mcp-touched`. |
| `src/hooks/useWorkspace.ts` | Include `harnessId` in MCP server URL: `http://127.0.0.1:${port}/mcp/harness/${harnessId}/lane/${laneId}`. |
| `src-tauri/src/harness_mcp.rs` | Update route: `/mcp/harness/{harness_id}/lane/{lane_id}`. Validate `harness_id` matches. |

---

## Phase 3: ACP Protocol

### 3.1 OpenCode Default Model

**Goal:** Change OpenCode default model to `kimi 2.6 max`.

**Krypton reference:** `krypton/src-tauri/src/acp.rs:25` — `OPENCODE_DEFAULT_MODEL = "zai-coding-plan/glm-5.1"`
**Alizode current:** `src-tauri/src/core/acp.rs:1012` — `OPENCODE_DEFAULT_MODEL = "sonnet"`

**Change:**

| File | Change |
|------|--------|
| `src-tauri/src/core/acp.rs:1012` | Change `OPENCODE_DEFAULT_MODEL` from `"sonnet"` to `"kimi 2.6 max"`. |

### 3.2 Reader Loop Logging

**Goal:** Match Krypton's log discipline in ACP reader task.

**Krypton reference:**
- Reader task: `krypton/src-tauri/src/acp.rs:319-354` — `run_reader()`
- Dispatch: `krypton/src-tauri/src/acp.rs:357` — `dispatch_message()`
- Stderr capture: `krypton/src-tauri/src/acp.rs:716-736` — `run_stderr_capture()`, `stderr_buf` capped at 64KB
- Log calls: `:328` info (EOF), `:339` debug (non-JSON), `:349` warn (IO error), `:385` debug (unknown id), `:405` debug (malformed), `:516` debug (file not found), `:628` debug (unknown inbound method), `:672` debug (unknown update kind), `:680` debug (unknown notification), `:726` debug (stderr line)

**Alizode current:** `src-tauri/src/core/acp.rs:322` — `run_reader()` has zero `log::` calls. Errors silently dropped.

**Log levels:**

| Event | Level | Message |
|-------|-------|---------|
| Subprocess stdout closed (EOF) | `info!` | `[acp:{session}] subprocess stdout closed` |
| Non-JSON line (parse failure) | `debug!` | `[acp:{session}] dropping non-JSON line ({err}): {trimmed}` |
| IO read error | `warn!` | `[acp:{session}] read error: {err}` |
| Response for unknown request id | `debug!` | `[acp:{session}] response for unknown id {id}` |
| Malformed message (no id, no method) | `debug!` | `[acp:{session}] dropping malformed message` |
| Unknown inbound method | `debug!` | `[acp:{session}] unknown inbound method: {method}` |
| `fs/read_text_file` not found | `debug!` | `[acp:{session}] fs/read_text_file: not found, returning empty` |
| Unknown `session/update` kind | `debug!` | `[acp:{session}] dropping session/update kind {other}` |
| Unknown notification | `debug!` | `[acp:{session}] dropping notification {other}` |
| Stderr line | `debug!` | `[acp:{session}] stderr: {line}` |

**Changes:**

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Ensure `log` crate in deps (likely already present via tauri). |
| `src-tauri/src/core/acp.rs` | Add `log::info!`, `log::debug!`, `log::warn!` calls at each point in `run_reader` (:322) and `dispatch_message` (:348) matching table above. Add stderr capture task logging at `debug!` in `run_stderr_capture` (:669). |

---

## Implementation Order

| # | Phase | Feature | Effort | Deps |
|---|-------|---------|--------|------|
| 1 | 3.2 | Reader loop logging | S (1h) | none |
| 2 | 3.1 | OpenCode default model | XS (5min) | none |
| 3 | 1.3 | Lane status machine | M (4h) | none |
| 4 | 2.4 | Harness ID scoping | M (3h) | none |
| 5 | 1.2 | Tail-window rendering | M (3h) | 1.3 |
| 6 | 1.1 | Streaming markdown | L (8h) | 1.2 |
| 7 | 2.2 | `.mcp.json` project loading | M (4h) | none |
| 8 | 2.3 | MCP stats monitoring | M (3h) | 2.4 |
| 9 | 2.1 | Review packet with git state | L (6h) | 1.3 |

**Total estimated: ~32 hours**

Order: quick wins first (logging, model), then foundational (status machine, harness ID), then rendering (tail-window, streaming), then MCP features (project config, stats, review).

---

## Dependency Graph

```
3.2 Reader logging       -> none
3.1 OpenCode model        -> none
1.3 Lane status machine   -> none (but informs 1.1, 1.2)
2.4 Harness ID scoping    -> none (but informs 2.3)
1.2 Tail-window           -> 1.3 (uses lane status for window reset)
1.1 Streaming markdown    -> 1.2 (parser guard needs window awareness)
2.2 .mcp.json loading     -> none
2.3 MCP stats             -> 2.4 (scoped by harness ID)
2.1 Review packet         -> 1.3 (assembleReviewSignals reads lane events)
```

---

## Testing Strategy

- **Unit tests:** `review.ts` packet assembly, `mcp-bridge.ts` `${VAR}` expansion, lane status transitions
- **Integration tests:** `collect_git_state` Rust function against test repo, `read_mcp_config_file` with sample `.mcp.json`
- **Manual verification:** Streaming markdown rendering, tail-window scroll behavior, multi-window harness ID isolation, MCP stats chip display
