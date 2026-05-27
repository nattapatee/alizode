import { useState, useEffect, useRef } from "react";
import type { Lane } from "../../lib/acp-events";
import { PermissionBadge } from "./PermissionBadge";
import { useMcpStats } from "../../hooks/useMcpStats";

interface Props {
  lane: Lane;
  harnessStatus?: string;
  onCancel?: () => void;
}

function statusLabel(s: string): string {
  switch (s) {
    case "starting": return "STARTING";
    case "busy":
    case "Running": return "PROCESSING";
    case "needs_permission": return "PERMISSION";
    case "awaiting_peer": return "AWAITING PEER";
    case "Waiting": return "WAITING";
    case "error":
    case "Error": return "ERROR";
    case "stopped":
    case "Stopped": return "STOPPED";
    default: return "IDLE · STANDBY";
  }
}

function statusClass(s: string): string {
  switch (s) {
    case "starting":
    case "busy":
    case "Running": return "thinking";
    case "needs_permission": return "permission";
    case "awaiting_peer":
    case "Waiting": return "waiting";
    case "error":
    case "Error": return "error";
    case "stopped":
    case "Stopped": return "stopped";
    default: return "idle";
  }
}

function fmtElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

const isBusy = (s: string) =>
  s === "starting" || s === "busy" || s === "Running" ||
  s === "needs_permission" || s === "awaiting_peer" || s === "Waiting";

function fmtAgo(ms: number): string {
  if (ms <= 0) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

export function LaneHeader({ lane, harnessStatus, onCancel }: Props) {
  const status = harnessStatus ?? lane.status;
  const { statsByLane } = useMcpStats();
  const mcpStats = statsByLane.get(lane.id);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (isBusy(status)) {
      if (startRef.current === null) startRef.current = Date.now();
      setElapsed(0);
      const id = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current!) / 1000));
      }, 1000);
      return () => window.clearInterval(id);
    }
    startRef.current = null;
    setElapsed(0);
  }, [status]);

  const busy = isBusy(status);

  return (
    <div className="chat-head">
      <span className="chat-title">
        <span className="hash">›</span>
        <span style={{ color: "var(--accent)" }}>{lane.agent_kind.toUpperCase()}</span>
        <span className="bullet">•</span>
        <span className={"chat-status status-" + statusClass(status)}>
          {statusLabel(status)}
        </span>
        {busy && (
          <span className="lane-elapsed">{fmtElapsed(elapsed)}</span>
        )}
        {busy && onCancel && (
          <>
            <span className="bullet">•</span>
            <button className="lane-stop-btn" onClick={onCancel} title="Stop agent (Esc)">
              STOP
            </button>
          </>
        )}
        <span className="bullet">•</span>
        <PermissionBadge status="auto-allow" />
      </span>
      <span className="chat-model">
        {lane.agent_kind} <span className="bullet">·</span> {lane.model}
        {mcpStats && mcpStats.last_seen_at > 0 && (
          <>
            <span className="bullet">·</span>
            <span className="mcp-stats-chip" title={`init:${mcpStats.initialize_count} list:${mcpStats.tools_list_count} call:${mcpStats.tools_call_count}`}>
              MCP {mcpStats.last_method} {fmtAgo(mcpStats.last_seen_at)}
            </span>
          </>
        )}
      </span>
    </div>
  );
}
