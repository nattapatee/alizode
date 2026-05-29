import directives from "../config/team-directives.json";

interface TeamContextVars {
  isLeader: boolean;
  role: string;
  team: string;
  leader: string;
  roster: string;
  laneId: string;
}

const TEMPLATES = directives as {
  leader: string;
  members: Record<string, string>;
};

function fill(template: string, vars: TeamContextVars): string {
  return template
    .replaceAll("{team}", vars.team)
    .replaceAll("{role}", vars.role)
    .replaceAll("{leader}", vars.leader)
    .replaceAll("{roster}", vars.roster)
    .replaceAll("{laneId}", vars.laneId);
}

/**
 * Build the role-context preamble injected into a team lane's first message.
 * Templates come from src/config/team-directives.json (user-editable).
 */
export function buildTeamContext(vars: TeamContextVars): string {
  const template = vars.isLeader
    ? TEMPLATES.leader
    : (TEMPLATES.members[vars.role] ?? TEMPLATES.members.default);
  return fill(template, vars);
}
