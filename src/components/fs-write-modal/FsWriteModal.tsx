import { useEffect, useState, useCallback } from "react";
import type { AcpClient } from "../../lib/acp-client";
import type { AcpEvent } from "../../lib/acp-types";

interface PendingWrite {
  requestId: number;
  path: string;
  oldText: string;
  newText: string;
}

interface Props {
  client: AcpClient | null;
}

export function FsWriteModal({ client }: Props) {
  const [pending, setPending] = useState<PendingWrite | null>(null);

  useEffect(() => {
    if (!client) return;
    const unsub = client.onEvent((e: AcpEvent) => {
      if (e.type === 'fs_write_pending') {
        setPending({
          requestId: e.requestId,
          path: e.path,
          oldText: e.oldText,
          newText: e.newText,
        });
      }
    });
    return unsub;
  }, [client]);

  const handleDecision = useCallback(
    async (accept: boolean) => {
      if (!client || !pending) return;
      await client.respondFsWrite(pending.requestId, accept);
      setPending(null);
    },
    [client, pending],
  );

  if (!pending) return null;

  const fileName = pending.path.split('/').pop() ?? pending.path;
  const isNew = pending.oldText.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-1 border border-surface-2 rounded-lg p-5 max-w-2xl w-full mx-4 shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-neon-amber animate-pulse" />
          <span className="text-xs font-mono text-neon-amber uppercase tracking-wider">
            File Write Request
          </span>
        </div>

        <p className="text-sm text-zinc-300 mb-1">
          Agent wants to {isNew ? 'create' : 'modify'}
        </p>
        <p className="text-xs font-mono text-neon-cyan mb-3 truncate" title={pending.path}>
          {pending.path}
        </p>

        <div className="flex-1 min-h-0 overflow-auto mb-4 border border-surface-2 rounded bg-surface-0">
          <DiffView
            fileName={fileName}
            oldText={pending.oldText}
            newText={pending.newText}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => handleDecision(true)}
            className="flex-1 px-3 py-1.5 text-xs font-mono rounded
                       bg-neon-green/10 text-neon-green border border-neon-green/30
                       hover:bg-neon-green/20 transition-colors"
          >
            Accept
          </button>
          <button
            onClick={() => handleDecision(false)}
            className="flex-1 px-3 py-1.5 text-xs font-mono rounded
                       bg-neon-red/10 text-neon-red border border-neon-red/30
                       hover:bg-neon-red/20 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function DiffView({ fileName, oldText, newText }: { fileName: string; oldText: string; newText: string }) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const lines: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = [];

  if (oldText.length === 0) {
    for (const line of newLines) {
      lines.push({ type: 'add', text: line });
    }
  } else {
    let oi = 0;
    let ni = 0;
    while (oi < oldLines.length || ni < newLines.length) {
      if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
        lines.push({ type: 'same', text: oldLines[oi] });
        oi++;
        ni++;
      } else if (oi < oldLines.length) {
        lines.push({ type: 'remove', text: oldLines[oi] });
        oi++;
      } else {
        lines.push({ type: 'add', text: newLines[ni] });
        ni++;
      }
    }
  }

  const displayLines = lines.length > 200 ? lines.slice(0, 200) : lines;
  const truncated = lines.length > 200;

  return (
    <div className="text-[11px] font-mono leading-relaxed">
      <div className="px-2 py-1 text-zinc-500 border-b border-surface-2 sticky top-0 bg-surface-0">
        {fileName} — {oldLines.length}→{newLines.length} lines
      </div>
      <pre className="p-2 whitespace-pre-wrap break-all">
        {displayLines.map((line, i) => (
          <div
            key={i}
            className={
              line.type === 'add'
                ? 'bg-neon-green/5 text-neon-green'
                : line.type === 'remove'
                  ? 'bg-neon-red/5 text-neon-red'
                  : 'text-zinc-500'
            }
          >
            <span className="inline-block w-4 text-right mr-2 select-none opacity-50">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>
            {line.text}
          </div>
        ))}
        {truncated && (
          <div className="text-zinc-600 mt-1">... {lines.length - 200} more lines</div>
        )}
      </pre>
    </div>
  );
}
