# Progress

Spec: `docs/spec.md`. Plan: `docs/plan.md`. Parked work: spec §23.

**Current focus:** Step 0, Facts: run checks 0.1–0.11 and 0.13 with the probe, then apply the findings to the spec.

## Steps

| Step | What | Branch | ✓ |
|---|---|---|---|
| 0 | Facts (repo setup ☑, probe ☑, checks pending) | `step-0` | ☐ |
| 1 | Test kit | `step-1` | ☐ |
| 2 | Checker | `step-2` | ☐ |
| 3 | Core hiding + Audit 1 | `step-3` | ☐ |
| 4 | Rest of the main lock | `step-4` | ☐ |
| 5 | Backup lock + tuning | `step-5` | ☐ |
| 6 | Release + Audit 2 | `step-6` | ☐ |

"Done when" for each step is in `docs/plan.md`, "The 7 steps".

## Known issues

Bugs, unfinished bits and open questions. Features we chose not to build go in spec §23.

- D-004 (encrypted secret store) is still **proposed**. Confirm it after check 0.4.
- D-005: the owner's reason for `on_check_failure: allow` was never recorded.
- First probe run (`-p` only) showed a `queue` row before `session.start`, an `unclassified` prompt origin, and attachment rows with no blocks. Unconfirmed; check in step 0.
- An interactive terminal probe run is still to do (step 0).
- Probe tests (`claude plugin test`) don't run in CI, because CI has no `claude`.

## Gotchas

Platform and tooling facts learned so far (from the old `lessons.md`).

- Rows loaded by `/resume` don't pass through `session.append`, so a resumed session can resend raw secrets (spec §6.1, check 0.3).
- A mod can't change messages already sent. Registering a secret mid-session can't un-send it, so warn and suggest rotating (§6.2).
- Hooks fail **open**: a throw, a wrong shape or going over 10 s means the hook is skipped. Refusing hooks need `.catch` (1 s grace) to fail closed (R-03).
- Under `allowManagedHooksOnly`, a user-tier plugin loads no hooks; `doctor` must say so (R-05).
- The mod runtime has no Node or DOM; everything goes through `$`. A mod and its imports must sit inside the plugin folder, so `src/checker/` gets copied or bundled into `plugin/` (step 3).
- Git for Windows sets `core.autocrlf=true`; `.gitattributes` forces LF. Test CRLF on purpose with fixtures built in the test. Count line endings with Node or `git ls-files --eol`, not `grep`.
- `claude plugin test`: a test's own `session.append` hook that answers without `next` gets skipped, so record rows with `mock.session(on)`. A hook for a `$` call that throws makes the plugin's call reject, which is how to simulate a failing write.
- `claude -p`: put the prompt before `--allowedTools`, which takes several values and swallows what follows.
- `$.fs.write` replaces the whole file.
- When a skill asks for plan approval, the answers to design questions are not approval. Ask for approval explicitly.

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
