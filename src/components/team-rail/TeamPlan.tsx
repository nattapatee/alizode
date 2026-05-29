import { useLanePlan } from "../../hooks/useLaneStream";

const STATUS_GLYPH: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

interface Props {
  workspaceId: string | null | undefined;
  leaderLaneId: string | null;
  leaderName: string;
}

export function TeamPlan({ workspaceId, leaderLaneId, leaderName }: Props) {
  const plan = useLanePlan(workspaceId, leaderLaneId);
  if (plan.length === 0) return null;

  return (
    <div className="tv-plan">
      <div className="tv-plan-head">
        <span className="tv-plan-arrow">▸</span>
        <span className="tv-plan-title">PLAN</span>
        <span className="tv-plan-step">· {leaderName}</span>
      </div>
      <div className="tv-plan-list">
        {plan.map((entry, i) => (
          <div
            key={i}
            className={"tv-plan-row k-" + entry.status}
            title={entry.priority ?? ""}
          >
            <span className="tv-plan-glyph">
              {STATUS_GLYPH[entry.status] ?? "○"}
            </span>
            <span className="tv-plan-text">{entry.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
