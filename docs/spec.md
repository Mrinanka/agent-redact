# Spec: secret-shield (working name)

An open-source tool that stops secrets from reaching the model when developers use Claude Code.

- **Status:** draft.
- **License:** Apache-2.0.
- **Last updated:** 31 October 2026.
- **Maintainer:** (your name)

**How to read this spec.** Requirements a build must meet have an ID (`R-01`) and the word **must**. Tests in `plan.md` point to these IDs. **Should** means strongly recommended but not release-blocking. Anything marked **[Step 0]** is a belief about Claude Code that must be confirmed on a real machine before building on it (see `plan.md`, Step 0).

**About the name.** "secret-shield" is a working name. Before the first public release, pick a final name that:
- does not contain "Claude" or "Anthropic" (trademarks; "for Claude Code" in the description is fine)
- is free on GitHub and npm and not used by another secrets tool

---

## 1. What it does, in one paragraph

When a developer types a message, or Claude reads a file or command output, the tool looks for passwords, API keys and tokens. It swaps each one for a placeholder before the model sees it. Claude can still work normally: it knows a secret is there, but never sees the real value. The tool never writes real secrets back into files. Developers fill in real values themselves.

## 2. Goals and non-goals

**Goals**

- Very low chance of a secret reaching the model (measured; see section 20).
- Fast enough that nobody notices it running.
- Works with no setup, and is easy to change for people who want to.
- **Anyone can install it and prove to themselves that it works,** without help from the maintainers and without sending anything to the internet.
- Works for one developer on their own laptop (**Personal mode**) and for an organization that rolls it out to many machines (**Managed mode**).
- Every strict behaviour has a way out for false alarms.
- Simple: only features that clearly reduce risk.

**Not goals for v1**

- Other AI tools (Copilot, Cursor and so on). v1 is Claude Code only.
- Personal data like emails and phone numbers. Available as a setting, off by default.
- Reading inside images and documents. v1 can only pass them or drop them (section 6).
- Putting secrets back into files (possible v2 setting).
- Being a compliance certification. The tool reduces risk; it does not guarantee that no secret is ever sent.

## 3. Threat model

| | In scope | Out of scope |
|---|---|---|
| **Accidental leaks** | A developer pastes a key, Claude reads `.env`, a log prints a token, an error shows a connection string | — |
| **Prompt injection** | A web page, file or tool result tells Claude to turn the tool off, edit its settings, or send a known secret somewhere | — |
| **Deliberate people** | — | A person who splits up, scrambles or retypes a secret on purpose |
| **Other software on the machine** | — | Malware, other plugins in Personal mode (section 5.3), or someone with admin rights |
| **Claude Code's own disk records** | Documented (section 22) | Changing what Claude Code stores |

## 4. Where it works

| | v1 |
|---|---|
| **Surfaces** | The Claude Code terminal, the VS Code extension and the Code tab of the desktop app. Scripted runs (`claude -p`) too. |
| **Not covered** | claude.ai chat. Claude Code on the web and Agent SDK hosts, unless listed in the tested-versions list. |
| **Systems** | macOS, Windows and Linux, all first-class. That includes WSL and devcontainers. CI runs on all three. |
| **Claude Code versions** | A **tested versions** list is published with each release (section 20). v1 supports the Claude Code version pinned for testing (and newer, with the R-01 warning). Hunting for the lowest working version is parked (section 23, D-019). **[Step 0]** Earlier figures (2.1.287 for mods, 2.1.295 for "block if this check fails") have not been confirmed. Development so far has been checked against 2.1.316. |

- **R-01** At session start, the tool **must** show a one-line warning when the Claude Code version is not on its tested list, and keep working.

## 5. How it is built: a main lock and a backup lock

### 5.1 Main lock (the mod)

A Claude Code plugin with a hooks module, written in TypeScript. It uses these hook points:

| Hook | Used for |
|---|---|
| `session.append` | **All hiding.** Every row the conversation keeps passes through it before it is stored or sent: typed prompts, slash-command output, tool results (including errors), attachments, injected context, compaction summaries, and the same rows inside subagents. |
| `prompt.submit` | Hides secrets in the prompt text before it is recorded anywhere, including the message-queue record. |
| `prompt.mention` | `@` files: points the read at a redacted temporary copy, or refuses it (section 6). **[Step 0]** Confirm this works for a plugin in the user tier. |
| `tool.call` | Outbound check (section 11), self-protection (section 17), overwrite guard (section 10). |
| `prompt.compose` | Adds the short placeholder note to Claude's instructions. The note **must** be the same for the whole thread, because changing it later breaks the prompt cache. |
| Slash commands | `/redact` and its subcommands (section 15). |

- **R-02** Every row the main lock rewrites **must** be rewritten before it is stored. A row already sent cannot be changed (section 6.2).
- **R-03** Hooks that can refuse something (`tool.call`, `prompt.submit`, `prompt.mention`) **must** carry a `.catch` handler, so a failure follows the `on_check_failure` setting instead of the engine's default of letting it through (section 12).

### 5.2 Backup lock (settings hooks)

Settings-file hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`) that run the same checker with Node. They only act when the main lock isn't running, for example in safe mode, after a crash, or when an admin policy blocks plugin hooks.

| Can do | Cannot do (or limited) |
|---|---|
| Block a prompt that contains a secret | Hide part of a prompt and let the rest through |
| Outbound check before a tool runs | Rewrite a built-in tool's output after it runs **[Step 0]** |
| Change a tool's input before it runs (for example, pipe a command's output through the checker) **[Step 0]** | Cover `@` files, attachments or compaction summaries |

- **R-04** The main lock **must** write an "I'm running" marker per session. The backup lock **must** check for the marker and do nothing when it is there, and switch to strict mode for that session when it is missing.

### 5.3 Personal mode vs Managed mode

| | Personal mode | Managed mode |
|---|---|---|
| Who installs | The developer, from the plugin marketplace | An admin, through managed settings |
| Plugin tier | `user`: other plugins installed in higher tiers run first and could skip it | `prepend`: runs first, and no user plugin can skip it |
| Messages, files read, command output | Hidden | Hidden |
| `@` files | Hidden through `prompt.mention` **[Step 0]**. If that fails: listed as a known limit | Hidden |
| Compaction summaries | Hidden through `session.append` **[Step 0]** | Hidden |
| Can the user switch it off? | Yes | No. Settings can be locked |
| If the organization sets `allowManagedHooksOnly` | **Does nothing.** User-tier plugins load no hooks. `/redact doctor` must say so. | Works |

- **R-05** When the tool can't run its hooks (for example under `allowManagedHooksOnly` in Personal mode), it **must** say so plainly in `/redact doctor` and, where possible, at session start. Users must never believe they are protected when they aren't.

## 6. What gets checked

| Content | v1 |
|---|---|
| Messages the user types or pastes | Checked |
| Files Claude reads | Checked |
| Command output, including errors from failed commands | Checked |
| Files attached with `@` | Checked (section 5.3) |
| Compaction summaries | Checked |
| Results from connected tools (MCP) | Checked (text parts) |
| Subagents | Checked (same hooks, the row's `agentId` is set) |
| Resumed sessions (`/resume`, `--resume`) | See 6.1 |
| Images and documents (PDFs) | Setting `media`: `pass` (default, with a one-line notice) or `drop` (removed, with a note to Claude saying so) |

### 6.1 Resumed sessions

Rows loaded by `/resume` are **not** passed through `session.append`. Claude Code sends them as they were stored. A session from before the tool was installed, or from before a secret was registered, can therefore contain raw secrets.

- **R-06** When a session is resumed, the tool **must** scan the loaded history. If it finds a secret, it **must** block the next prompt and tell the user: "This session's history contains N secrets that the model would see again. Start a new session (or `/redact allow` to continue anyway)." **[Step 0]** Confirm that a plugin can read the loaded history before the first request.

### 6.2 Secrets registered mid-session

Claude Code never changes what a thread has already sent. `/redact add` therefore protects only from that point on.

- **R-07** When a secret is registered, the tool **must** check this session's stored history and, if the value appeared earlier, warn: "This value was already sent to the model N times this session. Consider rotating it."

## 7. How it finds secrets

Six checks, run in one pass over the text:

| # | Check | Catches | Example |
|---|---|---|---|
| 1 | Known key formats | Keys with a fixed shape, from the Gitleaks rule set (pinned version; see section 21) | AWS, Azure, GitHub, GitLab, Slack, Stripe, JFrog, Databricks keys |
| 2 | Password labels | A value after a clear label, short or simple, quoted or not | `password=Autumn2026`, `pw: hunter2`, `DB_PASSWORD="..."`, `Password=` inside a connection string |
| 3 | Your own secrets | Exact values the user registered | Any format, including internal company token formats |
| 4 | Once caught, always caught | A secret seen earlier in the session, wherever it shows up again | The same key later in a log without its label |
| 5 | Disguised copies | Secrets in encoded form | base64, base64url, URL-encoded, hex, escaped JSON |
| 6 | Custom rules | Patterns added in settings, no code change | An internal format such as `acme_[a-z0-9]{32}` |

### 7.1 Password-label grammar

A label match needs all of these:

1. **A label.** Case-insensitive, matched as a whole word or as the end part of a name (`DB_PASSWORD`, `smtpPass`, `client-secret`).
2. **A separator** right after it, with optional spaces: `=`, `:`, `=>`, `:=`, or a connection-string `;Key=`. A label without a separator never matches. So Python's `pass` statement and the word "password" in a sentence are left alone.
3. **A value.** Quoted (`'...'`, `"..."`, backticks) or unquoted, up to the next space, `;`, `,`, `&`, closing bracket or end of line.

| Label strength | Labels | Hides the value when |
|---|---|---|
| **Strong** | `password`, `passwd`, `pwd`, `pw`, `pass`, `secret`, `client_secret`, `token`, `api_key`, `apikey`, `private_key`, `conn_str`, `connection_string` | It is 6 characters or longer and not a harmless value (7.2) |
| **Weak** | `key`, `auth`, `credential`, `access` | It is also random-looking (mixed character classes and long enough; tuned on the test sets) |

### 7.2 Harmless values (left alone)

- **Placeholders:** `your-password-here`, `<password>`, `********`, `xxxxxx`, `changeme`, `example`, `dummy`, `test`, `null`, `none`, empty values.
- **Variable references:** `${VAR}`, `$VAR`, `%VAR%`, `{{ var }}`, `${{ secrets.X }}`, `process.env.X`, `os.environ["X"]`, `os.getenv(...)`, `System.getenv(...)`, `ENV["X"]`.
- **Code, not values:**
  - Type names: `string`, `str`, `String`, `number`, `int`, `bool`, `boolean`, `bytes`, `Optional[...]`, `SecretStr`.
  - Unquoted identifiers that are function calls or property access: `getToken()`, `config.password`, `self.secret`, `args.token`.
  - Unquoted single identifiers in source files (`password = password`). A **quoted** value is never treated as code.
- Documented example keys (for example AWS's `AKIAIOSFODNN7EXAMPLE`) and database URLs without a password.

- **R-08** Each harmless rule **must** have a test showing it is left alone, and a matching test showing that a real-looking value in the same spot is hidden.

### 7.3 Unknown random secrets (parked)

Not in v1. Parked in section 23 (D-019).

## 8. Registering your own secrets

- **`/redact add`:** paste a secret once. It is matched from then on (and see 6.2).
- **`/redact learn`:** a one-time picker that lists values from `.env*` files in the project. Nothing is learned unless the user ticks it. Values that look like real secrets start ticked.

### 8.1 How they're stored

An earlier design stored only keyed fingerprints. That conflicts with two other goals: the same cost for 10 or 10,000 secrets, and finding secrets inside base64 without decoding. Checking a keyed fingerprint at every position, for every secret length, is too slow on large outputs. So the secrets are stored **encrypted**:

| Part | Design |
|---|---|
| At rest | One file, encrypted with AES-256-GCM. Each entry holds the value, a label and the date added. |
| Key | 256-bit random key, kept in the OS password store: macOS Keychain (`security`), Windows DPAPI (current user, through PowerShell), Linux Secret Service (`secret-tool`). |
| No password store (headless Linux, some containers) | Key file with owner-only permissions, plus a warning in `/redact doctor` |
| In use | Decrypted into memory when the session starts, never written to disk in plain form |
| Session catches (check 4) | Memory only, for that session |

**Trade-off on record:** someone running as the same user can decrypt the file, just as they can read `.env`. This protects against copying the file elsewhere, not against malware already running as the user.

- **R-09** The tool **must** never write a registered or caught secret to disk unencrypted. That includes logs, reports, temp files and the marker.
- **R-10** **[Step 0]** Confirm the mod runtime offers WebCrypto (AES-GCM, secure random) and `$.process` for calling the OS password store. If not, the backup lock's Node helper does the key handling.

## 9. What Claude sees

A placeholder in place of each secret, for example:

```
[REDACTED:AWS_KEY ...0001 #k7q2m9x4p1]
```

- **Label:** what kind of secret it was.
- **Last 4 characters:** only for secrets of 12 or more characters, and never for password-label values (check 2). Setting `hints: off` removes them.
- **Random tag:** at least 64 random bits from a secure source. The same secret gets the same tag within a session, including in subagents. Two different secrets never share a tag.

The placeholder note added to Claude's instructions says:
- These are hidden values.
- Don't ask for them or guess them.
- Don't use Edit on a line that contains a placeholder.
- Ask the user to fill values in.

## 10. No putting secrets back, and the overwrite guard

The tool never writes real secrets into files. If Claude writes a placeholder into a file, it stays there as text.

- A one-line notice appears, for example: `Claude wrote a placeholder into config.yaml, line 5. Fill in the real value.`
- `/redact` lists every file that got a placeholder this session.

**Overwrite guard.** Claude only saw the redacted file. If it rewrites the whole file, the real secrets would be replaced by placeholders and lost.

- **R-11** Before a Write or Edit runs, the tool **must** check the file on disk. If a real secret in it would be replaced by its own placeholder, the tool **must** block the change and tell Claude to edit only the lines it needs, leaving placeholder lines alone. The user can let it through once with `/redact allow`.
- An Edit whose `old_string` contains a placeholder fails on its own (the text isn't in the file). That is safe and is left alone.

## 11. Outbound check: commands and web requests

Before Claude runs a command, web request or connected tool, the tool checks whether it contains a known secret (check 3 or 4). This can only happen if a secret slipped past the hiding step, so it's a last safety net.

**Default: block it,** and tell the user why.

| Way out | What it does |
|---|---|
| `/redact allow <tag>` | Marks that value as harmless for this session. Add `--always` to remember it. |
| Setting `outbound: ask` | Asks the user each time: allow or deny |
| Setting `outbound: warn` | Lets it run, shows a warning, writes to the log |
| Setting `outbound: off` | Turns the outbound check off |

Admins can lock this setting.

## 12. When a check fails or takes too long

Claude Code gives each hook **10 seconds**. A hook that throws, returns the wrong shape or runs out of time is skipped, and by default the content goes through. A `.catch` handler gets **1 more second** to answer instead.

| Setting `on_check_failure` | Behaviour |
|---|---|
| `allow` (default) | The content goes through with a visible warning and a log entry |
| `hold` | The `.catch` handler withholds the content. Claude gets a short note saying it was withheld. |

- Admins can lock this setting. **Managed-mode docs recommend `hold`.**
- **R-12** Every failure **must** produce a visible warning and a log entry, whichever setting is used.

*Trade-off on record:* with `allow`, a crash or slowdown means that piece of content reaches the model unchecked. The warning makes sure the user knows when it happens.

## 13. Modes: enforce and observe

| `mode` | What happens |
|---|---|
| `enforce` (default) | Everything in this spec |
| `observe` | Nothing is hidden or blocked. Every detection is logged as "would have hidden". A permanent banner says `secret-shield: OBSERVE MODE, secrets are NOT being hidden`. |

Observe mode is for organizations measuring false alarms before rollout.

- **R-13** Only Managed or User settings can turn on observe mode, never Project settings. While it is on, the banner **must** be shown in every session.

## 14. Settings

The tool works with no settings at all. Settings are read from three levels:

| Level | Where | Who | Rule |
|---|---|---|---|
| Managed | The organization's managed settings | Admin | Wins over everything. Can lock any setting. |
| User | User's home folder | Developer | Can change anything not locked |
| Project | In the project repo | Team | **Can only make things stricter.** A downloaded project can't weaken protection. |

"Stricter only" means a project **cannot**:
- add `allow` entries
- turn rules off
- set `mode: observe`
- loosen `outbound`, `on_check_failure` or `media`
- shorten `secret_files`

A project **can** add custom rules and `secret_files` patterns, and choose stricter values.

| Setting | Default | Options |
|---|---|---|
| `mode` | `enforce` | `enforce`, `observe` |
| `personal_data` | `off` | `on`, `off` |
| `outbound` | `block` | `block`, `ask`, `warn`, `off` |
| `on_check_failure` | `allow` (with warning) | `allow`, `hold` |
| `media` | `pass` (with notice) | `pass`, `drop` |
| `hints` (last 4 characters) | `on` | `on`, `off` |
| `notices` | `on` | `on`, `off` |
| `rules.off` | none | Rule ids to switch off |
| `rules.custom` | none | Extra patterns, each with a label and a keyword |
| `rules.actions` | `hide` for all | Per rule: `block`, `hide`, `warn` |
| `allow` | none | Values or patterns that are harmless |
| `secret_files` | `.env*` | File patterns treated as secret |
| `log.days` | `30` | Number of days |

- **R-14** The settings file **must** be validated. A broken file shows a clear error, and the tool keeps running on the last good settings (or the defaults).
- **R-15** Custom patterns **must** pass the same "can't get stuck" check as built-in ones (section 18) before use. A pattern that fails is rejected with a clear error.

## 15. Commands

| Command | What it does |
|---|---|
| `/redact` | Status of the main and backup locks, the mode, what was hidden this session (type, where, hint), files that got placeholders |
| `/redact add` | Register a secret |
| `/redact learn` | Pick secrets from `.env*` files |
| `/redact allow <tag>` | Mark a hidden value as harmless (`--always` to remember) |
| `/redact self-check` | Runs built-in test cases and shows pass or fail. `--report` writes a shareable report file (no secrets) for a security team or a bug report. |
| `/redact doctor` | Checks the environment: Claude Code version (tested or not), Personal or Managed mode, plugin tier, whether hooks are allowed to run, password store available, backup lock installed, marker present, settings valid. Says what to fix. |

- **R-16** Claude **must not** be able to run these commands. Only the user can.

## 16. Log

- **Where:** a local file on the user's machine.
- **What it records:** time, which check fired, where (prompt, file name, tool), action taken, mode, and the random tag.
- **R-17** The log **must never** contain a secret. Command text and file paths are logged in their redacted form.
- **How long:** 30 days by default (`log.days`).

## 17. The tool protecting itself

- **No network.** It never contacts the internet. No telemetry.
- **No runtime libraries.** All code that runs is in the repo and reviewable. Build-time dev dependencies are pinned with a lockfile.
- **Protects its own files.** Claude's tool calls are denied if they try to change the tool's settings, registered secrets, log or plugin folder. This stops a malicious web page or file from tricking Claude into turning it off.
- **Patterns can't get stuck.** Every pattern is checked when the tool is built, and patterns only run on small pieces of text (section 18). A stuck check that runs out its 10-second budget lets content through by default (section 12).
- **Tier note:** in Personal mode, a plugin installed in a higher tier could skip this tool's hooks. Managed mode installs it in the `prepend` tier, where no user plugin can skip it.

## 18. Speed design

Each piece of text is checked once, when it first arrives, and saved already cleaned:

1. **Find keywords.** Read the text once to find every keyword at the same time. The keyword list is worked out from the patterns when the tool is built, not taken on trust from Gitleaks.
2. **Run patterns near hits only.** Run only the patterns whose keywords appeared, only on the area around each hit. The area's size is worked out from each pattern at build time, so it's guaranteed big enough.
3. **Look for registered and caught secrets.** One Aho-Corasick pass over the text, built from the secrets and their encoded forms (base64 at all 3 alignments with the edge characters trimmed, base64url, URL-encoded, hex, JSON-escaped). The cost is roughly the same for 10 or 10,000 secrets.
4. **Decode only what looks encoded,** in pieces, including very large blocks, and send the decoded text back through steps 1 to 3. At most 3 layers deep.
5. **Skip repeated lines** already checked and found clean this session. This memory is cleared whenever a new secret is registered.

- Hard ceiling: every hook must finish well inside Claude Code's 10-second budget, on a 2 MB input, on a modest laptop.
- Speed targets are set from the first measurements (`plan.md`, Step 2) and published in the repo.

## 19. Install and distribution

**Personal mode**
- The repo includes `.claude-plugin/marketplace.json`.
- Install: `/plugin install <name> --marketplace <owner>/<repo>`.
- Users can pin a version.
- Optional backup lock: a documented snippet for `~/.claude/settings.json`.

**Managed mode**
- A `docs/managed.md` guide with ready-to-use managed-settings examples for macOS, Windows and Linux: the plugin in the `prepend` tier, the backup lock hooks, locked settings, and recommended values (`on_check_failure: hold`).
- Notes for MDM tools (Jamf, Intune) and for offline or mirrored installs (an internal git mirror of the repo).

**Releases**
- Semantic versioning.
- Signed git tags.
- Release archives with SHA-256 checksums.
- A changelog that calls out any change to defaults.

**Uninstall** is documented, including how to delete the encrypted secrets file and the key from the password store.

## 20. Verify it yourself

The maintainers can't test inside every organization. So everything needed to test is shipped with the tool, and none of it needs an API key or network access.

| What | How it works |
|---|---|
| **`/redact self-check`** | Built-in cases run in seconds and show pass or fail. `--report` saves a shareable result. |
| **`/redact doctor`** | Environment check (section 15). |
| **Leak test kit** (`tools/leak-test/`) | A small local server that pretends to be the model API. It plays a scripted conversation that makes Claude Code read files, run commands, use `@` files, compact, and run subagents, all containing planted fake secrets. Claude Code is pointed at it with `ANTHROPIC_BASE_URL`. The server records every request Claude Code sends, then searches the recording for the fakes. Any hit is a failure. It uses Node built-ins only. |
| **Tested-versions list** | Published per release: the pinned Claude Code version, leak test run in CI on macOS, Windows and Linux, plus a one-off manual check of the VS Code panel and the desktop Code tab. |
| **Published scores** | Catch rate and false-alarm rate on the public test sets, per release. |

**Suggested trial for an organization**
1. Run the leak test kit on one managed test machine.
2. Roll out in `observe` mode to a small group and review the log for false alarms.
3. Tune with `allow` and `rules.off`.
4. Switch to `enforce`.

## 21. Open source, credits and support

| Item | Decision |
|---|---|
| License | Apache-2.0 (`LICENSE`), plus a `NOTICE` file |
| Third-party code | Only the Gitleaks rule set is copied (MIT), at a pinned version, credited in `THIRD_PARTY_LICENSES`. Any other code copied later is credited the same way before it is merged. |
| Security reports | `SECURITY.md`: report privately through GitHub Security Advisories, never in public issues |
| Contributions | `CONTRIBUTING.md`: tests first, no runtime libraries, DCO sign-off (`git commit -s`) |
| Conduct | `CODE_OF_CONDUCT.md` |
| Support | Community, best effort, no SLA. Issue templates ask for `/redact doctor` output and the `self-check --report` file. Organizations test in their own environment (section 20). |
| Disclaimer | Provided "as is" (Apache-2.0). It reduces the risk of leaks; it is not a guarantee or a compliance certification. |
| Test secrets | Never real. Fake secrets are built at test time from pieces, so GitHub secret scanning doesn't flag the repo. |

## 22. Known limits

- **Shapeless secrets.** A secret with no known shape, no label, never registered and never seen before can't be detected by any tool. Registering secrets and "once caught, always caught" shrink this gap.
- **Already sent.** Content sent before the tool was installed, or before a secret was registered, can't be taken back (sections 6.1, 6.2).
- **Claude Code's own disk records.** Claude Code keeps backup copies of edited files in `~/.claude/file-history/`. It also stores a tool's structured result (what the screen shows) unchanged next to the redacted text. The tool can't change these. We'll report them to Anthropic.
- **Images and documents** are passed or dropped, never read, in v1.
- **Personal mode:**
  - plugins in a higher tier can skip this tool
  - `allowManagedHooksOnly` turns it off
  - `@` files depend on `prompt.mention` [Step 0]
- **Safe mode** turns the main lock off. The backup lock still runs, but it can only block messages, not hide parts of them.
- **Failed or slow checks** let content through by default (section 12).
- **Observe mode** hides nothing, by design.
- **Determined attacks.** The tool stops accidental leaks. It doesn't stop a person who deliberately splits up or scrambles a secret.

## 23. Later (parked)

The single list of everything not being built now. Anything deferred during a build step is added here (features) or to `docs/progress.md` "Known issues" (bugs, unfinished bits), never only in session notes.

**Parked from v1** (what · why · decision):

- Hidden test set, scored once per release · too much effort for v1; the catch, code and false-alarm sets are enough to start · D-019
- Large downloaded false-alarm corpus · the `.ts` files in `node_modules/typescript` and `node_modules/@types/node` are a known-license set with no download · D-019
- Full compatibility matrix (versions × OS × surface) · one pinned version on 3 OSes is enough for v1 · D-019
- Lowest-working-version hunt (old Step 0 check 0.12) · same reason · D-019
- Signed release tags · needs signing-key setup; SHA-256 checksums cover integrity · D-019
- "Looks random" check (entropy-style, old §7.3) · was already "later in v1"; ship only if it catches more without many more false alarms; credit any outside code (§21) · D-019

**v2 candidates:**

- Read inside images and documents.
- Optional "put secrets back" setting, limited to the original file and `.env` files.
- Keep config file layouts visible while hiding only values (JSON, YAML, TOML).
- A faster native helper for very large texts, if v1 speed tests fail.
- Other AI tools.
