import { useState, useRef, useCallback } from "react";
import { SELECTABLE } from "../../lib/characters";

interface Props {
  onSelect: (agentId: string) => void;
  onCancel: () => void;
}

export function AgentPicker({ onSelect, onCancel }: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  const setVideoRef = useCallback((id: string) => (el: HTMLVideoElement | null) => {
    videoRefs.current[id] = el;
    if (el) el.play().catch(() => {});
  }, []);

  return (
    <div className="newtab-overlay" onClick={onCancel}>
      <div className="boot-pick" onClick={(e) => e.stopPropagation()}>
        <div className="pick-title">
          <span className="hash">›</span> select an agent to begin
          <span className="pick-hint">
            double-click to launch · esc to cancel
          </span>
        </div>

        <div className="pick-grid">
          {SELECTABLE.map((c) => (
            <button
              key={c.id}
              type="button"
              className={"pick-card" + (pickedId === c.id ? " on" : "")}
              style={
                {
                  "--accent": c.accent,
                  "--accent-soft": c.accentSoft,
                } as React.CSSProperties
              }
              onClick={() => setPickedId(c.id)}
              onDoubleClick={() => onSelect(c.id)}
              onMouseEnter={() => setHoverId(c.id)}
              onMouseLeave={() => setHoverId((prev) => prev === c.id ? null : prev)}
            >
              <div className="pick-portrait-wrap">
                {c.video && hoverId === c.id ? (
                  <video
                    ref={setVideoRef(c.id)}
                    className="pick-portrait pick-portrait-vid"
                    src={c.video}
                    loop
                    muted
                    playsInline
                    autoPlay
                  />
                ) : c.portrait ? (
                  <div
                    className="pick-portrait"
                    style={{ backgroundImage: `url(${c.portrait})` }}
                  />
                ) : (
                  <div className="pick-portrait pick-portrait-empty">
                    <span className="pp-glyph">{c.placeholderGlyph}</span>
                    <span className="pp-tag">// no_avatar</span>
                    <span className="pp-id">{c.model}</span>
                  </div>
                )}
                <div className="pick-portrait-glow" />
                <div className="pick-portrait-grid" />
              </div>
              <div className="pick-meta">
                <div className="pick-name">
                  <span className="dot" /> {c.name}
                </div>
                <div className="pick-model">{c.model}</div>
                <div className="pick-role">{c.role}</div>
                <div className="pick-tag">{c.tagline}</div>
                <div className="pick-sample">"{c.sample}"</div>
              </div>
              <div className="pick-corner">
                {pickedId === c.id ? "▣ selected" : "□ select"}
              </div>
            </button>
          ))}
        </div>

        <div className="pick-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            ← back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!pickedId}
            onClick={() => pickedId && onSelect(pickedId)}
          >
            boot terminal ↵
          </button>
        </div>
      </div>
    </div>
  );
}
