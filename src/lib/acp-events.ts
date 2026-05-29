export type LaneEventKind =
  | "Sys"
  | "UserIn"
  | "AgentText"
  | "Thought"
  | "ToolCall"
  | "ToolResult"
  | "PeerIn"
  | "PeerOut"
  | "PermPrompt"
  | "PermDecision"
  | "Error";

export type LaneStatus = "Idle" | "Running" | "Waiting" | "Error" | "Stopped";

import type { HarnessLaneStatus } from "./acp-types";

const HARNESS_TO_DB: Record<HarnessLaneStatus, LaneStatus> = {
  starting: "Running",
  idle: "Idle",
  busy: "Running",
  needs_permission: "Waiting",
  awaiting_peer: "Waiting",
  error: "Error",
  stopped: "Stopped",
};

export function harnessStatusToDbStatus(s: HarnessLaneStatus): LaneStatus {
  return HARNESS_TO_DB[s];
}

export type AgentKind = "Claude" | "Codex" | "Gemini" | "OpenCode" | "Cursor" | "Custom";

export interface Workspace {
  id: string;
  name: string;
  cwd: string;
  created_at: number;
}

export interface Lane {
  id: string;
  workspace_id: string;
  agent_kind: AgentKind;
  protocol: string;
  model: string;
  is_main: boolean;
  status: LaneStatus;
  cwd: string;
  created_at: number;
  team_id: string | null;
  directive: string;
  is_leader: boolean;
  team_sort_order: number;
}

export interface Team {
  id: string;
  workspace_id: string;
  name: string;
  preset_id: string | null;
  created_at: number;
}

export interface TeamPreset {
  id: string;
  name: string;
  created_at: number;
}

export interface TeamPresetMember {
  id: string;
  preset_id: string;
  agent_kind: string;
  model: string;
  directive: string;
  is_leader: boolean;
  sort_order: number;
}

export interface TeamPresetWithMembers {
  preset: TeamPreset;
  members: TeamPresetMember[];
}

export interface CreateTeamMemberInput {
  agent_kind: string;
  model: string;
  directive: string;
  is_leader: boolean;
  sort_order: number;
}

export interface CreateTeamInput {
  workspace_id: string;
  name: string;
  cwd: string;
  save_as_preset: boolean;
  members: CreateTeamMemberInput[];
}

export interface CreateTeamResult {
  team: Team;
  lanes: Lane[];
}

export interface LaneEvent {
  workspace_id: string;
  lane_id: string;
  seq: number;
  ts: number;
  kind: LaneEventKind;
  payload: Record<string, unknown>;
}

export interface MemoryEntry {
  workspace_id: string;
  namespace: string;
  key: string;
  value: unknown;
  updated_at: number;
}

// --- Typed payload extractors ---

export function getEventText(event: LaneEvent): string {
  const p = event.payload;
  if (typeof p.text === "string") return p.text;
  if (typeof p.output === "string") return p.output;
  if (Array.isArray(p.output)) {
    return p.output
      .map((block: Record<string, unknown>) =>
        typeof block.text === "string" ? block.text : JSON.stringify(block),
      )
      .join("\n");
  }
  return JSON.stringify(p);
}

export function getToolName(event: LaneEvent): string {
  const p = event.payload;
  if (typeof p.tool === "string") return p.tool;
  if (typeof p.name === "string") return p.name;
  return "unknown";
}

export function getToolInput(event: LaneEvent): string | undefined {
  const p = event.payload;
  const input = p.input ?? p.args;
  if (input == null) return undefined;
  if (typeof input === "string") return input;
  if (typeof input === "object") {
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length === 0) return undefined;
    return entries
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(", ");
  }
  return JSON.stringify(input);
}

export function getToolDuration(event: LaneEvent): number | undefined {
  const p = event.payload;
  return typeof p.duration_ms === "number" ? p.duration_ms : undefined;
}

export function getToolError(event: LaneEvent): string | undefined {
  const p = event.payload;
  return typeof p.error === "string" ? p.error : undefined;
}

export function getPeerInfo(event: LaneEvent): {
  fromLane: string;
  toLane: string;
  text: string;
  isReview: boolean;
} {
  const p = event.payload;
  const text = typeof p.text === "string" ? p.text : JSON.stringify(p);
  return {
    fromLane: typeof p.from_lane === "string" ? p.from_lane : "",
    toLane: typeof p.to_lane === "string" ? p.to_lane : "",
    text,
    isReview: text.includes("[REVIEW REQUEST"),
  };
}

export function getPermInfo(event: LaneEvent): {
  requestId: string;
  tool: string;
  category: string;
  detail: string;
  decision: string;
} {
  const p = event.payload;
  return {
    requestId: typeof p.request_id === "string" ? p.request_id : "",
    tool: typeof p.tool === "string" ? p.tool : "",
    category: typeof p.category === "string" ? p.category : "",
    detail: typeof p.detail === "string" ? p.detail : "",
    decision: typeof p.decision === "string" ? p.decision : "",
  };
}

// --- View segments for grouped rendering ---

export type ViewSegment =
  | { type: "event"; event: LaneEvent }
  | { type: "agent-text"; chunks: string[]; firstSeq: number; isSealed: boolean };

export function groupEventsIntoSegments(events: LaneEvent[]): ViewSegment[] {
  const segments: ViewSegment[] = [];
  let agentChunks: string[] = [];
  let firstSeq = 0;

  for (const ev of events) {
    if (ev.kind === "AgentText") {
      if (agentChunks.length === 0) firstSeq = ev.seq;
      agentChunks.push(getEventText(ev));
    } else if (ev.kind !== "Thought") {
      if (agentChunks.length > 0) {
        segments.push({
          type: "agent-text",
          chunks: [...agentChunks],
          firstSeq,
          isSealed: true,
        });
        agentChunks = [];
      }
      segments.push({ type: "event", event: ev });
    }
  }
  if (agentChunks.length > 0) {
    segments.push({
      type: "agent-text",
      chunks: [...agentChunks],
      firstSeq,
      isSealed: false,
    });
  }

  return segments;
}

/** Live thought for the current turn — blank once the agent answer has started. */
export function getActiveThoughtText(events: LaneEvent[]): string {
  let turnStart = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === "UserIn") {
      turnStart = i;
      break;
    }
  }
  if (turnStart < 0) return "";

  const turnEvents = events.slice(turnStart + 1);
  if (turnEvents.some((e) => e.kind === "AgentText")) {
    return "";
  }

  const text = turnEvents
    .filter((e) => e.kind === "Thought")
    .map((e) => getEventText(e))
    .join("");

  return text.trim();
}
