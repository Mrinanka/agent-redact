---
name: wrap-up
description: Finish a part - verify, record progress, decisions and lessons, then commit.
argument-hint: <part id, e.g. 2.4>
disable-model-invocation: true
---

Finish part **$ARGUMENTS**.

## 1. Verify

Run the full test suite and the typecheck, plus `claude plugin validate ./plugin` if the plugin exists. If anything fails, stop and show me. Don't wrap up a red build.

## 2. Progress (`docs/progress.md`)

- Tick part $ARGUMENTS.
- Under **Session notes**, add an entry `### <date>: part $ARGUMENTS` with 2–5 lines for the next session: what exists now, gotchas, anything deferred and why.

## 3. Decisions (`docs/decision-log.md`)

- Collect from this session:
  - **DECISION** items
  - questions I answered
  - review findings I rejected
- Draft each as a full entry with the next free `D-` number: Date / Part, Status, Context, Options considered, Decision, Why, **Evidence** (the sources the recommendation cited: `file:line`, docs, measurements, findings rows), Trade-offs, Revisit when, Links (spec §, R-ids, files).
- **The "Why" must be the actual reason given in this session.** If you don't know my reason, offer a draft "Why" built from the session's evidence, clearly labelled *draft, please confirm or correct*, and ask. Never record a reason as mine without my confirmation.
- Tiny clarifications go as one line under **Minor** instead.
- Add new entries to the index table.
- If a decision replaces an earlier one, mark the earlier one `superseded by D-0xx`.
- **Show me the drafts and write them only after I confirm.**

## 4. Lessons (`docs/lessons.md`)

- Append each **LESSON** item: date, part, tag (`[claude-code]`, `[detection]`, `[perf]`, `[process]`, `[testing]`), what happened, what to do next time.
- If a `[process]` lesson has happened before, propose a new rule for `CLAUDE.md`. Cite the lesson entries that triggered it, and recommend whether to adopt it, and why. Show it; don't add it without my OK.

## 5. Spec and plan

If this part showed the spec or plan should change, list the changes for `/spec-change`. Don't edit `docs/spec.md` or `docs/plan.md` here.

## 6. Commit

- Check no file being committed contains a real-looking secret or a whole fake secret.
- Commit everything for this part, including the log updates, on the step branch, with message `part $ARGUMENTS: <one-line summary>` and the Co-Authored-By line. Don't push.
- Show me the commit (`git log -1 --stat`).

## 7. Next

Tell me the next part from `docs/progress.md` and remind me to run `/clear` and then `/next-part <id>`. If this was the last part of a step, suggest `/step-retro <step>` first.
