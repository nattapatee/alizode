interface Props {
  status: "auto-allow" | "prompted" | "denied";
}

const CONFIG = {
  "auto-allow": { color: "bg-neon-green", label: "auto-allow" },
  prompted: { color: "bg-neon-amber", label: "prompted" },
  denied: { color: "bg-neon-red", label: "denied" },
} as const;

export function PermissionBadge({ status }: Props) {
  const { color, label } = CONFIG[status];
  return (
    <span className="flex items-center gap-1 text-[10px] text-zinc-500">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
