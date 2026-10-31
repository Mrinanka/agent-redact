# secret-shield (working name)

An open-source (Apache-2.0) Claude Code plugin (mod) that hides secrets before the model sees them.
Spec: @docs/spec.md. Plan: @docs/plan.md. Progress: docs/progress.md.

## Workflow

- One session = one part from `docs/progress.md`, started with `/next-part <id>`. Never start another part, even if this one finishes early.
- Before anything else, read the part's row in `docs/progress.md` and the latest session notes.
- Plan first and wait for approval. Then write tests first, then the code.
- Never edit `docs/spec.md` or `docs/plan.md` directly. Propose the change; it is applied only through `/spec-change`.
- Never make a significant design choice silently. Show the options with a recommendation and let the user decide. Mark the result **DECISION** so `/wrap-up` records it in `docs/decision-log.md`.
- Mark surprises, mistakes and platform quirks as **LESSON** so `/wrap-up` records them in `docs/lessons.md`.
- Before designing something, search `docs/decision-log.md` for an existing decision on it. Don't reopen an accepted decision without saying so.
- Items marked [Step 0] in the spec are unconfirmed. Don't build on them until `docs/findings-step0.md` confirms them.
- The commands: `/progress`, `/next-part`, `/review-part`, `/wrap-up`, `/step-retro`, `/step0-check`, `/spec-change`.

## Questions and recommendations

Every question to the user, whether while planning, implementing, reviewing or wrapping up, comes with a **researched, evidence-backed recommendation**. Never a bare question, never a guess.

1. **Research before asking.** Don't ask what you can find out yourself. In this order:
   1. `docs/spec.md`, `docs/decision-log.md`, `docs/findings-step0.md`, `docs/lessons.md`
   2. the code and tests in this repo
   3. the Claude Code mod API types (the file the `plugin-authoring` skill names; grep for the event or noun)
   4. official docs (Claude Code docs, Node.js docs, RFCs, the pinned Gitleaks source)
   5. a quick experiment or measurement in a scratch file
2. **Use this format for each question.** Use the AskUserQuestion tool, with the recommended option first and labelled "(Recommended)"; put the evidence in the option descriptions or just before the question.

   ```
   Question:        one line, and why it matters now
   Options:         2–4, each with its main pro and con
   Recommendation:  one option, and the deciding reason
   Evidence:        what backs it, e.g. file:line, spec §/R-id, D-id, findings row,
                    test or benchmark output, docs URL + section
   Confidence:      high / medium / low, and what would change the recommendation
   ```
3. **Every recommendation cites at least one source you actually read or ran in this session.** Never invent sources, URLs, numbers or quotes. Something recalled from memory is labelled "(from memory, unverified)" and is never the only support for a recommendation.
4. **If the evidence is weak or missing, say so plainly.** Propose the cheapest way to get it (a probe, a benchmark, a docs check) before deciding.
5. **Questions about naming or taste** can be shorter, but still carry a recommendation and its reason.
6. The evidence is copied into the decision-log entry's **Evidence** line when `/wrap-up` records the decision.

## Rules

- Write the tests first, then the code. Run the tests before saying you're done.
- Never change or delete a test to make it pass. If a test seems wrong, stop and ask.
- If the spec is unclear or seems wrong, stop and ask. Don't guess.
- TypeScript only. No runtime libraries in the plugin; everything that runs is in this repo.
- Dev dependencies (build and test tools) are pinned with a lockfile. Don't add one without asking.
- The tool must never contact the network and must never write a secret to disk unencrypted (logs, reports and temp files included). This rule is about the product. Claude may read official docs online while researching.
- Code copied from anywhere else must be credited in THIRD_PARTY_LICENSES before it is merged. Today that is only the Gitleaks rules.
- Cross-platform: the maintainer develops on Windows. Scripts are Node, not bash. Build paths with `path.join`, never hard-coded `/` or `\`.

## Git

- One branch per plan step: `step-0`, `step-1`, ...
- Commit only in `/wrap-up` (`part <id>: ...`), `/spec-change` (`spec: ...`) or `/step-retro` (`retro: step <n>`).
- Never push, force-push, amend published commits or rewrite history. One exception: `/step-retro` pushes the step branch (no force) and opens its PR into `develop`. The owner reviews and merges; Claude never merges.

## Fake secrets in tests

- Never use real secrets. Ever.
- Build fake keys at test time by joining pieces ("ghp_" + "abc..."), so GitHub secret scanning doesn't flag the repo.
- Logs, notes and the docs/ files never contain a secret, not even a fake one written whole.

## Commands

- Tests: `npm test` (Node's built-in `node:test`, runs `tests/**/*.test.ts` directly; Node 24, see `.nvmrc`)
- Typecheck: `npm run typecheck` (`tsc -p .`, no emit; covers `src/`, `tools/`, `tests/`, not `plugin/` or `experiments/`)
- Install dev tools: `npm ci --ignore-scripts` (exact versions from `package-lock.json`)
- Check the plugin: `claude plugin validate ./plugin`
- Plugin tests: `claude plugin test ./plugin`
- Step 0 probe: `claude plugin test ./experiments/step0-probe`; run it with `claude --plugin-dir "<repo>/experiments/step0-probe"` from a scratch folder (log: `<cwd>/.step0-probe/`)
- Leak test kit: (filled in by part 1.2)
