# Troubleshooting

Start with `/redact doctor`. If `/redact` is not a command, the hooks are not running: use `/aegiscontext:doctor`, which still answers and says why.

## `/redact` does not exist

The plugin's hooks are not running. Common causes:

- The session started before the install. Restart it.
- `--safe-mode`, `--bare` or `CLAUDE_CODE_SIMPLE=1` is on.
- A project's `.claude/settings.json` sets `disableAllHooks`.
- Your organization sets `allowManagedHooksOnly`. A user-installed plugin loads no hooks then; ask your administrator for the organization install ([managed.md](managed.md)).

In all these cases the main lock is off. The backup lock, if installed as managed hooks, still runs in safe mode.

## doctor says "some events are passed over this plugin"

Claude Code's built-in guard routes project instruction files, attachments and compaction summaries past a user-installed plugin on machines with managed settings or a Team or Enterprise login. Nothing the plugin does can change that. Ask your administrator for the organization install ([managed.md](managed.md)).

## doctor says the password store is missing or locked

- **Linux:** install `libsecret-tools` and a keyring (for example `gnome-keyring`), and unlock it. Over SSH or in a container there may be no keyring.
- **macOS:** unlock the login Keychain.
- **Windows:** needs PowerShell; check that `powershell` runs.

Until it works, saved secrets are not being hidden by value (shapes and labels still are).

## doctor says Claude Code is not on the tested list

It keeps working. Run `/redact self-check` and, if it passes, carry on. Tested versions: [tested-versions.md](tested-versions.md).

## Too many false alarms

Run in `observe` mode for a few days and read the log (`<Claude folder>/aegiscontext/log/`). Use `/redact allow <tag>` for one value, `allow` for patterns, or `rules.off` for a rule that does not suit your code. Details: [personal.md](personal.md).

## A request was held, or "history contains N secrets"

A resumed session held secrets from before the plugin was installed, and sending them again would leak them. Rotate those secrets. `/redact allow` with no tag lifts the hold for the next message.

## The backup lock does not act

It stands down while the main lock is alive. If doctor says the hooks are missing, run `/redact backup`. It needs Node on the PATH. In Managed mode check that the hooks set `onFailure: "block"`.

## Reporting a bug

Open an issue with the output of `/redact doctor` and the file from `/redact self-check --report`. Never paste a real secret. A secret that reached the model is a security report: [SECURITY.md](../SECURITY.md).
