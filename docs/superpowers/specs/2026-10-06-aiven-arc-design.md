# AIVEN ARC: Design Spec

A macOS desktop coding agent, in the spirit of Claude Code, powered by Gemini on
Google Vertex AI. Built with Electron + TypeScript. Visual identity comes from the
AIVEN design system (AI theme).

Date: 2026-10-06. Owner: Matt. Status: draft, awaiting review.

## 1. Intent

**What Matt wants.** A native-feeling Mac app where he opens a project folder, chats
with an agent, and the agent works on his laptop with real tools (read, edit and
write files, search, run shell commands). It should feel like Claude Code: streaming
output, tool-call cards, diffs, a todo list, slash commands, `@file` mentions,
project memory, session resume.

**What he added.**
- Model: Gemini 3.8 Flash on Google Vertex AI, authenticated with an API key.
- Safety lives in the app's own code, not in the model's good behaviour.
- Permission mode defaults to "ask"; settings can switch it to "auto".
- A second agent, the **prompter**, produces creative next-step prompts and feeds
  them to the main coding agent.
- Looks like AIVEN (the AI theme, not AIVEN Studios and not AIVEN AGENCY). Name:
  **AIVEN ARC**.

**Success looks like.**
1. `npm run dist` on a Mac produces `AIVEN ARC.app` that launches, takes an API key,
   and completes a real coding task in a chosen folder.
2. In Ask mode nothing writes or executes without a click. In Auto mode the hard
   denies still hold.
3. The prompter suggests useful prompts, and Autopilot stops at its limits.
4. A screenshot of ARC next to the AIVEN AI site reads as the same family.

**Assumptions (not stated, chosen by me).**
- UI copy is English. The AIVEN AI theme is Dutch for customers, but this is a dev
  tool. Strings live in one file so a Dutch pass is cheap later.
- The model id defaults to `gemini-3.8-flash` and is an editable setting. I could
  not verify the exact Vertex name, so nothing else hardcodes it.
- "Vertex API key" means Vertex AI express mode (`?key=` auth). Full Vertex with a
  project id, region and OAuth/ADC is out of scope for v1 (see section 12).

## 2. Scope

**In v1:** the app shell, Vertex client with streaming and function calling, agent
loop, tool set (section 5), permission and safety layer (section 6), prompter
(section 7), Claude-Code-style UX (section 8), AIVEN visual identity (section 9),
tests, and macOS packaging.

**Out of v1 (explicitly):** subagents/Task tool, MCP servers, plugins and hooks,
image input, Windows/Linux builds, code signing and notarization, telemetry, Dutch
UI strings, full Vertex project/OAuth auth.

## 3. Architecture

Three Electron layers with a narrow boundary between them.

```
Renderer (React, sandboxed)  <--typed IPC-->  Preload  <--IPC-->  Main (Node)
  UI only. No fs, no shell,                    contextBridge      agent loop, tools,
  no network.                                  allow-list API     safety, Vertex, store
```

All power lives in **main**. The renderer can only send intents ("send message",
"approve call 17", "change mode") and render events. This is also the safety
boundary: a bug or injected script in the UI cannot reach the filesystem.

### Source layout

```
src/main/
  index.ts                 app lifecycle, window, menu
  ipc.ts                   IPC handlers, zod-validated payloads
  vertex/client.ts         streamGenerateContent over SSE, retries
  vertex/types.ts          request/response types
  agent/loop.ts            the agent loop (section 4)
  agent/history.ts         message history, raw-part preservation
  agent/systemPrompt.ts    system prompt assembly (env, ARC.md, tool rules)
  agent/compaction.ts      /compact summarisation
  tools/{read,write,edit,ls,glob,grep,bash,todo,webfetch,askUser}.ts
  tools/registry.ts        tool schemas (JSON schema + zod) and dispatch
  safety/permissions.ts    decide(call) -> allow | ask | deny
  safety/modes.ts          ask / auto-edit / auto policy tables
  safety/pathSandbox.ts    realpath containment checks
  safety/bashGuard.ts      command parsing, hard denies, read-only allow-list
  safety/sandboxExec.ts    macOS sandbox-exec profile wrapper for Bash
  safety/redact.ts         secret redaction for model-bound text and logs
  safety/ssrf.ts           WebFetch URL/IP checks
  safety/audit.ts          append-only audit log
  prompter/prompter.ts     suggestion generation
  prompter/autopilot.ts    bounded autonomous rounds
  store/{settings,secrets,sessions,checkpoints}.ts
src/preload/index.ts       contextBridge API
src/renderer/              React app, AIVEN theme, components
tests/                     vitest, fake Vertex server
```

### Stack

Electron, TypeScript (strict), `electron-vite`, React, `zod` (tool input and IPC
validation), `diff` (edit diffs), `marked` + `DOMPurify` (markdown), fonts bundled
via `@fontsource` (Inter, JetBrains Mono) so the strict CSP needs no remote hosts,
`vitest` for tests, `electron-builder` for packaging.

## 4. Agent loop and Vertex client

**Endpoint.** `POST https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:streamGenerateContent?alt=sse`
with the API key sent as `x-goog-api-key` (not in the URL, so it never lands in
logs or error messages). Tools are declared as `functionDeclarations`.

**Loop (per user turn):**
1. Build the request: system instruction + history + tool declarations.
2. Stream the response; forward text deltas to the renderer as they arrive.
3. If the response contains function calls, run each through `decide()` (section 6).
   Allowed calls execute, "ask" calls wait for the user, denied calls return a
   structured refusal to the model.
4. Append function responses to history and go to step 1.
5. Stop when the model returns text with no function calls, the step cap is reached
   (default 40), the token budget is exhausted, or the user presses Esc/Stop.

**History keeps the model's raw `parts` verbatim**, including any thought
signatures Gemini 3 attaches to function calls. Rebuilding them from text would
break multi-step tool use on these models.

**Errors.** 429/5xx retry with exponential backoff (max 4). 401/403 surface as an
"API key rejected" state with a link to settings. Malformed function-call
arguments are returned to the model as a tool error so it can correct itself. A
dropped stream mid-turn is reported and the partial turn is kept, not discarded.

**Narration.** The loop emits two plain-language event kinds besides raw tool
events, so the UI can show progress without showing code: `status` (`idle`,
`thinking`, `working`, `waiting-approval`, `waiting-answer`, with a short label)
and `activity` (one per tool call: phase, plain-language label, and state
`running`, `done`, `failed` or `denied`). Labels are produced by a pure
`describeCall`/`describeResult` module, are at most 80 characters, and contain
no code, so the header and activity feed never need to render raw output.

**Interrupt.** Esc aborts the in-flight request and any running Bash process tree
(SIGTERM, then SIGKILL after 2 seconds).

**Context.** A token meter shows usage against the model's window. `/compact`
(and an automatic compact at ~85% of the window) summarises older turns into one
message and keeps the last turns verbatim.

## 5. Tools

All tool inputs are zod-validated. Every result is truncated (default 30k chars)
and passed through `redact()` before returning to the model.

| Tool | Does | Default permission |
|---|---|---|
| `Read` | Read a text file with line numbers, offset/limit | Auto inside project; ask outside |
| `LS` | List a directory | Auto inside project; ask outside |
| `Glob` | Find files by pattern, sorted by mtime | Auto inside project |
| `Grep` | Regex search (ripgrep if present, JS fallback) | Auto inside project |
| `Edit` | Exact-string replace; fails if not unique unless `replace_all` | Ask (auto in Auto-edit/Auto) |
| `Write` | Create or overwrite a file; must have `Read` it first if it exists | Ask (auto in Auto-edit/Auto) |
| `Bash` | Run a shell command, cwd = project, timeout, output cap | Ask (see 6.3) |
| `TodoWrite` | Maintain the visible task checklist | Always auto (no side effects) |
| `WebFetch` | GET a URL, return text/markdown-ish content | Ask (auto in Auto) |
| `AskUser` | Ask the user a multiple-choice or free-text question | Always shown |

`Edit`/`Write` produce a unified diff for the approval card. Before any write the
old contents are snapshotted to the **checkpoint store** so `/undo` can revert the
last turn's file changes.

Project memory: if `ARC.md` exists in the project root (falling back to
`CLAUDE.md`), it is injected into the system prompt. `/init` asks the agent to
survey the project and write an `ARC.md`.

## 6. Safety (enforced in code)

Safety is a property of the main process. The model proposes, `decide()` disposes.
Nothing in the renderer or the prompts can bypass it.

### 6.1 The decision function

`decide(call, ctx) -> { verdict: "allow" | "ask" | "deny", reason }` runs on every
tool call, in this order:
1. **Hard denies** (6.2). Deny regardless of mode.
2. **Path sandbox** (6.4). Anything resolving outside the project (or allowed
   extra dirs) is "ask" for reads, "deny" for writes and edits.
3. **Mode policy** (6.5) plus user "always allow" rules saved for this project.
4. Default: ask.

A `deny` is returned to the model as a tool result explaining the refusal, so it
can choose another approach. A `deny` is never promptable; the user changes the
rule in settings or does the thing themselves.

### 6.2 Hard denies (hold in every mode, including Auto)

- Privilege escalation: `sudo`, `su`, `doas`.
- Destructive deletes: `rm -r`/`rm -rf` (or `find -delete`, `shred`) targeting `/`,
  `~`, `$HOME`, a path outside the project, or a glob that can expand to those.
- Disk/system tools: `dd`, `mkfs*`, `diskutil erase*`, `fdisk`, `launchctl` writes,
  `shutdown`, `reboot`, `kill -9 -1`.
- Remote code execution patterns: `curl|wget ... | sh/bash/zsh/python`, `eval` of
  fetched content.
- Force-push: `git push --force`, `-f` and `--force-with-lease` to any remote.
  (`git reset --hard` and `git clean -fd` are *ask* in every mode except Auto,
  where they run under the OS sandbox.)
- Writes (any tool, any redirect) to: `~/.ssh`, `~/.aws`, `~/.config/gcloud`,
  `~/Library/Keychains`, `/etc`, `/System`, `/Library`, shell rc files
  (`~/.zshrc`, `~/.bash_profile`, ...), and ARC's own settings/secrets/audit files.
- Reads of private key material and credential files (`id_rsa`, `*.pem` private
  keys, `~/.aws/credentials`, ARC's secrets store) are *ask* with a loud warning.
- Fork bombs and similar (`:(){ :|:& };:`).

### 6.3 Bash handling

- The command string is parsed into segments on `;`, `&&`, `||`, `|`, `&`,
  newlines, `$(...)` and backticks. **Every** segment is checked against 6.2;
  one denied segment denies the whole command.
- A small allow-list of read-only commands (`ls`, `cat`, `pwd`, `echo`, `head`,
  `tail`, `wc`, `which`, `git status|diff|log|show|branch`, `node -v`, ...) with no
  redirects and no substitutions is auto-allowed even in Ask mode.
- Anything the parser cannot confidently understand (unbalanced quotes, `eval`,
  `source`, heredoc tricks, here-strings into interpreters) is "ask" in Ask and
  Auto-edit, and in Auto relies on the OS sandbox below.
- Env scrubbing: the child process gets a minimal environment. API keys and cloud
  credentials (`GOOGLE_*`, `GEMINI_*`, `AWS_*`, `*_TOKEN`, `*_KEY`, ARC's own) are
  removed.
- Limits: default timeout 120s (max 600s), output cap 30k chars, the whole process
  group is killed on timeout or Stop.
- **OS sandbox in Auto mode.** Bash runs under macOS `sandbox-exec` with a profile
  that allows reads broadly but **writes only under the project root and the OS
  temp dir**. This is a real kernel-level boundary, which a regex guard is not.
  If `sandbox-exec` is unavailable, Auto mode degrades Bash to "ask" and says so.

Honest limit: the command parser is best-effort. It catches the common dangerous
shapes and nudges everything unclear to "ask", but it is not a proof. The OS
sandbox in Auto mode is what makes unattended shell use defensible.

### 6.4 Path sandbox

File tools resolve `realpath` (following symlinks) of the target, and for new
files the realpath of the nearest existing parent. The result must stay under the
project root or a user-approved extra directory. `..` escapes, symlink escapes and
case tricks on APFS are covered by test cases.

### 6.5 Permission modes

| Mode | Reads in project | Edit/Write in project | Bash | WebFetch |
|---|---|---|---|---|
| **Ask** (default) | auto | ask | read-only allow-list auto, else ask | ask |
| **Auto-edit** | auto | auto | read-only allow-list auto, else ask | ask |
| **Auto** | auto | auto | auto, under OS sandbox | auto (public hosts only) |

Hard denies apply in all three. Switching to Auto from settings requires a
confirmation that names what changes. A persistent mode badge in the top bar
shows the current mode (Auto is visually loud). `Shift+Tab` cycles modes; the
Auto step re-confirms.

Ask-mode prompts offer **Allow once**, **Always allow this** (saves a scoped rule,
e.g. a command prefix like `npm test`, to the project's ARC settings; never for
anything in 6.2), and **Deny** (with an optional note sent back to the model).

### 6.6 Other protections

- **Secrets.** The API key is stored with Electron `safeStorage` (macOS Keychain
  backed), never in plain settings, never in the renderer after entry, never in
  logs. `redact()` strips the key and common secret shapes (`AIza...`, `sk-...`,
  PEM blocks, `Bearer ...`) from tool output before it goes to the model and from
  the audit log.
- **Prompt injection.** Tool output, file contents and web pages are wrapped as
  untrusted data in the history with a standing instruction that they never
  change permissions or instructions. This is defence in depth only: the real
  protection is that injected instructions still hit `decide()`.
- **WebFetch SSRF.** http(s) only, DNS-resolved IPs must be public (no loopback,
  link-local, RFC1918, cloud metadata `169.254.169.254`), redirects re-checked,
  size and time capped.
- **Audit log.** Append-only JSONL per session: every tool call, verdict, reason,
  who approved (user/rule/auto), and truncated redacted args. Viewable from the
  app, never sent anywhere.
- **Budgets.** Max loop steps per turn, max tokens per turn and per Autopilot run,
  and a visible kill switch (Stop button, Esc, menu item, global shortcut).
- **Electron hardening.** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, strict CSP (`default-src 'self'`; no remote scripts or
  styles), `webSecurity` on, navigation and `window.open` blocked, `setWindowOpenHandler`
  routes links to the system browser after a confirm, IPC handlers validate every
  payload with zod and check `event.senderFrame` origin.

## 7. The prompter

A second Gemini agent that generates **creative next-step prompts** for the coder.
It sees the project summary (`ARC.md`, file tree, git status), the recent
transcript and the user's stated goal. It proposes things like "add keyboard
shortcuts", "write tests for the parser", "the error handling is rough, tighten
it". Those are sent to the main agent as ordinary user messages.

**It has no tools.** It can only return text, so it cannot touch the laptop.
Everything it causes still goes through the coder's `decide()`.

**Output contract.** A JSON array of exactly 3 items validated with zod:
`{ title, prompt, kind }`, `kind` in `feature | fix | test | refactor | polish | wild`.
At least one is `wild` (a lateral, unexpected idea). It runs at higher
temperature than the coder. Invalid JSON is retried once, then dropped silently
(suggestions are optional, never an error state).

**Modes** (settings, and `/spark`):

| Mode | Behaviour |
|---|---|
| **Off** | Prompter never runs. |
| **Suggest** (default) | After each finished turn, 3 chips appear above the composer. Click to send, edit before sending, or ignore. |
| **Autopilot** | The top suggestion is sent automatically after each finished turn. |

**Autopilot limits.** Round cap (default 5), token budget, de-duplication against
earlier prompts (a repeated prompt ends the run), and an always-visible Stop that
ends the run and aborts the current turn. Autopilot **pauses** when the coder
asks the user a question or a permission prompt is waiting (Ask/Auto-edit
modes), and resumes after the answer. It never raises the permission mode.

**Also in the empty state:** before any conversation, the prompter proposes
starter prompts from the project itself (so a fresh folder gets "scaffold X"
ideas and an existing repo gets "find and fix the flakiest test").

## 8. Claude-Code-style UX

**Principle: a bot that shows progress, not code.** The default view is calm and
reads like a colleague reporting what it is doing. Raw code, diffs and command
output exist but stay collapsed behind "Details" until the user asks for them.

### 8.1 Layout

- **Left sidebar** (collapsible, Cmd+B): project switcher and session list.
- **Centre:** one conversation column (about 760px wide) with generous whitespace.
- **Bottom:** the composer, pinned, with a slim status line beneath it (mode chip,
  model chip, context meter).
- **No right sidebar.** Everything that would live there (plan, changed files,
  session info) lives in the header.

### 8.2 Header (in-window, slim, 52px)

- **Left:** sidebar toggle, project name and git branch.
- **Centre, the progress pill:** one line of plain language saying what the agent
  is doing right now ("Reading the project", "Editing 3 files", "Running the
  tests", "Waiting for you"), a live dot, and a thin progress bar fed by the todo
  list ("3 of 7"). Click it to open the **Plan** popover (the todo list).
- **Right:** **Changes** button (file count; popover lists files with added and
  removed line counts, review and Undo), **Mode** chip (`ASK`, `AUTO-EDIT`, `AUTO`;
  click to switch, Auto asks for confirmation), **Spark** button (prompter ideas),
  settings.

### 8.3 Transcript: activity first, details on demand

- The assistant's chat text is short and plain. The system prompt tells the model
  to report progress in a sentence or two and not to paste code or command output
  into chat unless the user asks.
- Between messages an **activity feed** shows each tool call as one plain-language
  line with a state icon (running, done, failed, denied; SVG icons, no emoji):
  "Read 6 files", "Edited `src/app.ts`", "Ran the tests: passed". Consecutive
  reads and searches group into one line.
- Clicking an item expands **Details**: tool name, arguments, output (the AIVEN
  Terminal component for Bash) and the diff for edits. A global "Show details"
  toggle (Cmd+Shift+D) expands everything.
- **Approval cards** ask in plain language ("Run the tests?", "Edit 2 files?") with
  the three buttons from 6.5. Safety exception to the clean look: a Bash approval
  always shows the exact command on one line (truncated, expandable), because the
  user is authorising that command. Edit and Write approvals show file names and a
  "View changes" expander.

### 8.4 Other behaviour

- **Composer:** multiline, Enter sends, Shift+Enter newline, history with Up/Down.
- **Streaming transcript:** markdown rendering, incremental.
- **Slash commands** with autocomplete: `/help`, `/clear`, `/compact`, `/init`,
  `/model`, `/mode`, `/spark`, `/undo`, `/cost`, `/resume`, `/settings`.
- **`@file` mentions:** fuzzy path autocomplete from the project; the file's
  contents are attached to that message (subject to the path sandbox).
- **`!` prefix:** run a shell command directly, going through the same
  `decide()` and OS sandbox as the agent's Bash.
- **Sessions:** persisted per project as JSONL, `/resume` picker, auto-titled.
- **Keyboard:** Esc interrupts, Shift+Tab cycles mode, Cmd+K command palette,
  Cmd+B sidebar, Cmd+Shift+D details, Cmd+, settings, Cmd+O open project. The
  macOS menu bar keeps only the standard items (app, Edit roles, Window), so
  copy and paste work.
- **Settings screen** (Cmd+, or `/settings`), laid out like Claude Code's: a left
  list of sections and a pane on the right.
  - *Models:* Vertex API key (masked field, Save, Remove, Test connection; stored
    via safeStorage, never typed into a file or the source), **coder model** and
    **prompter model** (each a dropdown that defaults to `gemini-3.8-flash`, with a
    "Custom model id" entry for anything else).
  - *Permissions:* default permission mode, extra allowed directories, the list of
    saved "always allow" rules with a remove button.
  - *Prompter:* Off / Suggest / Autopilot, round cap, token budget.
  - *Appearance:* theme (AIVEN AI dark default, AIVEN Studios light), show details
    by default.
  - *Advanced:* step cap, per-turn token budget, context window size, audit log
    viewer.
- **Run gate:** with no API key saved, ARC cannot run. The composer is disabled
  and shows "Add your Vertex API key in Settings to start", Spark and Autopilot
  are off, and the backend refuses `send`, `spark` and `autopilot` with a
  `no-api-key` error. Saving a key unlocks it immediately, with no restart.
- **First run:** pick a project folder, paste the API key, "test connection"
  makes one tiny request and reports the result.

## 9. Visual identity (from the AIVEN design system, AI theme)

ARC adopts the AIVEN AI theme directly, ported from its `tokens.json` into
`src/renderer/theme/tokens.css` and a component stylesheet (class names keep the
`av-` prefix so they map 1:1 to the design system).

**Tokens used (AI theme):**

| Token | Value | Use in ARC |
|---|---|---|
| `surface` | `#020203` | App background |
| `surface-panel` | `rgba(15,15,20,.4)` + 20px blur | Glass panels (sidebar, cards) |
| `surface-deep` | `rgba(0,0,0,.5)` | Inset blocks (tool cards, terminal) |
| `ink` / `ink-muted` | `#f0f0f5` / `#8a8a9e` | Text |
| `border` | `rgba(255,255,255,.08)` | Hairlines |
| `accent` | `#ff6b00` (black text on it) | Primary action only |
| `signal` | `#00e5ff` | Labels, active states, numbers |
| `signal-soft` | `rgba(0,229,255,.1)` | Selected chip/tab fill |
| `success` / `warning` / `danger` | `#00ff88` / `#ffbb33` / `#ff4444` | Status, diffs, mode badge |
| Radii | 8 / 12 / 16 / 24 px | buttons+tabs / inputs / panels / hero |
| Type | Inter 400/600/800, JetBrains Mono | UI / code, labels, eyebrows |

**Mapping to ARC:**
- Window: macOS `hiddenInset` title bar, ambient glow (orange top-left, blue
  bottom-right, very low opacity) behind glass panels, because the AI theme's glass
  needs something to blur.
- Header (`av-nav` style, 52px, section 8.2): sidebar toggle and project on the
  left; the progress pill in the centre (`signal` live dot, mono label, thin
  `accent` progress bar); Changes, Mode (`ASK`, `AUTO-EDIT`, `AUTO`, with `AUTO`
  in danger colour) and Spark on the right. The engine badge
  (`ENGINE // gemini-3.8-flash`) and token meter sit in the composer status line.
- Premium feel: native vibrancy behind the sidebar, 160 to 240 ms ease-out
  motion (popovers spring in, activity items collapse smoothly), a streaming
  caret, sticky-bottom autoscroll that pauses when the user scrolls up, tabular
  numerals for counters, `signal` focus rings, a Cmd+K command palette, an empty
  state with Spark ideas, and window size and position restored on launch. No
  window flash: the window stays hidden until ready and paints `surface` first.
- Labels use the system voice: `ARC // SESSION`, `TOOL // BASH`,
  `01 // TODO`, `SPARK // 3 IDEAS`. Mono, uppercase, `signal` colour.
- Tool cards: `av-panel--deep` with a mono label row and status badge.
- Bash output: the `Terminal` component (it is always dark by design).
- Suggestion chips: the AI `Tabs` style (hairline, `signal-soft` when selected).
- Approval card: glass panel, one orange primary ("Allow once"), outline
  secondary ("Deny"), tertiary text ("Always allow this").
- Copy: direct, short, no exclamation marks, no emoji in the UI. "All systems
  nominal." style empty and success states.
- Reduced motion respected (the live dot and any marquee stop).

**Logo and icon.** An ARC mark in the AIVEN idiom: an orange arc and a cyan arc
on a dark rounded square, built from the same rounded blocks as the AIVEN cover.
Delivered as SVG plus a 1024px PNG for `.icns`. The wordmark is Inter 800,
tight tracking, `ARC` with `AIVEN` as a small mono eyebrow above it.

**Accessibility.** Text on orange is black (7.4:1). `ink-muted` on the AI ground
is 6.1:1. `brand-blue` is decoration only (3.2:1). Focus rings use `signal`.

## 10. Data and storage

- Settings: `~/Library/Application Support/AIVEN ARC/settings.json` (no secrets).
- API key: Electron `safeStorage`-encrypted blob alongside settings.
- Sessions: `.../sessions/<project-hash>/<id>.jsonl`.
- Checkpoints: `.../checkpoints/<session-id>/` (pre-edit file snapshots).
- Audit log: `.../audit/<session-id>.jsonl`.
- Per-project rules ("always allow this"): `<project>/.arc/settings.json`, which the
  agent's own tools cannot write (hard deny on `.arc/`).

## 11. Testing

- **Unit (vitest) on `src/main`:** `decide()` truth tables per mode, `bashGuard`
  with a corpus of dangerous and benign commands (including compound, quoted and
  substitution cases), `pathSandbox` (traversal, symlinks), `redact`, `ssrf`,
  every tool against a temp dir, `Edit` uniqueness rules, checkpoint and `/undo`.
- **Agent loop against a fake Vertex server:** scripted SSE streams covering text
  only, one tool call, parallel calls, denied call, malformed arguments, 429
  retry, 401, mid-stream disconnect, step cap, Stop. Prompter JSON validity,
  retry and Autopilot caps and pause.
- **Renderer:** component tests (vitest + jsdom) for tool cards, approval card,
  chips, mode badge, slash autocomplete.
- **Smoke:** an Electron launch test if the sandbox here can run Electron;
  otherwise documented as a manual check.
- **Not testable in this environment (Linux):** the real `.app` build, `sandbox-exec`
  behaviour, Keychain-backed `safeStorage`, and the real Vertex endpoint with
  Matt's key. These get a short manual checklist in the README, and I will say
  plainly which parts were verified here and which were not.

## 12. Risks and open items

- **Model id.** `gemini-3.8-flash` is the default but unverified; if Vertex names
  it differently the settings field fixes it. The "test connection" button is the
  first thing to run.
- **Auth header.** The client sends the key as `x-goog-api-key`. If the endpoint
  rejects that form, the "test connection" step falls back to `?key=` and the
  client strips the key from any URL before logging or surfacing an error.
- **Express-mode keys.** These may be restricted in which models/regions they can
  call. If the key is rejected for the model, the fallback is full Vertex auth
  (project id + region + `gcloud` ADC token), a clean follow-up since the client
  already isolates auth in one function.
- **`sandbox-exec`** is deprecated by Apple but still functional. If a future
  macOS drops it, Auto mode degrades Bash to "ask" (already handled).
- **Unsigned build.** A locally built `.app` runs fine on the Mac that built it.
  Sharing it with others would need signing and notarization (out of scope).
- **Auto mode is powerful by design.** The hard denies and OS sandbox reduce risk;
  they do not remove it. Projects not under version control deserve Ask mode.

## 13. Build order (input to the implementation plan)

1. Scaffold (electron-vite, TS strict, vitest), secure window, IPC skeleton.
2. Safety core first: `pathSandbox`, `bashGuard`, `decide()`, `redact`, with tests.
3. Tools with tests.
4. Vertex client + agent loop against the fake server.
5. Renderer shell with AIVEN theme, transcript, composer, tool cards, approvals.
6. Sessions, checkpoints, slash commands, `@mentions`, header with progress pill,
   Plan and Changes popovers, activity feed.
7. Prompter + Autopilot.
8. Settings screen, first run, audit viewer, logo/icon, README with the manual
   checklist.
9. **Packaging as a Mac app happens last and only after Matt confirms the design
   and features are to his liking.** Until then the build stays a dev build.
