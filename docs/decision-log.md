# Decision log

What we decided, and **why**. This log helps:
- future sessions not reopen settled questions
- contributors understand the design
- us notice when a decision should be revisited

**Rules**
- Entries are numbered `D-001`, `D-002`, … and never deleted or renumbered.
- A changed mind gets a **new** entry. The old one is marked `superseded by D-0xx`.
- The "Why" is the real reason given at the time. If it wasn't recorded, it says so.
- No secrets in here, not even fake ones.
- Status is one of `proposed` (waiting for the owner), `accepted` or `superseded by D-0xx`.

**What counts as a decision:**
- a spec ambiguity resolved
- a design or algorithm choice
- a library, tool or format choice
- a default value or target number
- a rejected review finding
- anything a contributor would ask "why is it like this?" about

Tiny clarifications go under **Minor** at the bottom.

## Index

| ID | Title | Status | Part | Spec § |
|---|---|---|---|---|
| D-001 | License: Apache-2.0 | accepted | setup | 21 |
| D-002 | Two audiences: Personal mode and Managed mode | accepted | setup | 5.3 |
| D-003 | Add observe mode | accepted | setup | 13 |
| D-004 | Store registered secrets encrypted, not as fingerprints | **proposed** | setup | 8.1 |
| D-005 | Default `on_check_failure: allow` | accepted | setup | 12 |
| D-006 | No putting secrets back into files in v1 | accepted | setup | 10 |
| D-007 | Build workflow: slash commands, one part per session, commit at wrap-up, docs in `docs/` | accepted | setup | — |
| D-008 | Credit only code actually copied | accepted | setup | 21 |
| D-009 | Every question comes with a researched, evidence-backed recommendation | accepted | setup | — |
| D-010 | Test runner: `node:test` with native type stripping; `tsc` only typechecks | accepted | 0.0 | 21 |
| D-011 | CI: 3-OS matrix, SHA-pinned actions, timeout + concurrency; tick 0.0 after a green push | accepted | 0.0 | 4 |
| D-012 | Node 24 LTS for development and CI | accepted | 0.0 | 4 |
| D-013 | LF line endings on every OS (`.gitattributes`) | accepted | 0.0 | 4, 7, 18 |
| D-014 | Rejected review finding: test that `.nvmrc` matches `engines` | accepted | 0.0 | — |
| D-015 | End-of-step PRs: Claude opens the PR, the owner merges | accepted | 0.0 | — |
| D-016 | Step 0 probe lives in `experiments/step0-probe/`, loaded with `--plugin-dir` | accepted | 0.A | 5.1 |
| D-017 | Probe log: `<cwd>/.step0-probe/<session id>.jsonl`, metadata only | accepted | 0.A | 5.1 |

## Entry template

```
## D-0xx: <title>
- Date / Part: YYYY-MM-DD / <part id>        Status: proposed | accepted | superseded by D-0xx
- Context: why a decision was needed
- Options considered: A … / B … / C …
- Decision: what we chose
- Why: the deciding reasons, in the owner's words where they gave them
- Evidence: the sources the recommendation rested on (file:line, docs URL + section,
            test or benchmark output, findings-step0 rows, D-ids)
- Trade-offs: what we give up, what it affects
- Revisit when: the signal that should make us reconsider
- Links: spec §, R-ids, files, commits
```

---

## D-001: License: Apache-2.0
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: The tool is to be open source and usable by individual developers and by companies, whose legal teams review licenses before adoption.
- Options considered: MIT / Apache-2.0 / dual MIT and Apache-2.0.
- Decision: Apache-2.0, with a `NOTICE` file.
- Why: It's permissive like MIT, adds an explicit patent grant, and corporate legal teams usually approve it quickly. It is compatible with the MIT-licensed Gitleaks rules we copy, as long as they're credited.
- Trade-offs: A longer license text and a `NOTICE` file to maintain.
- Revisit when: Never expected. Changing a license after outside contributions is hard.
- Links: spec §21; `LICENSE` and `NOTICE` (part 0.0).

## D-002: Two audiences: Personal mode and Managed mode
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: The first draft was written for one company (an IT install, a "security contact"). The open-source version must work for a single developer and for any organization.
- Options considered: Both, with a guide for each / developers first, with managed install as an appendix.
- Decision: Both, as first-class modes.
- Why: The owner wants any developer to "just use it", and companies to be able to adopt and test it themselves.
- Trade-offs: Two install paths to document and test. Personal mode has weaker guarantees (tier bypass, `allowManagedHooksOnly`), which must be stated clearly.
- Revisit when: Step 0 shows a mode can't meet its stated guarantees.
- Links: spec §5.3, §19; R-05.

## D-003: Add observe mode
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: The owner can't test inside company environments. Companies need a safe way to trial the tool and measure false alarms before it blocks anything.
- Options considered: Add `mode: observe | enforce` / always enforce.
- Decision: Add it. Default `enforce`. Only Managed or User settings can enable observe, never Project. A permanent banner shows while it's on.
- Why: It lets organizations run their own trial (observe → review the log → tune → enforce) without help from the maintainer.
- Trade-offs: In observe mode nothing is protected. Mitigated by the banner and the project-level ban.
- Revisit when: Pilot users find the banner insufficient, or observe mode gets left on by accident.
- Links: spec §13, §20; R-13.

## D-004: Store registered secrets encrypted, not as fingerprints
- Date / Part: 2026-10-31 / setup. Status: **proposed: needs the owner's explicit confirmation**
- Context: The first draft stored only keyed fingerprints plus length, so a copied file couldn't reveal even short passwords. The same draft wanted (a) the same cost for 10 or 10,000 secrets and (b) finding secrets inside base64 without decoding.
- Options considered:
  - A) Keyed fingerprints at every position for every registered length. Too slow on large outputs.
  - B) A rolling-hash prefilter, then a keyed confirm. A non-keyed rolling hash on disk weakens the fingerprint idea for short secrets.
  - C) Values encrypted at rest (AES-256-GCM) with the key in the OS password store, decrypted into memory per session, matched with Aho-Corasick over the raw and encoded forms.
- Decision (proposed): C.
- Why: It's the only option found that meets the speed goal and the encoded-form matching at the same time.
- Trade-offs: Anyone running as the same user can decrypt the file, just as they can read `.env`. It protects against the file being copied elsewhere, not against malware running as the user.
- Revisit when: Step 0 check 0.4 shows the mod runtime can't do the crypto or reach the OS password store, or the owner prefers the fingerprint property over speed.
- Links: spec §8.1, §18; R-09, R-10; plan Step 0 check 0.4; part 2.5.

## D-005: Default `on_check_failure: allow`
- Date / Part: carried over from the first draft. Status: accepted
- Context: When a check fails or times out (Claude Code gives each hook 10 s), the content either goes through or is held back.
- Options considered: `allow` with a warning / `hold`.
- Decision: Default `allow`, with a visible warning and a log entry every time. `hold` is available and lockable; the Managed-mode docs recommend it.
- Why: Recorded in the first draft as the owner's decision; the detailed reason was not written down. *(Owner: add your reason here.)*
- Trade-offs: A crash or slowdown lets that piece of content reach the model unchecked. The warning makes sure the user knows.
- Revisit when: The pilot shows failures happen often enough to matter, or adopters ask for a safer default.
- Links: spec §12; R-03, R-12.

## D-006: No putting secrets back into files in v1
- Date / Part: carried over from the first draft. Status: accepted
- Context: Claude only sees placeholders. When it writes a file, the real values could in principle be put back automatically.
- Options considered: Put back automatically / never put back; the developer fills in values.
- Decision: Never put back in v1. Placeholders written by Claude stay as text, with a notice. An overwrite guard (added in the review) stops real secrets being lost.
- Why: The first draft's goal: "Simple: only features that clearly reduce risk." Writing real secrets to disk on the model's behalf adds risk and complexity.
- Trade-offs: The developer has to fill in values by hand.
- Revisit when: Pilot users find manual filling too painful (it's a v2 candidate).
- Links: spec §10, §23; R-11.

## D-007: Build workflow
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: The tool is built with Claude Code across many sessions, so progress and reasoning must survive between them.
- Options considered: Slash commands / a copy-paste prompt file / both. Claude commits at wrap-up / the owner commits. Docs in the root / in `docs/`.
- Decision:
  - Project slash commands (`/next-part`, `/review-part`, `/wrap-up`, `/step-retro`, `/step0-check`, `/spec-change`, `/progress`)
  - one part per session
  - Claude commits at `/wrap-up`
  - spec, plan and logs live in `docs/`
- Why: Short reusable commands keep every session consistent. Commits per part give clean checkpoints. `docs/` keeps the root clean for the README, LICENSE and code of an open-source repo. The owner also asked that progress, decisions and design choices be logged to build a better product, hence `decision-log.md`, `lessons.md` and `/step-retro`.
- Trade-offs: Some ceremony per part.
- Revisit when: A `/step-retro` shows the ceremony slows work more than it helps.
- Links: `CLAUDE.md`, `.claude/skills/`, `docs/progress.md`.

## D-008: Credit only code actually copied
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: The design took inspiration from ideas seen online, but no outside code apart from the Gitleaks rules is used.
- Options considered: Credit every inspiration / credit only copied code.
- Decision: Credit only code or data actually copied, in `THIRD_PARTY_LICENSES`. Today that's only the Gitleaks rules (MIT, pinned version).
- Why: The owner: the idea is their own and they write their own code. Ideas aren't covered by copyright; copied code is.
- Trade-offs: None significant. An optional "Acknowledgements" line in the README remains possible.
- Revisit when: Any outside code or data is copied, which must be credited before it's merged.
- Links: spec §21; `CLAUDE.md` rules.

## D-009: Every question comes with a researched, evidence-backed recommendation
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: Building with Claude means many questions to the owner: design choices, spec readings, review findings. A bare question, or a recommendation with nothing behind it, pushes the research onto the owner and risks decisions built on guesses.
- Options considered: Ask freely / always include a recommendation / always include a researched recommendation that cites evidence.
- Decision: The last one. Every question uses the format in `CLAUDE.md` "Questions and recommendations": Question, Options, Recommendation, Evidence, Confidence. Claude researches first, cites only sources actually read or run, labels anything from memory as unverified, and says plainly when evidence is weak.
- Why: The owner asked that every question during planning or implementation carry "a proper researched and valid suggestion … backed by something".
- Evidence: The owner's request in the setup session.
- Trade-offs: Questions take a little longer to prepare. Decisions are better founded, and the evidence lands in this log.
- Revisit when: A `/step-retro` shows the research overhead outweighs the benefit for small questions.
- Links: `CLAUDE.md` ("Questions and recommendations"); every command in `.claude/skills/`.

## D-010: Test runner: `node:test` with native type stripping; `tsc` only typechecks
- Date / Part: 2026-10-31 / 0.0. Status: accepted
- Context: Every later part needs a test runner and a typecheck. CLAUDE.md forbids runtime libraries and asks for few pinned dev deps.
- Options considered: A) `node:test` with Node running `.ts` directly, plus `tsc --noEmit` / B) Vitest / C) `tsc` builds to `dist/`, then `node:test` runs that.
- Decision: A. Dev deps are exactly `typescript@7.0.2` and `@types/node@24.19.2`, installed with npm. `erasableSyntaxOnly` and `allowImportingTsExtensions` are on.
- Why: It needs the fewest third-party packages of any option (4 installed), which suits a security tool. There's no build step, and it's proven on this machine. (Drafted from the session's evidence; the owner confirmed it.)
- Evidence: A scratch run on Node v24.22.1 (Windows), where `npm test` ran `node --test "tests/**/*.test.ts"` and passed. `tsc` 7.0.2 rejected an enum with TS1294 under `erasableSyntaxOnly`. npm registry: typescript 7.0.2 published 2026-07-08.
- Trade-offs: No enums, namespaces or parameter properties. No watch UI or snapshots. Relative imports carry `.ts` extensions.
- Revisit when: tests need features `node:test` lacks, or Node type stripping changes.
- Links: CLAUDE.md "Rules"; plan "Ground rules"; `package.json`, `tsconfig.json`.

## D-011: CI: 3-OS matrix, SHA-pinned actions, timeout + concurrency; tick 0.0 after a green push
- Date / Part: 2026-10-31 / 0.0. Status: accepted
- Context: 0.0's "done when" needs the test to pass in CI, but the repo has no remote and Claude never pushes. An independent review (finding 6) noted there was no job timeout and that PRs would run twice.
- Options considered: Three-OS now, ticked after the owner's push / three-OS now, ticked at wrap-up / Ubuntu only until 1.8. For finding 6: a timeout and concurrency group / also a push branch filter / defer to 1.8.
- Decision: Ubuntu, Windows and macOS on Node from `.nvmrc`, with `npm ci --ignore-scripts`. Actions pinned to commit SHAs: checkout v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, setup-node v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1`. `permissions: contents: read`; `persist-credentials: false`. The job times out after 15 minutes, and a concurrency group cancels older runs. Push still runs on all branches. 0.0 is ticked when the owner's push shows green.
- Why: It keeps "done when" honest. Windows is the maintainer's OS, so catching its path bugs early matters, and spec §4 asks for CI on all three. The timeout limits the cost of a hang (the mock server arrives in 1.2). A branch filter could stop `step-*` branches getting CI before a PR exists. (Drafted from the session's evidence; the owner confirmed it.)
- Evidence: `git ls-remote` on actions/checkout and actions/setup-node (lightweight tags, so commit SHAs). GitHub workflow syntax docs, `concurrency` and "Using multiple events" ("multiple workflow runs will be triggered"). The 360-minute default job timeout is from memory and unverified.
- Trade-offs: The tick waits on the owner. Runs on three OSes cost more CI time.
- Revisit when: part 1.8 extends the matrix, or CI minutes become a problem.
- Links: spec §4; plan "Ground rules"; `.github/workflows/ci.yml`; `tests/repo-setup.test.ts`.

## D-012: Node 24 LTS for development and CI
- Date / Part: 2026-10-31 / 0.0. Status: accepted
- Context: The test setup (D-010) relies on Node running `.ts` directly; dev and CI need one pinned Node.
- Options considered: Node 24 only / Node 22 and 24 in CI.
- Decision: `.nvmrc` is `24`, `engines.node` is `>=24`, and `engine-strict=true`. The minimum Node for *users* (the backup lock) is not decided here; that is check 0.13 / part 0.E.
- Why: It matches the maintainer's machine, and native `.ts` tests were verified on it. Node 22 support wasn't tested. (Drafted from the session's evidence; the owner confirmed it.)
- Evidence: `node -p process.release.lts` printed `Krypton`; the scratch run on v24.22.1.
- Trade-offs: Contributors on Node 22 have to upgrade.
- Revisit when: 0.E / 0.13 sets the user-side minimum, or Node 26 becomes LTS.
- Links: `.nvmrc`, `package.json`, `.npmrc`; findings-step0 row 0.13.

## D-013: LF line endings on every OS (`.gitattributes`)
- Date / Part: 2026-10-31 / 0.0. Status: accepted
- Context: Independent review finding 8.
- Options considered: Add `.gitattributes` now / wait until hashed or golden files exist.
- Decision: `* text=auto eol=lf`, binary types marked as binary, plus a guard test. CRLF input is tested on purpose with fixtures built in the test, never by accident of checkout.
- Why: The checker's regexes, anchors, offsets and test-set sizes must not depend on where the repo was cloned. Adding it before any fixtures exist costs nothing. (Drafted from the session's evidence; the owner confirmed it.)
- Evidence: Git for Windows system config sets `core.autocrlf=true` (`git config --system --show-origin`: `C:/Program Files/Git/etc/gitconfig`). `git check-attr` shows `eol: lf` applied to existing files.
- Trade-offs: None significant; Windows editors must handle LF, which all modern ones do.
- Revisit when: a file genuinely needs CRLF, which would get a per-file attribute.
- Links: spec §4, §7, §18; `.gitattributes`; `tests/repo-setup.test.ts`.

## D-014: Rejected review finding: test that `.nvmrc` matches `engines`
- Date / Part: 2026-10-31 / 0.0. Status: accepted
- Context: Independent review finding 4 proposed a drift-guard test between `.nvmrc` and `package.json` `engines`.
- Options considered: Add the test / reject.
- Decision: Rejected.
- Why: `engine-strict=true` already makes any harmful mismatch fail `npm ci` in CI, which installs Node from `.nvmrc`. The only drift that would pass silently is bumping `.nvmrc` to a higher version, which is harmless. (Drafted from the session's evidence; the owner confirmed it.)
- Evidence: `.npmrc` (`engine-strict=true`), `package.json` engines `>=24`, `.nvmrc` `24`, all checked this session.
- Trade-offs: None.
- Revisit when: CI stops installing Node from `.nvmrc`, or `engine-strict` is removed.
- Links: `.npmrc`, `.nvmrc`, `package.json`.

## D-015: End-of-step PRs: Claude opens the PR, the owner merges
- Date / Part: 2026-10-31 / 0.0. Status: accepted (recorded at the 0.A wrap-up)
- Context: No rule said who opens and who merges the end-of-step PR into `develop`.
- Options considered: Claude opens the PR at the end of `/step-retro` and the owner merges / the owner does both / Claude merges / a draft PR from the start of the step.
- Decision: At the end of `/step-retro`, Claude pushes the step branch (no force), runs `gh pr create` into `develop`, and waits for CI. The owner reviews and merges; Claude never merges.
- Why: It keeps the owner as the only gate into `develop` while saving them the routine push and PR steps. (Drafted from the session's evidence; the owner confirmed it.)
- Evidence: A grep of CLAUDE.md, the skills and docs found no rule on PRs or merges; `gh` is logged in as Mrinanka (0.0 session notes).
- Trade-offs: An exception to "never push", for the step branch only.
- Revisit when: A step-retro shows PRs going stale, or the owner wants to push themselves.
- Links: CLAUDE.md "Git"; `.claude/skills/step-retro/SKILL.md`.

## D-016: Step 0 probe lives in `experiments/step0-probe/`, loaded with `--plugin-dir`
- Date / Part: 2026-10-31 / 0.A. Status: accepted
- Context: Parts 0.B, 0.C and 0.E extend the probe, and findings must be re-checked when the Claude Code version changes.
- Options considered: In the repo under `experiments/` / in the session's dev-mods folder (the plugin-authoring skill's default, hot-reloaded, tied to one session id).
- Decision: In the repo, `experiments/step0-probe/`, started with `claude --plugin-dir`.
- Why: It's versioned, so a re-check reproduces the same evidence, and later parts can build on it. (Drafted from the session's evidence; the owner confirmed it.)
- Evidence: `docs/findings-step0.md:9` (the re-check rule); `tsconfig.json` already excludes `experiments/`; the plugin-authoring skill (2.1.316) writes mods under `~/.claude/dev-mods/<session>/`.
- Trade-offs: Sessions have to be started with `--plugin-dir`.
- Revisit when: Step 0 ends (part 0.H): delete the probe or keep it for re-checks.
- Links: spec §5.1; plan Step 0; findings "The probe"; `experiments/step0-probe/`.

## D-017: Probe log: `<cwd>/.step0-probe/<session id>.jsonl`, metadata only
- Date / Part: 2026-10-31 / 0.A. Status: accepted
- Context: The probe needs somewhere to write one line per `session.append` row that is easy to read back and never holds content.
- Options considered: The session's working folder / the probe's own folder / the debug log via `$.ui.log` / the plugin's `$.store`.
- Decision: The session's working folder, gitignored, one JSONL file per session. The file is rewritten on each row, because `$.fs.write` replaces the whole file. Only fields on an allow-list are recorded, as types, ids and sizes.
- Why: It's easy to find and stays outside the watched plugin folder, so writing it shouldn't reload the mod. (Drafted from the session's evidence; the owner confirmed it.)
- Evidence: `claude-code.d.ts:3365` (`fs.write` replaces the whole file); plugin-authoring `reference.md:72` ("saving a file reloads the hooks module", read as applying to any file; untested); `claude-code.d.ts:3467` (`$.store` is a JSON file with a 4 MiB cap and no documented path). First real run: 17 rows logged, and a grep for the content found nothing.
- Trade-offs: The log lands in whatever folder you test in, so use a scratch folder. Rewriting the whole file on every row costs O(n²), which is fine for a probe.
- Revisit when: A log grows past 4 MiB (it then can't be read back, so the probe starts a new file), or the engine adds an append call.
- Links: spec §5.1, §16; `experiments/step0-probe/hooks/register.ts`, `summarize.ts`; `.gitignore`.

---

## Minor

- 2026-10-31: "secret-shield" is a working name. The final name is chosen in part 6.4 (no "Claude" or "Anthropic" in it).
- 2026-10-31 / 0.0: NOTICE copyright line is "Copyright 2026 Mrinanka Dhar", with the project as "secret-shield (working name)" (renamed in 6.4).
- 2026-10-31 / 0.0: npm, not pnpm. pnpm isn't installed and npm ships with Node.
- 2026-10-31 / 0.0: `noUncheckedIndexedAccess` is on in `tsconfig.json`. Stricter than planned; no new dependency.
- 2026-10-31 / 0.0: `step-0` was branched from `develop` (commit f135454), the only local branch.
- 2026-10-31 / 0.0: GitHub repo created by the owner as `Mrinanka/agent-redact`. The repo name is not yet the product's final name (that's part 6.4; spec still says "secret-shield").
- 2026-10-31 / 0.0: One-time exception to CLAUDE.md "Never push": the owner told Claude to push `develop` and `step-0` ("you do it man i gave you everything"). The rule itself is unchanged.
- 2026-10-31 / 0.A: The probe records only fields on an allow-list. Any recorded string that doesn't look like a name or id is written as `(odd)`.
- 2026-10-31 / 0.A: The probe's tests run under `claude plugin test` on the owner's machine only, because CI has no `claude` installed.
