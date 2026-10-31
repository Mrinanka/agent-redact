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
- 2026-10-31 / 0.0 / `[claude-code]`: A mod module and every file it imports must sit inside the plugin folder, and it runs with no Node (mod API types header, Claude Code 2.1.316) → plan for copying or bundling `src/checker/` into `plugin/` in part 3.1; keep `plugin/` out of the Node typecheck. (follow-up)
- 2026-10-31 / 0.0 / `[testing]`: Git for Windows sets `core.autocrlf=true` system-wide, so a Windows clone would get CRLF while macOS and Linux get LF, and regex anchors, offsets and fixture sizes would differ by OS. An independent review caught it → `.gitattributes` with `* text=auto eol=lf`; test CRLF input on purpose with fixtures built in the test.
- 2026-10-31 / 0.0 / `[testing]`: In Git Bash on Windows, `grep -c $'\r'` reported every line of pure-LF files as CRLF → count line endings with Node or `git ls-files --eol`, not grep.
- 2026-10-31 / 0.0 / `[process]`: `/next-part` run without a part id didn't stop; the skill went ahead with a blank id → the skill could check for an empty argument and ask. (follow-up)
- 2026-10-31 / 0.A / `[testing]`: In `claude plugin test`, a test's own `session.append` hook that answers without calling `next` gets skipped ("returned an answer without next") → record rows with `mock.session(on)`.
- 2026-10-31 / 0.A / `[testing]`: If a test's hook for a `$` call (e.g. `fs.write`) throws, the plugin's call rejects → that's how to simulate a failing write or read.
- 2026-10-31 / 0.A / `[claude-code]`: `claude -p --allowedTools Read "<prompt>"` failed with "Input must be provided": `--allowedTools` takes several values and swallowed the prompt → put the prompt first.
- 2026-10-31 / 0.A / `[claude-code]`: The first `-p` probe run showed a `queue` row before the `session.start` hook finished, a prompt origin of `unclassified` rather than `sdk`, and attachment rows with no blocks → confirm in 0.B before relying on any of it. (follow-up)
- 2026-10-31 / 0.A / `[process]`: In `/next-part`, Claude treated the owner's answers to the design questions as approval of the plan, but the skill asks for an explicit approval → put "Approve the plan" in the same question dialog.
