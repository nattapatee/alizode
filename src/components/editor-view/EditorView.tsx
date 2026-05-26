import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EditorView as CMView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { indentWithTab, undo, redo } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";
import { IdeIntro } from "./IdeIntro";
import { IdeEmpty } from "./IdeEmpty";

interface DirEntry {
  path: string;
  name: string;
  is_dir: boolean;
}

interface Props {
  rootPath: string;
  onSelectFolder?: (path: string) => void;
}

function FileTree({
  rootPath,
  selectedPath,
  onSelect,
}: {
  rootPath: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([rootPath]));
  const [children, setChildren] = useState<Map<string, DirEntry[]>>(new Map());

  const loadDir = useCallback(async (dir: string) => {
    if (children.has(dir)) return;
    try {
      const entries = await invoke<DirEntry[]>("list_directory", { path: dir });
      setChildren((prev) => new Map(prev).set(dir, entries));
    } catch {
      setChildren((prev) => new Map(prev).set(dir, []));
    }
  }, [children]);

  useEffect(() => {
    loadDir(rootPath);
  }, [rootPath, loadDir]);

  const toggleDir = useCallback(
    async (dir: string) => {
      const next = new Set(expanded);
      if (next.has(dir)) {
        next.delete(dir);
      } else {
        next.add(dir);
        await loadDir(dir);
      }
      setExpanded(next);
    },
    [expanded, loadDir],
  );

  const renderEntries = (dirPath: string, depth: number): React.ReactNode[] => {
    const entries = children.get(dirPath);
    if (!entries) return [];

    return entries.map((entry) => {
      const isExpanded = expanded.has(entry.path);
      const isSelected = entry.path === selectedPath;
      const indent = depth * 14;

      if (entry.is_dir) {
        return (
          <div key={entry.path}>
            <button
              onClick={() => toggleDir(entry.path)}
              className="flex items-center gap-1 w-full text-left py-0.5 pr-2 text-[11px] font-mono
                         text-zinc-400 hover:text-zinc-200 hover:bg-surface-1/50 transition-colors"
              style={{ paddingLeft: `${indent + 8}px` }}
            >
              <span className="text-[9px] w-3 shrink-0">{isExpanded ? "▾" : "▸"}</span>
              <span className="truncate">{entry.name}</span>
            </button>
            {isExpanded && renderEntries(entry.path, depth + 1)}
          </div>
        );
      }

      return (
        <button
          key={entry.path}
          onClick={() => onSelect(entry.path)}
          className={`flex items-center gap-1 w-full text-left py-0.5 pr-2 text-[11px] font-mono
                     transition-colors ${
                       isSelected
                         ? "text-neon-cyan bg-neon-cyan/5 border-r-2 border-neon-cyan"
                         : "text-zinc-400 hover:text-zinc-200 hover:bg-surface-1/50"
                     }`}
          style={{ paddingLeft: `${indent + 8 + 14}px` }}
        >
          <span className="text-zinc-600 text-[9px] w-4 shrink-0 text-center">{fileIcon(entry.name)}</span>
          <span className="truncate">{entry.name}</span>
        </button>
      );
    });
  };

  return (
    <div className="flex-1 overflow-y-auto py-1 select-none">
      {renderEntries(rootPath, 0)}
    </div>
  );
}

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "TS";
    case "js":
    case "jsx":
      return "JS";
    case "rs":
      return "RS";
    case "json":
      return "{}";
    case "css":
      return "CS";
    case "html":
      return "<>";
    case "md":
    case "mdx":
      return "MD";
    case "toml":
    case "yaml":
    case "yml":
      return "CF";
    case "sql":
      return "SQ";
    case "sh":
    case "fish":
      return "SH";
    default:
      return "··";
  }
}

function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    rs: "rust", json: "json", css: "css", html: "html", md: "markdown",
    toml: "toml", yaml: "yaml", yml: "yaml", sql: "sql", sh: "bash",
    py: "python", go: "go",
  };
  return map[ext] ?? "plaintext";
}

function langExtension(path: string): Extension[] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts": case "tsx": return [javascript({ typescript: true, jsx: ext === "tsx" })];
    case "js": case "jsx": return [javascript({ jsx: ext === "jsx" })];
    case "html": return [html()];
    case "css": return [css()];
    case "json": return [json()];
    case "md": case "mdx": return [markdown()];
    case "py": return [python()];
    case "rs": return [rust()];
    case "sql": return [sql()];
    default: return [];
  }
}

export function EditorView({ rootPath, onSelectFolder }: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<CMView | null>(null);
  const savedRef = useRef("");

  const lang = selectedPath ? langFromPath(selectedPath) : "";

  useEffect(() => {
    if (!selectedPath) {
      savedRef.current = "";
      setIsDirty(false);
      setLineCount(0);
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      return;
    }
    setLoading(true);
    invoke<string>("read_text_file", { path: selectedPath })
      .then((text) => {
        savedRef.current = text;
        setIsDirty(false);
        setLineCount(text.split("\n").length);

        if (viewRef.current) {
          viewRef.current.destroy();
          viewRef.current = null;
        }
        if (!editorRef.current) return;

        const state = EditorState.create({
          doc: text,
          extensions: [
            basicSetup,
            oneDark,
            keymap.of([indentWithTab]),
            ...langExtension(selectedPath),
            CMView.updateListener.of((update) => {
              if (update.docChanged) {
                const doc = update.state.doc.toString();
                setIsDirty(doc !== savedRef.current);
                setLineCount(update.state.doc.lines);
              }
            }),
            EditorState.tabSize.of(2),
            CMView.theme({
              "&": { height: "100%", fontSize: "12px" },
              ".cm-scroller": { overflow: "auto", fontFamily: "var(--mono, monospace)" },
              ".cm-gutters": { background: "transparent", borderRight: "1px solid var(--border, #1a1a2e)" },
            }),
          ],
        });
        viewRef.current = new CMView({ state, parent: editorRef.current });
      })
      .catch(() => {
        savedRef.current = "";
        savedRef.current = "";
        setIsDirty(false);
      })
      .finally(() => setLoading(false));

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [selectedPath]);

  const handleSave = useCallback(async () => {
    const view = viewRef.current;
    if (!selectedPath || !view) return;
    const content = view.state.doc.toString();
    if (content === savedRef.current) return;
    setSaving(true);
    try {
      await invoke("write_text_file", { path: selectedPath, content });
      savedRef.current = content;
      setIsDirty(false);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  }, [selectedPath]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const handleUndo = useCallback(() => {
    if (viewRef.current) undo(viewRef.current);
  }, []);

  const handleRedo = useCallback(() => {
    if (viewRef.current) redo(viewRef.current);
  }, []);

  if (!rootPath && onSelectFolder) {
    return <IdeEmpty onFolderSelected={onSelectFolder} />;
  }

  const projectName = rootPath.split("/").pop() ?? "project";

  return (
    <div className="flex h-full" style={{ position: "relative" }}>
      {showIntro && (
        <IdeIntro
          name={projectName}
          onDone={() => setShowIntro(false)}
        />
      )}
      {/* File tree sidebar */}
      <div className="w-56 shrink-0 border-r border-surface-2 bg-surface-0 flex flex-col">
        <div className="px-2 py-1.5 border-b border-surface-2 bg-surface-1/30">
          <div className="text-[10px] font-mono text-zinc-500 truncate">
            {rootPath.split("/").pop()}
          </div>
        </div>
        <FileTree rootPath={rootPath} selectedPath={selectedPath} onSelect={setSelectedPath} />
      </div>

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0 bg-surface-0">
        {/* Tab bar */}
        {selectedPath && (
          <div className="flex items-center justify-between px-3 py-1 border-b border-surface-2 bg-surface-1/30">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-mono text-zinc-600 uppercase">{lang}</span>
              <span className="text-[11px] font-mono text-zinc-400 truncate">
                {selectedPath.replace(rootPath + "/", "")}
              </span>
              {isDirty && <span className="text-neon-green text-[10px]">●</span>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={handleUndo} className="text-[10px] font-mono px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-surface-1/50 transition-colors" title="Undo (⌘Z)">↩</button>
              <button onClick={handleRedo} className="text-[10px] font-mono px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-surface-1/50 transition-colors" title="Redo (⌘⇧Z)">↪</button>
              {saving && <span className="text-[10px] text-zinc-500 font-mono">Saving...</span>}
              <button
                onClick={handleSave}
                disabled={!isDirty || saving}
                className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors
                  ${isDirty
                    ? "bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 border border-neon-cyan/30"
                    : "text-zinc-600 border border-surface-3"
                  }`}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <span className="text-[10px] text-zinc-700 font-mono">
                {lineCount}L
              </span>
            </div>
          </div>
        )}

        {/* Code editor */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          <div ref={editorRef} className="absolute inset-0" />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-0 z-10">
              <span className="text-xs text-zinc-600 font-mono">Loading...</span>
            </div>
          )}
          {!loading && !selectedPath && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-0 z-10">
              <div className="text-center">
                <div className="text-zinc-600 text-sm font-mono mb-1">Alizode Editor</div>
                <div className="text-zinc-700 text-[11px] font-mono">Select a file from the tree</div>
                <div className="text-zinc-800 text-[10px] font-mono mt-3">⌘S save · ⌘Z undo · ⌘⇧Z redo</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
