export const TEAM_ROLES = [
  { id: "leader", label: "Leader", accent: "#ff9d3f" },
  { id: "frontend", label: "Frontend", accent: "#7df9ff" },
  { id: "backend", label: "Backend", accent: "#d678ff" },
  { id: "qa", label: "QA", accent: "#7cd17a" },
  { id: "architect", label: "Architect", accent: "#ffd166" },
  { id: "fullstack", label: "Full-stack", accent: "#8ecae6" },
  { id: "devops", label: "DevOps", accent: "#90be6d" },
  { id: "security", label: "Security", accent: "#ef476f" },
  { id: "data", label: "Data", accent: "#06d6a0" },
  { id: "database", label: "Database", accent: "#2dd4bf" },
  { id: "quant", label: "Quant", accent: "#c77dff" },
  { id: "market_analyst", label: "Market", accent: "#4cc9f0" },
  { id: "risk", label: "Risk", accent: "#f9844a" },
  { id: "trading_ops", label: "Trading Ops", accent: "#f9c74f" },
] as const;

export const ROLE_BY_ID = Object.fromEntries(
  TEAM_ROLES.map((role) => [role.id, role]),
) as Record<string, (typeof TEAM_ROLES)[number]>;

export const ROLE_ACCENTS = Object.fromEntries(
  TEAM_ROLES.map((role) => [role.id, role.accent]),
) as Record<string, string>;
