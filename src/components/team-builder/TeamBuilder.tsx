import { useState, useEffect, useCallback } from "react";
import type { TeamPresetWithMembers, CreateTeamMemberInput } from "../../lib/acp-events";
import { SELECTABLE, CHAR_BY_ID, type Character } from "../../lib/characters";
import { TEAM_ROLES, ROLE_BY_ID } from "../../lib/team-roles";

interface SeatEntry {
  seatId: string;
  charId: string;
  role: string;
}

interface StarterTemplate {
  id: string;
  name: string;
  description: string;
  accent: string;
  seats: Array<{ charId: string; role: string }>;
}

const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "development",
    name: "development team",
    description: "leader, frontend, backend, qa",
    accent: "#7df9ff",
    seats: [
      { charId: "claude", role: "leader" },
      { charId: "codex", role: "frontend" },
      { charId: "opencode", role: "backend" },
      { charId: "gemini", role: "qa" },
    ],
  },
  {
    id: "architecture",
    name: "architecture team",
    description: "leader, architect, full-stack, qa",
    accent: "#ffd166",
    seats: [
      { charId: "claude", role: "leader" },
      { charId: "gemini", role: "architect" },
      { charId: "codex", role: "fullstack" },
      { charId: "opencode", role: "qa" },
    ],
  },
  {
    id: "security",
    name: "security team",
    description: "leader, security, backend, qa",
    accent: "#ef476f",
    seats: [
      { charId: "claude", role: "leader" },
      { charId: "gemini", role: "security" },
      { charId: "codex", role: "backend" },
      { charId: "opencode", role: "qa" },
    ],
  },
  {
    id: "data-platform",
    name: "data platform team",
    description: "leader, data, backend, devops",
    accent: "#06d6a0",
    seats: [
      { charId: "claude", role: "leader" },
      { charId: "gemini", role: "data" },
      { charId: "codex", role: "backend" },
      { charId: "opencode", role: "devops" },
    ],
  },
  {
    id: "database",
    name: "database team",
    description: "leader, database, backend, qa",
    accent: "#2dd4bf",
    seats: [
      { charId: "claude", role: "leader" },
      { charId: "gemini", role: "database" },
      { charId: "codex", role: "backend" },
      { charId: "opencode", role: "qa" },
    ],
  },
  {
    id: "trading-research",
    name: "trading research team",
    description: "leader, quant, market, risk",
    accent: "#c77dff",
    seats: [
      { charId: "claude", role: "leader" },
      { charId: "gemini", role: "quant" },
      { charId: "codex", role: "market_analyst" },
      { charId: "opencode", role: "risk" },
    ],
  },
  {
    id: "trading-ops",
    name: "trading ops team",
    description: "leader, trading ops, risk, data",
    accent: "#f9c74f",
    seats: [
      { charId: "claude", role: "leader" },
      { charId: "codex", role: "trading_ops" },
      { charId: "gemini", role: "risk" },
      { charId: "opencode", role: "data" },
    ],
  },
];

let seatCounter = 0;
function newSeatId(charId: string): string {
  seatCounter += 1;
  return `${charId}#${seatCounter}-${Date.now().toString(36).slice(-3)}`;
}

function seatsFromTemplate(template: StarterTemplate): SeatEntry[] {
  return template.seats.map((seat) => ({
    seatId: newSeatId(seat.charId),
    charId: seat.charId,
    role: seat.role,
  }));
}

function membersFromSeats(seats: SeatEntry[]): CreateTeamMemberInput[] {
  return seats.map((m, i) => ({
    agent_kind: m.charId,
    model: CHAR_BY_ID[m.charId]?.model ?? "sonnet",
    directive: m.role,
    is_leader: m.role === "leader",
    sort_order: i,
  }));
}

export interface SpawnPayload {
  name: string;
  members: CreateTeamMemberInput[];
  saveAsPreset: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSpawn: (payload: SpawnPayload) => void;
  presets: TeamPresetWithMembers[];
  onSpawnPreset: (preset: TeamPresetWithMembers) => void;
  onDeletePreset: (presetId: string) => void;
}

export function TeamBuilder({ open, onClose, onSpawn, presets, onSpawnPreset, onDeletePreset }: Props) {
  const [tab, setTab] = useState<"new" | "presets">("new");
  const [name, setName] = useState("");
  const [members, setMembers] = useState<SeatEntry[]>([]);
  const [savePreset, setSavePreset] = useState(true);

  useEffect(() => {
    if (open) {
      setName("");
      setMembers([]);
      setSavePreset(true);
      setTab(presets.length > 0 ? "presets" : "new");
    }
  }, [open, presets.length]);

  const hasLeader = members.some((m) => m.role === "leader");
  const valid = members.length >= 2 && members.length <= 4 && hasLeader && name.trim().length > 0;

  const addMember = useCallback((charId: string) => {
    setMembers((prev) => {
      if (prev.length >= 4) return prev;
      const defaultRole = prev.some((m) => m.role === "leader") ? "frontend" : "leader";
      return [...prev, { seatId: newSeatId(charId), charId, role: defaultRole }];
    });
  }, []);

  const setRole = useCallback((seatId: string, role: string) => {
    setMembers((prev) =>
      prev.map((m) => {
        if (m.seatId === seatId) return { ...m, role };
        if (role === "leader" && m.role === "leader") return { ...m, role: "frontend" };
        return m;
      }),
    );
  }, []);

  const removeMember = useCallback((seatId: string) => {
    setMembers((prev) => prev.filter((m) => m.seatId !== seatId));
  }, []);

  const handleSpawn = useCallback(() => {
    if (!valid) return;
    onSpawn({
      name: name.trim(),
      members: membersFromSeats(members),
      saveAsPreset: savePreset,
    });
    onClose();
  }, [valid, name, members, savePreset, onSpawn, onClose]);

  const applyTemplate = useCallback((template: StarterTemplate) => {
    setName(template.name);
    setMembers(seatsFromTemplate(template));
    setTab("new");
  }, []);

  const spawnTemplate = useCallback((template: StarterTemplate) => {
    onSpawn({
      name: template.name,
      members: membersFromSeats(seatsFromTemplate(template)),
      saveAsPreset: false,
    });
    onClose();
  }, [onSpawn, onClose]);

  const loadPreset = useCallback((preset: TeamPresetWithMembers) => {
    setName(preset.preset.name + " (copy)");
    setMembers(
      preset.members.map((m) => ({
        seatId: newSeatId(m.agent_kind),
        charId: m.agent_kind,
        role: m.directive,
      })),
    );
    setTab("new");
  }, []);

  if (!open) return null;

  const seatsPerAgent: Record<string, number> = {};
  for (const m of members) {
    seatsPerAgent[m.charId] = (seatsPerAgent[m.charId] ?? 0) + 1;
  }

  return (
    <div className="tb-backdrop" onClick={onClose}>
      <div className="tb-card" onClick={(e) => e.stopPropagation()}>
        <span className="bracket tl" />
        <span className="bracket tr" />
        <span className="bracket bl" />
        <span className="bracket br" />

        <div className="tb-head">
          <span className="tb-tag">// build a team</span>
          <button className="tb-x" onClick={onClose} title="close">×</button>
        </div>

        <div className="tb-tabs">
          <button
            className={"tb-tab" + (tab === "new" ? " on" : "")}
            onClick={() => setTab("new")}
          >
            create new
          </button>
          <button
            className={"tb-tab" + (tab === "presets" ? " on" : "")}
            onClick={() => setTab("presets")}
          >
            presets
            <span className="tb-tab-count">{presets.length + STARTER_TEMPLATES.length}</span>
          </button>
        </div>

        {tab === "new" && (
          <>
            <div className="tb-name-row">
              <label className="tb-label">team name</label>
              <input
                className="tb-name"
                value={name}
                placeholder="strike-team-alpha"
                onChange={(e) => setName(e.target.value)}
                spellCheck={false}
                autoFocus
              />
              <span className="tb-count">
                {members.length}/4 seats
                <span className="bullet">·</span>
                {hasLeader ? (
                  <span className="tb-pill ok">leader ✓</span>
                ) : (
                  <span className="tb-pill bad">no leader</span>
                )}
              </span>
            </div>

            <div className="tb-section">
              <div className="tb-sec-head">roster</div>
              {members.length === 0 && (
                <div className="tb-empty">
                  add up to 4 seats below. exactly one must be the leader.
                  same agent can fill multiple seats with different roles.
                </div>
              )}
              {members.map((m) => {
                const c = CHAR_BY_ID[m.charId];
                if (!c) return null;
                const roleAccent = ROLE_BY_ID[m.role]?.accent ?? c.accent;
                const dupCount = seatsPerAgent[m.charId] ?? 1;
                return (
                  <div
                    key={m.seatId}
                    className="tb-member"
                    style={{ "--m-accent": roleAccent, "--c-accent": c.accent } as React.CSSProperties}
                  >
                    {c.portrait ? (
                      <span
                        className="tb-mem-portrait"
                        style={{ backgroundImage: `url(${c.portrait})` }}
                      />
                    ) : (
                      <span className="tb-mem-portrait empty">
                        {c.placeholderGlyph}
                      </span>
                    )}
                    <div className="tb-mem-meta">
                      <span className="tb-mem-name">
                        {c.name}
                        {dupCount > 1 && <span className="tb-mem-dup">×{dupCount}</span>}
                      </span>
                      <span className="tb-mem-sub">{c.role}</span>
                    </div>
                    <label
                      className="tb-role-select-wrap"
                      style={{ "--r-accent": roleAccent } as React.CSSProperties}
                    >
                      <span className="tb-role-dot" />
                      <select
                        className="tb-role-select"
                        value={m.role}
                        onChange={(e) => setRole(m.seatId, e.target.value)}
                      >
                        {TEAM_ROLES.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="tb-mem-x"
                      onClick={() => removeMember(m.seatId)}
                      title="remove"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            {members.length < 4 && (
              <div className="tb-section">
                <div className="tb-sec-head">add agent</div>
                <div className="tb-pool">
                  {SELECTABLE.map((c: Character) => {
                    const seats = seatsPerAgent[c.id] ?? 0;
                    return (
                      <button
                        key={c.id}
                        className={"tb-pool-item" + (seats > 0 ? " has-seat" : "")}
                        style={{ "--a-accent": c.accent } as React.CSSProperties}
                        onClick={() => addMember(c.id)}
                      >
                        {c.portrait ? (
                          <span
                            className="tb-pool-portrait"
                            style={{ backgroundImage: `url(${c.portrait})` }}
                          />
                        ) : (
                          <span className="tb-pool-portrait empty">
                            {c.placeholderGlyph}
                          </span>
                        )}
                        <span className="tb-pool-name">{c.name}</span>
                        {seats > 0 && <span className="tb-pool-seats">×{seats}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="tb-foot">
              <label className="tb-save">
                <input
                  type="checkbox"
                  checked={savePreset}
                  onChange={(e) => setSavePreset(e.target.checked)}
                />
                save as preset
              </label>
              <span className="tb-foot-spacer" />
              <button className="btn btn-ghost" onClick={onClose}>cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSpawn}
                disabled={!valid}
              >
                spawn team ↵
              </button>
            </div>
          </>
        )}

        {tab === "presets" && (
          <div className="tb-presets-tab">
            <div className="tb-sec-head">starter presets</div>
            {STARTER_TEMPLATES.map((template) => (
              <div
                key={template.id}
                className="tb-preset-card tb-template-card"
                style={{ "--template-accent": template.accent } as React.CSSProperties}
              >
                <div className="tb-preset-card-head">
                  <span className="tb-preset-ico">◇</span>
                  <span className="tb-preset-card-name">{template.name}</span>
                  <span className="tb-preset-card-meta">
                    {template.seats.length} seats
                    <span className="bullet">·</span>
                    {template.description}
                  </span>
                </div>
                <div className="tb-preset-roster">
                  {template.seats.map((seat, i) => {
                    const c = CHAR_BY_ID[seat.charId];
                    if (!c) return null;
                    const r = ROLE_BY_ID[seat.role];
                    return (
                      <div
                        key={`${template.id}-${seat.charId}-${seat.role}-${i}`}
                        className={"tb-preset-seat" + (seat.role === "leader" ? " leader" : "")}
                        style={{
                          "--s-accent": c.accent,
                          "--r-accent": r?.accent ?? c.accent,
                        } as React.CSSProperties}
                      >
                        {c.portrait ? (
                          <span
                            className="tb-preset-portrait"
                            style={{ backgroundImage: `url(${c.portrait})` }}
                          />
                        ) : (
                          <span className="tb-preset-portrait empty">
                            {c.placeholderGlyph}
                          </span>
                        )}
                        <span className="tb-preset-seat-name">
                          {c.name.toLowerCase()}
                        </span>
                        <span className="tb-preset-seat-role">
                          {seat.role === "leader" && <span className="tps-led">◆</span>}
                          {r?.label ?? seat.role}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="tb-preset-card-foot">
                  <button className="tb-preset-load-btn" onClick={() => applyTemplate(template)}>
                    edit ↗
                  </button>
                  <button className="tb-preset-spawn-btn" onClick={() => spawnTemplate(template)}>
                    spawn ↵
                  </button>
                </div>
              </div>
            ))}
            <div className="tb-sec-head">saved teams</div>
            {presets.length === 0 && (
              <div className="tb-empty">
                no saved teams yet. switch to "create new" and check
                <b> save as preset</b> when you spawn.
              </div>
            )}
            {presets.map((p) => {
              const leader = p.members.find((m) => m.is_leader);
              const leaderChar = leader ? CHAR_BY_ID[leader.agent_kind] : null;
              return (
                <div key={p.preset.id} className="tb-preset-card">
                  <div className="tb-preset-card-head">
                    <span className="tb-preset-ico">◇</span>
                    <span className="tb-preset-card-name">{p.preset.name}</span>
                    <span className="tb-preset-card-meta">
                      {p.members.length} seats
                      <span className="bullet">·</span>
                      led by{" "}
                      <span style={{ color: leaderChar?.accent ?? "var(--orange)" }}>
                        {leaderChar?.name?.toLowerCase() ?? "?"}
                      </span>
                    </span>
                    <button
                      className="tb-preset-card-x"
                      onClick={() => onDeletePreset(p.preset.id)}
                      title="delete preset"
                    >
                      ×
                    </button>
                  </div>
                  <div className="tb-preset-roster">
                    {p.members.map((m) => {
                      const c = CHAR_BY_ID[m.agent_kind];
                      if (!c) return null;
                      const r = ROLE_BY_ID[m.directive];
                      return (
                        <div
                          key={m.id}
                          className={"tb-preset-seat" + (m.is_leader ? " leader" : "")}
                          style={{
                            "--s-accent": c.accent,
                            "--r-accent": r?.accent ?? c.accent,
                          } as React.CSSProperties}
                        >
                          {c.portrait ? (
                            <span
                              className="tb-preset-portrait"
                              style={{ backgroundImage: `url(${c.portrait})` }}
                            />
                          ) : (
                            <span className="tb-preset-portrait empty">
                              {c.placeholderGlyph}
                            </span>
                          )}
                          <span className="tb-preset-seat-name">
                            {c.name.toLowerCase()}
                          </span>
                          <span className="tb-preset-seat-role">
                            {m.is_leader && <span className="tps-led">◆</span>}
                            {r?.label ?? m.directive}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="tb-preset-card-foot">
                    <button className="tb-preset-load-btn" onClick={() => loadPreset(p)}>
                      edit ↗
                    </button>
                    <button
                      className="tb-preset-spawn-btn"
                      onClick={() => {
                        onSpawnPreset(p);
                        onClose();
                      }}
                    >
                      spawn ↵
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
