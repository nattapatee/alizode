import { useRef, useEffect } from "react";
import {
  default_renderer,
  parser,
  parser_write,
  parser_end,
  type Parser,
} from "streaming-markdown";

interface AgentTextBlockProps {
  chunks: string[];
  isSealed: boolean;
}

export function AgentTextBlock({ chunks, isSealed }: AgentTextBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const parserRef = useRef<Parser | null>(null);
  const fedRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = "";
    const r = default_renderer(el);
    const p = parser(r);
    parserRef.current = p;
    fedRef.current = 0;
    for (const chunk of chunks) {
      parser_write(p, chunk);
    }
    fedRef.current = chunks.length;
    if (isSealed) parser_end(p);
    return () => {
      el.innerHTML = "";
      parserRef.current = null;
      fedRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const p = parserRef.current;
    if (!p) return;
    for (let i = fedRef.current; i < chunks.length; i++) {
      parser_write(p, chunks[i]);
    }
    fedRef.current = chunks.length;
  }, [chunks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isSealed && parserRef.current) {
      parser_end(parserRef.current);
    }
  }, [isSealed]);

  return (
    <div
      className="log-row ai"
      style={{ "--ai": "var(--cyan)" } as React.CSSProperties}
    >
      <span className="log-t" />
      <span className="log-prefix">ai</span>
      <div className="log-text smd-content" ref={containerRef} />
    </div>
  );
}
