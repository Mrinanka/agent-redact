# Decision log

What we decided, and **why**. This log helps:
- future sessions not reopen settled questions
- contributors understand the design
- us notice when a decision should be revisited

**Rules**
- Entries are numbered `D-001`, `D-002`, … and never deleted or renumbered.
- A changed mind gets a **new** entry. The old one is marked `superseded by D-0xx`.
- The "Why" is the real reason given at the time. If it wasn't recorded, it says so.
- No secrets in here, not even fake ones.
- Status is one of `proposed` (waiting for the owner), `accepted` or `superseded by D-0xx`.

**What counts as a decision:**
- a spec ambiguity resolved
- a design or algorithm choice
- a library, tool or format choice
- a default value or target number
- a rejected review finding
- anything a contributor would ask "why is it like this?" about

Tiny clarifications go under **Minor** at the bottom.

## Index

| ID | Title | Status | Part | Spec § |
|---|---|---|---|---|
| D-001 | License: Apache-2.0 | accepted | setup | 21 |
| D-002 | Two audiences: Personal mode and Managed mode | accepted | setup | 5.3 |
| D-003 | Add observe mode | accepted | setup | 13 |
| D-004 | Store registered secrets encrypted, not as fingerprints | **proposed** | setup | 8.1 |
| D-005 | Default `on_check_failure: allow` | accepted | setup | 12 |
| D-006 | No putting secrets back into files in v1 | accepted | setup | 10 |
| D-007 | Build workflow: slash commands, one part per session, commit at wrap-up, docs in `docs/` | accepted | setup | — |
| D-008 | Credit only code actually copied | accepted | setup | 21 |
| D-009 | Every question comes with a researched, evidence-backed recommendation | accepted | setup | — |

## Entry template

```
## D-0xx: <title>
- Date / Part: YYYY-MM-DD / <part id>        Status: proposed | accepted | superseded by D-0xx
- Context: why a decision was needed
- Options considered: A … / B … / C …
- Decision: what we chose
- Why: the deciding reasons, in the owner's words where they gave them
- Evidence: the sources the recommendation rested on (file:line, docs URL + section,
            test or benchmark output, findings-step0 rows, D-ids)
- Trade-offs: what we give up, what it affects
- Revisit when: the signal that should make us reconsider
- Links: spec §, R-ids, files, commits
```

---

## D-001: License: Apache-2.0
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: The tool is to be open source and usable by individual developers and by companies, whose legal teams review licenses before adoption.
- Options considered: MIT / Apache-2.0 / dual MIT and Apache-2.0.
- Decision: Apache-2.0, with a `NOTICE` file.
- Why: It's permissive like MIT, adds an explicit patent grant, and corporate legal teams usually approve it quickly. It is compatible with the MIT-licensed Gitleaks rules we copy, as long as they're credited.
- Trade-offs: A longer license text and a `NOTICE` file to maintain.
- Revisit when: Never expected. Changing a license after outside contributions is hard.
- Links: spec §21; `LICENSE` and `NOTICE` (part 0.0).

## D-002: Two audiences: Personal mode and Managed mode
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: The first draft was written for one company (an IT install, a "security contact"). The open-source version must work for a single developer and for any organization.
- Options considered: Both, with a guide for each / developers first, with managed install as an appendix.
- Decision: Both, as first-class modes.
- Why: The owner wants any developer to "just use it", and companies to be able to adopt and test it themselves.
- Trade-offs: Two install paths to document and test. Personal mode has weaker guarantees (tier bypass, `allowManagedHooksOnly`), which must be stated clearly.
- Revisit when: Step 0 shows a mode can't meet its stated guarantees.
- Links: spec §5.3, §19; R-05.

## D-003: Add observe mode
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: The owner can't test inside company environments. Companies need a safe way to trial the tool and measure false alarms before it blocks anything.
- Options considered: Add `mode: observe | enforce` / always enforce.
- Decision: Add it. Default `enforce`. Only Managed or User settings can enable observe, never Project. A permanent banner shows while it's on.
- Why: It lets organizations run their own trial (observe → review the log → tune → enforce) without help from the maintainer.
- Trade-offs: In observe mode nothing is protected. Mitigated by the banner and the project-level ban.
- Revisit when: Pilot users find the banner insufficient, or observe mode gets left on by accident.
- Links: spec §13, §20; R-13.

## D-004: Store registered secrets encrypted, not as fingerprints
- Date / Part: 2026-10-31 / setup. Status: **proposed: needs the owner's explicit confirmation**
- Context: The first draft stored only keyed fingerprints plus length, so a copied file couldn't reveal even short passwords. The same draft wanted (a) the same cost for 10 or 10,000 secrets and (b) finding secrets inside base64 without decoding.
- Options considered:
  - A) Keyed fingerprints at every position for every registered length. Too slow on large outputs.
  - B) A rolling-hash prefilter, then a keyed confirm. A non-keyed rolling hash on disk weakens the fingerprint idea for short secrets.
  - C) Values encrypted at rest (AES-256-GCM) with the key in the OS password store, decrypted into memory per session, matched with Aho-Corasick over the raw and encoded forms.
- Decision (proposed): C.
- Why: It's the only option found that meets the speed goal and the encoded-form matching at the same time.
- Trade-offs: Anyone running as the same user can decrypt the file, just as they can read `.env`. It protects against the file being copied elsewhere, not against malware running as the user.
- Revisit when: Step 0 check 0.4 shows the mod runtime can't do the crypto or reach the OS password store, or the owner prefers the fingerprint property over speed.
- Links: spec §8.1, §18; R-09, R-10; plan Step 0 check 0.4; part 2.5.

## D-005: Default `on_check_failure: allow`
- Date / Part: carried over from the first draft. Status: accepted
- Context: When a check fails or times out (Claude Code gives each hook 10 s), the content either goes through or is held back.
- Options considered: `allow` with a warning / `hold`.
- Decision: Default `allow`, with a visible warning and a log entry every time. `hold` is available and lockable; the Managed-mode docs recommend it.
- Why: Recorded in the first draft as the owner's decision; the detailed reason was not written down. *(Owner: add your reason here.)*
- Trade-offs: A crash or slowdown lets that piece of content reach the model unchecked. The warning makes sure the user knows.
- Revisit when: The pilot shows failures happen often enough to matter, or adopters ask for a safer default.
- Links: spec §12; R-03, R-12.

## D-006: No putting secrets back into files in v1
- Date / Part: carried over from the first draft. Status: accepted
- Context: Claude only sees placeholders. When it writes a file, the real values could in principle be put back automatically.
- Options considered: Put back automatically / never put back; the developer fills in values.
- Decision: Never put back in v1. Placeholders written by Claude stay as text, with a notice. An overwrite guard (added in the review) stops real secrets being lost.
- Why: The first draft's goal: "Simple: only features that clearly reduce risk." Writing real secrets to disk on the model's behalf adds risk and complexity.
- Trade-offs: The developer has to fill in values by hand.
- Revisit when: Pilot users find manual filling too painful (it's a v2 candidate).
- Links: spec §10, §23; R-11.

## D-007: Build workflow
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: The tool is built with Claude Code across many sessions, so progress and reasoning must survive between them.
- Options considered: Slash commands / a copy-paste prompt file / both. Claude commits at wrap-up / the owner commits. Docs in the root / in `docs/`.
- Decision:
  - Project slash commands (`/next-part`, `/review-part`, `/wrap-up`, `/step-retro`, `/step0-check`, `/spec-change`, `/progress`)
  - one part per session
  - Claude commits at `/wrap-up`
  - spec, plan and logs live in `docs/`
- Why: Short reusable commands keep every session consistent. Commits per part give clean checkpoints. `docs/` keeps the root clean for the README, LICENSE and code of an open-source repo. The owner also asked that progress, decisions and design choices be logged to build a better product, hence `decision-log.md`, `lessons.md` and `/step-retro`.
- Trade-offs: Some ceremony per part.
- Revisit when: A `/step-retro` shows the ceremony slows work more than it helps.
- Links: `CLAUDE.md`, `.claude/skills/`, `docs/progress.md`.

## D-008: Credit only code actually copied
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: The design took inspiration from ideas seen online, but no outside code apart from the Gitleaks rules is used.
- Options considered: Credit every inspiration / credit only copied code.
- Decision: Credit only code or data actually copied, in `THIRD_PARTY_LICENSES`. Today that's only the Gitleaks rules (MIT, pinned version).
- Why: The owner: the idea is their own and they write their own code. Ideas aren't covered by copyright; copied code is.
- Trade-offs: None significant. An optional "Acknowledgements" line in the README remains possible.
- Revisit when: Any outside code or data is copied, which must be credited before it's merged.
- Links: spec §21; `CLAUDE.md` rules.

## D-009: Every question comes with a researched, evidence-backed recommendation
- Date / Part: 2026-10-31 / setup. Status: accepted
- Context: Building with Claude means many questions to the owner: design choices, spec readings, review findings. A bare question, or a recommendation with nothing behind it, pushes the research onto the owner and risks decisions built on guesses.
- Options considered: Ask freely / always include a recommendation / always include a researched recommendation that cites evidence.
- Decision: The last one. Every question uses the format in `CLAUDE.md` "Questions and recommendations": Question, Options, Recommendation, Evidence, Confidence. Claude researches first, cites only sources actually read or run, labels anything from memory as unverified, and says plainly when evidence is weak.
- Why: The owner asked that every question during planning or implementation carry "a proper researched and valid suggestion … backed by something".
- Evidence: The owner's request in the setup session.
- Trade-offs: Questions take a little longer to prepare. Decisions are better founded, and the evidence lands in this log.
- Revisit when: A `/step-retro` shows the research overhead outweighs the benefit for small questions.
- Links: `CLAUDE.md` ("Questions and recommendations"); every command in `.claude/skills/`.

---

## Minor

- 2026-10-31: "secret-shield" is a working name. The final name is chosen in part 6.4 (no "Claude" or "Anthropic" in it).
