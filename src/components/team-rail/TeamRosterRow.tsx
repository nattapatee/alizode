import type { Lane } from "../../lib/acp-events";
import { CHAR_BY_ID } from "../../lib/characters";
import { useLaneActivity } from "../../hooks/useLaneStream";

interface Props {
  lane: Lane;
  workspaceId: string | null | undefined;
  isFocus: boolean;
  onClick: () => void;
}

export function TeamRosterRow({ lane, workspaceId, isFocus, onClick }: Props) {
  const c = CHAR_BY_ID[lane.agent_kind];
  const { status, busy, tool } = useLaneActivity(workspaceId, lane.id);
  if (!c) return null;

  const statusText = busy
    ? tool
      ? `⚙ ${tool}`
      : status === "needs_permission"
        ? "needs permission"
        : status === "awaiting_peer"
          ? "awaiting peer"
          : "working…"
    : lane.directive;

  return (
    <button
      className={
        "tv-rp-row" + (isFocus ? " focus" : "") + (busy ? " busy" : "")
      }
      style={{ "--rp-accent": c.accent } as React.CSSProperties}
      onClick={onClick}
    >
      <span className="tv-rp-portrait">
        {c.chibi ? (
          <span className="tv-rp-portrait-img" style={{ backgroundImage: `url(${c.chibi})` }} />
        ) : c.portrait ? (
          <span className="tv-rp-portrait-img" style={{ backgroundImage: `url(${c.portrait})` }} />
        ) : (
          <span className="tv-rp-portrait-glyph">{c.placeholderGlyph}</span>
        )}
      </span>
      <span className="tv-rp-name">{c.name.toLowerCase()}</span>
      <span className={"tv-rp-status" + (busy ? " k-busy" : "")}>
        <span className="tv-rp-dot" />
        {statusText}
      </span>
      <span className="tv-rp-arrow">›</span>
    </button>
  );
}
