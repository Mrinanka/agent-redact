---
name: review-part
description: Adversarial review of a finished part by a fresh subagent, against the spec.
argument-hint: <part id, e.g. 2.4>
disable-model-invocation: true
---

Review part **$ARGUMENTS** before we wrap it up.

## 1. Gather

- The part's row in `docs/progress.md` (spec §, plan step, done when).
- What changed: `git diff` and `git diff --staged` against the last commit, plus new untracked files (`git status --short`).

## 2. Launch one fresh general-purpose subagent

Give it the paths and section numbers (not your summary of them), the list of changed files, and these instructions, word for word:

> You are reviewing part $ARGUMENTS of an open-source tool that hides secrets from Claude Code. Read the spec sections and plan step named above in `docs/spec.md` and `docs/plan.md`, then the changed files and their tests.
> Your job is to **find problems, not to approve**. Try to break it.
> Check:
> 1. Every R-id and requirement in scope has a test that would **fail** if the requirement broke. Name any that don't.
> 2. Missed cases from the spec: edge cases, encodings, empty or huge input, Unicode, CRLF line endings.
> 3. Weak tests: ones that are tautological, skipped, assert too little, or pass for the wrong reason.
> 4. Leaks: could a secret (or a whole fake secret) reach a log, error message, report, temp file, notice or commit?
> 5. Failure paths: patterns that can get stuck, missing `.catch` handlers, timeouts, behaviour when a file or the OS password store is missing.
> 6. Portability: Windows paths, path separators, shell assumptions, line endings.
> 7. Rules: any runtime dependency, any network call, code copied from elsewhere without credit.
> 8. Mismatches with `docs/decision-log.md` accepted decisions.
> Report each finding as **must-fix / should-fix / nit**, with `file:line`, a concrete failing scenario (input → wrong result), and a suggested fix.
> Back every finding and fix with evidence: the spec § or R-id it violates, a reproduction (a test you could write, or a command you ran), or official docs (URL + section). Mark anything you couldn't verify as "unverified" and say how to verify it.
> Do not edit any file. If you find nothing in a category, say so.

## 3. Report to me

- Show the findings grouped by severity.
- **Check each finding yourself** before passing it on: confirm the `file:line` and the failing scenario. Drop false positives, and say which you dropped and why.
- For each remaining finding, give your recommendation (**fix now / defer / reject**), with the evidence and your confidence, following "Questions and recommendations" in `CLAUDE.md`.
- Ask which to fix with the AskUserQuestion tool, your recommendations pre-stated. Change nothing until I answer.
- For each finding I **reject**, note it as a **DECISION** with my reason, so `/wrap-up` logs it and nobody raises it again.
- After the fixes, re-run the full suite and show the result.

Also remind me that the built-in `/code-review` is available for a general bug hunt on the same diff.
