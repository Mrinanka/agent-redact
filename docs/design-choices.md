# Design choices

The two most important design choices of each step, explained in plain language. Written by `/verify`. The full record of decisions is in `decision-log.md`.

## Step 0

**1. Test Claude Code against a fake model on this computer, not the real one (D-020).**
Most of the facts we needed were about what Claude Code sends to the model. So I wrote a tiny local server that pretends to be the model: it answers with scripted replies ("read this file", "run this command") and records the *shape* of every request, never its content. Claude Code points at it with one setting (`ANTHROPIC_BASE_URL`) and a dummy key. That made the checks free, offline, identical on every run, and quick to repeat when Claude Code updates. It also became the first draft of the leak test kit in step 1. The trade-off: it only covers scripted runs (`claude -p`), so the interactive terminal, VS Code and the desktop app were still checked by hand.

**2. Let the operating system lock saved secrets, instead of writing our own encryption (D-023).**
The plan was to encrypt saved secrets with AES inside the plugin. Step 0 showed the plugin's runtime has no AES at all, only hashing and random numbers. The options were to hand-write AES, to make Node do it, or to hand the whole list to the OS password store (Windows DPAPI, macOS Keychain, Linux Secret Service). Hand-written crypto in a security tool is a classic mistake, and Node isn't on every machine. The OS store is built for exactly this job, and on Windows it took under a second. The trade-off: three small OS-specific code paths, and macOS and Linux are only confirmed in step 1.
