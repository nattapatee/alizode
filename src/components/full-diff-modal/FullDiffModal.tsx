import { useEffect, useState, useCallback, useMemo } from "react";
import { createTwoFilesPatch } from "diff";
import { html } from "diff2html";
import { ColorSchemeType } from "diff2html/lib/types";
import "diff2html/bundles/css/diff2html.min.css";

interface DiffPayload {
  path: string;
  oldText: string;
  newText: string;
}

const OPEN_EVENT = "alizode:open-full-diff";

export function openFullDiff(path: string, oldText: string, newText: string): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_EVENT, { detail: { path, oldText, newText } }),
  );
}

export function FullDiffModal() {
  const [diff, setDiff] = useState<DiffPayload | null>(null);
  const [viewMode, setViewMode] = useState<"side" | "line">("side");

  useEffect(() => {
    const handler = (e: Event) => {
      setDiff((e as CustomEvent<DiffPayload>).detail);
    };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  const close = useCallback(() => setDiff(null), []);

  useEffect(() => {
    if (!diff) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
      if (e.key === "Tab" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setViewMode((m) => (m === "side" ? "line" : "side"));
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [diff, close]);

  const rendered = useMemo(() => {
    if (!diff) return "";
    const filename = diff.path.split("/").pop() ?? diff.path;
    const patch = createTwoFilesPatch(
      filename,
      filename,
      diff.oldText,
      diff.newText,
      "",
      "",
      { context: 4 },
    );
    return html(patch, {
      outputFormat: viewMode === "side" ? "side-by-side" : "line-by-line",
      drawFileList: false,
      matching: "lines",
      colorScheme: ColorSchemeType.DARK,
    });
  }, [diff, viewMode]);

  if (!diff) return null;

  const filename = diff.path.split("/").pop() ?? diff.path;

  return (
    <div className="fdm-overlay" onClick={close}>
      <div className="fdm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fdm-header">
          <span className="fdm-filename" title={diff.path}>{filename}</span>
          <span className="fdm-path">{diff.path}</span>
          <div className="fdm-controls">
            <button
              className={`fdm-mode${viewMode === "side" ? " fdm-mode-active" : ""}`}
              onClick={() => setViewMode("side")}
            >
              side-by-side
            </button>
            <button
              className={`fdm-mode${viewMode === "line" ? " fdm-mode-active" : ""}`}
              onClick={() => setViewMode("line")}
            >
              unified
            </button>
            <button className="fdm-close" onClick={close}>ESC</button>
          </div>
        </div>
        <div
          className="fdm-body"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
        <div className="fdm-hint">
          <kbd>Tab</kbd> toggle view · <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  );
}
