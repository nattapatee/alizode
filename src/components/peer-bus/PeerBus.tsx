import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { Lane } from "../../lib/acp-events";
import { CHAR_BY_ID } from "../../lib/characters";

type MsgStatus = "delivered" | "replied" | "pending" | "failed";

interface BusMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  status: MsgStatus;
  ts: number;
}

interface PeerEnvelope {
  id: string;
  fromLaneId: string;
  toLaneId: string;
  message: string;
  requestId: string;
  sentAt: number;
}

interface PeerReplyPayload {
  envelopeId: string;
  fromLaneId: string;
  reply: string;
  sentAt: number;
}

interface ReviewRequest {
  packetId: string;
  fromLaneId: string;
  toLaneId: string;
  note?: string;
  requestId: string;
  sentAt: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function laneChar(laneId: string) {
  const kind = laneId.replace(/-\d+$/, "");
  return CHAR_BY_ID[kind] ?? null;
}

function laneAccent(laneId: string): string {
  return laneChar(laneId)?.accent ?? "var(--cyan)";
}

function laneName(laneId: string): string {
  const c = laneChar(laneId);
  return c?.name?.toLowerCase() ?? laneId;
}

interface Props {
  lanes: Lane[];
  activeLaneId: string | null;
}

export function PeerBus({ lanes, activeLaneId }: Props) {
  const [messages, setMessages] = useState<BusMessage[]>([]);
  const [targetLane, setTargetLane] = useState("");
  const [draft, setDraft] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const unsubs: Promise<UnlistenFn>[] = [];

    unsubs.push(
      listen<PeerEnvelope>("acp-inter-lane-message", (e) => {
        const env = e.payload;
        setMessages((prev) => [
          ...prev,
          {
            id: env.id,
            from: env.fromLaneId,
            to: env.toLaneId,
            text: env.message,
            status: "delivered",
            ts: env.sentAt,
          },
        ]);
      }),
    );

    unsubs.push(
      listen<PeerReplyPayload>("acp-peer-reply", (e) => {
        const p = e.payload;
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === p.envelopeId
              ? { ...m, status: "replied" as MsgStatus }
              : m,
          );
          return [
            ...updated,
            {
              id: `reply-${p.envelopeId}-${p.sentAt}`,
              from: p.fromLaneId,
              to: "",
              text: p.reply,
              status: "delivered" as MsgStatus,
              ts: p.sentAt,
            },
          ];
        });
      }),
    );

    unsubs.push(
      listen<ReviewRequest>("acp-review-requested", (e) => {
        const req = e.payload;
        setMessages((prev) => [
          ...prev,
          {
            id: req.packetId,
            from: req.fromLaneId,
            to: req.toLaneId,
            text: `[review] ${req.note ?? "review requested"}`,
            status: "delivered",
            ts: req.sentAt,
          },
        ]);
      }),
    );

    return () => {
      unsubs.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  const handleSend = useCallback(async () => {
    if (!targetLane || !draft.trim() || !activeLaneId) return;
    const text = draft.trim();
    setDraft("");
    const tempId = `manual-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        from: activeLaneId,
        to: targetLane,
        text,
        status: "pending",
        ts: Date.now(),
      },
    ]);
    try {
      const result = await invoke<{
        delivered: boolean;
        error?: string | null;
      }>("inter_lane_deliver", {
        fromLaneId: activeLaneId,
        toLaneId: targetLane,
        message: text,
        done: false,
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? { ...m, status: result.delivered ? "delivered" : "failed" }
            : m,
        ),
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
      );
    }
  }, [targetLane, draft, activeLaneId]);

  const presentIds = useMemo(() => {
    const s = new Set<string>();
    if (activeLaneId) s.add(activeLaneId);
    for (const l of lanes) s.add(l.id);
    for (const m of messages) {
      s.add(m.from);
      if (m.to) s.add(m.to);
    }
    return [...s];
  }, [lanes, messages, activeLaneId]);

  const inflight = messages.find((m) => m.status === "pending");
  const otherLanes = lanes.filter((l) => l.id !== activeLaneId);

  return (
    <div className="peerbus">
      {/* link visualizer */}
      <div className="pb-link">
        <div className="pb-link-grid" />
        <div className="pb-nodes">
          {presentIds.map((id) => {
            const c = laneChar(id);
            const isFrom = inflight?.from === id;
            const isTo = inflight?.to === id;
            const isSelf = id === activeLaneId;
            return (
              <div
                key={id}
                className={
                  "pb-node" +
                  (isFrom ? " from" : "") +
                  (isTo ? " to" : "") +
                  (isSelf ? " self" : "")
                }
                style={
                  {
                    "--n-accent": c?.accent ?? "var(--cyan)",
                  } as React.CSSProperties
                }
              >
                <div className="pb-node-ring" />
                {c?.chibi ? (
                  <img className="pb-node-pic" src={c.chibi} alt={c.name} />
                ) : (
                  <span className="pb-node-glyph">
                    {c?.placeholderGlyph ?? "◈"}
                  </span>
                )}
                <span className="pb-node-name">{c?.name ?? id}</span>
              </div>
            );
          })}
        </div>
        {inflight && (
          <div
            key={inflight.id}
            className="pb-packet"
            style={
              {
                "--from-accent": laneAccent(inflight.from),
                "--to-accent": laneAccent(inflight.to),
              } as React.CSSProperties
            }
          >
            <span className="pb-packet-dot" />
            <span className="pb-packet-trail" />
          </div>
        )}
      </div>

      {/* feed header */}
      <div className="pb-feed-head">
        <span>PEER_BUS</span>
        <span className="pb-feed-meta">
          {messages.length} message{messages.length !== 1 ? "s" : ""}
          {" · "}
          {messages.filter((m) => m.status === "pending").length} in-flight
        </span>
      </div>

      {/* message feed */}
      <div className="pb-feed" ref={feedRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`pb-msg ${msg.status}`}>
            <span className="pb-msg-t">{formatTime(msg.ts)}</span>
            <span className="pb-msg-route">
              <span style={{ color: laneAccent(msg.from) }}>
                {laneName(msg.from)}
              </span>
              {msg.to && (
                <>
                  <span className="pb-route-arrow">{"→"}</span>
                  <span style={{ color: laneAccent(msg.to) }}>
                    {laneName(msg.to)}
                  </span>
                </>
              )}
            </span>
            <span className={`pb-msg-status s-${msg.status}`}>
              {msg.status === "pending"
                ? "IN-FLIGHT"
                : msg.status.toUpperCase()}
            </span>
            <span className="pb-msg-text">{"▸"} {msg.text}</span>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="pb-empty">
            no peer traffic yet. use <code>@lane-id</code> mentions or{" "}
            <code>/peer</code> to send messages.
          </div>
        )}
      </div>

      {/* composer */}
      <div className="pb-composer">
        <select
          className="pb-target"
          value={targetLane}
          onChange={(e) => setTargetLane(e.target.value)}
        >
          <option value="">{"→"} select peer</option>
          {otherLanes.map((l) => {
            const c = laneChar(l.id);
            return (
              <option key={l.id} value={l.id}>
                {c?.name?.toLowerCase() ?? l.id} {"·"}{" "}
                {c?.role ?? "agent"}
              </option>
            );
          })}
        </select>
        <input
          className="pb-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="peer_send (from active lane)..."
        />
        <button
          className="pb-send"
          onClick={handleSend}
          disabled={!targetLane || !draft.trim()}
        >
          send {"▸"}
        </button>
      </div>
    </div>
  );
}
