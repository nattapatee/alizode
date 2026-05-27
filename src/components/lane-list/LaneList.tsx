import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Lane } from "../../lib/acp-events";
import { CHAR_BY_ID } from "../../lib/characters";

interface AgentInfo {
  kind: string;
  available: boolean;
  default_model: string;
}

interface Props {
  lanes: Lane[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (agentKind: string, model: string) => void;
  onDelete: (id: string) => void;
}

export function LaneList({ lanes, activeId, onSelect, onCreate, onDelete }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  useEffect(() => {
    if (!showPicker) return;
    invoke<AgentInfo[]>("agent_list").then(setAgents);
  }, [showPicker]);

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

      {lanes.map((lane) => {
        const c = CHAR_BY_ID[lane.agent_kind];
        return (
          <div
            key={lane.id}
            className={"lane" + (lane.id === activeId ? " on" : "")}
            onClick={() => onSelect(lane.id)}
            style={{ "--lane-accent": c?.accent ?? "var(--cyan)" } as React.CSSProperties}
          >
            <span className={"lane-dot status-" + (
              lane.status === "Running" ? "thinking" :
              lane.status === "Waiting" ? "waiting" :
              lane.status === "Error" ? "error" :
              lane.status === "Stopped" ? "stopped" : "idle"
            )} />
            <span className="lane-name">{c?.name ?? lane.agent_kind}</span>
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
              >
                ×
              </span>
            )}
          </div>
        );
      })}

      {showPicker && (
        <div className="lane-picker">
          <div className="lane-picker-head">spawn agent</div>
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
