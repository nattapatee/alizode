import { useState, useCallback, useRef, useEffect } from "react";

interface Props {
  laneId: string | null;
  laneStatus?: string;
  lanes?: Array<{ id: string }>;
  onSubmit: (text: string) => void;
}

export function CommandBar({ laneId, laneStatus, lanes, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const [mentionHints, setMentionHints] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const isBusy = laneStatus === "Running";

  useEffect(() => {
    if (!value.startsWith("@") || !lanes) {
      setMentionHints([]);
      return;
    }
    const partial = value.slice(1).split(" ")[0].toLowerCase();
    if (!partial) {
      setMentionHints(lanes.map((l) => l.id));
      return;
    }
    setMentionHints(
      lanes.filter((l) => l.id.toLowerCase().includes(partial)).map((l) => l.id),
    );
  }, [value, lanes]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed || isBusy) return;
      onSubmit(trimmed);
      setValue("");
      setMentionHints([]);
    },
    [value, onSubmit, isBusy],
  );

  const acceptMention = useCallback(
    (id: string) => {
      setValue(`@${id} `);
      setMentionHints([]);
      inputRef.current?.focus();
    },
    [],
  );

  return (
    <form onSubmit={handleSubmit} className="composer">
      {mentionHints.length > 0 && (
        <div className="mention-hints">
          {mentionHints.map((id) => (
            <button
              key={id}
              type="button"
              className="mention-hint-item"
              onMouseDown={(e) => {
                e.preventDefault();
                acceptMention(id);
              }}
            >
              @{id}
            </button>
          ))}
        </div>
      )}
      <span className="cmp-prefix" style={isBusy ? { opacity: 0.5 } : undefined}>
        {laneId ?? "no-lane"}
      </span>
      <span className="cmp-colon">:</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={
          !laneId
            ? "create a workspace first"
            : isBusy
              ? "agent is working..."
              : "type a message, /command, or @lane..."
        }
        disabled={!laneId}
      />
      {isBusy && <span className="cmp-busy">BUSY</span>}
      <span className="cmp-help">?HELP</span>
    </form>
  );
}
