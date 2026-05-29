import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Lane, Team } from "../../lib/acp-events";
import { CHAR_BY_ID } from "../../lib/characters";

interface AgentInfo {
  kind: string;
  available: boolean;
  default_model: string;
}

const AGENT_ICONS: Record<string, string> = {
  claude: "/assets/icons/claude.png",
  codex: "/assets/icons/codex.png",
  opencode: "/assets/icons/opencode.png",
  cursor: "/assets/icons/cursor.webp",
  gemini: "/assets/icons/agy.png",
  sage: "/assets/icons/agy.png",
  forge: "/assets/icons/agy.png",
};

const NICK_KEY = "alizode:lane-nicknames";

function loadNicknames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NICK_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveNicknames(nicks: Record<string, string>) {
  localStorage.setItem(NICK_KEY, JSON.stringify(nicks));
}

interface DragState {
  id: string;
  startY: number;
  ghostY: number;
  label: string;
}

interface Props {
  lanes: Lane[];
  teams: Team[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (agentKind: string, model: string) => void;
  onDelete: (id: string) => void;
  onSelectTeam: (teamId: string) => void;
  onDeleteTeam: (teamId: string) => void;
  onCreateTeam: () => void;
}

export function LaneList({ lanes, teams, activeId, onSelect, onCreate, onDelete, onSelectTeam, onDeleteTeam, onCreateTeam }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [nicknames, setNicknames] = useState<Record<string, string>>(loadNicknames);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const laneRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!showPicker) return;
    invoke<AgentInfo[]>("agent_list").then(setAgents);
  }, [showPicker]);

  useEffect(() => {
    setOrder((prev) => {
      const laneIds = new Set(lanes.map((l) => l.id));
      const kept = prev.filter((id) => laneIds.has(id));
      const newIds = lanes.filter((l) => !kept.includes(l.id)).map((l) => l.id);
      return [...kept, ...newIds];
    });
  }, [lanes]);

  const orderedLanes = order
    .map((id) => lanes.find((l) => l.id === id))
    .filter((l): l is Lane => l != null);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = useCallback((teamId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }, []);

  const { teamGroups, soloLanes } = useMemo(() => {
    const groups: Map<string, { team: Team; lanes: Lane[] }> = new Map();
    const solo: Lane[] = [];
    for (const lane of orderedLanes) {
      if (lane.team_id) {
        const existing = groups.get(lane.team_id);
        if (existing) {
          existing.lanes.push(lane);
        } else {
          const team = teams.find((t) => t.id === lane.team_id);
          if (team) {
            groups.set(lane.team_id, { team, lanes: [lane] });
          } else {
            solo.push(lane);
          }
        }
      } else {
        solo.push(lane);
      }
    }
    for (const group of groups.values()) {
      group.lanes.sort((a, b) => a.team_sort_order - b.team_sort_order);
    }
    return { teamGroups: Array.from(groups.values()), soloLanes: solo };
  }, [orderedLanes, teams]);

  const startRename = useCallback((id: string) => {
    const c = CHAR_BY_ID[lanes.find((l) => l.id === id)?.agent_kind ?? ""];
    setEditingId(id);
    setEditText(nicknames[id] ?? c?.name ?? id);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [lanes, nicknames]);

  const commitRename = useCallback(() => {
    if (!editingId) return;
    const trimmed = editText.trim();
    const next = { ...nicknames };
    if (trimmed && trimmed !== (CHAR_BY_ID[lanes.find((l) => l.id === editingId)?.agent_kind ?? ""]?.name ?? editingId)) {
      next[editingId] = trimmed;
    } else {
      delete next[editingId];
    }
    setNicknames(next);
    saveNicknames(next);
    setEditingId(null);
  }, [editingId, editText, nicknames, lanes]);

  const pendingDrag = useRef<{ id: string; startY: number; label: string } | null>(null);
  const DRAG_THRESHOLD = 6;

  const handlePointerDown = useCallback((e: React.PointerEvent, id: string, label: string) => {
    if (editingId) return;
    if (e.button !== 0) return;
    pendingDrag.current = { id, startY: e.clientY, label };
  }, [editingId]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (pendingDrag.current && !drag) {
        const dy = Math.abs(e.clientY - pendingDrag.current.startY);
        if (dy >= DRAG_THRESHOLD) {
          setDrag({
            id: pendingDrag.current.id,
            startY: pendingDrag.current.startY,
            ghostY: e.clientY,
            label: pendingDrag.current.label,
          });
          pendingDrag.current = null;
        }
        return;
      }

      if (!drag) return;
      setDrag((prev) => prev ? { ...prev, ghostY: e.clientY } : null);

      let closest: string | null = null;
      let minDist = Infinity;
      for (const [id, el] of laneRefs.current.entries()) {
        if (id === drag.id) continue;
        const rect = el.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dist = Math.abs(e.clientY - mid);
        if (dist < minDist) {
          minDist = dist;
          closest = id;
        }
      }
      setDropTargetId(closest);
    };

    const handleUp = (e: PointerEvent) => {
      pendingDrag.current = null;
      if (!drag) return;
      if (dropTargetId && dropTargetId !== drag.id) {
        const targetEl = laneRefs.current.get(dropTargetId);
        const insertBefore = targetEl
          ? e.clientY < targetEl.getBoundingClientRect().top + targetEl.getBoundingClientRect().height / 2
          : false;

        setOrder((prev) => {
          const next = prev.filter((id) => id !== drag.id);
          const targetIdx = next.indexOf(dropTargetId);
          if (targetIdx === -1) return prev;
          next.splice(insertBefore ? targetIdx : targetIdx + 1, 0, drag.id);
          return next;
        });
      }
      setDrag(null);
      setDropTargetId(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [drag, dropTargetId]);

  return (
    <aside className="lanes">
      <div className="lanes-head">
        <span>LANES</span>
        <button
          className="lanes-add"
          onClick={() => setShowPicker((v) => !v)}
          title="new lane"
        >
          +
        </button>
      </div>

      {teamGroups.map(({ team, lanes: teamLanes }) => {
        const isCollapsed = collapsed.has(team.id);
        const leader = teamLanes.find((l) => l.is_leader);
        const leaderChar = leader ? CHAR_BY_ID[leader.agent_kind] : null;
        return (
          <div key={team.id} className="lane-team-group">
            <div
              className="lane-team-header"
              onClick={() => onSelectTeam(team.id)}
            >
              <span className="lane-team-ico">◇</span>
              <span className="lane-team-name">{team.name}</span>
              <span className="lane-team-sub">
                {teamLanes.length} · led by{" "}
                <span style={{ color: leaderChar?.accent ?? "var(--orange)" }}>
                  {leaderChar?.name?.toLowerCase() ?? "?"}
                </span>
              </span>
              <button
                className="lane-team-collapse"
                onClick={(e) => { e.stopPropagation(); toggleCollapse(team.id); }}
                title={isCollapsed ? "expand" : "collapse"}
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
              <span
                className="lane-x"
                onClick={(e) => { e.stopPropagation(); onDeleteTeam(team.id); }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                ×
              </span>
            </div>
            {!isCollapsed && teamLanes.map((lane) => {
              const c = CHAR_BY_ID[lane.agent_kind];
              const icon = AGENT_ICONS[lane.agent_kind];
              const displayName = nicknames[lane.id] ?? c?.name ?? lane.agent_kind;
              const isEditing = editingId === lane.id;
              const isDragging = drag?.id === lane.id;
              const isDragOver = dropTargetId === lane.id;
              return (
                <div
                  key={lane.id}
                  ref={(el) => { if (el) laneRefs.current.set(lane.id, el); else laneRefs.current.delete(lane.id); }}
                  className={
                    "lane lane-in-team" +
                    (lane.id === activeId ? " on" : "") +
                    (isDragging ? " lane-dragging" : "") +
                    (isDragOver ? " lane-dragover" : "")
                  }
                  onClick={() => { if (!drag) onSelect(lane.id); }}
                  onDoubleClick={() => startRename(lane.id)}
                  onPointerDown={(e) => handlePointerDown(e, lane.id, displayName)}
                  style={{ "--lane-accent": c?.accent ?? "var(--cyan)" } as React.CSSProperties}
                >
                  {icon ? (
                    <img src={icon} alt={lane.agent_kind} className="lane-icon" draggable={false} />
                  ) : (
                    <span className={"lane-dot status-" + (
                      lane.status === "Running" ? "thinking" :
                      lane.status === "Waiting" ? "waiting" :
                      lane.status === "Error" ? "error" :
                      lane.status === "Stopped" ? "stopped" : "idle"
                    )} />
                  )}
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      className="lane-rename-input"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="lane-name">
                      {displayName}
                      {lane.is_leader && <span className="lane-leader-badge">★</span>}
                    </span>
                  )}
                  <span className="lane-directive-tag">{lane.directive}</span>
                  <span className={"lane-status-dot status-" + (
                    lane.status === "Running" ? "thinking" :
                    lane.status === "Waiting" ? "waiting" :
                    lane.status === "Error" ? "error" :
                    lane.status === "Stopped" ? "stopped" : "idle"
                  )} />
                </div>
              );
            })}
          </div>
        );
      })}

      {soloLanes.map((lane) => {
        const c = CHAR_BY_ID[lane.agent_kind];
        const icon = AGENT_ICONS[lane.agent_kind];
        const displayName = nicknames[lane.id] ?? c?.name ?? lane.agent_kind;
        const isEditing = editingId === lane.id;
        const isDragging = drag?.id === lane.id;
        const isDragOver = dropTargetId === lane.id;

        return (
          <div
            key={lane.id}
            ref={(el) => { if (el) laneRefs.current.set(lane.id, el); else laneRefs.current.delete(lane.id); }}
            className={
              "lane" +
              (lane.id === activeId ? " on" : "") +
              (isDragging ? " lane-dragging" : "") +
              (isDragOver ? " lane-dragover" : "")
            }
            onClick={() => { if (!drag) onSelect(lane.id); }}
            onDoubleClick={() => startRename(lane.id)}
            onPointerDown={(e) => handlePointerDown(e, lane.id, displayName)}
            style={{ "--lane-accent": c?.accent ?? "var(--cyan)" } as React.CSSProperties}
          >
            {icon ? (
              <img
                src={icon}
                alt={lane.agent_kind}
                className="lane-icon"
                draggable={false}
              />
            ) : (
              <span className={"lane-dot status-" + (
                lane.status === "Running" ? "thinking" :
                lane.status === "Waiting" ? "waiting" :
                lane.status === "Error" ? "error" :
                lane.status === "Stopped" ? "stopped" : "idle"
              )} />
            )}
            {isEditing ? (
              <input
                ref={inputRef}
                className="lane-rename-input"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span className="lane-name">{displayName}</span>
            )}
            <span className={"lane-status-dot status-" + (
              lane.status === "Running" ? "thinking" :
              lane.status === "Waiting" ? "waiting" :
              lane.status === "Error" ? "error" :
              lane.status === "Stopped" ? "stopped" : "idle"
            )} />
            {lane.is_main && (
              <span style={{ fontSize: 9, color: "var(--orange)" }}>M</span>
            )}
            {lanes.length > 1 && (
              <span
                className="lane-x"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(lane.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                ×
              </span>
            )}
          </div>
        );
      })}

      {drag && (
        <div
          className="lane-ghost"
          style={{ top: drag.ghostY - 16 }}
        >
          {drag.label}
        </div>
      )}

      {showPicker && (
        <div className="lane-picker">
          <div className="lane-picker-head">spawn agent</div>
          <button
            className="lane-picker-item lane-picker-team-new"
            onClick={() => {
              setShowPicker(false);
              onCreateTeam();
            }}
          >
            <span className="lp-portrait lp-portrait-empty lp-team-new">◇</span>
            <span className="lp-meta">
              <span className="lp-name">team</span>
              <span className="lp-role">multi-agent · roles · leader</span>
            </span>
          </button>
          {agents.map((agent) => {
            const c = CHAR_BY_ID[agent.kind];
            return (
              <button
                key={agent.kind}
                className="lane-picker-item"
                style={{
                  "--accent": c?.accent ?? "var(--cyan)",
                } as React.CSSProperties}
                onClick={() => {
                  onCreate(agent.kind, agent.default_model);
                  setShowPicker(false);
                }}
              >
                {c?.portrait ? (
                  <span
                    className="lp-portrait"
                    style={{ backgroundImage: `url(${c.portrait})` }}
                  />
                ) : (
                  <span className="lp-portrait lp-portrait-empty">
                    {c?.placeholderGlyph ?? agent.kind.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="lp-meta">
                  <span className="lp-name">{c?.name ?? agent.kind.toUpperCase()}</span>
                  <span className="lp-role">{c?.role ?? "ready"}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {lanes.length === 0 && !showPicker && (
        <div style={{ padding: "16px 8px", textAlign: "center", fontSize: 10, color: "var(--ink-faint)" }}>
          No lanes yet
        </div>
      )}
    </aside>
  );
}
