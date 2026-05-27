import { useRef, useEffect } from "react";
import type { Lane } from "../../lib/acp-events";
import { CHAR_BY_ID } from "../../lib/characters";
import { WsScene } from "./WsScene";

interface Props {
  lane: Lane | null;
  eventCount: number;
  isStreaming?: boolean;
  activeThought?: string;
  lanes: Lane[];
  onSelectLane: (id: string) => void;
}

function stageStatus(s: string, streaming: boolean, reasoning: boolean): string {
  if (reasoning) return "thinking";
  if (s === "Running") return streaming ? "talking" : "thinking";
  return "idle";
}

function statusLabel(s: string, streaming: boolean, reasoning: boolean): string {
  if (reasoning) return "REASONING";
  if (s === "Running") return streaming ? "TRANSMITTING" : "PROCESSING";
  if (s === "Waiting") return "AWAITING INPUT";
  if (s === "Error") return "ERROR";
  if (s === "Stopped") return "OFFLINE";
  return "IDLE · STANDBY";
}

export function Stage({
  lane,
  eventCount,
  isStreaming = false,
  activeThought = "",
  lanes,
  onSelectLane,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (lane?.status === "Running" || activeThought.length > 0) {
      v.playbackRate = isStreaming ? 2 : 1.2;
    } else {
      v.playbackRate = 0.7;
    }
    v.play().catch(() => {});
  }, [lane?.status, isStreaming, activeThought]);

  if (!lane) {
    return <div className="stage" />;
  }

  const char = CHAR_BY_ID[lane.agent_kind];
  const reasoning = activeThought.length > 0;
  const cssStatus = stageStatus(lane.status, isStreaming, reasoning);

  return (
    <div
      className="stage"
      style={
        char
          ? ({ "--accent": char.accent } as React.CSSProperties)
          : undefined
      }
    >
      <div className={`stage-frame status-${cssStatus}`}>
        <div className="stage-grid" />
        <div className="stage-scanring" />
        {char?.video ? (
          <video
            ref={videoRef}
            className="stage-portrait stage-portrait-video"
            src={char.video}
            loop
            muted
            playsInline
            autoPlay
          />
        ) : char?.portrait ? (
          <div
            className="stage-portrait"
            style={{ backgroundImage: `url(${char.portrait})` }}
          />
        ) : (
          <div className="stage-portrait pick-portrait-empty">
            <span className="pp-glyph">
              {char?.placeholderGlyph ?? "◈"}
            </span>
            <span className="pp-id">{lane.model}</span>
          </div>
        )}
        <div className="stage-portrait-glow" />
        <span className="stage-bracket tl" />
        <span className="stage-bracket tr" />
        <span className="stage-bracket bl" />
        <span className="stage-bracket br" />

        <div className="stage-state">
          <span className={`sdot status-${cssStatus}`} />
          {statusLabel(lane.status, isStreaming, reasoning)}
        </div>
      </div>

      <div className="stage-stats">
        <div className="stat">
          <span className="stat-k">agent</span>
          <span
            className="stat-v"
            style={{ color: char?.accent ?? "var(--accent)" }}
          >
            {char?.name ?? lane.agent_kind.toUpperCase()}
          </span>
        </div>
        <div className="stat">
          <span className="stat-k">model</span>
          <span className="stat-v">{lane.model}</span>
        </div>
        <div className="stat">
          <span className="stat-k">role</span>
          <span className="stat-v">{char?.role ?? "agent"}</span>
        </div>
        <div className="stat">
          <span className="stat-k">ctx</span>
          <span className="stat-v">{eventCount} events</span>
        </div>
        <div className="stage-thought-wrap">
          <div className="stage-thought-head">
            <span className="stat-k">thought</span>
            {reasoning && <span className="stage-thought-pulse" />}
          </div>
          <div
            className={`stage-thought${reasoning ? " stage-thought-live" : ""}`}
            aria-live="polite"
          >
            {activeThought || "\u00a0"}
          </div>
        </div>
      </div>

      <div className="stage-workspace">
        <div className="traits-head">
          <span>// workspace</span>
          <span className="ws-coord">
            {lanes.length} chibi{lanes.length !== 1 ? "s" : ""}
          </span>
        </div>
        <WsScene
          lanes={lanes}
          activeLaneId={lane.id}
          isStreaming={isStreaming}
          onSelectLane={onSelectLane}
        />
      </div>
    </div>
  );
}
