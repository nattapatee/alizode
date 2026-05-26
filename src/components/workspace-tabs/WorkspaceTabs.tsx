import { useState, useRef, useEffect, useCallback } from "react";
import type { Workspace } from "../../lib/acp-events";

type WsKind = "workspace" | "library" | "ide";

interface Props {
  workspaces: Workspace[];
  activeId: string | null;
  libraryIds: Set<string>;
  editorIds: Set<string>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
  onRename: (workspaceId: string, name: string) => void;
  onSelectFolder: (workspaceId: string) => void;
}

function wsKind(id: string, libIds: Set<string>, edIds: Set<string>): WsKind {
  if (libIds.has(id)) return "library";
  if (edIds.has(id)) return "ide";
  return "workspace";
}

function wsIcon(kind: WsKind): string {
  switch (kind) {
    case "library": return "📖";
    case "ide": return "⟨⟩";
    default: return ">_";
  }
}

function shortenPath(p: string): string {
  const home = "/Users/";
  if (p.startsWith(home)) {
    const rest = p.slice(home.length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx >= 0) return "~" + rest.slice(slashIdx);
    return "~";
  }
  return p;
}

export function WorkspaceTabs({ workspaces, activeId, libraryIds, editorIds, onSelect, onCreate, onClose, onRename, onSelectFolder }: Props) {
  const activeWs = workspaces.find((w) => w.id === activeId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const commitRename = useCallback(() => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  }, [editingId, editValue, onRename]);

  return (
    <>
      <div className="term-tabs">
        {workspaces.map((ws, i) => (
          <button
            key={ws.id}
            className={"tab" + (ws.id === activeId ? " on" : "")}
            onClick={() => onSelect(ws.id)}
          >
            {editingId === ws.id ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "var(--bg-2)",
                  color: "var(--accent)",
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                  padding: "0 4px",
                  width: 120,
                  font: "inherit",
                  outline: "none",
                }}
              />
            ) : (
              <>
                <span className="tab-idx">[{String(i + 1).padStart(2, "0")}]</span>
                <span className="tab-kind">{wsIcon(wsKind(ws.id, libraryIds, editorIds))}</span>
                <span
                  style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(ws.id);
                    setEditValue(ws.name);
                  }}
                >
                  {ws.name}
                </span>
              </>
            )}
            {workspaces.length > 1 && (
              <span
                className="tab-x"
                onClick={(e) => { e.stopPropagation(); onClose(ws.id); }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button className="tab tab-add" onClick={onCreate} title="New workspace">
          +
        </button>
        <div className="term-tabs-spacer" />
      </div>

      {activeWs && (
        <div
          className="term-path"
          onClick={() => onSelectFolder(activeWs.id)}
          style={{ cursor: "pointer" }}
        >
          <span className="folder-ico">▤</span>
          {shortenPath(activeWs.cwd)}
        </div>
      )}
    </>
  );
}
