# step0-probe

A throwaway Claude Code mod for the Step 0 checks (`docs/findings-step0.md`). It is not part of the product.

For every row that passes `session.append` it writes one JSON line: the row's door, kind, role, origin, ids and the **size** of each block. It never writes content: everything comes from an allow-list, and any string that doesn't look like an identifier is written as `(odd)`. It passes every row on unchanged.

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
