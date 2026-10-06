# AIVEN ARC

A macOS coding agent in the spirit of Claude Code, running on Google Vertex AI (Gemini). Electron and TypeScript.

**Status:** the backend is built and tested: safety layer, tools, Vertex client, agent loop, prompter, stores, secure window and IPC, plus a terminal harness. The screens (header, progress pill, settings, activity feed) come next. The `.app` is packaged last, after the design is signed off.

Design: [`docs/superpowers/specs/2026-10-06-aiven-arc-design.md`](docs/superpowers/specs/2026-10-06-aiven-arc-design.md).
Backend plan: [`docs/superpowers/plans/2026-10-06-aiven-arc-backend.md`](docs/superpowers/plans/2026-10-06-aiven-arc-backend.md).

## Try it from the terminal

You need Node 22+ and a Vertex AI API key (express mode).

```bash
npm install
ARC_API_KEY=your-key npm run arc -- --project ~/some/folder --test-connection
ARC_API_KEY=your-key npm run arc -- --project ~/some/folder --mode ask "add a README section about testing"
```

The harness prints a clean progress view (`[run]`, `[ ok]` lines and the assistant's short reply). Add `--verbose` for diffs and tool output. In `ask` mode it asks on the terminal before every edit or command, and a shell command is always shown in full.

| Flag | Meaning |
|---|---|
| `--project <dir>` | the folder the agent works in |
| `--mode ask\|auto-edit\|auto` | permission mode (default `ask`) |
| `--model <id>` | coder model id (default `gemini-3.8-flash`) |
| `--verbose` | show diffs and raw tool output |
| `--test-connection` | one tiny request, then exit |

Without `ARC_API_KEY` it refuses to run (exit code 2). The harness keeps the key in memory only.

## Develop

```bash
npm test            # unit and integration tests (vitest)
npm run typecheck
npm run build       # electron-vite build
```

## How it fits together

| Area | Where |
|---|---|
| Permission engine (`decide`), bash guard, path sandbox, SSRF guard, redaction | `src/main/safety/` |
| Tools: Read, LS, Glob, Grep, Edit, Write, Bash, TodoWrite, WebFetch, AskUser | `src/main/tools/` |
| Vertex streaming client (retries, SSE, thought signatures) | `src/main/vertex/` |
| Agent loop, compaction, plain-language narration | `src/main/agent/` |
| Prompter (Spark) and Autopilot | `src/main/prompter/` |
| Settings, encrypted key, sessions, audit log, checkpoints, saved rules | `src/main/store/` |
| `BackendApp` (what the UI drives), IPC handlers, window config | `src/main/backend.ts`, `ipcHandlers.ts`, `windowConfig.ts` |
| Electron glue (window, IPC registration, `arc://` renderer protocol, preload) | `src/main/index.ts`, `window.ts`, `ipc.ts`, `src/preload/` |

The page can only reach the backend through a fixed list of IPC channels, each validated with zod and checked against the sender's origin.

## Safety, in short

- Every tool call goes through `decide()` in the main process. Hard denies (for example `sudo`, `rm -rf` outside the project, `curl | sh`, force-push, writes to `~/.ssh` or shell rc files) hold in every mode. A deny is never promptable.
- `ask` (default), `auto-edit`, and `auto` modes. A new session never starts in Auto unless you set it as the default in Settings.
- In Auto mode, Bash runs under macOS `sandbox-exec` so writes stay in the project and the temp folder. Without `sandbox-exec`, Auto falls back to asking.
- The API key is stored through the OS keychain (Electron `safeStorage`), never in settings or logs, and is stripped from anything sent to the model.
- ARC cannot run without a saved API key.

## Checklist for your Mac (things that cannot be tested on Linux)

1. `npm install`, then `--test-connection` with your real key and model. If the model name is rejected, change it with `--model`.
2. Run a Write task in `ask` mode, answer `y`, and confirm the file appears.
3. In `auto` mode confirm `sudo ls` and `rm -rf ~` are refused.
4. In `auto` mode confirm a command that writes outside the project is blocked by `sandbox-exec` (for example `touch ~/arc-should-fail`).
5. Once the UI exists: confirm the key is not in `~/Library/Application Support/AIVEN ARC/settings.json`, and that vibrancy and the window look right.

**Verified on Linux:** all logic (safety, tools, Vertex client against a fake server, agent loop, prompter, stores, IPC, the CLI, the Electron bundle builds).
**Only verifiable on a Mac:** `sandbox-exec` enforcement, Keychain-backed `safeStorage`, APFS case rules, window vibrancy, the packaged `.app`, and the real Vertex endpoint with your key.

## Known limits

- In Auto mode `sandbox-exec` blocks writes outside the project and temp folder, so tools that write global caches (for example `~/.npm`) can fail there. Use Ask or Auto-edit for those.
- Express-mode API keys may be limited to certain models. If yours is rejected, full Vertex auth (project, region, `gcloud` token) is the planned follow-up.
- The shell command checker is best-effort. It catches the common dangerous shapes and sends anything unclear to a prompt, but it is not a proof. The OS sandbox in Auto mode is the real boundary.
