import { useState, useEffect, useRef } from "react";

interface Props {
  name: string;
  onDone: () => void;
}

export function LibraryIntro({ name, onDone }: Props) {
  const [phase, setPhase] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 550),
      setTimeout(() => setPhase(2), 1400),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 2900),
      setTimeout(() => onDoneRef.current(), 3200),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <div
      className={"lib-intro lib-intro-p" + phase}
      onClick={onDone}
    >
      <div className="li-camera">
        <div className="li-bg" />
        <div className="li-vignette" />
        <div className="scanlines subtle" />
        <div className="li-reticle">
          <span className="ret-corner tl" />
          <span className="ret-corner tr" />
          <span className="ret-corner bl" />
          <span className="ret-corner br" />
        </div>
        <div className="li-book">
          <div className="li-book-cover li-book-left">
            <span className="lbl-stripe" />
            <span className="lbl-rune">✦</span>
          </div>
          <div className="li-book-cover li-book-right">
            <span className="lbl-stripe" />
            <span className="lbl-rune">✦</span>
          </div>
          <div className="li-book-spine-c" />
          <div className="li-book-pages">
            <div className="li-page-line w70" />
            <div className="li-page-line w90" />
            <div className="li-page-line w60" />
            <div className="li-page-line w85" />
            <div className="li-page-line w50" />
            <div className="li-page-line w80" />
            <div className="li-page-line w65" />
          </div>
        </div>
      </div>

      <div className="li-hud">
        <div className="li-hud-top">
          <span className="hud-tag">
            <span className="hud-blink" /> INDEXING ARCHIVE
          </span>
          <span className="hud-sep" />
          <span className="hud-tag dim">elven_data-vault · sage-archive-1</span>
          <span className="hud-spacer" />
          <span className="hud-tag dim">→ {name}</span>
        </div>
        <div className="hud-status">
          {phase === 0 && "› cataloguing entries"}
          {phase === 1 && "› opening shelf · aisle ii"}
          {phase === 2 && "› presenting volume — sage standing by"}
          {phase >= 3 && "› archive ready"}
        </div>
        <div className="hud-skip">click anywhere to skip ›</div>
      </div>

      <div className="li-flash" />
    </div>
  );
}
