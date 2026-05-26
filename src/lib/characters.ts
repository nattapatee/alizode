export interface Character {
  id: string;
  name: string;
  model: string;
  role: string;
  accent: string;
  accentSoft: string;
  portrait: string | null;
  video: string | null;
  chibi: string | null;
  placeholderGlyph?: string;
  tagline: string;
  personality: string;
  sample: string;
  intro: string;
  libraryOnly?: boolean;
  ideOnly?: boolean;
}

export const CHARACTERS: Character[] = [
  {
    id: "claude",
    name: "CLAUDE",
    model: "claude-sonnet-4.5",
    role: "reasoning · long context",
    accent: "#ff9d3f",
    accentSoft: "#ffb86b",
    portrait: "/assets/char-rover.png",
    video: "/assets/rover-claude.mp4",
    chibi: "/assets/rover-chibi.png",
    tagline: "deep analysis · careful writing · honest",
    personality: "thoughtful, candid, asks before it acts",
    sample: "let's slow down — what are we actually solving here?",
    intro: "claude online. give me the long version and i'll think out loud. honest defaults: i'll ask before i touch anything risky.",
  },
  {
    id: "codex",
    name: "CODEX",
    model: "codex-mini · gpt-5",
    role: "coding · exec · tools",
    accent: "#7c6cff",
    accentSoft: "#a39bff",
    portrait: "/assets/char-kai.png",
    video: "/assets/kai-codex.mp4",
    chibi: "/assets/kai-chibi.png",
    tagline: "fast diffs · runs commands · ships",
    personality: "terse, fluent in shell + git, ships first",
    sample: "patched. tests green. shipping.",
    intro: "codex ready. point me at a repo or a failing test. i'll come back with a diff, a run log, and a one-line summary.",
  },
  {
    id: "opencode",
    name: "OPENCODE",
    model: "opencode-acp",
    role: "coding · terminal · tools",
    accent: "#5af0c8",
    accentSoft: "#9efce0",
    portrait: "/assets/char-luna.png",
    video: "/assets/luna-opencode.mp4",
    chibi: "/assets/luna-chibi.png",
    tagline: "open source · fast edits · ships",
    personality: "nimble, open-source-first, direct",
    sample: "done — diff staged, tests pass.",
    intro: "opencode online. point me at a file or a failing test and i'll come back with a clean diff.",
  },
  {
    id: "cursor",
    name: "CURSOR",
    model: "cursor-tab",
    role: "inline edits · tab-complete",
    accent: "#d8e7ff",
    accentSoft: "#ffffff",
    portrait: "/assets/char-vex.png",
    video: "/assets/vex-cursor.mp4",
    chibi: "/assets/vex-chibi.png",
    tagline: "predictive · in-editor · invisible",
    personality: "fast, silent, only types when needed",
    sample: "[tab] accept · [esc] dismiss",
    intro: "cursor attached to the buffer. start typing — i'll predict the next move. tab to take it, esc to walk away.",
  },
  {
    id: "gemini",
    name: "GEMINI",
    model: "gemini-2.5-pro",
    role: "multimodal · research",
    accent: "#d678ff",
    accentSoft: "#ecb3ff",
    portrait: "/assets/char-lyra.png",
    video: "/assets/lyra-gemini.mp4",
    chibi: "/assets/lyra-chibi.png",
    tagline: "vision · long ctx · web",
    personality: "broad, analytical, citation-happy",
    sample: "i can see the diagram. cross-check with three sources?",
    intro: "gemini online — multimodal handles wired. drop a file, paste a screen, or hand me a question for the open web.",
  },
  {
    id: "sage",
    name: "SAGE",
    model: "sage-archive-1",
    role: "librarian · local rag",
    accent: "#7cd17a",
    accentSoft: "#b8e5b6",
    portrait: "/assets/char-sage.png",
    video: null,
    chibi: "/assets/sage-chibi.png",
    tagline: "indexes folders · cites paragraphs · remembers",
    personality: "patient, scholarly, never skips a citation",
    sample: "found 3 mentions across your notes — quoting them.",
    intro: "sage at the desk. point me at a library folder and i'll index it; ask me anything and i'll quote the paragraph back to you.",
    libraryOnly: true,
  },
  {
    id: "forge",
    name: "FORGE",
    model: "forge-runtime-2",
    role: "code synth · static analysis",
    accent: "#7df9ff",
    accentSoft: "#b8f7fc",
    portrait: "/assets/forge-chibi.png",
    video: null,
    chibi: "/assets/forge-chibi.png",
    tagline: "writes patches · runs tests · ships",
    personality: "precise, system-minded, runs everything in a sandbox",
    sample: "patch ready — 4 files, 18 lines. tests green in 0.7s.",
    intro: "forge online. sandbox warmed up, linters armed. open a file or paste an error trace and i'll come back with a diff and a run log.",
    ideOnly: true,
  },
];

export const CHAR_BY_ID = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
) as Record<string, Character>;

export const SELECTABLE = CHARACTERS.filter(
  (c) => !c.libraryOnly && !c.ideOnly,
);
