---
name: spec-change
description: Change the spec or plan in a controlled way, with the reason recorded in the decision log.
argument-hint: <what should change and why>
disable-model-invocation: true
---

Spec change request: **$ARGUMENTS**

## 1. Understand

- Read the affected sections of `docs/spec.md` and `docs/plan.md`.
- Search `docs/decision-log.md` for related decisions, and `docs/findings-step0.md` for related evidence.
- Find what depends on it: parts in `docs/progress.md`, tests that reference the affected R-ids (search the tests for the R-id), and code.

## 2. Propose, then wait

Show me:
- **Recommendation**, following "Questions and recommendations" in `CLAUDE.md`:
  - what to change
  - the alternatives considered (including "change nothing")
  - **evidence** (findings row, measurement, D-id, docs, a test)
  - confidence
- **Exact edits**, before → after, for `docs/spec.md`, `docs/plan.md` and `docs/progress.md`.
- **Impact:** which parts must be redone or added, which tests change, and whether any ticked part is now invalid.
- **R-ids:** never renumber. A retired requirement stays, marked `(removed, see D-0xx)`. A new one gets the next free number.
- **A decision-log entry** in the full format (Context, Options, Decision, Why, Evidence, Trade-offs, Revisit when, Links), citing the evidence, such as a `findings-step0.md` row. If this reverses an earlier decision, say which one and mark it `superseded by D-0xx`.
  - The "Why" must be the real reason from me or from the evidence. If unclear, ask.

## 3. Apply

After I approve:
- Make the edits.
- Write the decision-log entry and update its index.
- Update `docs/progress.md` (untick affected parts or add new ones).
- Commit `spec: <one-line summary>` with the Co-Authored-By line. Don't push.
