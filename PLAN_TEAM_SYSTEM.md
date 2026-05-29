# Team System Implementation Plan

## Overview

Add multi-agent teams to Alizode. A team is a saved or live group of 2-4 lanes, with exactly one leader and a per-seat role/directive chosen by the user. The UI provides:

- A "Spawn Team" entry from the lane sidebar.
- A Team Builder modal for selecting agents, roles/directives, and the leader.
- Team groups in the lane sidebar.
- A Meeting Room center view with agent portrait frames and a leader chat composer.
- A right-side team rail showing members, leader plan, and team cross-talk.

This plan intentionally does not copy a Krypton team directive system. Krypton does not currently provide that. Alizode will define its own team-context prompt/directive behavior.

---

## Key Architecture Decisions

### Frontend owns ACP spawning

Current Alizode ACP lifecycle is frontend-owned:

- `src/hooks/useWorkspace.ts` creates `AcpClient` instances.
- `AcpClient.spawn()` calls Rust `acp_spawn`.
- `client.initialize()` injects the harness MCP server and project MCP servers.
- `clientsRef` stores live clients.
- `useHarnessCoordinator` handles peer events and drain prompts.

Therefore, Rust must not implement a `team_spawn` command that directly calls `acp_spawn`, `acp_initialize`, or `acp_session_new`. That would create sessions React does not know about.

Correct shape:

1. Rust persists teams and team lanes.
2. Frontend `spawnTeam()` calls Rust to create the DB records.
3. Frontend receives the new lanes and spawns them through the existing `AcpClient` path.
4. Frontend opens the Meeting Room after the lanes are created.

### Team metadata is persisted, runtime state stays in coordinator/frontend

SQLite owns durable team metadata:

- Team name.
- Workspace association.
- Lane membership.
- Seat order.
- Per-lane directive/role.
- Leader flag.
- Presets.

The inter-lane coordinator owns transient delivery state:

- Live lane status.
- Inbox depth.
- Pending peer sends.
- Drain actions.

Team-aware MCP tools can enrich coordinator data with DB/frontend lane metadata, but should not replace the current coordinator delivery path.

### Directives are Alizode-local

For v1, "directive" means the user-selected role/context for a lane in a team, such as:

- `leader`
- `frontend`
- `backend`
- `qa`
- `reviewer`
- custom text

Directives should be stored as plain strings and injected as team context after session creation, or made available through `team_info`. Do not assume ACP supports a spawn-time system prompt parameter unless verified for each backend.

---

## Data Model

### Migration runner prerequisite

Current `src-tauri/src/store/db.rs` only includes and runs `001_init.sql`. Before adding `002_teams.sql`, update migration handling so future migrations actually run. Acceptable v1 options:

1. Add a small `schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)` table and run embedded migrations in order.
2. If keeping one migration file for now, fold team tables into a new idempotent `001_init.sql` block. This is less clean, but works for pre-release local data.

Preferred: add a real migration runner.

### New tables

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_presets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_preset_members (
  id          TEXT PRIMARY KEY,
  preset_id   TEXT NOT NULL REFERENCES team_presets(id) ON DELETE CASCADE,
  agent_kind  TEXT NOT NULL,
  model       TEXT NOT NULL,
  directive   TEXT NOT NULL,
  is_leader   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  preset_id     TEXT REFERENCES team_presets(id),
  created_at    INTEGER NOT NULL
);
```

### `lanes` additions

```sql
ALTER TABLE lanes ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE lanes ADD COLUMN directive TEXT NOT NULL DEFAULT '';
ALTER TABLE lanes ADD COLUMN is_leader INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lanes ADD COLUMN team_sort_order INTEGER NOT NULL DEFAULT 0;
```

Notes:

- `team_sort_order` is required for stable Meeting Room and sidebar ordering.
- Keep `lanes.id + workspace_id` as the existing primary identity.
- Use app-level validation for "2-4 members" and "exactly one leader"; SQLite partial unique indexes can be added later if needed.

### Rust models

Add:

- `Team`
- `TeamMemberLane`
- `TeamPreset`
- `TeamPresetMember`
- `CreateTeamInput`
- `CreateTeamMemberInput`
- `CreateTeamResult`

Extend `Lane` with:

- `team_id: Option<String>`
- `directive: String`
- `is_leader: bool`
- `team_sort_order: i64`

Update all lane queries and TS types when these fields are added.

---

## Backend Commands

### Commands to add

| Command | Purpose |
|---|---|
| `team_create` | Persist a live team and create its lanes. Does not spawn ACP clients. |
| `team_list` | List teams for a workspace with member lanes. |
| `team_delete` | Delete/disband a team and optionally delete its lanes. |
| `team_presets_list` | List saved team presets. |
| `team_preset_save` | Save a reusable team config. |
| `team_preset_delete` | Delete a preset. |

### `team_create` flow

Inputs:

```ts
interface CreateTeamInput {
  workspace_id: string;
  name: string;
  save_as_preset: boolean;
  members: Array<{
    agent_kind: string;
    model: string;
    directive: string;
    is_leader: boolean;
    sort_order: number;
  }>;
}
```

Validation:

- Team name non-empty.
- Members length between 2 and 4.
- Exactly one member has `is_leader: true`.
- Every member has valid `agent_kind`.
- Every member has non-empty `directive`.
- Sort order is unique and contiguous enough for UI ordering.

Behavior:

1. Insert `teams` row.
2. Create one lane per member using existing lane creation logic extended with team fields.
3. Save preset if requested.
4. Return `{ team, lanes }`.

Important: this command only creates DB records. It does not spawn clients.

---

## Frontend Runtime Flow

### `useWorkspace.spawnTeam()`

Add a frontend method:

```ts
async function spawnTeam(input: CreateTeamInput): Promise<CreateTeamResult>
```

Flow:

1. Invoke `team_create`.
2. Append returned lanes to React `lanes`.
3. Set active team view state to the new team.
4. For each returned lane, call the same spawn path used by `createLane` / `getOrSpawnClient`.
5. After each lane initializes, send a team-context prompt or system event as appropriate.

Implementation detail:

- Extract the duplicated client spawning logic from `createLane()` and `getOrSpawnClient()` into a helper such as `spawnClientForLane(lane)`.
- Do not create a separate team-specific spawn path.

### Team context injection

Because `acp_spawn` and `session/new` do not currently accept a generic system prompt, v1 should use one of these approaches:

1. Preferred if safe: after client initialization, send a first internal/team-context prompt before user work starts.
2. Fallback: rely on `team_info` and enhanced `peer_list`, and show the directive in UI only.

Team context text:

```text
[TEAM CONTEXT]
Team: saf
Your lane: claude-1
Your directive: leader
You are the leader.

Members:
- claude-1: leader [leader]
- codex-1: frontend
- omo-1: backend

Use team_info to inspect current team state.
Use peer_send to delegate to a specific lane.
Use @leader only when the tool supports it.
```

This wording is Alizode-owned and can be improved during implementation. Do not treat it as Krypton-derived behavior.

---

## Team-Aware MCP Tools

### Current constraint

`peer_send` and `peer_list` currently live in Rust MCP but route through Tauri events and the frontend coordinator. The plan must preserve that unless the whole runtime ownership model is changed.

### `team_info`

Add MCP tool:

```json
{
  "team_name": "saf",
  "my_directive": "leader",
  "is_leader": true,
  "members": [
    { "id": "claude-1", "agent_kind": "claude", "directive": "leader", "is_leader": true, "status": "idle" },
    { "id": "codex-1", "agent_kind": "codex", "directive": "frontend", "is_leader": false, "status": "busy" }
  ]
}
```

Implementation options:

- Rust DB lookup plus coordinator status lookup.
- Or Rust emits a frontend request like `peer_list` and the frontend enriches from `lanes`.

Pick one owner and keep all team metadata fields consistent.

### Enhanced `peer_list`

Keep the current response shape compatible, but add optional team fields:

```json
{
  "lanes": [
    {
      "laneId": "claude-1",
      "displayName": "claude-1",
      "backendId": "claude",
      "status": "idle",
      "teamId": "team-1",
      "teamName": "saf",
      "directive": "leader",
      "isLeader": true
    }
  ]
}
```

### `peer_send` routing

Do not start with full cross-team routing. V1 should support:

- Direct lane IDs: existing behavior.
- `@leader`: resolve to current team leader.
- Optional `@team`: fan out to current team members except self.

Risks:

- Broadcast creates multiple pending peer waits.
- Existing `peer_in_flight` behavior is pair-based.
- Replies arrive incrementally.

Recommendation:

- Implement `@leader` first.
- Implement `@team` by reusing the existing mention fan-out semantics, not by looping naive `peer_send` calls inside the MCP handler.
- Defer `@team:other-team` to v2.

---

## UI Plan

## Phase 1 - Data + Runtime Foundation

Goal: Teams can be persisted, lanes can carry team metadata, and the frontend can spawn a team through the existing ACP lifecycle.

Files:

| File | Change |
|---|---|
| `src-tauri/src/store/db.rs` | Add migration runner and team CRUD. |
| `src-tauri/migrations/002_teams.sql` | Add team tables and lane columns once runner exists. |
| `src-tauri/src/store/models.rs` | Add team structs and extend `Lane`. |
| `src-tauri/src/commands/team.rs` | Add team/preset commands. |
| `src-tauri/src/commands/mod.rs` | Register team module. |
| `src-tauri/src/lib.rs` | Register Tauri commands. |
| `src/lib/acp-events.ts` | Extend `Lane` type with team fields. |
| `src/hooks/useWorkspace.ts` | Add `spawnTeam()` using existing ACP spawn path. |

Tests:

- Migration applies on a fresh DB.
- Existing workspace/lane creation still works.
- `team_create` rejects 0, 1, 5 members.
- `team_create` rejects no leader or multiple leaders.
- `lane_list` returns team fields.

## Phase 2 - Team Builder Modal

Goal: User can create the team shown in the screenshots.

UX:

- Modal tabs: `Create New`, `Current Teams`.
- Team name input.
- Roster with 2-4 seats.
- Each seat selects agent kind, model, directive/role, and leader radio.
- Agent can appear more than once with different directives.
- Save as preset checkbox.
- Spawn Team button disabled until validation passes.

Files:

| File | Change |
|---|---|
| `src/components/team-builder/TeamBuilder.tsx` | New modal. |
| `src/components/team-builder/TeamRosterSeat.tsx` | New seat row component. |
| `src/components/team-builder/CurrentTeams.tsx` | Current teams/preset view. |
| `src/hooks/useWorkspace.ts` | Expose `spawnTeam`. |
| `src/App.tsx` | Open modal from lane sidebar/create menu. |

Validation:

- Show `NO LEADER` until one leader is selected.
- Show `0/4 seats`, `2/4 seats`, etc.
- Disable spawn for invalid forms.

## Phase 3 - Sidebar Team Grouping

Goal: Teams appear as groups in `LaneList`, matching the left rail in the screenshots.

Display:

```text
LANES
+ 

CLAUDE

◇ saf
  2 - led by claude

◇ saf (copy)
  3 - led by claude

solo-lane
```

Behavior:

- Clicking a team header opens Meeting Room.
- Clicking a member lane opens the lane chat.
- Team group can collapse/expand.
- Team order persists later; v1 can keep created_at ordering.
- Individual lanes within team use `team_sort_order`.

Files:

| File | Change |
|---|---|
| `src/components/lane-list/LaneList.tsx` | Group by `team_id`. |
| `src/styles/global.css` | Team group styles. |

## Phase 4 - Meeting Room View

Goal: Center pane switches between normal `LaneView` and team Meeting Room.

State:

```ts
type CenterView =
  | { type: "lane"; laneId: string }
  | { type: "team"; teamId: string };
```

Meeting Room contents:

- Header: `// MEETING ROOM > team-name`
- Seat count and leader focus.
- One portrait frame per team member, ordered by `team_sort_order`.
- Leader badge.
- Directive label per seat.
- Status indicator per lane.
- Bottom composer: sends to leader by default.
- Clicking a member frame opens direct member chat mode for that agent.

Direct member chat:

- Clicking the leader keeps/defaults the composer target as `@leader`.
- Clicking a non-leader member changes the composer target to that lane.
- The composer placeholder and target chip should clearly show the selected member, for example `to codex-1 · frontend`.
- Sending a direct member message uses the existing direct inter-lane delivery path (`peer_send` / `inter_lane_deliver`) with `to_lane` set to that member lane ID.
- Direct member chat should appear in both the selected member's lane transcript and the team cross-talk feed.
- Provide a simple way to return to leader chat, such as clicking the leader frame or a `leader` target chip.

Files:

| File | Change |
|---|---|
| `src/components/meeting-room/MeetingRoom.tsx` | New center view. |
| `src/components/meeting-room/AgentFrame.tsx` | Portrait/seat component. |
| `src/components/meeting-room/TeamCommandBar.tsx` | Composer targeting leader, team member, or later team broadcast. |
| `src/App.tsx` | Switch center view by active lane/team. |

Important:

- Do not nest cards inside cards.
- Keep fixed seat dimensions so portraits/status do not shift layout.
- Use existing `CHAR_BY_ID` assets.
- Direct member chat is a UI target selection feature; do not create a separate direct-chat backend for v1.

## Phase 5 - Team Cross-Talk and Right Rail

Goal: Right side matches the screenshot: AI agents list, leader plan when available, and two chat tabs.

Tabs:

- `YOU + LEADER`: human-to-leader transcript shortcut.
- `YOU + MEMBER`: appears when a non-leader member is selected in Meeting Room.
- `TEAM CROSS-TALK`: team-scoped peer messages.

Right rail:

- AI Agents list: team members, status, directive.
- Plan panel: leader's latest plan only.
- Cross-talk list filtered to lanes in the active team.
- Selected member panel: when a member frame is selected, show that member's status/directive and direct-chat history.

Plan event requirement:

Alizode currently parses ACP `plan` events in `AcpClient`, but `useLaneStream` drops them. Add a module-level per-lane plan store, similar to lane events/status, and update it on `AcpEvent.type === "plan"`.

Files:

| File | Change |
|---|---|
| `src/hooks/useLaneStream.ts` | Store latest `PlanEntry[]` per lane. |
| `src/components/stage/Stage.tsx` | Either extend or split into team rail components. |
| `src/components/team-rail/TeamRail.tsx` | Preferred new component. |
| `src/components/team-rail/TeamPlan.tsx` | Leader plan display. |
| `src/components/team-rail/TeamCrossTalk.tsx` | Team-filtered peer rows. |

## Phase 6 - Leader Orchestration

Goal: The leader delegates work through existing peer tools.

V1 behavior:

1. User sends team prompt.
2. App routes it to leader lane.
3. Leader receives team context and can call `team_info`.
4. Leader delegates to specific lanes using `peer_send`.
5. Members reply to leader.
6. Leader synthesizes for user.

Do not implement autonomous scheduler logic in v1. The leader model decides delegation from prompt/context.

---

## Open Questions

Resolved for v1:

- Max team size: hard cap 4.
- Exactly one leader: required.
- Cross-team messaging: defer.
- Team spawn owner: frontend, not Rust.
- Directive source: Alizode-defined, not Krypton-derived.

Still open:

1. Should disbanding a team delete member lanes or convert them to solo lanes?
2. Should teams auto-respawn ACP clients on app restart, or only show persisted inactive lanes until selected?
3. Should presets be global or workspace-scoped? Current plan says global.
4. Should duplicate agent kinds get IDs like `omo-1`, `omo-2` within the team or continue global lane count?

---

## Implementation Order

1. Migration runner + team DB schema.
2. Extend lane model/types with team fields.
3. Add Rust team CRUD commands.
4. Refactor `useWorkspace` spawn helper and add frontend `spawnTeam`.
5. Build Team Builder modal.
6. Group sidebar lanes by team.
7. Add Meeting Room center view.
8. Add `team_info` and enhanced `peer_list`.
9. Add right rail team views and leader plan store.
10. Add `@leader`; defer `@team` until fan-out tests are solid.

---

## Test Plan

Rust:

- Migration runner applies `001` then `002` once.
- `team_create` validation.
- `team_list` returns teams with ordered members.
- Deleting workspace cascades teams and lane data correctly.
- Deleting team behavior matches chosen disband policy.

Frontend unit:

- Team Builder validation.
- `spawnTeam` appends returned lanes immutably.
- Sidebar groups lanes by `team_id`.
- Meeting Room orders seats by `team_sort_order`.
- Leader plan panel uses leader lane's plan only.

Integration/manual:

- Spawn a 3-seat team.
- Verify each lane launches through existing ACP path and has harness MCP tools.
- Verify `peer_list` includes team fields.
- Verify `team_info` from each lane returns correct role/leader state.
- Send a user prompt to Meeting Room; confirm it goes to leader.
- Click a non-leader member frame and send a direct message; confirm it delivers only to that member.
- Leader sends `peer_send` to member; transcript appears in both lanes and team cross-talk.

---

## Main Risks

1. Bypassing React ACP lifecycle. Avoided by frontend-owned spawning.
2. Migrations silently not running. Fixed by migration runner prerequisite.
3. Broadcast semantics causing stuck `awaiting_peer`. Defer broad `@team` until fan-out lifecycle is tested.
4. Directive injection not supported by ACP. Treat as Alizode prompt/context, not backend-native system prompt.
5. UI state split between lane and team views. Use explicit `CenterView` state instead of overloading `activeLaneId`.
