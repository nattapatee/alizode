import type { Workspace, Lane } from "../../lib/acp-events";

interface Props {
  workspace: Workspace | null;
  lanes: Lane[];
}

export function StatusBar({ workspace, lanes }: Props) {
  const alive = lanes.filter((l) => l.status !== "Stopped").length;

  return (
    <div className="term-foot">
      <span>{workspace ? workspace.cwd : "// no workspace"}</span>
      <span className="foot-spacer" />
      <span>{alive} lane{alive !== 1 ? "s" : ""} alive</span>
      <span className="bullet">·</span>
      <span>v0.1.0</span>
    </div>
  );
}
