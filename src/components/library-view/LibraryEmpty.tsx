import { open } from "@tauri-apps/plugin-dialog";

interface Props {
  onFolderSelected: (path: string) => void;
}

function SageDock({ line }: { line: string }) {
  return (
    <div className="sage-dock empty">
      <div className="sage-bubble">
        <span className="sage-name">SAGE</span>
        <span className="sage-line">{line}</span>
      </div>
      <div className="sage-chibi-wrap">
        <div className="sage-chibi" />
        <div className="sage-torch" />
        <div className="sage-shadow" />
      </div>
    </div>
  );
}

export function LibraryEmpty({ onFolderSelected }: Props) {
  const handlePick = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) onFolderSelected(selected);
  };

  return (
    <div className="lib-empty">
      <div className="lib-empty-bg" />
      <div className="lib-empty-vignette" />
      <div className="scanlines subtle" />

      <div className="lib-empty-banner">
        <span className="leb-bracket l" />
        <span className="leb-title">ELVEN DATA-VAULT</span>
        <span className="leb-bracket r" />
      </div>

      <div className="lib-empty-card">
        <div className="lib-empty-tag">// library · sage on duty</div>
        <div className="lib-empty-title">mount a folder</div>
        <SageDock line="drop me a folder — i'll catalogue every page and quote you back chapter and verse." />
        <div className="lib-empty-msg">
          select a directory and we'll index every <code>.md</code> file,
          group them onto shelves, and let you riffle through the pages.
          all files stay local — nothing leaves your machine.
        </div>
        <button className="btn btn-primary" onClick={handlePick}>
          select folder
        </button>
        <div className="lib-empty-hint">
          tip: it's just a markdown reader for now. <b>sage</b> is the resident
          librarian — she lives here.
        </div>
        <div className="lib-empty-marks">
          <span className="bracket tl" />
          <span className="bracket tr" />
          <span className="bracket bl" />
          <span className="bracket br" />
        </div>
      </div>
    </div>
  );
}
