import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { CHAR_BY_ID } from "../../lib/characters";

interface PeerEnvelope {
  id: string;
  fromLaneId: string;
  toLaneId: string;
  message: string;
  sentAt: number;
}

interface PeerReplyPayload {
  envelopeId: string;
  fromLaneId: string;
  reply: string;
  sentAt: number;
}

interface CrossTalkMsg {
  id: string;
  from: string;
  to: string;
  text: string;
  ts: number;
}

function laneChar(laneId: string) {
  return CHAR_BY_ID[laneId.replace(/-\d+$/, "")] ?? null;
}

function laneName(laneId: string): string {
  return laneChar(laneId)?.name?.toLowerCase() ?? laneId;
}

interface Props {
  teamLaneIds: string[];
}

export function TeamCrossTalk({ teamLaneIds }: Props) {
  const [messages, setMessages] = useState<CrossTalkMsg[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  const memberSet = new Set(teamLaneIds);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const unsubs: Promise<UnlistenFn>[] = [];
    unsubs.push(
      listen<PeerEnvelope>("acp-inter-lane-message", (e) => {
        const env = e.payload;
        if (!memberSet.has(env.fromLaneId) && !memberSet.has(env.toLaneId)) return;
        setMessages((prev) => {
          if (prev.some((m) => m.id === env.id)) return prev;
          return [...prev, { id: env.id, from: env.fromLaneId, to: env.toLaneId, text: env.message, ts: env.sentAt }];
        });
      }),
    );
    unsubs.push(
      listen<PeerReplyPayload>("acp-peer-reply", (e) => {
        const p = e.payload;
        if (!memberSet.has(p.fromLaneId)) return;
        const id = `reply-${p.envelopeId}-${p.sentAt}`;
        setMessages((prev) => {
          if (prev.some((m) => m.id === id)) return prev;
          return [...prev, { id, from: p.fromLaneId, to: "", text: p.reply, ts: p.sentAt }];
        });
      }),
    );
    return () => {
      unsubs.forEach((promise) => promise.then((fn) => fn()));
    };
    // memberSet is derived from teamLaneIds; re-bind when membership changes
  }, [teamLaneIds.join(",")]);

  return (
    <div className="tv-ct">
      <div className="tv-ct-head">
        <span className="tv-ct-title">TEAM CROSS-TALK</span>
      </div>
      <div className="tv-ct-feed" ref={feedRef}>
        {messages.length === 0 ? (
          <div className="tv-ct-empty">no team messages yet</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="tv-ct-row">
              <span
                className="tv-ct-from"
                style={{ color: laneChar(m.from)?.accent ?? "var(--cyan)" }}
              >
                {laneName(m.from)}
              </span>
              {m.to && <span className="tv-ct-arrow">→ {laneName(m.to)}</span>}
              <span className="tv-ct-text">{m.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
