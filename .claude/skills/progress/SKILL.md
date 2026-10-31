---
name: progress
description: Show where the project stands and which part comes next.
disable-model-invocation: true
---

Read `docs/progress.md`. Don't change any file.

Report briefly:

1. **Done:** the parts ticked so far, grouped by step (one line per step is enough).
2. **Next:** the first unticked part whose dependencies are all ticked. Give its ID, name, spec §, plan step and "Done when". If several are ready, list them.
3. **Blocked:** unticked parts whose dependencies or [Step 0] confirmations are missing, and what they wait for (check `docs/findings-step0.md`).
4. **Open items:**
   - decisions in `docs/decision-log.md` with status `proposed`
   - lessons in `docs/lessons.md` marked as needing follow-up
   - `/spec-change` items listed in the latest session notes and not yet applied
5. **Current branch** (`git branch --show-current`) and whether the working tree is clean (`git status --short`).

End with a recommendation (see "Questions and recommendations" in `CLAUDE.md`): the exact command to run next (e.g. `/next-part 0.B`) and why. As evidence, cite the `progress.md` rows that show its dependencies are done and that nothing more urgent is pending. If several parts are ready, recommend one, and give the reason (e.g. it unblocks the most parts).
