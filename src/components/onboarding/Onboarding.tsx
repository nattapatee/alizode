import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SELECTABLE } from "../../lib/characters";
import type { Character } from "../../lib/characters";

interface AgentInfo {
  kind: string;
  binary: string;
  available: boolean;
  protocol: string;
  default_model: string;
}

interface Props {
  onComplete: (name: string, cwd: string) => void;
}

export function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [name, setName] = useState("my-workspace");
  const [cwd, setCwd] = useState("~");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    invoke<AgentInfo[]>("agent_list")
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  const availableKinds = useMemo(
    () => new Set(agents.filter((a) => a.available).map((a) => a.kind)),
    [agents],
  );
  const anyAvailable = availableKinds.size > 0;

  const bootLines = useMemo(() => {
    const lines = [
      { ok: true, text: "loading kernel · alizode/0.1.0" },
      { ok: true, text: `mounting ${cwd}` },
      { ok: true, text: "spinning up data_core_hub-7" },
    ];
    if (!loading) {
      const names = agents
        .filter((a) => a.available)
        .map((a) => a.kind)
        .join(" · ");
      lines.push({
        ok: anyAvailable,
        text: anyAvailable
          ? `${availableKinds.size} agents detected: ${names}`
          : "no agents detected — install claude, codex, or gemini CLI",
      });
      lines.push({ ok: anyAvailable, text: "awaiting operator" });
    } else {
      lines.push({ ok: false, text: "scanning PATH..." });
    }
    return lines;
  }, [loading, agents, cwd, anyAvailable, availableKinds.size]);

  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (step !== 0) return;
    if (shown >= bootLines.length) {
      const t = setTimeout(() => setStep(1), 450);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown(shown + 1), 220);
    return () => clearTimeout(t);
  }, [shown, step, bootLines.length]);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      onComplete(name.trim(), cwd.trim() || "~");
    } finally {
      setCreating(false);
    }
  }, [name, cwd, creating, onComplete]);

  return (
    <div className="boot-root">
      <div
        className="boot-bg"
        style={{
          backgroundImage: "url(assets/bg-cityscape.png)",
          opacity: 0.55,
        }}
      />
      <div className="boot-vignette" />
      <div className="scanlines" />

      <div className="boot-frame">
        <span className="bracket tl" />
        <span className="bracket tr" />
        <span className="bracket bl" />
        <span className="bracket br" />

        <div className="boot-header">
          <span className="boot-tag">DATA_CORE_HUB-7</span>
          <span className="boot-sep" />
          <span className="boot-tag dim">orbital_platform_config</span>
          <span className="boot-sep" />
          <span className="boot-tag dim">v0.1.0</span>
        </div>

        {step === 0 && (
          <div className="boot-stage boot-log">
            <div className="boot-title">
              <span className="cursor-block" />
              <span>alizode</span>
              <span className="boot-sub">// terminal · for · agents</span>
            </div>
            <ul className="loglist">
              {bootLines.slice(0, shown).map((l, i) => (
                <li key={i}>
                  <span className={"logtag " + (l.ok ? "ok" : "wait")}>
                    {l.ok ? "[ok]" : "[..]"}
                  </span>
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === 1 && (
          <div className="boot-stage boot-pick">
            <div className="pick-title">
              <span className="hash">›</span> select an agent to begin
              <span className="pick-hint">
                create a workspace · spawn lanes inside
              </span>
            </div>

            <div className="pick-grid">
              {SELECTABLE.map((c) => (
                <AgentCard
                  key={c.id}
                  char={c}
                  available={availableKinds.has(c.id)}
                />
              ))}
            </div>

            <div className="boot-ws-form">
              <label>
                <span className="boot-ws-label">name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-workspace"
                />
              </label>
              <label>
                <span className="boot-ws-label">cwd</span>
                <input
                  type="text"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="~/projects/my-app"
                />
              </label>
            </div>

            <div className="pick-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setStep(0);
                  setShown(0);
                }}
              >
                ← back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!name.trim() || !anyAvailable || creating}
                onClick={handleCreate}
              >
                {creating ? "booting..." : "boot terminal ↵"}
              </button>
            </div>

            {!anyAvailable && !loading && (
              <p className="boot-warn">
                install at least one agent CLI to continue
              </p>
            )}
          </div>
        )}

        <div className="boot-footer">
          <span>{cwd}</span>
          <span>{availableKinds.size} agents detected</span>
          <span>v0.1.0</span>
        </div>
      </div>
    </div>
  );
}

function AgentCard({
  char,
  available,
}: {
  char: Character;
  available: boolean;
}) {
  return (
    <div
      className="pick-card"
      style={
        {
          "--accent": char.accent,
          "--accent-soft": char.accentSoft,
          opacity: available ? 1 : 0.4,
        } as React.CSSProperties
      }
    >
      <div className="pick-portrait-wrap">
        {char.portrait ? (
          <div
            className="pick-portrait"
            style={{ backgroundImage: `url(${char.portrait})` }}
          />
        ) : (
          <div className="pick-portrait pick-portrait-empty">
            <span className="pp-glyph">{char.placeholderGlyph}</span>
            <span className="pp-tag">// no_avatar</span>
            <span className="pp-id">{char.model}</span>
          </div>
        )}
        <div className="pick-portrait-glow" />
        <div className="pick-portrait-grid" />
      </div>
      <div className="pick-meta">
        <div className="pick-name">
          <span className="dot" /> {char.name}
        </div>
        <div className="pick-model">{char.model}</div>
        <div className="pick-role">{char.role}</div>
        <div className="pick-tag">{char.tagline}</div>
        <div className="pick-sample">"{char.sample}"</div>
      </div>
      <div className="pick-corner">
        {available ? "● ready" : "○ not found"}
      </div>
    </div>
  );
}
