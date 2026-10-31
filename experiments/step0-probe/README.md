# step0-probe

A throwaway Claude Code mod for the Step 0 checks (`docs/findings-step0.md`). It is not part of the product.

For every row that passes `session.append` it writes one JSON line: the row's door, kind, role, origin, ids and the **size** of each block. It never writes content: everything comes from an allow-list, and any string that doesn't look like an identifier is written as `(odd)`. By default it passes every row on unchanged.

## Opt-in checks (version 0.2.0)

Each check is **off** unless its marker file `<cwd>/.step0-probe/on-<name>` exists. When on, it may change what the model sees, on purpose, and writes `{"kind":"check", ...}` lines (booleans, numbers and labels only).

| Marker | Check | What it does |
|---|---|---|
| `on-mention` | 0.2 | Points an `@` file at a copy with its canaries replaced by `[HIDDEN]`; refuses the mention if the copy can't be made |
| `on-resume` | 0.3 | Logs what `$.session.messages()` holds at `session.start` and the first `turn.start` (counts only) |
| `on-resume-hold` | 0.3 | With `on-resume`: holds the first main request (answers `turn.step` without sending it) |
| `on-runtime` | 0.4, 0.13 | Logs whether AES-GCM and secure random exist, a DPAPI round trip through PowerShell, whether `security` / `secret-tool` / `node` run |
| `on-media` | 0.5 | Replaces image and document blocks with a text note |
| `on-store` | 0.4 | Round trip through DPAPI, macOS Keychain and Linux Secret Service at 1 KB, 64 KB and 1 MB, cleaned up after. Logs labels and sizes only |
| `on-budget` | 0.6 | Misbehaves on purpose when a row holds `BUDGET-THROW`, `-CPU`, `-AWAIT`, `-SLEEP` or `-CATCHSLOW` |
| `on-hide` | 0.10 | Replaces canaries with `[HIDDEN]` in every row before it is stored |

Canaries are `CANARY-` plus 16 hex digits, made at run time by `experiments/step0-mock/`. The plain command `/step0-probe:step0-status` (check 0.7) has no hooks, so it shows whether the plugin's non-hook parts load.

Headless runs against a local mock of the model API: `node experiments/step0-mock/run.ts <scenario|all>`. Hand-run checks: `node experiments/step0-mock/manual.ts setup <dir> [markers]`. Loading the probe in VS Code or the desktop app makes Claude Code write `tsconfig.json` and `.claude-plugin/types/` here; delete them afterwards.

## Run it

Use a scratch folder, not a real project. The log is written to the folder the session runs in.

```
cd <some scratch folder>
claude --plugin-dir "<repo>/experiments/step0-probe"
```

Or headless: `claude -p --plugin-dir "<repo>/experiments/step0-probe" "Reply with ok"`.

The log is `<cwd>/.step0-probe/<session id>.jsonl`:

- `{"kind":"start", ...}`: one per load. It holds the probe version, the engine version (`claude --version`), the surface and whether the session is interactive. A reload adds another.
- `{"kind":"row", ...}`: one per row, with `seq`, `t`, `door`, `type`, `name`, `role`, `isMeta`, `origin`, `uuid`, `agentId` and `blocks`, each block as type plus size (`chars`, `inputChars`, `isError`, `parts`, `mediaType`).

## Test it

```
claude plugin test ./experiments/step0-probe
claude plugin validate ./experiments/step0-probe
```

License: Apache-2.0, like the rest of the repo.
