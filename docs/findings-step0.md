# Step 0 findings

What is actually true about Claude Code, with evidence. Filled in during step 0 (`/plan-step`). The spec relies only on rows marked **yes** (or **partly**, within the stated limits).

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
| 0.12 | What is the lowest Claude Code version where all of the above work? | parked (spec §23, D-019) | | | | | | |
| 0.13 | Is Node available where the backup lock runs? | pending | | | | | | |

## Managed-mode simulation recipe

*(Filled in during step 0: exact managed-settings file location and contents used, VM or Windows Sandbox setup, and what was observed.)*

## The probe (part 0.A)

`experiments/step0-probe/` is a mod that writes one JSON line per `session.append` row: door, type, name, role, isMeta, origin (kind plus tool, model, event or name), uuid, agentId, and each block's type and size. It never writes content. It is the evidence source for 0.1, 0.5, 0.10 and later checks. See its `README.md`.

- **Load:** run `claude --plugin-dir "<repo>/experiments/step0-probe"` from a scratch folder (add `-p "<prompt>"` for headless).
- **Log:** `<cwd>/.step0-probe/<session id>.jsonl`. A `start` line (probe version, engine version, surface, interactive) is written per load, then one `row` line per row.
- **Evidence for a row:** quote the log lines or a tally (for example, the count per door). Lines hold sizes and ids only, so they can be pasted as they are.
- **Re-check:** rerun the same scenario with the new `claude --version` and compare the tallies.
- **Self-test:** `claude plugin test ./experiments/step0-probe` (10 tests, including "a planted fake appears in no write").

## Notes

*(Anything learned during the checks that doesn't fit a row.)*

- 2026-10-31 / 0.A, first real run (2.1.316, Windows 11, `claude -p`, prompt "read a file, reply with its first word"): 17 rows. By door: 1 `queue`, 1 `prompt`, 12 `attachment`, 2 `response`, 1 `tool-result`. A grep of the log for the file's words and the reply found nothing. Observations for later checks, **not yet checked**:
  - The `queue` row was logged before the probe's `session.start` header.
  - Under `-p` the prompt row's origin was `unclassified`, not `sdk`.
  - Some attachment rows (`credential_org`, `prompt_snapshot`) carry no blocks and no role.
