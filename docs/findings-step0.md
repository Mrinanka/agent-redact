# Step 0 findings

What is actually true about Claude Code, with evidence. Filled in by `/step0-check`. The spec relies only on rows marked **yes** (or **partly**, within the stated limits).

**Rules:**
- **Result:** `yes` / `no` / `partly` / `pending`.
- **Version:** the output of `claude --version`.
- **Evidence:** a short log excerpt or observation. Never a secret, not even a whole fake one.
- **Re-check:** re-check a row when the tested Claude Code version changes and the release notes touch plugins or hooks.

| Check | Question | Result | Version | OS | Surface | Method | Evidence | Spec impact |
|---|---|---|---|---|---|---|---|---|
| 0.1 | Does `session.append` see every row: prompt, tool result, failed-command error, `@` attachment, compaction summary, subagent rows? | pending | | | | | | |
| 0.2 | Can a **user-tier** plugin's `prompt.mention` hook redirect an `@` file to a redacted copy? | pending | | | | | | |
| 0.3 | On `/resume`, what is sent, and can a plugin read the loaded history before the first request? | pending | | | | | | |
| 0.4 | Does the mod runtime have WebCrypto (AES-GCM, secure random), and can `$.process` reach `security`, PowerShell DPAPI and `secret-tool`? | pending | | | | | | |
| 0.5 | Can image and document blocks be dropped at `session.append`? | pending | | | | | | |
| 0.6 | Is a hook over 10 s skipped? Does `.catch` get 1 s? What happens after repeated worker crashes? | pending | | | | | | |
| 0.7 | Under `allowManagedHooksOnly`, does a user-tier plugin load no hooks, and how can the tool detect that? | pending | | | | | | |
| 0.8 | In safe mode, do settings hooks (the backup lock) still run? | pending | | | | | | |
| 0.9 | Can settings hooks change a tool's input (`PreToolUse`)? Can they rewrite a built-in tool's output (`PostToolUse`)? | pending | | | | | | |
| 0.10 | Does the plugin hide content in the VS Code panel and the desktop Code tab? | pending | | | | | | |
| 0.11 | Does Claude Code run against a local mock API via `ANTHROPIC_BASE_URL`? What env and auth does it need? | pending | | | | | | |
| 0.12 | What is the lowest Claude Code version where all of the above work? | pending | | | | | | |
| 0.13 | Is Node available where the backup lock runs? | pending | | | | | | |

## Managed-mode simulation recipe

*(Filled in during part 0.F: exact managed-settings file location and contents used, VM or Windows Sandbox setup, and what was observed.)*

## Notes

*(Anything learned during the checks that doesn't fit a row.)*
