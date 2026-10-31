# Progress

Spec: `docs/spec.md`. Plan: `docs/plan.md`. Parked work: spec §23.

**Current focus:** Step 2, Checker (branch `step-2` from `develop`). Start with `/plan-step`.

## Steps

| Step | What | Branch | ✓ |
|---|---|---|---|
| 0 | Facts | `step-0` | ☑ |
| 1 | Test kit | `step-1` | ☑ |
| 2 | Checker | `step-2` | ☐ |
| 3 | Core hiding + Audit 1 | `step-3` | ☐ |
| 4 | Rest of the main lock | `step-4` | ☐ |
| 5 | Backup lock + tuning | `step-5` | ☐ |
| 6 | Release + Audit 2 | `step-6` | ☐ |

"Done when" for each step is in `docs/plan.md`, "The 7 steps".

## Known issues

Bugs, unfinished bits and open questions. Features we chose not to build go in spec §23.

- D-005: the owner's reason for `on_check_failure: allow` was never recorded.
- Probe tests (`claude plugin test`) don't run in CI. The pinned `claude` now makes that possible; it wasn't added in step 1.
- `claude plugin test` (2.1.316): a `turn.step` stream's `.result` resolves `undefined` even when the step beneath answers, contrary to its doc (`HookStream.result`, `claude-code.d.ts:5383`). Probe tests check the hold through its effects instead. Report it upstream.
- Self-protection (§17) should probably also cover Claude Code's own settings files: a prompt injection could make Claude write `disableAllHooks` into `.claude/settings.local.json` (check 0.14). Decide in step 4.
- The desktop app's probe log had no `start` line, so its Claude Code version wasn't recorded. Check before release.
- The kit's no-network proof is strongest on Linux, where nothing can leave (loopback-only namespace). On Windows and macOS the proxy trap only sees traffic that honours proxy settings.
- The macOS Keychain call at 1 MB was refused before it ran, and the check doesn't record why. Log the cause when the store limit is measured.
- The probe's `turn.step` hold has no `.catch`, so it fails open. Fine for a test tool; the product's refusing hooks must have one (R-03).
- Check 0.6: a `.catch` that spun the CPU for 2 s still had its answer used, although the documented grace is 1 s. Don't rely on the grace either way.
- **Decide before step 3:** spec §8.1 and D-023 assume one OS store item holds the whole list of secrets. Check 0.4 shows that fails on macOS and Linux: only about 1 KB is proven safe (exact limit unknown, between 1 KB and 64 KB), and macOS only goes higher by putting secrets on a command line. 10,000 secrets won't fit. §8.1 is unchanged until the owner decides.
- The kit's `clean` mode has only run against the stand-in, because no hiding tool exists yet. Step 3 is its first real run.
- Plan step 6 now holds the optional real-API run (moved from step 1, D-027).
- Step 2 must list `tools/test-sets/whole-keys.ts` and the key shapes in `tests/fakes.test.ts` in `THIRD_PARTY_LICENSES` when it creates that file (decision log, Minor).
- Spec §22 doesn't list the `.txt` files in `projects/`, which hold what looks like a saved copy of large command output. Step 3 measures whether it stays raw with the tool on.
- CI's password store and Node steps print evidence but can't fail the job. A change in them only shows if someone reads the log.
- Killing the kit mid-run, or using `--keep`, leaves a scratch folder holding that run's fakes.

## Gotchas

Platform and tooling facts learned so far (from the old `lessons.md`).

- Rows loaded by `/resume` don't pass through `session.append`, so a resumed session can resend raw secrets (spec §6.1, check 0.3).
- A mod can't change messages already sent. Registering a secret mid-session can't un-send it, so warn and suggest rotating (§6.2).
- Hooks fail **open**: a throw, a wrong shape or going over 10 s means the hook is skipped. Refusing hooks need `.catch` (1 s grace) to fail closed (R-03).
- Under `allowManagedHooksOnly`, a project's `disableAllHooks`, `--safe-mode`, `--bare` or `CLAUDE_CODE_SIMPLE=1`, a user-tier plugin loads no hooks and user settings hooks don't run. A plain markdown command still loads (checks 0.7, 0.8, 0.14).
- The mod runtime has no Node or DOM; everything goes through `$`. A mod and its imports must sit inside the plugin folder, so `src/checker/` gets copied or bundled into `plugin/` (step 3).
- Git for Windows sets `core.autocrlf=true`; `.gitattributes` forces LF. Test CRLF on purpose with fixtures built in the test. Count line endings with Node or `git ls-files --eol`, not `grep`.
- `claude plugin test`: a test's own `session.append` hook that answers without `next` gets skipped, so record rows with `mock.session(on)`. A hook for a `$` call that throws makes the plugin's call reject, which is how to simulate a failing write.
- `claude -p`: put the prompt before `--allowedTools`, which takes several values and swallows what follows.
- `$.fs.write` replaces the whole file.
- A mod may pass `$` only to functions declared or imported at the top of a file (not to one passed in as a parameter), and may register each event only once without a matcher. Both are load errors, which `claude plugin validate` and the tests show; type errors only show with `tsc` and the tsconfig from the types file header.
- The plugin runtime's `crypto.subtle` has `digest` only: no AES (check 0.4).
- Hook time: waits on `$`/`next` don't count; `$.clock.sleep` does; CPU-bound code is cut off at about 6 s (check 0.6).
- Test runs against a mock: use `ANTHROPIC_BASE_URL`, a dummy `ANTHROPIC_API_KEY` and a separate `CLAUDE_CONFIG_DIR`, never `--bare` (it loads no plugin hooks). Without a separate config dir, runs leave records in your real `~/.claude`.
- JavaScript `String.replace` treats `$&`, `` $` `` and `$'` in the replacement as patterns. When a replacement holds Markdown with `$`, pass a function: `t.replace(from, () => to)`.
- The VS Code extension runs its own Claude Code version (2.1.314 next to CLI 2.1.316).
- When Claude Code loads a mod (VS Code, desktop app, an interactive session), it writes `tsconfig.json` and `.claude-plugin/types/` into the mod folder. Delete them after a test run; the types folder is gitignored, the `tsconfig.json` is not.
- When a skill asks for plan approval, the answers to design questions are not approval. Ask for approval explicitly.
- `npm i --ignore-scripts @anthropic-ai/claude-code` leaves `bin/claude` as a stub. The real binary is in the platform package, for example `claude-code-win32-x64/claude.exe`, and runs directly.
- Connected (MCP) tools are deferred: they aren't in the request's tool list, but a scripted call by name works.
- Project `CLAUDE.md` text reaches the model in `messages`, not `system`. `messages` can also hold `system`-role entries.
- Without `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `claude -p` tries `api.anthropic.com:443` even with `ANTHROPIC_BASE_URL` set. Marketplace auto-install has its own switch (docs: env-vars).
- OS password store limits (check 0.4): `secret-tool` and `security -i` take about 1 KB safely, not 64 KB. DPAPI took 1 MB.
- A mutation check means nothing unless the unmutated tests pass first. Run it with a control, on its own, and with its own temp folder: a mutant that keeps scratch folders fills the real one.
- In a shell chain, a `sed` that matches nothing still succeeds. Check a test run's result, not the commands before it, before committing.

## Session notes

Newest last, 3–5 lines each: what exists now and what the next session needs.

### 2026-10-31: setup and part 0.0
- npm + `package-lock.json` (dev deps only: `typescript@7.0.2`, `@types/node@24.19.2`); `node:test` runs `.ts` directly on Node 24 (`.nvmrc`); `tsc -p .` typechecks only (`erasableSyntaxOnly`: no enums or namespaces). `LICENSE`, `NOTICE`, `.gitattributes`, 3-OS CI with SHA-pinned actions, guard tests in `tests/repo-setup.test.ts`.
- Remote: `origin` = https://github.com/Mrinanka/agent-redact.git; `develop` is the default branch. CI run 41203340159 green on all 3 OSes.
- The root tsconfig excludes `plugin/` and `experiments/`. Relative imports in tests use the `.ts` extension.

### 2026-10-31: part 0.A (probe)
- `experiments/step0-probe/` writes one JSON line per `session.append` row (metadata only) to `<cwd>/.step0-probe/<session id>.jsonl` (D-016, D-017). 10 tests under `claude plugin test`, including a planted fake that must appear in no write.
- Verified on 2.1.316, Windows, `claude -p` only: 17 rows over 5 doors.

### 2026-10-31: workflow slimmed
- 44 parts became 7 steps; 7 commands became 3 (`/plan-step`, `/verify`, `/ship`); 2 audits (D-018). Scope cuts parked in spec §23 (D-019). `lessons.md` folded into "Gotchas" above.

### 2026-10-31: step 0 checks
- `experiments/step0-mock/`: local mock API (`server.ts`), driver (`run.ts`, scenarios in `scenarios.ts`), hand-run helper (`manual.ts`). `experiments/step0-settings-hooks/hook.mjs`: settings hook for 0.8/0.9/0.13/0.14. The probe gained opt-in checks (`on-<name>` markers) and a markdown command.
- All checks 0.1–0.14 recorded in findings (0.4 and 0.13 partly, Windows only). Spec updated (D-022); secret store now uses the OS password store (D-023, supersedes D-004).
- Mods: `$` may only be passed to functions declared or imported at the top of a file, and each event may be registered once without a matcher. Type-check mods with the tsconfig from the types file header; `claude plugin validate` doesn't catch type errors.
- Owner ran the interactive terminal, VS Code, desktop app and managed-mode checks by hand; all test leftovers outside the repo were deleted afterwards.
- Next session needs: step 1 (test kit). Reuse `experiments/step0-mock/server.ts` as the start of `tools/leak-test/`; install `claude` in CI to finish 0.4 and 0.13 on macOS and Linux.

### 2026-10-31: step 1 (test kit)
- `tools/leak-test/`: mock (`server.ts`), search (`detect.ts`), proxy trap (`trap.ts`), 14 doors (`scenarios.ts`), core (`kit.ts`), CLI (`run.ts`), with Claude Code pinned in `claude-pin/` (D-024 to D-026). `tools/test-sets/`: fakes, catch, code, false-alarm and speed sets, for step 2 to measure against.
- Baseline: 98 of 98 fakes seen on Windows, macOS and Linux, and on Linux with no network; 0 network attempts (CI run 41217109599; two kit fixes after it are covered by the PR's CI). 152 tests in `npm test`, 30 under `claude plugin test`.
- Checks 0.4, 0.11 and 0.13 finished. The store limit in 0.4 means spec §8.1 needs a decision before step 3 (Known issues).
- Next session needs: step 2 (checker). Pin Gitleaks (v8.30.1 was read, `83d9cd68`, 222 rules), create `THIRD_PARTY_LICENSES`, and measure against `catchSet()`, `codeSet()`, `falseAlarmFiles()` and `speedSet()`.
