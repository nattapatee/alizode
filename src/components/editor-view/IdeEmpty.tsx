import { open } from "@tauri-apps/plugin-dialog";
import { CHAR_BY_ID } from "../../lib/characters";

interface Props {
  onFolderSelected: (path: string) => void;
}

function ForgeDock({ line }: { line: string }) {
  const forge = CHAR_BY_ID["forge"];
  return (
    <div className="forge-dock empty">
      <div className="forge-bubble">
        <span className="forge-name">FORGE</span>
        <span className="forge-line">{line}</span>
      </div>
      <div className="forge-chibi-wrap">
        {forge?.chibi ? (
          <img className="forge-chibi" src={forge.chibi} alt="forge" />
        ) : (
          <div className="forge-chibi" />
        )}
        <span className="forge-shadow" />
      </div>
    </div>
  );
}

export function IdeEmpty({ onFolderSelected }: Props) {
  const handlePick = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) onFolderSelected(selected);
  };

  return (
    <div className="ide-empty">
      <div className="ide-empty-bg" />
      <div className="ide-empty-vignette" />
      <div className="scanlines subtle" />

      <div className="ide-empty-banner">
        <span className="ieb-bracket l" />
        <span className="ieb-title">SYSTEMS · PANOPTICON</span>
        <span className="ieb-bracket r" />
      </div>

      <div className="ide-empty-card">
        <div className="ide-empty-tag">// ide · forge online</div>
        <div className="ide-empty-title">mount a project</div>
        <ForgeDock line="open a source folder and i'll index it, type-check it, and stand by for patches." />
        <div className="ide-empty-msg">
          select a directory and we'll load every <code>.js</code>,{" "}
          <code>.ts</code>, <code>.tsx</code>, <code>.md</code>,{" "}
          <code>.json</code> file into the editor. nothing is uploaded —
          everything stays local.
        </div>
        <button className="btn btn-primary" onClick={handlePick}>
          select project folder
        </button>
        <div className="ide-empty-hint">
          tip: <b>forge</b> sits in the chat panel. type a question, paste a
          stacktrace, or say <b>review</b> to get a critique of the active file.
        </div>
        <div className="ide-empty-marks">
          <span className="bracket tl" />
          <span className="bracket tr" />
          <span className="bracket bl" />
          <span className="bracket br" />
        </div>
      </div>
    </div>
  );
}
