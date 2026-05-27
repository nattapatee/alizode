import { useRef, useEffect, useMemo, useCallback } from "react";
import type { Lane, LaneEvent } from "../../lib/acp-events";
import { groupEventsIntoSegments } from "../../lib/acp-events";
import { LaneHeader } from "./LaneHeader";
import { EventRow } from "./EventRow";
import { AgentTextBlock } from "./AgentTextBlock";
import { expandTranscriptWindow } from "../../hooks/useLaneStream";

const SCROLL_THRESHOLD = 120;

interface LaneViewProps {
  lane: Lane | null;
  events: LaneEvent[];
  isLoading?: boolean;
  harnessStatus?: string;
  transcriptWindow?: number;
  isStreaming?: boolean;
  onCancel?: () => void;
}

export function LaneView({ lane, events, isLoading, harnessStatus, transcriptWindow = 60, isStreaming, onCancel }: LaneViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const segments = useMemo(() => groupEventsIntoSegments(events), [events]);

  const visibleSegments = useMemo(
    () => segments.slice(-transcriptWindow),
    [segments, transcriptWindow],
  );
  const hiddenCount = Math.max(0, segments.length - transcriptWindow);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  }, []);

  useEffect(() => {
    stickRef.current = true;
  }, [lane?.id]);

  useEffect(() => {
    if (!stickRef.current) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [events.length, segments.length]);

  useEffect(() => {
    if (!lane) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "h") {
        e.preventDefault();
        expandTranscriptWindow(lane.workspace_id, lane.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lane]);

  if (!lane) {
    return (
      <div className="log" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--ink-faint)", font: "13px var(--mono)" }}>No lane selected</span>
      </div>
    );
  }

  return (
    <>
      <LaneHeader lane={lane} harnessStatus={harnessStatus} onCancel={onCancel} />
      <div ref={scrollRef} className="log" onScroll={handleScroll}>
        {hiddenCount > 0 && (
          <button
            onClick={() => lane && expandTranscriptWindow(lane.workspace_id, lane.id)}
            className="log-load-more"
          >
            ^ {hiddenCount} earlier rows hidden (Ctrl+H)
          </button>
        )}
        {visibleSegments.length === 0 ? (
          <div className="log-empty">Waiting for events...</div>
        ) : (
          visibleSegments.map((seg) =>
            seg.type === "agent-text" ? (
              <AgentTextBlock
                key={`at-${seg.firstSeq}`}
                chunks={seg.chunks}
                isSealed={seg.isSealed}
              />
            ) : (
              <EventRow
                key={`${seg.event.lane_id}-${seg.event.seq}`}
                event={seg.event}
              />
            ),
          )
        )}
        {isLoading && !isStreaming && (
          <div className="log-row log-status processing">
            <span className="log-t" />
            <span className="thinking">
              <span className="dots"><i /><i /><i /></span>
              processing<span className="el">...</span>
            </span>
          </div>
        )}
        {isStreaming && (
          <div className="log-row log-status transmitting">
            <span className="log-t" />
            <span className="transmit-indicator">
              <span className="transmit-bars"><i /><i /><i /><i /></span>
              transmitting<span className="el">...</span>
            </span>
          </div>
        )}
      </div>
    </>
  );
}
