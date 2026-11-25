---
name: repro
description: Reproduce a failure with exact commands before declaring a cause. Notes stay in devops-skill/thoughts/non-final/.
---

# /repro

Also: `reproduce`, `write a repro`.

Reproduce the failure before declaring a cause. When one AI seat talks
to another about a concrete **feature**, **bug**, finding or blocker,
prefer a live **reproduction** on GUI / browser / terminal over a long
write-up ([client-and-agile.md](../skills/devops-multi-agent-team/references/client-and-agile.md)).
Daily Scrum / standup, Planning and Refinement do not need a repro by
default.

1. Recreate it with exact commands, inputs, and exit codes.
2. Write the repro to `devops-skill/thoughts/non-final/repro-<topic>.md`.
   Redact secrets first ([thoughts-layout.md](../skills/devops-multi-agent-team/references/thoughts-layout.md)).
3. Files the repro *creates* in the project tree are process output and
   never land on the committed timeline. Prefer a throwaway clone
   (`git clone --no-hardlinks . /tmp/probe`); when the repro must run in
   this worktree, use a reserved lower-case name (a `_scratch/`
   directory or a `.scratch` infix) and clean up before reporting. Undo
   a repro that edited a tracked file with `git checkout -- <exact path>`,
   never `git checkout -- .` or `git stash` — the worktree is shared.
4. Do not claim a root cause until the repro ran (or the environment cannot run it — then say so).
5. A successful repro or fix still does **not** authorize a push.
   Only the **client (human)** authorizes a push (client-and-agile.md,
   qa-publish-policy.md). Default path still runs Security's SOC 2
   review on every change except the review-bot feedback exceptions.
6. Spawn helpers with `/create-subagent` asynchronously when parallel repros help.
7. Use any installed `/` skill that fits (`/browser-automation`, `/buildkite-*`).

Catalog: `../skills/devops-multi-agent-team/references/agent-commands.md`.
