import { useEffect, useState, useCallback, useMemo } from "react";
import { diffLines } from "diff";
import type { AcpClient } from "../../lib/acp-client";
import type { AcpEvent, PermissionOption, ToolCall } from "../../lib/acp-types";
import { openFullDiff } from "../full-diff-modal/FullDiffModal";

interface DiffInfo {
  path: string;
  oldText: string;
  newText: string;
}

function extractDiffInfo(call: ToolCall): DiffInfo | null {
  const diffContent = call.content?.find((c) => c.type === "diff");
  if (diffContent?.path && (diffContent.oldText != null || diffContent.newText)) {
    return { path: diffContent.path, oldText: diffContent.oldText ?? "", newText: diffContent.newText ?? "" };
  }
  const raw = call.rawInput as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== "object") return null;
  const filePath = (raw.file_path ?? raw.path ?? raw.filePath) as string | undefined;
  if (!filePath) return null;
  if (typeof raw.content === "string") return { path: filePath, oldText: "", newText: raw.content };
  if (typeof raw.old_string === "string" && typeof raw.new_string === "string")
    return { path: filePath, oldText: raw.old_string, newText: raw.new_string };
  return null;
}

const CONTEXT_LINES = 2;
const LINE_CAP = 24;

type DiffRow = { kind: "add" | "del" | "ctx"; text: string; oldNum: number | null; newNum: number | null };
type DisplayRow = DiffRow | { kind: "gap" };

function computeDisplayRows(oldText: string, newText: string): { rows: DisplayRow[]; moreCount: number } {
  const parts = diffLines(oldText, newText);
  const allRows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const p of parts) {
    const raw = p.value.endsWith("\n") ? p.value.slice(0, -1) : p.value;
    const lines = raw.split("\n");
    const kind: DiffRow["kind"] = p.added ? "add" : p.removed ? "del" : "ctx";
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
  return { rows: display, moreCount: Math.max(0, keptTotal - emitted) };
}

function countChanges(oldText: string, newText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(oldText, newText)) {
    if (part.added) added += part.count ?? 0;
    else if (part.removed) removed += part.count ?? 0;
  }
  return { added, removed };
}

function PermDiffView({ diff }: { diff: DiffInfo }) {
  const { rows, moreCount } = useMemo(() => computeDisplayRows(diff.oldText, diff.newText), [diff.oldText, diff.newText]);
  const { added, removed } = useMemo(() => countChanges(diff.oldText, diff.newText), [diff.oldText, diff.newText]);
  const filename = diff.path.split("/").pop() ?? diff.path;

  if (rows.length === 0) return null;

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
          onClick={() => openFullDiff(diff.path, diff.oldText, diff.newText)}
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

interface PendingPermission {
  requestId: number;
  toolCall: ToolCall;
  options: PermissionOption[];
}

interface Props {
  client: AcpClient | null;
}

export function PermissionModal({ client }: Props) {
  const [queue, setQueue] = useState<PendingPermission[]>([]);
  const pending = queue[0] ?? null;

  useEffect(() => {
    if (!client) return;
    const unsub = client.onEvent((e: AcpEvent) => {
      if (e.type === 'permission_request') {
        setQueue((q) => [
          ...q,
          {
            requestId: e.requestId,
            toolCall: e.toolCall,
            options: e.options,
          },
        ]);
      }
    });
    return () => { unsub(); setQueue([]); };
  }, [client]);

  const handleOption = useCallback(
    async (optionId: string) => {
      if (!client || !pending) return;
      try {
        await client.respondPermission(pending.requestId, optionId);
      } catch {
        return;
      }
      setQueue((q) => q.slice(1));
    },
    [client, pending],
  );

  const handleDismiss = useCallback(async () => {
    if (!client || !pending) return;
    try {
      await client.respondPermission(pending.requestId, null);
    } catch {
      return;
    }
    setQueue((q) => q.slice(1));
  }, [client, pending]);

  useEffect(() => {
    if (!pending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const allow = pending.options.find((o) => o.kind.startsWith("allow") && !o.kind.includes("always"));
        const fallback = pending.options.find((o) => o.kind.startsWith("allow"));
        if (allow || fallback) handleOption((allow ?? fallback)!.optionId);
        else handleOption("allow");
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pending, handleOption, handleDismiss]);

  const diffInfo = useMemo(
    () => pending ? extractDiffInfo(pending.toolCall) : null,
    [pending],
  );

  if (!pending) return null;

  const toolName = pending.toolCall.title ?? pending.toolCall.toolCallId ?? 'unknown tool';

  const allowOpts = pending.options.filter((o) => o.kind.startsWith("allow"));
  const denyOpts = pending.options.filter((o) => !o.kind.startsWith("allow"));
  const alwaysOpt = allowOpts.find((o) => o.kind === "allow_always" || o.name.toLowerCase().includes("always"));
  const allowOnce = allowOpts.find((o) => o !== alwaysOpt) ?? allowOpts[0];

  return (
    <div className="perm-overlay">
      <div className="perm-modal">
        <div className="perm-badge">
          <span className="perm-dot" />
          <span className="perm-label">Permission Request</span>
          {queue.length > 1 && (
            <span className="perm-queue-count">{queue.length} queued</span>
          )}
        </div>

        <p className="perm-desc">Agent wants to run</p>
        <div className="perm-tool">{toolName}</div>

        {diffInfo && <PermDiffView diff={diffInfo} />}

        <div className="perm-actions">
          {pending.options.length > 0 ? (
            <>
              <div className="perm-main-actions">
                {allowOnce && (
                  <button className="perm-btn perm-allow" onClick={() => handleOption(allowOnce.optionId)}>
                    Allow
                  </button>
                )}
                {denyOpts.length > 0 ? (
                  denyOpts.map((o) => (
                    <button key={o.optionId} className="perm-btn perm-deny" onClick={() => handleOption(o.optionId)}>
                      Reject
                    </button>
                  ))
                ) : (
                  <button className="perm-btn perm-deny" onClick={handleDismiss}>
                    Reject
                  </button>
                )}
              </div>
              {alwaysOpt && alwaysOpt !== allowOnce && (
                <button className="perm-always" onClick={() => handleOption(alwaysOpt.optionId)}>
                  Always allow this tool
                </button>
              )}
            </>
          ) : (
            <div className="perm-main-actions">
              <button className="perm-btn perm-allow" onClick={() => handleOption("allow")}>
                Allow
              </button>
              <button className="perm-btn perm-deny" onClick={handleDismiss}>
                Reject
              </button>
            </div>
          )}
        </div>

        <div className="perm-hint">
          <kbd>↵</kbd> allow · <kbd>esc</kbd> reject
        </div>
      </div>
    </div>
  );
}
