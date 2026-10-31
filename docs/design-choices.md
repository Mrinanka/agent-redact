# Design choices

The two most important design choices of each step, explained in plain language. Written by `/verify`. The full record of decisions is in `decision-log.md`.

## Step 0

**1. Test Claude Code against a fake model on this computer, not the real one (D-020).**
Most of the facts we needed were about what Claude Code sends to the model. So I wrote a tiny local server that pretends to be the model: it answers with scripted replies ("read this file", "run this command") and records the *shape* of every request, never its content. Claude Code points at it with one setting (`ANTHROPIC_BASE_URL`) and a dummy key. That made the checks free, offline, identical on every run, and quick to repeat when Claude Code updates. It also became the first draft of the leak test kit in step 1. The trade-off: it only covers scripted runs (`claude -p`), so the interactive terminal, VS Code and the desktop app were still checked by hand.

**2. Let the operating system lock saved secrets, instead of writing our own encryption (D-023).**
The plan was to encrypt saved secrets with AES inside the plugin. Step 0 showed the plugin's runtime has no AES at all, only hashing and random numbers. The options were to hand-write AES, to make Node do it, or to hand the whole list to the OS password store (Windows DPAPI, macOS Keychain, Linux Secret Service). Hand-written crypto in a security tool is a classic mistake, and Node isn't on every machine. The OS store is built for exactly this job, and on Windows it took under a second. The trade-off: three small OS-specific code paths, and macOS and Linux are only confirmed in step 1.

## Step 1

**1. A test that can't pass by doing nothing: the witness and the baseline.**
A leak test has a trap built in. If Claude Code crashes, or a scenario never reads the file, no secret reaches the fake model and the test says "clean". So a silent failure looks exactly like success. I closed that from both sides. Next to each planted fake sits a harmless random word, a witness; if it never shows up in a request, that door wasn't really used, and the run is reported invalid, never clean. And before any hiding tool exists, the kit runs against an empty plugin and must see every single fake, 98 of 98, on all three OSes. That proves the kit can see before we trust it when it says it saw nothing. The trade-off: a future setting that withholds a whole file would also remove the witness, so that case will need its own handling.

**2. Search in memory, and keep labels only.**
The spec said the mock server "records every request", and the Step 0 mock wrote a recording. But a recording of requests is a file full of secrets, which is the exact thing this project exists to prevent, even when the secrets are fake. So the kit searches each request as it arrives, for every form a secret can take (plain, escaped, base64 at all three alignments, URL-encoded, hex), then drops the body and keeps only labels such as "door, kind of key, where it was found". The report is checked for fakes once more before it's printed. Searching on arrival also fixed gaps in the old mock, which skipped unknown paths and token-count calls and couldn't read compressed bodies. The trade-off: you can't go back and re-search an old run, but a rerun is free and takes about 30 seconds.
