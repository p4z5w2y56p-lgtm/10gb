# AIVEN ARC UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every screen of AIVEN ARC in the AIVEN AI theme (React renderer) on top of the finished backend, with a click-through design preview Matt can review before anything is packaged.

**Architecture:** A pure reducer turns backend `AgentEvent`s into UI state; thin typed client wraps `window.arc`; feature folders render that state with a small set of custom components (no UI library). The renderer imports no Node or Electron code. When `window.arc` is absent (a plain browser), a scripted mock backend drives the same UI, which powers the preview and the screenshots.

**Tech Stack:** React 19, Vite (via electron-vite), TypeScript strict, plain CSS with design tokens, `@fontsource` fonts, `marked` + `dompurify`, vitest + jsdom + Testing Library, Playwright (Chromium, already installed) for screenshots.

**Spec:** `docs/superpowers/specs/2026-10-06-aiven-arc-design.md` (sections 8 and 9 are the design; 6.5 and 7 for permissions and Spark). Backend contracts: `src/shared/types.ts`, `src/shared/channels.ts`, `src/shared/ipc.ts`.

## Global Constraints

- Colours, radii and type come only from the AIVEN AI theme tokens in `src/renderer/theme/tokens.css`; no raw hex outside that file. AI values: `surface #020203`, `surface-panel rgba(15,15,20,.4)` with `blur 20px`, `surface-deep rgba(0,0,0,.5)`, `ink #f0f0f5`, `ink-muted #8a8a9e`, `border rgba(255,255,255,.08)`, `accent #ff6b00` with `accent-ink #000000`, `signal #00e5ff`, `signal-soft rgba(0,229,255,.1)`, `success #00ff88`, `success-strong #00c851`, `warning #ffbb33`, `danger #ff4444`; radii 8, 12, 16, 24 px; Inter 400/600/800 and JetBrains Mono. The optional Studios (light) theme swaps colours only: `surface #f7f7f9`, `surface-panel #ffffff`, `ink #030303`, `ink-muted #666666`, `border #e2e2e5`, `accent #030303` with `accent-ink #f7f7f9`, `signal #111111`, `signal-soft rgba(3,3,3,.06)`.
- Copy is English, short, in the system voice (`ARC // SESSION`, mono uppercase eyebrows). No exclamation marks, no emoji anywhere in the UI. Text on orange is black.
- The default view shows progress, not code: raw tool output, diffs and arguments appear only under "Details". Exception: a Bash approval always shows the exact command on one line.
- No remote resources: fonts come from `@fontsource`, no CDN, no inline `<script>`. The page must work under the strict CSP in `src/main/windowConfig.ts` (`connect-src 'none'`).
- Every control is keyboard operable with a visible `signal` focus ring; motion is 160 to 240 ms ease-out and is disabled under `prefers-reduced-motion`.
- With no API key saved the app is locked: the lock screen is shown and nothing can be sent.
- The renderer talks to the backend only through `src/renderer/arc/client.ts`.
- Run `npm run typecheck` and `npm test` before every commit; commit after every task and push `claude/practical-tesla-ixoypf`; end each commit message with the two attribution lines from the session's commit guidance.

## Review Focus

1. A very long assistant message or tool output, and thousands of transcript items: scrolling stays pinned only when the user is at the bottom; nothing renders unbounded text. Test in Task 6.
2. Assistant text containing HTML or script tags: it is sanitized, links open outside the app. Test in Task 6.
3. A backend error mid-turn (`no-api-key`, network, rate limit): the composer unlocks, the notice is readable, nothing stays stuck on "Thinking". Test in Task 2 (reducer) and Task 7.
4. Switching to Auto mode or removing the key while a turn runs: confirmation appears, and removal stops the turn first. Test in Task 5 and Task 8.
5. Narrow windows (900 px minimum) and large text: header and composer do not overlap or clip. Test (screenshots) in Task 11.

---

## File Structure

```
src/renderer/index.html  main.tsx  App.tsx  env.d.ts
src/renderer/theme/{tokens.css,base.css,components.css}
src/renderer/arc/{client.ts,mock.ts,scenario.ts}
src/renderer/state/{reducer.ts,store.tsx,commands.ts}
src/renderer/ui/{Icon,Button,Badge,Panel,Field,Select,Toggle,Segmented,Popover,Dialog,Toast,Kbd,ProgressBar,Markdown}.tsx
src/renderer/features/shell/{Shell,Sidebar}.tsx
src/renderer/features/header/{Header,ProgressPill,PlanPopover,ChangesPopover,ModeChip}.tsx
src/renderer/features/conversation/{Transcript,ActivityFeed,ApprovalCard,QuestionCard,EmptyState}.tsx
src/renderer/features/composer/{Composer,SlashMenu,StatusLine,SuggestionChips}.tsx
src/renderer/features/settings/{SettingsView,ModelsPane,PermissionsPane,PrompterPane,AppearancePane,AdvancedPane,AuditPane,AboutPane}.tsx
src/renderer/features/lock/LockScreen.tsx
src/renderer/features/palette/{CommandPalette,ShortcutsSheet}.tsx
scripts/screenshots.ts   scripts/build-preview.ts
tests/renderer/**   (jsdom; helpers in tests/renderer/helpers/)
```

---

### Task 1: Renderer scaffold, tokens and base styles

**Files:**
- Create: `src/renderer/theme/tokens.css`, `base.css`, `components.css` (empty shell, grown by later tasks), `src/renderer/env.d.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx` (placeholder), `tests/renderer/helpers/render.tsx`
- Modify: `package.json` (deps), `vitest.config.ts` (include `tests/**/*.test.tsx`, setup file), `tsconfig.json` (`jsx: react-jsx`), `electron.vite.config.ts` (react plugin), `src/renderer/index.html` (mount point, no inline script)
- Test: `tests/renderer/tokens.test.ts`, `tests/renderer/smoke.test.tsx`

**Interfaces:**
- Produces: CSS custom properties on `:root[data-theme="ai"]` and `:root[data-theme="studios"]` with the exact names `--surface --surface-panel --surface-deep --surface-field --ink --ink-heading --ink-muted --ink-on-deep --border --accent --accent-ink --signal --signal-soft --success --success-strong --warning --danger --radius-sm --radius-md --radius-lg --radius-xl --radius-pill --space-12 --space-15 --space-20 --space-24 --space-30 --space-40 --blur-glass --shadow-panel --shadow-cta --shadow-signal --font-ui --font-mono --ease --dur`.
- Produces: `renderWithApp(ui, { arc?, state? })` test helper in `tests/renderer/helpers/render.tsx` (filled in Task 2 once the store exists; here it wraps `@testing-library/react` `render`).

- [ ] **Step 1: Write failing tests.** `tokens.test.ts` reads `tokens.css` and asserts the exact values from Global Constraints for both themes (for example `--surface: #020203` under `data-theme="ai"` and `--surface: #f7f7f9` under `studios`), that every listed name is defined in both themes, and that `base.css` contains `:focus-visible` using `var(--signal)` and a `prefers-reduced-motion` block. `smoke.test.tsx` renders `<App />` in jsdom and finds the text `AIVEN ARC`.
- [ ] **Step 2: Run** `npx vitest run tests/renderer` → FAIL.
- [ ] **Step 3: Install** `react react-dom @fontsource/inter @fontsource/jetbrains-mono marked dompurify` and dev `@vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @types/react @types/react-dom @types/dompurify`. Write the CSS files (tokens from the AIVEN design system; base: reset, Inter body, `-webkit-font-smoothing`, custom scrollbars, `::selection` in `signal-soft`, ambient glow on `body` with orange top-left and blue bottom-right at very low opacity, `-webkit-app-region` helpers `.drag` and `.no-drag`). `main.tsx` imports fonts and CSS, sets `data-theme="ai"`, mounts `<App />`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npx electron-vite build` → PASS (build emits the renderer bundle).
- [ ] **Step 5: Commit** `feat(ui): renderer scaffold and AIVEN tokens`, push.

---

### Task 2: Typed client, reducer and store

**Files:** Create `src/renderer/arc/client.ts`, `src/renderer/state/reducer.ts`, `src/renderer/state/store.tsx`; Test `tests/renderer/client.test.ts`, `tests/renderer/reducer.test.ts`

**Interfaces:**
- Produces (`client.ts`): `ArcError extends Error { code?: 'no-api-key'|'no-project'|'invalid'|'untrusted' }`; `interface Arc { invoke(channel: string, payload?: unknown): Promise<unknown>; onEvent(l: (e: AgentEvent) => void): () => void }` (the shape `window.arc` has); `createClient(arc: Arc)` returning typed methods that unwrap `IpcResult` and throw `ArcError`: `send(text): TurnEndReason`, `stop()`, `approve(requestId, decision, note?)`, `answer(questionId, answer)`, `setMode(mode)`, `undo()`, `changes()`, `chooseProject()`, `openProject(path)`, `status(): BackendStatus`, `getSettings()`, `saveSettings(patch)`, `setKey(key)`, `clearKey()`, `testKey(): ConnectionResult[]`, `listSessions()`, `resumeSession(id)`, `listRules()`, `removeRule(rule)`, `readAudit()`, `spark()`, `setAutopilot(on)`, `onEvent(l)`.
- Produces (`reducer.ts`): `AppState`, `initialState`, `Action = { type: 'event'; event: AgentEvent } | { type: 'user-message'; text: string } | { type: 'loaded'; … } | { type: 'ui'; … }` and `reduce(state: AppState, action: Action): AppState`. `AppState` holds: `status {state,label}`, `transcript: Item[]` where `Item = { kind:'user'; id; text } | { kind:'assistant'; id; text; streaming: boolean } | { kind:'activity'; id; phase; label; state; call?: ToolCall; output?: string; diff?: string } | { kind:'notice'; id; level; message }`, `todos`, `usage {promptTokens,totalTokens}`, `mode`, `changes {files, canUndo}`, `suggestions`, `autopilot {running, reason?}`, `approval: ApprovalRequest | null`, `question: {id,question,options?} | null`, `busy: boolean`, `app: BackendStatus | null`, `settings: Settings | null`, `ui: { sidebar: boolean; settingsOpen: boolean; settingsSection: string; paletteOpen: boolean; shortcutsOpen: boolean; showDetails: boolean }`.
- Produces (`store.tsx`): `AppProvider({ arc, children })`, `useApp(): { state: AppState; api: ReturnType<typeof createClient>; dispatch }`.

- [ ] **Step 1: Failing tests.** Client: a successful result returns `data`; `{ok:false, code:'no-api-key'}` throws `ArcError` with that code and message; an unknown channel is never invoked. Reducer (one test each): `text-delta` appends to the last streaming assistant item and starts one if the last item is not assistant; a `tool-call` + `activity running` + `tool-result` + `activity done` sequence ends as ONE activity item with `state:'done'`, the done label, the call arguments and the output; `activity denied` marks it denied; `approval-request` sets `approval` and `tool-start` or `turn-end` clears it; `question` sets and a later `turn-end` clears it; `status` updates; `todos` replaces; `usage` keeps the latest; `notice` appends a notice item; `turn-end` sets `busy:false`, `status idle`, and finalizes the streaming assistant item; `suggestions`, `mode`, `changes`, `autopilot` update their slices; `user-message` appends a user item and sets `busy:true`. **Review focus 3:** after a `notice` error and `turn-end` with reason `error`, `busy` is false and `status.state` is `idle`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the three files. **Step 4: Run** → PASS. **Step 5: Commit** `feat(ui): typed client, reducer and store`, push.

---

### Task 3: Base components

**Files:** Create `src/renderer/ui/{Icon,Button,Badge,Panel,Field,Select,Toggle,Segmented,Popover,Dialog,Toast,Kbd,ProgressBar}.tsx`, grow `components.css`; Test `tests/renderer/ui.test.tsx`

**Interfaces:**
- Produces: `Icon({ name, size? })` with names `arrow-right bolt chart-up cpu eye plug radar target terminal check x warn lock key folder file plus minus chevron-down chevron-right search sparkles undo stop settings sidebar clock edit shield play`, drawn as 24px, 1.5px stroke, round caps SVG using `currentColor`.
- Produces: `Button({ variant: 'primary'|'outline'|'ghost'|'danger', size?, icon?, loading?, ...button props })`; `Badge({ tone: 'neutral'|'signal'|'success'|'warning'|'danger', dot? })`; `Panel({ tone?: 'glass'|'deep' })`; `Field({ label, hint?, error?, children })` and `TextInput`; `Select<T>({ value, options: {value,label,hint?}[], onChange, allowCustom?, placeholder?, 'aria-label' })`; `Toggle({ checked, onChange, label })`; `Segmented({ value, options, onChange })`; `Popover({ trigger, children, open, onOpenChange, align? })`; `Dialog({ open, onClose, title, children, actions })`; `ToastHost` plus `useToast().push({ tone, text })`; `Kbd`; `ProgressBar({ value, max })`.

- [ ] **Step 1: Failing tests.** Button: `loading` disables it and sets `aria-busy`; ghost and outline render their classes; Enter and Space activate. Toggle: role `switch`, `aria-checked` flips on click and on Space. Segmented: role `radiogroup`, arrow keys move selection. Select: opens on click, Arrow Down and Enter choose, Escape closes and returns focus to the trigger, `allowCustom` shows a "Custom…" entry that reveals a text input and reports the typed id. Popover: opens, closes on outside click and Escape. Dialog: `role="dialog"` with `aria-modal`, focus moves inside, Tab stays inside, Escape calls `onClose`, focus returns to the opener. Toast: shows text, auto-dismisses after 4 s (fake timers) and can be dismissed. ProgressBar: exposes `role="progressbar"` with `aria-valuenow`, clamps 0 to max. Icon: every listed name renders an `svg` with `aria-hidden`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Build the controls from native elements plus ARIA (no UI library); `components.css` styles them from tokens only. **Step 4: Run** → PASS. **Step 5: Commit** `feat(ui): base components`, push.

---

### Task 4: Shell, sidebar and header

**Files:** Create `src/renderer/features/shell/{Shell,Sidebar}.tsx`, `src/renderer/features/header/{Header,ProgressPill,PlanPopover,ChangesPopover,ModeChip}.tsx`; Test `tests/renderer/header.test.tsx`, `tests/renderer/sidebar.test.tsx`

**Interfaces:**
- Consumes: `useApp()`, base components, `progressOf` and `groupActivities` from `src/main/agent/narrate.ts` (pure, importable).
- Produces: `Shell({ children })` laying out sidebar, header and conversation column (about 760 px wide, centred) with the composer slot; `Header()` (52 px, whole bar is a drag region, controls are `no-drag`, left padding clears the traffic lights); `ProgressPill()`; `PlanPopover()`; `ChangesPopover()`; `ModeChip()`; `Sidebar()` (project name and folder button, "New session", session list from `listSessions`, collapsible).

- [ ] **Step 1: Failing tests.** ProgressPill: with `status {working, 'Editing app.ts'}` it shows that text and a live dot; idle shows `All systems nominal`; with todos 3 of 7 it shows `3 of 7` and the bar has `aria-valuenow=3`; clicking opens the Plan popover listing todos with the in-progress one marked. ChangesPopover: button shows the file count and is disabled at 0; popover lists base names with a path tooltip; `Undo` calls `api.undo` and is disabled when `canUndo` is false. ModeChip: shows `ASK`, `AUTO-EDIT` or `AUTO` (Auto in the danger tone); choosing Auto opens a confirmation dialog naming what changes and only calls `api.setMode('auto')` after confirming (**review focus 4**); choosing Ask needs no confirmation. Header: Spark button calls `api.spark` and is disabled while busy; settings button sets `ui.settingsOpen`. Sidebar: lists sessions newest first with titles, clicking one calls `resumeSession`; collapse toggle hides it; "New session" calls `openProject` for the current root.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(ui): shell, sidebar and header`, push.

---

### Task 5: Conversation and activity feed

**Files:** Create `src/renderer/features/conversation/{Transcript,ActivityFeed,ApprovalCard,QuestionCard,EmptyState}.tsx`, `src/renderer/ui/Markdown.tsx`; Test `tests/renderer/conversation.test.tsx`

**Interfaces:**
- Produces: `Markdown({ text })` (marked then DOMPurify; links get `rel="noreferrer noopener"` and are intercepted to ask the backend to open them externally via a `target=_blank` the window handler routes to the system browser); `Transcript()` rendering `state.transcript`; `ActivityFeed({ items })` (groups consecutive reads and searches with `groupActivities`, one plain-language line each with a state icon, click toggles Details showing arguments, output and diff; `state.ui.showDetails` expands all); `ApprovalCard()` (plain question, reason, buttons `Allow once`, `Always allow this`, `Deny` with keyboard `Y`, `A`, `N`; a Bash approval shows the exact command in a mono line; Edit and Write show file names and a "View changes" expander that renders the diff with added and removed lines); `QuestionCard()` (options as buttons plus free text); `EmptyState()` (mono eyebrow `ARC // READY`, one line, up to three Spark idea cards).

- [ ] **Step 1: Failing tests.** Assistant markdown renders bold and code; **review focus 2:** `<script>alert(1)</script>`, `<img onerror=…>` and `javascript:` links are stripped. Three consecutive Read items render as one `Read 3 files` line; clicking it reveals the three file names. A finished Edit shows `Edited app.ts` with a check icon and no diff until Details is opened, then the diff shows `+`/`-` lines. A running item shows a spinner and its running label. Denied shows `Skipped:`/`Blocked:` label with the denied icon. ApprovalCard: Bash approval shows `mkdir -p out` verbatim; pressing `y` calls `api.approve(id,'allow-once')`, `a` calls it with `'always'`, `n` with `'deny'`; an Edit approval has no diff visible until "View changes" is clicked; buttons are disabled after a decision. QuestionCard: clicking an option calls `api.answer`. **Review focus 1:** a 200,000-character assistant message renders collapsed behind a "Show full message" control and does not put 200,000 characters in the DOM until expanded; an activity output longer than 20,000 characters is cut with a "Show all" control.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(ui): conversation, activity feed and approvals`, push.

---

### Task 6: Composer, slash commands and Spark chips

**Files:** Create `src/renderer/features/composer/{Composer,SlashMenu,StatusLine,SuggestionChips}.tsx`, `src/renderer/state/commands.ts`; Test `tests/renderer/composer.test.tsx`, `tests/renderer/commands.test.ts`

**Interfaces:**
- Produces (`commands.ts`): `SLASH_COMMANDS: Array<{ name: string; hint: string; run(ctx: CommandContext, arg: string): void | Promise<void> }>` for `/help /new /mode /spark /autopilot /undo /resume /settings /details /stop`, and `matchCommands(input: string)` (prefix match, then substring).
- Produces: `Composer()` (autosizing textarea; Enter sends, Shift+Enter newline, Up/Down walks sent history when empty; while `busy` the send button becomes a Stop button; locked with a visible message when `app.ready` is false or no project is open); `SlashMenu` (opens on a leading `/`, arrows and Tab/Enter complete); `StatusLine()` (mode chip, model chip from settings, context meter `used / window` from `usage.totalTokens` and `settings.contextWindowTokens`, tabular numerals); `SuggestionChips()` (Spark ideas as chips: click sends, Alt-click or the edit icon puts the text in the composer).

- [ ] **Step 1: Failing tests.** Enter sends trimmed text via `api.send` and clears the box; Shift+Enter inserts a newline; empty and whitespace-only do not send; Up recalls the previous message; while busy the primary button reads `Stop` and calls `api.stop`; with `app.ready:false` the textarea is disabled and the message says `Add your Vertex API key in Settings to start`; with no project it says to open a folder. Typing `/mo` shows `/mode`; Tab completes it; `/mode auto-edit` calls `api.setMode`; `/help` opens the shortcuts sheet; an unknown `/zzz` shows an inline hint and does not send to the model. StatusLine: shows the model id and a meter at `85%` in the warning tone (matches the compaction threshold). Chips: clicking a chip calls `api.send` with its prompt; the edit icon fills the composer instead. **Review focus 3:** a rejected `api.send` with `ArcError('no-api-key')` re-enables the composer and shows the notice.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(ui): composer, slash commands and spark chips`, push.

---

### Task 7: Settings

**Files:** Create `src/renderer/features/settings/{SettingsView,ModelsPane,PermissionsPane,PrompterPane,AppearancePane,AdvancedPane,AuditPane,AboutPane}.tsx`; Test `tests/renderer/settings.test.tsx`

**Interfaces:**
- Produces: `SettingsView()` (left section list `Models, Permissions, Spark, Appearance, Advanced, Audit log, About`, right pane, `Esc` closes, deep-linkable via `ui.settingsSection`).
- Models pane: masked API key field (shows `Saved` with the last four characters never available, only a `Replace` button once saved), `Save`, `Remove` (stops the running turn first, then confirms), `Test connection` (renders each `ConnectionResult` with an ok or failed badge); coder model and prompter model `Select` each with the options `gemini-3.8-flash` and `Custom…`, saved immediately through `saveSettings`.
- Permissions pane: default mode `Segmented` (Auto selection needs the same confirmation dialog), extra directories list with add (text input) and remove, saved always-allow rules list from `listRules` with a remove button. Spark pane: mode `Segmented`, round cap, token budget. Appearance: theme cards (AI dark, Studios light) that apply instantly, `Show details by default` toggle. Advanced: step cap, per-turn token budget, context window. Audit pane: table of `readAudit` (time, tool, verdict badge, who approved), newest first. About: version, shortcuts list.

- [ ] **Step 1: Failing tests.** Saving a key calls `api.setKey` with the typed value, clears the input, never renders the value afterwards, and flips `app.ready`; the key text is never present in the DOM after saving. `Remove` with a running turn calls `api.stop` before `api.clearKey` (**review focus 4**) and asks for confirmation. `Test connection` shows `OK` and `FAIL` badges from the results. Selecting `Custom…` for the prompter model, typing `my-model`, and blurring calls `saveSettings({ prompterModel: 'my-model' })` without touching `model`. Changing the theme sets `document.documentElement.dataset.theme` and saves. Invalid numbers (empty, negative) are not saved and show an inline error. Rules list shows saved rules and removing one calls `api.removeRule` and refreshes. Audit rows render in newest-first order. `Esc` closes the view.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(ui): settings screens`, push.

---

### Task 8: Lock screen, first run, command palette and shortcuts

**Files:** Create `src/renderer/features/lock/LockScreen.tsx`, `src/renderer/features/palette/{CommandPalette,ShortcutsSheet}.tsx`, `src/renderer/state/keybindings.ts`; Test `tests/renderer/lock.test.tsx`, `tests/renderer/palette.test.tsx`, `tests/renderer/keybindings.test.tsx`

**Interfaces:**
- Produces: `LockScreen()` shown whenever `app.ready` is false (mono eyebrow `ARC // LOCKED`, one sentence, masked key field, `Save and unlock`, short note on where the key is stored, link to the model settings); after a key is saved with no project open it shows the "Open a folder" step; `CommandPalette()` (Cmd+K, filter box, arrow keys, Enter runs, lists the slash commands plus `Open project`, `Settings`, `Toggle sidebar`, `Toggle details`, `Switch theme`, recent sessions); `ShortcutsSheet()`; `useKeybindings()` handling `Esc` (stop when busy, else close top overlay), `Shift+Tab` (cycle ask, auto-edit, ask; never into Auto), `Cmd+,`, `Cmd+O`, `Cmd+B`, `Cmd+K`, `Cmd+Shift+D`.

- [ ] **Step 1: Failing tests.** LockScreen replaces the whole app when `ready` is false and the composer is unreachable; saving a key calls `api.setKey` and unlocks; an empty key shows an error and does not call the backend; the key field is `type=password`. Palette: Cmd+K opens, typing `set` leaves `Settings`, Enter runs it and closes; Escape closes. Keybindings: `Esc` while busy calls `api.stop`; `Shift+Tab` cycles ask → auto-edit → ask and never reaches `auto`; `Cmd+,` opens settings; `Cmd+B` toggles the sidebar; shortcuts are ignored while typing in a text field except `Esc` and `Cmd+K`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(ui): lock screen, palette and shortcuts`, push.

---

### Task 9: App assembly, mock backend and design preview

**Files:** Create `src/renderer/arc/mock.ts`, `src/renderer/arc/scenario.ts`, `scripts/screenshots.ts`, `scripts/build-preview.ts`; Modify `src/renderer/App.tsx`, `src/renderer/main.tsx`; Test `tests/renderer/mock.test.ts`, `tests/renderer/app.test.tsx`

**Interfaces:**
- Produces: `createMockArc(opts?: { hasKey?: boolean }): Arc & { script: Scenario }` implementing every channel with plausible data and a scripted conversation (reads, an edit that needs approval with a diff, a bash test run, a todo list, Spark ideas, a question), keyed off `window.arc` being absent in a plain browser.
- Produces: `App()` wiring `Shell`, `Header`, `Sidebar`, `Transcript`, `Composer`, `SettingsView`, `LockScreen`, `CommandPalette`, toasts; theme applied from settings; initial load calls `status` and `getSettings`.
- Produces: `scripts/screenshots.ts` (Playwright + the built renderer served from disk) writing PNGs to `design-preview/` for: lock, empty, conversation with live activity, approval card, approval with diff open, plan popover, changes popover, mode confirm, settings (all seven panes), command palette, shortcuts, studios theme, and a 900 px wide window; `scripts/build-preview.ts` producing one self-contained `design-preview/index.html` (mock backend included) for review in any browser.

- [ ] **Step 1: Failing tests.** `app.test.tsx`: with `ready:false` the lock screen shows and no composer exists; with `ready:true` and no project the empty state says to open a folder; after the mock scenario plays, the transcript contains an activity feed, an approval card, and the header pill shows the live label; clicking `Allow once` in the mock finishes the edit and the Changes button shows `1`. `mock.test.ts`: the mock honours the run gate (no key → `no-api-key`), `setKey` unlocks, `clearKey` re-locks.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test && npm run typecheck && npx electron-vite build && npx tsx scripts/screenshots.ts` → PASS and PNGs written. **Step 5: Commit** `feat(ui): app assembly, mock backend and design preview`, push.

---

### Task 10: Polish pass: every screen to the same standard

**Files:** Modify CSS and components as findings require; Test `tests/renderer/a11y.test.tsx`

- [ ] **Step 1: Failing tests.** Using the screenshots as the review surface, add automated checks: every interactive element in each screen has an accessible name; no element uses a colour value outside the tokens (scan `components.css` and `base.css` for hex literals); every `button` and `[role=button]` has a visible focus style; motion rules are wrapped for reduced motion; text and background token pairs meet 4.5:1 (computed from `tokens.css` for body and muted text in both themes, with the Studios muted value `#666666` allowed at 5.4:1).
- [ ] **Step 2: Run** → FAIL on whatever the audit finds. **Step 3: Fix** each finding in CSS or markup (spacing scale, empty states on every list, tooltips, hover and active states, skeletons while loading). **Step 4: Run** all tests plus `npx tsx scripts/screenshots.ts` and review every PNG at 1x and 2x. **Step 5: Commit** `feat(ui): polish and accessibility pass`, push.

---

## Self-Review Notes

- **Spec coverage:** section 8.1 layout (Tasks 4, 5, 6), 8.2 header (4), 8.3 activity-first transcript and approvals (5), 8.4 composer, slash commands, shortcuts, settings, run gate (6, 7, 8), section 9 tokens, premium feel and every-screen polish (1, 3, 9, 10). Backend-side items already done. Not in this plan: `@file` mentions (needs a file-search IPC channel, deferred), `/compact` and `/init` slash commands (need backend channels), logo, `.icns` and packaging (done last, after Matt approves the design).
- **Type consistency:** `Arc`, `ArcError`, `AppState` and `Item` are defined in Task 2 and consumed by Tasks 3 to 9; `progressOf` and `groupActivities` come from the backend's `narrate.ts`.
- **What the preview proves:** layout, look, copy and behaviour against a scripted mock. It cannot prove vibrancy, the real Vertex responses, or the packaged `.app`; those stay on the Mac checklist in the README.
