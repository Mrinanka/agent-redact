---
name: step0-check
description: Run a Step 0 experiment to confirm how Claude Code really behaves, and record the evidence.
argument-hint: <check ids from plan.md Step 0, e.g. 0.2 0.3>
disable-model-invocation: true
---

We are confirming Step 0 checks **$ARGUMENTS** from `docs/plan.md`. This is an experiment, not product code: keep it small and throwaway.

## 1. Understand

- Read those check rows in `docs/plan.md` Step 0 and the spec sections they cite.
- Read their current rows in `docs/findings-step0.md`.
- For mod behaviour, grep the mod API type file that the `plugin-authoring` skill names (search for the event name, e.g. `'prompt.mention'`), instead of relying on memory.

## 2. Propose the experiment, then wait

For each check, show me:
- **The question**, in yes/no form.
- **The smallest probe** that answers it, in `experiments/<check-id>/`: a tiny mod loaded with `claude --plugin-dir experiments/<check-id>`, a settings hook, or a script.
  - Use fake secrets built from pieces only.
  - Make the probe write what it observes to a log file in `experiments/<check-id>/out/` (event names, doors, types, lengths, yes/no flags; never full content), so you can read the evidence yourself.
- **What I must do by hand:** start a new Claude Code session, open VS Code or the desktop app, use admin rights, use Windows Sandbox or a VM, and so on.
- **What result means yes, and what means no.**
- **What the experiment is based on:** the API types `file:line` or docs section that suggests how it should behave, and your prediction of the result, with confidence.
- If there's a choice of method (e.g. a mod vs a settings hook, or a VM vs Windows Sandbox), recommend one with evidence, following "Questions and recommendations" in `CLAUDE.md`.

Don't build anything until I say OK.

## 3. Run

- Build the probe and run `claude plugin validate` on it if it's a mod.
- Give me numbered, copy-paste steps to run it.
- Wait for me to say it's done, then read the log files. Ask me only for what the logs can't show (what I saw on screen).

## 4. Record (in `docs/findings-step0.md`)

For each check, update its row:
- **Result:** yes / no / partly.
- **Claude Code version:** from `claude --version`.
- **OS and surface**, and the **method** (probe path, steps).
- **Evidence:** a short log excerpt, no secrets.
- **Spec impact:** none, or what must change.

Add a **LESSON** for anything surprising.

Base the result only on what the logs or I observed. If the evidence is ambiguous, record `partly` and say what extra run would settle it.

## 5. Next

- List any spec or plan changes needed for `/spec-change`. Recommend the change, and cite the findings row as evidence. Don't edit the spec here.
- Tell me which checks are still pending.
