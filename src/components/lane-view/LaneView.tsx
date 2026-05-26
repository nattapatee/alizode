import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import type { Lane, LaneEvent } from "../../lib/acp-events";
import { groupEventsIntoSegments } from "../../lib/acp-events";
import { LaneHeader } from "./LaneHeader";
import { EventRow } from "./EventRow";
import { AgentTextBlock } from "./AgentTextBlock";

const WINDOW_SIZE = 80;
const SCROLL_THRESHOLD = 120;

interface LaneViewProps {
  lane: Lane | null;
  events: LaneEvent[];
  isLoading?: boolean;
  isStreaming?: boolean;
}

export function LaneView({ lane, events, isLoading, isStreaming }: LaneViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [visibleCount, setVisibleCount] = useState(WINDOW_SIZE);

  const segments = useMemo(() => groupEventsIntoSegments(events), [events]);

  const visibleSegments = useMemo(
    () => segments.slice(-visibleCount),
    [segments, visibleCount],
  );
  const hasOlder = segments.length > visibleCount;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  }, []);

  useEffect(() => {
    setVisibleCount(WINDOW_SIZE);
    stickRef.current = true;
  }, [lane?.id]);

  useEffect(() => {
    if (!stickRef.current) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [events.length, segments.length]);

  if (!lane) {
    return (
      <div className="log" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--ink-faint)", font: "13px var(--mono)" }}>No lane selected</span>
      </div>
    );
  }

  return (
    <>
      <LaneHeader lane={lane} />
      <div ref={scrollRef} className="log" onScroll={handleScroll}>
        {hasOlder && (
          <button
            onClick={() => setVisibleCount((c) => c + WINDOW_SIZE)}
            className="log-load-more"
          >
            Load {Math.min(WINDOW_SIZE, segments.length - visibleCount)} older
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
