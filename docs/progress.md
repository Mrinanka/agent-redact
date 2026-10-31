# Progress

Where the build stands, and what the next session needs to know. Spec: `docs/spec.md`. Plan: `docs/plan.md`.

## How to work

**The loop, once per part:**

```
/progress                 ← where are we? what's next?
/next-part 2.4            ← Claude plans; you approve; tests first, then code
/review-part 2.4          ← a fresh subagent tries to break it; you pick the fixes
/wrap-up 2.4              ← verify, tick, log decisions and lessons, commit
/clear                    ← fresh context for the next part
```

**Other commands:**
- `/step0-check 0.2 0.3`: an experiment that confirms how Claude Code behaves (Step 0 only)
- `/spec-change <what and why>`: the only way the spec or plan changes
- `/step-retro 2`: at the end of each step, before merging its branch

**Tips:**
- **One part per session.** Fresh context is faster, cheaper and sharper. If a session gets long, `/wrap-up` what's done, `/clear` and continue.
- **Read the plan Claude shows you before approving.** It's the cheapest moment to catch a wrong idea.
- **Your reasons matter.** When Claude asks about a design choice, give your *why* in a sentence. It goes into `decision-log.md`.
- **Model and effort:** use the strongest model at high effort for Step 0, 2.1, 2.4, 2.5, 3.2, 3.7 and reviews. Mechanical parts (1.8, 6.1) are fine on defaults.
- **Step 0 is hands-on.** Claude builds probes; you run them (new sessions, VS Code, a VM) and report back.
- **After part 0.0,** run `/fewer-permission-prompts` so routine test commands stop asking for approval.
- **Parallel work (optional, later):** independent parts, e.g. 1.5 and 1.7, can run in separate git worktrees. Keep it to one part at a time until the workflow feels natural.

**The logs:**

| File | Answers |
|---|---|
| `docs/progress.md` | Where are we? What does the next session need to know? |
| `docs/decision-log.md` | What did we decide, and why? |
| `docs/lessons.md` | What surprised us? What would we do differently? |
| `docs/findings-step0.md` | What is true about Claude Code, with evidence? |

---

## Step 0: Setup and facts (branch `step-0`)

| ID | Part | Spec § | Plan | Depends on | Done when | ✓ |
|---|---|---|---|---|---|---|
| 0.0 | Repo setup: `package.json` (dev deps pinned, lockfile), `tsconfig`, test runner, folders (`plugin/`, `src/checker/`, `tools/leak-test/`, `tests/`, `experiments/`), `.gitignore`, `LICENSE` (Apache-2.0) + `NOTICE`, CI skeleton, CLAUDE.md commands filled in | 21 | Ground rules | — | An empty test passes locally and in CI; typecheck passes; commands are in CLAUDE.md | ☑ |
| 0.A | Probe mod that logs each `session.append` row's door, type and size (never content); `findings-step0.md` ready | 5.1 | Step 0 | 0.0 | The probe loads, validates, and logs rows from a real session | ☐ |
| 0.B | Checks 0.1, 0.5, 0.10: which rows pass `session.append`; can media be dropped; VS Code and desktop | 5.1, 6, 4 | Step 0 | 0.A | Rows recorded in findings with evidence | ☐ |
| 0.C | Checks 0.2, 0.3: `@` redirect via `prompt.mention` in the user tier; what `/resume` sends and whether a plugin can see it first | 5.3, 6.1 | Step 0 | 0.A | Rows recorded in findings with evidence | ☐ |
| 0.D | Check 0.4 (R-10): WebCrypto, `$.process`, OS password stores (Windows now; macOS and Linux via CI or later) | 8.1 | Step 0 | 0.0 | Rows recorded per OS tested | ☐ |
| 0.E | Checks 0.6, 0.9, 0.13: 10 s budget and `.catch`, settings hooks rewriting input/output, Node availability | 12, 5.2 | Step 0 | 0.A | Rows recorded in findings with evidence | ☐ |
| 0.F | Checks 0.7, 0.8: `allowManagedHooksOnly`, safe mode; Managed simulation in Windows Sandbox or a VM | 5.3, 5.2 | Step 0 | 0.A | Rows recorded; the Managed simulation recipe is written down | ☐ |
| 0.G | Checks 0.11, 0.12: mock API via `ANTHROPIC_BASE_URL`; lowest working Claude Code version | 20, 4 | Step 0 | 0.0 | Rows recorded in findings with evidence | ☐ |
| 0.H | Apply all findings with `/spec-change`, then `/step-retro 0` | all | Step 0 | 0.B–0.G | No "pending" rows; spec has no unresolved [Step 0] blocker for Step 1 | ☐ |

## Step 1: Tests first (branch `step-1`)

| ID | Part | Spec § | Plan | Depends on | Done when | ✓ |
|---|---|---|---|---|---|---|
| 1.1 | Fake-secret generator: unique, searchable, built from pieces | 21 | 1a.1 | 0.H | Tests prove uniqueness, and that no whole fake exists in the repo | ☐ |
| 1.2 | Mock model server + recorder (Node built-ins only) | 20 | 1a.2 | 0.H | Claude Code completes a scripted tool-call conversation against it; requests are recorded | ☐ |
| 1.3 | Scenarios and planting: prompt, paste, Read, `@`, Bash output and errors, MCP, subagent, compaction, `/resume` | 6, 20 | 1a.3–4 | 1.1, 1.2 | Against the empty tool, **every** planted fake is reported leaked | ☐ |
| 1.4 | `~/.claude` disk report | 22 | 1a.5 | 1.3 | Report lists where fakes appear on disk (reported, not failed) | ☐ |
| 1.5 | Catch set + code set | 7, R-08 | 1b | 1.1 | Sets exist with labels; the scorer runs and prints catch and false-alarm numbers | ☐ |
| 1.6 | False-alarm set (public files, licenses recorded) + hidden-set procedure | 2 | 1b | 0.0 | Set downloadable by script; the hidden set is kept out of tuning scripts | ☐ |
| 1.7 | Speed set + benchmark runner | 18 | 1c | 1.1 | Benchmarks run and print timings for each input | ☐ |
| 1.8 | CI matrix: macOS, Windows, Linux | 4 | 1 | 1.3, 1.5, 1.7 | All of the above run in CI on all three operating systems | ☐ |

## Step 2: The checker (branch `step-2`)

| ID | Part | Spec § | Plan | Depends on | Done when | ✓ |
|---|---|---|---|---|---|---|
| 2.1 | Gitleaks rule converter (pinned version, credited): convert, keywords, max match length, multiline, can't-get-stuck check. May split into 2.1a / 2.1b. | 7, 17, 21 | 2.1 | 1.5 | Every rule compiles, matches its own example and passes the stuck check, or is rejected with a reason | ☐ |
| 2.2 | Keyword finder (one pass, all keywords) | 18 | 2.2 | 2.1 | Tests plus a speed check on the speed set | ☐ |
| 2.3 | Pattern runner (only hit patterns, only near hits) | 18 | 2.3 | 2.2 | Same matches as a full scan on the catch set; faster | ☐ |
| 2.4 | Password labels: grammar and harmless values | 7.1, 7.2, R-08 | 2.4 | 2.3, 1.5 | Catch set label cases hidden; code set fully unhidden | ☐ |
| 2.5 | Registered-secret store (encrypted, OS key) + Aho-Corasick matcher with encoded forms | 8.1, 18, R-09, R-10 | 2.5 | 2.3, 0.D | Finds secrets raw and encoded; 10 vs 10,000 secrets cost about the same; nothing unencrypted on disk | ☐ |
| 2.6 | Decoder (looks-encoded only, in pieces, max 3 layers) | 7, 18 | 2.6 | 2.5 | Encoded catch-set cases found; speed set within budget | ☐ |
| 2.7 | Repeated-line skip (cleared on registration) | 18 | 2.7 | 2.3 | Tests prove the skip and the reset | ☐ |
| 2.8 | Custom rules + per-rule actions, with the stuck check | 14, R-15 | 2.8 | 2.3 | Bad patterns rejected with clear errors; actions respected | ☐ |

## Step 3: The main lock (branch `step-3`)

| ID | Part | Spec § | Plan | Depends on | Done when | ✓ |
|---|---|---|---|---|---|---|
| 3.1 | Plugin skeleton + settings (3 levels, stricter-only, locks, validation) + log | 14, 16, R-14, R-15, R-17 | 3.9, 3.11 | 2.8 | `claude plugin validate` passes; settings tests cover every stricter-only rule; the log never holds a secret | ☐ |
| 3.2 | Hiding at `session.append` + `prompt.submit`; `.catch` failure handling; "I'm running" marker | 5.1, 12, R-02, R-03, R-04, R-12 | 3.1, 3.6, 3.8 | 3.1 | Leak test: prompt, Read, Bash, errors, MCP, subagent and compaction all clean | ☐ |
| 3.3 | Placeholders, tag map shared with subagents, stable instructions note | 9 | 3.2 | 3.2 | Same secret → same tag; different → different; the note never changes within a thread | ☐ |
| 3.4 | `@` files via `prompt.mention` | 5.3 | 3.1 | 3.3 (needs 0.C) | Leak test: `@` files clean in Personal mode | ☐ |
| 3.5 | Outbound check + `/redact allow` (`block` / `ask` / `warn` / `off`) | 11 | 3.4 | 3.3 | Each setting tested; an allowed tag passes; locks respected | ☐ |
| 3.6 | Overwrite guard + placeholder-in-file notice | 10, R-11 | 3.3 | 3.3 | A whole-file rewrite that would lose a real secret is blocked; a normal edit passes | ☐ |
| 3.7 | Resume scan + mid-session registration warning | 6.1, 6.2, R-06, R-07 | 3.7 | 3.3 (needs 0.C) | Leak test: `/resume` scenario blocked; the warning shows the right count | ☐ |
| 3.8 | Media `pass` / `drop` + observe mode with banner | 6, 13, R-13 | 3.6, 3.9 | 3.2 (needs 0.B) | Media scenarios behave per setting; a project can't turn on observe | ☐ |
| 3.9 | Self-protection (deny edits to its own files) | 17 | 3.7 | 3.1 | Injection scenarios that try to edit settings, secrets or the plugin are denied | ☐ |
| 3.10 | `/redact`, `/redact add`, `/redact learn`; Claude can't run them | 8, 15, R-09, R-16 | 3.10, 3.13 | 3.3, 2.5 | Commands work; the model can't invoke them; storage tests pass | ☐ |
| 3.11 | `/redact self-check [--report]`, `/redact doctor`, version warning | 15, 4, R-01, R-05 | 3.13, 3.15 | 3.10 | `doctor` reports each failure case it should (simulated); the report has no secrets | ☐ |

## Step 4: The backup lock (branch `step-4`)

| ID | Part | Spec § | Plan | Depends on | Done when | ✓ |
|---|---|---|---|---|---|---|
| 4.1 | Settings hooks using the same checker; act only without the marker | 5.2, R-04 | 4.1–4.4 | 3.11 (needs 0.8, 0.9) | Unit tests; does nothing while the main lock runs | ☐ |
| 4.2 | Install snippets (Personal and Managed) + safe-mode leak test | 5.2, 19 | 4.5 | 4.1 | Leak test passes in safe mode within the backup lock's limits | ☐ |

## Step 5: Pilot (branch `step-5`)

| ID | Part | Spec § | Plan | Depends on | Done when | ✓ |
|---|---|---|---|---|---|---|
| 5.1 | Pilot tuning session (repeat as needed): review false alarms from the log and issues, tune rules and harmless values on the catch, code and false-alarm sets | 7 | 5.1–5.3 | 4.2 | False alarms at or below the published target; hidden set scored once | ☐ |
| 5.2 | "Looks random" check evaluation | 7.3 | 5.4 | 5.1 | Numbers recorded; decision logged (ship or not) | ☐ |

## Step 6: Open-source release (branch `step-6`)

| ID | Part | Spec § | Plan | Depends on | Done when | ✓ |
|---|---|---|---|---|---|---|
| 6.1 | `THIRD_PARTY_LICENSES`, `SECURITY.md`, `CONTRIBUTING.md` (DCO), `CODE_OF_CONDUCT.md`, issue templates | 21 | 6.1 | 0.0 | Files present; bug template asks for `doctor` output | ☐ |
| 6.2 | `.claude-plugin/marketplace.json` + install test on a clean machine or VM | 19 | 6.2 | 4.2 | Install from GitHub works on a machine that never had it | ☐ |
| 6.3 | README + `docs/personal.md`, `docs/managed.md`, `docs/verify.md`, `docs/troubleshooting.md` | 19, 20 | 6.3 | 6.2 | Someone new can install and verify by following the README alone | ☐ |
| 6.4 | Final name, compatibility matrix, scores, signed tag, checksums, changelog | 19, 20 | 6.4–6.6 | 5.1, 6.3 | Every release rule in plan.md met | ☐ |

---

## Step summaries

*(Written by `/step-retro` at the end of each step.)*

## Session notes

*(Newest last. Written by `/wrap-up`: what exists now, gotchas, anything deferred.)*

### 2026-10-31: workflow setup
- Spec and plan moved to `docs/`. Slash commands added in `.claude/skills/`. Logs created: `decision-log.md`, `lessons.md`, `findings-step0.md`.
- No code yet. Next: `/next-part 0.0` on branch `step-0`.

### 2026-10-31: part 0.0
- Exists now on `step-0`: npm + `package-lock.json` (dev deps only: `typescript@7.0.2`, `@types/node@24.19.2`), `node:test` running `.ts` directly on Node 24 (`.nvmrc`), `tsc -p .` typecheck only (`erasableSyntaxOnly`: no enums or namespaces), `LICENSE`, `NOTICE`, `.gitattributes` (LF everywhere), 3-OS CI with SHA-pinned actions, guard tests in `tests/repo-setup.test.ts`, empty `plugin/ src/checker/ tools/leak-test/ experiments/`.
- Remote: `origin` = https://github.com/Mrinanka/agent-redact.git; `develop` (default) and `step-0` pushed. CI run 41203340159 green on ubuntu, windows and macos → 0.0 ticked (D-011). Claude pushed this once at the owner's explicit request; the CLAUDE.md "never push" rule still stands.
- Gotcha: the root tsconfig excludes `plugin/` and `experiments/`. Mod code has no Node and is typechecked with the tsconfig Claude Code writes beside a loaded mod. Mods can import only files inside the plugin folder, so `src/checker/` must be copied or bundled into `plugin/` (part 3.1).
- Relative imports in tests use the `.ts` extension (`allowImportingTsExtensions`), since Node runs the sources directly.
