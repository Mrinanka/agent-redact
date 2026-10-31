# secret-shield (working name)

A Claude Code plugin that hides secrets before the model sees them. Every message you type, every file Claude reads, every command output and every piece of project context is checked, and each secret is replaced by a placeholder such as `[REDACTED:AWS_KEY ...0001 #k7q2m5x4p3abc]`. Claude can still work: it knows a secret is there, but never sees the value.

It uses no network, has no runtime libraries, and never writes a secret to disk unencrypted. Settings go under a `secretShield` key in Claude Code's settings files. See the repository's `docs/spec.md` for the full design.
