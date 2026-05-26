import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import { LibraryIntro } from "./LibraryIntro";
import { LibraryEmpty } from "./LibraryEmpty";

interface MarkdownEntry {
  path: string;
  name: string;
  folder: string;
}

interface Props {
  rootPath: string;
  onSelectFolder?: (path: string) => void;
}

marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  }),
);
marked.use({ gfm: true, breaks: true });

function groupByFolder(entries: MarkdownEntry[]): Map<string, MarkdownEntry[]> {
  const groups = new Map<string, MarkdownEntry[]>();
  for (const entry of entries) {
    const key = entry.folder || "(root)";
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return groups;
}

export function LibraryView({ rootPath, onSelectFolder }: Props) {
  const [entries, setEntries] = useState<MarkdownEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    invoke<MarkdownEntry[]>("scan_markdown_files", { root: rootPath })
      .then((files) => {
        setEntries(files);
        if (files.length > 0 && !selectedPath) {
          const readme = files.find(
            (f) => f.name.toLowerCase() === "readme.md",
          );
          setSelectedPath(readme?.path ?? files[0].path);
        }
      })
      .catch(() => {});
  }, [rootPath, selectedPath]);

  useEffect(() => {
    if (!selectedPath) {
      setContent("");
      return;
    }
    setLoading(true);
    const fullPath = `${rootPath}/${selectedPath}`;
    invoke<string>("read_text_file", { path: fullPath })
      .then(setContent)
      .catch(() => setContent("*Failed to read file*"))
      .finally(() => setLoading(false));
  }, [selectedPath, rootPath]);

  const toggleFolder = useCallback((folder: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }, []);

  const filteredEntries = useMemo(() => {
    if (!searchQuery) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q),
    );
  }, [entries, searchQuery]);

  const grouped = useMemo(
    () => groupByFolder(filteredEntries),
    [filteredEntries],
  );

  const rendered = useMemo(() => {
    if (!content) return "";
    return marked.parse(content) as string;
  }, [content]);

  if (!rootPath && onSelectFolder) {
    return <LibraryEmpty onFolderSelected={onSelectFolder} />;
  }

  const folderName = rootPath.split("/").pop() ?? "library";

  const activeEntry = entries.find((e) => e.path === selectedPath);
  const sageLine = searchQuery
    ? `filtering for "${searchQuery}" · ${filteredEntries.length} match`
    : activeEntry
      ? `reading: ${activeEntry.name}`
      : `${entries.length} documents indexed.`;

  return (
    <div className="lib-body" style={{ position: "relative" }}>
      {showIntro && (
        <LibraryIntro
          name={folderName}
          onDone={() => setShowIntro(false)}
        />
      )}

      <aside className="lib-side">
        <div className="lib-filter">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter files..."
          />
        </div>
        <div className="lib-meta">
          <span>{entries.length} files</span>
        </div>
        <div className="lib-list lib-shelves">
          {[...grouped.entries()].map(([folder, files]) => {
            const isOpen = !collapsedFolders.has(folder);
            return (
              <div key={folder} className="lib-shelf">
                <button
                  className="lib-shelf-label"
                  onClick={() => toggleFolder(folder)}
                >
                  <span className="lib-arrow">{isOpen ? "▾" : "▸"}</span>
                  <span className="lib-shelf-name">{folder}</span>
                  <span className="lib-shelf-count">{files.length}</span>
                </button>
                {isOpen && (
                  <div className="lib-shelf-row">
                    {files.map((file) => {
                      let h = 0;
                      for (let i = 0; i < file.name.length; i++)
                        h = (h * 31 + file.name.charCodeAt(i)) >>> 0;
                      const height = 78 + (h % 28);
                      const variant = h % 4;
                      const titleStub = file.name.replace(/\.md$/i, "");
                      return (
                        <button
                          key={file.path}
                          className={
                            "lib-book-spine variant-" + variant +
                            (file.path === selectedPath ? " on" : "")
                          }
                          style={{ height: height + "px" }}
                          onClick={() => setSelectedPath(file.path)}
                          title={file.name}
                        >
                          <span className="bs-band top" />
                          <span className="bs-title">{titleStub}</span>
                          <span className="bs-band bot" />
                          <span className="bs-foot">.md</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="lib-shelf-base">
                  <span className="lsb-glow" />
                </div>
              </div>
            );
          })}
          {filteredEntries.length === 0 && searchQuery && (
            <div className="lib-no-match">no files match "{searchQuery}"</div>
          )}
        </div>
      </aside>

      <main className="lib-preview">
        {activeEntry ? (
          <>
            <div className="lib-preview-head">
              <span className="lib-bread-ico">▤</span>
              <span className="lib-bread">{activeEntry.path}</span>
              <span className="bullet">·</span>
              <span className="lib-bread-size">
                {(content.length / 1024).toFixed(1)} kb
              </span>
            </div>
            {loading ? (
              <div className="lib-md" style={{ padding: 22 }}>loading...</div>
            ) : (
              <div
                className="lib-md"
                dangerouslySetInnerHTML={{ __html: rendered }}
              />
            )}
          </>
        ) : (
          <div className="lib-no-match" style={{ padding: "40px 20px" }}>
            select a file from the shelf to preview.
          </div>
        )}
      </main>

      <div className="sage-dock loaded">
        <div className="sage-bubble">
          <span className="sage-name">SAGE</span>
          <span className="sage-line">{sageLine}</span>
          <span className="sage-meta">{entries.length} docs · sage-archive-1</span>
        </div>
        <div className="sage-chibi-wrap">
          <div className="sage-chibi" />
          <div className="sage-torch" />
          <div className="sage-shadow" />
        </div>
      </div>
    </div>
  );
}
