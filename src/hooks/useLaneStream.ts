import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LaneEvent } from "../lib/acp-events";
import type { AcpClient } from "../lib/acp-client";
import type { AcpEvent } from "../lib/acp-types";

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

const allEvents = new Map<string, LaneEvent[]>();

function getEvents(key: string | null): LaneEvent[] {
  return key ? (allEvents.get(key) ?? []) : [];
}

function pushEvent(key: string, event: LaneEvent): LaneEvent[] {
  const prev = allEvents.get(key) ?? [];
  const next = [...prev, event];
  allEvents.set(key, next);
  return next;
}

const LANE_EVENT_SIGNAL = "alizode:lane-event";

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

export function useLaneStream(
  laneId: string | null,
  workspaceId: string | null | undefined,
  client: AcpClient | null,
  onDrainAction?: (action: DrainAction) => void,
) {
  const [renderTick, setRenderTick] = useState(0);
  const [turnActive, setTurnActive] = useState(false);
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
    epochRef.current += 1;
    const epoch = epochRef.current;
    const key = cacheKey;

    if (!key || !laneId || !workspaceId) {
      setTurnActive(false);
      return;
    }

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
    setTurnActive(false);
    setRenderTick((t) => t + 1);
  }, [cacheKey, laneId, workspaceId]);

  useEffect(() => {
    if (!client || !laneId || !cacheKey) return;
    const boundKey = cacheKey;
    const boundLaneId = laneId;
    const boundWsId = workspaceId ?? "";

    const unsub = client.onEvent((acpEvent: AcpEvent) => {
      if (acpEvent.type === 'stop') {
        setTurnActive(false);
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
      setTurnActive(true);
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

  return { events, addUserInput, addSystemEvent, clearEvents, isLoading: turnActive };
}
