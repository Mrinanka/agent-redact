---
description: Check whether secret-shield is really running here. Works even when its hooks are off.
disable-model-invocation: true
---

Tell the user exactly this, and do not soften it:

secret-shield's hooks are NOT running in this session, so secrets are NOT being hidden.

When its hooks run, the tool answers this command itself, so you are only reading this because they did not load. Likely causes:

- A project or local setting has `disableAllHooks`.
- Your organization sets `allowManagedHooksOnly`.
- Claude Code was started with `--safe-mode` or `--bare`, or with `CLAUDE_CODE_SIMPLE=1`.

Do not type a secret into this session, not even after `/redact`. Remove the cause and start a new session, then run this command again.
