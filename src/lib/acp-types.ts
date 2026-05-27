export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string; uri?: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name?: string; mimeType?: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string; blob?: string } };

export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other';

export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ToolCallContent {
  type: 'content' | 'diff' | 'terminal';
  path?: string;
  oldText?: string | null;
  newText?: string;
  content?: ContentBlock;
  terminalId?: string;
}

export interface ToolCallLocation {
  path: string;
  line?: number;
}

export interface ToolCall {
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolStatus;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface ToolCallUpdate {
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolStatus;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface PlanEntry {
  content: string;
  priority?: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

export interface AgentInitInfo {
  agent_protocol_version: number;
  auth_methods: unknown[];
  agent_capabilities: Record<string, unknown>;
}

export interface AcpConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: 'select' | 'number' | 'boolean';
  currentValue: string;
  options?: Array<{ value: string; name: string; description?: string }>;
}

export interface AcpModelInfo {
  availableModels: Array<{ modelId: string; name: string; description?: string }>;
  currentModelId: string;
}

export interface AgentSessionInfo {
  session_id: string;
  config_options: AcpConfigOption[];
  models: AcpModelInfo | null;
}

export interface AgentInfo {
  agent_protocol_version: number;
  auth_methods: unknown[];
  agent_capabilities: Record<string, unknown>;
  session_id: string;
}

export interface AcpBackendDescriptor {
  id: string;
  display_name: string;
  command: string;
}

export interface AcpEnvVar {
  name: string;
  value: string;
}

export interface AcpHttpHeader {
  name: string;
  value: string;
}

export interface AcpMcpServerStdio {
  name: string;
  type?: 'stdio';
  command: string;
  args: string[];
  env: AcpEnvVar[];
}

export interface AcpMcpServerHttp {
  name: string;
  type: 'http';
  url: string;
  headers: AcpHttpHeader[];
}

export interface AcpMcpServerSse {
  name: string;
  type: 'sse';
  url: string;
  headers: AcpHttpHeader[];
}

export type AcpMcpServerDescriptor = AcpMcpServerStdio | AcpMcpServerHttp | AcpMcpServerSse;

export interface AcpMcpCapabilities {
  http?: boolean;
  sse?: boolean;
}

export interface AcpSessionInfo {
  sessionId: string;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
}

export interface AcpSessionListResult {
  sessions: AcpSessionInfo[];
  nextCursor?: string | null;
}

export interface UsageInfo {
  used?: number;
  size?: number;
  cost?: { amount: number; currency: string };
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
}

export interface AcpAvailableCommand {
  name: string;
  description?: string;
  inputHint?: string;
}

export type HarnessLaneStatus =
  | 'starting'
  | 'idle'
  | 'busy'
  | 'needs_permission'
  | 'awaiting_peer'
  | 'error'
  | 'stopped';

export interface LaneStatusEvent {
  laneId: string;
  prev: HarnessLaneStatus;
  next: HarnessLaneStatus;
  at: number;
}

export interface HarnessMcpLaneStats {
  lane_label: string;
  initialize_count: number;
  tools_list_count: number;
  tools_call_count: number;
  last_method: string;
  last_seen_at: number;
}

export type AcpEvent =
  | { type: 'user_message_chunk'; text: string }
  | { type: 'message_chunk'; text: string }
  | { type: 'thought_chunk'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_call_update'; update: ToolCallUpdate }
  | { type: 'plan'; entries: PlanEntry[] }
  | { type: 'permission_request'; requestId: number; toolCall: ToolCall; options: PermissionOption[] }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'available_commands'; commands: AcpAvailableCommand[] }
  | { type: 'mode_update'; modeId: string }
  | { type: 'fs_activity'; method: 'read' | 'write'; path: string; ok: boolean; error?: string }
  | { type: 'fs_write_pending'; requestId: number; path: string; oldText: string; newText: string }
  | { type: 'stop'; stopReason: StopReason }
  | { type: 'error'; message: string };
