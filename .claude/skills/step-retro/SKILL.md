---
name: step-retro
description: Retrospective at the end of a plan step - summarize, spot patterns, improve the process.
argument-hint: <step number, e.g. 2>
disable-model-invocation: true
---

Retrospective for **Step $ARGUMENTS**. Run this once every part of the step is ticked, before merging the step branch.

## 1. Gather

- Every session-notes entry for this step's parts in `docs/progress.md`.
- This step's entries in `docs/decision-log.md` and `docs/lessons.md`.
- `git log --oneline` for the step branch, and `git diff --stat` against where it started.
- The test suite result, and speed, catch and false-alarm numbers if this step produced any.

## 2. Draft a step summary (for `docs/progress.md`, under the step's table)

- **Built:** what now exists, in 3–6 lines.
- **Key decisions:** the 3–5 that matter most, by D-id, each in one line.
- **Harder than expected:** what took longer or needed rework, and why.
- **Numbers:** any measurements (tests, speed, catch rate, false alarms).
- **Risks carried forward:** open problems the next steps must keep in mind.

## 3. Look for patterns

- Lessons that repeat.
- Decisions whose "Revisit when" condition has now happened, or that look shaky.
- Spec sections that kept causing questions.
- Places where the workflow itself slowed us down: prompts, commands, too-large parts.

## 4. Propose (don't apply yet)

- New or changed rules for `CLAUDE.md`.
- Items for `/spec-change`.
- Changes to the next step's parts in `docs/progress.md`: split, merge, reorder, new dependencies.
- Changes to these slash commands, if a pattern shows a prompt is weak.

Each proposal follows "Questions and recommendations" in `CLAUDE.md`:
- a recommendation (adopt / don't)
- **evidence**: the lesson entries, D-ids, session notes, metrics or commits that show the pattern
- a confidence level

A proposal with no evidence behind it is left out, or marked as a hunch.

## 5. Apply

After I approve:
- Write the summary.
- Apply the approved `CLAUDE.md`, `progress.md` and command changes.
- Commit `retro: step $ARGUMENTS` (with the Co-Authored-By line).

Then suggest merging the step branch and starting the next step's branch. Spec changes still go through `/spec-change`.
