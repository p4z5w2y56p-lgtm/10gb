# Backend build: decisions, rulings and deferred items

Copied from the execution ledger (the original lives in a git-ignored folder). Every line starting `Ruling:` is a call made where the plan or spec was silent or in conflict; `Final: minor (deferred)` lines were reviewed and intentionally not fixed.

```
# SDD ledger — plan: docs/superpowers/plans/2026-10-06-aiven-arc-backend.md
Spec: docs/superpowers/specs/2026-10-06-aiven-arc-design.md (read; binding authority)
Executor: inline (native). User also asked: add UI ("other things") and creative extras after backend.
Pre-flight (shared interfaces):
- T1 types -> T5,T7,T15,T16,T17,T18: AgentEvent/ToolCall/Verdict/Approver defined once in T1; consumers import verbatim. clean.
- T2 resolveInside -> T5,T7,T11: signature consistent. clean.
- T4 classifyBash/isProtectedWrite -> T5: consistent. clean.
- T7 ToolContext -> T11,T12,T13,T16: consistent; T12 needs settings.bashTimeoutMs, ok.
- T10 Content/Part -> T9(unknown),T14,T16: T9 stores unknown to avoid cycle. clean.
- T15 narrate -> T16 loop: describeCall/describeResult/progressOf consumed by loop. clean.
- T16 AgentSession -> T17 Pick<AgentSession,...>: needs public `mode` getter. clean.
- T18 composeBackend -> T19: factored in T19. clean.
Task 1: complete (commits 3fd6de4..7b39c99, tests: npm test →    Duration  186ms (transform 73%, import 18%, worker 5%, tests 4%))
Task 2: complete (commits 7b39c99..0d3ef86, tests: npm test →    Duration  267ms (transform 49%, tests 33%, import 14%, worker 3%))
Task 3: complete (commits 0d3ef86..6829ca7, tests: npm test →    Duration  261ms (transform 67%, tests 18%, import 11%, worker 4%))
Task 2: Ruling: fs/promises.realpath instead of realpath.native — promises API is already native-semantics and has no .native — cost if wrong: none.
Task 4: Ruling: protected.ts also exports sensitiveReadPaths/isSensitiveRead (credential read detection); GuardContext gains optional sensitivePaths — needed so readonly Bash auto-allow cannot read ~/.ssh etc.; spec 6.2 says credential reads are "ask" — cost if wrong: one extra prompt.
User change (mid-run): Settings screen with API key + separate coder/prompter model; app not runnable without key (run gate). Folded into spec 8.4 and plan Tasks 8, 18, 19. Packaging only after user confirms design/features.
Task 4: Ruling: classifyBash tracks the working directory across cd/pushd/popd (unknown cwd makes relative targets unresolvable -> ask) and walks the whole pipeline chain for fetch-into-interpreter — found by an adversarial probe (cd ~ && rm -rf . slipped through) — cost if wrong: extra prompts for cd-heavy commands.
Task 4: complete (commits 6829ca7..2f58f9c, tests: npm test →    Duration  405ms (transform 61%, tests 25%, import 10%, worker 4%))
Task 5: complete (commits 2f58f9c..915dc3b, tests: npm test →    Duration  455ms (transform 46%, tests 39%, import 12%, worker 3%))
Task 6: complete (commits 915dc3b..635395b, tests: npm test →    Duration  640ms (transform 47%, tests 39%, import 12%, worker 3%))
User change (mid-run): every screen/page must be polished in the AIVEN theme (not just the chat). Added to spec section 9; applies to the UI plan.
Task 7: Ruling: Read never refuses large files; it streams only the requested/default 2000-line window and appends a "[more lines follow ...]" note — plan text said "refuse >2MB unless offset/limit" but its own test says the default window is returned — cost if wrong: none.
Task 7: Ruling: Checkpointer interface and FunctionDeclaration are defined in tools/registry.ts (CheckpointStore/vertex types are later tasks and will satisfy/re-export them) — avoids a forward dependency — cost if wrong: one import move.
Task 7: complete (commits 635395b..094a6b9, tests: npm test →    Duration  793ms (tests 46%, transform 35%, import 17%, worker 2%))
Task 8: Ruling: added shared atomicWrite helper (store/fsutil.ts), ProjectRules.remove (settings UI lists/removes saved rules), and Settings.showDetails (spec 8.4 'show details by default') — small additions the UI needs — cost if wrong: none.
Task 8: complete (commits 094a6b9..86da113, tests: npm test →              at least ~310ms faster with isolate: false — reuses workers across files instead of one per file)
Task 9: Ruling: CheckpointStore.canUndo() added (UI Changes popover needs it); session ids are '<projectHash8>-<ts36>-<rand>' and validated against a strict regex before any path join (ids arrive over IPC) — cost if wrong: none.
Task 9: complete (commits 86da113..e24f899, tests: npm test →              at least ~427ms faster with isolate: false — reuses workers across files instead of one per file)
Task 10: Ruling: usageMetadata is cumulative in Gemini streams, so Usage takes the LAST chunk's values (plan said 'concatenate'); outputTokens = candidates + thoughts. VertexError carries optional partial GenerateResult for aborted/network failures (loop keeps the partial turn per spec 4) — cost if wrong: token meter off.
Task 10: complete (commits e24f899..6703548, tests: npm test →              at least ~505ms faster with isolate: false — reuses workers across files instead of one per file)
Task 11: complete (commits 6703548..af5699e, tests: npm test →              at least ~504ms faster with isolate: false — reuses workers across files instead of one per file)
Task 12: Ruling: Bash keeps head 9.9k + tail 19.9k of long output (plan said truncate) since the end of a build log matters most; runCommand force-resolves 500ms after SIGKILL so a process that escaped the group cannot hang the agent. Known limit: in Auto mode sandbox-exec blocks writes outside project/tmp, so tools writing global caches (e.g. ~/.npm) may fail there — documented in README task — cost if wrong: some installs need Ask mode.
Task 12: complete (commits af5699e..9f40e0b, tests: npm test →              at least ~535ms faster with isolate: false — reuses workers across files instead of one per file)
Task 13: complete (commits 9f40e0b..8b77d60, tests: npm test →              at least ~613ms faster with isolate: false — reuses workers across files instead of one per file)
Task 14: Ruling: compaction attaches the summary as a leading text part of the first kept user message instead of a separate message — keeps user/model turns alternating for Gemini; the plan's 'one summary message' intent holds. Cost if wrong: none.
Task 14: complete (commits 8b77d60..04d0766, tests: npm test →              at least ~682ms faster with isolate: false — reuses workers across files instead of one per file)
Task 15: Ruling: LS is phase 'searching' (not 'reading') so 'Read N files' groups count only Read calls; Glob label 'Finding files'. Cost if wrong: label wording.
Task 15: complete (commits 04d0766..6b0885b, tests: npm test →              at least ~709ms faster with isolate: false — reuses workers across files instead of one per file)
Task 16: Ruling: added previewChange()/applyEdit() to tools/fsWrite.ts (diff for approval cards without writing) and exported tidyLabel from narrate.ts — spec 8.3 needs a diff on Edit/Write approval; cost if wrong: none.
Task 16: Ruling: "always allow" saves a rule only for Bash/Edit/Write/WebFetch, never Read (a tool-wide Read rule would unlock reads anywhere outside the project) — cost if wrong: Read-outside prompts repeat.
Task 16: Ruling: a safety-stopped reply keeps only its text parts in history (a functionCall we cannot answer would make the next request invalid); aborted/dropped streams keep partial text only; every functionCall in history is always answered, even on stop.
Task 16: Ruling: turnTokenBudget is checked at the top of each loop iteration against the sum of per-request totalTokens, so a final text-only reply that overshoots still ends 'done'.
Task 16: complete (commits 6b0885b..93b8116, tests: npm test →              at least ~724ms faster with isolate: false — reuses workers across files instead of one per file)
Task 17: Ruling: summarizeProject tree is 'depth 2' = up to three path segments (top level plus two nested levels) so src/main/agent/ is visible; added transcriptOf() (chat text only, tail kept) for the suggest() closure; generateSuggestions swallows ALL failures to [] since suggestions are optional (spec 7). Cost if wrong: none.
Task 17: complete (commits 93b8116..1e51d08, tests: npm test →              at least ~797ms faster with isolate: false — reuses workers across files instead of one per file)
Task 18: Ruling: BackendApp (key/settings/project/agent/approvals/prompter/autopilot) lives in pure-Node src/main/backend.ts and IPC validation in src/main/ipcHandlers.ts; window/menu/origin helpers in src/main/windowConfig.ts; window.ts/ipc.ts/index.ts/preload are thin Electron glue — so the run gate, key change and two-model split are unit-tested on Linux. This also covers Task 19's "compose" factoring (CLI will reuse BackendApp). Cost if wrong: none.
Task 18: Ruling: shared/channels.ts holds channel names (no zod) so the sandboxed preload stays 1.3 kB; shared/ipc.ts holds the zod schemas; AgentEvent gained question/suggestions/autopilot/mode/changes events the UI needs.
Task 18: Ruling: settings:save is a strict schema (unknown keys rejected) so an API key can never be smuggled into settings.json; setMode is session-only and never changes the saved default mode, so a new session cannot silently start in Auto.
Task 18: Ruling: renderer is served from arc://app/ (custom protocol, strict CSP header, path-traversal guard) and sender trust is judged on scheme+host of event.senderFrame.url; dev uses ELECTRON_RENDERER_URL origin. Electron glue is verified by typecheck+build only (no Electron runtime here) — manual Mac check listed in README.
Task 18: complete (commits 1e51d08..72972fc, tests: npm test →              at least ~938ms faster with isolate: false — reuses workers across files instead of one per file)
Task 19: Ruling: CLI reads the key from ARC_API_KEY only (the app's safeStorage key is not readable outside Electron) and keeps it in memory via a new injectable KeyStore (BackendApp deps.keyStore); plan said "or the app's stored key" — impossible without Electron. Added hidden --vertex-url/--data-dir flags for tests. Cost if wrong: none.
Task 19: BackendApp itself was composed in Task 18, so Task 19 adds the CLI, KeyStore, e2e test and README only.
Task 19: complete (commits 72972fc..47965a0, tests: npm test →              at least ~1000ms faster with isolate: false — reuses workers across files instead of one per file)
All 19 tasks complete (596 tests). Final review: fresh reviewer (opus subagent) a2e4b4c9cef2e679d.
Final: re-graded findings. FIX PASS (Critical/Important by effect): #1 decide()/saveRule throw leaves an unanswered functionCall and breaks the session permanently; #2 case-insensitive APFS dodges the .arc/ and protected-path denies; #3 Auto sandbox allows writes to <root>/.arc (kernel guarantee missing); #4 repo-shipped .arc/settings.json rules auto-approve in a cloned repo; #5 (re-graded up) "always allow" for interpreter prefixes (python3 -c) and redirect-blind rule matching; #6 (re-graded up) Edit silently corrupts non-UTF-8 files; #7 (re-graded up) Stop is ignored for up to 15s during 429/5xx backoff; #9a (re-graded up) a FIFO in the project hangs Read and Stop cannot interrupt.
Final: own dedicated bash-guard bypass pass (reviewer declined to judge): fix assignment/wrapper-prefixed "readonly" (PATH=/tmp/x ls), unresolvable ~user args treated as non-sensitive, uniq/tree/sort --compress-program writers, brace-expansion building sensitive paths, curl/wget/tar/unzip/rsync writing into protected dirs, missing protected paths (LaunchAgents, login rc files, gitconfig), symlink-to-credentials via readonly Bash.
Final: Ruling: rules move out of the project to <dataDir>/rules/<projectHash>.json (spec 10 said <project>/.arc/settings.json) — a cloned repo must not be able to pre-approve commands; spec success criterion 2 outranks portability; cost if wrong: rules are not shared with teammates.
Final: Ruling: sandbox also denies writes to <root>/.git/hooks (hooks run later outside the sandbox); .git/config stays writable so git remote/branch -u keep working — cost if wrong: a sandboxed command could plant a git config alias/fsmonitor; accepted, Auto mode only.
Final: minor (deferred): Edit/Write/WebFetch "always allow" rules are tool-wide, not path/host scoped (effect equals auto-edit inside the project).
Final: minor (deferred): window.open opens http(s) externally without a confirm dialog (spec 6.6 says after a confirm) — Electron-only, untestable here; do in the UI plan.
Final: minor (deferred): Read buffers a whole single-line huge file in readline before truncating to 2000 chars.
Final: minor (deferred): Autopilot token budget excludes the prompter's own tokens.
Final: Declined to judge by reviewer: concurrency TOCTOU between decide/resolveInside and atomicWrite; sandbox-exec enforcement; Keychain; APFS realpath case behaviour; Electron runtime — ruling: remain on the Mac checklist (README) — cost if wrong: a Mac-only behaviour differs.
Process: the reviewer's throwaway probe file was swept into commit 23c35ed by `git add -A`; deleted in the fix commit and its repros kept as regression tests.
Final: fixed #1 decide()/saveRule throw — pathSandbox returns ok:false instead of throwing, runCall wrapped, saveRule guarded; tests: 'a path that cannot be resolved is refused...', 'a symlink loop...', 'a failing rule save...', 'an unexpected error while running one call...', pathSandbox 'never throws' RED→GREEN, suite 658/658.
Final: fixed #2 case-insensitive protected paths — isProtectedWrite/isSensitiveRead take caseInsensitive, wired through decide, bashGuard, fsWrite, ToolContext; tests: permissions 'case-insensitive volumes', bashGuard 'case-insensitive volumes', fsWrite 'protected paths on case-insensitive volumes' RED→GREEN.
Final: fixed #3 sandbox profile re-denies <root>/.arc and <root>/.git/hooks after the allow; test: sandboxExec 're-denies writes to .arc and .git/hooks' RED→GREEN.
Final: fixed #4 rules stored in <dataDir>/rules/<hash>.json; test: ProjectRules 'ignores a rules file shipped inside the project', backend 'a rules file shipped inside a cloned project does not pre-approve anything' RED→GREEN.
Final: fixed #5 rule scope — isRuleEligible (no interpreters/wrappers), redirect-aware matching; tests: permissions 'rule scope', loop '"always allow" is not saved for an interpreter prefix' RED→GREEN.
Final: fixed #6 Edit refuses non-UTF-8 (strict decode round-trip); tests: fsWrite 'Edit and non-UTF-8 files' RED→GREEN.
Final: fixed #7 backoff sleep is abortable; test: client 'Stop during backoff' RED→GREEN.
Final: fixed #9a Read refuses non-regular files (FIFO); test: fsRead 'Read and special files' RED→GREEN.
Final: fixed own bash-guard pass — assignment/wrapper-prefixed readonly, unresolvable args, uniq/tree/file -C/sort --compress-program/rg --hostname-bin, brace expansion, WRITERS (curl/wget/tar/unzip/rsync/scp/ditto), new protected paths (LaunchAgents, login rc, gitconfig), symlink-to-credentials via readonly Bash (decideBash realpath check, mutation-verified); tests: bashGuard 'readonly cannot be faked', 'writers into protected directories', permissions 'readonly Bash and symlinks to credentials' RED→GREEN. Suite 658/658, typecheck clean.
Ruling: unresolvable read paths (ELOOP, ENAMETOOLONG) are denied by decideRead rather than asked about — nothing sensible to approve; cost if wrong: none.
```
