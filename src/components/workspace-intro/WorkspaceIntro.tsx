import { useState, useEffect, useRef } from "react";

interface Props {
  workspaceName: string;
  charName: string;
  accent: string;
  onDone: () => void;
}

export function WorkspaceIntro({ workspaceName, charName, accent, onDone }: Props) {
  const [phase, setPhase] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 550),
      setTimeout(() => setPhase(2), 1300),
      setTimeout(() => setPhase(3), 2600),
      setTimeout(() => setPhase(4), 2950),
      setTimeout(() => onDoneRef.current(), 3250),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const previewLines = [
    "$ ssh hub-7@orbital",
    "key fingerprint accepted",
    "loading workspace: " + workspaceName,
    "agent: " + charName.toLowerCase(),
    "lanes: 1 / 16",
    "↳ entering...",
  ];

  return (
    <div
      className={"intro intro-p" + phase}
      onClick={onDone}
      style={{ "--accent": accent } as React.CSSProperties}
    >
      <div className="intro-camera">
        <div className="intro-bg" />
        <div className="intro-vignette" />
        <div className="scanlines subtle" />

        <div className="intro-reticle">
          <span className="ret-corner tl" />
          <span className="ret-corner tr" />
          <span className="ret-corner bl" />
          <span className="ret-corner br" />
          <span className="ret-cross v" />
          <span className="ret-cross h" />
        </div>

        <div className="intro-monitor">
          <span className="im-bracket tl" />
          <span className="im-bracket tr" />
          <span className="im-bracket bl" />
          <span className="im-bracket br" />
          <div className="im-screen">
            <div className="im-screen-head">
              <span className="im-dot" /> DATA_CORE_HUB-7
              <span className="im-dot-r"> · {charName}</span>
            </div>
            <div className="im-screen-body">
              {previewLines.map((line, i) => (
                <div
                  className="im-line"
                  key={i}
                  style={{ animationDelay: 600 + i * 180 + "ms" }}
                >
                  <span className="im-prompt">›</span> {line}
                </div>
              ))}
              <div className="im-cursor-row">
                <span className="im-prompt">›</span>
                <span className="im-cursor" />
              </div>
            </div>
            <div className="im-screen-glow" />
          </div>
          <div className="im-stand" />
          <div className="im-base" />
        </div>
      </div>

      <div className="intro-hud">
        <div className="hud-top">
          <span className="hud-tag">
            <span className="hud-blink" /> ESTABLISHING LINK
          </span>
          <span className="hud-sep" />
          <span className="hud-tag dim">orbital_platform · alizode/0.4.1</span>
          <span className="hud-spacer" />
          <span className="hud-tag dim">tab: {workspaceName}</span>
        </div>
        <div className="hud-status">
          {phase === 0 && "› awaiting handshake"}
          {phase === 1 && "› targeting console — lock acquired"}
          {phase === 2 && "› descending to terminal..."}
          {phase >= 3 && "› link established"}
        </div>
        <div className="hud-skip">click anywhere to skip ›</div>
      </div>

      <div className="intro-flash" />
    </div>
  );
}
