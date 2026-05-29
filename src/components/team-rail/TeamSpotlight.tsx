import type { Lane } from "../../lib/acp-events";
import { CHAR_BY_ID } from "../../lib/characters";
import { ROLE_ACCENTS } from "../../lib/team-roles";
import { useTeamSpotlight } from "../../hooks/useLaneStream";

interface Props {
  lanes: Lane[];
  workspaceId: string | null | undefined;
}

/** Big bottom-of-room dialog showing the most-recent line across all agents. */
export function TeamSpotlight({ lanes, workspaceId }: Props) {
  const spot = useTeamSpotlight(workspaceId, lanes.map((l) => l.id));
  if (!spot) return null;

  const lane = lanes.find((l) => l.id === spot.laneId);
  const c = lane ? CHAR_BY_ID[lane.agent_kind] : null;
  if (!lane || !c) return null;

  const accent = ROLE_ACCENTS[lane.directive] ?? c.accent;
  const portrait = c.chibi ?? c.portrait ?? null;

  return (
    <div
      className={"tv-spotlight" + (spot.busy ? " live" : "")}
      style={{ "--accent": accent } as React.CSSProperties}
    >
      <div className="tv-spotlight-body">
        <div className="tv-spotlight-head">
          <span className="tv-spotlight-name" style={{ color: c.accent }}>
            {c.name.toUpperCase()}
          </span>
          <span className="tv-spotlight-role">{lane.directive}</span>
        </div>
        <div key={spot.text} className="tv-spotlight-text">
          {spot.text}
        </div>
        <span className="tv-spotlight-cursor">▾</span>
      </div>
      {portrait && (
        <span
          className={"tv-spotlight-chibi" + (spot.busy ? " talk" : "")}
          style={{ backgroundImage: `url(${portrait})` }}
        />
      )}
    </div>
  );
}
