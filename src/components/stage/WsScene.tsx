import { useState, useEffect, useRef, useCallback } from "react";
import type { Lane } from "../../lib/acp-events";
import { CHAR_BY_ID } from "../../lib/characters";

interface Props {
  lanes: Lane[];
  activeLaneId: string | null;
  isStreaming?: boolean;
  onSelectLane: (id: string) => void;
}

function cssStatus(s: string, streaming: boolean): string {
  if (s === "Running") return streaming ? "talking" : "thinking";
  return "idle";
}

interface Pos {
  x: number;
  prevX: number;
}

export function WsScene({ lanes, activeLaneId, isStreaming = false, onSelectLane }: Props) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    laneId: string;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    rect: DOMRect;
  } | null>(null);
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    setPositions((p) => {
      const next = { ...p };
      let changed = false;
      lanes.forEach((l, i) => {
        if (next[l.id] == null) {
          const spread =
            lanes.length > 1
              ? 20 + (i * 60) / (lanes.length - 1)
              : 50;
          next[l.id] = {
            x: spread + (Math.random() * 8 - 4),
            prevX: spread,
          };
          changed = true;
        }
      });
      const keep = new Set(lanes.map((l) => l.id));
      for (const id of Object.keys(next)) {
        if (!keep.has(id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : p;
    });
  }, [lanes]);

  useEffect(() => {
    const id = setInterval(() => {
      setPositions((p) => {
        const next = { ...p };
        let changed = false;
        for (const l of lanes) {
          if (l.id === activeLaneId) continue;
          if (l.id === draggingId) continue;
          if (l.status !== "Idle" && l.status !== "Waiting") continue;
          if (Math.random() < 0.45) {
            const cur = next[l.id]?.x ?? 50;
            const drift = (Math.random() - 0.5) * 30;
            const target = Math.max(8, Math.min(92, cur + drift));
            next[l.id] = { x: target, prevX: cur };
            changed = true;
          }
        }
        return changed ? next : p;
      });
    }, 2600);
    return () => clearInterval(id);
  }, [lanes, activeLaneId, draggingId]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, laneId: string) => {
      if (!sceneRef.current) return;
      const rect = sceneRef.current.getBoundingClientRect();
      dragRef.current = {
        laneId,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        rect,
      };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      e.preventDefault();
    },
    [],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved) {
      const dist = Math.hypot(
        e.clientX - d.startX,
        e.clientY - d.startY,
      );
      if (dist < 5) return;
      d.moved = true;
      setDraggingId(d.laneId);
    }
    const xPct = ((e.clientX - d.rect.left) / d.rect.width) * 100;
    const clamped = Math.max(6, Math.min(94, xPct));
    setPositions((p) => {
      const prev = p[d.laneId]?.x ?? 50;
      return { ...p, [d.laneId]: { x: clamped, prevX: prev } };
    });
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.moved) onSelectLane(d.laneId);
      dragRef.current = null;
      setDraggingId(null);
    },
    [onSelectLane],
  );

  const activeChar = activeLaneId
    ? CHAR_BY_ID[
        lanes.find((l) => l.id === activeLaneId)?.agent_kind ?? ""
      ]
    : null;

  return (
    <div
      className={`ws-scene status-${activeLaneId ? cssStatus(lanes.find((l) => l.id === activeLaneId)?.status ?? "Idle", isStreaming) : "idle"}`}
      ref={sceneRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="ws-bg" />
      <div className="ws-overlay" />
      <div className="ws-stars" />
      <div className="ws-floor" />

      <div
        className="ws-kiosk"
        style={{ borderColor: activeChar?.accent ?? "var(--cyan)" }}
      >
        <div className="ws-kiosk-screen">
          <div
            className="ws-kiosk-line"
            style={{ color: activeChar?.accent ?? "var(--cyan)" }}
          >
            $ hub-7
          </div>
          <div className="ws-kiosk-line dim">
            {lanes.length} lane{lanes.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <div className="ws-roster" data-count={lanes.length}>
        {lanes.map((l) => {
          const c = CHAR_BY_ID[l.agent_kind];
          const pos = positions[l.id];
          const x = pos?.x ?? 50;
          const prevX = pos?.prevX ?? x;
          const isActive = l.id === activeLaneId;
          const isDragging = l.id === draggingId;
          const stat = cssStatus(l.status, isActive && isStreaming);
          const isWalking =
            !isActive &&
            !isDragging &&
            stat === "idle" &&
            Math.abs(x - prevX) > 0.3;
          const facing = x > prevX ? 1 : x < prevX ? -1 : 1;

          return (
            <button
              key={l.id}
              className={
                "rc stat-" +
                stat +
                (isActive ? " on" : "") +
                (isDragging ? " dragging" : "") +
                (isWalking ? " walking" : "")
              }
              onPointerDown={(e) => onPointerDown(e, l.id)}
              title={
                (c?.name ?? l.agent_kind.toUpperCase()) +
                " · " +
                l.status.toLowerCase()
              }
              style={
                {
                  "--rc-x": x + "%",
                  "--rc-facing": facing,
                  "--rc-accent": c?.accent ?? "var(--cyan)",
                  "--rc-accent-soft": c?.accentSoft ?? "var(--cyan)",
                } as React.CSSProperties
              }
            >
              {c?.chibi ? (
                <img
                  className="rc-body"
                  src={c.chibi}
                  alt={c.name}
                  draggable={false}
                />
              ) : (
                <div className="rc-empty">
                  <span className="rc-glyph">
                    {c?.placeholderGlyph ?? "◈"}
                  </span>
                </div>
              )}
              <span className="rc-shadow" />
              {stat === "thinking" && (
                <span className="rc-bubble think">
                  <span />
                  <span />
                  <span />
                </span>
              )}
              {stat === "talking" && (
                <span
                  className="rc-bubble talk"
                  style={{ borderColor: c?.accent ?? "var(--cyan)" }}
                >
                  <i style={{ background: c?.accent ?? "var(--cyan)" }} />
                  <i style={{ background: c?.accent ?? "var(--cyan)" }} />
                  <i style={{ background: c?.accent ?? "var(--cyan)" }} />
                </span>
              )}
              <span className="rc-tag">
                {c?.name ?? l.agent_kind.toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>

      <span className="ws-bracket tl" />
      <span className="ws-bracket tr" />
      <span className="ws-bracket bl" />
      <span className="ws-bracket br" />
    </div>
  );
}
