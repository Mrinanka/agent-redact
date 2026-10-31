---
name: next-part
description: Start one part of the build plan - plan, tests first, then code.
argument-hint: <part id, e.g. 2.4>
disable-model-invocation: true
---

We are working on part **$ARGUMENTS** only.

## 1. Load context (read narrowly)

- In `docs/progress.md`, find the row for part $ARGUMENTS (spec §, plan step, depends on, done when) and the latest session notes. If there's no such part, stop and tell me.
- Read only those sections of `docs/spec.md` and `docs/plan.md`.
- Search, don't read whole, these files by the part's spec § and keywords:
  - `docs/decision-log.md`: accepted decisions that apply
  - `docs/lessons.md`: lessons that apply
  - `docs/findings-step0.md`: confirmed facts the part relies on
- Look at the existing code this part touches.

## 2. Check prerequisites

- Every part in "depends on" is ticked.
- Every [Step 0] item this part relies on is confirmed in `docs/findings-step0.md`.
- We're on the right branch for this step (`step-<n>`). If not, ask whether to create or switch to it.

If anything is missing, stop and explain what's needed. Also recommend how to resolve it (which part or check to run first, and why), citing the `progress.md` rows or findings that show the gap.

## 3. Research, plan, then wait for approval

**Research first.** For every design choice or unclear point, follow "Questions and recommendations" in `CLAUDE.md`: check the docs/ files, the code, the mod API types, official docs, or run a quick measurement. Only then present it.

Show me:
- **Goal**, in one sentence.
- **Files** to create or change.
- **Tests**, by name. Map each to the R-id or spec § it proves. Include failure cases, not just happy paths.
- **Design choices** this part needs, each in the CLAUDE.md format: Question / Options / Recommendation / **Evidence** / Confidence. Mention any related decision-log entry.
- **Spec questions** about anything unclear, in the same format, with your recommended reading of the spec and the evidence for it. Don't guess.

Ask the choices and questions with the AskUserQuestion tool, recommended option first. Don't write any file until I approve.

## 4. Build

1. Write the tests. Run them. They must fail, and for the right reason. Show me that.
2. Write the code until they pass.
3. Run the full test suite and the typecheck, plus `claude plugin validate ./plugin` and `claude plugin test ./plugin` if the plugin changed.
4. If a new design choice comes up mid-way, stop. Research it, then ask in the CLAUDE.md format: options, recommendation, evidence, confidence. Don't decide silently, and don't ask without a backed recommendation.
5. Never weaken, skip or delete a test to get green. If a test seems wrong, stop and ask.

## 5. Stop and report

- Tests added, and the full-suite result.
- Anything you're unsure about.
- **DECISION:** each design choice made this session: options, what we chose, why (in my words if I gave the reason), and the evidence it rested on.
- **LESSON:** anything surprising: platform behaviour, a mistake, something that took longer than expected.
- Spec or plan changes this part suggests (for `/spec-change`).

Then suggest `/review-part $ARGUMENTS`. Don't start the next part.
