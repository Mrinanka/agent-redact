# Lessons

What surprised us, what went wrong, and what we'd do differently. Short entries, newest last.

**Tags:**
- `[claude-code]`: how the platform really behaves
- `[detection]`: false alarms and misses
- `[perf]`: speed
- `[testing]`: how we test
- `[process]`: how we work with Claude

**The learning loop:** a `[process]` lesson that happens twice becomes a rule in `CLAUDE.md`. `/wrap-up` proposes it, and `/step-retro` reviews all lessons for patterns.

**Format:** `- YYYY-MM-DD / part / [tag]: what happened → what to do next time`

**Follow-up:** add `(follow-up)` to an entry that still needs action; `/progress` lists those.

---

- 2026-10-31 / setup / `[claude-code]`: Rows loaded by `/resume` don't pass through `session.append`, so a resumed session can resend raw secrets → handle resume explicitly (spec §6.1, check 0.3). (follow-up)
- 2026-10-31 / setup / `[claude-code]`: What a thread has sent is fixed; a mod can't change earlier messages. Registering a secret mid-session can't un-send it → warn and suggest rotating (spec §6.2).
- 2026-10-31 / setup / `[claude-code]`: Hooks fail **open**. A hook that throws, returns a wrong shape or exceeds its 10 s budget is skipped. Guards need a `.catch` handler (1 s grace) to fail closed → every refusing hook carries `.catch` (R-03).
- 2026-10-31 / setup / `[claude-code]`: Under `allowManagedHooksOnly`, a user-tier plugin loads no hooks at all → `doctor` must detect and say it (R-05). (follow-up)
- 2026-10-31 / setup / `[claude-code]`: The mod runtime has no Node or DOM; everything goes through `$` → don't assume Node APIs (crypto, fs, keychain) inside the mod (check 0.4). (follow-up)
- 2026-10-31 / setup / `[process]`: The first draft rested on platform facts (version numbers, plugin behaviour) taken from docs and other people's reports, and some couldn't be confirmed → confirm platform facts with a probe (Step 0) before designing on them, and mark unconfirmed ones [Step 0] in the spec.
