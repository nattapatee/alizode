import { useState, useEffect, useRef } from "react";

interface Props {
  name: string;
  onDone: () => void;
}

export function IdeIntro({ name, onDone }: Props) {
  const [phase, setPhase] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1300),
      setTimeout(() => setPhase(3), 2400),
      setTimeout(() => setPhase(4), 2800),
      setTimeout(() => onDoneRef.current(), 3100),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <div className={"ide-intro ide-intro-p" + phase} onClick={onDone}>
      <div className="ii-camera">
        <div className="ii-bg" />
        <div className="ii-vignette" />
        <div className="scanlines subtle" />
        <div className="ii-reticle">
          <span className="ret-corner tl" />
          <span className="ret-corner tr" />
          <span className="ret-corner bl" />
          <span className="ret-corner br" />
        </div>
        <div className="ii-screen">
          <div className="ii-screen-bar">
            <span className="ii-dot r" />
            <span className="ii-dot y" />
            <span className="ii-dot g" />
            <span className="ii-screen-title">forge://{name}</span>
          </div>
          <div className="ii-screen-body">
            <div className="ii-code-line">
              <span className="ii-kw">import</span>{" "}
              <span className="ii-id">forge</span>{" "}
              <span className="ii-kw">from</span>{" "}
              <span className="ii-str">"runtime/v2"</span>
              <span className="ii-pun">;</span>
            </div>
            <div className="ii-code-line">
              <span className="ii-kw">const</span>{" "}
              <span className="ii-id">project</span>{" "}
              <span className="ii-op">=</span>{" "}
              <span className="ii-fn">mount</span>
              <span className="ii-pun">(</span>
              <span className="ii-str">"./{name}"</span>
              <span className="ii-pun">);</span>
            </div>
            <div className="ii-code-line">
              <span className="ii-com">// linker armed · sandbox warm</span>
            </div>
            <div className="ii-code-line">
              <span className="ii-fn">await</span>{" "}
              <span className="ii-id">project</span>
              <span className="ii-pun">.</span>
              <span className="ii-fn">ready</span>
              <span className="ii-pun">();</span>
              <span className="ii-cursor" />
            </div>
          </div>
        </div>
      </div>

      <div className="ii-hud">
        <div className="ii-hud-top">
          <span className="hud-tag">
            <span className="hud-blink" /> COMPILING WORKSPACE
          </span>
          <span className="hud-sep" />
          <span className="hud-tag dim">panopticon · forge-runtime-2</span>
          <span className="hud-spacer" />
          <span className="hud-tag dim">→ {name}</span>
        </div>
        <div className="hud-status">
          {phase === 0 && "› spinning sandbox"}
          {phase === 1 && "› linking modules · lock acquired"}
          {phase === 2 && "› projecting editor surface"}
          {phase >= 3 && "› ready · forge awaits"}
        </div>
        <div className="hud-skip">click anywhere to skip ›</div>
      </div>

      <div className="ii-flash" />
    </div>
  );
}
