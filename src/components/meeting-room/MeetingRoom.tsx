import { useState, useCallback, useRef } from "react";
import type { Lane, Team } from "../../lib/acp-events";
import { CHAR_BY_ID } from "../../lib/characters";
import { TeamPlan } from "../team-rail/TeamPlan";
import { TeamRailTabs } from "../team-rail/TeamRailTabs";
import { TeamRosterRow } from "../team-rail/TeamRosterRow";
import { TeamSeat } from "../team-rail/TeamSeat";
import { TeamSpotlight } from "../team-rail/TeamSpotlight";

interface Props {
  team: Team;
  lanes: Lane[];
  workspaceId: string | null | undefined;
  focusedLaneId: string | null;
  onFocusLane: (laneId: string) => void;
  onSend: (laneId: string, text: string) => void;
}

export function MeetingRoom({ team, lanes, workspaceId, focusedLaneId, onFocusLane, onSend }: Props) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const sorted = [...lanes].sort((a, b) => a.team_sort_order - b.team_sort_order);
  const leader = sorted.find((l) => l.is_leader);
  const effectiveFocus = focusedLaneId ?? leader?.id ?? sorted[0]?.id;
  const focusedLane = sorted.find((l) => l.id === effectiveFocus);
  const focusedChar = focusedLane ? CHAR_BY_ID[focusedLane.agent_kind] : null;
  const leaderChar = leader ? CHAR_BY_ID[leader.agent_kind] : null;

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !effectiveFocus) return;
    setInput("");
    onSend(effectiveFocus, text);
    inputRef.current?.focus();
  }, [input, effectiveFocus, onSend]);

  return (
    <div className="teamview">
      <main className="tv-room">
        <div className="tv-room-vignette" />
        <div className="scanlines subtle tv-scanlines" />

        <div className="tv-room-head">
          <span className="tv-tag">// meeting room</span>
          <span className="tv-title">
            <span className="tv-arrow">›</span> {team.name}
          </span>
          <span className="tv-room-spacer" />
          <span className="tv-room-meta">
            {sorted.length} seats
            <span className="bullet">·</span>
            focus:{" "}
            <span style={{ color: focusedChar?.accent ?? "var(--orange)" }}>
              {focusedChar?.name?.toLowerCase() ?? "?"}
            </span>
          </span>
        </div>

        <div className="tv-table">
          <div className="tv-grid-floor" />
          <div className={`tv-grid count-${sorted.length}`}>
            {sorted.map((lane) => (
              <TeamSeat
                key={lane.id}
                lane={lane}
                workspaceId={workspaceId}
                isFocus={lane.id === effectiveFocus}
                onClick={() => onFocusLane(lane.id)}
              />
            ))}
          </div>
        </div>

        <TeamSpotlight lanes={sorted} workspaceId={workspaceId} />

        <div className="tv-injection">
          <span className="tv-inj-tag">// inject</span>
          <span className="tv-inj-body">
            team=<b>{team.name}</b> · role=<b>{focusedLane?.directive ?? "?"}</b>{" "}
            · leader=<b>{leaderChar?.name?.toLowerCase() ?? "?"}</b>
          </span>
        </div>

        <div className="tv-composer">
          <span className="tv-comp-target">
            to{" "}
            <span style={{ color: focusedChar?.accent ?? "var(--orange)" }}>
              {focusedChar?.name?.toLowerCase() ?? "?"}
            </span>
            <span className="tv-comp-directive">
              · {focusedLane?.directive ?? ""}
            </span>
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
            placeholder={
              focusedLane?.is_leader
                ? "talk to the leader — they delegate"
                : `message ${focusedChar?.name?.toLowerCase() ?? "agent"} directly`
            }
            spellCheck={false}
            autoFocus
          />
        </div>
      </main>

      <aside className="tv-chat">
        <div className="tv-roster-panel">
          <div className="tv-rp-head">
            <span className="tv-rp-title">AI AGENTS</span>
          </div>
          <div className="tv-rp-list">
            {sorted.map((lane) => (
              <TeamRosterRow
                key={lane.id}
                lane={lane}
                workspaceId={workspaceId}
                isFocus={lane.id === effectiveFocus}
                onClick={() => onFocusLane(lane.id)}
              />
            ))}
          </div>
        </div>
        <TeamPlan
          workspaceId={workspaceId}
          leaderLaneId={leader?.id ?? null}
          leaderName={leaderChar?.name?.toLowerCase() ?? "leader"}
        />
        <TeamRailTabs
          workspaceId={workspaceId}
          focusedLaneId={effectiveFocus ?? null}
          focusedName={focusedChar?.name?.toLowerCase() ?? "agent"}
          focusedAccent={focusedChar?.accent ?? "var(--orange)"}
          teamLaneIds={sorted.map((l) => l.id)}
        />
      </aside>
    </div>
  );
}
