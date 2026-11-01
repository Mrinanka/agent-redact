# Progress

Spec: `docs/spec.md`. Plan: `docs/plan.md`. Parked work: spec §23.

**Current focus:** Step 4, Rest of the main lock (branch `step-4` from `develop`). Start with `/plan-step`.

## Steps

| Step | What | Branch | ✓ |
|---|---|---|---|
| 0 | Facts | `step-0` | ☑ |
| 1 | Test kit | `step-1` | ☑ |
| 2 | Checker | `step-2` | ☑ |
| 3 | Core hiding + Audit 1 | `step-3` | ☑ |
| 4 | Rest of the main lock | `step-4` | ☐ |
| 5 | Backup lock + tuning | `step-5` | ☐ |
| 6 | Release + Audit 2 | `step-6` | ☐ |

"Done when" for each step is in `docs/plan.md`, "The 7 steps".

## Known issues

Bugs, unfinished bits and open questions. Features we chose not to build go in spec §23.

- D-005: the owner's reason for `on_check_failure: allow` was never recorded.
- Probe tests (`claude plugin test`) don't run in CI. The pinned `claude` now makes that possible; it wasn't added in step 1.
- `claude plugin test` (2.1.316): a `turn.step` stream's `.result` resolves `undefined` even when the step beneath answers, contrary to its doc (`HookStream.result`, `claude-code.d.ts:5383`). Probe tests check the hold through its effects instead. Report it upstream.
- The desktop app's probe log had no `start` line, so its Claude Code version wasn't recorded. Check before release.
- The kit's no-network proof is strongest on Linux, where nothing can leave (loopback-only namespace). On Windows and macOS the proxy trap only sees traffic that honours proxy settings.
- The macOS Keychain call at 1 MB was refused before it ran, and the check doesn't record why. Log the cause when the store limit is measured.
- The probe's `turn.step` hold has no `.catch`, so it fails open. Fine for a test tool; the product's refusing hooks must have one (R-03).
- Check 0.6: a `.catch` that spun the CPU for 2 s still had its answer used, although the documented grace is 1 s. Don't rely on the grace either way.
- Plan step 6 now holds the optional real-API run (moved from step 1, D-027).
- CI's password store and Node steps print evidence but can't fail the job. A change in them only shows if someone reads the log.
- Killing the kit mid-run, or using `--keep`, leaves a scratch folder holding that run's fakes.
- Step 2 rejects 3 Gitleaks rules (D-032): `kubernetes-secret-yaml` stays out (D-038, spec §22); `facebook-access-token` has no required literal; `pkcs12-file` matches file names, not text.
- Step 2 false alarms (typescript and @types/node sources, 2.9 MB): with file names 12 hidden (4.16 per MB); with no file name 175 (60.69 per MB), nearly all label hits on type aliases such as `export type DotToken = Token<...>`. That second figure applies to all Bash output, so step 5 should tune it.
- With no file name, rules with a path condition still run (D-029), so `hashicorp-tf-password` hides quoted 8 to 20 character values after `password` even in non-Terraform text.
- Repeated-line memory is keyed by line and file name, so a repeated line across different files is checked again.
- A hit's area is the pattern's longest match on each side of the keyword. 16 rules reach up to about 32 KB on each side, so about 64 KB per hit; many such hits are bounded by the 4 s budget (`complete: false`), which step 3 must treat as a check failure (R-12).
- `tools/rules/sample.ts` builds random strings from patterns for tests only; they hold no fixed key.
- The repeated-line skip shows no gain so far (2 MB log: 84 ms first scan, 86 ms repeat). Most likely cause, not confirmed: rules whose pattern can end in a newline count as spanning lines and always run. Step 5 should confirm it, then fix or drop the skip.
- Unquoted values still end at a space, `;`, `,` or `&` (spec §7.1), so a password holding one is only partly hidden, or missed if the first part is under 6 characters. URL passwords under 6 characters, or holding `/`, are also left alone. A plain lowercase password after a `--flag` is left alone (D-034).
- Once caught, always caught spreads a false alarm: with no file name, 953 of 1,010 hits in the false-alarm set were repeats of 57 values, 38 of them plain words, so a code word gets hidden through the rest of that text (350 per MB, against 60.69 for the checker alone; 5.55 with a file name). It hides too much, it doesn't leak. Step 5 should tune which values are remembered.
- The truncated-key rule takes the base64 lines after a key as its body, even when the key was complete but JSON-escaped on one line, so a block after it is hidden too.
- A crash leaves the marker at `running: true`, so the backup lock would stand down. Step 5 needs a freshness check.
- `policy` settings are tested through mocks only. Step 5's managed run must prove a `secretShield` key in a real managed file.
- `npm run plugin:typecheck` needs the API types, which only a loaded mod or the `plugin-authoring` skill provides, so it isn't in CI. `/verify` runs it.
- Large-paste stress runs were by hand, against the kit's mock: 2 MB each, on Windows. No kit door covers them yet.
- A hook killed outright sends its whole row unhidden under the default `allow`, whatever the cause (D-050). Anything that can't check a deadline must be bounded by size.
- A value over 8,192 characters isn't remembered (D-052, spec §22): a bare copy is neither hidden nor blocked, and the person gets a one-time warning. Keeping such values in a side list found by a plain text search would close this with no matcher build, but it reopens D-052.
- A value over 8,192 characters gets a new tag after a worker restart, because D-052 keeps it out of `$.state`. That breaks spec §9 "the same tag within a session". It's cosmetic: nothing gets unhidden. A fix needs a synchronous fingerprint, and the only hash here is async (`store.ts`). Its entry in the `tags` map also stays for the worker's life.
- `exportCatches` skips the catch cap for tagged values the catch list refused: in a scratch run 240,160 characters went to `$.state`, 96,064 of them real catches. Those values never reach the matcher. D-053 caps the export at 4,000,000 characters of JSON, because the host refuses a `$.state` write over 4,194,304. A tagged value past that cap gets a new tag after a restart, which is cosmetic but is a second exception to spec §9 "the same tag within a session". The `tags` map itself has no cap, so it still grows for the worker's life.
- Windows reads about 0.5 s per item, so a session with a list spends about 1 s at start, for the index and the list.
- Audit 1 ran before the last fixes. `/security-review` and `/code-review high` covered the step's code, then the too-long warning, the `constructor` fix and D-053 went in, and neither audit was run again on those. They were tested instead: 8 reverts on a scratch copy, each caught by the new tests.
- Spec §9 still says "the same tag within a session", with no mention of the two exceptions above (values over 8,192 characters, and tagged values past D-053's cap). Rewording it needs the owner's yes.
- The catch cap can be filled by content (D-052): one 141,000-character file of token-shaped text, or 13 long key-shaped values, fills it. For the rest of the session a password hidden beside its label shows when it appears bare later. The person is warned once, and hiding or blocking by shape keeps working. Adding this to spec §22 was recommended but not approved; the owner hasn't ruled on it.
- A secret written inside a forged placeholder shape is treated as a placeholder, so it reaches the model and skips a `block` rule. Confirmed with an AWS key id and an upper-case registered value; mixed-case tokens stay hidden, and a later bare copy is still caught. An injected `echo` of a variable inside the shape needs no knowledge of the value, so "whoever writes it already has it" doesn't hold. It only happens on purpose, and `rev` does the same job (spec §3, §22). The recommendation was to leave the code alone; the owner hasn't ruled on it.
- `claude plugin validate` passes, but warns that `plugin/README.md` has no marketplace install line. That comes with the marketplace in step 6.

- Step 4 hand checks still to run: interactive `/resume` at `prompt.submit`, the add and learn panes, the `outbound: ask` dialog, the observe band, and whether `/redact` survives `/clear` (it is registered again when the session id changes, unproven interactively).
- `claude -p` shows no `$.ui.log` line, so warnings, R-12 failures and the observe banner only reach the log there (spec §22).
- After a mistaken `/redact add <value>`, a scratch run with masking showed the value gone from the next request but still in the transcript file; the real plugin's run found it in no file. The difference wasn't traced, so the message still says to rotate.
- The `@` copy's path holds `secret-shield`, so the model can tell it is a copy. Its Read of the real file is hidden, so nothing leaks.
- A failed store read can take 20 s, and the retry runs inside a hook, so that row waits.
- Doctor can't see the plugin's tier, and "Managed" is read from the managed settings holding our key or `enabledPlugins`. Step 5's managed run should check it.
- `--always` on a value whose store save fails stays harmless for the session only, and says so.

## Gotchas

Platform and tooling facts learned so far (from the old `lessons.md`).

- Rows loaded by `/resume` don't pass through `session.append`, so a resumed session can resend raw secrets (spec §6.1, check 0.3).
- A mod can't change messages already sent. Registering a secret mid-session can't un-send it, so warn and suggest rotating (§6.2).
- Hooks fail **open**: a throw, a wrong shape or going over 10 s means the hook is skipped. Refusing hooks need `.catch` (1 s grace) to fail closed (R-03).
- Under `allowManagedHooksOnly`, a project's `disableAllHooks`, `--safe-mode`, `--bare` or `CLAUDE_CODE_SIMPLE=1`, a user-tier plugin loads no hooks and user settings hooks don't run. A plain markdown command still loads (checks 0.7, 0.8, 0.14).
- The mod runtime has no Node or DOM; everything goes through `$`. A mod and its imports must sit inside the plugin folder, so `src/checker/` gets copied or bundled into `plugin/` (step 3).
- Git for Windows sets `core.autocrlf=true`; `.gitattributes` forces LF. Test CRLF on purpose with fixtures built in the test. Count line endings with Node or `git ls-files --eol`, not `grep`.
- `claude plugin test`: a test's own `session.append` hook that answers without `next` gets skipped, so record rows with `mock.session(on)`. A hook for a `$` call that throws makes the plugin's call reject, which is how to simulate a failing write. Not for `$.state`: the kit has its own store beneath the hook, so a throw is skipped and the write succeeds. Send it a value over 4,194,304 characters through `next` to get a real refusal.
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
- A running regex can't be interrupted, and the mod has no timeout. A time budget only works between calls, so a pattern's worst case must be bounded per piece of text, not per start position.
- The scan's time budget also covers the keyword pass, so a test needs a budget longer than that pass or no rule ever starts (about 60 ms on 2 MB).
- A multi-line script with backslashes and backticks can break in a shell heredoc. Write it to a scratch file and run that.
- `tests/no-whole-fakes.test.ts` only searches tracked files, so new files pass it until they are staged. `/verify` should run it after `git add`.
- Updating Gitleaks: remove the `gcp-api-key` allowlist from the new copy again (D-039).
- A hook's deadline only covers work that checks it. A matcher build, a regex and any loop that doesn't check the clock run to the end, and a worker killed at about 6 s sends the row unhidden. Size-bound them.
- A test with one fake can miss what several kinds do together: only a run with the kit's full block found the private-key case. Stress with all of them.
- In a shell chain, a `sed` that matches nothing still succeeds. Check a test run's result, not the commands before it, before committing.
- `npm run plugin:typecheck` needs the types path, and the skill's copy moves: `%TEMP%/claude/bundled-skills/<version>/<hash>/plugin-authoring/types/claude-code.d.ts`, where the hash changes. Find it with a wildcard, not a saved path.
- To learn whether a command ran, parse the transcript's messages. A raw text search also matches the search itself once it is in the transcript.
- The Bash tool on this Windows machine breaks a heredoc holding apostrophes or `\n`. Write scripts with the Write tool.
- Under `claude plugin test`, the test's own `$` and a test hook's `$` can't call nouns the test module doesn't use, and `$.command.run` carries no origin unless the test passes one.
- A helper taking `$` must be a function declaration: a `const` arrow is a load error, as the store's `today` showed.
- The kit passes a short list of env variables, and `OS` isn't on it. Code that reads the environment needs a test under the kit.
- A review finding pasted into a new session only carries what was pasted. Two "record it" items from one session never reached the docs that way.

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

### 2026-10-31: step 2 (checker)
- `src/checker/` (no Node imports, guarded by a test): `re/` (RE2 parser, analyzer, JS emitter), `convert.ts`, `aho.ts`, `entropy.ts`, `labels.ts`, `harmless.ts`, `private-key.ts`, `lines.ts`, `checker.ts`. `createChecker({ off, actions, custom, budgetMs })` returns `{ checker, errors }`; `checker.scan(text, { file })` returns `{ findings, complete }`.
- `npm run rules:build` (`--check` in CI) turns `third_party/gitleaks/gitleaks.toml` (v8.30.1) into `rules.generated.ts`: 219 converted, 3 rejected (D-028 to D-032). `npm run measure` prints the numbers; it is a CI step.
- `/verify` found 2 blockers (a stuck custom pattern, a crash at about 3 MB) and several leaks; all fixed with tests in `tests/checker-hardening.test.ts` (D-032 to D-035).
- Numbers: catch 124 of 124 in the contexts counted (14 decoder cases left for step 3); code set 41 of 41 left alone, 81 of 81 twins hidden; speed under Node: 2 MB log about 85 ms, 2 MB one-line JSON about 90 ms, worst adversarial item about 350 ms.
- Decisions D-028 to D-039. The store design is settled in D-036, with spec §8.1 edited in step 3 after measuring macOS and Linux. `personal_data` moved to step 5 (D-037); `kubernetes-secret-yaml` stays rejected (D-038, spec §22).
- Next session needs: step 3 (core hiding). Copy or bundle `src/checker/` into `plugin/`, treat `complete: false` as a check failure, show "not available yet" for `personal_data: on`, and prove the checker in a real hook.

### 2026-11-01: step 3 (core hiding)
- `src/core/`: `forms`, `matcher`, `decoder`, `placeholder`, `session` (Redactor), `rows`, `settings`, `log`, `note`, `store`, `backends`. `plugin/`: 7 hooks with `.catch`, and `hooks/lib/`, a copy made by `npm run plugin:build`, with the licences beside it. Checker additions: `ScanOptions.budgetMs`, `convertAllowPattern`.
- `/verify` found real leaks, all fixed with tests in `tests/core-hardening.test.ts`: a flood of placeholder starts, misaligned or indented base64, odd hex, non-ASCII passwords, a blocked value losing its block, and a 2 MB base64 paste that killed the worker through a 5 s matcher build (D-051, D-052).
- Store measured in CI (D-045). CI run 41242945288 on wip `330d4fd`: all 6 jobs green, leak-test:core 0 of 84 seen on 3 OSes. Later changes are in the working tree, for `/ship`.
- Numbers: catch 135 of 138 (D-046), code set 41 of 41, false alarms 5.55 per MB with a file name.
- Decisions D-040 to D-053. Next: `/security-review`, `/code-review high`, `/ship`.
- A review found a project rule with the id `constructor` could undo a user's or a locked managed `block`, and a project could weaken a rule with that id; fixed with own-key lookups. A refused `$.state` write now warns, logs and retries, and the export is capped (D-053). The locked-store gap is in Known issues, for step 4.

### 2026-11-01: step 3 audit and ship
- Audit 1 is done: `/security-review` found nothing at confidence 8 or above, and `/code-review high` gave 7 findings. Findings 1 and 3 are recorded, 2 is fixed, and 4 to 7 are rejected (D-054). Of its 4 low-confidence security notes, `constructor` is fixed and the other 3 are in Known issues. Checking them also found the `$.state` failure (D-053).
- On the tree shipped, on Windows: 678 of 678 in `npm test`, 28 of 28 in `claude plugin test`, typecheck and plugin typecheck clean, `leak-test:core` 0 of 84 seen over 12 doors with 0 network attempts. macOS and Linux results for this tree are on the step 3 PR's CI.
- Next session needs: step 4. Fix the locked-store gap before `/redact add` ships (Known issues), and decide the self-protection question there.
