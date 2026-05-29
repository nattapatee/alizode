import { useState } from "react";
import { TeamChat } from "./TeamChat";
import { TeamCrossTalk } from "./TeamCrossTalk";

interface Props {
  workspaceId: string | null | undefined;
  focusedLaneId: string | null;
  focusedName: string;
  focusedAccent: string;
  teamLaneIds: string[];
}

type Tab = "chat" | "crosstalk";

export function TeamRailTabs({
  workspaceId,
  focusedLaneId,
  focusedName,
  focusedAccent,
  teamLaneIds,
}: Props) {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <div className="tv-tabs">
      <div className="tv-tabs-head">
        <button
          className={"tv-tab" + (tab === "chat" ? " on" : "")}
          onClick={() => setTab("chat")}
        >
          you + {focusedName}
        </button>
        <button
          className={"tv-tab" + (tab === "crosstalk" ? " on" : "")}
          onClick={() => setTab("crosstalk")}
        >
          cross-talk
        </button>
      </div>
      {/* Both stay mounted (just hidden) so cross-talk keeps its live-collected
          messages and chat keeps scroll position when switching tabs. */}
      <div className="tv-tabs-body" style={{ display: tab === "chat" ? "flex" : "none" }}>
        <TeamChat
          workspaceId={workspaceId}
          laneId={focusedLaneId}
          name={focusedName}
          accent={focusedAccent}
        />
      </div>
      <div className="tv-tabs-body" style={{ display: tab === "crosstalk" ? "flex" : "none" }}>
        <TeamCrossTalk teamLaneIds={teamLaneIds} />
      </div>
    </div>
  );
}
