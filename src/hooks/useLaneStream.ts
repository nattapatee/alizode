import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LaneEvent, LaneStatus } from "../lib/acp-events";
import { harnessStatusToDbStatus } from "../lib/acp-events";
import type { AcpClient } from "../lib/acp-client";
import type { AcpEvent, HarnessLaneStatus } from "../lib/acp-types";

function shortToolName(title?: string, kind?: string, toolCallId?: string): string {
  if (title) return title;
  if (kind && kind !== 'other') return kind;
  if (toolCallId) {
    const clean = toolCallId
      .replace(/^tools?_/i, '')
      .replace(/#.*$/, '')
      .replace(/^toolu_[a-zA-Z0-9]+$/, 'tool');
    return clean.length > 20 ? clean.slice(0, 20) : clean;
  }
  return "tool";
}

function acpEventToLaneEvent(
  acpEvent: AcpEvent,
  laneId: string,
  workspaceId: string,
): LaneEvent | null {
  const base = {
    workspace_id: workspaceId,
    lane_id: laneId,
    seq: Date.now(),
    ts: Date.now(),
  };
  switch (acpEvent.type) {
    case 'message_chunk':
      return { ...base, kind: "AgentText", payload: { text: acpEvent.text } };
    case 'thought_chunk':
      return { ...base, kind: "Thought", payload: { text: acpEvent.text } };
    case 'tool_call': {
      const tool = shortToolName(acpEvent.call.title, acpEvent.call.kind, acpEvent.call.toolCallId);
      return {
        ...base,
        kind: "ToolCall",
        payload: {
          tool,
          name: tool,
          kind: acpEvent.call.kind,
          status: acpEvent.call.status,
          input: acpEvent.call.rawInput,
        },
      };
    }
    case 'tool_call_update':
      if (acpEvent.update.status === 'completed' || acpEvent.update.status === 'failed') {
        const tool = shortToolName(acpEvent.update.title, acpEvent.update.kind, acpEvent.update.toolCallId);
        return {
          ...base,
          kind: "ToolResult",
          payload: {
            tool,
            status: acpEvent.update.status,
            output: acpEvent.update.rawOutput,
            error: acpEvent.update.status === 'failed' ? 'Tool failed' : undefined,
          },
        };
      }
      return null;
    case 'permission_request': {
      const tool = shortToolName(acpEvent.toolCall.title, acpEvent.toolCall.kind, acpEvent.toolCall.toolCallId);
      return {
        ...base,
        kind: "PermPrompt",
        payload: {
          request_id: acpEvent.requestId,
          tool,
          options: acpEvent.options,
        },
      };
    }
    case 'error':
      return { ...base, kind: "Error", payload: { text: acpEvent.message } };
    case 'stop':
      return { ...base, kind: "Sys", payload: { text: `turn ended: ${acpEvent.stopReason}` } };
    default:
      return null;
  }
}

interface DrainAction {
  lane_id: string;
  prompt_text: string;
}

// ─── Module-level per-lane event storage ──────────────────────────

const TRANSCRIPT_MAX = 300;
const TRANSCRIPT_WINDOW_DEFAULT = 60;
const TRANSCRIPT_WINDOW_STEP = 60;

const allEvents = new Map<string, LaneEvent[]>();

function getEvents(key: string | null): LaneEvent[] {
  return key ? (allEvents.get(key) ?? []) : [];
}

export function getLaneEvents(workspaceId: string, laneId: string): LaneEvent[] {
  return getEvents(`${workspaceId}:${laneId}`);
}

function pushEvent(key: string, event: LaneEvent): LaneEvent[] {
  const prev = allEvents.get(key) ?? [];
  const next = [...prev, event];
  if (next.length > TRANSCRIPT_MAX) {
    next.splice(0, next.length - TRANSCRIPT_MAX);
  }
  allEvents.set(key, next);
  return next;
}

const LANE_EVENT_SIGNAL = "alizode:lane-event";

// ─── Module-level per-lane transcript window ─────────────────────

const transcriptWindows = new Map<string, number>();
const TRANSCRIPT_WINDOW_SIGNAL = "alizode:transcript-window";

function getTranscriptWindow(key: string | null): number {
  return key ? (transcriptWindows.get(key) ?? TRANSCRIPT_WINDOW_DEFAULT) : TRANSCRIPT_WINDOW_DEFAULT;
}

export function expandTranscriptWindow(workspaceId: string, laneId: string): void {
  const key = `${workspaceId}:${laneId}`;
  const current = transcriptWindows.get(key) ?? TRANSCRIPT_WINDOW_DEFAULT;
  const total = (allEvents.get(key) ?? []).length;
  const next = current + TRANSCRIPT_WINDOW_STEP >= total
    ? TRANSCRIPT_WINDOW_DEFAULT
    : current + TRANSCRIPT_WINDOW_STEP;
  transcriptWindows.set(key, next);
  window.dispatchEvent(new CustomEvent(TRANSCRIPT_WINDOW_SIGNAL, { detail: key }));
}

export function resetTranscriptWindow(workspaceId: string, laneId: string): void {
  const key = `${workspaceId}:${laneId}`;
  transcriptWindows.set(key, TRANSCRIPT_WINDOW_DEFAULT);
  window.dispatchEvent(new CustomEvent(TRANSCRIPT_WINDOW_SIGNAL, { detail: key }));
}

// ─── Module-level per-lane status machine ─────────────────────────

const laneStatuses = new Map<string, HarnessLaneStatus>();
const LANE_STATUS_SIGNAL = "alizode:lane-status";

function getLaneStatus(key: string | null): HarnessLaneStatus {
  return key ? (laneStatuses.get(key) ?? "idle") : "idle";
}

export function setHarnessLaneStatus(
  workspaceId: string,
  laneId: string,
  next: HarnessLaneStatus,
): void {
  const key = `${workspaceId}:${laneId}`;
  const prev = laneStatuses.get(key) ?? "idle";
  if (prev === next) return;
  laneStatuses.set(key, next);
  window.dispatchEvent(
    new CustomEvent(LANE_STATUS_SIGNAL, { detail: { key, laneId, prev, next } }),
  );
}

const BUSY_STATUSES: ReadonlySet<HarnessLaneStatus> = new Set([
  "starting",
  "busy",
  "needs_permission",
  "awaiting_peer",
]);

// ─── Public helpers ───────────────────────────────────────────────

export function pushSystemEvent(workspaceId: string, laneId: string, text: string) {
  const key = `${workspaceId}:${laneId}`;
  pushEvent(key, {
    workspace_id: workspaceId,
    lane_id: laneId,
    seq: Date.now(),
    ts: Date.now(),
    kind: "Sys",
    payload: { text },
  });
  window.dispatchEvent(new CustomEvent(LANE_EVENT_SIGNAL, { detail: key }));
}

export function pushPeerEvent(
  workspaceId: string,
  laneId: string,
  kind: "PeerIn" | "PeerOut",
  fromLane: string,
  toLane: string,
  text: string,
) {
  const key = `${workspaceId}:${laneId}`;
  pushEvent(key, {
    workspace_id: workspaceId,
    lane_id: laneId,
    seq: Date.now(),
    ts: Date.now(),
    kind,
    payload: { from_lane: fromLane, to_lane: toLane, text },
  });
  window.dispatchEvent(new CustomEvent(LANE_EVENT_SIGNAL, { detail: key }));
}

// ─── Hook ─────────────────────────────────────────────────────────

export function useLaneStream(
  laneId: string | null,
  workspaceId: string | null | undefined,
  client: AcpClient | null,
  onDrainAction?: (action: DrainAction) => void,
  onLaneStatus?: (laneId: string, status: LaneStatus) => void,
) {
  const [renderTick, setRenderTick] = useState(0);
  const epochRef = useRef(0);

  const cacheKey = workspaceId && laneId ? `${workspaceId}:${laneId}` : null;

  useEffect(() => {
    if (!cacheKey) return;
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === cacheKey) {
        setRenderTick((t) => t + 1);
      }
    };
    window.addEventListener(LANE_EVENT_SIGNAL, handler);
    return () => window.removeEventListener(LANE_EVENT_SIGNAL, handler);
  }, [cacheKey]);

  useEffect(() => {
    if (!cacheKey) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === cacheKey) {
        setRenderTick((t) => t + 1);
      }
    };
    window.addEventListener(LANE_STATUS_SIGNAL, handler);
    return () => window.removeEventListener(LANE_STATUS_SIGNAL, handler);
  }, [cacheKey]);

  useEffect(() => {
    if (!cacheKey) return;
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === cacheKey) {
        setRenderTick((t) => t + 1);
      }
    };
    window.addEventListener(TRANSCRIPT_WINDOW_SIGNAL, handler);
    return () => window.removeEventListener(TRANSCRIPT_WINDOW_SIGNAL, handler);
  }, [cacheKey]);

  // Sync harness status to DB via onLaneStatus callback
  useEffect(() => {
    if (!onLaneStatus) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.laneId) {
        const dbStatus = harnessStatusToDbStatus(detail.next as HarnessLaneStatus);
        onLaneStatus(detail.laneId, dbStatus);
      }
    };
    window.addEventListener(LANE_STATUS_SIGNAL, handler);
    return () => window.removeEventListener(LANE_STATUS_SIGNAL, handler);
  }, [onLaneStatus]);

  // DB hydration on lane switch
  useEffect(() => {
    epochRef.current += 1;
    const epoch = epochRef.current;
    const key = cacheKey;

    if (!key || !laneId || !workspaceId) return;

    const existing = allEvents.get(key);
    if (!existing || existing.length === 0) {
      invoke<LaneEvent[]>("lane_events", { workspaceId, laneId }).then(
        (stored) => {
          if (epochRef.current !== epoch) return;
          const current = allEvents.get(key);
          if (!current || current.length === 0) {
            allEvents.set(key, stored);
            setRenderTick((t) => t + 1);
          }
        },
      );
    }
    setRenderTick((t) => t + 1);
  }, [cacheKey, laneId, workspaceId]);

  // ACP event subscription
  useEffect(() => {
    if (!client || !laneId || !cacheKey) return;
    const boundKey = cacheKey;
    const boundLaneId = laneId;
    const boundWsId = workspaceId ?? "";

    const unsub = client.onEvent((acpEvent: AcpEvent) => {
      if (acpEvent.type === 'stop') {
        setHarnessLaneStatus(boundWsId, boundLaneId, "idle");
        invoke<string | null>("inter_lane_on_stop", { laneId: boundLaneId }).then((nextStatus) => {
          if (nextStatus) {
            invoke<DrainAction | null>("inter_lane_set_status", { laneId: boundLaneId, status: nextStatus }).then((drain) => {
              if (drain && onDrainAction) {
                onDrainAction(drain);
              }
            }).catch(() => {});
          }
        }).catch(() => {});
      }
      if (acpEvent.type === 'error') {
        setHarnessLaneStatus(boundWsId, boundLaneId, "error");
      }
      if (acpEvent.type === 'permission_request') {
        setHarnessLaneStatus(boundWsId, boundLaneId, "needs_permission");
      }
      if (
        acpEvent.type === 'message_chunk' ||
        acpEvent.type === 'thought_chunk' ||
        acpEvent.type === 'tool_call'
      ) {
        const current = getLaneStatus(boundKey);
        if (current === "needs_permission") {
          setHarnessLaneStatus(boundWsId, boundLaneId, "busy");
        }
      }

      const laneEvent = acpEventToLaneEvent(acpEvent, boundLaneId, boundWsId);
      if (laneEvent) {
        pushEvent(boundKey, laneEvent);
        setRenderTick((t) => t + 1);
      }
    });
    return unsub;
  }, [client, laneId, workspaceId, cacheKey, onDrainAction]);

  const addUserInput = useCallback(
    (text: string) => {
      if (!laneId || !cacheKey) return;
      setHarnessLaneStatus(workspaceId ?? "", laneId, "busy");
      pushEvent(cacheKey, {
        workspace_id: workspaceId ?? "",
        lane_id: laneId,
        seq: Date.now(),
        ts: Date.now(),
        kind: "UserIn",
        payload: { text },
      });
      setRenderTick((t) => t + 1);
    },
    [laneId, workspaceId, cacheKey],
  );

  const addSystemEvent = useCallback(
    (text: string) => {
      if (!laneId || !cacheKey) return;
      pushEvent(cacheKey, {
        workspace_id: workspaceId ?? "",
        lane_id: laneId,
        seq: Date.now(),
        ts: Date.now(),
        kind: "Sys",
        payload: { text },
      });
      setRenderTick((t) => t + 1);
    },
    [laneId, workspaceId, cacheKey],
  );

  const clearEvents = useCallback(() => {
    if (cacheKey) {
      allEvents.delete(cacheKey);
    }
    setRenderTick((t) => t + 1);
  }, [cacheKey]);

  void renderTick;
  const events = getEvents(cacheKey);
  const laneStatus = getLaneStatus(cacheKey);
  const isLoading = BUSY_STATUSES.has(laneStatus);
  const transcriptWindow = getTranscriptWindow(cacheKey);

  return { events, addUserInput, addSystemEvent, clearEvents, isLoading, laneStatus, transcriptWindow };
}
