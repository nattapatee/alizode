import { describe, it, expect } from "vitest";
import { buildTeamContext } from "./team-context";

const base = {
  team: "strike",
  leader: "claude-1",
  roster: "- claude-1 (leader)",
  laneId: "codex-2",
};

describe("buildTeamContext", () => {
  it("fills placeholders for a leader", () => {
    const out = buildTeamContext({ ...base, isLeader: true, role: "leader" });
    expect(out).toContain("LEADER");
    expect(out).toContain("strike");
    expect(out).toContain("codex-2");
    expect(out).toContain("- claude-1 (leader)");
    expect(out).not.toContain("{team}");
  });

  it("uses the role-specific member template", () => {
    const out = buildTeamContext({ ...base, isLeader: false, role: "frontend" });
    expect(out).toContain("FRONTEND");
    expect(out).toContain("claude-1");
    expect(out).not.toContain("{leader}");
  });

  it("falls back to default for unknown roles", () => {
    const out = buildTeamContext({ ...base, isLeader: false, role: "design" });
    expect(out).toContain("design");
    expect(out).not.toContain("{role}");
  });
});
