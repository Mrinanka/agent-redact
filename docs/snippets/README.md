# Backup lock snippets

Settings that run the backup lock (spec §5.2). They are built by `src/core/snippet.ts` and a test keeps these files equal to what it makes, so change the code, not the JSON.

| File | For | Differences |
|---|---|---|
| `personal.json` | A person, in their user settings (`~/.claude/settings.json`) | No `onFailure`: a hook that cannot start only warns |
| `managed.json` | An administrator, in the managed settings | `onFailure: "block"`, so a hook that cannot start stops the call; a `--policy` argument |

Replace the placeholders:

- `<CONFIG-FOLDER>/secret-shield/backup/backup/main.js`: where `/redact backup` copied the build (the command prints the real path). An administrator who installs it some other way puts the folder `plugin/backup/` anywhere that holds `secret-shield` in its path and points here at its `backup/main.js`.
- `<PATH-TO-MANAGED-SETTINGS-COPY>.json`: only for settings that reach machines by MDM or from the server, which a process cannot read. A copy of that policy (the same JSON, with its `secretShield` key). Leave the two arguments out when the policy is a `managed-settings.json` file on the machine.

Node must be on the PATH of the machine. `/redact doctor` says whether it is, and whether the hooks set `onFailure`.

The full guide for administrators is `docs/managed.md`, written in step 6.
