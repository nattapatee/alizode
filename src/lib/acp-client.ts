import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type {
  AcpAvailableCommand,
  AcpBackendDescriptor,
  AcpConfigOption,
  AcpEvent,
  AcpMcpServerDescriptor,
  AcpModelInfo,
  AcpSessionListResult,
  AgentInfo,
  AgentInitInfo,
  AgentSessionInfo,
  ContentBlock,
  PlanEntry,
  PermissionOption,
  StopReason,
  ToolCall,
  ToolCallUpdate,
  UsageInfo,
} from './acp-types';

interface RawAcpEvent {
  type: 'session_update' | 'permission_request' | 'stop' | 'error' | 'fs_activity' | 'fs_write_pending';
  kind?: string;
  update?: {
    sessionUpdate: string;
    content?: ContentBlock | { type: 'text'; text: string };
    [k: string]: unknown;
  };
  requestId?: number;
  params?: {
    toolCall?: ToolCall;
    options?: PermissionOption[];
    [k: string]: unknown;
  };
  stopReason?: StopReason;
  reason?: string;
  message?: string;
  method?: 'read' | 'write';
  path?: string;
  ok?: boolean;
  error?: string;
  oldText?: string;
  newText?: string;
}

export class AcpClient {
  private session: number;
  private backend: string;
  private unlisten: UnlistenFn | null = null;
  private listeners: Array<(e: AcpEvent) => void> = [];
  private disposed = false;
  dead = false;
  configOptions: AcpConfigOption[] = [];
  modelInfo: AcpModelInfo | null = null;

  private constructor(session: number, backend: string) {
    this.session = session;
    this.backend = backend;
  }

  static async listBackends(): Promise<AcpBackendDescriptor[]> {
    return invoke<AcpBackendDescriptor[]>('acp_list_backends');
  }

  static async spawn(
    backendId: string,
    cwd: string | null,
    mcpServers: AcpMcpServerDescriptor[] = [],
    model: string | null = null,
  ): Promise<AcpClient> {
    const session = await invoke<number>('acp_spawn', { backendId, cwd, model, mcpServers });
    const client = new AcpClient(session, backendId);
    client.unlisten = await listen<RawAcpEvent>(`acp-event-${session}`, (e) => {
      client.handleRaw(e.payload);
    });
    return client;
  }

  get sessionId(): number {
    return this.session;
  }

  get backendId(): string {
    return this.backend;
  }

  async initialize(
    onInitialized?: (caps: unknown) => Promise<AcpMcpServerDescriptor[] | undefined>,
  ): Promise<AgentInfo> {
    const init = await this.initializeOnly();
    if (onInitialized) {
      const servers = await onInitialized(init.agent_capabilities);
      if (servers !== undefined) {
        await this.setMcpServers(servers);
      }
    }
    const sn = await this.sessionNew();
    this.configOptions = sn.config_options;
    this.modelInfo = sn.models;
    return {
      agent_protocol_version: init.agent_protocol_version,
      auth_methods: init.auth_methods,
      agent_capabilities: init.agent_capabilities,
      session_id: sn.session_id,
    };
  }

  async initializeOnly(): Promise<AgentInitInfo> {
    return invoke<AgentInitInfo>('acp_initialize', { session: this.session });
  }

  async setMcpServers(mcpServers: AcpMcpServerDescriptor[]): Promise<void> {
    await invoke('acp_set_mcp_servers', { session: this.session, mcpServers });
  }

  async sessionNew(): Promise<AgentSessionInfo> {
    return invoke<AgentSessionInfo>('acp_session_new', { session: this.session });
  }

  async listSessions(cwd: string | null, cursor?: string | null): Promise<AcpSessionListResult> {
    return invoke<AcpSessionListResult>('acp_session_list', {
      session: this.session,
      cwd,
      cursor: cursor ?? null,
    });
  }

  async resumeSession(sessionId: string): Promise<AgentSessionInfo> {
    return invoke<AgentSessionInfo>('acp_session_resume', {
      session: this.session,
      sessionId,
    });
  }

  async loadSession(sessionId: string): Promise<AgentSessionInfo> {
    return invoke<AgentSessionInfo>('acp_session_load', {
      session: this.session,
      sessionId,
    });
  }

  onEvent(cb: (e: AcpEvent) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  async prompt(blocks: ContentBlock[]): Promise<StopReason> {
    const result = await invoke<{ stopReason: StopReason; usage?: UsageInfo; _meta?: { usage?: UsageInfo } }>(
      'acp_prompt',
      { session: this.session, blocks },
    );
    const stopReason: StopReason = result.stopReason ?? 'end_turn';
    const usage = result.usage ?? result._meta?.usage;
    if (usage && Object.keys(usage).length > 0) {
      for (const cb of this.listeners.slice()) cb({ type: 'usage', usage });
    }
    for (const cb of this.listeners.slice()) cb({ type: 'stop', stopReason });
    return stopReason;
  }

  async cancel(): Promise<void> {
    await invoke('acp_cancel', { session: this.session });
  }

  async respondPermission(requestId: number, optionId: string | null): Promise<void> {
    await invoke('acp_permission_response', {
      session: this.session,
      requestId,
      optionId,
    });
  }

  async respondFsWrite(requestId: number, accept: boolean): Promise<void> {
    await invoke('acp_fs_write_response', {
      session: this.session,
      requestId,
      accept,
    });
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    await invoke('acp_set_config_option', {
      session: this.session,
      configId,
      value,
    });
    const opt = this.configOptions.find((o) => o.id === configId);
    if (opt) opt.currentValue = value;
  }

  getConfigOption(configId: string): AcpConfigOption | undefined {
    return this.configOptions.find((o) => o.id === configId);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }
    try {
      await invoke('acp_dispose', { session: this.session });
    } catch {
      // dispose may fail if process already exited
    }
  }

  private handleRaw(raw: RawAcpEvent): void {
    if (this.disposed) return;
    let event: AcpEvent | null = null;
    switch (raw.type) {
      case 'session_update': {
        const update = (raw.update ?? {}) as {
          sessionUpdate?: string;
          content?: unknown;
          entries?: PlanEntry[];
          [k: string]: unknown;
        };
        switch (raw.kind) {
          case 'user_message_chunk':
            event = { type: 'user_message_chunk', text: extractText(update.content) };
            break;
          case 'agent_message_chunk':
            event = { type: 'message_chunk', text: extractText(update.content) };
            break;
          case 'agent_thought_chunk':
            event = { type: 'thought_chunk', text: extractText(update.content) };
            break;
          case 'tool_call':
            event = { type: 'tool_call', call: update as unknown as ToolCall };
            break;
          case 'tool_call_update':
            event = { type: 'tool_call_update', update: update as unknown as ToolCallUpdate };
            break;
          case 'plan': {
            const entries = update.entries ?? [];
            event = { type: 'plan', entries };
            break;
          }
          case 'usage_update': {
            const u = update as Record<string, unknown>;
            const cost = u.cost as { amount?: number; currency?: string } | undefined;
            const usage: UsageInfo = {
              used: typeof u.used === 'number' ? u.used : undefined,
              size: typeof u.size === 'number' ? u.size : undefined,
              cost:
                cost && typeof cost.amount === 'number'
                  ? { amount: cost.amount, currency: cost.currency ?? 'USD' }
                  : undefined,
            };
            event = { type: 'usage', usage };
            break;
          }
          case 'available_commands_update': {
            const cmds = (update.availableCommands as Array<Record<string, unknown>> | undefined) ?? [];
            const commands: AcpAvailableCommand[] = cmds
              .map((c) => {
                const input = c.input as { hint?: string } | undefined;
                return {
                  name: typeof c.name === 'string' ? c.name : '',
                  description: typeof c.description === 'string' ? c.description : undefined,
                  inputHint: typeof input?.hint === 'string' ? input.hint : undefined,
                };
              })
              .filter((c) => c.name.length > 0);
            event = { type: 'available_commands', commands };
            break;
          }
          case 'current_mode_update': {
            const modeId = typeof update.currentModeId === 'string' ? update.currentModeId : '';
            event = { type: 'mode_update', modeId };
            break;
          }
        }
        break;
      }
      case 'fs_activity': {
        event = {
          type: 'fs_activity',
          method: raw.method === 'write' ? 'write' : 'read',
          path: typeof raw.path === 'string' ? raw.path : '',
          ok: Boolean(raw.ok),
          error: typeof raw.error === 'string' ? raw.error : undefined,
        };
        break;
      }
      case 'fs_write_pending': {
        event = {
          type: 'fs_write_pending',
          requestId: raw.requestId ?? 0,
          path: typeof raw.path === 'string' ? raw.path : '',
          oldText: typeof raw.oldText === 'string' ? raw.oldText : '',
          newText: typeof raw.newText === 'string' ? raw.newText : '',
        };
        break;
      }
      case 'permission_request': {
        const params = raw.params ?? {};
        event = {
          type: 'permission_request',
          requestId: raw.requestId ?? 0,
          toolCall: params.toolCall ?? ({} as ToolCall),
          options: params.options ?? [],
        };
        break;
      }
      case 'stop':
        if (raw.reason === 'subprocess exited') {
          this.dead = true;
        }
        event = { type: 'stop', stopReason: (raw.stopReason ?? 'end_turn') as StopReason };
        break;
      case 'error':
        event = { type: 'error', message: raw.message ?? 'unknown error' };
        break;
    }
    if (event) {
      for (const cb of this.listeners.slice()) cb(event);
    }
  }
}

function extractText(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const c = content as { type?: string; text?: string };
  if (c.type === 'text' && typeof c.text === 'string') return c.text;
  return '';
}
