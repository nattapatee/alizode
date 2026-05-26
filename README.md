# Alizode

Multi-agent AI coding harness. Run Claude, Codex, Gemini, OpenCode, and other ACP-compatible agents side-by-side in parallel lanes.

Built with Tauri 2.x (Rust backend) + React 19 (TypeScript frontend). Inspired by [Krypton](https://github.com/wk-j/krypton), an Electron-based ACP harness — Alizode reimagines the multi-agent workflow as a native desktop app with a React component architecture.

![Alizode](screenshot/Screenshot%202569-05-26%20at%2016.41.17.png)

## Features

- **Multi-lane workspaces** — run multiple AI agents in parallel within a workspace
- **6 backends** — Claude, Codex, Gemini, OpenCode, Cursor, and custom agents via ACP (Agent Client Protocol)
- **Peer messaging** — agents communicate across lanes with `@lane-id` mentions
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
  hooks/                      # useWorkspace, useLaneStream
  lib/                        # ACP client, types, event definitions, character registry

src-tauri/                    # Rust backend
  src/
    core/acp.rs               # ACP registry, JSON-RPC client, spawn/prompt lifecycle
    core/inter_lane.rs         # Inter-lane peer messaging coordinator
    commands/                  # Tauri IPC command handlers
    store/                     # SQLite database (WAL mode)
    permission/                # Tool permission engine
  src/bin/mcp_bridge.rs        # Per-lane MCP sidecar binary
  migrations/                  # SQLite schema
```

Two-process model: Tauri app manages state and ACP subprocesses. MCP bridge binary spawns per-lane as a sidecar, communicates via shared SQLite.

## License

Private. All rights reserved.
