# Plan: building secret-shield (working name)

How we build the tool described in `spec.md`, and how we prove it works.

- **Status:** draft.
- **Last updated:** 31 October 2026.

---

## The approach in short

1. **Test first.** Build the leak tests before the features, so every feature is proven the day it's added.
2. **One checker, one language.** v1 is written entirely in TypeScript. The main lock and the backup lock use the same checker, so they always agree.
3. **Measure, don't assume.** Speed, catch rate and false alarms are measured on every change and published.
4. **Anyone can repeat our tests.** Every test we run, an adopter can run on their own machine, with no API key and no network.

## Ground rules

- **Gitleaks rules:** copied into the repo at a fixed version, reviewed, credited in `THIRD_PARTY_LICENSES`, and updated on our schedule, never automatically.
- **Dependencies:**
  - None at runtime.
  - Build and test tools are dev dependencies, pinned with a lockfile.
- **Testing:** done against fixed Claude Code versions, never just "latest".
- **CI:** GitHub Actions on macOS, Windows and Linux, with actions pinned to commit IDs (not tags).
- **Releases:** semantic versions, signed tags, SHA-256 checksums.
- **Fake secrets only:** built at test time from pieces, never written whole in a file.

---

## Step 0: Check the facts on a local machine

The design depends on how Claude Code behaves. Some of it was confirmed by reading the mod API types in Claude Code 2.1.316. The rest must be confirmed by running it. All of this works on a personal computer.

| # | Check | Why it matters (spec section) |
|---|---|---|
| 0.1 | `session.append` sees every row: prompt, tool result, failed-command error, `@` attachment, compaction summary, subagent rows | All hiding depends on it (5.1, 6) |
| 0.2 | A **user-tier** plugin's `prompt.mention` hook can redirect an `@` file to a redacted copy | Closes the Personal-mode `@` gap (5.3) |
| 0.3 | `/resume`: what is sent, and can a plugin read the loaded history before the first request? | Resume protection (6.1, R-06) |
| 0.4 | The mod runtime has WebCrypto (AES-GCM, secure random), and `$.process` can call `security`, PowerShell DPAPI and `secret-tool` | Secret storage (8.1, R-10) |
| 0.5 | Image and document blocks can be dropped at `session.append` | `media: drop` (6) |
| 0.6 | A hook over 10 s is skipped; a `.catch` handler gets 1 s; what happens after repeated worker crashes | Failure handling (12, 17) |
| 0.7 | Under `allowManagedHooksOnly`, a user-tier plugin loads no hooks, and how the tool can detect that | `doctor`, R-05 |
| 0.8 | In safe mode, settings hooks (the backup lock) still run | Backup lock (5.2) |
| 0.9 | Settings hooks can change a tool's input (`PreToolUse`), and whether they can rewrite a built-in tool's output (`PostToolUse`) | Backup lock limits (5.2) |
| 0.10 | A plugin hides content in the VS Code panel and the desktop Code tab | Surfaces (4) |
| 0.11 | Claude Code accepts a local mock API through `ANTHROPIC_BASE_URL` (what env and auth it needs) | The leak test kit (20) |
| 0.12 | The lowest Claude Code version where all of the above work | Tested versions (4) |
| 0.13 | Node is available where the backup lock runs. If not, we ship it as a single program file. | Backup lock |

### Simulating Managed mode on your own computer

You don't need an organization to test Managed mode:
1. With admin rights, create the managed settings file at the system location for your OS. Claude Code's docs list the paths (on Windows, under `C:\Program Files\ClaudeCode\`).
2. Put the plugin in it in the `prepend` tier, with locked settings and `allowManagedHooksOnly`.
3. Better still, do this in a throwaway VM (Windows Sandbox, UTM or VirtualBox), so your own setup stays clean.

This tests checks 0.2, 0.7 and the Managed-mode rows of spec 5.3 the way an organization would see them.

**Delivers:** `docs/findings-step0.md` (each check: yes or no, Claude Code version, OS, how it was tested) and a GitHub repo.

**Done when:** every row has a confirmed answer. If any answer is "no", update `spec.md` before going further.

---

## Step 1: Build the tests first

### 1a. Leak test kit (the most important test)

1. **Make fake secrets.** Each fake is unique, easy to search for, and built from pieces at test time.
2. **Mock model server.** A small Node server (built-ins only) that pretends to be the model API:
   - plays a scripted conversation of tool calls
   - records every request Claude Code sends
   - Claude Code is pointed at it with `ANTHROPIC_BASE_URL`
   - no API key, no cost, no network, same result every run
3. **Plant the fakes everywhere:**
   - typed and pasted messages
   - files Claude reads, `@` files
   - command output and failed-command errors
   - connected tools (MCP)
   - subagents
   - long chats that get compacted
   - `/resume` of a session recorded without the tool
4. **Search the recording for any fake.** Any hit is a failure.
5. **Search the disk too.** Search `~/.claude` and record what Claude Code keeps on disk. This is reported, not failed, since some of it is outside our control.
6. **Optional real run.** The same scenarios against the real API, run by the maintainer before each release.

Run it in the terminal, VS Code, the desktop app and `-p` runs, on each tested Claude Code version and on macOS, Windows and Linux.

The kit lives in `tools/leak-test/` and is part of the release, so adopters can run it (spec 20).

### 1b. Test sets for catching secrets

| Set | Purpose | Contents |
|---|---|---|
| **Catch set** | Measure how much we catch | Realistic fake secrets in many places: env files, JSON, YAML, logs, URLs, connection strings, stack traces, escaped JSON, base64. Cloud, CI, artifact-repository and data-platform key formats, connection strings, short human passwords. |
| **Code set** (new) | Prove labels don't hide normal code | `password: string`, `token = getToken()`, Python `pass`, `os.environ[...]`, type hints, template variables. Must stay unhidden (spec 7.2, R-08). |
| **Hidden set** | Honest score | Written before tuning, kept out of the repo's tuning scripts, scored once per release. Never tuned against. |
| **False-alarm set** | Measure how often harmless text gets hidden | Tens of thousands of normal files from public open-source projects (licenses recorded) |

### 1c. Speed set

- Short messages.
- 100 KB and 2 MB logs.
- One huge line of JSON.
- A large base64 block with a secret in the middle.
- 10,000 registered secrets.
- Inputs designed to slow patterns down.

**Delivers:** all of the above, running automatically in CI on three operating systems.

**Done when:** the tests run against an "empty" tool and correctly report every fake secret as leaked.

---

## Step 2: Build the checker

Build in this order, testing each part before moving on:

1. **Gitleaks rule converter** (runs at build time)
   - Turns Gitleaks patterns into JavaScript patterns. Some (38 of 222 in the version checked) don't work as-is.
   - Works out from each pattern: its required keywords, its longest possible match, and whether it can span lines.
   - Checks that each pattern can't get stuck, and rewrites or rejects any that can.
   - Every rule gets its own test.
2. **Keyword finder.** Reads the text once and finds all keywords at the same time.
3. **Pattern runner.** Runs only the patterns whose keywords were found, only on the area around each hit.
4. **Password labels.** The exact grammar in spec 7.1, plus the harmless values in 7.2. Must pass the code set.
5. **Registered-secret store and matcher**
   - Encrypted file plus key in the OS password store (spec 8.1), using the Step 0.4 result.
   - Aho-Corasick over the secrets and their encoded forms.
6. **Decoder.** Decodes only what looks encoded, in pieces, at most 3 layers.
7. **Repeated-line skip.** Cleared when a new secret is registered.
8. **Custom rules and per-rule actions** from settings, with the "can't get stuck" check (R-15).

**Done when:**
- Catch, code and false-alarm results are recorded.
- Speed targets are set from first measurements, written into the repo, and met.
- No pattern can get stuck.
- Each part has its own tests.

---

## Step 3: Build the main lock (mod)

1. **Hide secrets** at `session.append` and `prompt.submit` (spec 5.1).
2. **`@` files** through `prompt.mention` (spec 5.3).
3. **Placeholders** with hints and tags, shared with subagents, plus the stable instructions note (spec 9).
4. **Placeholder-in-file notice and overwrite guard** (spec 10, R-11).
5. **Outbound check** with `block`, `ask`, `warn`, `off` and `/redact allow` (spec 11).
6. **Check-failure behaviour** with `.catch` handlers (spec 12, R-03, R-12).
7. **Resume scan** and **mid-session registration warning** (spec 6.1, 6.2).
8. **Media** `pass` / `drop` (spec 6).
9. **Observe mode** with the banner (spec 13).
10. **Self-protection** (spec 17).
11. **"I'm running" marker** (R-04).
12. **Settings:** three levels, "stricter only" rules, validation, admin locks (spec 14).
13. **Commands:** `/redact`, `add`, `learn`, `allow`, `self-check [--report]`, `doctor` (spec 15).
14. **Log** (spec 16).
15. **Version check** on startup (R-01).

**Done when:**
- The leak test shows zero leaks for everything the spec says v1 covers.
- All commands work.
- `claude plugin validate` and `claude plugin test` pass.
- The maintainer has used it for their own daily work for at least two weeks.

---

## Step 4: Build the backup lock

1. **Settings hooks:**
   - before each tool: outbound check
   - after each tool: clean the output where Step 0.9 allows; otherwise rewrite the input before it runs
   - on each prompt: block prompts with secrets
2. **Same checker** as the main lock, run with Node.
3. **Only act when needed.** Each hook looks for the main lock's marker and does nothing when it is there.
4. **Block on failure** or not, following `on_check_failure`.
5. **Install snippets** for Personal mode (`~/.claude/settings.json`) and Managed mode.

**Done when:** the leak test passes in safe mode, within the backup lock's limits (prompts blocked rather than partly hidden).

---

## Step 5: Pilot

1. **The maintainer and volunteers** install it in Personal mode.
2. **Managed trial** in the Step 0 VM, and with any organization that volunteers, starting in `observe` mode.
3. **Collect false alarms** through `/redact allow` usage, the log and GitHub issues with `doctor` output. The log contains no secrets, so it's safe to share.
4. **Tune** the rules and harmless-value list on the catch, code and false-alarm sets, never on the hidden set.
5. **Test a "looks random" check** (spec 7.3). Add it only if it catches more without many more false alarms.

**Done when:**
- False alarms are at or below the published target.
- No speed complaints.
- The hidden set has been scored once and recorded.

---

## Step 6: Open-source release

1. **Repo files:**
   - `LICENSE` (Apache-2.0), `NOTICE`, `THIRD_PARTY_LICENSES` (Gitleaks, MIT)
   - `SECURITY.md`, `CONTRIBUTING.md` (DCO), `CODE_OF_CONDUCT.md`
   - issue templates (bug report asks for `doctor` output and the self-check report)
2. **Plugin marketplace:** `.claude-plugin/marketplace.json`, with install tested from a clean machine.
3. **Docs:**
   - `README` (what it does, 2-minute install, limits)
   - `docs/personal.md`, `docs/managed.md`, `docs/verify.md` (running the leak test kit), `docs/troubleshooting.md`
4. **Results:** compatibility matrix and scores for this release.
5. **Release:** signed tag, archive, checksums, changelog.
6. **Final name** chosen and checked (spec header).

**Done when:** a person who has never seen the project can install it, run `/redact doctor`, `/redact self-check` and the leak test kit, and get passing results by following the README alone, on all three operating systems.

---

## Release rules (every release)

| Rule | Type |
|---|---|
| Zero fake secrets leaked in the leak test, for everything v1 covers | **Hard rule, blocks release** |
| Speed within published targets | Blocks release |
| Catch rate on the catch set not lower than last release | Blocks release |
| False alarms not higher than the published limit; code set fully unhidden | Blocks release |
| All tests pass on every tested Claude Code version and all three operating systems | Blocks release |
| Compatibility matrix and scores published | Blocks release |
| Hidden set scored once and recorded | Reported |

Targets for speed, catch rate and false alarms are set by the maintainer after Step 2's first measurements and published in the repo. Any change to a target is noted in the changelog.

---

## Risks and how we handle them

| Risk | How we handle it |
|---|---|
| A Claude Code update changes how plugins work | Test on fixed versions; publish a tested-versions list; startup warning on untested versions (R-01) |
| A pattern gets stuck and the hook is skipped | Build-time checks, small search areas, speed tests, `.catch` handlers. The backup lock steps in if the plugin goes down. |
| Too many false alarms, people turn it off | Code set, false-alarm set, observe-mode trials, `/redact allow`, admin locks |
| A check fails and content passes (default setting) | Visible warning and log entry every time. Admins can switch to `hold`. |
| Gitleaks rule updates bring bad or slow patterns | Fixed version, review every update, full tests before accepting |
| Claude Code's own records keep raw values on disk | Documented in the spec. Reported to Anthropic. |
| Users think they're protected when hooks are disabled by policy | `doctor`, startup warning, README section (R-05) |
| An organization can't get support | Self-verification kit, clear docs, `doctor` output in issues; support is best effort and says so |
| Node missing on some machines | Checked in Step 0. Single-program fallback for the backup lock. |

---

## Later (not in v1)

See spec section 23.
