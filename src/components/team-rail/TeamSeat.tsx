import type { Lane } from "../../lib/acp-events";
import { CHAR_BY_ID } from "../../lib/characters";
import { ROLE_ACCENTS } from "../../lib/team-roles";
import { useLaneTranscript, useLaneActivity } from "../../hooks/useLaneStream";
import { groupTranscript } from "./transcript";

interface Props {
  lane: Lane;
  workspaceId: string | null | undefined;
  isFocus: boolean;
  onClick: () => void;
}

export function TeamSeat({ lane, workspaceId, isFocus, onClick }: Props) {
  const c = CHAR_BY_ID[lane.agent_kind];
  const { events } = useLaneTranscript(workspaceId, lane.id);
  const { busy, tool } = useLaneActivity(workspaceId, lane.id);
  if (!c) return null;

  // Latest line this agent spoke (persists until a newer one arrives).
  const agentBlocks = groupTranscript(events).filter((b) => b.kind === "AgentText");
  const lastLine = agentBlocks.length > 0 ? agentBlocks[agentBlocks.length - 1].text : null;

  // talking = streaming text now; thinking = busy running a tool.
  const talking = busy && tool === null && lastLine !== null;
  const thinking = busy && tool !== null;

  const isLeader = lane.is_leader;
  const roleAccent = ROLE_ACCENTS[lane.directive] ?? c.accent;
  const portraitImg = c.chibi ?? c.portrait ?? null;

  return (
    <button
      className={
        "tv-card" +
        (isFocus ? " on" : "") +
        (isLeader ? " leader" : "") +
        (talking ? " talking" : "") +
        (thinking ? " thinking" : "")
      }
      style={{ "--c-accent": c.accent, "--r-accent": roleAccent } as React.CSSProperties}
      onClick={onClick}
    >
      <div className="tv-card-frame">
        <span className="tv-corner tl" />
        <span className="tv-corner tr" />
        <span className="tv-corner bl" />
        <span className="tv-corner br" />
        {portraitImg ? (
          <span className="tv-portrait" style={{ backgroundImage: `url(${portraitImg})` }} />
        ) : (
          <span className="tv-portrait empty">
            <span className="tv-portrait-glyph">{c.placeholderGlyph}</span>
          </span>
        )}
        <span className="tv-portrait-shadow" />
      </div>
      <div className="tv-card-meta">
        <span className="tv-card-name">{c.name}</span>
        <span className="tv-card-role">
          {isLeader && <span className="tv-led">◆</span>}
          {lane.directive}
        </span>
      </div>

      {lastLine && (
        <div
          key={agentBlocks.length}
          className={"tv-card-dialog" + (talking ? " live" : "")}
          style={{ "--accent": roleAccent } as React.CSSProperties}
        >
          <span className="tv-card-dialog-text">{lastLine}</span>
          <span className="tv-card-dialog-cursor">▾</span>
        </div>
      )}
    </button>
  );
}
