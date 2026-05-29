import { useEffect, useState, useCallback, useMemo } from "react";
import { diffLines } from "diff";
import type { AcpClient } from "../../lib/acp-client";
import type { AcpEvent } from "../../lib/acp-types";
import { openFullDiff } from "../full-diff-modal/FullDiffModal";

interface PendingWrite {
  requestId: number;
  path: string;
  oldText: string;
  newText: string;
}

interface Props {
  client: AcpClient | null;
}

const CONTEXT_LINES = 2;
const LINE_CAP = 24;

type DiffRow = { kind: "add" | "del" | "ctx"; text: string; oldNum: number | null; newNum: number | null };
type DisplayRow = DiffRow | { kind: "gap" };

function computeDisplayRows(oldText: string, newText: string): { rows: DisplayRow[]; moreCount: number; added: number; removed: number } {
  const parts = diffLines(oldText, newText);
  const allRows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  let added = 0;
  let removed = 0;

  for (const p of parts) {
    const raw = p.value.endsWith("\n") ? p.value.slice(0, -1) : p.value;
    const lines = raw.split("\n");
    const kind: DiffRow["kind"] = p.added ? "add" : p.removed ? "del" : "ctx";
    if (p.added) added += p.count ?? lines.length;
    if (p.removed) removed += p.count ?? lines.length;
    for (const text of lines) {
      if (kind === "add") {
        allRows.push({ kind, text, oldNum: null, newNum: newLine++ });
      } else if (kind === "del") {
        allRows.push({ kind, text, oldNum: oldLine++, newNum: null });
      } else {
        allRows.push({ kind, text, oldNum: oldLine++, newNum: newLine++ });
      }
    }
  }

  const keep = new Array<boolean>(allRows.length).fill(false);
  for (let i = 0; i < allRows.length; i++) {
    if (allRows[i].kind !== "ctx") {
      for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(allRows.length - 1, i + CONTEXT_LINES); j++) {
        keep[j] = true;
      }
    }
  }

  const display: DisplayRow[] = [];
  let emitted = 0;
  let inGap = false;
  let firstHunk = true;
  for (let i = 0; i < allRows.length; i++) {
    if (!keep[i]) { inGap = true; continue; }
    if (inGap && !firstHunk) display.push({ kind: "gap" });
    inGap = false;
    firstHunk = false;
    if (emitted >= LINE_CAP) break;
    display.push(allRows[i]);
    emitted++;
  }

  let keptTotal = 0;
  for (let i = 0; i < keep.length; i++) if (keep[i]) keptTotal++;
  return { rows: display, moreCount: Math.max(0, keptTotal - emitted), added, removed };
}

function FsWriteDiffView({ pending }: { pending: PendingWrite }) {
  const { rows, moreCount, added, removed } = useMemo(
    () => computeDisplayRows(pending.oldText, pending.newText),
    [pending.oldText, pending.newText],
  );
  const filename = pending.path.split("/").pop() ?? pending.path;

  return (
    <div className="perm-diff">
      <div className="perm-diff-header">
        {filename}
        <span className="perm-diff-stats">
          {added > 0 && <span className="perm-diff-stat-add">+{added}</span>}
          {removed > 0 && <span className="perm-diff-stat-del">−{removed}</span>}
        </span>
        <button
          className="perm-diff-expand"
          onClick={() => openFullDiff(pending.path, pending.oldText, pending.newText)}
        >
          full diff
        </button>
      </div>
      <div className="perm-diff-body">
        {rows.map((row, i) =>
          row.kind === "gap" ? (
            <div key={i} className="perm-diff-line perm-diff-gap">
              <span className="perm-diff-num" />
              <span className="perm-diff-num" />
              <span className="perm-diff-sign">⋯</span>
              <span className="perm-diff-text perm-diff-gap-text">context omitted</span>
            </div>
          ) : (
            <div key={i} className={`perm-diff-line perm-diff-${row.kind}`}>
              <span className="perm-diff-num">{row.oldNum ?? " "}</span>
              <span className="perm-diff-num">{row.newNum ?? " "}</span>
              <span className="perm-diff-sign">{row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}</span>
              <span className="perm-diff-text">{row.text}</span>
            </div>
          ),
        )}
        {moreCount > 0 && (
          <div className="perm-diff-more">… {moreCount} more line{moreCount === 1 ? "" : "s"}</div>
        )}
      </div>
    </div>
  );
}

export function FsWriteModal({ client }: Props) {
  const [queue, setQueue] = useState<PendingWrite[]>([]);
  const pending = queue[0] ?? null;

  useEffect(() => {
    if (!client) return;
    const unsub = client.onEvent((e: AcpEvent) => {
      if (e.type === "fs_write_pending") {
        setQueue((q) => [...q, {
          requestId: e.requestId,
          path: e.path,
          oldText: e.oldText,
          newText: e.newText,
        }]);
      }
    });
    return () => { unsub(); setQueue([]); };
  }, [client]);

  const handleDecision = useCallback(
    async (accept: boolean) => {
      if (!client || !pending) return;
      try {
        await client.respondFsWrite(pending.requestId, accept);
      } catch {
        return;
      }
      setQueue((q) => q.slice(1));
    },
    [client, pending],
  );

  const handleAcceptAll = useCallback(async () => {
    if (!client || queue.length === 0) return;
    for (const item of queue) {
      try {
        await client.respondFsWrite(item.requestId, true);
      } catch { /* continue */ }
    }
    setQueue([]);
  }, [client, queue]);

  const handleRejectAll = useCallback(async () => {
    if (!client || queue.length === 0) return;
    for (const item of queue) {
      try {
        await client.respondFsWrite(item.requestId, false);
      } catch { /* continue */ }
    }
    setQueue([]);
  }, [client, queue]);

  useEffect(() => {
    if (!pending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "a" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        handleDecision(true);
      } else if (e.key === "r" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        handleDecision(false);
      } else if (e.key === "A") {
        e.preventDefault();
        handleAcceptAll();
      } else if (e.key === "R") {
        e.preventDefault();
        handleRejectAll();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleDecision(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleDecision(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pending, handleDecision, handleAcceptAll, handleRejectAll]);

  if (!pending) return null;

  const isNew = pending.oldText.length === 0;

  return (
    <div className="perm-overlay">
      <div className="perm-modal">
        <div className="perm-badge">
          <span className="perm-dot" style={{ background: "var(--yellow)" }} />
          <span className="perm-label">File {isNew ? "Create" : "Write"} Request</span>
          {queue.length > 1 && (
            <span className="perm-queue-count">{queue.length} queued</span>
          )}
        </div>

        <p className="perm-desc">Agent wants to {isNew ? "create" : "modify"}</p>
        <div className="perm-tool" title={pending.path}>{pending.path}</div>

        <FsWriteDiffView pending={pending} />

        <div className="perm-actions">
          <div className="perm-main-actions">
            <button className="perm-btn perm-allow" onClick={() => handleDecision(true)}>
              Accept
            </button>
            <button className="perm-btn perm-deny" onClick={() => handleDecision(false)}>
              Reject
            </button>
          </div>
          {queue.length > 1 && (
            <div className="perm-main-actions" style={{ marginTop: 6 }}>
              <button className="perm-always" onClick={handleAcceptAll}>
                Accept all ({queue.length})
              </button>
              <button className="perm-always" style={{ color: "var(--red)" }} onClick={handleRejectAll}>
                Reject all ({queue.length})
              </button>
            </div>
          )}
        </div>

        <div className="perm-hint">
          <kbd>a</kbd> accept · <kbd>r</kbd> reject · <kbd>A</kbd> accept all · <kbd>R</kbd> reject all
        </div>
      </div>
    </div>
  );
}
