interface Props {
  onClose: () => void;
}

interface Entry {
  cmd: string;
  desc: string;
}

const SLASH_COMMANDS: Entry[] = [
  { cmd: "/model", desc: "Pick AI model" },
  { cmd: "/effort", desc: "Set effort level" },
  { cmd: "/mode", desc: "Set permission mode" },
  { cmd: "/sessions", desc: "Browse saved sessions" },
  { cmd: "/resume", desc: "Resume a session" },
  { cmd: "/clear", desc: "Clear display" },
  { cmd: "/stop", desc: "Stop lane" },
  { cmd: "/cancel", desc: "Cancel current turn" },
  { cmd: "/export", desc: "Copy session JSONL to clipboard" },
  { cmd: "/help", desc: "Show command list in chat" },
];

const MCP_TOOLS: Entry[] = [
  { cmd: "memory_get", desc: "Read shared memory by namespace + key" },
  { cmd: "memory_set", desc: "Write shared memory value" },
  { cmd: "memory_list", desc: "List all memory keys in namespace" },
  { cmd: "peer_send", desc: "Send message to another lane, await reply" },
  { cmd: "peer_reply", desc: "Reply to a received peer message" },
  { cmd: "peer_list", desc: "List active lanes and their status" },
  { cmd: "peer_cancel", desc: "Clear stale peer conversations" },
  { cmd: "review_request", desc: "Request code review from a peer lane" },
  { cmd: "review_reply", desc: "Reply to a review request" },
];

const SHORTCUTS: Entry[] = [
  { cmd: "@lane-id msg", desc: "Mention — route message to lane" },
  { cmd: "Cmd+T", desc: "New lane" },
  { cmd: "Cmd+W", desc: "Close lane" },
  { cmd: "Cmd+[ / ]", desc: "Switch lanes" },
  { cmd: "Ctrl+H", desc: "Expand transcript history" },
  { cmd: "Esc", desc: "Cancel" },
];

const AGENTS: Entry[] = [
  { cmd: "Claude", desc: "Anthropic — auto via npx" },
  { cmd: "Codex", desc: "OpenAI — codex-acp" },
  { cmd: "Gemini", desc: "Google — antigravity --experimental-acp" },
  { cmd: "OpenCode", desc: "Go — opencode acp" },
  { cmd: "Pi", desc: "pi-acp" },
  { cmd: "Droid", desc: "droid exec --acp" },
];

function Section({ title, entries, accent }: { title: string; entries: Entry[]; accent?: string }) {
  return (
    <div className="wiki-section">
      <div className="wiki-section-title" style={accent ? { color: accent } : undefined}>
        {title}
      </div>
      {entries.map((e) => (
        <div key={e.cmd} className="wiki-row">
          <code className="wiki-cmd">{e.cmd}</code>
          <span className="wiki-desc">{e.desc}</span>
        </div>
      ))}
    </div>
  );
}

export function WikiPanel({ onClose }: Props) {
  return (
    <div className="wiki-backdrop" onClick={onClose}>
      <div className="wiki-panel" onClick={(e) => e.stopPropagation()}>
        <div className="wiki-header">
          <span className="wiki-title">ALIZODE WIKI</span>
          <button className="wiki-close" onClick={onClose}>×</button>
        </div>
        <div className="wiki-body">
          <Section title="SLASH COMMANDS" entries={SLASH_COMMANDS} accent="var(--cyan)" />
          <Section title="MCP TOOLS (HARNESS)" entries={MCP_TOOLS} accent="var(--magenta)" />
          <Section title="KEYBOARD SHORTCUTS" entries={SHORTCUTS} accent="var(--yellow)" />
          <Section title="SUPPORTED AGENTS" entries={AGENTS} accent="var(--green)" />
        </div>
      </div>
    </div>
  );
}
