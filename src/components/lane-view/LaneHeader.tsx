import type { Lane } from "../../lib/acp-events";
import { PermissionBadge } from "./PermissionBadge";

interface Props {
  lane: Lane;
}

function statusLabel(s: string): string {
  switch (s) {
    case "Running": return "PROCESSING";
    case "Waiting": return "WAITING";
    case "Error": return "ERROR";
    case "Stopped": return "STOPPED";
    default: return "IDLE · STANDBY";
  }
}

export function LaneHeader({ lane }: Props) {
  return (
    <div className="chat-head">
      <span className="chat-title">
        <span className="hash">›</span>
        <span style={{ color: "var(--accent)" }}>{lane.agent_kind.toUpperCase()}</span>
        <span className="bullet">•</span>
        <span className={"chat-status status-" + (lane.status === "Running" ? "thinking" : "idle")}>
          {statusLabel(lane.status)}
        </span>
        <span className="bullet">•</span>
        <PermissionBadge status="auto-allow" />
      </span>
      <span className="chat-model">
        {lane.agent_kind} <span className="bullet">·</span> {lane.model}
      </span>
    </div>
  );
}
