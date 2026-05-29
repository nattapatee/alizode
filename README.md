<div align="center">

# Alizode

Native multi-agent AI coding harness for running ACP-compatible agents side-by-side in coordinated lanes.

![Tauri](https://img.shields.io/badge/Tauri-2.x-24c8db?style=flat-square)
![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square)
![Rust](https://img.shields.io/badge/Rust-stable-b7410e?style=flat-square)
![License](https://img.shields.io/badge/license-private-lightgrey?style=flat-square)

![Alizode](screenshot/Screenshot%202569-05-26%20at%2016.41.17.png)

</div>

## Overview

Alizode runs Claude, Codex, Gemini, OpenCode, Cursor, and custom ACP-compatible agents in parallel desktop lanes. It combines a native Tauri 2.x Rust backend with a React 19 TypeScript frontend, inspired by [Krypton](https://github.com/wk-j/krypton) but shaped around a richer multi-agent workspace and team meeting-room flow.

| Surface | What it does |
|---------|--------------|
| **Lanes** | Run independent agents side-by-side in the same workspace |
| **Teams** | Spawn 2–4 coordinated agents with one leader and role-based members |
| **Meeting Room** | Focused team view with seats, roster, leader plan, per-member chat, and cross-talk |
| **ACP backends** | Claude, Codex, Gemini, OpenCode, Cursor, and custom adapters |
| **MCP bridge** | Per-lane tools for shell, edits, peer messaging, memory, review, and team info |

## Features

- **Multi-lane workspaces** — run multiple AI agents in parallel within a workspace
- **Agent teams** — spawn a 2–4 member team with one leader and role-based members; the leader plans, delegates via peer messaging, checks task replies, and synthesizes the result. See [Teams](#teams).
- **Meeting Room** — a team-focused center view with a seat grid, AI-agents roster, leader plan panel, per-member chat, and team cross-talk feed
- **6 backends** — Claude, Codex, Gemini, OpenCode, Cursor, and custom agents via ACP (Agent Client Protocol)
- **Peer messaging** — agents communicate across lanes with `@lane-id` (or `@leader`) mentions
- **Runtime config** — change model, effort level, and permission mode per-lane via `/model`, `/effort`, `/mode`
- **Permission gating** — review and approve/deny tool calls with diff preview for file writes
- **Session management** — resume or load previous agent sessions
- **Shared memory** — key-value store scoped per workspace
- **MCP bridge** — each lane gets a sidecar MCP server exposing custom tools (bash, edit, peer send, memory, review)
- **Library mode** — browse and read markdown docs from any folder
- **Animated agent portraits** — MP4 video portraits with speed varying by status (idle/thinking/talking)
- **Code editor** — built-in CodeMirror 6 editor with Atom One Dark theme, syntax highlighting, undo/redo
- **Live status indicators** — distinct processing (dots) and transmitting (equalizer bars) animations in the chat terminal
- **Agent picker** — character selection grid with video preview on hover

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8
- At least one ACP backend installed:
  - Claude: `npm i -g @agentclientprotocol/claude-agent-acp`
  - Codex: `npm i -g @agentclientprotocol/codex-acp`
  - Gemini: `gemini` CLI with `--experimental-acp` support
  - OpenCode: `opencode` CLI with `acp` subcommand

## Quick Start

```bash
# Install frontend dependencies
pnpm install

# Run dev (starts Vite + Rust, hot-reloads both)
pnpm tauri dev
```

On first launch, create a workspace and add a lane to start chatting with an agent.

## Teams

Spawn a coordinated group of agents instead of a single lane.

1. In the **LANES** sidebar, click **`+`** → **team** to open the Team Builder.
2. Add 2–4 members, assign each a role (one must be **leader**), name the team, and optionally save it as a preset.
3. Spawn — members appear under a `◇` group in the sidebar and the **Meeting Room** opens.

In the Meeting Room: click a seat (or a roster row) to focus a member, then message it from the composer. Message the **leader** to have it delegate subtasks to members via `peer_send` and report back. The right rail shows the focused member's conversation, the leader's plan, and team cross-talk.

How coordination works:

- The leader gets a role-context preamble, creates an ordered task plan, and delegates focused work with the `peer_send` MCP tool.
- Members complete the assigned task and reply with `peer_reply`. Replies route back and resume the leader automatically.
- The leader checks each reply against the task before sending the next dependent task.
- Agents can call `team_info` for the live roster, and `peer_list` includes team fields.
- `@leader <message>` from any lane routes to that lane's team leader.

### Team roles

| Role | Focus |
|------|-------|
| `leader` | Task plan, delegation, reply checking, final synthesis |
| `frontend` | React/Tauri UI, responsive behavior, accessibility, loading/error states |
| `backend` | Rust/Tauri commands, ACP/MCP flows, persistence, API contracts |
| `qa` | Verification, defects, reproduction steps, test coverage and residual risk |
| `architect` | System boundaries, data flow, module ownership, migration risk |
| `fullstack` | End-to-end integration across UI, backend, persistence, and types |
| `devops` | Build scripts, packaging, local dev, CI assumptions, release risk |
| `security` | Input validation, permission boundaries, secrets, command execution, dependencies |
| `data` | Schemas, migrations, serialization contracts, data integrity |
| `database` | SQL schema design, migrations, indexes, transactions, constraints, query behavior |
| `quant` | Neutral quantitative analysis, assumptions, model limits, uncertainty |
| `market_analyst` | Venue rules, market structure, resolution criteria, public data |
| `risk` | Trading risk register, constraints, severity, mitigations |
| `trading_ops` | Manual planning worksheets, venue prerequisites, non-executing operations |

Trading-related roles are research, planning, and risk-review roles. They do not recommend trades, set position sizes, request credentials, or place orders.

### Starter presets

The Team Builder includes starter presets that can be spawned directly or loaded and edited:

| Preset | Seats |
|--------|-------|
| **development team** | leader, frontend, backend, qa |
| **architecture team** | leader, architect, full-stack, qa |
| **security team** | leader, security, backend, qa |
| **data platform team** | leader, data, backend, devops |
| **database team** | leader, database, backend, qa |
| **trading research team** | leader, quant, market analyst, risk |
| **trading ops team** | leader, trading ops, risk, data |

### Editing role context

The context injected into each lane's first message is defined in **`src/config/team-directives.json`** — edit it to change what each role is told. Templates support the placeholders `{team}`, `{role}`, `{leader}`, `{roster}`, and `{laneId}`. The `leader` template applies to the leader; otherwise `members.<role>` is used, falling back to `members.default`. (Bundled at build time — edits apply live in `pnpm tauri dev`.)

## Build

```bash
# Production build
pnpm tauri build
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/model` | Switch model (uses ACP config when available, otherwise static picker) |
| `/effort` | Set effort level (Claude: low/medium/high/xhigh/max) |
| `/mode` | Set permission mode (auto/plan/acceptEdits/etc.) |
| `/sessions` | Browse and resume previous sessions |
| `/clear` | Clear lane display |
| `/stop` | Stop the current lane |
| `/cancel` | Cancel the current turn |
| `/export` | Copy session as JSONL to clipboard |
| `/help` | Show all commands |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+T` | New lane |
| `Cmd+W` | Close lane |
| `Cmd+[` / `Cmd+]` | Switch lanes |
| `Esc` | Cancel current turn |

## Architecture

```
src/                          # React 19 + Tailwind frontend
  components/                 # UI components (workspace tabs, lane view, command bar, stage, editor, agent picker)
    team-builder/             # Team Builder modal
    meeting-room/             # Team center view
    team-rail/                # Leader plan, team cross-talk, per-member chat
  hooks/                      # useWorkspace, useLaneStream, useHarnessCoordinator
  lib/                        # ACP client, types, event definitions, character registry, team-context builder
  config/team-directives.json # Editable per-role context templates

src-tauri/                    # Rust backend
  src/
    core/acp.rs               # ACP registry, JSON-RPC client, spawn/prompt lifecycle
    core/inter_lane.rs         # Inter-lane peer messaging coordinator
    commands/                  # Tauri IPC command handlers (incl. team CRUD)
    store/                     # SQLite database (WAL mode)
    permission/                # Tool permission engine
    harness_mcp.rs             # HTTP MCP harness (peer_send/peer_reply/peer_list/team_info)
  src/bin/mcp_bridge.rs        # Per-lane MCP sidecar binary (stdio)
  migrations/                  # SQLite schema (001_init, 002_teams)
```

Two-process model: Tauri app manages state and ACP subprocesses. MCP bridge binary spawns per-lane as a sidecar, communicates via shared SQLite. Each lane's transcript and status are captured globally (`attachClientStream`) so non-active lanes — like background team members — stream correctly.

## License

Private. All rights reserved.
