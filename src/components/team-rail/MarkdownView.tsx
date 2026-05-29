import { useRef, useEffect } from "react";
import {
  default_renderer,
  parser,
  parser_write,
  parser_end,
  HREF,
  SRC,
  type Default_Renderer,
} from "streaming-markdown";

// Same sanitization as AgentTextBlock: streaming-markdown builds the DOM via
// createElement/textContent (raw HTML in the source is treated as text, so no
// XSS), and we additionally neutralize non-http(s)/mailto link & image URLs.
function makeSafeRenderer(root: HTMLElement): Default_Renderer {
  const r = default_renderer(root);
  const origSetAttr = r.set_attr;
  r.set_attr = (data, type, value) => {
    if (type === HREF && !/^(https?|mailto):/i.test(value)) {
      value = "#";
    } else if (type === SRC && !/^https?:/i.test(value)) {
      value = "#";
    }
    origSetAttr(data, type, value);
  };
  return r;
}

interface Props {
  text: string;
}

/** One-shot markdown render of a completed message (not streaming). */
export function MarkdownView({ text }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    const p = parser(makeSafeRenderer(el));
    parser_write(p, text);
    parser_end(p);
    return () => {
      el.innerHTML = "";
    };
  }, [text]);

  return <div className="smd-content tv-cl-md" ref={ref} />;
}
