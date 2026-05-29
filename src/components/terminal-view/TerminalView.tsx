import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

interface Props {
  terminalId: string;
  cwd: string;
}

const THEME = {
  background: "rgba(7, 16, 31, 0.82)",
  foreground: "#d8e7ff",
  cursor: "#5af0c8",
  cursorAccent: "#07101f",
  selectionBackground: "#2b4a8280",
  selectionForeground: "#d8e7ff",
  selectionInactiveBackground: "#2b4a8240",
  black: "#0c1830",
  red: "#ff6b8b",
  green: "#8af26b",
  yellow: "#ffe066",
  blue: "#7df9ff",
  magenta: "#d678ff",
  cyan: "#5af0c8",
  white: "#d8e7ff",
  brightBlack: "#4a6594",
  brightRed: "#ff9daf",
  brightGreen: "#a8f590",
  brightYellow: "#ffe898",
  brightBlue: "#a5fbff",
  brightMagenta: "#e4a0ff",
  brightCyan: "#9efce0",
  brightWhite: "#ffffff",
};

export function TerminalView({ terminalId, cwd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      theme: THEME,
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 5000,
      allowTransparency: true,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;

    requestAnimationFrame(() => {
      fit.fit();
      invoke("terminal_resize", {
        id: terminalId,
        cols: term.cols,
        rows: term.rows,
      }).catch(() => {});
    });

    const unlistenPromise = listen<string>(
      `terminal-output-${terminalId}`,
      (e) => {
        term.write(e.payload);
      },
    );

    const inputDisposable = term.onData((data) => {
      invoke("terminal_write", { id: terminalId, data }).catch(() => {});
    });

    invoke("terminal_spawn", { id: terminalId, cwd }).catch((err) => {
      term.write(`\x1b[31mFailed to spawn terminal: ${err}\x1b[0m\r\n`);
    });

    const observer = new ResizeObserver(() => {
      fit.fit();
      invoke("terminal_resize", {
        id: terminalId,
        cols: term.cols,
        rows: term.rows,
      }).catch(() => {});
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      unlistenPromise.then((fn) => fn());
      inputDisposable.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [terminalId, cwd]);

  return (
    <div className="tv-wrap">
      <div className="tv-header">
        <span className="tv-tag">TERMINAL</span>
        <span className="tv-dot" />
        <span className="tv-shell">PTY</span>
      </div>
      <div className="tv-body">
        <img className="tv-bg-img" src="/assets/bg-cityscape.png" alt="" />
        <div className="tv-aurora" />
        <div className="tv-orb tv-orb-1" />
        <div className="tv-orb tv-orb-2" />
        <div className="tv-orb tv-orb-3" />
        <div className="tv-scanlines" />
        <div className="tv-vignette" />
        <div ref={containerRef} className="tv-container" />
      </div>
    </div>
  );
}
