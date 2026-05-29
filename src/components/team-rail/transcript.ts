import type { LaneEvent } from "../../lib/acp-events";

export interface ChatBlock {
  key: string;
  kind: string;
  text: string;
}

// Kinds shown in the team chat log. Thought (raw reasoning) is intentionally
// dropped to keep the conversation concise.
const SHOWN = new Set(["UserIn", "AgentText", "Sys", "Error", "ToolCall"]);
// Consecutive events of these kinds merge into one block (streaming chunks).
const MERGE = new Set(["AgentText"]);

function blockText(e: LaneEvent): string {
  const raw = e.payload?.text;
  if (typeof raw === "string") return raw;
  if (e.kind === "ToolCall") {
    return `⚙ ${String(e.payload?.tool ?? e.payload?.name ?? "tool")}`;
  }
  return "";
}

/**
 * Collapse a raw lane transcript into display blocks: consecutive streaming
 * chunks from the same agent merge into a single block (so the agent's name
 * isn't repeated per chunk), empty events are dropped, and Thought is hidden.
 */
export function groupTranscript(events: LaneEvent[]): ChatBlock[] {
  const out: ChatBlock[] = [];
  for (const e of events) {
    if (!SHOWN.has(e.kind)) continue;
    const text = blockText(e);
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.kind === e.kind && MERGE.has(e.kind)) {
      out[out.length - 1] = { ...prev, text: prev.text + text };
    } else {
      out.push({ key: `${e.kind}-${e.seq}-${out.length}`, kind: e.kind, text });
    }
  }
  return out;
}
