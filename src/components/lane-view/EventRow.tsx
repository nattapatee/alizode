import type { LaneEvent } from "../../lib/acp-events";
import {
  getEventText,
  getToolName,
  getToolInput,
  getToolDuration,
  getToolError,
  getPeerInfo,
  getPermInfo,
} from "../../lib/acp-events";
import { formatTimestamp } from "../../lib/format";

interface Props {
  event: LaneEvent;
}

function UserInRow({ event }: Props) {
  return (
    <div className="log-row you">
      <span className="log-t">{formatTimestamp(event.ts)}</span>
      <span className="log-prefix">you</span>
      <span className="log-text">{getEventText(event)}</span>
    </div>
  );
}

function ToolCallRow({ event }: Props) {
  const tool = getToolName(event);
  const input = getToolInput(event);
  const kind = (event.payload as Record<string, unknown>).kind as
    | string
    | undefined;
  const status = (event.payload as Record<string, unknown>).status as
    | string
    | undefined;
  return (
    <details className="log-details">
      <summary className="log-row tool">
        <span className="log-t">{formatTimestamp(event.ts)}</span>
        <span className="log-prefix">{tool}</span>
        <span className="log-text">
          {kind && <span className="log-dim">{kind} </span>}
          {status && (
            <span
              className={
                status === "running" ? "log-status-running" : "log-dim"
              }
            >
              {status}{" "}
            </span>
          )}
          {input && input.slice(0, 80)}
        </span>
      </summary>
      {input && input.length > 80 && (
        <pre className="log-expand">{input}</pre>
      )}
    </details>
  );
}

function ToolResultRow({ event }: Props) {
  const error = getToolError(event);
  const duration = getToolDuration(event);
  const tool = getToolName(event);
  const status = (event.payload as Record<string, unknown>).status as
    | string
    | undefined;
  const text = error ?? getEventText(event);
  const isError = !!error || status === "failed";
  return (
    <details className="log-details">
      <summary className={`log-row ${isError ? "tool-err" : "tool-ok"}`}>
        <span className="log-t">{formatTimestamp(event.ts)}</span>
        <span className="log-prefix">
          {tool} {isError ? "x" : "ok"}
        </span>
        <span className="log-text">
          {typeof duration === "number" && (
            <span className="log-dim">{duration}ms </span>
          )}
          {text.slice(0, 120)}
        </span>
      </summary>
      {text.length > 120 && (
        <pre className={`log-expand${isError ? " tool-err" : ""}`}>{text}</pre>
      )}
    </details>
  );
}

function PeerRow({ event }: Props) {
  const { fromLane, toLane, text, isReview } = getPeerInfo(event);
  const isIn = event.kind === "PeerIn";
  return (
    <div className="log-row peer">
      <span className="log-t">{formatTimestamp(event.ts)}</span>
      <span className="log-prefix">
        {isIn ? `← ${fromLane}` : `${toLane} →`}
      </span>
      <span className="log-text">
        {isReview ? (
          <span className="log-review">[review]</span>
        ) : (
          text.replace(/^.*?[→:]?\s*/, "")
        )}
      </span>
    </div>
  );
}

function PermPromptRow({ event }: Props) {
  const { tool, category } = getPermInfo(event);
  return (
    <div className="log-row perm">
      <span className="log-t">{formatTimestamp(event.ts)}</span>
      <span className="log-prefix">permission</span>
      <span className="log-text">
        {tool}
        {category && <span className="log-dim"> {category}</span>}
      </span>
    </div>
  );
}

function PermDecisionRow({ event }: Props) {
  const { decision, tool } = getPermInfo(event);
  const allowed = decision === "allow" || decision === "allow_session";
  return (
    <div className={`log-row ${allowed ? "perm-ok" : "perm"}`}>
      <span className="log-t">{formatTimestamp(event.ts)}</span>
      <span className="log-prefix">{allowed ? "+" : "x"}</span>
      <span className="log-text">
        {tool || "permission"} {decision}
      </span>
    </div>
  );
}

function ErrorRow({ event }: Props) {
  return (
    <div className="log-row err">
      <span className="log-t">{formatTimestamp(event.ts)}</span>
      <span className="log-prefix">error</span>
      <span className="log-text">{getEventText(event)}</span>
    </div>
  );
}

function SysRow({ event }: Props) {
  return (
    <div className="log-row sys">
      <span className="log-t">{formatTimestamp(event.ts)}</span>
      <span className="log-prefix">::</span>
      <span className="log-text">{getEventText(event)}</span>
    </div>
  );
}

export function EventRow({ event }: Props) {
  switch (event.kind) {
    case "UserIn":
      return <UserInRow event={event} />;
    case "ToolCall":
      return <ToolCallRow event={event} />;
    case "ToolResult":
      return <ToolResultRow event={event} />;
    case "Thought":
      return null;
    case "PeerIn":
    case "PeerOut":
      return <PeerRow event={event} />;
    case "PermPrompt":
      return <PermPromptRow event={event} />;
    case "PermDecision":
      return <PermDecisionRow event={event} />;
    case "Error":
      return <ErrorRow event={event} />;
    case "Sys":
      return <SysRow event={event} />;
    case "AgentText":
      return (
        <div
          className="log-row ai"
          style={{ "--ai": "var(--cyan)" } as React.CSSProperties}
        >
          <span className="log-t">{formatTimestamp(event.ts)}</span>
          <span className="log-prefix">ai</span>
          <span className="log-text">{getEventText(event)}</span>
        </div>
      );
    default:
      return (
        <div className="log-row sys">
          <span className="log-t">{formatTimestamp(event.ts)}</span>
          <span className="log-prefix">::</span>
          <span className="log-text">{getEventText(event)}</span>
        </div>
      );
  }
}
