import { useEffect, useRef } from "react";
import { useLaneTranscript } from "../../hooks/useLaneStream";
import { groupTranscript } from "./transcript";
import { MarkdownView } from "./MarkdownView";

interface Props {
  workspaceId: string | null | undefined;
  laneId: string | null;
  name: string;
  accent: string;
}

const BUSY = new Set(["starting", "busy", "needs_permission", "awaiting_peer"]);

export function TeamChat({ workspaceId, laneId, name, accent }: Props) {
  const { events, status } = useLaneTranscript(workspaceId, laneId);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, status]);

  const blocks = groupTranscript(events);

  const tagFor = (kind: string): string =>
    kind === "UserIn"
      ? "you"
      : kind === "AgentText"
        ? name
        : kind === "ToolCall"
          ? "tool"
          : kind === "Error"
            ? "err"
            : "sys";

  return (
    <div className="tv-chatlog">
      <div className="tv-chatlog-head">
        <span className="tv-chatlog-title" style={{ color: accent }}>
          ▸ you + {name}
        </span>
        {BUSY.has(status) && <span className="tv-chatlog-busy">working…</span>}
      </div>
      <div className="tv-chatlog-feed" ref={feedRef}>
        {blocks.length === 0 ? (
          <div className="tv-chatlog-empty">
            send a message below — it goes to {name}
          </div>
        ) : (
          blocks.map((b) => (
            <div key={b.key} className={"tv-cl-row k-" + b.kind}>
              <span className="tv-cl-tag">{tagFor(b.kind)}</span>
              {b.kind === "AgentText" ? (
                <MarkdownView text={b.text} />
              ) : (
                <span className="tv-cl-text">{b.text}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
