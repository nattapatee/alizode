# Design Implementation Plan

Converting Alizode UI from Tailwind to the pixel-art terminal design system.
Source prototype: `/private/tmp/alizode/project/` (app.jsx, ide.jsx, library.jsx, styles.css)

## Status

### Phase 1: Foundation (DONE)
- [x] `tokens.css` — design palette, fonts, spacing
- [x] `global.css` — full design system CSS (~2500 lines)
- [x] `index.html` — Google Fonts (JetBrains Mono + VT323)
- [x] Asset copy — chibi PNGs + backgrounds to `public/assets/`

### Phase 2: Shell Layout (DONE)
- [x] `App.tsx` — `.term-root` + `.term-body` 3-col grid + scanlines/CRT glow
- [x] `WorkspaceTabs.tsx` — `.term-tabs` / `.tab` / `.term-path`
- [x] `LaneList.tsx` — `aside.lanes` / `.lane` / `.lane-picker`
- [x] `CommandBar.tsx` — `.composer` / `.cmp-prefix` / `.cmp-colon`
- [x] `StatusBar.tsx` — `.term-foot`
- [x] `LaneHeader.tsx` — `.chat-head` / `.chat-status`
- [x] `LaneView.tsx` — fragment (`.chat-head` + `.log`) inside `main.chat`
- [x] `global.css` additions — app status mappings, newtab overlay, mention hints, thinking dots

### Phase 3: Event Log (DONE)
- [x] `EventRow.tsx` — 9 row types in `.log-row` grid with `.log-t` / `.log-prefix` / `.log-text`
- [x] `AgentTextBlock.tsx` — `.log-row.ai` with `.smd-content` streaming markdown
- [x] CSS: tool/tool-ok/tool-err/thought/peer/perm/perm-ok/err variants + `.log-details`/`.log-expand`

### Phase 4: Boot Screen (DONE)
- [x] `Onboarding.tsx` — `.boot-root` / `.boot-frame` / `.boot-log` / `.pick-grid` / `.pick-card`
- [x] `src/lib/characters.ts` — 7 agents with portraits, accents, chibis, personality data
- [x] Boot log animation (typewriter line reveal from detected agents)
- [x] Agent picker with portrait cards + workspace name/cwd form
- [x] CSS: `.boot-ws-form` / `.boot-ws-label` / `.boot-warn` additions

### Phase 5: Agent Stage (DONE)
- [x] `Stage.tsx` — `.stage` / `.stage-head` / `.stage-frame` / `.stage-portrait` / `.stage-stats`
- [x] Portrait frame with scan ring, grid overlay, status-driven glow + brackets
- [x] Stats panel: agent (accented), model, role, ctx, status
- [x] Character lookup via `CHAR_BY_ID` with fallback for unknown agents
- [x] App.tsx refactored — inline stage replaced with `<Stage>` component

### Phase 6: Workspace Scene (DONE)
- [x] `WsScene.tsx` — `.ws-scene` / `.ws-roster` / `.rc` with full chibi system
- [x] Chibi positioning with drag + random walk (2.6s interval, ±15% drift)
- [x] Status-driven animations (idle bob, thinking pulse via CSS)
- [x] Thought bubbles for "thinking" state
- [x] Kiosk terminal display with lane count
- [x] Stage.tsx wired with `.stage-workspace` section + WsScene
- [x] App.tsx passes `lanes` + `setActiveLaneId` to Stage

### Phase 7: Cinematic Intros (DONE)
- [x] `WorkspaceIntro.tsx` — zoom-into-monitor with HUD overlay, 5-phase timed animation
- [x] `LibraryIntro.tsx` — book-opening animation with page-line reveals
- [x] `IdeIntro.tsx` — terminal boot sequence with syntax-highlighted code preview
- [x] All three wired into App.tsx / LibraryView / EditorView with auto-play on first view

### Phase 8: Library View (NEXT)
- [ ] Convert `LibraryView.tsx` — `.lib-body` / `.lib-shelves` / `.lib-book-spine` / `.lib-preview`
- [ ] Empty state: `.lib-empty` with Sage intro
- [ ] `SageDock.tsx` — `.sage-dock` with chibi + chat

### Phase 9: IDE/Editor View
- [ ] Convert `EditorView.tsx` — `.ide-body` / `.ide-tree` / `.ide-editor` / `.ide-chat`
- [ ] Empty state: `.ide-empty` with Forge intro
- [ ] Forge chat panel integration

### Phase 10: Polish
- [ ] CRT effects: scanline intensity, glow vignette tuning
- [ ] Responsive breakpoints (<900px: hide stage, <600px: overlay lanes)
- [ ] Per-agent accent colors (--accent per lane)
- [ ] Keyboard shortcuts UI hints
- [ ] Performance: verify CSS budget (<30kb gzipped)

## Character Map

| Agent   | Accent    | Portrait           | Chibi            |
|---------|-----------|--------------------|------------------|
| Claude  | `#ff9d3f` | char-rover.png     | rover-chibi.png  |
| Codex   | `#7c6cff` | char-kai.png       | kai-chibi.png    |
| Omo     | `#5af0c8` | char-luna.png      | luna-chibi.png   |
| Cursor  | `#d8e7ff` | (placeholder glyph)| —                |
| Gemini  | `#d678ff` | (placeholder glyph)| —                |
| Sage    | `#7cd17a` | char-sage.png      | sage-chibi.png   |
| Forge   | `#7df9ff` | forge-chibi.png    | forge-chibi.png  |

## Key CSS Classes Reference

```
Shell:    .term-root  .term-tabs  .tab  .term-path  .term-body  .term-foot
Lanes:    .lanes  .lanes-head  .lane  .lane-dot  .lane-picker
Chat:     .chat  .chat-head  .log  .log-row  .composer
Stage:    .stage  .stage-frame  .stage-portrait  .stage-stats  .stat
Scene:    .ws-scene  .ws-roster  .rc  .rc-body  .rc-bubble  .ws-kiosk
Boot:     .boot-root  .boot-frame  .pick-grid  .pick-card  .pick-portrait
Library:  .lib-body  .lib-shelves  .lib-book-spine  .lib-preview  .sage-dock
IDE:      .ide-body  .ide-tree  .ide-editor  .ide-chat
Effects:  .scanlines  .crt-glow  .intro  .intro-camera  .intro-monitor
```
