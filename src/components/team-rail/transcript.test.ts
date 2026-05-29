import { describe, it, expect } from "vitest";
import { groupTranscript } from "./transcript";
import type { LaneEvent, LaneEventKind } from "../../lib/acp-events";

function ev(kind: LaneEventKind, payload: Record<string, unknown>, seq = 0): LaneEvent {
  return { workspace_id: "w", lane_id: "l", seq, ts: seq, kind, payload };
}

describe("groupTranscript", () => {
  it("merges consecutive agent chunks into one block", () => {
    const blocks = groupTranscript([
      ev("AgentText", { text: "Hello " }, 1),
      ev("AgentText", { text: "world" }, 2),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("AgentText");
    expect(blocks[0].text).toBe("Hello world");
  });

  it("keeps user and agent as separate blocks", () => {
    const blocks = groupTranscript([
      ev("UserIn", { text: "hi" }, 1),
      ev("AgentText", { text: "hey " }, 2),
      ev("AgentText", { text: "there" }, 3),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["UserIn", "AgentText"]);
    expect(blocks[1].text).toBe("hey there");
  });

  it("drops Thought and empty events", () => {
    const blocks = groupTranscript([
      ev("Thought", { text: "thinking..." }, 1),
      ev("AgentText", { text: "" }, 2),
      ev("AgentText", { text: "real" }, 3),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("real");
  });

  it("renders tool calls as their own block", () => {
    const blocks = groupTranscript([
      ev("AgentText", { text: "calling" }, 1),
      ev("ToolCall", { tool: "peer_reply" }, 2),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].kind).toBe("ToolCall");
    expect(blocks[1].text).toContain("peer_reply");
  });
});
